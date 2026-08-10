# Technical Analysis & Specification: MessageParser & Broadcaster Architecture (Milestone 1)

**Agent:** teamwork_preview_explorer_m1_3  
**Working Directory:** `/Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/teamwork_preview_explorer_m1_3`  
**Date:** 2026-08-10  
**Target Components:**
- `src/domain/MessageParser.js`
- `src/broadcaster/NotificationBroadcaster.js`
- `src/broadcaster/MockBroadcaster.js`

---

## 1. Executive Summary & Objective

This report provides the full architectural specification and concrete implementation design for `MessageParser`, `NotificationBroadcaster`, and `MockBroadcaster`.

These three modules form the messaging and notification backbone of the WhatsApp Shopping List application:
1. **`MessageParser`**: Translates unstructured chat input (from WhatsApp or CLI) into structured command intents (`ADD_ITEM`, `RESET_LIST`, `GET_LIST`, `GET_HABITS`, `HELP`, `UNKNOWN`), extracting item names and optional store names according to clear natural-language parsing rules.
2. **`NotificationBroadcaster`**: Defines an abstract interface contract for broadcasting notifications (such as shopping list reset alerts or item additions) across transport layers.
3. **`MockBroadcaster`**: Provides an in-memory, deterministic test double implementing `NotificationBroadcaster` that captures all outbound notifications for CLI output display and unit/E2E assertion.

---

## 2. Component Specification: `src/domain/MessageParser.js`

### 2.1 Responsibilities
- Parse raw incoming string messages from WhatsApp or CLI input.
- Recognize explicit system commands (`reset`, `list`/`lista`, `habits`/`abitudini`, `help`/`aiuto`).
- Parse shopping list addition intents, supporting both simple item additions (e.g., `"cioccolato"`) and item+store additions (e.g., `"cioccolato eurospin"`, `"cioccolato @ eurospin"`, `"pane da coop"`).
- Normalize item and store strings (trimming whitespace, lowercase conversion for comparisons while preserving clean display formatting).
- Return a strongly-typed `ParsedCommand` payload.

### 2.2 Command Types Enum (`CommandType`)
```js
export const CommandType = {
  ADD_ITEM: 'ADD_ITEM',     // Adding item (with optional store association)
  RESET_LIST: 'RESET_LIST', // Resetting active shopping list (with optional store)
  GET_LIST: 'GET_LIST',     // Querying current active shopping list
  GET_HABITS: 'GET_HABITS', // Querying habit stats / recommendations
  HELP: 'HELP',             // Displaying usage instructions
  UNKNOWN: 'UNKNOWN'        // Invalid/unrecognized input or empty message
};
```

### 2.3 Data Contract: `ParsedCommand`
```js
/**
 * @typedef {Object} ParsedCommand
 * @property {string} type - One of CommandType values
 * @property {Object} payload - Command payload parameters
 * @property {string} [payload.itemName] - Normalized item name (if ADD_ITEM)
 * @property {string|null} [payload.storeName] - Normalized store name (if ADD_ITEM or RESET_LIST)
 * @property {string} payload.rawText - Original unparsed input string
 * @property {boolean} isValid - Whether input was successfully parsed
 * @property {string} [error] - Error message if invalid
 */
```

### 2.4 Natural Language Grammar & Extraction Rules

#### Rule 1: Reset Command (`RESET_LIST`)
- Matches if raw text starts with word `"reset"` (case-insensitive).
- **Sub-case 1.1 (Reset without store)**: `"reset"`, `"RESET"`, `"reset "`  
  -> `storeName` = `null`
- **Sub-case 1.2 (Reset with store)**: `"reset eurospin"`, `"reset @ esselunga"`, `"reset da coop"`  
  -> Strips `"reset"`, strips optional prepositions (`@`, `at`, `da`, `in`), trims remainder -> `storeName` = `"eurospin"`.

#### Rule 2: Query Commands (`GET_LIST`, `GET_HABITS`, `HELP`)
- **GET_LIST**: Exact match (after lowercase & trim) to `"list"`, `"lista"`, `"mostra"`, `"show list"`, `"shopping list"`.
- **GET_HABITS**: Exact match to `"habits"`, `"abitudini"`, `"statistiche"`, `"stats"`.
- **HELP**: Exact match to `"help"`, `"aiuto"`, `"?"`, `"info"`.

#### Rule 3: Item Addition Command (`ADD_ITEM`)
If the message is not empty and does not match Rules 1 or 2, it is treated as an item addition.
Store extraction operates in two passes:
1. **Explicit Delimiter Pass**: Inspect if message contains explicit store separators:
   - Separators: `@`, ` at `, ` da `, ` in `, `-` (e.g. `"cioccolato @ eurospin"`, `"pane da coop"`, `"latte - esselunga"`).
   - If present: split string at delimiter. Left side = `itemName`, right side = `storeName`.
2. **Implicit Multi-Word Fallback Pass**:
   - If no explicit delimiter is found:
     - Single word input (e.g. `"cioccolato"`): `itemName` = `"cioccolato"`, `storeName` = `null`.
     - Multi-word input (e.g. `"cioccolato eurospin"`):
       - If total words = 2: first word = `itemName`, second word = `storeName`.
       - If total words > 2: check if last word is a known store or matches common store patterns; if matched, last word = `storeName` and remaining preceding words = `itemName`. Otherwise, entire text = `itemName`, `storeName` = `null`.

### 2.5 Edge Case Test Matrix
| Raw Input | Expected `type` | Expected `itemName` | Expected `storeName` | Expected `isValid` |
|---|---|---|---|---|
| `"cioccolato"` | `ADD_ITEM` | `"cioccolato"` | `null` | `true` |
| `"cioccolato eurospin"` | `ADD_ITEM` | `"cioccolato"` | `"eurospin"` | `true` |
| `"cioccolato @ eurospin"` | `ADD_ITEM` | `"cioccolato"` | `"eurospin"` | `true` |
| `"pane integral da coop"` | `ADD_ITEM` | `"pane integral"` | `"coop"` | `true` |
| `"reset"` | `RESET_LIST` | `undefined` | `null` | `true` |
| `"reset eurospin"` | `RESET_LIST` | `undefined` | `"eurospin"` | `true` |
| `"reset @ esselunga"` | `RESET_LIST` | `undefined` | `"esselunga"` | `true` |
| `"lista"` | `GET_LIST` | `undefined` | `null` | `true` |
| `"abitudini"` | `GET_HABITS` | `undefined` | `null` | `true` |
| `"  "` | `UNKNOWN` | `undefined` | `null` | `false` |

### 2.6 Class Implementation Blueprint (`src/domain/MessageParser.js`)
```js
import { CommandType } from './CommandType.js'; // or exported directly

export class MessageParser {
  /**
   * Parse a raw text message into a structured command.
   * @param {string} rawText 
   * @returns {ParsedCommand}
   */
  static parse(rawText) {
    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
      return {
        type: CommandType.UNKNOWN,
        payload: { rawText: rawText || '' },
        isValid: false,
        error: 'Empty or invalid message text'
      };
    }

    const trimmed = rawText.trim();
    const lower = trimmed.toLowerCase();

    // 1. Check Query / Help commands
    if (['list', 'lista', 'mostra', 'show list'].includes(lower)) {
      return { type: CommandType.GET_LIST, payload: { rawText: trimmed }, isValid: true };
    }
    if (['habits', 'abitudini', 'statistiche', 'stats'].includes(lower)) {
      return { type: CommandType.GET_HABITS, payload: { rawText: trimmed }, isValid: true };
    }
    if (['help', 'aiuto', '?', 'info'].includes(lower)) {
      return { type: CommandType.HELP, payload: { rawText: trimmed }, isValid: true };
    }

    // 2. Check Reset command
    if (lower === 'reset' || lower.startsWith('reset ')) {
      const rest = trimmed.slice(5).trim();
      let storeName = null;

      if (rest.length > 0) {
        // Strip leading prepositions if present (@, at, da, in, -)
        storeName = rest.replace(/^(@|at|da|in|-)\s+/i, '').trim() || null;
      }

      return {
        type: CommandType.RESET_LIST,
        payload: { storeName: storeName ? storeName.toLowerCase() : null, rawText: trimmed },
        isValid: true
      };
    }

    // 3. Parse Add Item command
    const addPayload = MessageParser._parseAddItem(trimmed);
    return {
      type: CommandType.ADD_ITEM,
      payload: {
        itemName: addPayload.itemName,
        storeName: addPayload.storeName,
        rawText: trimmed
      },
      isValid: true
    };
  }

  static _parseAddItem(text) {
    // Explicit delimiter check (@, at, da, in, -)
    const delimiterRegex = /\s+(@|at|da|in|-)\s+/i;
    const match = text.match(delimiterRegex);

    if (match) {
      const splitIdx = match.index;
      const itemName = text.slice(0, splitIdx).trim().toLowerCase();
      const storeName = text.slice(splitIdx + match[0].length).trim().toLowerCase();
      return { itemName, storeName: storeName || null };
    }

    // Space split heuristic
    const tokens = text.split(/\s+/);
    if (tokens.length === 2) {
      return {
        itemName: tokens[0].toLowerCase(),
        storeName: tokens[1].toLowerCase()
      };
    }

    return {
      itemName: text.toLowerCase(),
      storeName: null
    };
  }
}
```

---

## 3. Component Specification: `src/broadcaster/NotificationBroadcaster.js`

### 3.1 Responsibilities
- Abstract base class establishing the contract for sending notifications to users or chat groups.
- Defines standard methods for list reset notifications, general broadcasts, and item additions.
- Throws descriptive `Error` in base implementation if concrete subclasses fail to implement required methods.

### 3.2 Method Contracts & JSDoc Specification
```js
/**
 * Abstract Base Class for Notification Broadcasters.
 * Implementations include MockBroadcaster (testing/CLI) and WhatsAppBroadcaster (production).
 */
export class NotificationBroadcaster {
  /**
   * Broadcast a notification when the shopping list is reset.
   * @param {Object} resetRecord - Purchase history record generated during reset
   * @param {string} [resetRecord.storeName] - Name of store where purchase occurred
   * @param {number} resetRecord.itemsCleared - Total count of items reset
   * @param {Array<Object>} [resetRecord.items] - List of cleared item objects
   * @param {string} [resetRecord.clearedBy] - Sender/user initiating reset
   * @returns {Promise<BroadcastResult>}
   */
  async broadcastReset(resetRecord) {
    throw new Error('NotificationBroadcaster.broadcastReset() must be implemented by subclass.');
  }

  /**
   * Broadcast an arbitrary message or system announcement.
   * @param {string} messageText - Message text to broadcast
   * @param {Object} [options] - Additional dispatch metadata
   * @returns {Promise<BroadcastResult>}
   */
  async broadcastNotification(messageText, options = {}) {
    throw new Error('NotificationBroadcaster.broadcastNotification() must be implemented by subclass.');
  }

  /**
   * Broadcast a notification when a new item is added.
   * @param {Object} item - Added item object
   * @returns {Promise<BroadcastResult>}
   */
  async broadcastItemAdded(item) {
    throw new Error('NotificationBroadcaster.broadcastItemAdded() must be implemented by subclass.');
  }
}

/**
 * @typedef {Object} BroadcastResult
 * @property {boolean} success - Whether broadcast succeeded
 * @property {string} messageId - Unique ID generated for the broadcast event
 * @property {string} messageText - Formatted string sent to recipients
 * @property {string} timestamp - ISO timestamp of dispatch
 * @property {number} recipientCount - Number of target recipients notified
 */
```

---

## 4. Component Specification: `src/broadcaster/MockBroadcaster.js`

### 4.1 Responsibilities
- In-memory implementation of `NotificationBroadcaster`.
- Stores every broadcast event in an internal history list for programmatic assertion during unit and E2E tests.
- Provides listener callback registration (`onBroadcast`) so CLI runners or tests can react to real-time broadcasts.
- Provides test convenience helpers (`getCapturedNotifications()`, `getLastNotification()`, `clear()`).

### 4.2 Class Implementation Blueprint (`src/broadcaster/MockBroadcaster.js`)
```js
import { NotificationBroadcaster } from './NotificationBroadcaster.js';

export class MockBroadcaster extends NotificationBroadcaster {
  constructor() {
    super();
    /** @type {Array<Object>} */
    this.capturedNotifications = [];
    /** @type {Array<Function>} */
    this.listeners = [];
  }

  /**
   * Broadcast reset notification and record event.
   * @param {Object} resetRecord 
   * @returns {Promise<Object>}
   */
  async broadcastReset(resetRecord) {
    const storeText = resetRecord.storeName ? ` presso ${resetRecord.storeName}` : '';
    const itemCount = resetRecord.itemsCleared || (resetRecord.items ? resetRecord.items.length : 0);
    const messageText = `🛒 Lista della spesa resettata! Acquistati ${itemCount} articoli${storeText}.`;

    const entry = {
      id: `mock_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'RESET',
      messageText,
      payload: resetRecord,
      timestamp: new Date().toISOString(),
      recipientCount: 1
    };

    this.capturedNotifications.push(entry);
    this._notifyListeners(entry);

    return {
      success: true,
      messageId: entry.id,
      messageText: entry.messageText,
      timestamp: entry.timestamp,
      recipientCount: entry.recipientCount
    };
  }

  /**
   * Broadcast arbitrary text notification.
   * @param {string} messageText 
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async broadcastNotification(messageText, options = {}) {
    const entry = {
      id: `mock_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'GENERIC',
      messageText,
      payload: options,
      timestamp: new Date().toISOString(),
      recipientCount: 1
    };

    this.capturedNotifications.push(entry);
    this._notifyListeners(entry);

    return {
      success: true,
      messageId: entry.id,
      messageText: entry.messageText,
      timestamp: entry.timestamp,
      recipientCount: entry.recipientCount
    };
  }

  /**
   * Broadcast item added notification.
   * @param {Object} item 
   * @returns {Promise<Object>}
   */
  async broadcastItemAdded(item) {
    const storeText = item.storeName ? ` (${item.storeName})` : '';
    const messageText = `Aggiunto alla lista: ${item.name}${storeText}`;

    const entry = {
      id: `mock_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: 'ITEM_ADDED',
      messageText,
      payload: item,
      timestamp: new Date().toISOString(),
      recipientCount: 1
    };

    this.capturedNotifications.push(entry);
    this._notifyListeners(entry);

    return {
      success: true,
      messageId: entry.id,
      messageText: entry.messageText,
      timestamp: entry.timestamp,
      recipientCount: entry.recipientCount
    };
  }

  // --- Inspection & Utility Methods for Tests/CLI ---

  /**
   * Get all captured notification entries.
   * @returns {Array<Object>}
   */
  getCapturedNotifications() {
    return [...this.capturedNotifications];
  }

  /**
   * Get the most recently captured notification entry.
   * @returns {Object|null}
   */
  getLastNotification() {
    if (this.capturedNotifications.length === 0) return null;
    return this.capturedNotifications[this.capturedNotifications.length - 1];
  }

  /**
   * Filter captured notifications by type ('RESET', 'GENERIC', 'ITEM_ADDED').
   * @param {string} type 
   * @returns {Array<Object>}
   */
  getNotificationsByType(type) {
    return this.capturedNotifications.filter(n => n.type === type);
  }

  /**
   * Subscribe a listener callback to real-time broadcasts.
   * @param {Function} callback 
   * @returns {Function} Unsubscribe function
   */
  onBroadcast(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Clear all captured history and listeners.
   */
  clear() {
    this.capturedNotifications = [];
    this.listeners = [];
  }

  _notifyListeners(entry) {
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (err) {
        console.error('Error in MockBroadcaster listener:', err);
      }
    }
  }
}
```

---

## 5. Integration Architecture & Inter-Module Wiring

```
           +-------------------------+
           | Incoming Raw Message    |
           | (CLI / WhatsApp Client) |
           +------------+------------+
                        |
                        v
            +-----------------------+
            |  MessageParser.parse  |
            +-----------+-----------+
                        |
                        v ParsedCommand { type, payload }
            +-----------+-----------+
            |  ShoppingListService  |
            +-----------+-----------+
                        |
          +-------------+-------------+
          |                           |
          v DB operations             v Broadcast triggers
+-------------------+      +--------------------------+
|  DatabaseAdapter  |      | NotificationBroadcaster  |
| (Mock / Firestore)|      | (Mock / WhatsApp)        |
+-------------------+      +--------------------------+
```

### Wiring Flow:
1. `MessageParser` receives raw string input and produces a `ParsedCommand`.
2. Controller / CLI runner inspects `command.type`:
   - If `ADD_ITEM`: calls `shoppingListService.addItem(command.payload.itemName, command.payload.storeName)`.
   - If `RESET_LIST`: calls `shoppingListService.resetList(command.payload.storeName)`.
   - If `GET_LIST`: calls `shoppingListService.getList()`.
   - If `GET_HABITS`: calls `shoppingListService.getHabits()`.
3. `ShoppingListService.resetList()` invokes `broadcaster.broadcastReset(resetRecord)` after updating DB active items & purchase history.
4. In test / CLI environment, `MockBroadcaster` captures the notification and triggers any registered `onBroadcast` handlers (which print to CLI or serve as test assertions).

---

## 6. Actionable Implementation Plan for Implementer Agents

When Milestone 1 implementation begins:

1. **Step 1 — Create `src/domain/CommandType.js` & `src/domain/MessageParser.js`**:
   - Implement `CommandType` constants.
   - Implement `MessageParser` class with static `parse()` and internal regex/delimiter helpers.
   - Write unit tests in `tests/unit/MessageParser.test.js` validating all rows in the edge case test matrix.

2. **Step 2 — Create `src/broadcaster/NotificationBroadcaster.js`**:
   - Implement abstract base class with standard JSDoc definitions.
   - Throw descriptive errors if abstract methods are called directly.

3. **Step 3 — Create `src/broadcaster/MockBroadcaster.js`**:
   - Extend `NotificationBroadcaster`.
   - Implement `broadcastReset`, `broadcastNotification`, and `broadcastItemAdded`.
   - Add test utilities: `getCapturedNotifications()`, `getLastNotification()`, `getNotificationsByType()`, `onBroadcast()`, `clear()`.
   - Write unit tests in `tests/unit/MockBroadcaster.test.js` validating history capture, message formatting, and listener callbacks.

---

## 7. Verification Method

To verify this specification:
1. Validate that all command forms in `ORIGINAL_REQUEST.md` (`"cioccolato"`, `"cioccolato eurospin"`, `"reset"`, `"reset eurospin"`) map correctly to `MessageParser` output schemas.
2. Confirm that `MockBroadcaster` interface satisfies all reset notification requirements in R3 of `ORIGINAL_REQUEST.md`.
3. Ensure no external npm dependencies are required for `MessageParser` or `MockBroadcaster` (pure standard ES Modules).
