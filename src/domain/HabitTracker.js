/**
 * Tracks store purchase frequency for items and calculates favorite store preferences.
 */
export class HabitTracker {
  /**
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter} [dbAdapter]
   */
  constructor(dbAdapter = null) {
    this.db = dbAdapter;
  }

  /**
   * Normalizes item name for canonical database keys.
   * @param {string} itemName 
   * @returns {string}
   */
  normalizeItemName(itemName) {
    if (!itemName || typeof itemName !== 'string') return '';
    return itemName.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Normalizes store name.
   * @param {string} storeName 
   * @returns {string}
   */
  normalizeStoreName(storeName) {
    if (!storeName || typeof storeName !== 'string') return '';
    return storeName.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Calculates favorite store with deterministic tie-breaking (alphabetical).
   * @param {Record<string, number>} storeCounts 
   * @returns {string|null}
   */
  calculateFavoriteStore(storeCounts) {
    if (!storeCounts || Object.keys(storeCounts).length === 0) return null;

    let maxCount = -1;
    let favorite = null;

    // Alphabetical sort for deterministic tie-breaking
    const sortedStores = Object.keys(storeCounts).sort();

    for (const store of sortedStores) {
      const count = storeCounts[store];
      if (count > maxCount) {
        maxCount = count;
        favorite = store;
      }
    }

    return favorite;
  }

  /**
   * Tracks a purchase event for an item at a specific store.
   * Updates habit statistics in database.
   * @param {string} itemName 
   * @param {string} storeName 
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter} [dbOverride]
   * @returns {Promise<Object|null>}
   */
  async trackPurchase(itemName, storeName, dbOverride = null) {
    const targetDb = dbOverride || this.db;
    if (!itemName || !storeName) return null;

    const cleanItem = this.normalizeItemName(itemName);
    const cleanStore = this.normalizeStoreName(storeName);
    if (!cleanItem || !cleanStore) return null;

    let habit = targetDb ? await targetDb.getHabit(cleanItem) : null;
    const storeCounts = habit && (habit.stores || habit.storeCounts)
      ? { ...(habit.stores || habit.storeCounts) }
      : {};

    storeCounts[cleanStore] = (storeCounts[cleanStore] || 0) + 1;

    const favoriteStore = this.calculateFavoriteStore(storeCounts);
    const nowIso = new Date().toISOString();

    const updatedHabit = {
      id: cleanItem,
      itemName: cleanItem,
      stores: storeCounts,
      storeCounts: storeCounts,
      favoriteStore: favoriteStore,
      totalPurchases: Object.values(storeCounts).reduce((sum, count) => sum + count, 0),
      lastUpdated: nowIso,
      updatedAt: nowIso
    };

    if (targetDb) {
      await targetDb.saveHabit(updatedHabit);
    }

    return updatedHabit;
  }

  /**
   * Alias for trackPurchase to match Explorer specification.
   */
  async updateHabitForItem(dbAdapter, itemName, storeName) {
    return await this.trackPurchase(itemName, storeName, dbAdapter);
  }

  /**
   * Batch updates habits for a list of items (e.g. during reset with store).
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter|string[]} dbOrItems 
   * @param {string[]|string} itemsOrStore 
   * @param {string} [storeIfDbFirst] 
   * @returns {Promise<Array<Object>>}
   */
  async updateHabitsForBatch(dbOrItems, itemsOrStore, storeIfDbFirst = null) {
    let targetDb, itemNames, storeName;

    if (Array.isArray(dbOrItems)) {
      targetDb = this.db;
      itemNames = dbOrItems;
      storeName = itemsOrStore;
    } else {
      targetDb = dbOrItems || this.db;
      itemNames = itemsOrStore;
      storeName = storeIfDbFirst;
    }

    if (!itemNames || !Array.isArray(itemNames) || itemNames.length === 0 || !storeName) {
      return [];
    }

    const updated = [];
    for (const item of itemNames) {
      const h = await this.trackPurchase(item, storeName, targetDb);
      if (h) updated.push(h);
    }
    return updated;
  }

  /**
   * Gets favorite store for a given item name.
   * @param {string} itemName 
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter} [dbOverride]
   * @returns {Promise<string|null>}
   */
  async getFavoriteStore(itemName, dbOverride = null) {
    const targetDb = dbOverride || this.db;
    if (!itemName) return null;

    const cleanItem = this.normalizeItemName(itemName);
    if (!cleanItem || !targetDb) return null;

    const habit = await targetDb.getHabit(cleanItem);
    return habit ? habit.favoriteStore || null : null;
  }

  /**
   * Alias for getFavoriteStore.
   */
  async getFavoriteStoreForItem(dbAdapter, itemName) {
    return await this.getFavoriteStore(itemName, dbAdapter);
  }

  /**
   * Retrieves habit records for a specific item or all items.
   * @param {string|null} [itemName] 
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter} [dbOverride]
   * @returns {Promise<Array<Object>>}
   */
  async getHabits(itemName = null, dbOverride = null) {
    const targetDb = dbOverride || this.db;
    if (!targetDb) return [];

    if (itemName && typeof itemName === 'string' && itemName.trim()) {
      const cleanItem = this.normalizeItemName(itemName);
      const habit = await targetDb.getHabit(cleanItem);
      return habit ? [habit] : [];
    }

    if (typeof targetDb.getAllHabits === 'function') {
      return await targetDb.getAllHabits();
    }

    if (targetDb.habits && typeof targetDb.habits.values === 'function') {
      return Array.from(targetDb.habits.values()).map(h => JSON.parse(JSON.stringify(h)));
    }

    return [];
  }
}
