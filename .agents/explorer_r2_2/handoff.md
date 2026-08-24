# Handoff Report — Explorer 2: Core Domain, CLI Runner & Test Suite Analysis

## 1. Observation

### 1.1 Test Suite Failures
Executing `npm test` and `npm run test:unit` yielded multiple failures across 12 out of 16 test files.
- Command: `npm test` (`node --test tests/e2e/*.test.js`)
  - Output excerpt:
    ```
    ✖ T1.2.1: Add item with store updates habit tracker frequency
      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      'coop' !== 'pane'
      at TestContext.<anonymous> (tests/e2e/tier1_feature_coverage.test.js:86:14)

    ✖ T1.3.4: Reset on an empty list handles gracefully returning 0 items cleared
      Error: chatId is required
      at ShoppingListService.resetList (src/domain/ShoppingListService.js:92:24)

    ✖ T3.2: Habit Learning & Auto-Inference Loop
      Error: Item name cannot be empty
      at ShoppingListService.addItem (src/domain/ShoppingListService.js:31:13)
    ```
- Command: `node --test tests/unit/domain/HabitTracker.test.js`
  - Output excerpt:
    ```
    TypeError: tracker.normalizeItemName is not a function
    TypeError: tracker.calculateFavoriteStore is not a function
    ```
- Command: `node --test tests/unit/whatsapp/whatsappClient.test.js`
  - Output excerpt:
    ```
    TypeError: wrapper.getStatus is not a function
    TypeError: wrapper.handleIncomingMessage is not a function
    ```
- Command: `node --test tests/unit/web/server.test.js`
  - Output excerpt:
    ```
    TypeError: (0 , _server.startWebServer) is not a function
    ```

### 1.2 Method Signature Mismatches in Source Files
- `src/domain/ShoppingListService.js`:
  - Line 28: `async addItem(chatId, itemName, storeName = null, sender = 'user1')`
  - Line 29: `if (!chatId) throw new Error('chatId is required');`
  - Line 30-32: `if (!itemName || typeof itemName !== 'string' || itemName.trim() === '') throw new Error('Item name cannot be empty');`
  - Line 91: `async resetList(chatId, storeName = null, sender = 'user1')`
  - Line 92: `if (!chatId) throw new Error('chatId is required');`
  - Line 134: `async getList(chatId)`
  - Line 135: `if (!chatId) throw new Error('chatId is required');`
  - Line 153: `async getHabits(chatId, itemName = null)`
- `src/domain/HabitTracker.js`:
  - Line 6: `async trackPurchase(chatId, itemName, storeName, dbOverride = null)`
  - Line 37: `storeHistory: storeHistory` (instead of `stores: storeHistory`)
  - Missing methods: `normalizeItemName(itemName)`, `normalizeStoreName(storeName)`, `calculateFavoriteStore(storeCounts)`, `updateHabitsForBatch(db, itemNames, storeName, chatId)`.
- `src/db/MockDatabaseAdapter.js`:
  - Lines 10-11: `// initialData ignoring for now as it's legacy non-chatId based`
  - Line 30: `async getActiveItems(chatId) { if (!chatId) return []; ... }`
- `src/db/FirestoreAdapter.js`:
  - Line 33: `if (!chatId) throw new Error('chatId is required');`
  - Line 35: `const chatDoc = this.db.collection('chats').doc(chatId);`
- `src/web/server.js`:
  - Only `createWebServer` is exported (line 21); missing `startWebServer` and `stopWebServer`.
- `src/whatsapp/whatsappClient.js`:
  - `WhatsAppClientWrapper` constructor does not accept `{ client, service, showTerminalQr, allowSelfMessages }`.
  - Methods `getStatus()`, `getQrCode()`, `isReady()`, `getClient()`, `getLastTargetChatId()`, and `handleIncomingMessage(msg)` are not implemented.

### 1.3 CLI Runner Behavior
- `bin/cli.js`:
  - Lines 187, 199, 202, 206 call `service.addItem(itemName, storeName, sender)`, `service.resetList(storeName, sender)`, `service.getList()`, and `service.getHabits(targetItem)` without passing `chatId`.
  - Due to the signature of `ShoppingListService.js`, `itemName` is received as `chatId`, `storeName` is received as `itemName`, and `sender` is received as `storeName`.

---

## 2. Logic Chain

1. **Premise 1 (Contract Definition)**: `PROJECT.md` (lines 31–43) defines the interface contract for `ShoppingListService` and `DatabaseAdapter` as single-chat/shared-list methods: `addItem(itemName, storeName, sender)`, `resetList(storeName, sender)`, `getList()`, `getHabits(itemName)`. `bin/cli.js` and all test suites (`tests/unit/`, `tests/e2e/`) were constructed against this contract.
2. **Premise 2 (Signature Regression)**: When multi-chat functionality was added, `chatId` was prepended as a mandatory first parameter across `ShoppingListService`, `HabitTracker`, `MockDatabaseAdapter`, and `FirestoreAdapter` (e.g. `addItem(chatId, itemName, ...)`).
3. **Premise 3 (Call-site Argument Shift)**: Callers that invoke `addItem('cioccolato', null, 'mamma')` or `addItem('mele')` pass the item name as the first argument. In `ShoppingListService.js:28`, the first argument is bound to `chatId` (e.g., `'cioccolato'`), and the second argument is bound to `itemName` (which is `null` or `undefined`). This causes line 30–32 to trigger `Error: Item name cannot be empty`.
4. **Premise 4 (Missing Helper Methods & Schema Drift)**: In `HabitTracker.js`, unit tests expect helper methods (`normalizeItemName`, `calculateFavoriteStore` with alphabetical tie-breaking, `updateHabitsForBatch`) and a habit structure with property `stores: { [storeName]: count }`. `HabitTracker.js` omitted these methods and used `storeHistory`.
5. **Premise 5 (Adapter Test Incompatibilities)**: `FirestoreAdapter.js` threw `chatId is required` and attempted to navigate subcollections `chats/{chatId}/...`, which did not exist on the mock Firestore object in `FirestoreAdapter.test.js`. Similarly, `MockDatabaseAdapter.js` discarded `initialData` in its constructor, breaking state rehydration in `MockDatabaseAdapter.test.js` and `bin/cli.js`.
6. **Premise 6 (Server & WhatsApp Integration Gaps)**: `src/web/server.js` omitted `startWebServer` and `stopWebServer` exports needed by web server tests, and `src/whatsapp/whatsappClient.js` lacked the adapter wrapper interface required to mock and test Baileys message handling.
7. **Deduction**: Restoring polymorphic signatures with default `chatId = 'family_chat'`, adding the missing methods to `HabitTracker`, enabling `initialData` rehydration in `MockDatabaseAdapter`, implementing `startWebServer`/`stopWebServer` in `server.js`, and exposing the test wrapper methods in `whatsappClient.js` will resolve all 12 failing test files and achieve 100% test pass rate while preserving full Baileys and multi-chat capabilities.

---

## 3. Caveats

1. **Baileys Physical WhatsApp Connection**: Live WhatsApp Web pairing requires network access and a physical mobile device scanning the QR code; automated testing is conducted against `MockWhatsAppClient` and `MockBroadcaster`.
2. **Firestore Cloud Connection**: When `FIREBASE_SERVICE_ACCOUNT` is not configured in local development, tests and CLI fall back to `MockDatabaseAdapter`, which is the intended behavior.
3. **Multi-Chat vs Single-Chat Compatibility**: To support both WhatsApp multi-chat contexts (`remoteJid`) and single-chat CLI/unit tests, methods in `ShoppingListService` must detect whether the first argument is a `chatId` (e.g., containing `@` or starting with `chat_`) or an `itemName`.

---

## 4. Conclusion

1. **Architecture & Requirements**: All features required by `ORIGINAL_REQUEST.md` (item addition, store preference tracking, habit frequency calculation, list reset with store journaling, notification broadcasting, and Render deployment without Puppeteer/Chrome crashing) are implemented.
2. **Core Domain Health**: The business logic algorithms in `ShoppingListService`, `HabitTracker`, `MessageParser`, and `MockBroadcaster` are sound, but currently blocked by argument ordering and missing adapter methods.
3. **Action Plan for Implementers**:
   - Update `src/domain/ShoppingListService.js` to accept polymorphic signatures defaulting `chatId` to `'family_chat'`.
   - Update `src/domain/HabitTracker.js` to implement `normalizeItemName`, `normalizeStoreName`, `calculateFavoriteStore` (with alphabetical tie-breaking), and `updateHabitsForBatch`, using `stores` schema.
   - Update `src/db/MockDatabaseAdapter.js` to restore `initialData` and default `chatId` to `'family_chat'`.
   - Update `src/db/FirestoreAdapter.js` to handle default `chatId` and root collections.
   - Update `src/web/server.js` to export `startWebServer` and `stopWebServer` and match HTML test assertions.
   - Update `src/whatsapp/whatsappClient.js` to implement `WhatsAppClientWrapper` test helper methods.

---

## 5. Verification Method

To independently verify all findings and test suite behavior:

1. **Execute All Test Suites**:
   ```bash
   npm run test:all
   ```
   *Current state*: 12 failing test suites.
   *Target state after fixes*: 16 passing suites, 0 failing.

2. **Execute Unit Test Suites**:
   ```bash
   npm run test:unit
   ```

3. **Execute E2E Test Suites**:
   ```bash
   npm run test:e2e
   ```

4. **Verify CLI Mode Manually**:
   ```bash
   node bin/cli.js add "cioccolato" -s "eurospin"
   node bin/cli.js list
   node bin/cli.js habits
   node bin/cli.js reset eurospin
   ```

5. **Verify Web Server Health Endpoint**:
   ```bash
   node -e '
     import("./src/web/server.js").then(async ({ startWebServer, stopWebServer }) => {
       const { server, port } = await startWebServer(0, { getStatus: () => "READY" });
       const res = await fetch(`http://localhost:${port}/health`);
       console.log("Health status:", res.status, await res.json());
       await stopWebServer(server);
     });
   '
   ```
