import { MockDatabaseAdapter } from '../db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../broadcaster/MockBroadcaster.js';
import { HabitTracker } from './HabitTracker.js';
import { normalizeForComparison, parseNumericIndices } from './normalize.js';

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
    let query = null;

    if (arg2 !== null && arg2 !== undefined) {
      chatId = arg1 || 'family_chat';
      query = arg2;
    } else {
      if (isChatId(arg1)) {
        chatId = arg1;
        query = null;
      } else {
        chatId = 'family_chat';
        query = arg1;
      }
    }

    if (query === null || query === undefined || (typeof query === 'string' && query.trim() === '')) {
      return { success: false, reason: 'EMPTY_QUERY' };
    }

    const activeItems = await this.db.getActiveItems(chatId);
    if (!activeItems || activeItems.length === 0) {
      return { success: false, reason: 'NOT_FOUND' };
    }

    const queryString = typeof query === 'string' ? query.trim() : String(query).trim();

    // 1. Check if query is numeric indices (supports "1", "1,2,3", "1 2 3", "1/2/3", "1;3;4", "1-3", etc.)
    const numericIndices = typeof query === 'number' && Number.isInteger(query)
      ? [query]
      : parseNumericIndices(queryString);

    let itemsToRemove = [];
    let invalidIndices = [];

    if (numericIndices.length > 0) {
      // Resolve items by 1-based index on activeItems snapshot BEFORE deletion
      for (const idx of numericIndices) {
        if (idx >= 1 && idx <= activeItems.length) {
          const item = activeItems[idx - 1];
          if (!itemsToRemove.some(it => it.id === item.id && it.name === item.name)) {
            itemsToRemove.push(item);
          }
        } else {
          invalidIndices.push(idx);
        }
      }

      if (itemsToRemove.length === 0) {
        return { success: false, reason: 'INVALID_INDEX', invalidIndices };
      }
    } else {
      // 2. Query is product name(s)
      // Check if multiple names separated by [,;/|]
      const nameTokens = queryString.includes(',') || queryString.includes(';') || queryString.includes('/') || queryString.includes('|')
        ? queryString.split(/[,;/|]+/).map(s => s.trim()).filter(Boolean)
        : [queryString];

      for (const token of nameTokens) {
        const normToken = normalizeForComparison(token);
        const lowerToken = token.toLowerCase();

        const match = activeItems.find(item => {
          if (!item) return false;
          if (itemsToRemove.some(it => it.id === item.id)) return false;
          if (item.id && item.id === token) return true;
          if (item.name && item.name.toLowerCase() === lowerToken) return true;
          if (item.canonicalName && item.canonicalName.toLowerCase() === lowerToken) return true;
          if (normToken && item.name && normalizeForComparison(item.name) === normToken) return true;
          if (normToken && item.canonicalName && normalizeForComparison(item.canonicalName) === normToken) return true;
          return false;
        });

        if (match) {
          itemsToRemove.push(match);
        }
      }

      if (itemsToRemove.length === 0) {
        return { success: false, reason: 'NOT_FOUND' };
      }
    }

    // Perform deletion of all resolved items on DB adapter
    if (this.db && typeof this.db.deleteActiveItem === 'function') {
      for (const itemToRemove of itemsToRemove) {
        let deleted = false;
        if (itemToRemove.id) {
          deleted = await this.db.deleteActiveItem(chatId, itemToRemove.id);
        }
        if (!deleted && itemToRemove.name) {
          deleted = await this.db.deleteActiveItem(chatId, itemToRemove.name);
        }
        if (!deleted && itemToRemove.canonicalName) {
          await this.db.deleteActiveItem(chatId, itemToRemove.canonicalName);
        }
      }
    }

    return {
      success: true,
      removedItem: itemsToRemove[0],
      removedItems: itemsToRemove,
      invalidIndices: invalidIndices.length > 0 ? invalidIndices : undefined
    };
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
    const normItem = normalizeForComparison(itemName);
    const items = await this.db.getActiveItems(chatId);
    const item = items.find(i =>
      i.canonicalName === cleanItem ||
      i.name.toLowerCase() === cleanItem ||
      (normItem && normalizeForComparison(i.canonicalName) === normItem) ||
      (normItem && normalizeForComparison(i.name) === normItem)
    );
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
      
      const numPrefix = `${index + 1}.`;
      let statusEmoji = '';
      if (item.isChecked) statusEmoji = '✅ ';
      else if (item.isUrgent) statusEmoji = '🔴 ';

      const strike = item.isChecked ? '~' : '';
      lines.push(`${numPrefix} ${statusEmoji}${strike}${item.name}${strike}${storeInfo}`);
    });

    return lines.join('\n');
  }

  formatListGroupedByStore(items) {
    if (!items || items.length === 0) {
      return '🛒 Shopping list is empty / La lista è vuota.';
    }

    const groups = {};
    const others = [];

    items.forEach((item, index) => {
      const itemWithIndex = { ...item, originalIndex: index + 1 };
      if (item.store) {
        const storeName = item.store.toUpperCase();
        if (!groups[storeName]) groups[storeName] = [];
        groups[storeName].push(itemWithIndex);
      } else {
        others.push(itemWithIndex);
      }
    });

    const lines = [`🏪 *Lista per Supermercati* (${items.length} articoli):`, ''];

    for (const [store, storeItems] of Object.entries(groups)) {
      lines.push(`*${store}*`);
      storeItems.forEach(item => {
        let statusEmoji = '';
        if (item.isChecked) statusEmoji = '✅ ';
        else if (item.isUrgent) statusEmoji = '🔴 ';
        const strike = item.isChecked ? '~' : '';
        const inferred = item.storeInferred ? ' (favorite)' : '';
        lines.push(`  ${item.originalIndex}. ${statusEmoji}${strike}${item.name}${strike}${inferred}`);
      });
      lines.push('');
    }

    if (others.length > 0) {
      lines.push('*ALTRO*');
      others.forEach(item => {
        let statusEmoji = '';
        if (item.isChecked) statusEmoji = '✅ ';
        else if (item.isUrgent) statusEmoji = '🔴 ';
        const strike = item.isChecked ? '~' : '';
        lines.push(`  ${item.originalIndex}. ${statusEmoji}${strike}${item.name}${strike}`);
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

