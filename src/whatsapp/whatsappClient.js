import { MessageParser } from '../domain/MessageParser.js';
import { CommandType } from '../domain/CommandType.js';
import { startWebServer } from '../web/server.js';
import { FirestoreAdapter } from '../db/FirestoreAdapter.js';
import { MockDatabaseAdapter } from '../db/MockDatabaseAdapter.js';
import { HabitTracker } from '../domain/HabitTracker.js';
import { ShoppingListService } from '../domain/ShoppingListService.js';
import { WhatsAppBroadcaster } from '../broadcaster/WhatsAppBroadcaster.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export class WhatsAppClientWrapper {
  constructor(options = {}) {
    this.service = options.service || null;
    this.token = process.env.WHATSAPP_TOKEN || null;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || null;
    this.verifyToken = process.env.WEBHOOK_VERIFY_TOKEN || 'shopping-list-secret';
    this.lastTargetChatId = process.env.WHATSAPP_FAMILY_CHAT_ID || null;
    this.allowSelfMessages = options.allowSelfMessages || false;
  }

  async initialize() {
    if (!this.token || !this.phoneNumberId) {
      console.warn('⚠️ [Meta API] Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in environment.');
    } else {
      console.log('🚀 [Meta API] Client is configured and READY!');
    }
  }

  async destroy() {
    // No persistent connection to close
  }

  getQrCode() {
    return null; // Not applicable for Meta API
  }

  getPairingCode() {
    return null; // Not applicable for Meta API
  }

  async requestPairingCode() {
    throw new Error('Pairing code not applicable for Meta API');
  }

  getStatus() {
    if (!this.token || !this.phoneNumberId) {
      return 'MISSING_CONFIG';
    }
    return 'READY';
  }

  isReady() {
    return this.getStatus() === 'READY';
  }

  getClient() {
    return this; // Return self to simulate client
  }

  getLastTargetChatId() {
    return this.lastTargetChatId;
  }

  setTargetChatId(chatId) {
    this.lastTargetChatId = chatId;
  }

  async sendMessage(to, text) {
    if (!this.token || !this.phoneNumberId) {
      console.error('❌ [Meta API] Cannot send message: Missing configuration.');
      return;
    }

    try {
      const response = await fetch(`https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: text }
        })
      });

      if (!response.ok) {
        const errData = await response.text();
        console.error('❌ [Meta API] Send message failed:', response.status, errData);
      }
    } catch (err) {
      console.error('❌ [Meta API] Error sending message:', err);
    }
  }

  async handleIncomingWebhook(body) {
    if (!body.entry || !body.entry[0] || !body.entry[0].changes || !body.entry[0].changes[0].value.messages) {
      return; // Not a message event
    }

    const messagePayload = body.entry[0].changes[0].value.messages[0];
    const contactPayload = body.entry[0].changes[0].value.contacts?.[0];
    
    if (messagePayload.type !== 'text') return; // We only handle text for now

    const from = messagePayload.from; // Phone number
    const text = messagePayload.text.body;
    const sender = contactPayload?.profile?.name || from || 'user1';

    if (from) {
      this.lastTargetChatId = from;
    }

    const parsed = MessageParser.parse(text);

    if (!this.service) {
      console.warn('⚠️ [Meta API] ShoppingListService not attached.');
      return;
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
        await this.sendMessage(from, replyText);
      }
    } catch (err) {
      console.error('❌ [Meta API] Error processing message:', err);
      replyText = `⚠️ Si è verificato un errore: ${err.message || err}`;
      if (from) {
        await this.sendMessage(from, replyText);
      }
    }
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
  
  // Custom patch for broadcaster to work with Meta API
  broadcaster.client = {
    sendMessage: async (chatId, message) => {
      await clientWrapper.sendMessage(chatId, message);
    }
  };

  const port = process.env.PORT || 3000;
  startWebServer({ port, whatsappClient: clientWrapper }).then(() => {
    console.log(`🌐 [Web Server] Started on port ${port}`);
    return clientWrapper.initialize();
  }).catch((err) => {
    console.error('❌ Failed to start application:', err);
    process.exit(1);
  });
}
