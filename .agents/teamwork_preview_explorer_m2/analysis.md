# Milestone 2 Analysis: CLI / Mock Mode Runner Specification (`bin/cli.js`)

## Executive Summary
This analysis details the architecture, design, command-line argument parsing, service wiring, persistence mechanism, broadcast output formatting, and exit code specification for `bin/cli.js`. The CLI Runner binary provides a non-interactive executable interface to operate the WhatsApp Shopping List system programmatically without requiring a physical WhatsApp connection or Meta Business account, directly fulfilling Acceptance Criteria R3.

---

## 1. Executable Specification & File Header
- **File Location**: `bin/cli.js`
- **Shebang Header**: `#!/usr/bin/env node`
- **Module System**: ES Modules (`import`/`export`), consistent with `package.json` `"type": "module"`.
- **Permissions**: Executable permissions (`chmod +x bin/cli.js`).

---

## 2. Service Wiring & Dependency Architecture

```
                       ┌─────────────────────────┐
                       │       bin/cli.js        │
                       └────────────┬────────────┘
                                    │
                  ┌─────────────────┼─────────────────┐
                  │                 │                 │
                  ▼                 ▼                 ▼
         ┌────────────────┐ ┌───────────────┐ ┌──────────────┐
         │ MessageParser  │ │ShoppingListSvc│ │MockBroadcaster│
         └────────────────┘ └───────┬───────┘ └───────┬──────┘
                                    │                 │
                                    ▼                 ▼
                         ┌────────────────────┐ ┌───────────┐
                         │  DatabaseAdapter   │ │ stdout /  │
                         │ (Mock or Firestore)│ │  stderr   │
                         └────────────────────┘ └───────────┘
```

### Dependency Instantiation Matrix
1. **Database Adapter Selection**:
   - Default: `MockDatabaseAdapter` initialized with file-backed JSON state persistence (`.mock_db.json` or `process.env.MOCK_DB_FILE`).
   - Cloud Option: If `process.env.USE_FIRESTORE === 'true'` or `process.env.FIREBASE_SERVICE_ACCOUNT` is set (or `--db firestore` option passed), instantiate `FirestoreAdapter`.
2. **Broadcaster**:
   - `MockBroadcaster` with an `onBroadcast` listener callback registered to format and print real-time notifications to `stdout`.
3. **Domain Services**:
   - `HabitTracker(db)`
   - `ShoppingListService(db, broadcaster, habitTracker)`

---

## 3. Argument Parsing & Command Specification

The CLI runner processes arguments from `process.argv.slice(2)` using a combination of option flag extraction (`--store`, `-s`, `--sender`, `--db`) and `MessageParser` integration for natural language text.

### Supported Commands & Syntax Matrix

| Command | CLI Invocation Examples | Extracted Parameters | Service Action |
|---------|-------------------------|----------------------|----------------|
| `add` | `node bin/cli.js add "cioccolato"`<br>`node bin/cli.js add "cioccolato" --store "eurospin"`<br>`node bin/cli.js add "cioccolato -s eurospin"`<br>`node bin/cli.js add "cioccolato eurospin"`<br>`node bin/cli.js add "cioccolato @ eurospin"` | `itemName`: "cioccolato"<br>`storeName`: "eurospin" or null | `service.addItem(itemName, storeName, sender)` |
| `reset` | `node bin/cli.js reset`<br>`node bin/cli.js reset --store "coop"`<br>`node bin/cli.js reset -s "coop"`<br>`node bin/cli.js reset "coop"`<br>`node bin/cli.js reset "@ coop"` | `storeName`: "coop" or null | `service.resetList(storeName, sender)` |
| `list` | `node bin/cli.js list`<br>`node bin/cli.js lista` | None | `service.getList()` |
| `habits` | `node bin/cli.js habits`<br>`node bin/cli.js habits "cioccolato"` | `itemName`: optional string | `service.getHabits(itemName)` |
| `help` | `node bin/cli.js help`<br>`node bin/cli.js --help`<br>`node bin/cli.js -h` | None | Display usage text |

### Detailed Command Parsing Rules

#### 1. Option Flags Handling
- `-s, --store <name>`: Explicitly specifies the store associated with an item addition or list reset.
- `--sender <name>`: Specifies the sender identity (defaults to `"cli_user"`).
- `--db <type>`: Overrides DB selection (`mock` or `firestore`).
- `-h, --help`: Triggers help text display.

#### 2. Item & Store Extraction Logic for `add`
```javascript
// Step 1: Parse flags (--store / -s / --sender)
// Step 2: If --store flag is present, itemName is the remaining non-flag arguments joined by space.
// Step 3: If --store flag is NOT present, delegate to MessageParser._parseAddItem(rawText)
//         to support natural syntax like "cioccolato eurospin" or "cioccolato @ eurospin".
```

#### 3. Store Extraction Logic for `reset`
```javascript
// Step 1: Check for explicit --store flag.
// Step 2: If omitted, check remaining positional args (e.g. `reset coop` or `reset @ coop`).
// Step 3: Strip leading prepositions (@, at, da, in, -).
```

---

## 4. State Persistence for Mock Mode Across CLI Executions

Because each CLI execution (`node bin/cli.js ...`) runs as an independent Node.js process (such as when invoked via `spawnSync` in E2E tests or terminal scripts), purely in-memory data in `MockDatabaseAdapter` would be lost between commands.

### File-Backed Mock State Solution
- **File Location**: `.mock_db.json` (or path from `process.env.MOCK_DB_FILE`).
- **Data Structure**:
  ```json
  {
    "activeItems": [
      {
        "id": "item_123",
        "name": "mele",
        "canonicalName": "mele",
        "store": "coop",
        "storeInferred": false,
        "addedBy": "cli_user",
        "createdAt": "2026-08-10T15:45:00.000Z"
      }
    ],
    "habits": [
      {
        "itemName": "mele",
        "favoriteStore": "coop",
        "stores": { "coop": 1 }
      }
    ],
    "purchaseHistory": []
  }
  ```
- **Lifecycle**:
  1. On startup, `bin/cli.js` loads `.mock_db.json` if present and passes `initialData` to `MockDatabaseAdapter`.
  2. The service executes the command.
  3. Before exiting, `bin/cli.js` exports state (`getActiveItems()`, `getAllHabits()`, `getPurchaseHistory()`) and writes back to `.mock_db.json`.

---

## 5. Broadcast Output & Terminal Display Specification

### 1. Broadcast Notification Listener
When `service.resetList(storeName)` is called, `MockBroadcaster.broadcastReset()` generates a notification entry and invokes listeners registered via `broadcaster.onBroadcast(callback)`.

### 2. Formatted Console Displays

- **Broadcast Trigger Display**:
  ```
  📢 [BROADCAST NOTIFICATION -> family_chat]
  Spesa completata presso EUROSPIN! La lista è stata svuotata (3 articoli).
  ```

- **`add` Output**:
  ```
  ✅ Added "cioccolato" (store: eurospin) to shopping list.
  ```

- **`reset` Output**:
  ```
  🧹 Shopping list reset. Cleared 3 item(s).
  📢 [BROADCAST -> family_chat] Spesa completata presso EUROSPIN! La lista è stata svuotata (3 articoli).
  ```

- **`list` Output**:
  ```
  🛒 Shopping List (2 items):
  1. pasta barilla
  2. latte fresco (eurospin - favorite)
  ```

- **`habits` Output**:
  ```
  📊 Shopping Habits (1 item(s)):
  - cioccolato: favorite store = eurospin (purchases: eurospin: 2, coop: 1)
  ```

---

## 6. Exit Code & Error Handling Matrix

| Scenario | Output Stream | Exit Code | Message Format |
|----------|---------------|-----------|----------------|
| Successful `add`, `reset`, `list`, `habits` | `stdout` | `0` | Formatted success message & broadcast output |
| Explicit `help` command (`node bin/cli.js help`) | `stdout` | `0` | Usage text with command & option breakdown |
| Invalid / unknown command (`node bin/cli.js foo`) | `stderr` | `1` | `Error: Unknown command "foo". Run "node bin/cli.js help" for usage.` |
| Empty / missing item name (`node bin/cli.js add`) | `stderr` | `1` | `Error: Item name cannot be empty.` |
| Service / Database runtime error | `stderr` | `1` | `Error: <error message>` |

---

## 7. Verification Method
1. **Unit & Manual CLI Verification**:
   - `node bin/cli.js add mele --store coop` (Exit status: 0)
   - `node bin/cli.js list` (Exit status: 0, output contains "mele (coop)")
   - `node bin/cli.js reset --store coop` (Exit status: 0, output contains broadcast banner)
   - `node bin/cli.js list` (Exit status: 0, output contains "Shopping list is currently empty")
2. **Automated E2E Suite**:
   - Run `npm test` (or `node --test tests/e2e/tier4_real_world.test.js`). Test case `T4.4: CLI Binary Execution End-to-End (bin/cli.js)` will execute against `bin/cli.js` and verify zero-exit codes and stdout contents.
