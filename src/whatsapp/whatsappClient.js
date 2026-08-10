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
      if (!msg.message) return;

      const remoteJid = msg.key.remoteJid;
      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

      if (!text) return;

      console.log(`[DEBUG] Received message: "${text}" from: ${remoteJid} (fromMe: ${msg.key.fromMe})`);

      // Il bot condivide l'account con l'utente (stesso numero).
      // Se il messaggio è stato inviato dal nostro numero (msg.key.fromMe),
      // dobbiamo capire se l'ha scritto l'utente dal telefono o se l'ha inviato il bot stesso.
      // Poiché tutti i messaggi del bot iniziano con un'emoji specifica, li ignoriamo se matchano.
      if (msg.key.fromMe && /^[✅❌🟢🔴🤖🛒]/.test(text)) {
        return;
      }

      const lower = text.trim().toLowerCase();
      let response = '';
      let reaction = '';

      try {
        if (lower === '/avvia') {
          this.activeSessions.add(remoteJid);
          response = '🟢 Modalità Spesa ATTIVATA in questa chat.\nOra tutto quello che scrivi verrà aggiunto direttamente alla lista! (Scrivi /ferma per disabilitare)';
        } else if (lower === '/ferma') {
          this.activeSessions.delete(remoteJid);
          response = '🔴 Modalità Spesa DISATTIVATA in questa chat.\nI messaggi normali verranno di nuovo ignorati.';
        } else {
          let isSessionActive = this.activeSessions.has(remoteJid);
          let commandText = lower;
          let usedDoubleExclamation = false;

          if (!isSessionActive) {
            if (lower.startsWith('!!')) {
              usedDoubleExclamation = true;
              commandText = lower.substring(2).trim();
            } else if (lower.startsWith('!')) {
              commandText = lower.substring(1).trim();
            } else {
              return;
            }
          }

          if (commandText === 'lista') {
            const items = await this.shoppingListService.getList(remoteJid);
            response = this.shoppingListService.formatListForDisplay(items);
          } else if (commandText === 'lista supermercati' || commandText === 'lista supermercato') {
            const items = await this.shoppingListService.getList(remoteJid);
            response = this.shoppingListService.formatListGroupedByStore(items);
          } else if (commandText.startsWith('reset')) {
            const store = commandText.replace(/^reset\s*/, '').trim() || null;
            const result = await this.shoppingListService.resetList(remoteJid, store, remoteJid);
            response = `✅ Lista resettata. Svuotati ${result.itemsCleared} articoli.`;
          } else if (commandText.startsWith('cancella ') || commandText.startsWith('cancella-')) {
            const item = commandText.replace(/^cancella[-\s]+/, '').trim();
            if (item) {
              const removed = await this.shoppingListService.removeItem(remoteJid, item);
              if (removed) reaction = '✅';
              else response = `❌ Articolo "${item}" non trovato nella lista.`;
            }
          } else if (commandText.startsWith('spunta ')) {
            const item = commandText.replace(/^spunta\s+/, '').trim();
            if (item) {
              const updated = await this.shoppingListService.markItemStatus(remoteJid, item, { isChecked: true });
              if (updated) reaction = '✅';
              else response = `❌ Articolo "${item}" non trovato nella lista.`;
            }
          } else if (commandText.startsWith('urgente ')) {
            const rawItem = commandText.replace(/^urgente\s+/, '').trim();
            if (rawItem) {
              // Try parsing " da " first so markItemStatus gets the correct name
              let itemName = rawItem;
              let store = null;
              const daIndex = rawItem.lastIndexOf(' da ');
              if (daIndex !== -1) {
                itemName = rawItem.substring(0, daIndex).trim();
                store = rawItem.substring(daIndex + 4).trim();
              }

              const updated = await this.shoppingListService.markItemStatus(remoteJid, itemName, { isUrgent: true });
              if (updated) {
                // If it already existed but store was provided, let's update the store/habit via addItem
                if (store) {
                  await this.shoppingListService.addItem(remoteJid, itemName, store, remoteJid);
                }
                reaction = '✅';
              } else {
                // Not found, add it now
                await this.shoppingListService.addItem(remoteJid, itemName, store, remoteJid);
                await this.shoppingListService.markItemStatus(remoteJid, itemName, { isUrgent: true });
                reaction = '✅';
              }
            }
          } else if (commandText === 'aiuto' || commandText === 'help') {
            response = '🤖 *Comandi Bot Spesa:*\n' +
                       '- `/avvia` / `/ferma` (attiva/disattiva inserimento rapido)\n' +
                       '- `[prodotto]` (aggiunge alla lista)\n' +
                       '- `[prodotto] da [supermercato]` (es. latte da eurospin)\n' +
                       '- `lista` (mostra la lista)\n' +
                       '- `lista supermercati` (mostra la lista divisa per negozi)\n' +
                       '- `cancella [prodotto]` (rimuove l\'articolo)\n' +
                       '- `spunta [prodotto]` (segna come preso)\n' +
                       '- `urgente [prodotto]` (segna come urgente 🔴)\n' +
                       '- `reset` o `reset [supermercato]` (svuota la lista)';
          } else {
            // Se in modalità sessione, trattiamo qualsiasi altra stringa come aggiunta articolo
            // Se in modalità classica, supportiamo !spesa e !aggiungi per retrocompatibilità
            let itemText = commandText;
            if (!isSessionActive && !usedDoubleExclamation) {
               if (commandText.startsWith('aggiungi ') || commandText.startsWith('spesa ')) {
                 itemText = commandText.replace(/^(aggiungi|spesa)\s+/, '').trim();
               } else {
                 response = '🤖 Comando non riconosciuto. Usa `!aiuto` per la lista dei comandi.';
                 itemText = '';
               }
            }
            
            if (itemText) {
              // Parse "item da store"
              let item = itemText;
              let store = null;
              const daIndex = itemText.lastIndexOf(' da ');
              if (daIndex !== -1) {
                item = itemText.substring(0, daIndex).trim();
                store = itemText.substring(daIndex + 4).trim();
              }
              
              if (item) {
                await this.shoppingListService.addItem(remoteJid, item, store, remoteJid);
                reaction = '✅';
              }
            }
          }
        }
      } catch (err) {
        console.error('Error processing message:', err);
        response = '❌ Errore durante l\'elaborazione del comando.';
      }
      
      if (response) {
        await this.sock.sendMessage(remoteJid, { text: response });
      }
      if (reaction) {
        await this.sock.sendMessage(remoteJid, { react: { text: reaction, key: msg.key } });
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
