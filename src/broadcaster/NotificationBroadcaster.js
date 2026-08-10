/**
 * Abstract Base Broadcaster Interface
 */
export class NotificationBroadcaster {
  /**
   * Broadcasts a notification message.
   * @param {string} message 
   * @param {string} [recipient] 
   * @returns {Promise<Object>}
   */
  async broadcast(message, recipient = 'family_chat') {
    throw new Error('NotificationBroadcaster.broadcast() must be implemented by subclass.');
  }

  /**
   * Broadcasts a reset notification event.
   * @param {Object} resetRecord 
   * @returns {Promise<Object>}
   */
  async broadcastReset(resetRecord) {
    throw new Error('NotificationBroadcaster.broadcastReset() must be implemented by subclass.');
  }

  /**
   * Broadcasts generic notification.
   * @param {string} messageText 
   * @param {Object} [options] 
   * @returns {Promise<Object>}
   */
  async broadcastNotification(messageText, options = {}) {
    throw new Error('NotificationBroadcaster.broadcastNotification() must be implemented by subclass.');
  }

  /**
   * Broadcasts item added notification.
   * @param {Object} item 
   * @returns {Promise<Object>}
   */
  async broadcastItemAdded(item) {
    throw new Error('NotificationBroadcaster.broadcastItemAdded() must be implemented by subclass.');
  }
}
