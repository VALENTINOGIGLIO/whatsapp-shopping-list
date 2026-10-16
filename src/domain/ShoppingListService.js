import { MockDatabaseAdapter } from '../db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../broadcaster/MockBroadcaster.js';
import { HabitTracker } from './HabitTracker.js';

function isChatId(str) {
  if (typeof str !== 'string') return false;
  const s = str.trim().toLowerCase();
  return s.includes('@') || s.startsWith('chat_') || s.startsWith('group_') || s === 'family_chat' || s === 'default_chat';
}

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

  async addItem(arg1, arg2 = null, arg3 = null, arg4 = null) {
    let chatId = 'family_chat';
    let itemName = null;
    let storeName = null;
    let sender = 'user1';

    if (arg4 !== null && arg4 !== undefined) {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
      storeName = arg3 || null;
      sender = arg4 || 'user1';
    } else if (arg3 !== null && arg3 !== undefined) {
      if (isChatId(arg1)) {
        chatId = arg1;
        itemName = arg2;
        storeName = arg3 || null;
      } else {
        chatId = 'family_chat';
        itemName = arg1;
        storeName = arg2 || null;
        sender = arg3 || 'user1';
      }
    } else if (arg2 !== null && arg2 !== undefined) {
      if (isChatId(arg1)) {
        chatId = arg1;
        itemName = arg2;
      } else {
        chatId = 'family_chat';
        itemName = arg1;
        storeName = arg2 || null;
      }
    } else {
      chatId = 'family_chat';
      itemName = arg1;
    }

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

  async removeItem(arg1, arg2 = null) {
    let chatId = 'family_chat';
    let itemName = null;
    if (arg2 !== null && arg2 !== undefined) {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
    } else {
      chatId = 'family_chat';
      itemName = arg1;
    }
    if (!itemName) return false;
    return await this.db.deleteActiveItem(chatId, itemName);
  }

  async resetList(arg1 = null, arg2 = null, arg3 = null) {
    let chatId = 'family_chat';
    let storeName = null;
    let sender = 'user1';

    if (arg3 !== null && arg3 !== undefined) {
      chatId = arg1 || 'family_chat';
      storeName = arg2 || null;
      sender = arg3 || 'user1';
    } else if (arg2 !== null && arg2 !== undefined) {
      if (isChatId(arg1)) {
        chatId = arg1;
        storeName = arg2 || null;
      } else {
        chatId = 'family_chat';
        storeName = arg1 || null;
        sender = arg2 || 'user1';
      }
    } else if (arg1 !== null && arg1 !== undefined) {
      if (isChatId(arg1)) {
        chatId = arg1;
      } else {
        chatId = 'family_chat';
        storeName = arg1;
      }
    }

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

  async getList(arg1 = null) {
    const chatId = arg1 || 'family_chat';
    return await this.db.getActiveItems(chatId);
  }

  async markItemStatus(arg1, arg2, arg3 = null) {
    let chatId = 'family_chat';
    let itemName = null;
    let statusUpdates = null;

    if (arg3 !== null && arg3 !== undefined) {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
      statusUpdates = arg3;
    } else {
      chatId = 'family_chat';
      itemName = arg1;
      statusUpdates = arg2;
    }

    if (!itemName || !statusUpdates) return false;
    const cleanItem = itemName.trim().toLowerCase();
    const items = await this.db.getActiveItems(chatId);
    const item = items.find(i => i.canonicalName === cleanItem || i.name.toLowerCase() === cleanItem);
    if (!item) return false;

    if (statusUpdates.isUrgent !== undefined) item.isUrgent = statusUpdates.isUrgent;
    if (statusUpdates.isChecked !== undefined) item.isChecked = statusUpdates.isChecked;
    
    await this.db.saveActiveItem(chatId, item);
    return true;
  }

  async getHabits(arg1 = null, arg2 = null) {
    let chatId = 'family_chat';
    let itemName = null;

    if (arg2 !== null && arg2 !== undefined) {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
    } else if (arg1 !== null && arg1 !== undefined) {
      if (isChatId(arg1)) {
        chatId = arg1;
      } else {
        chatId = 'family_chat';
        itemName = arg1;
      }
    }

    return await this.habitTracker.getHabits(chatId, itemName, this.db);
  }

  formatListForDisplay(items) {
    if (!items || items.length === 0) {
      return '🛒 Shopping list is empty / La lista è vuota.';
    }

    const lines = [`🛒 *Shopping List / Lista della Spesa* (${items.length} articoli):`];
    items.forEach((item, index) => {
      let storeInfo = '';
      if (item.store) {
        storeInfo = item.storeInferred
          ? ` (${item.store} - favorite)`
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
      return '🛒 Shopping list is empty / La lista è vuota.';
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
        const inferred = item.storeInferred ? ' (favorite)' : '';
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

  async getChatSession(chatId) {
    if (this.db && typeof this.db.getChatSession === 'function') {
      return await this.db.getChatSession(chatId);
    }
    return null;
  }

  async setChatSession(chatId, active) {
    if (this.db && typeof this.db.saveChatSession === 'function') {
      return await this.db.saveChatSession(chatId, { active: Boolean(active), updatedAt: new Date().toISOString() });
    }
    return null;
  }

  async getActiveChatSessions() {
    if (this.db && typeof this.db.getActiveChatSessions === 'function') {
      return await this.db.getActiveChatSessions();
    }
    return [];
  }
}

