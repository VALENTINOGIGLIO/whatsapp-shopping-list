import { DatabaseAdapter } from './DatabaseAdapter.js';

export class MockDatabaseAdapter extends DatabaseAdapter {
  constructor(initialData = {}) {
    super();
    /** @type {Array<Object>} */
    this.activeItems = [];
    /** @type {Map<string, Object>} */
    this.habits = new Map();
    /** @type {Array<Object>} */
    this.purchaseHistory = [];

    if (initialData.activeItems) {
      this.activeItems = initialData.activeItems.map(item => ({ ...item }));
    }
    if (initialData.habits) {
      for (const habit of initialData.habits) {
        if (habit && habit.itemName) {
          const key = habit.itemName.trim().toLowerCase();
          this.habits.set(key, JSON.parse(JSON.stringify(habit)));
        }
      }
    }
    if (initialData.purchaseHistory) {
      this.purchaseHistory = JSON.parse(JSON.stringify(initialData.purchaseHistory));
    }
  }

  async getActiveItems() {
    return this.activeItems.map(item => ({ ...item }));
  }

  async saveActiveItem(item) {
    if (!item || !item.name) return;
    const cleanName = item.name.trim().toLowerCase();
    const existingIndex = this.activeItems.findIndex(
      i => (i.canonicalName && i.canonicalName === cleanName) || i.name.trim().toLowerCase() === cleanName
    );

    const cloned = JSON.parse(JSON.stringify(item));
    if (!cloned.canonicalName) {
      cloned.canonicalName = cleanName;
    }

    if (existingIndex >= 0) {
      this.activeItems[existingIndex] = {
        ...this.activeItems[existingIndex],
        ...cloned
      };
    } else {
      this.activeItems.push(cloned);
    }
  }

  async deleteActiveItems() {
    const count = this.activeItems.length;
    this.activeItems = [];
    return count;
  }

  async getHabit(itemName) {
    if (!itemName || typeof itemName !== 'string') return null;
    const key = itemName.trim().toLowerCase();
    const habit = this.habits.get(key);
    return habit ? JSON.parse(JSON.stringify(habit)) : null;
  }

  async saveHabit(habit) {
    if (!habit || !habit.itemName) return;
    const key = habit.itemName.trim().toLowerCase();
    const cloned = JSON.parse(JSON.stringify(habit));
    this.habits.set(key, cloned);
  }

  async savePurchaseHistory(record) {
    if (!record) return;
    this.purchaseHistory.push(JSON.parse(JSON.stringify(record)));
  }

  async getPurchaseHistory() {
    return JSON.parse(JSON.stringify(this.purchaseHistory));
  }

  async getAllHabits() {
    return Array.from(this.habits.values()).map(h => JSON.parse(JSON.stringify(h)));
  }

  async clearAllData() {
    this.activeItems = [];
    this.habits.clear();
    this.purchaseHistory = [];
  }

  clear() {
    this.activeItems = [];
    this.habits.clear();
    this.purchaseHistory = [];
  }
}
