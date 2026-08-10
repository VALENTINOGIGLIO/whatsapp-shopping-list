import { DatabaseAdapter } from './DatabaseAdapter.js';

export class MockDatabaseAdapter extends DatabaseAdapter {
  constructor(initialData = {}) {
    super();
    this.activeItems = {}; // { chatId: [] }
    this.habits = {}; // { chatId: Map }
    this.history = {}; // { chatId: [] }

    // initialData ignoring for now as it's legacy non-chatId based,
    // or we could adapt it if needed, but for mock it's fine.
  }

  _getChatItems(chatId) {
    if (!this.activeItems[chatId]) this.activeItems[chatId] = [];
    return this.activeItems[chatId];
  }

  _getChatHabits(chatId) {
    if (!this.habits[chatId]) this.habits[chatId] = new Map();
    return this.habits[chatId];
  }

  _getChatHistory(chatId) {
    if (!this.history[chatId]) this.history[chatId] = [];
    return this.history[chatId];
  }

  async getActiveItems(chatId) {
    if (!chatId) return [];
    return [...this._getChatItems(chatId)];
  }

  async saveActiveItem(chatId, item) {
    if (!chatId || !item || !item.name) return;
    const items = this._getChatItems(chatId);
    const key = (item.canonicalName || item.name).trim().toLowerCase();
    const existingIndex = items.findIndex(i => (i.canonicalName || i.name.toLowerCase()) === key);
    
    if (existingIndex >= 0) {
      items[existingIndex] = { ...items[existingIndex], ...item, canonicalName: key };
    } else {
      items.push({ ...item, canonicalName: key });
    }
  }

  async deleteActiveItems(chatId) {
    if (!chatId) return 0;
    const items = this._getChatItems(chatId);
    const count = items.length;
    this.activeItems[chatId] = [];
    return count;
  }

  async deleteActiveItem(chatId, itemName) {
    if (!chatId || !itemName) return false;
    const key = itemName.trim().toLowerCase();
    const items = this._getChatItems(chatId);
    const initialLength = items.length;
    this.activeItems[chatId] = items.filter(i => (i.canonicalName !== key && i.name.toLowerCase() !== key));
    return this.activeItems[chatId].length < initialLength;
  }

  async getHabit(chatId, itemName) {
    if (!chatId || !itemName || typeof itemName !== 'string') return null;
    const key = itemName.trim().toLowerCase();
    const habits = this._getChatHabits(chatId);
    return habits.get(key) || null;
  }

  async saveHabit(chatId, habit) {
    if (!chatId || !habit || !habit.itemName) return;
    const key = habit.itemName.trim().toLowerCase();
    const habits = this._getChatHabits(chatId);
    const existing = habits.get(key) || {};
    habits.set(key, { ...existing, ...habit });
  }

  async savePurchaseHistory(chatId, record) {
    if (!chatId || !record) return;
    const history = this._getChatHistory(chatId);
    history.push(record);
  }

  async getPurchaseHistory(chatId) {
    if (!chatId) return [];
    return [...this._getChatHistory(chatId)];
  }

  async getAllHabits(chatId) {
    if (!chatId) return [];
    const habits = this._getChatHabits(chatId);
    return Array.from(habits.values());
  }

  async clearAllData(chatId) {
    if (chatId) {
      this.activeItems[chatId] = [];
      this.habits[chatId] = new Map();
      this.history[chatId] = [];
    } else {
      this.activeItems = {};
      this.habits = {};
      this.history = {};
    }
  }
}
