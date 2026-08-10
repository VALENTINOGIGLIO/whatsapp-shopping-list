/**
 * Abstract Base Database Adapter Interface
 */
export class DatabaseAdapter {
  /**
   * Retrieves all active shopping list items.
   * @returns {Promise<Array<Object>>}
   */
  async getActiveItems() {
    throw new Error('DatabaseAdapter.getActiveItems() must be implemented by subclass.');
  }

  /**
   * Saves or updates an active shopping list item.
   * @param {Object} item
   * @returns {Promise<void>}
   */
  async saveActiveItem(item) {
    throw new Error('DatabaseAdapter.saveActiveItem() must be implemented by subclass.');
  }

  /**
   * Clears all active shopping list items.
   * @returns {Promise<number>} Number of items deleted.
   */
  async deleteActiveItems() {
    throw new Error('DatabaseAdapter.deleteActiveItems() must be implemented by subclass.');
  }

  /**
   * Retrieves habit tracking record for a specific item name.
   * @param {string} itemName
   * @returns {Promise<Object|null>}
   */
  async getHabit(itemName) {
    throw new Error('DatabaseAdapter.getHabit() must be implemented by subclass.');
  }

  /**
   * Saves or updates a habit record.
   * @param {Object} habit
   * @returns {Promise<void>}
   */
  async saveHabit(habit) {
    throw new Error('DatabaseAdapter.saveHabit() must be implemented by subclass.');
  }

  /**
   * Persists a purchase history journal record.
   * @param {Object} record
   * @returns {Promise<void>}
   */
  async savePurchaseHistory(record) {
    throw new Error('DatabaseAdapter.savePurchaseHistory() must be implemented by subclass.');
  }

  /**
   * Retrieves all recorded purchase history items.
   * @returns {Promise<Array<Object>>}
   */
  async getPurchaseHistory() {
    throw new Error('DatabaseAdapter.getPurchaseHistory() must be implemented by subclass.');
  }

  /**
   * Resets all database collections / data structures.
   * @returns {Promise<void>}
   */
  async clearAllData() {
    throw new Error('DatabaseAdapter.clearAllData() must be implemented by subclass.');
  }

  /**
   * Alias for clearAllData.
   * @returns {Promise<void>}
   */
  async clear() {
    return await this.clearAllData();
  }
}
