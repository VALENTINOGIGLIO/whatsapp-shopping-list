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

export function extractMessageText(msg) {
  if (!msg) return null;
  if (typeof msg.body === 'string' && msg.body.trim()) return msg.body;
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text;
  if (typeof msg.conversation === 'string' && msg.conversation.trim()) return msg.conversation;

  let m = msg.message;
  if (!m) return null;

  while (m) {
    if (m.ephemeralMessage?.message) {
      m = m.ephemeralMessage.message;
    } else if (m.viewOnceMessage?.message) {
      m = m.viewOnceMessage.message;
    } else if (m.viewOnceMessageV2?.message) {
      m = m.viewOnceMessageV2.message;
    } else if (m.viewOnceMessageV2Extension?.message) {
      m = m.viewOnceMessageV2Extension.message;
    } else if (m.documentWithCaptionMessage?.message) {
      m = m.documentWithCaptionMessage.message;
    } else if (m.protocolMessage?.editedMessage) {
      m = m.protocolMessage.editedMessage;
    } else if (m.editedMessage?.message) {
      m = m.editedMessage.message;
    } else if (m.message && typeof m.message === 'object') {
      m = m.message;
    } else {
      break;
    }
  }

  if (!m) return null;
  if (typeof m.conversation === 'string') return m.conversation;
  if (typeof m.extendedTextMessage?.text === 'string') return m.extendedTextMessage.text;
  if (typeof m.imageMessage?.caption === 'string') return m.imageMessage.caption;
  if (typeof m.videoMessage?.caption === 'string') return m.videoMessage.caption;
  if (typeof m.documentMessage?.caption === 'string') return m.documentMessage.caption;
  if (typeof m.buttonsResponseMessage?.selectedDisplayText === 'string') return m.buttonsResponseMessage.selectedDisplayText;
  if (typeof m.buttonsResponseMessage?.selectedButtonId === 'string') return m.buttonsResponseMessage.selectedButtonId;
  if (typeof m.templateButtonReplyMessage?.selectedDisplayText === 'string') return m.templateButtonReplyMessage.selectedDisplayText;
  if (typeof m.templateButtonReplyMessage?.selectedId === 'string') return m.templateButtonReplyMessage.selectedId;
  if (typeof m.listResponseMessage?.title === 'string') return m.listResponseMessage.title;
  if (typeof m.listResponseMessage?.singleSelectReply?.selectedRowId === 'string') return m.listResponseMessage.singleSelectReply.selectedRowId;
  if (typeof m.listResponseMessage?.singleSelectReply?.title === 'string') return m.listResponseMessage.singleSelectReply.title;
  if (typeof m.interactiveResponseMessage?.body?.text === 'string') return m.interactiveResponseMessage.body.text;
  if (typeof m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson === 'string') {
    try {
      const params = JSON.parse(m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
      if (params?.id) return params.id;
      if (params?.text) return params.text;
      if (params?.title) return params.title;
      if (params?.name) return params.name;
    } catch (_) {}
  }
  if (typeof m.interactiveMessage?.body?.text === 'string') return m.interactiveMessage.body.text;

  return null;
}

export class WhatsAppClientWrapper {
  constructor(options = {}) {
    this.status = 'INITIALIZING';
    this.qrCode = null;
    this.qrCodeDataURL = null;
    this.chatId = options.chatId || null;
    this.lastTargetChatId = options.defaultRecipient || 'family_chat';
    this.allowSelfMessages = options.allowSelfMessages !== undefined
      ? Boolean(options.allowSelfMessages)
      : (options.client ? false : true);
    this.defaultActive = options.defaultActive !== undefined
      ? Boolean(options.defaultActive)
      : (options.client ? true : false);
    this.showTerminalQr = options.showTerminalQr !== false;
    this.shoppingListService = options.service || options.shoppingListService || new ShoppingListService(new FirestoreAdapter());
    this.sock = null;
    this.client = options.client || null;
    this.activeSessions = new Set(options.activeSessions || []);

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
    return this.qrCodeDataURL || this.qrCode || null;
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

  async _sendReply(msg, from, response) {
    if (!response) return;
    const target = from || msg?.from || msg?.key?.remoteJid || this.lastTargetChatId || 'family_chat';
    try {
      if (typeof msg?.reply === 'function') {
        await msg.reply(response);
      } else if (this.client && typeof this.client.sendMessage === 'function') {
        await this.client.sendMessage(target, response);
      } else if (this.sock && typeof this.sock.sendMessage === 'function') {
        await this.sock.sendMessage(target, { text: response });
      }
    } catch (replyErr) {
      console.error('Error sending reply:', replyErr);
    }
  }

  async handleIncomingMessage(msg) {
    if (!msg || typeof msg !== 'object') return null;

    const fromMe = Boolean(msg.fromMe || msg.key?.fromMe);
    const text = extractMessageText(msg);
    if (!text || typeof text !== 'string' || text.trim() === '') return null;

    const from = msg.from || msg.key?.remoteJid || 'family_chat';
    if (from === 'status@broadcast' || from.endsWith('@broadcast')) {
      return null;
    }

    const senderName = msg._data?.notifyName || msg.pushName || msg.key?.participant || msg.participant || msg.sender || (fromMe ? 'Me' : from);

    this.lastTargetChatId = from;
    const targetChat = this.chatId || 'family_chat';

    if (fromMe && !this.allowSelfMessages) {
      return null;
    }

    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    // Prevent self-message loops from bot responses
    const isBotGenerated = /^[✅❌🟢🔴🤖🛒🏪📊]/u.test(trimmed) ||
      trimmed.startsWith('Spesa completata') ||
      trimmed.startsWith('Aggiunto alla lista') ||
      trimmed.startsWith('*Shopping List') ||
      trimmed.startsWith('*Lista per Supermercati*') ||
      trimmed.startsWith('Shopping list is empty');

    if (fromMe && isBotGenerated) {
      return null;
    }

    const normalizedCmd = lower.replace(/\s+/g, ' ');
    const isAvvia = [
      '/avvia', '!/avvia', '!avvia', '!!/avvia', '!!avvia', '! /avvia', '! avvia',
      '/start', '!start', '!/start', '!!start', '!!/start', '! /start', '! start'
    ].includes(normalizedCmd);

    const isFerma = [
      '/ferma', '!/ferma', '!ferma', '!!/ferma', '!!ferma', '! /ferma', '! ferma',
      '/stop', '!stop', '!/stop', '!!stop', '!!/stop', '! /stop', '! stop'
    ].includes(normalizedCmd);

    if (isAvvia) {
      this.activeSessions.add(from);
      const r = '🟢 Modalità Spesa ATTIVATA in questa chat.\nOra tutto quello che scrivi verrà aggiunto direttamente alla lista! (Scrivi /ferma per disabilitare)';
      await this._sendReply(msg, from, r);
      return r;
    } else if (isFerma) {
      this.activeSessions.delete(from);
      const r = '🔴 Modalità Spesa DISATTIVATA in questa chat.\nI messaggi normali verranno di nuovo ignorati.';
      await this._sendReply(msg, from, r);
      return r;
    }

    const isSessionActive = this.activeSessions.has(from) || Boolean(this.defaultActive);
    let commandText = text;
    let hasPrefix = false;

    if (lower.startsWith('!!')) {
      hasPrefix = true;
      commandText = text.substring(2).trim();
    } else if (lower.startsWith('!')) {
      hasPrefix = true;
      commandText = text.substring(1).trim();
    }

    let response = '';

    try {
      const parsed = MessageParser.parse(commandText);

      // If session is not active and no prefix was used, ignore normal add-item messages
      if (!isSessionActive && !hasPrefix && parsed.command === 'add') {
        return null;
      }

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
        const itemName = parsed.item || commandText.trim();
        const storeName = parsed.store || null;

        await this.shoppingListService.addItem(targetChat, itemName, storeName, senderName);
        if (typeof msg.react === 'function') {
          await msg.react('✅');
        } else if (this.sock && msg.key) {
          await this.sock.sendMessage(from, { react: { text: '✅', key: msg.key } });
        }
        response = null;
      }
    } catch (err) {
      console.error('Error processing message in handleIncomingMessage:', err);
      response = `❌ Si è verificato un errore: ${err.message || err}`;
    }

    if (response) {
      await this._sendReply(msg, from, response);
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
      if (!m || !m.messages || !Array.isArray(m.messages)) return;
      for (const msg of m.messages) {
        if (!msg || (!msg.message && !msg.body && !msg.text && !msg.conversation)) continue;
        try {
          await this.handleIncomingMessage(msg);
        } catch (err) {
          console.error('Error handling incoming message from upsert:', err);
        }
      }
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

