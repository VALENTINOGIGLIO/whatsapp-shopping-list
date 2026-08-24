import { NotificationBroadcaster } from './NotificationBroadcaster.js';

export class WhatsAppBroadcaster extends NotificationBroadcaster {
  /**
   * @param {Object} [clientWrapper] - WhatsAppClientWrapper instance or client object
   * @param {Object} [options]
   * @param {string} [options.defaultRecipient]
   */
  constructor(clientWrapper = null, options = {}) {
    super();
    this.clientWrapper = clientWrapper;
    this.defaultRecipient = options.defaultRecipient || process.env.WHATSAPP_FAMILY_CHAT_ID || null;
  }

  /**
   * Broadcasts a notification message.
   * @param {string} message 
   * @param {string} [recipient] 
   * @returns {Promise<Object>}
   */
  async broadcast(message, recipient) {
    let targetRecipient = recipient || this.defaultRecipient;
    if (!targetRecipient && this.clientWrapper && typeof this.clientWrapper.getLastTargetChatId === 'function') {
      targetRecipient = this.clientWrapper.getLastTargetChatId();
    }
    if (!targetRecipient) {
      targetRecipient = 'family_chat';
    }

    const timestamp = new Date().toISOString();
    const notification = {
      id: `wa_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      message,
      messageText: message,
      recipient: targetRecipient,
      timestamp,
      recipientCount: 1
    };

    let isReady = false;
    let client = null;

    if (this.clientWrapper) {
      if (typeof this.clientWrapper.getStatus === 'function') {
        isReady = this.clientWrapper.getStatus() === 'READY';
      } else if (typeof this.clientWrapper.isReady === 'function') {
        isReady = this.clientWrapper.isReady();
      } else if (this.clientWrapper.isReady === true) {
        isReady = true;
      } else if (typeof this.clientWrapper.sendMessage === 'function') {
        isReady = true;
      }

      if (typeof this.clientWrapper.getClient === 'function') {
        client = this.clientWrapper.getClient();
      } else {
        client = this.clientWrapper;
      }
    }

    if (isReady && (this.clientWrapper || client)) {
      try {
        if (this.clientWrapper && typeof this.clientWrapper.sendMessage === 'function') {
          await this.clientWrapper.sendMessage(targetRecipient, message);
        } else if (client && typeof client.sendMessage === 'function') {
          if (client.ev) {
            await client.sendMessage(targetRecipient, { text: message });
          } else {
            await client.sendMessage(targetRecipient, message);
          }
        }
      } catch (err) {
        console.error('❌ [WhatsAppBroadcaster] Failed to send message:', err);
      }
    } else {
      console.warn('⚠️ [WhatsAppBroadcaster] WhatsApp client is not READY. Broadcast logged:', message);
    }

    return notification;
  }

  /**
   * Broadcast reset notification.
   * @param {Object} resetRecord 
   * @returns {Promise<Object>}
   */
  async broadcastReset(resetRecord) {
    const store = resetRecord.store || resetRecord.storeName;
    const storeText = store ? ` presso ${store.toUpperCase()}` : '';
    const itemCount = resetRecord.itemsCleared !== undefined
      ? resetRecord.itemsCleared
      : (resetRecord.items ? resetRecord.items.length : 0);

    const message = `Spesa completata${storeText}! La lista è stata svuotata (${itemCount} articoli).`;
    const result = await this.broadcast(message);
    result.type = 'RESET';
    result.payload = resetRecord;
    return result;
  }

  /**
   * Broadcast generic notification.
   * @param {string} messageText 
   * @param {Object} [options] 
   * @returns {Promise<Object>}
   */
  async broadcastNotification(messageText, options = {}) {
    const result = await this.broadcast(messageText, options.recipient);
    result.type = 'GENERIC';
    result.payload = options;
    return result;
  }

  /**
   * Broadcast item added notification.
   * @param {Object} item 
   * @returns {Promise<Object>}
   */
  async broadcastItemAdded(item) {
    const storeText = item.store ? ` (${item.store})` : '';
    const message = `Aggiunto alla lista: ${item.name}${storeText}`;
    const result = await this.broadcast(message);
    result.type = 'ITEM_ADDED';
    result.payload = item;
    return result;
  }
}
