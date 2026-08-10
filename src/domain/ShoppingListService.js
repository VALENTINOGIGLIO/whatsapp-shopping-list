import { MockDatabaseAdapter } from '../db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../broadcaster/MockBroadcaster.js';
import { HabitTracker } from './HabitTracker.js';

export class ShoppingListService {
  constructor(dbAdapterOrOptions, broadcaster, habitTracker) {
    if (dbAdapterOrOptions && typeof dbAdapterOrOptions === 'object' && dbAdapterOrOptions.dbAdapter) {
      this.db = dbAdapterOrOptions.dbAdapter;
      this.broadcaster = dbAdapterOrOptions.broadcaster || null;
      this.habitTracker = dbAdapterOrOptions.habitTracker || null;
    } else {
      this.db = dbAdapterOrOptions || null;
      this.broadcaster = broadcaster || null;
      this.habitTracker = habitTracker || null;
    }

    if (!this.db) {
      this.db = new MockDatabaseAdapter();
    }
    if (!this.broadcaster) {
      this.broadcaster = new MockBroadcaster();
    }
    if (!this.habitTracker) {
      this.habitTracker = new HabitTracker(this.db);
    }
  }

  async addItem(chatId, itemName, storeName = null, sender = 'user1') {
    if (!chatId) throw new Error('chatId is required');
    if (!itemName || typeof itemName !== 'string' || itemName.trim() === '') {
      throw new Error('Item name cannot be empty');
    }

    const cleanItem = itemName.trim();
    let finalStore = storeName ? storeName.trim().toLowerCase() : null;
    let storeInferred = false;
    let habitUpdated = false;

    if (finalStore) {
      await this.habitTracker.trackPurchase(chatId, cleanItem, finalStore, this.db);
      habitUpdated = true;
    } else {
      const favoriteStore = await this.habitTracker.getFavoriteStore(chatId, cleanItem, this.db);
      if (favoriteStore) {
        finalStore = favoriteStore;
        storeInferred = true;
      }
    }

    const activeItems = await this.db.getActiveItems(chatId);
    const existingIndex = activeItems.findIndex(
      i => i.name.toLowerCase() === cleanItem.toLowerCase() || (i.canonicalName && i.canonicalName === cleanItem.toLowerCase())
    );

    let itemToSave;
    const nowIso = new Date().toISOString();

    if (existingIndex >= 0) {
      const existing = activeItems[existingIndex];
      itemToSave = {
        ...existing,
        name: cleanItem,
        canonicalName: cleanItem.toLowerCase(),
        store: finalStore || existing.store,
        storeInferred: storeName ? false : (finalStore ? storeInferred : (existing.storeInferred || false)),
        addedBy: sender || existing.addedBy,
        createdAt: nowIso
      };
    } else {
      itemToSave = {
        id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        name: cleanItem,
        canonicalName: cleanItem.toLowerCase(),
        store: finalStore,
        storeInferred: storeInferred,
        addedBy: sender || 'user1',
        createdAt: nowIso
      };
    }

    await this.db.saveActiveItem(chatId, itemToSave);

    return { item: itemToSave, habitUpdated };
  }

  async removeItem(chatId, itemName) {
    if (!chatId || !itemName) return false;
    return await this.db.deleteActiveItem(chatId, itemName);
  }

  async resetList(chatId, storeName = null, sender = 'user1') {
    if (!chatId) throw new Error('chatId is required');
    const activeItems = await this.db.getActiveItems(chatId);
    const itemsCleared = activeItems.length;
    const cleanStore = storeName ? storeName.trim().toLowerCase() : null;

    if (cleanStore && itemsCleared > 0) {
      for (const item of activeItems) {
        await this.habitTracker.trackPurchase(chatId, item.name, cleanStore, this.db);
      }
    }

    const nowIso = new Date().toISOString();
    const resetRecord = {
      id: `reset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      items: [...activeItems],
      store: cleanStore,
      storeName: cleanStore,
      resetBy: sender || 'user1',
      clearedBy: sender || 'user1',
      timestamp: nowIso,
      resetAt: nowIso,
      itemsCleared: itemsCleared
    };

    await this.db.savePurchaseHistory(chatId, resetRecord);
    await this.db.deleteActiveItems(chatId);

    const broadcastMsg = cleanStore
      ? `Spesa completata presso ${cleanStore.toUpperCase()}! La lista è stata svuotata (${itemsCleared} articoli).`
      : `Spesa completata! La lista è stata svuotata (${itemsCleared} articoli).`;

    if (this.broadcaster) {
      if (typeof this.broadcaster.broadcastReset === 'function') {
        await this.broadcaster.broadcastReset(resetRecord);
      } else if (typeof this.broadcaster.broadcast === 'function') {
        await this.broadcaster.broadcast(broadcastMsg);
      }
    }

    return { resetRecord, itemsCleared };
  }

  async getList(chatId) {
    if (!chatId) throw new Error('chatId is required');
    return await this.db.getActiveItems(chatId);
  }

  async markItemStatus(chatId, itemName, statusUpdates) {
    if (!chatId || !itemName) return false;
    const cleanItem = itemName.trim().toLowerCase();
    const items = await this.db.getActiveItems(chatId);
    const item = items.find(i => i.canonicalName === cleanItem || i.name.toLowerCase() === cleanItem);
    if (!item) return false;

    if (statusUpdates.isUrgent !== undefined) item.isUrgent = statusUpdates.isUrgent;
    if (statusUpdates.isChecked !== undefined) item.isChecked = statusUpdates.isChecked;
    
    await this.db.saveActiveItem(chatId, item);
    return true;
  }

  async getHabits(chatId, itemName = null) {
    if (!chatId) throw new Error('chatId is required');
    return await this.habitTracker.getHabits(chatId, itemName, this.db);
  }

  formatListForDisplay(items) {
    if (!items || items.length === 0) {
      return '🛒 La lista è vuota.';
    }

    const lines = [`🛒 *Lista della Spesa* (${items.length} articoli):`];
    items.forEach((item, index) => {
      let storeInfo = '';
      if (item.store) {
        storeInfo = item.storeInferred
          ? ` (${item.store} - abitudine)`
          : ` (${item.store})`;
      }
      
      let prefix = `${index + 1}.`;
      if (item.isChecked) prefix = '✅';
      else if (item.isUrgent) prefix = '🔴';

      const strike = item.isChecked ? '~' : '';
      lines.push(`${prefix} ${strike}${item.name}${strike}${storeInfo}`);
    });

    return lines.join('\n');
  }

  formatListGroupedByStore(items) {
    if (!items || items.length === 0) {
      return '🛒 La lista è vuota.';
    }

    const groups = {};
    const others = [];

    items.forEach(item => {
      if (item.store) {
        const storeName = item.store.toUpperCase();
        if (!groups[storeName]) groups[storeName] = [];
        groups[storeName].push(item);
      } else {
        others.push(item);
      }
    });

    const lines = [`🏪 *Lista per Supermercati* (${items.length} articoli):`, ''];

    for (const [store, storeItems] of Object.entries(groups)) {
      lines.push(`*${store}*`);
      storeItems.forEach(item => {
        let prefix = '•';
        if (item.isChecked) prefix = '✅';
        else if (item.isUrgent) prefix = '🔴';
        const strike = item.isChecked ? '~' : '';
        const inferred = item.storeInferred ? ' (abitudine)' : '';
        lines.push(`  ${prefix} ${strike}${item.name}${strike}${inferred}`);
      });
      lines.push('');
    }

    if (others.length > 0) {
      lines.push('*ALTRO*');
      others.forEach(item => {
        let prefix = '•';
        if (item.isChecked) prefix = '✅';
        else if (item.isUrgent) prefix = '🔴';
        const strike = item.isChecked ? '~' : '';
        lines.push(`  ${prefix} ${strike}${item.name}${strike}`);
      });
    }

    return lines.join('\n').trim();
  }
}
