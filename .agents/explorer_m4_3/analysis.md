# Milestone 4 Analysis Report: Test Strategy & Integration

## Executive Summary
This document establishes the test strategy and integration design for Milestone 4 (WhatsApp Integration & Web Server). The goal is to provide 100% fast, deterministic test coverage for the Express web server (`src/web/server.js`), the WhatsApp client adapter (`src/whatsapp/whatsappClient.js`), and the WhatsApp notification broadcaster (`src/broadcaster/WhatsAppBroadcaster.js`) without requiring physical phone pairing, QR scanning, Chromium headless browser launches, or real WhatsApp network access.

All test suites follow the project's existing Node.js native test runner (`node --test`) and assertion library (`node:assert/strict`) conventions and integrate seamlessly into `npm run test:unit` and `npm run test:all`.

---

## 1. Existing Test Conventions & Architecture Inspection

### 1.1 Node.js Native Test Runner (`node --test`)
- **Runner**: Node.js built-in `node:test` (`describe`, `test`, `it`, `beforeEach`, `afterEach`, `mock`).
- **Assertions**: Node.js `node:assert/strict` (`assert.equal`, `assert.deepEqual`, `assert.ok`, `assert.rejects`).
- **Module System**: Standard ES Modules (`"type": "module"` in `package.json`).
- **Mocking**: Native `mock.fn()` and `mock.method()` from `node:test`.

### 1.2 Test Hierarchy & Directory Structure
```
tests/
├── unit/
│   ├── broadcaster/
│   │   ├── MockBroadcaster.test.js
│   │   └── WhatsAppBroadcaster.test.js (New M4)
│   ├── cli/
│   │   └── cli.test.js
│   ├── db/
│   │   ├── DatabaseAdapter.test.js
│   │   ├── FirestoreAdapter.test.js
│   │   └── MockDatabaseAdapter.test.js
│   ├── domain/
│   │   ├── HabitTracker.test.js
│   │   ├── MessageParser.test.js
│   │   └── ShoppingListService.test.js
│   ├── web/
│   │   └── server.test.js (New M4)
│   └── whatsapp/
│       └── whatsappClient.test.js (New M4)
└── e2e/
    ├── test_helper.js
    ├── tier1_feature_coverage.test.js
    ├── tier2_boundary_corner.test.js
    ├── tier3_cross_feature.test.js
    └── tier4_real_world.test.js
```

---

## 2. Express Web Server (`src/web/server.js`) Test Strategy

### 2.1 Component Architecture Design
To make `src/web/server.js` clean and unit-testable:
1. **Factory Function**: Export `createApp({ shoppingListService, whatsappClient })` which configures Express middleware and routes without binding to a port immediately.
2. **Server Lifecycle Wrapper**: Export `createWebServer({ shoppingListService, whatsappClient, port })` returning `{ app, server, start(), stop() }`.

### 2.2 Testing Methodologies

#### Strategy A: Native Node.js `fetch()` on Ephemeral Port 0 (Zero External Dependencies)
- Start the server on port `0` (`server.listen(0)`).
- Retrieve allocated port: `const { port } = server.address()`.
- Use native `fetch(`http://localhost:${port}/health`)`.
- Close server in `afterEach()` or `after()`.

#### Strategy B: Declarative Testing with `supertest`
- If `supertest` is added as a devDependency, test routes directly against the `app` instance (`supertest(app).get('/health').expect(200)`).

### 2.3 Required Test Cases (`tests/unit/web/server.test.js`)
1. **Health Check Endpoint (`GET /health`)**:
   - Responds with `200 OK`.
   - Content-Type is `application/json`.
   - Response body contains `{ status: 'ok', uptime: number, timestamp: string }`.
2. **QR Endpoint (`GET /qr`) — Initial / Loading State**:
   - Responds with `200 OK`.
   - Content-Type is `text/html`.
   - HTML contains status indicating QR code is pending generation.
3. **QR Endpoint (`GET /qr`) — QR Code Generated**:
   - When `whatsappClient.getQrCode()` returns a valid QR string, HTML renders QR code display (e.g. formatted `<pre>` text or `<img>` element).
4. **QR Endpoint (`GET /qr`) — Authenticated / Ready State**:
   - When `whatsappClient.isReady()` is true, HTML displays "Already connected / authenticated".
5. **404 Handling**:
   - Requests to unknown routes (e.g., `GET /unknown`) return `404 Not Found`.
6. **Server Start & Graceful Shutdown**:
   - Verify `start()` begins listening and `stop()` resolves cleanly.

---

## 3. WhatsApp Broadcaster (`src/broadcaster/WhatsAppBroadcaster.js`) Test Strategy

### 3.1 Component Architecture
`WhatsAppBroadcaster` inherits from `NotificationBroadcaster` and wraps a WhatsApp client object to broadcast messages to a specified target chat ID (e.g., family group chat).

```javascript
export class WhatsAppBroadcaster extends NotificationBroadcaster {
  constructor(whatsappClient, options = {}) {
    super();
    this.client = whatsappClient;
    this.targetChatId = options.targetChatId || process.env.WHATSAPP_TARGET_CHAT_ID;
  }
}
```

### 3.2 Mocking Strategy
The test uses a simple mock client with `mock.fn()`:
```javascript
const mockClient = {
  sendMessage: mock.fn(async (chatId, text) => ({ id: 'mock_msg_1', to: chatId, body: text })),
  isReady: true
};
```

### 3.3 Required Test Cases (`tests/unit/broadcaster/WhatsAppBroadcaster.test.js`)
1. **Generic Broadcast (`broadcast(message, recipient)`)**:
   - Calls `client.sendMessage(targetChatId, message)`.
   - Returns structured notification record.
2. **Reset Notification Broadcast (`broadcastReset(resetRecord)`)**:
   - Formats message text with store name and cleared item count.
   - Calls `client.sendMessage`.
3. **Item Added Broadcast (`broadcastItemAdded(item)`)**:
   - Formats message text with item name and store info.
   - Calls `client.sendMessage`.
4. **Error Handling**:
   - Throws or logs error when `client.sendMessage` fails (e.g. network disconnection).
   - Throws error if client is missing or target chat ID is not configured.

---

## 4. WhatsApp Client Adapter (`src/whatsapp/whatsappClient.js`) Test Strategy

### 4.1 Component Architecture Design
`whatsappClient.js` coordinates event listeners, state tracking, and command dispatching to `ShoppingListService`.

To enable offline mock testing:
1. Support Dependency Injection for the underlying `whatsapp-web.js` Client.
2. Create a test helper class `MockWhatsAppWebClient` extending `EventEmitter`.

```javascript
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';

export class MockWhatsAppWebClient extends EventEmitter {
  constructor() {
    super();
    this.initialize = mock.fn(async () => {});
    this.sendMessage = mock.fn(async (to, text) => ({ id: 'mock_1', to, body: text }));
    this.destroy = mock.fn(async () => {});
  }
}
```

### 4.2 Command Routing Pipeline
When a WhatsApp message arrives (`'message'` event):
1. Extract message text (`msg.body`) and sender info (`msg.author || msg.from`).
2. Ignore messages sent by the bot itself (`msg.fromMe === true`) unless explicitly in test mode.
3. Parse text using `MessageParser.parse(msg.body)`.
4. Execute domain action via `ShoppingListService`:
   - `ADD_ITEM`: `service.addItem(...)` -> reply with confirmation.
   - `RESET_LIST`: `service.resetList(...)` -> reply with reset summary.
   - `GET_LIST`: `service.getList()` -> reply with formatted active list.
   - `GET_HABITS`: `service.getHabits(...)` -> reply with habit summary.
   - `HELP`: reply with help text.
5. Send response back using `msg.reply(responseText)`.

### 4.3 Required Test Cases (`tests/unit/whatsapp/whatsappClient.test.js`)
1. **Initialization & Lifecycle**:
   - `init()` attaches event listeners (`qr`, `authenticated`, `ready`, `message`).
2. **QR Code Event Handling**:
   - Emitting `'qr'` event stores QR code string accessible via `getQrCode()`.
3. **Ready & Auth Events**:
   - Emitting `'ready'` updates state `isReady = true`.
4. **Message Routing — Add Item**:
   - Emitting `'message'` with `"pane coop"` invokes `service.addItem('pane', 'coop', sender)`.
   - Calls `msg.reply` with confirmation containing item and store.
5. **Message Routing — Reset List**:
   - Emitting `'message'` with `"reset eurospin"` invokes `service.resetList('eurospin', sender)`.
   - Calls `msg.reply` with reset notification summary.
6. **Message Routing — Get List**:
   - Emitting `'message'` with `"lista"` calls `service.getList()` and `msg.reply(formattedList)`.
7. **Message Routing — Get Habits**:
   - Emitting `'message'` with `"abitudini latte"` calls `service.getHabits('latte')` and `msg.reply(formattedHabits)`.
8. **Message Routing — Help Command**:
   - Emitting `'message'` with `"aiuto"` calls `msg.reply(helpText)`.
9. **Self-Message Filtering & Error Resilience**:
   - Ignores `fromMe: true` messages.
   - Gracefully handles errors thrown during command execution by sending a friendly error reply.

---

## 5. Verification & Test Suite Execution

All newly designed test suites adhere strictly to the project's test command conventions:
- **Unit Suite Command**: `node --test tests/unit/**/*.test.js`
- **All Suite Command**: `node --test tests/**/*.test.js`

Executing `npm run test:unit` or `npm run test:all` automatically discovers and runs `tests/unit/web/server.test.js`, `tests/unit/whatsapp/whatsappClient.test.js`, and `tests/unit/broadcaster/WhatsAppBroadcaster.test.js`.
