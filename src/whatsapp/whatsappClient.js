import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import puppeteer from 'puppeteer';
import qrcodeTerminal from 'qrcode-terminal';
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
  /**
   * @param {Object} [options]
   * @param {import('../domain/ShoppingListService.js').ShoppingListService} [options.service]
   * @param {Object} [options.client] - Injected mock or client instance for testing
   * @param {string} [options.dataPath] - Path for LocalAuth session storage
   * @param {Object} [options.puppeteerOptions] - Puppeteer launch options
   * @param {boolean} [options.showTerminalQr] - Whether to output QR code ASCII to terminal
   * @param {boolean} [options.allowSelfMessages] - Whether to process messages sent by self
   */
  constructor(options = {}) {
    this.service = options.service || null;
    this.status = 'INITIALIZING';
    this.qrCode = null;
    this.pairingCode = null;
    this.lastQrTimestamp = null;
    this.lastTargetChatId = process.env.WHATSAPP_FAMILY_CHAT_ID || null;
    this.showTerminalQr = options.showTerminalQr !== undefined ? options.showTerminalQr : true;
    this.allowSelfMessages = options.allowSelfMessages || false;

    if (options.client) {
      this.client = options.client;
    } else {
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || (puppeteer.executablePath ? puppeteer.executablePath() : undefined);
      const puppeteerArgs = options.puppeteerOptions || options.puppeteer || {
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--no-first-run',
          '--no-zygote',
          '--single-process', // Extremely important for reducing memory footprint in Docker/Render
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-update',
          '--disable-default-apps',
          '--disable-domain-reliability',
          '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-notifications',
          '--disable-print-preview',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-sync',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-default-browser-check',
          '--no-pings',
          '--password-store=basic',
          '--use-mock-keychain'
        ]
      };

      this.client = new Client({
        authStrategy: new LocalAuth({ dataPath: options.dataPath || './.wwebjs_auth' }),
        puppeteer: puppeteerArgs,
        webVersionCache: {
          type: 'remote',
          remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
      });
    }

    this._setupListeners();
  }

  _setupListeners() {
    if (!this.client || typeof this.client.on !== 'function') return;

    this.client.on('qr', (qr) => {
      this.qrCode = qr;
      this.pairingCode = null; // Clear pairing code if QR is newly generated
      this.status = 'QR_READY';
      this.lastQrTimestamp = Date.now();
      if (this.showTerminalQr) {
        console.log('📱 [WhatsApp] New QR code generated. Scan in terminal or via /qr endpoint:');
        try {
          qrcodeTerminal.generate(qr, { small: true });
        } catch (err) {
          console.error('Error generating terminal QR:', err);
        }
      }
    });

    this.client.on('authenticated', () => {
      this.qrCode = null;
      this.pairingCode = null;
      this.status = 'AUTHENTICATED';
      console.log('🔒 [WhatsApp] Client authenticated successfully.');
    });

    this.client.on('ready', () => {
      this.qrCode = null;
      this.pairingCode = null;
      this.status = 'READY';
      console.log('🚀 [WhatsApp] Client is READY!');
    });

    this.client.on('auth_failure', (msg) => {
      this.status = 'AUTH_FAILURE';
      console.error('❌ [WhatsApp] Authentication failure:', msg);
    });

    this.client.on('disconnected', (reason) => {
      this.status = 'DISCONNECTED';
      this.qrCode = null;
      this.pairingCode = null;
      console.warn('⚠️ [WhatsApp] Client disconnected:', reason);
    });

    this.client.on('message', async (msg) => {
      await this.handleIncomingMessage(msg);
    });
  }

  async initialize() {
    if (this.client && typeof this.client.initialize === 'function') {
      return await this.client.initialize();
    }
  }

  async destroy() {
    if (this.client && typeof this.client.destroy === 'function') {
      return await this.client.destroy();
    }
  }

  getQrCode() {
    return this.qrCode;
  }

  getPairingCode() {
    return this.pairingCode;
  }

  async requestPairingCode(phoneNumber) {
    if (!this.client || typeof this.client.requestPairingCode !== 'function') {
      throw new Error('requestPairingCode is not supported by this client version');
    }
    
    // Request code from whatsapp-web.js
    const code = await this.client.requestPairingCode(phoneNumber);
    this.pairingCode = code;
    this.qrCode = null; // Prioritize showing pairing code
    return code;
  }

  getStatus() {
    return this.status;
  }

  isReady() {
    return this.status === 'READY';
  }

  getClient() {
    return this.client;
  }

  getLastTargetChatId() {
    return this.lastTargetChatId;
  }

  setTargetChatId(chatId) {
    this.lastTargetChatId = chatId;
  }

  /**
   * Routes incoming WhatsApp message to MessageParser and ShoppingListService
   * @param {Object} msg 
   * @returns {Promise<string|null>}
   */
  async handleIncomingMessage(msg) {
    if (!msg || typeof msg !== 'object') return null;
    if (msg.fromMe && !this.allowSelfMessages) return null;

    const text = msg.body;
    if (!text || typeof text !== 'string') return null;

    if (msg.from) {
      this.lastTargetChatId = msg.from;
    }

    const sender = msg._data?.notifyName ||
      (msg.author ? msg.author.split('@')[0] : (msg.from ? msg.from.split('@')[0] : 'user1')) ||
      'user1';

    const parsed = MessageParser.parse(text);

    if (!this.service) {
      console.warn('⚠️ [WhatsApp] ShoppingListService not attached to client wrapper.');
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

      if (typeof msg.reply === 'function') {
        await msg.reply(replyText);
      } else if (this.client && typeof this.client.sendMessage === 'function' && msg.from) {
        await this.client.sendMessage(msg.from, replyText);
      }
    } catch (err) {
      console.error('❌ [WhatsApp] Error processing message:', err);
      replyText = `⚠️ Si è verificato un errore: ${err.message || err}`;
      try {
        if (typeof msg.reply === 'function') {
          await msg.reply(replyText);
        } else if (this.client && typeof this.client.sendMessage === 'function' && msg.from) {
          await this.client.sendMessage(msg.from, replyText);
        }
      } catch (replyErr) {
        console.error('❌ [WhatsApp] Error sending error reply to user:', replyErr);
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
  broadcaster.client = clientWrapper.getClient();

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

