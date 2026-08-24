import 'dotenv/config';
import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { ShoppingListService } from '../domain/ShoppingListService.js';
import { FirestoreAdapter } from '../db/FirestoreAdapter.js';
import { MessageParser } from '../domain/MessageParser.js';
import { useFirestoreAuthState } from './FirestoreAuthState.js';
import qrcode from 'qrcode';
import { createWebServer } from '../web/server.js';
import { fileURLToPath } from 'url';
import fs from 'fs';

export class WhatsAppClientWrapper {
  constructor(options = {}) {
    this.status = 'INITIALIZING';
    this.qrCode = null;
    this.qrCodeDataURL = null;
    this.lastTargetChatId = options.defaultRecipient || 'family_chat';
    this.allowSelfMessages = true;
    this.showTerminalQr = options.showTerminalQr !== false;
    this.shoppingListService = options.service || options.shoppingListService || new ShoppingListService(new FirestoreAdapter());
    this.sock = null;
    this.client = options.client || null;
    this.activeSessions = new Set();

    if (this.client) {
      this.client.on('qr', (qr) => {
        this.status = 'QR_READY';
        this.qrCode = qr;
        this.qrCodeDataURL = qr;
      });

      this.client.on('authenticated', () => {
        this.status = 'AUTHENTICATED';
        this.qrCode = null;
        this.qrCodeDataURL = null;
      });

      this.client.on('ready', () => {
        this.status = 'READY';
        this.qrCode = null;
        this.qrCodeDataURL = null;
      });

      this.client.on('auth_failure', () => {
        this.status = 'AUTH_FAILURE';
      });

      this.client.on('disconnected', () => {
        this.status = 'DISCONNECTED';
      });

      this.client.on('message', async (msg) => {
        await this.handleIncomingMessage(msg);
      });
    }
  }

  getStatus() {
    return this.status || (this.sock ? 'READY' : 'INITIALIZING');
  }

  getQrCode() {
    return this.qrCode || this.qrCodeDataURL || null;
  }

  isReady() {
    return this.status === 'READY';
  }

  getClient() {
    return this.client || this.sock || null;
  }

  getLastTargetChatId() {
    return this.lastTargetChatId || 'family_chat';
  }

  async sendMessage(to, content) {
    this.lastTargetChatId = to || this.lastTargetChatId || 'family_chat';
    const targetChat = this.lastTargetChatId;

    if (this.client && typeof this.client.sendMessage === 'function') {
      return await this.client.sendMessage(targetChat, content);
    }
    if (this.sock && typeof this.sock.sendMessage === 'function') {
      const payload = typeof content === 'string' ? { text: content } : content;
      return await this.sock.sendMessage(targetChat, payload);
    }
    return null;
  }

  async handleIncomingMessage(msg) {
    if (!msg || typeof msg !== 'object') return null;

    const fromMe = Boolean(msg.fromMe || msg.key?.fromMe);
    let text = typeof msg.body === 'string' ? msg.body : (msg.text || msg.message?.conversation || msg.message?.extendedTextMessage?.text || null);
    if (!text || typeof text !== 'string' || text.trim() === '') return null;

    const from = msg.from || msg.key?.remoteJid || 'family_chat';
    const senderName = msg._data?.notifyName || msg.pushName || msg.sender || from;

    this.lastTargetChatId = from;
    const targetChat = this.chatId || 'family_chat';

    if (fromMe && !this.allowSelfMessages) {
      return null;
    }

    if (fromMe && /^[✅❌🟢🔴🤖🛒🏪📊]/.test(text.trim())) {
      return null;
    }

    let response = '';

    try {
      const parsed = MessageParser.parse(text);

      if (parsed.command === 'legacy_toggle') {
        response = '🟢 *Novità!* Il bot è stato aggiornato ed è ora **SEMPRE ATTIVO**.\nNon c\'è più bisogno di scrivere /avvia o /ferma.\nScrivi semplicemente il nome del prodotto per aggiungerlo alla lista!';
      } else if (parsed.command === 'help') {
        response = '🤖 *WhatsApp Shopping List Bot*\n' +
          '- *Aggiungere un articolo*: scrivi il nome del prodotto (es. "latte", "pane eurospin")\n' +
          '- *Visualizzare lista*: scrivi "lista" o "list"\n' +
          '- *Resettare lista*: scrivi "reset" o "reset [supermercato]"\n' +
          '- *Abitudini*: scrivi "abitudini" o "abitudini [prodotto]"\n' +
          '- *Aiuto*: scrivi "aiuto" o "help"';
      } else if (parsed.command === 'list') {
        if (text.toLowerCase().includes('supermercat')) {
          const items = await this.shoppingListService.getList(targetChat);
          response = this.shoppingListService.formatListGroupedByStore(items);
        } else {
          const items = await this.shoppingListService.getList(targetChat);
          response = this.shoppingListService.formatListForDisplay(items);
        }
      } else if (parsed.command === 'habits') {
        const item = parsed.item || (parsed.payload && parsed.payload.itemName);
        const habits = await this.shoppingListService.getHabits(targetChat, item || null);
        if (item) {
          if (habits && habits.length > 0) {
            const h = habits[0];
            response = `📊 *Abitudini di Spesa* per ${h.itemName}:\n- Supermercato preferito: ${h.favoriteStore || 'nessuno'}`;
          } else {
            response = `📊 *Abitudini di Spesa*: nessuna preferenza registrata per "${item}".`;
          }
        } else {
          response = `📊 *Abitudini di Spesa* (${habits.length} articoli registrati).`;
        }
      } else if (parsed.command === 'reset') {
        const store = parsed.store || (parsed.payload && parsed.payload.storeName) || null;
        const result = await this.shoppingListService.resetList(targetChat, store, senderName);
        const storeText = store ? ` presso ${store.toUpperCase()}` : '';
        response = `Spesa completata${storeText}! La lista è stata svuotata (${result.itemsCleared} articoli).`;
      } else {
        // Add item
        const itemName = parsed.item || text.trim();
        const storeName = parsed.store || null;

        const result = await this.shoppingListService.addItem(targetChat, itemName, storeName, senderName);
        const storeInfo = result.item.store ? ` (${result.item.store})` : '';
        response = `✅ Aggiunto alla lista: ${result.item.name}${storeInfo}`;
      }
    } catch (err) {
      console.error('Error processing message in handleIncomingMessage:', err);
      response = `❌ Si è verificato un errore: ${err.message || err}`;
    }

    if (response) {
      try {
        if (typeof msg.reply === 'function') {
          await msg.reply(response);
        } else if (this.client && typeof this.client.sendMessage === 'function') {
          await this.client.sendMessage(from, response);
        } else if (this.sock && typeof this.sock.sendMessage === 'function') {
          await this.sock.sendMessage(from, { text: response });
        }
      } catch (replyErr) {
        console.error('Error sending reply:', replyErr);
      }
    }

    return response;
  }

  async initialize() {
    this.status = 'INITIALIZING';
    let db = null;
    if (this.shoppingListService.db && typeof this.shoppingListService.db._getDb === 'function') {
      db = await this.shoppingListService.db._getDb();
    }
    
    let state, saveCreds;
    
    if (db && typeof db.collection === 'function') {
      console.log('📦 [Auth] Using Firestore to save WhatsApp session');
      const auth = await useFirestoreAuthState(db, 'whatsapp_auth');
      state = auth.state;
      saveCreds = auth.saveCreds;
    } else {
      console.log('📁 [Auth] Using Local Files to save WhatsApp session');
      const auth = await useMultiFileAuthState('auth_info_baileys');
      state = auth.state;
      saveCreds = auth.saveCreds;
    }

    const logger = pino({ level: 'silent' });

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: this.showTerminalQr,
      logger
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        this.status = 'QR_READY';
        this.qrCode = qr;
        this.qrCodeDataURL = await qrcode.toDataURL(qr);
      }

      if (connection === 'close') {
        this.status = 'DISCONNECTED';
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('❌ [WhatsApp] Connection closed due to', lastDisconnect?.error?.message, ', reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          this.initialize();
        }
      } else if (connection === 'open') {
        this.status = 'READY';
        this.qrCode = null;
        this.qrCodeDataURL = null;
        console.log('✅ [WhatsApp] Connected successfully!');
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg || !msg.message) return;
      await this.handleIncomingMessage(msg);
    });
  }
}

export const whatsappClient = new WhatsAppClientWrapper();

const isMainModule = (metaUrl) => {
  if (!metaUrl || !process.argv || !process.argv[1]) return false;
  try {
    const currentFilePath = fileURLToPath(metaUrl);
    const executedPath = fs.realpathSync(process.argv[1]);
    return currentFilePath === executedPath;
  } catch (_) {
    return false;
  }
};

if (isMainModule(import.meta.url)) {
  const port = process.env.PORT || 3000;
  const app = createWebServer({ whatsappClient });
  
  app.listen(port, '0.0.0.0', () => {
    console.log(`🌐 [Web Server] Started on port ${port}`);
    app.startKeepAlive(port);
    whatsappClient.initialize().catch(err => {
      console.error('❌ Failed to start WhatsApp Client:', err);
    });
  });
}

