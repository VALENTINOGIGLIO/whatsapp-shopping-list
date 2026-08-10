import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Standardized structure types for verification
export function createMockItem(name, store = null, sender = 'user1') {
  const cleanName = name ? name.trim() : '';
  const cleanStore = store ? store.trim().toLowerCase() : null;
  return {
    id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: cleanName,
    store: cleanStore,
    addedBy: sender,
    createdAt: new Date().toISOString()
  };
}

// In-Memory Database Adapter fallback / reference implementation
export class MockDatabaseAdapter {
  constructor() {
    this.activeItems = [];
    this.habits = new Map(); // key: lowercased itemName, value: { itemName, stores: {}, favoriteStore, lastUpdated }
    this.purchaseHistory = [];
  }

  async getActiveItems() {
    return [...this.activeItems];
  }

  async saveActiveItem(item) {
    const existingIndex = this.activeItems.findIndex(
      i => i.name.toLowerCase() === item.name.toLowerCase()
    );
    if (existingIndex >= 0) {
      this.activeItems[existingIndex] = { ...this.activeItems[existingIndex], ...item };
    } else {
      this.activeItems.push({ ...item });
    }
  }

  async deleteActiveItems() {
    const count = this.activeItems.length;
    this.activeItems = [];
    return count;
  }

  async getHabit(itemName) {
    if (!itemName) return null;
    const key = itemName.trim().toLowerCase();
    const habit = this.habits.get(key);
    return habit ? JSON.parse(JSON.stringify(habit)) : null;
  }

  async saveHabit(habit) {
    if (!habit || !habit.itemName) return;
    const key = habit.itemName.trim().toLowerCase();
    this.habits.set(key, JSON.parse(JSON.stringify(habit)));
  }

  async savePurchaseHistory(record) {
    this.purchaseHistory.push(JSON.parse(JSON.stringify(record)));
  }

  async getPurchaseHistory() {
    return [...this.purchaseHistory];
  }

  clear() {
    this.activeItems = [];
    this.habits.clear();
    this.purchaseHistory = [];
  }
}

// Mock Broadcaster fallback / reference implementation
export class MockBroadcaster {
  constructor() {
    this.sentNotifications = [];
  }

  async broadcast(message, recipient = 'family_chat') {
    const notification = {
      message,
      recipient,
      timestamp: new Date().toISOString()
    };
    this.sentNotifications.push(notification);
    return notification;
  }

  getSentNotifications() {
    return [...this.sentNotifications];
  }

  clearNotifications() {
    this.sentNotifications = [];
  }
}

// Habit Tracker fallback / reference implementation
export class HabitTracker {
  constructor(dbAdapter) {
    this.db = dbAdapter;
  }

  async trackPurchase(itemName, storeName) {
    if (!itemName || !storeName) return null;
    const cleanItem = itemName.trim();
    const cleanStore = storeName.trim().toLowerCase();

    let habit = await this.db.getHabit(cleanItem);
    if (!habit) {
      habit = {
        itemName: cleanItem,
        stores: {},
        favoriteStore: cleanStore,
        lastUpdated: new Date().toISOString()
      };
    }

    habit.stores[cleanStore] = (habit.stores[cleanStore] || 0) + 1;

    // Calculate favorite store (highest frequency)
    let maxCount = 0;
    let favStore = cleanStore;
    for (const [s, count] of Object.entries(habit.stores)) {
      if (count > maxCount) {
        maxCount = count;
        favStore = s;
      }
    }
    habit.favoriteStore = favStore;
    habit.lastUpdated = new Date().toISOString();

    await this.db.saveHabit(habit);
    return habit;
  }

  async getFavoriteStore(itemName) {
    if (!itemName) return null;
    const habit = await this.db.getHabit(itemName);
    return habit ? habit.favoriteStore || null : null;
  }

  async getHabits(itemName = null) {
    if (itemName) {
      const habit = await this.db.getHabit(itemName);
      return habit ? [habit] : [];
    }
    const allHabits = [];
    if (this.db.habits) {
      for (const habit of this.db.habits.values()) {
        allHabits.push(habit);
      }
    }
    return allHabits;
  }
}

// ShoppingListService fallback / reference implementation
export class ShoppingListService {
  constructor(dbAdapter, broadcaster, habitTracker) {
    this.db = dbAdapter || new MockDatabaseAdapter();
    this.broadcaster = broadcaster || new MockBroadcaster();
    this.habitTracker = habitTracker || new HabitTracker(this.db);
  }

  async addItem(itemName, storeName = null, sender = 'user1') {
    if (!itemName || typeof itemName !== 'string' || itemName.trim() === '') {
      throw new Error('Item name cannot be empty');
    }

    const cleanItem = itemName.trim();
    let finalStore = storeName ? storeName.trim().toLowerCase() : null;

    // If store not specified, attempt to infer from habit tracker
    if (!finalStore) {
      finalStore = await this.habitTracker.getFavoriteStore(cleanItem);
    }

    let habitUpdated = false;
    if (finalStore && storeName) {
      await this.habitTracker.trackPurchase(cleanItem, finalStore);
      habitUpdated = true;
    }

    const item = createMockItem(cleanItem, finalStore, sender);
    await this.db.saveActiveItem(item);

    return { item, habitUpdated };
  }

  async resetList(storeName = null, sender = 'user1') {
    const activeItems = await this.db.getActiveItems();
    const itemsCleared = activeItems.length;

    const cleanStore = storeName ? storeName.trim().toLowerCase() : null;

    // Update habits for all items if store is specified at reset
    if (cleanStore && itemsCleared > 0) {
      for (const item of activeItems) {
        await this.habitTracker.trackPurchase(item.name, cleanStore);
      }
    }

    const resetRecord = {
      id: `reset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      items: activeItems,
      store: cleanStore,
      resetBy: sender,
      timestamp: new Date().toISOString()
    };

    await this.db.savePurchaseHistory(resetRecord);
    await this.db.deleteActiveItems();

    const broadcastMsg = cleanStore
      ? `Spesa completata presso ${cleanStore.toUpperCase()}! La lista è stata svuotata (${itemsCleared} articoli).`
      : `Spesa completata! La lista è stata svuotata (${itemsCleared} articoli).`;

    await this.broadcaster.broadcast(broadcastMsg);

    return { resetRecord, itemsCleared };
  }

  async getList() {
    return await this.db.getActiveItems();
  }

  async getHabits(itemName = null) {
    return await this.habitTracker.getHabits(itemName);
  }
}

// MessageParser fallback / reference implementation
export class MessageParser {
  static parse(text) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return { command: 'unknown', raw: text || '' };
    }

    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    if (lower === 'list' || lower === 'mostra lista' || lower === 'lista') {
      return { command: 'list', raw: text };
    }

    if (lower === 'habits' || lower === 'preferenze') {
      return { command: 'habits', raw: text };
    }

    if (lower.startsWith('habits ')) {
      const item = trimmed.substring(7).trim();
      return { command: 'habits', item, raw: text };
    }

    if (lower === 'reset') {
      return { command: 'reset', raw: text };
    }

    if (lower.startsWith('reset ')) {
      const store = trimmed.substring(6).trim();
      return { command: 'reset', store, raw: text };
    }

    // Default: add command. Check if last word is a known or separated store argument
    const parts = trimmed.split(/\s+/);
    if (parts.length > 1) {
      // Check if last word could be store
      const potentialStore = parts[parts.length - 1];
      const potentialItem = parts.slice(0, parts.length - 1).join(' ');
      return {
        command: 'add',
        item: potentialItem,
        store: potentialStore,
        raw: text
      };
    }

    return {
      command: 'add',
      item: trimmed,
      raw: text
    };
  }
}

// Module Factory to resolve real src/ files when available or fallback to test harness
export async function getImplementationModules() {
  const projectRoot = resolve(process.cwd());

  const mockDbPath = resolve(projectRoot, 'src/db/MockDatabaseAdapter.js');
  const servicePath = resolve(projectRoot, 'src/domain/ShoppingListService.js');
  const habitPath = resolve(projectRoot, 'src/domain/HabitTracker.js');
  const parserPath = resolve(projectRoot, 'src/domain/MessageParser.js');
  const broadcasterPath = resolve(projectRoot, 'src/broadcaster/MockBroadcaster.js');

  let RealMockDb, RealService, RealHabit, RealParser, RealBroadcaster;

  if (existsSync(mockDbPath)) {
    try {
      const mod = await import(mockDbPath);
      RealMockDb = mod.MockDatabaseAdapter || mod.default;
    } catch (_) {}
  }

  if (existsSync(servicePath)) {
    try {
      const mod = await import(servicePath);
      RealService = mod.ShoppingListService || mod.default;
    } catch (_) {}
  }

  if (existsSync(habitPath)) {
    try {
      const mod = await import(habitPath);
      RealHabit = mod.HabitTracker || mod.default;
    } catch (_) {}
  }

  if (existsSync(parserPath)) {
    try {
      const mod = await import(parserPath);
      RealParser = mod.MessageParser || mod.default;
    } catch (_) {}
  }

  if (existsSync(broadcasterPath)) {
    try {
      const mod = await import(broadcasterPath);
      RealBroadcaster = mod.MockBroadcaster || mod.default;
    } catch (_) {}
  }

  return {
    MockDatabaseAdapter: RealMockDb || MockDatabaseAdapter,
    ShoppingListService: RealService || ShoppingListService,
    HabitTracker: RealHabit || HabitTracker,
    MessageParser: RealParser || MessageParser,
    MockBroadcaster: RealBroadcaster || MockBroadcaster,
    isRealImplementationLoaded: Boolean(RealService)
  };
}
