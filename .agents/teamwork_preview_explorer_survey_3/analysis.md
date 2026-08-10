# Architectural Analysis: Cloud Database, Habit Tracking & CLI/Mock Mode Runner

**Agent:** teamwork_preview_explorer_survey_3  
**Target Project:** WhatsApp Shopping List Application  
**Date:** 2026-08-10  

---

## 1. Executive Summary & Scope Overview

This report provides a comprehensive architectural design and technical specification for:
1. **Cloud Database & Habit Tracker Domain Layer**: Persisting active shopping list items, recording store preferences, and journaling store purchase habits using Firebase Firestore with an in-memory/file-backed mock adapter for offline testing.
2. **CLI / Mock Mode Runner Architecture**: Enabling non-interactive and programmatic execution of commands (`add`, `add with store`, `reset`, `reset [store]`), coupled with a mock broadcast notifier to verify WhatsApp broadcast triggers programmatically without physical device dependency.

---

## 2. Cloud Database Architecture & Data Schema Design

### 2.1 Database Adapter Pattern (`DatabaseAdapter`)

To prevent direct coupling between business domain logic and Firebase Firestore (and to enable offline unit/E2E testing), all database operations are abstracted behind a unified interface: `DatabaseAdapter`.

```typescript
export interface ShoppingListItem {
  id: string;
  name: string;             // Raw item name e.g. "Cioccolato"
  normalizedName: string;   // Normalized key e.g. "cioccolato"
  store?: string | null;    // Store name e.g. "eurospin" (explicit or inferred)
  quantity?: string | null; // Quantity string e.g. "2 tavolette"
  addedBy: string;          // User JID or username e.g. "+393400000000" / "CLI"
  addedAt: string;          // ISO timestamp
}

export interface StorePurchaseRecord {
  count: number;
  lastPurchasedAt: string;
}

export interface ItemHabit {
  itemName: string;         // Normalized item key e.g. "cioccolato"
  favoriteStore: string | null; // Store with highest purchase count
  stores: Record<string, StorePurchaseRecord>; // Store -> count & timestamp
  totalPurchases: number;
  updatedAt: string;
}

export interface ResetRecord {
  id: string;
  timestamp: string;
  store?: string | null;    // Store specified during reset e.g. "eurospin"
  items: ShoppingListItem[];// Items that were on the list when reset occurred
  resetBy: string;
}

export interface DatabaseAdapter {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Active List Operations
  addItem(item: { name: string; store?: string | null; quantity?: string | null; addedBy: string }): Promise<ShoppingListItem>;
  getActiveList(): Promise<ShoppingListItem[]>;
  clearActiveList(): Promise<ShoppingListItem[]>;
  removeItem(nameOrId: string): Promise<boolean>;

  // Habit Tracking Operations
  recordItemStoreHabit(itemName: string, storeName: string): Promise<ItemHabit>;
  getHabit(itemName: string): Promise<ItemHabit | null>;
  getAllHabits(): Promise<ItemHabit[]>;

  // Reset & Journaling Operations
  recordReset(storeName: string | null, resetBy: string): Promise<ResetRecord>;
  getPurchaseHistory(): Promise<ResetRecord[]>;
}
```

---

### 2.2 Firebase Firestore Data Model

When running in production/cloud mode (`DB_TYPE=firestore`), the `FirestoreAdapter` communicates with Firebase Firestore via `firebase-admin` (or `@google-cloud/firestore`).

#### Collections & Schema Layout:

1. **Collection: `active_items`**
   - Document ID: Auto-generated string or slugified item name.
   - Fields:
     ```json
     {
       "id": "item_1723300000_abc",
       "name": "cioccolato",
       "normalizedName": "cioccolato",
       "store": "eurospin",
       "addedBy": "+393400000000",
       "addedAt": "2026-08-10T15:40:00.000Z"
     }
     ```
   - Queries: `db.collection('active_items').orderBy('addedAt', 'asc').get()`

2. **Collection: `item_habits`**
   - Document ID: `normalizedName` (e.g. `cioccolato`)
   - Fields:
     ```json
     {
       "itemName": "cioccolato",
       "favoriteStore": "eurospin",
       "stores": {
         "eurospin": { "count": 5, "lastPurchasedAt": "2026-08-10T15:40:00.000Z" },
         "coop": { "count": 1, "lastPurchasedAt": "2026-08-01T10:00:00.000Z" }
       },
       "totalPurchases": 6,
       "updatedAt": "2026-08-10T15:40:00.000Z"
     }
     ```
   - Transactional Atomic Updates: Uses Firestore `FieldValue.increment(1)` or transaction blocks when recording purchases.

3. **Collection: `purchase_history`**
   - Document ID: Auto-generated timestamp ID (`reset_1723300000_123`)
   - Fields:
     ```json
     {
       "id": "reset_1723300000_123",
       "timestamp": "2026-08-10T15:40:00.000Z",
       "store": "eurospin",
       "items": [
         { "name": "cioccolato", "store": "eurospin" },
         { "name": "latte", "store": "eurospin" }
       ],
       "resetBy": "+393400000000"
     }
     ```

---

### 2.3 Local Mock Database Adapter (`MockDatabaseAdapter`)

When running locally or in test mode (`DB_TYPE=mock` or `NODE_ENV=test`), `MockDatabaseAdapter` provides:
- In-memory JS data structures (`Map<string, ShoppingListItem>`, `Map<string, ItemHabit>`, `Array<ResetRecord>`).
- Optional file-backed persistence to `data/mock_db.json` so CLI state survives between CLI command runs.
- 100% deterministic, instant performance, zero external credentials or network dependencies required.

```typescript
export class MockDatabaseAdapter implements DatabaseAdapter {
  private activeItems = new Map<string, ShoppingListItem>();
  private habits = new Map<string, ItemHabit>();
  private purchaseHistory: ResetRecord[] = [];
  private persistenceFilePath?: string;

  constructor(persistenceFilePath?: string) {
    this.persistenceFilePath = persistenceFilePath;
  }
  // Implementations for all DatabaseAdapter methods...
}
```

---

## 3. Command Parsing & Habit Inference Engine

### 3.1 Command & Message Router

User inputs (from WhatsApp or CLI) pass through `MessageParser` which classifies intent into one of five command types:

| Command Pattern | Parsed Intent | Example Input | Extracted Data |
|---|---|---|---|
| `reset [store]` | `RESET_LIST` | `"reset eurospin"` | `{ action: 'reset', store: 'eurospin' }` |
| `reset` | `RESET_LIST` | `"reset"` | `{ action: 'reset', store: null }` |
| `lista` / `list` | `SHOW_LIST` | `"lista"` | `{ action: 'list' }` |
| `habits` / `abitudini` | `SHOW_HABITS` | `"habits"` | `{ action: 'habits' }` |
| `<item> [store]` | `ADD_ITEM` | `"cioccolato eurospin"` | `{ action: 'add', item: 'cioccolato', store: 'eurospin' }` |
| `<item>` | `ADD_ITEM` | `"cioccolato"` | `{ action: 'add', item: 'cioccolato', store: null }` |

### 3.2 Store Disambiguation & Habit Inference Heuristics

1. **Explicit Store Mention**:
   - Inputs like `"cioccolato eurospin"` or `"latte coop"`:
     - Message parser splits tokens.
     - Known store dictionary (e.g. `['eurospin', 'coop', 'esselunga', 'conad', 'lidl', 'pam', 'carrefour']`) or multi-word parsing checks if trailing word is a store.
     - Extracted item: `"cioccolato"`, store: `"eurospin"`.
     - Habit updated immediately: `recordItemStoreHabit("cioccolato", "eurospin")`.

2. **Implicit Habit Inference**:
   - User inputs `"cioccolato"` (no store explicitly stated).
   - Domain service queries `getHabit("cioccolato")`.
   - If a `favoriteStore` exists (e.g. `"eurospin"` with highest purchase count):
     - Item is tagged with `store: "eurospin"` and flagged as habit-inferred (`inferredFromHabit: true`).
     - Displayed in active list as `• Cioccolato (Eurospin ⭐️)`.

3. **Reset Store Batch Habit Journaling**:
   - User sends `"reset eurospin"`:
     - System fetches all items currently in `active_items`.
     - For EACH item on the active list (e.g. `"cioccolato"`, `"pane"`, `"latte"`), system calls `recordItemStoreHabit(item.name, "eurospin")`.
     - System logs the reset record in `purchase_history`.
     - System clears `active_items`.
     - Broadcast notification is dispatched: `"🛒 Shopping list reset by User (Purchased at Eurospin)! 3 items logged."`

---

## 4. CLI / Mock Mode Runner Architecture

### 4.1 CLI Executable (`bin/cli.js`)

A dedicated CLI script provides programmatic interface for testing and command-line usage without running a WhatsApp client.

```bash
# Basic Item Add
node bin/cli.js add "cioccolato"

# Item Add with Store
node bin/cli.js add "cioccolato eurospin"
# OR with explicit flag
node bin/cli.js add "cioccolato" --store "eurospin"

# List Active Shopping List
node bin/cli.js list

# View Habit Tracker Stats
node bin/cli.js habits

# Reset List (No store)
node bin/cli.js reset

# Reset List with Store
node bin/cli.js reset "eurospin"
# OR
node bin/cli.js reset --store "eurospin"
```

---

### 4.2 Broadcast Notification System & Mock Trigger

To verify that `"reset"` triggers broadcast notifications without real WhatsApp connections:

```typescript
export interface NotificationBroadcaster {
  broadcast(message: string, metadata?: Record<string, any>): Promise<void>;
}

export class WhatsAppBroadcaster implements NotificationBroadcaster {
  constructor(private waClient: any, private targetChatIds: string[]) {}
  async broadcast(message: string): Promise<void> {
    for (const chatId of this.targetChatIds) {
      await this.waClient.sendMessage(chatId, message);
    }
  }
}

export class MockBroadcaster implements NotificationBroadcaster {
  public broadcastEvents: Array<{ message: string; timestamp: string; metadata?: any }> = [];
  private listeners: Array<(event: { message: string; timestamp: string }) => void> = [];

  onBroadcast(listener: (event: { message: string; timestamp: string }) => void) {
    this.listeners.push(listener);
  }

  async broadcast(message: string, metadata?: Record<string, any>): Promise<void> {
    const event = { message, timestamp: new Date().toISOString(), metadata };
    this.broadcastEvents.push(event);
    console.log(`[MOCK BROADCAST] ${message}`);
    this.listeners.forEach(fn => fn(event));
  }
}
```

---

## 5. End-to-End Data Flow Scenarios & Verification Traces

### Scenario A: `add item` ("cioccolato")
1. CLI receives command `add "cioccolato"`.
2. `MessageParser` parses action: `ADD_ITEM`, item: `"cioccolato"`, store: `null`.
3. `ShoppingListService` queries `dbAdapter.getHabit("cioccolato")`.
4. If habit exists (e.g. favorite store `"eurospin"`), store is set to `"eurospin"`.
5. `dbAdapter.addItem(...)` writes record to `active_items`.
6. CLI prints output: `Added "cioccolato" (Store: Eurospin ⭐️) to shopping list.`

### Scenario B: `add item with store` ("cioccolato eurospin")
1. CLI receives command `add "cioccolato eurospin"`.
2. `MessageParser` extracts item: `"cioccolato"`, store: `"eurospin"`.
3. `ShoppingListService` calls `dbAdapter.recordItemStoreHabit("cioccolato", "eurospin")`.
4. `dbAdapter.addItem(...)` writes record with explicit store `"eurospin"`.
5. CLI prints output: `Added "cioccolato" [Eurospin] to shopping list & updated habit tracker.`

### Scenario C: `reset`
1. CLI receives command `reset`.
2. `ShoppingListService` calls `dbAdapter.clearActiveList()`.
3. `ShoppingListService` calls `dbAdapter.recordReset(null, "CLI_USER")`.
4. `ShoppingListService` triggers `broadcaster.broadcast("🛒 Shopping list reset by CLI_USER! Active list cleared.")`.
5. `MockBroadcaster` appends event to `broadcastEvents` array and logs to console.

### Scenario D: `reset [store]` ("reset eurospin")
1. CLI receives command `reset "eurospin"`.
2. `ShoppingListService` fetches active items (`"cioccolato"`, `"pane"`).
3. For each active item, `dbAdapter.recordItemStoreHabit(item.name, "eurospin")` updates habit counts.
4. `dbAdapter.recordReset("eurospin", "CLI_USER")` creates purchase history log.
5. `dbAdapter.clearActiveList()` empties `active_items`.
6. `broadcaster.broadcast("🛒 Shopping list reset by CLI_USER! Purchased at Eurospin. 2 items logged to habits.")`.

---

## 6. Recommendations & Implementation Plan

1. **Module Structure**:
   ```
   src/
   ├── config/          # Environment & Firebase initialization
   ├── db/
   │   ├── DatabaseAdapter.ts
   │   ├── FirestoreAdapter.ts
   │   └── MockDatabaseAdapter.ts
   ├── domain/
   │   ├── ShoppingListService.ts
   │   └── MessageParser.ts
   ├── notification/
   │   ├── NotificationBroadcaster.ts
   │   ├── WhatsAppBroadcaster.ts
   │   └── MockBroadcaster.ts
   └── cli/
       └── runner.ts
   bin/
   └── cli.js           # CLI entry point script
   ```

2. **Testing Strategy**:
   - Unit tests for `MessageParser`, `MockDatabaseAdapter`, and `ShoppingListService` using Jest or Vitest.
   - Integration tests executing CLI commands via `child_process.exec` or direct module invocation against `MockDatabaseAdapter` to verify all 4 user acceptance criteria programmatically.
