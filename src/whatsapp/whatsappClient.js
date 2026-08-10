import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import { ShoppingListService } from '../domain/ShoppingListService.js';
import { FirestoreAdapter } from '../db/FirestoreAdapter.js';
import { useFirestoreAuthState } from './FirestoreAuthState.js';
import qrcode from 'qrcode';

export class WhatsAppClientWrapper {
  constructor() {
    const dbAdapter = new FirestoreAdapter();
    this.shoppingListService = new ShoppingListService(dbAdapter);
    this.sock = null;
    this.qrCodeDataURL = null;
  }

  async initialize() {
    // Extract the internal firestore instance to pass to the adapter
    const db = await this.shoppingListService.db._getDb();
    
    let state, saveCreds;
    
    // Fallback to local files if mock DB or something went wrong
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
      printQRInTerminal: true,
      logger
    });

    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        this.qrCodeDataURL = await qrcode.toDataURL(qr);
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('❌ [WhatsApp] Connection closed due to', lastDisconnect.error?.message, ', reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          this.initialize();
        }
      } else if (connection === 'open') {
        console.log('✅ [WhatsApp] Connected successfully!');
        this.qrCodeDataURL = null;
      }
    });

    this.sock.ev.on('messages.upsert', async (m) => {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

      if (!text) return;

      const response = await this.shoppingListService.processMessage(text, remoteJid);
      
      if (response) {
        await this.sock.sendMessage(remoteJid, { text: response });
      }
    });
  }

  getQrCode() {
    return this.qrCodeDataURL;
  }
}

export const whatsappClient = new WhatsAppClientWrapper();
