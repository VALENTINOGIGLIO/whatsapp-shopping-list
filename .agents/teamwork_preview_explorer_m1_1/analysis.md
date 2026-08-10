# Technical Analysis: Package & Database Layer Specifications (Milestone 1)

**Author:** teamwork_preview_explorer_m1_1  
**Date:** 2026-08-10  
**Scope:** `package.json`, `src/config/firebase.js`, `src/db/DatabaseAdapter.js`, `src/db/MockDatabaseAdapter.js`, `src/db/FirestoreAdapter.js`, `src/db/index.js`

---

## 1. Executive Summary

Milestone 1 establishes the foundational data layer and domain models for the WhatsApp Shopping List Application. To fulfill the requirements of both fast automated testing (offline/CLI) and cloud production persistence, a decoupled **Adapter Pattern** is required.

This specification details:
1. **ES Module initialization** via `package.json` (`"type": "module"`).
2. **Domain Data Schemas** for Shopping List Items, Item Habits, and Purchase History Records.
3. **DatabaseAdapter** abstract contract enforcing uniform interface across storage backends.
4. **MockDatabaseAdapter** lightweight in-memory storage supporting test setup/teardown and offline CLI operations.
5. **FirestoreAdapter** production-ready Google Cloud Firestore adapter utilizing `firebase-admin`.
6. **Database Factory** dynamic initializer selecting adapter based on environment configuration (`DB_TYPE` / `USE_MOCK_DB`).

---

## 2. Package & Environment Setup (`package.json`)

### 2.1 ESM Configuration
The application will use native ES Modules (`"type": "module"`). All internal imports must use relative paths with `.js` extensions.

### 2.2 Proposed `package.json` Content
```json
{
  "name": "whatsapp-shopping-list",
  "version": "1.0.0",
  "description": "WhatsApp bot for shared family shopping list with habit tracking and cloud persistence",
  "type": "module",
  "main": "src/whatsapp/whatsappClient.js",
  "scripts": {
    "start": "node src/whatsapp/whatsappClient.js",
    "cli": "node bin/cli.js",
    "test": "node --test tests/**/*.test.js",
    "test:unit": "node --test tests/unit/**/*.test.js",
    "test:integration": "node --test tests/integration/**/*.test.js",
    "test:e2e": "node --test tests/e2e/**/*.test.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "firebase-admin": "^12.1.0",
    "qrcode-terminal": "^0.12.0",
    "whatsapp-web.js": "^1.23.0"
  },
  "devDependencies": {
    "c8": "^9.1.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## 3. Data Models Specification

### 3.1 `ShoppingListItem`
Represents an active item currently on the shopping list.

```javascript
/**
 * @typedef {Object} ShoppingListItem
 * @property {string} id - Unique item identifier (e.g. normalized item name or UUID)
 * @property {string} name - Raw item name as entered by user (e.g., "Cioccolato")
 * @property {string} normalizedName - Trimmed lowercase item name (e.g., "cioccolato")
 * @property {string|null} store - Optional store association (e.g., "eurospin")
 * @property {string|null} addedBy - Sender identifier (phone number or CLI tag)
 * @property {string} addedAt - ISO 8601 timestamp string
 */
```

### 3.2 `ItemHabit`
Tracks historical purchasing statistics for a specific item.

```javascript
/**
 * @typedef {Object} ItemHabit
 * @property {string} itemName - Trimmed lowercase item name (e.g., "cioccolato")
 * @property {Record<string, number>} storeCounts - Map of store name to purchase count (e.g., { "eurospin": 3, "esselunga": 1 })
 * @property {number} totalPurchases - Total number of times item was included in a reset purchase
 * @property {string|null} favoriteStore - Calculated store with highest purchase frequency
 * @property {string|null} lastPurchasedStore - Store associated with the most recent purchase
 * @property {string} updatedAt - ISO 8601 timestamp string
 */
```

### 3.3 `PurchaseHistoryRecord`
Journal entry created when a shopping list is reset.

```javascript
/**
 * @typedef {Object} PurchaseHistoryRecord
 * @property {string} id - Unique purchase event ID (e.g., "purch_1723300000000_abc12")
 * @property {string} purchasedAt - ISO 8601 timestamp string
 * @property {string|null} store - Store where list was purchased (if specified in reset command)
 * @property {ShoppingListItem[]} items - Snapshot of shopping list items present at reset time
 * @property {number} itemCount - Total number of items cleared
 * @property {string|null} resetBy - Sender identifier who executed reset command
 */
```

---

## 4. Abstract Database Adapter (`src/db/DatabaseAdapter.js`)

The `DatabaseAdapter` base class defines the method contract required by all data access implementations. Calling methods directly on `DatabaseAdapter` throws an explicit `Error`.

### 4.1 Class Signature & Code Template
```javascript
/**
 * Abstract Database Adapter Interface
 */
export class DatabaseAdapter {
  /**
   * Retrieves all active shopping list items.
   * @returns {Promise<import('./types.js').ShoppingListItem[]>}
   */
  async getActiveItems() {
    throw new Error('DatabaseAdapter.getActiveItems() must be implemented by subclass.');
  }

  /**
   * Saves or updates an active shopping list item.
   * @param {import('./types.js').ShoppingListItem} item
   * @returns {Promise<void>}
   */
  async saveActiveItem(item) {
    throw new Error('DatabaseAdapter.saveActiveItem() must be implemented by subclass.');
  }

  /**
   * Clears all active shopping list items.
   * @returns {Promise<number>} Number of items deleted.
   */
  async deleteActiveItems() {
    throw new Error('DatabaseAdapter.deleteActiveItems() must be implemented by subclass.');
  }

  /**
   * Retrieves habit tracking record for a specific item name.
   * @param {string} itemName
   * @returns {Promise<import('./types.js').ItemHabit|null>}
   */
  async getHabit(itemName) {
    throw new Error('DatabaseAdapter.getHabit() must be implemented by subclass.');
  }

  /**
   * Saves or updates a habit record.
   * @param {import('./types.js').ItemHabit} habit
   * @returns {Promise<void>}
   */
  async saveHabit(habit) {
    throw new Error('DatabaseAdapter.saveHabit() must be implemented by subclass.');
  }

  /**
   * Persists a purchase history journal record.
   * @param {import('./types.js').PurchaseHistoryRecord} record
   * @returns {Promise<void>}
   */
  async savePurchaseHistory(record) {
    throw new Error('DatabaseAdapter.savePurchaseHistory() must be implemented by subclass.');
  }

  /**
   * Optional helper to reset all database collections (primarily for testing).
   * @returns {Promise<void>}
   */
  async clearAllData() {
    throw new Error('DatabaseAdapter.clearAllData() must be implemented by subclass.');
  }
}
```

---

## 5. Mock Database Adapter (`src/db/MockDatabaseAdapter.js`)

In-memory implementation storing data in Javascript `Map` structures. Ensures deterministic, zero-external-dependency execution for unit and E2E CLI tests.

### 5.1 Key Characteristics
- Normalizes all lookup keys using `.trim().toLowerCase()`.
- Deep clones objects on read/write to prevent accidental reference mutation.
- Provides synchronous/asynchronous test inspection helpers (`getPurchaseHistory()`, `getAllHabits()`).

### 5.2 Code Template
```javascript
import { DatabaseAdapter } from './DatabaseAdapter.js';

export class MockDatabaseAdapter extends DatabaseAdapter {
  constructor(initialData = {}) {
    super();
    /** @type {Map<string, import('./types.js').ShoppingListItem>} */
    this.activeItems = new Map();
    /** @type {Map<string, import('./types.js').ItemHabit>} */
    this.habits = new Map();
    /** @type {import('./types.js').PurchaseHistoryRecord[]} */
    this.purchaseHistory = [];

    if (initialData.activeItems) {
      for (const item of initialData.activeItems) {
        const key = item.normalizedName || item.name.trim().toLowerCase();
        this.activeItems.set(key, { ...item });
      }
    }
    if (initialData.habits) {
      for (const habit of initialData.habits) {
        this.habits.set(habit.itemName.trim().toLowerCase(), { ...habit });
      }
    }
    if (initialData.purchaseHistory) {
      this.purchaseHistory = [...initialData.purchaseHistory];
    }
  }

  async getActiveItems() {
    return Array.from(this.activeItems.values()).map(item => ({ ...item }));
  }

  async saveActiveItem(item) {
    const normalized = (item.normalizedName || item.name).trim().toLowerCase();
    const cloned = {
      ...item,
      normalizedName: normalized
    };
    this.activeItems.set(normalized, cloned);
  }

  async deleteActiveItems() {
    const count = this.activeItems.size;
    this.activeItems.clear();
    return count;
  }

  async getHabit(itemName) {
    const key = itemName.trim().toLowerCase();
    const habit = this.habits.get(key);
    return habit ? JSON.parse(JSON.stringify(habit)) : null;
  }

  async saveHabit(habit) {
    const key = habit.itemName.trim().toLowerCase();
    this.habits.set(key, JSON.parse(JSON.stringify(habit)));
  }

  async savePurchaseHistory(record) {
    this.purchaseHistory.push(JSON.parse(JSON.stringify(record)));
  }

  async clearAllData() {
    this.activeItems.clear();
    this.habits.clear();
    this.purchaseHistory = [];
  }

  // Inspection helpers for testing
  async getPurchaseHistory() {
    return JSON.parse(JSON.stringify(this.purchaseHistory));
  }

  async getAllHabits() {
    return Array.from(this.habits.values()).map(h => JSON.parse(JSON.stringify(h)));
  }
}
```

---

## 6. Firestore Database Adapter (`src/db/FirestoreAdapter.js`) & Firebase Config (`src/config/firebase.js`)

### 6.1 Firebase Configuration (`src/config/firebase.js`)
Configures Firebase Admin SDK using environment variables:
- `FIREBASE_SERVICE_ACCOUNT`: JSON string containing GCP service account credentials.
- `FIRESTORE_EMULATOR_HOST`: Host address if running against local Firebase emulator (e.g. `localhost:8080`).

```javascript
import admin from 'firebase-admin';

let initialized = false;

export function getFirestoreInstance() {
  if (!initialized) {
    if (!admin.apps.length) {
      const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (serviceAccountRaw) {
        try {
          const serviceAccount = JSON.parse(serviceAccountRaw);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
          });
        } catch (err) {
          console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
          admin.initializeApp();
        }
      } else {
        // Fall back to default application credentials or emulator
        admin.initializeApp();
      }
    }
    initialized = true;
  }
  return admin.firestore();
}
```

### 6.2 Firestore Collections & Schema
1. Collection `shopping_list`: Document ID = `normalizedName`
2. Collection `habits`: Document ID = `itemName` (normalized)
3. Collection `purchase_history`: Document ID = `record.id`

### 6.3 FirestoreAdapter Implementation (`src/db/FirestoreAdapter.js`)
```javascript
import { DatabaseAdapter } from './DatabaseAdapter.js';
import { getFirestoreInstance } from '../config/firebase.js';

export class FirestoreAdapter extends DatabaseAdapter {
  constructor(db = null) {
    super();
    this.db = db || getFirestoreInstance();
    this.shoppingListColl = this.db.collection('shopping_list');
    this.habitsColl = this.db.collection('habits');
    this.historyColl = this.db.collection('purchase_history');
  }

  async getActiveItems() {
    const snapshot = await this.shoppingListColl.get();
    const items = [];
    snapshot.forEach(doc => {
      items.push(doc.data());
    });
    return items;
  }

  async saveActiveItem(item) {
    const key = (item.normalizedName || item.name).trim().toLowerCase();
    const data = {
      ...item,
      normalizedName: key
    };
    await this.shoppingListColl.doc(key).set(data);
  }

  async deleteActiveItems() {
    const snapshot = await this.shoppingListColl.get();
    if (snapshot.empty) return 0;

    const batch = this.db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    return snapshot.size;
  }

  async getHabit(itemName) {
    const key = itemName.trim().toLowerCase();
    const doc = await this.habitsColl.doc(key).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async saveHabit(habit) {
    const key = habit.itemName.trim().toLowerCase();
    await this.habitsColl.doc(key).set(habit, { merge: true });
  }

  async savePurchaseHistory(record) {
    const docId = record.id || `purch_${Date.now()}`;
    await this.historyColl.doc(docId).set(record);
  }

  async clearAllData() {
    const deleteColl = async (collRef) => {
      const snapshot = await collRef.get();
      if (snapshot.empty) return;
      const batch = this.db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    };

    await deleteColl(this.shoppingListColl);
    await deleteColl(this.habitsColl);
    await deleteColl(this.historyColl);
  }
}
```

---

## 7. Database Factory Pattern (`src/db/index.js`)

To allow seamless switching between Mock and Firestore modes via environment variables (`DB_TYPE=mock` vs `DB_TYPE=firestore` or `USE_MOCK_DB=true`), a factory function creates the appropriate adapter instance.

```javascript
import { MockDatabaseAdapter } from './MockDatabaseAdapter.js';
import { FirestoreAdapter } from './FirestoreAdapter.js';

/**
 * Creates and returns a DatabaseAdapter instance based on environment variables.
 * @param {Object} [options]
 * @param {string} [options.dbType] - Explicit override ("mock" | "firestore")
 * @returns {DatabaseAdapter}
 */
export function createDatabaseAdapter(options = {}) {
  const dbType = options.dbType || process.env.DB_TYPE || (process.env.USE_MOCK_DB === 'false' ? 'firestore' : 'mock');

  if (dbType === 'firestore') {
    return new FirestoreAdapter();
  }

  return new MockDatabaseAdapter();
}
```

---

## 8. Summary of File Locations & Target Artifacts

| File Path | Description | Milestone |
|-----------|-------------|-----------|
| `package.json` | Project metadata, scripts (`npm test`, `npm start`, `npm run cli`), and dependencies | M1 |
| `src/config/firebase.js` | Firebase Admin SDK initialization & Firestore instance retrieval | M1 |
| `src/db/DatabaseAdapter.js` | Abstract base class defining data interface contract | M1 |
| `src/db/MockDatabaseAdapter.js` | In-memory storage adapter with test/reset helpers | M1 |
| `src/db/FirestoreAdapter.js` | Cloud Firestore database storage adapter | M1 |
| `src/db/index.js` | Factory function (`createDatabaseAdapter`) for adapter instantiation | M1 |

---

## 9. Next Steps for Implementation Agent
1. Create `package.json` with ESM configuration (`"type": "module"`).
2. Create `src/config/firebase.js`.
3. Create `src/db/DatabaseAdapter.js`.
4. Create `src/db/MockDatabaseAdapter.js`.
5. Create `src/db/FirestoreAdapter.js`.
6. Create `src/db/index.js`.
7. Write unit tests under `tests/unit/db/DatabaseAdapter.test.js` validating both Mock and Firestore adapters against the interface contract.
