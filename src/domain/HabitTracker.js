function isChatId(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  return s.includes('@') || s.startsWith('chat_') || s.startsWith('group_') || s === 'family_chat' || s === 'default_chat';
}

export class HabitTracker {
  constructor(dbAdapter) {
    this.db = dbAdapter || null;
  }

  normalizeItemName(itemName) {
    if (!itemName || typeof itemName !== 'string') return '';
    return itemName.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  normalizeStoreName(storeName) {
    if (!storeName || typeof storeName !== 'string') return '';
    return storeName.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  calculateFavoriteStore(storeCounts) {
    if (!storeCounts || typeof storeCounts !== 'object') return null;
    const entries = Object.entries(storeCounts).filter(([_, count]) => typeof count === 'number' && count > 0);
    if (entries.length === 0) return null;

    entries.sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    });

    return entries[0][0];
  }

  async updateHabitsForBatch(arg1, arg2, arg3 = null, arg4 = null) {
    let db = this.db;
    let itemNames = [];
    let storeName = null;
    let chatId = 'family_chat';

    if (Array.isArray(arg1)) {
      itemNames = arg1;
      storeName = arg2;
      chatId = arg3 || 'family_chat';
      db = this.db;
    } else {
      db = arg1 || this.db;
      itemNames = Array.isArray(arg2) ? arg2 : [];
      storeName = arg3;
      chatId = arg4 || 'family_chat';
    }

    if (!storeName || !itemNames || itemNames.length === 0) return;

    for (const item of itemNames) {
      await this.trackPurchase(chatId, item, storeName, db);
    }
  }

  async trackPurchase(arg1, arg2, arg3 = null, arg4 = null) {
    let chatId = 'family_chat';
    let itemName = null;
    let storeName = null;
    let dbOverride = null;

    if (arg4 !== null && arg4 !== undefined) {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
      storeName = arg3;
      dbOverride = arg4;
    } else if (arg3 !== null && arg3 !== undefined) {
      if (typeof arg3 === 'object' && arg3 !== null && (typeof arg3.getHabit === 'function' || typeof arg3.saveHabit === 'function')) {
        chatId = 'family_chat';
        itemName = arg1;
        storeName = arg2;
        dbOverride = arg3;
      } else if (isChatId(arg1)) {
        chatId = arg1;
        itemName = arg2;
        storeName = arg3;
      } else {
        chatId = 'family_chat';
        itemName = arg1;
        storeName = arg2;
      }
    } else if (arg2 !== null && arg2 !== undefined) {
      chatId = 'family_chat';
      itemName = arg1;
      storeName = arg2;
    }

    if (!itemName || !storeName) return null;
    const db = dbOverride || this.db;
    if (!db) throw new Error('Database adapter not available');

    const cleanItem = this.normalizeItemName(itemName);
    const cleanStore = this.normalizeStoreName(storeName);
    if (!cleanItem || !cleanStore) return null;

    const existingHabit = await db.getHabit(chatId, cleanItem);
    
    let stores = {};
    if (existingHabit) {
      if (existingHabit.stores && typeof existingHabit.stores === 'object') {
        stores = { ...existingHabit.stores };
      } else if (existingHabit.storeHistory && typeof existingHabit.storeHistory === 'object') {
        stores = { ...existingHabit.storeHistory };
      }
    }

    stores[cleanStore] = (stores[cleanStore] || 0) + 1;
    const favoriteStore = this.calculateFavoriteStore(stores);

    const habitToSave = {
      itemName: cleanItem,
      stores: stores,
      storeHistory: stores,
      favoriteStore: favoriteStore,
      lastUpdated: new Date().toISOString()
    };

    await db.saveHabit(chatId, habitToSave);
    return habitToSave;
  }

  async getFavoriteStore(arg1, arg2 = null, arg3 = null) {
    let chatId = 'family_chat';
    let itemName = null;
    let dbOverride = null;

    if (arg3 !== null && arg3 !== undefined) {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
      dbOverride = arg3;
    } else if (arg2 !== null && arg2 !== undefined) {
      if (typeof arg2 === 'object' && arg2 !== null && typeof arg2.getHabit === 'function') {
        chatId = 'family_chat';
        itemName = arg1;
        dbOverride = arg2;
      } else if (isChatId(arg1)) {
        chatId = arg1;
        itemName = arg2;
      } else {
        chatId = 'family_chat';
        itemName = arg1;
      }
    } else if (arg1 !== null && arg1 !== undefined) {
      chatId = 'family_chat';
      itemName = arg1;
    }

    if (!itemName) return null;
    const db = dbOverride || this.db;
    if (!db) throw new Error('Database adapter not available');

    const cleanItem = this.normalizeItemName(itemName);
    const habit = await db.getHabit(chatId, cleanItem);

    if (habit && habit.favoriteStore) {
      return habit.favoriteStore;
    }
    return null;
  }

  async getHabits(arg1 = null, arg2 = null, arg3 = null) {
    let chatId = 'family_chat';
    let itemName = null;
    let dbOverride = null;

    if (arg3 !== null && arg3 !== undefined) {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
      dbOverride = arg3;
    } else if (arg2 !== null && arg2 !== undefined) {
      if (typeof arg2 === 'object' && arg2 !== null && typeof arg2.getHabit === 'function') {
        chatId = 'family_chat';
        itemName = arg1;
        dbOverride = arg2;
      } else {
        chatId = arg1 || 'family_chat';
        itemName = arg2;
      }
    } else if (arg1 !== null && arg1 !== undefined) {
      if (typeof arg1 === 'object' && arg1 !== null && typeof arg1.getHabit === 'function') {
        chatId = 'family_chat';
        dbOverride = arg1;
      } else if (isChatId(arg1)) {
        chatId = arg1;
      } else {
        chatId = 'family_chat';
        itemName = arg1;
      }
    }

    const db = dbOverride || this.db;
    if (!db) throw new Error('Database adapter not available');

    if (itemName) {
      const cleanItem = this.normalizeItemName(itemName);
      const habit = await db.getHabit(chatId, cleanItem);
      return habit ? [habit] : [];
    } else {
      return await db.getAllHabits(chatId);
    }
  }
}

