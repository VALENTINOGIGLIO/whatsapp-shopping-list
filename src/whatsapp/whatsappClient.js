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
    this.activeSessions = new Set();
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

      const lower = text.trim().toLowerCase();
      let response = '';

      try {
        if (lower === '/avvia') {
          this.activeSessions.add(remoteJid);
          response = '🟢 Modalità Spesa ATTIVATA in questa chat.\nOra tutto quello che scrivi verrà aggiunto direttamente alla lista! (Scrivi /ferma per disabilitare)';
        } else if (lower === '/ferma') {
          this.activeSessions.delete(remoteJid);
          response = '🔴 Modalità Spesa DISATTIVATA in questa chat.\nI messaggi normali verranno di nuovo ignorati.';
        } else if (this.activeSessions.has(remoteJid)) {
          // Modalità sessione attiva: prende ogni messaggio come comando o articolo
          if (lower === 'lista') {
            const items = await this.shoppingListService.getList();
            response = this.shoppingListService.formatListForDisplay(items);
          } else if (lower.startsWith('reset')) {
            const parts = lower.split(' ');
            parts.shift();
            const store = parts.join(' ').trim() || null;
            const result = await this.shoppingListService.resetList(store, remoteJid);
            response = `✅ Lista resettata. Svuotati ${result.itemsCleared} articoli.`;
          } else {
            // Aggiunta automatica dell'articolo
            const parts = lower.split(' ');
            const item = parts[0];
            parts.shift();
            const store = parts.join(' ').trim() || null;
            
            if (item) {
               const result = await this.shoppingListService.addItem(item, store, remoteJid);
               response = `✅ Aggiunto: ${item}${store ? ' (' + store + ')' : ''}`;
            }
          }
        } else {
          // Modalità classica: richiede il prefisso "!" per non intralciare la chat
          if (!lower.startsWith('!')) return;

          const commandText = lower.substring(1).trim();
          if (commandText === 'lista') {
            const items = await this.shoppingListService.getList();
            response = this.shoppingListService.formatListForDisplay(items);
          } else if (commandText.startsWith('reset')) {
            const parts = commandText.split(' ');
            parts.shift();
            const store = parts.join(' ').trim() || null;
            const result = await this.shoppingListService.resetList(store, remoteJid);
            response = `✅ Lista resettata. Svuotati ${result.itemsCleared} articoli.`;
          } else if (commandText.startsWith('aggiungi ') || commandText.startsWith('spesa ')) {
            const parts = commandText.split(' ');
            parts.shift();
            const item = parts[0];
            parts.shift();
            const store = parts.join(' ').trim() || null;
            
            if (!item) {
               response = '❌ Specifica cosa aggiungere (es. !spesa latte)';
            } else {
               const result = await this.shoppingListService.addItem(item, store, remoteJid);
               response = `✅ Aggiunto: ${item}${store ? ' (' + store + ')' : ''}`;
            }
          } else {
            response = '🤖 Comandi bot spesa:\n- /avvia (attiva l\'inserimento rapido)\n- !spesa [oggetto] [negozio]\n- !lista\n- !reset [negozio]';
          }
        }
      } catch (err) {
        console.error('Error processing message:', err);
        response = '❌ Errore durante l\'elaborazione del comando.';
      }
      
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

import { createWebServer } from '../web/server.js';
import { fileURLToPath } from 'url';
import fs from 'fs';

const isMainModule = (metaUrl) => {
  if (!metaUrl) return false;
  const currentFilePath = fileURLToPath(metaUrl);
  const executedPath = fs.realpathSync(process.argv[1]);
  return currentFilePath === executedPath;
};

if (isMainModule(import.meta.url)) {
  const port = process.env.PORT || 3000;
  const app = createWebServer({ whatsappClient });
  
  app.listen(port, () => {
    console.log(`🌐 [Web Server] Started on port ${port}`);
    whatsappClient.initialize().catch(err => {
      console.error('❌ Failed to start WhatsApp Client:', err);
    });
  });
}
