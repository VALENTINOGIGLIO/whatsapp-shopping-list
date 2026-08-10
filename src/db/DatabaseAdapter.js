/**
 * Abstract Base Database Adapter Interface
 */
export class DatabaseAdapter {
  async getActiveItems(chatId) {
    throw new Error('DatabaseAdapter.getActiveItems() must be implemented by subclass.');
  }

  async saveActiveItem(chatId, item) {
    throw new Error('DatabaseAdapter.saveActiveItem() must be implemented by subclass.');
  }

  async deleteActiveItems(chatId) {
    throw new Error('DatabaseAdapter.deleteActiveItems() must be implemented by subclass.');
  }

  async deleteActiveItem(chatId, itemName) {
    throw new Error('DatabaseAdapter.deleteActiveItem() must be implemented by subclass.');
  }

  async getHabit(chatId, itemName) {
    throw new Error('DatabaseAdapter.getHabit() must be implemented by subclass.');
  }

  async saveHabit(chatId, habit) {
    throw new Error('DatabaseAdapter.saveHabit() must be implemented by subclass.');
  }

  async savePurchaseHistory(chatId, record) {
    throw new Error('DatabaseAdapter.savePurchaseHistory() must be implemented by subclass.');
  }

  async getPurchaseHistory(chatId) {
    throw new Error('DatabaseAdapter.getPurchaseHistory() must be implemented by subclass.');
  }

  async getAllHabits(chatId) {
    throw new Error('DatabaseAdapter.getAllHabits() must be implemented by subclass.');
  }

  async clearAllData(chatId) {
    throw new Error('DatabaseAdapter.clearAllData() must be implemented by subclass.');
  }

  async clear(chatId) {
    return await this.clearAllData(chatId);
  }
}
