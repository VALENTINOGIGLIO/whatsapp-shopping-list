# Domain Core Layer Analysis & Technical Specification

**Author**: `teamwork_preview_explorer_m1_2`  
**Milestone**: M1 — Data Storage & Habit Tracking Domain Layer  
**Target Files**:
- `src/domain/HabitTracker.js`
- `src/domain/ShoppingListService.js`

---

## 1. Executive Summary & Domain Scope

The domain core layer encapsulates the core business logic of the WhatsApp Shopping List Application:
1. **Habit Tracking (`HabitTracker`)**: Tracks store purchase frequencies for each item, normalizes item and store names, auto-calculates favorite stores based on purchase history, and handles habit updates when items are added with explicit stores or when lists are reset.
2. **Shopping List Management (`ShoppingListService`)**: Handles list CRUD operations (adding items, deduplication, store inference, listing active items), batch list clearing on reset, journaling purchase history, and coordinating notification broadcasts upon reset.

Both services are implemented as decoupled, dependency-injected JavaScript ES Modules (`"type": "module"` in `package.json`). They interact with data persistence exclusively through the `DatabaseAdapter` abstraction (`MockDatabaseAdapter` in tests, `FirestoreAdapter` in production).

---

## 2. Specification: `src/domain/HabitTracker.js`

### 2.1 Purpose & Responsibilities
- Normalizes raw text input (trimming, lowercase conversion, whitespace collapsing) for deterministic item and store matching.
- Manages item habit records (`ItemHabit`), which store store purchase frequencies (`storeCounts`) and derive the `favoriteStore`.
- Calculates total purchases across all stores for a given item.
- Applies deterministic tie-breaking logic when multiple stores share the same purchase frequency.
- Provides batch update mechanisms for updating habits when resetting a list at a specific store.

### 2.2 Data Models & Types

```javascript
/**
 * ItemHabit represents long-term shopping habit data for a single item.
 * @typedef {Object} ItemHabit
 * @property {string} id - Unique habit identifier (normalized item canonical name, e.g., "cioccolato")
 * @property {string} itemName - Canonical item name
 * @property {Record<string, number>} storeCounts - Dictionary mapping store name to purchase frequency
 * @property {string|null} favoriteStore - Store with highest frequency, or null if no store recorded
 * @property {number} totalPurchases - Aggregate purchase count across all stores
 * @property {string} updatedAt - ISO 8601 timestamp string of last modification
 */
```

### 2.3 Normalization Rules
1. **Item Name Normalization**:
   - Strip leading/trailing whitespace.
   - Convert to lowercase.
   - Replace multiple consecutive whitespace characters with a single space.
   - Example: `"  Cioccolato   Fondente "` -> `"cioccolato fondente"`.
2. **Store Name Normalization**:
   - Strip leading/trailing whitespace.
   - Convert to lowercase.
   - Example: `"  EuroSpin  "` -> `"eurospin"`.

### 2.4 Favorite Store Algorithm & Tie-Breaking Logic
To calculate `favoriteStore`:
1. Iterate over all `[store, count]` entries in `storeCounts`.
2. Find the maximum `count`.
3. If `storeCounts` is empty, return `null`.
4. If multiple stores tie for maximum count, break ties deterministically by selecting the store name in **alphabetical order** (lexicographical comparison).
   - *Rationale*: Ensures test assertions are 100% deterministic regardless of object key insertion order in JavaScript engines.

### 2.5 API & Method Signatures

| Method Signature | Return Type | Description |
|------------------|-------------|-------------|
| `normalizeItemName(itemName)` | `string` | Returns canonical lowercase item string. |
| `normalizeStoreName(storeName)` | `string` | Returns canonical lowercase store string. |
| `recordStorePurchase(existingHabit, itemName, storeName)` | `ItemHabit` | Updates store count, favorite store, total purchases, and timestamp for an item. |
| `calculateFavoriteStore(storeCounts)` | `string \| null` | Returns favorite store with deterministic tie-breaking. |
| `async updateHabitForItem(dbAdapter, itemName, storeName)` | `Promise<ItemHabit>` | Fetches habit from DB, applies purchase record, and persists updated habit. |
| `async updateHabitsForBatch(dbAdapter, itemNames, storeName)` | `Promise<ItemHabit[]>` | Updates habits for a list of item names in bulk. |
| `async getFavoriteStoreForItem(dbAdapter, itemName)` | `Promise<string \| null>` | Returns favorite store for an item, or `null`. |

### 2.6 Proposed Implementation Reference

```javascript
/**
 * src/domain/HabitTracker.js
 */
export class HabitTracker {
  /**
   * Normalizes an item name for canonical database key matching.
   * @param {string} itemName
   * @returns {string}
   */
  normalizeItemName(itemName) {
    if (!itemName || typeof itemName !== 'string') return '';
    return itemName.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Normalizes a store name.
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

    // Sort store names alphabetically for deterministic tie-breaking
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
   * Updates habit data structure in memory.
   * @param {ItemHabit|null} existingHabit
   * @param {string} rawItemName
   * @param {string} rawStoreName
   * @returns {ItemHabit}
   */
  recordStorePurchase(existingHabit, rawItemName, rawStoreName) {
    const canonicalItem = this.normalizeItemName(rawItemName);
    const canonicalStore = this.normalizeStoreName(rawStoreName);

    const storeCounts = existingHabit?.storeCounts ? { ...existingHabit.storeCounts } : {};
    storeCounts[canonicalStore] = (storeCounts[canonicalStore] || 0) + 1;

    const favoriteStore = this.calculateFavoriteStore(storeCounts);
    const totalPurchases = Object.values(storeCounts).reduce((sum, val) => sum + val, 0);

    return {
      id: canonicalItem,
      itemName: canonicalItem,
      storeCounts,
      favoriteStore,
      totalPurchases,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Updates habit for a single item in database.
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter} dbAdapter
   * @param {string} rawItemName
   * @param {string} rawStoreName
   * @returns {Promise<ItemHabit>}
   */
  async updateHabitForItem(dbAdapter, rawItemName, rawStoreName) {
    const canonicalItem = this.normalizeItemName(rawItemName);
    if (!canonicalItem || !rawStoreName) return null;

    const existingHabit = await dbAdapter.getHabit(canonicalItem);
    const updatedHabit = this.recordStorePurchase(existingHabit, canonicalItem, rawStoreName);
    await dbAdapter.saveHabit(updatedHabit);

    return updatedHabit;
  }

  /**
   * Updates habits for multiple items in bulk (e.g. during reset [store]).
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter} dbAdapter
   * @param {string[]} rawItemNames
   * @param {string} rawStoreName
   * @returns {Promise<ItemHabit[]>}
   */
  async updateHabitsForBatch(dbAdapter, rawItemNames, rawStoreName) {
    if (!rawItemNames || rawItemNames.length === 0 || !rawStoreName) return [];

    const updatedHabits = [];
    for (const itemName of rawItemNames) {
      const habit = await this.updateHabitForItem(dbAdapter, itemName, rawStoreName);
      if (habit) updatedHabits.push(habit);
    }
    return updatedHabits;
  }

  /**
   * Gets favorite store for an item.
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter} dbAdapter
   * @param {string} rawItemName
   * @returns {Promise<string|null>}
   */
  async getFavoriteStoreForItem(dbAdapter, rawItemName) {
    const canonicalItem = this.normalizeItemName(rawItemName);
    if (!canonicalItem) return null;

    const habit = await dbAdapter.getHabit(canonicalItem);
    return habit ? habit.favoriteStore : null;
  }
}
```

---

## 3. Specification: `src/domain/ShoppingListService.js`

### 3.1 Purpose & Responsibilities
- Serves as the central facade and application service for shopping list management.
- Handles adding items (`addItem`), checking duplicate items, inferring favorite stores from `HabitTracker`, and saving active items.
- Manages shopping list resets (`resetList`):
  - Clears active items from `DatabaseAdapter`.
  - Log store purchases to `HabitTracker` if store is specified.
  - Persists purchase record (`PurchaseHistoryRecord`) to `DatabaseAdapter`.
  - Triggers broadcast notification via `NotificationBroadcaster`.
- Provides list queries (`getList`), habit queries (`getHabits`), and formatted text helper (`formatListForDisplay`).

### 3.2 Data Models & Types

```javascript
/**
 * Represents an active item on the shopping list.
 * @typedef {Object} ShoppingListItem
 * @property {string} id - Unique item ID
 * @property {string} name - Display item name
 * @property {string} canonicalName - Normalized item name
 * @property {string|null} store - Assigned store name (explicit or inferred)
 * @property {boolean} storeInferred - True if store was inferred from habit history
 * @property {string|null} addedBy - Sender ID / name who added the item
 * @property {string} createdAt - ISO 8601 timestamp string
 */

/**
 * Represents a historical reset event.
 * @typedef {Object} PurchaseHistoryRecord
 * @property {string} id - Unique history record ID
 * @property {string|null} store - Store where shopping was completed (if specified)
 * @property {ShoppingListItem[]} items - Active items cleared during reset
 * @property {string|null} resetBy - Sender who triggered reset
 * @property {string} resetAt - ISO 8601 timestamp string
 */
```

### 3.3 API & Method Signatures

| Method Signature | Return Type | Description |
|------------------|-------------|-------------|
| `addItem(itemName, storeName?, sender?)` | `Promise<{ item: ShoppingListItem, habitUpdated: boolean }>` | Adds item to active list, infers store if missing, updates habit if store specified. |
| `resetList(storeName?, sender?)` | `Promise<{ resetRecord: PurchaseHistoryRecord, itemsCleared: number }>` | Clears active list, updates store habits, logs history, broadcasts notification. |
| `getList()` | `Promise<ShoppingListItem[]>` | Returns all currently active shopping list items. |
| `getHabits(itemName?)` | `Promise<ItemHabit[]>` | Returns habit record for specified item or all habits. |
| `formatListForDisplay(items)` | `string` | Formats items into a user-friendly chat string. |

### 3.4 Workflow Details

#### A. Add Item Workflow (`addItem`)
1. Validate `itemName`: Throw `Error("Item name cannot be empty")` if empty or invalid.
2. Canonicalize item name via `habitTracker.normalizeItemName(itemName)`.
3. Check store association:
   - If explicit `storeName` provided:
     - Update habit via `habitTracker.updateHabitForItem(dbAdapter, canonicalName, storeName)`.
     - Set `assignedStore = habitTracker.normalizeStoreName(storeName)`, `storeInferred = false`, `habitUpdated = true`.
   - Else (no explicit store):
     - Query `inferredStore = await habitTracker.getFavoriteStoreForItem(dbAdapter, canonicalName)`.
     - Set `assignedStore = inferredStore`, `storeInferred = Boolean(inferredStore)`, `habitUpdated = false`.
4. Fetch active list: `activeItems = await dbAdapter.getActiveItems()`.
5. Deduplication check:
   - Search for existing item matching `canonicalName`.
   - If item exists: Update existing item's store (if explicit store provided) and `addedBy`.
   - If item does not exist: Create new `ShoppingListItem` object (`id: Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7)`).
6. Persist item via `await dbAdapter.saveActiveItem(newItem)`.
7. Return `{ item: newItem, habitUpdated }`.

#### B. Reset List Workflow (`resetList`)
1. Retrieve active items: `activeItems = await dbAdapter.getActiveItems()`.
2. If `activeItems.length === 0`:
   - Return `{ resetRecord: null, itemsCleared: 0 }`.
3. Process store habit logging:
   - If `storeName` provided:
     - `canonicalStore = habitTracker.normalizeStoreName(storeName)`.
     - `itemNames = activeItems.map(item => item.canonicalName)`.
     - `await habitTracker.updateHabitsForBatch(dbAdapter, itemNames, canonicalStore)`.
4. Construct `PurchaseHistoryRecord`:
   - `id = 'reset-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7)`.
   - `store = storeName ? habitTracker.normalizeStoreName(storeName) : null`.
   - `items = [...activeItems]`.
   - `resetBy = sender || null`.
   - `resetAt = new Date().toISOString()`.
   - Save via `await dbAdapter.savePurchaseHistory(resetRecord)`.
5. Clear active list:
   - `itemsCleared = await dbAdapter.deleteActiveItems()`.
6. Trigger Broadcast:
   - If `this.broadcaster` is set:
     - Message format: `🧹 Shopping list cleared (${itemsCleared} items).` + (if `storeName`: ` Purchased at ${storeName.trim()}.`).
     - `await this.broadcaster.broadcast(message)`.
7. Return `{ resetRecord, itemsCleared }`.

### 3.5 Proposed Implementation Reference

```javascript
/**
 * src/domain/ShoppingListService.js
 */
import { HabitTracker } from './HabitTracker.js';

export class ShoppingListService {
  /**
   * @param {Object} options
   * @param {import('../db/DatabaseAdapter.js').DatabaseAdapter} options.dbAdapter
   * @param {HabitTracker} [options.habitTracker]
   * @param {import('../broadcaster/NotificationBroadcaster.js').NotificationBroadcaster} [options.broadcaster]
   */
  constructor({ dbAdapter, habitTracker, broadcaster = null }) {
    if (!dbAdapter) {
      throw new Error('DatabaseAdapter is required by ShoppingListService');
    }
    this.dbAdapter = dbAdapter;
    this.habitTracker = habitTracker || new HabitTracker();
    this.broadcaster = broadcaster;
  }

  /**
   * Adds an item to the shopping list, updating habit tracking if store is provided,
   * or inferring favorite store if missing.
   * @param {string} itemName
   * @param {string} [storeName]
   * @param {string} [sender]
   * @returns {Promise<{ item: Object, habitUpdated: boolean }>}
   */
  async addItem(itemName, storeName = null, sender = null) {
    if (!itemName || typeof itemName !== 'string' || !itemName.trim()) {
      throw new Error('Item name cannot be empty');
    }

    const canonicalName = this.habitTracker.normalizeItemName(itemName);
    let assignedStore = null;
    let storeInferred = false;
    let habitUpdated = false;

    if (storeName && storeName.trim()) {
      assignedStore = this.habitTracker.normalizeStoreName(storeName);
      await this.habitTracker.updateHabitForItem(this.dbAdapter, canonicalName, assignedStore);
      habitUpdated = true;
    } else {
      const favoriteStore = await this.habitTracker.getFavoriteStoreForItem(this.dbAdapter, canonicalName);
      if (favoriteStore) {
        assignedStore = favoriteStore;
        storeInferred = true;
      }
    }

    const activeItems = await this.dbAdapter.getActiveItems();
    let existingItem = activeItems.find(i => i.canonicalName === canonicalName);

    let itemToSave;
    if (existingItem) {
      itemToSave = {
        ...existingItem,
        store: assignedStore || existingItem.store,
        storeInferred: storeName ? false : (assignedStore ? storeInferred : existingItem.storeInferred),
        addedBy: sender || existingItem.addedBy,
        createdAt: new Date().toISOString()
      };
    } else {
      itemToSave = {
        id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: itemName.trim(),
        canonicalName,
        store: assignedStore,
        storeInferred,
        addedBy: sender || null,
        createdAt: new Date().toISOString()
      };
    }

    await this.dbAdapter.saveActiveItem(itemToSave);

    return { item: itemToSave, habitUpdated };
  }

  /**
   * Resets active shopping list, logs purchase record, updates habits if store provided,
   * and triggers broadcast notification.
   * @param {string} [storeName]
   * @param {string} [sender]
   * @returns {Promise<{ resetRecord: Object|null, itemsCleared: number }>}
   */
  async resetList(storeName = null, sender = null) {
    const activeItems = await this.dbAdapter.getActiveItems();

    if (!activeItems || activeItems.length === 0) {
      return { resetRecord: null, itemsCleared: 0 };
    }

    const normalizedStore = storeName && storeName.trim()
      ? this.habitTracker.normalizeStoreName(storeName)
      : null;

    if (normalizedStore) {
      const canonicalNames = activeItems.map(i => i.canonicalName);
      await this.habitTracker.updateHabitsForBatch(this.dbAdapter, canonicalNames, normalizedStore);
    }

    const resetRecord = {
      id: `reset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      store: normalizedStore,
      items: [...activeItems],
      resetBy: sender || null,
      resetAt: new Date().toISOString()
    };

    await this.dbAdapter.savePurchaseHistory(resetRecord);
    const itemsCleared = await this.dbAdapter.deleteActiveItems();

    if (this.broadcaster) {
      const storeText = normalizedStore ? ` at ${normalizedStore.toUpperCase()}` : '';
      const notificationMsg = `🧹 Shopping list reset! ${itemsCleared} items purchased${storeText}.`;
      await this.broadcaster.broadcast(notificationMsg);
    }

    return { resetRecord, itemsCleared };
  }

  /**
   * Retrieves active items on the shopping list.
   * @returns {Promise<Object[]>}
   */
  async getList() {
    return await this.dbAdapter.getActiveItems();
  }

  /**
   * Retrieves habit preferences for a specific item or all habits.
   * @param {string} [itemName]
   * @returns {Promise<Object[]>}
   */
  async getHabits(itemName = null) {
    if (itemName && itemName.trim()) {
      const canonical = this.habitTracker.normalizeItemName(itemName);
      const habit = await this.dbAdapter.getHabit(canonical);
      return habit ? [habit] : [];
    }
    return await this.dbAdapter.getAllHabits();
  }

  /**
   * Formats list of items for chat/CLI display.
   * @param {Object[]} items
   * @returns {string}
   */
  formatListForDisplay(items) {
    if (!items || items.length === 0) {
      return '🛒 Shopping list is currently empty.';
    }

    const lines = [`🛒 *Shopping List* (${items.length} items):`];
    items.forEach((item, index) => {
      let storeInfo = '';
      if (item.store) {
        storeInfo = item.storeInferred
          ? ` (${item.store} - favorite)`
          : ` (${item.store})`;
      }
      lines.push(`${index + 1}. ${item.name}${storeInfo}`);
    });

    return lines.join('\n');
  }
}
```

---

## 4. Interface Contracts for `DatabaseAdapter`

To guarantee seamless integration with Explorer `m1_1`'s work on `DatabaseAdapter`, `ShoppingListService` and `HabitTracker` rely on the following async database methods:

1. `getActiveItems(): Promise<ShoppingListItem[]>`
2. `saveActiveItem(item: ShoppingListItem): Promise<void>`
3. `deleteActiveItems(): Promise<number>`
4. `getHabit(itemName: string): Promise<ItemHabit | null>`
5. `saveHabit(habit: ItemHabit): Promise<void>`
6. `getAllHabits(): Promise<ItemHabit[]>`
7. `savePurchaseHistory(record: PurchaseHistoryRecord): Promise<void>`

---

## 5. Testing & Verification Strategy

### Unit Tests (`tests/unit/domain/`)
- `tests/unit/domain/HabitTracker.test.js`:
  - Verify string normalization (`"  Cioccolato  "` -> `"cioccolato"`).
  - Verify `recordStorePurchase` increments frequency counters and updates `favoriteStore`.
  - Verify deterministic tie-breaking when two stores have equal purchase count.
  - Verify `updateHabitForItem` and `updateHabitsForBatch` with `MockDatabaseAdapter`.
- `tests/unit/domain/ShoppingListService.test.js`:
  - Verify `addItem` creates item with correct canonical name and timestamps.
  - Verify `addItem` with store updates `HabitTracker` and sets `storeInferred: false`.
  - Verify `addItem` without store auto-infers favorite store when habit history exists (`storeInferred: true`).
  - Verify `resetList` clears DB, logs purchase history, updates habits for active items (if store provided), and calls `broadcaster.broadcast()`.
  - Verify error handling (empty item names throw Error).

---

## 6. Implementation Action Plan for Implementers

1. **Create File Structure**:
   - `src/domain/HabitTracker.js`
   - `src/domain/ShoppingListService.js`
2. **Export Pattern**:
   - Use named ES Module exports (`export class HabitTracker`, `export class ShoppingListService`).
3. **Co-located Unit Tests**:
   - `tests/unit/domain/HabitTracker.test.js`
   - `tests/unit/domain/ShoppingListService.test.js`
4. **Dependencies**:
   - No external npm packages required for pure domain logic.
