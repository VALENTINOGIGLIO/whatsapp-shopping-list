import { NotificationBroadcaster } from './NotificationBroadcaster.js';

export class MockBroadcaster extends NotificationBroadcaster {
  constructor() {
    super();
    /** @type {Array<Object>} */
    this.sentNotifications = [];
    /** @type {Array<Object>} */
    this.capturedNotifications = [];
    /** @type {Array<Function>} */
    this.listeners = [];
  }

  /**
   * Primary broadcast method (compatible with test_helper.js and tier tests).
   * @param {string} message 
   * @param {string} [recipient] 
   * @returns {Promise<Object>}
   */
  async broadcast(message, recipient = 'family_chat') {
    const timestamp = new Date().toISOString();
    const notification = {
      id: `mock_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      message,
      messageText: message,
      recipient,
      timestamp,
      recipientCount: 1
    };

    this.sentNotifications.push(notification);
    this.capturedNotifications.push(notification);
    this._notifyListeners(notification);

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
    const result = await this.broadcast(message, 'family_chat');
    result.type = 'RESET';
    result.payload = resetRecord;
    return result;
  }

  /**
   * Broadcast arbitrary text notification.
   * @param {string} messageText 
   * @param {Object} [options] 
   * @returns {Promise<Object>}
   */
  async broadcastNotification(messageText, options = {}) {
    const result = await this.broadcast(messageText, options.recipient || 'family_chat');
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
    const result = await this.broadcast(message, 'family_chat');
    result.type = 'ITEM_ADDED';
    result.payload = item;
    return result;
  }

  /**
   * Returns list of sent notifications.
   * @returns {Array<Object>}
   */
  getSentNotifications() {
    return [...this.sentNotifications];
  }

  /**
   * Clears sent notifications history.
   */
  clearNotifications() {
    this.sentNotifications = [];
    this.capturedNotifications = [];
  }

  /**
   * Returns captured notifications log.
   * @returns {Array<Object>}
   */
  getCapturedNotifications() {
    return [...this.capturedNotifications];
  }

  /**
   * Returns the most recent notification entry.
   * @returns {Object|null}
   */
  getLastNotification() {
    if (this.sentNotifications.length === 0) return null;
    return this.sentNotifications[this.sentNotifications.length - 1];
  }

  /**
   * Filters captured notifications by type.
   * @param {string} type 
   * @returns {Array<Object>}
   */
  getNotificationsByType(type) {
    return this.capturedNotifications.filter(n => n.type === type);
  }

  /**
   * Registers a real-time listener callback.
   * @param {Function} callback 
   * @returns {Function} Unsubscribe function
   */
  onBroadcast(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Clears all notifications and listeners.
   */
  clear() {
    this.sentNotifications = [];
    this.capturedNotifications = [];
    this.listeners = [];
  }

  _notifyListeners(entry) {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (err) {
        console.error('Error in MockBroadcaster listener:', err);
      }
    }
  }
}
