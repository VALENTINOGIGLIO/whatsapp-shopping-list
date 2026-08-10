import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MessageParser } from '../domain/MessageParser.js';
import { CommandType } from '../domain/CommandType.js';
import { startWebServer } from '../web/server.js';
import { FirestoreAdapter } from '../db/FirestoreAdapter.js';
import { MockDatabaseAdapter } from '../db/MockDatabaseAdapter.js';
import { HabitTracker } from '../domain/HabitTracker.js';
import { ShoppingListService } from '../domain/ShoppingListService.js';
import { WhatsAppBroadcaster } from '../broadcaster/WhatsAppBroadcaster.js';

export class WhatsAppClientWrapper {
  constructor(options = {}) {
    this.service = options.service || null;
    this.status = 'INITIALIZING';
    this.qrCode = null;
    this.pairingCode = null;
    this.lastQrTimestamp = null;
    this.lastTargetChatId = process.env.WHATSAPP_FAMILY_CHAT_ID || null;
    this.dataPath = options.dataPath || './auth_info_baileys';
    this.allowSelfMessages = options.allowSelfMessages || false;
    this.sock = null;
  }

  async initialize() {
    console.log('🔄 [Baileys] Starting initialization...');
    const { state, saveCreds } = await useMultiFileAuthState(this.dataPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[Baileys] using WA v${version.join('.')}, isLatest: ${isLatest}`);

    const logger = pino({ level: 'silent' });

    this.sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: true,
      auth: state,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrCode = qr;
        this.pairingCode = null;
        this.status = 'QR_READY';
        this.lastQrTimestamp = Date.now();
        console.log('📱 [Baileys] New QR code generated.');
      }

      if (connection === 'close') {
        this.status = 'DISCONNECTED';
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.warn('⚠️ [Baileys] Connection closed due to', lastDisconnect?.error, ', reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          this.initialize();
        } else {
          console.log('❌ [Baileys] Logged out from WhatsApp.');
        }
      } else if (connection === 'open') {
        this.status = 'READY';
        this.qrCode = null;
        this.pairingCode = null;
        console.log('🚀 [Baileys] Client is READY and Connected!');
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      for (const msg of m.messages) {
        if (!msg.message) continue;
        await this.handleIncomingMessage(msg);
      }
    });
  }

  async destroy() {
    if (this.sock) {
      this.sock.logout();
      this.sock.end(undefined);
    }
  }

  getQrCode() {
    return this.qrCode;
  }

  getPairingCode() {
    return this.pairingCode;
  }

  async requestPairingCode(phoneNumber) {
    if (!this.sock) {
      throw new Error('Socket not initialized');
    }
    
    // Baileys pairing code
    if (!this.sock.authState.creds.registered) {
      // Small delay required by Baileys
      await new Promise(r => setTimeout(r, 1000));
      const code = await this.sock.requestPairingCode(phoneNumber);
      this.pairingCode = code;
      this.qrCode = null;
      return code;
    } else {
      throw new Error('Already registered/authenticated');
    }
  }

  getStatus() {
    return this.status;
  }

  isReady() {
    return this.status === 'READY';
  }

  getClient() {
    return this.sock;
  }

  getLastTargetChatId() {
    return this.lastTargetChatId;
  }

  setTargetChatId(chatId) {
    this.lastTargetChatId = chatId;
  }

  async handleIncomingMessage(msg) {
    const isFromMe = msg.key.fromMe;
    if (isFromMe && !this.allowSelfMessages) return null;

    // Extract text from various Baileys message types
    const text = msg.message?.conversation || 
                 msg.message?.extendedTextMessage?.text || 
                 '';
    
    if (!text) return null;

    const from = msg.key.remoteJid;
    if (from) {
      this.lastTargetChatId = from;
    }

    const sender = msg.pushName || from.split('@')[0] || 'user1';

    const parsed = MessageParser.parse(text);

    if (!this.service) {
      console.warn('⚠️ [WhatsApp] ShoppingListService not attached.');
      return null;
    }

    let replyText = '';

    try {
      switch (parsed.type) {
        case CommandType.ADD_ITEM: {
          const result = await this.service.addItem(parsed.payload.itemName, parsed.payload.storeName, sender);
          const storeStr = result.item.store ? ` (${result.item.store})` : '';
          replyText = `✅ Aggiunto alla lista: *${result.item.name}*${storeStr}`;
          break;
        }
        case CommandType.RESET_LIST: {
          const result = await this.service.resetList(parsed.payload.storeName, sender);
          const storeStr = result.resetRecord.store ? ` presso *${result.resetRecord.store.toUpperCase()}*` : '';
          replyText = `🧹 Spesa completata${storeStr}! La lista è stata svuotata (${result.itemsCleared} articoli).`;
          break;
        }
        case CommandType.GET_LIST: {
          const items = await this.service.getList();
          replyText = this.service.formatListForDisplay(items);
          break;
        }
        case CommandType.GET_HABITS: {
          const habits = await this.service.getHabits(parsed.payload.itemName);
          if (!habits || habits.length === 0) {
            replyText = '📊 Nessuna abitudine registrata finora.';
          } else {
            const lines = ['📊 *Abitudini di Spesa*:'];
            habits.forEach(h => {
              const fav = h.favoriteStore || 'nessuno';
              lines.push(`- *${h.itemName}*: negozio preferito = ${fav}`);
            });
            replyText = lines.join('\n');
          }
          break;
        }
        case CommandType.HELP: {
          replyText = `🤖 *WhatsApp Shopping List Bot*\n\n` +
            `• *Aggiungere un articolo*: scrivi il nome (es: "pane" oppure "latte esselunga")\n` +
            `• *Mostrare la lista*: scrivi "lista" o "list"\n` +
            `• *Resettare la lista*: scrivi "reset" oppure "reset esselunga"\n` +
            `• *Vedere le abitudini*: scrivi "abitudini" oppure "habits pane"\n` +
            `• *Aiuto*: scrivi "help" o "aiuto"`;
          break;
        }
        default: {
          replyText = '❓ Comando non riconosciuto. Scrivi *help* per la lista dei comandi disponibili.';
        }
      }

      if (from) {
        await this.sock.sendMessage(from, { text: replyText }, { quoted: msg });
      }
    } catch (err) {
      console.error('❌ [WhatsApp] Error processing message:', err);
      replyText = `⚠️ Si è verificato un errore: ${err.message || err}`;
      if (from) {
        await this.sock.sendMessage(from, { text: replyText });
      }
    }

    return replyText;
  }
}

// Immediate execution check when invoked directly as main script
const currentFilePath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (executedPath && (currentFilePath === executedPath || executedPath.endsWith('whatsappClient.js'))) {
  const useFirestore = process.env.USE_FIRESTORE === 'true' || !!process.env.FIREBASE_SERVICE_ACCOUNT;
  const db = useFirestore ? new FirestoreAdapter() : new MockDatabaseAdapter();
  const habitTracker = new HabitTracker(db);
  const broadcaster = new WhatsAppBroadcaster(null);
  const service = new ShoppingListService(db, broadcaster, habitTracker);

  const clientWrapper = new WhatsAppClientWrapper({ service });
  
  // Custom patch for broadcaster to work with Baileys
  broadcaster.client = {
    sendMessage: async (chatId, message) => {
      if (clientWrapper.sock) {
        await clientWrapper.sock.sendMessage(chatId, { text: message });
      }
    }
  };

  const port = process.env.PORT || 3000;
  startWebServer({ port, whatsappClient: clientWrapper }).then(() => {
    console.log(`🌐 [Web Server] Started on port ${port}`);
    return clientWrapper.initialize().catch((err) => {
      clientWrapper.status = 'INITIALIZE_FAILED';
      console.error('❌ [WhatsApp] Client initialization failed:', err);
    });
  }).catch((err) => {
    console.error('❌ Failed to start application:', err);
    process.exit(1);
  });
}
