export class HabitTracker {
  constructor(dbAdapter) {
    this.db = dbAdapter || null;
  }

  async trackPurchase(chatId, itemName, storeName, dbOverride = null) {
    if (!chatId || !itemName || !storeName) return;
    const db = dbOverride || this.db;
    if (!db) throw new Error('Database adapter not available');

    const cleanItem = itemName.trim().toLowerCase();
    const cleanStore = storeName.trim().toLowerCase();

    const existingHabit = await db.getHabit(chatId, cleanItem);
    
    let storeHistory = {};
    if (existingHabit && existingHabit.storeHistory) {
      storeHistory = { ...existingHabit.storeHistory };
    }

    if (!storeHistory[cleanStore]) {
      storeHistory[cleanStore] = 0;
    }
    storeHistory[cleanStore] += 1;

    let favoriteStore = null;
    let maxCount = 0;
    for (const [store, count] of Object.entries(storeHistory)) {
      if (count > maxCount) {
        maxCount = count;
        favoriteStore = store;
      }
    }

    const habitToSave = {
      itemName: cleanItem,
      storeHistory: storeHistory,
      favoriteStore: favoriteStore,
      lastUpdated: new Date().toISOString()
    };

    await db.saveHabit(chatId, habitToSave);
  }

  async getFavoriteStore(chatId, itemName, dbOverride = null) {
    if (!chatId || !itemName) return null;
    const db = dbOverride || this.db;
    if (!db) throw new Error('Database adapter not available');

    const cleanItem = itemName.trim().toLowerCase();
    const habit = await db.getHabit(chatId, cleanItem);

    if (habit && habit.favoriteStore) {
      return habit.favoriteStore;
    }
    return null;
  }

  async getHabits(chatId, itemName = null, dbOverride = null) {
    if (!chatId) throw new Error('chatId is required');
    const db = dbOverride || this.db;
    if (!db) throw new Error('Database adapter not available');

    if (itemName) {
      const cleanItem = itemName.trim().toLowerCase();
      const habit = await db.getHabit(chatId, cleanItem);
      return habit ? [habit] : [];
    } else {
      return await db.getAllHabits(chatId);
    }
  }
}
