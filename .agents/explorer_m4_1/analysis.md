# Milestone 4 Technical Analysis — WhatsApp Integration & Web Server

## Executive Summary
Milestone 4 introduces transport integration with WhatsApp Web using `whatsapp-web.js` and an Express web server providing uptime health checks (`/health`) and QR code scanning (`/qr`). This document presents the complete architectural investigation, event processing pipeline, QR code state management, and proposed component designs for `src/whatsapp/whatsappClient.js`, `src/broadcaster/WhatsAppBroadcaster.js`, and `src/web/server.js`.

---

## 1. Package Dependencies & Setup
Inspection of `/Users/gi/teamwork_projects/whatsapp_shopping_list/package.json` reveals the following installed dependencies:

- **WhatsApp Library**: `whatsapp-web.js` (`^1.23.0`)
  - Headless browser automation library wrapping WhatsApp Web protocol via Puppeteer.
  - Requires headless Chrome/Chromium. Supports `LocalAuth` strategy for session storage.
- **Terminal QR Code Generator**: `qrcode-terminal` (`^0.12.0`)
  - Displays QR code in the terminal console during CLI startup.
- **Web Server**: `express` (`^4.19.2`)
  - Handles HTTP endpoints `/health` (preventing Render instance sleep) and `/qr` (HTML page rendering QR code image).
- **Database Persistence**: `firebase-admin` (`^12.1.0`)
  - Cloud database adapter (`FirestoreAdapter`) when `USE_FIRESTORE === 'true'`.
- **Environment Management**: `dotenv` (`^16.4.5`)

### Key Finding on Web QR Rendering
`qrcode-terminal` renders QR codes as ASCII art in terminal output. For the `/qr` web HTTP endpoint, no extra npm packages are required; the `/qr` HTML route uses an `<img>` tag pointing to an online QR generation service (`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`) or an inline SVG string, with `<meta http-equiv="refresh" content="10">` auto-refresh header.

---

## 2. Component Requirements Analysis

### 2.1 `src/whatsapp/whatsappClient.js`
`whatsappClient.js` serves as the primary transport adapter wrapping `whatsapp-web.js`.

- **Lifecycle Event Handling**:
  - `qr`: Emitted when WhatsApp requires authentication. Captures `qr` string, updates status to `'QR_READY'`, logs QR to terminal via `qrcode-terminal`, and stores QR string for `/qr`.
  - `authenticated`: Emitted upon successful QR scan. Clears QR string, sets status to `'AUTHENTICATED'`.
  - `ready`: Emitted when client is fully synchronized and ready to send/receive messages. Sets status to `'READY'`.
  - `auth_failure`: Handles authentication errors, sets status to `'AUTH_FAILURE'`.
  - `disconnected`: Handles socket disconnects, sets status to `'DISCONNECTED'`.
  - `message` / `message_create`: Receives incoming chat messages.
- **Message Dispatching**:
  - Filters out `msg.fromMe` messages (unless configured for self-testing).
  - Extracts raw body (`msg.body`) and sender info (`msg._data?.notifyName || msg.author || msg.from`).
  - Calls `MessageParser.parse(msg.body)`.
  - Executes corresponding `ShoppingListService` domain methods.
  - Sends formatted response back to WhatsApp via `msg.reply(responseText)` or `client.sendMessage(msg.from, responseText)`.
- **Target Chat Capture**:
  - Automatically captures the latest group/DM `msg.from` as `lastTargetChatId` so `WhatsAppBroadcaster` can broadcast `reset` notifications to the active family chat if no explicit `WHATSAPP_FAMILY_CHAT_ID` environment variable is set.
- **Session Persistence & Headless Config**:
  - Utilizes `LocalAuth({ dataPath: './.wwebjs_auth' })` for session reuse across restarts.
  - Configures Puppeteer arguments (`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`) for Linux/Render compatibility.

### 2.2 `src/broadcaster/WhatsAppBroadcaster.js`
`WhatsAppBroadcaster` extends abstract base class `NotificationBroadcaster` (`src/broadcaster/NotificationBroadcaster.js`).

- **Responsibilities**:
  - Delivers notifications to WhatsApp chats via `whatsappClient.js` wrapper or raw `Client` instance.
  - Formats item added notifications and reset completion notifications.
- **Resilience**:
  - Checks if client status is `'READY'` before invoking `sendMessage`. If not ready or uninitialized, logs a warning and returns fallback notification payload to prevent throwing unhandled rejections during domain operations.

---

## 3. WhatsApp Message Event & Domain Execution Pipeline

The complete flow from WhatsApp message reception to domain execution and reply:

```
[WhatsApp Incoming Message ('message')]
                │
                ▼
[Extract text (msg.body) & sender (msg._data?.notifyName || msg.author || msg.from)]
                │
                ▼
      MessageParser.parse(text)
                │
    ┌───────────┼───────────┬───────────┬───────────┬───────────┐
    ▼           ▼           ▼           ▼           ▼           ▼
 ADD_ITEM   RESET_LIST   GET_LIST   GET_HABITS    HELP       UNKNOWN
    │           │           │           │           │           │
    │           │           │           │           │           └── reply error / help text
    │           │           │           │           └── reply help menu text
    │           │           │           └── service.getHabits(itemName) -> format & reply
    │           │           └── service.getList() -> formatListForDisplay(items) & reply
    │           └── service.resetList(storeName, sender)
    │                 ├── saves purchase history & deletes active items
    │                 └── triggers broadcaster.broadcastReset(resetRecord)
    │                       └── WhatsAppBroadcaster.broadcast(resetMsg, familyChatId)
    └── service.addItem(itemName, storeName, sender)
          └── saves active item & updates habits -> format confirmation & reply
```

### Detailed Command Mapping

| Command Type | Input Pattern | Service Method Called | WhatsApp Reply Format |
|--------------|---------------|-----------------------|-----------------------|
| `ADD_ITEM` | `"pane"`, `"pane eurospin"`, `"latte @ esselunga"` | `addItem(itemName, storeName, sender)` | `✅ Aggiunto alla lista: pane (esselunga)` |
| `RESET_LIST` | `"reset"`, `"reset eurospin"` | `resetList(storeName, sender)` | `🧹 Lista svuotata (3 articoli).` |
| `GET_LIST` | `"lista"`, `"list"`, `"mostra"` | `getList()` | `🛒 *Shopping List* (2 items):\n1. pane (esselunga)\n2. latte` |
| `GET_HABITS` | `"abitudini"`, `"habits pane"` | `getHabits(itemName)` | `📊 *Abitudini di Spesa*:\n- pane: negozio preferito = esselunga` |
| `HELP` | `"help"`, `"aiuto"`, `"?"` | N/A | `🤖 *WhatsApp Shopping List Bot*\n- Invio articolo per aggiungerlo...\n- "lista" per mostrare la lista...` |
| `UNKNOWN` | unrecognized format | N/A | `❓ Comando non riconosciuto. Scrivi 'help' per le istruzioni.` |

---

## 4. QR Code State & Web Server Integration

### 4.1 State Management in `whatsappClient.js`
`whatsappClient.js` tracks authentication lifecycle state:

```javascript
let currentQrCode = null;
let clientStatus = 'INITIALIZING'; // 'INITIALIZING' | 'QR_READY' | 'AUTHENTICATED' | 'READY' | 'DISCONNECTED' | 'AUTH_FAILURE'
let lastQrTimestamp = null;
```

### 4.2 Web Server Routes (`src/web/server.js`)

1. **`GET /health`**:
   - **Response**: HTTP 200 JSON
   ```json
   {
     "status": "ok",
     "whatsappStatus": "READY",
     "uptime": 123.45,
     "timestamp": "2026-08-10T17:50:00.000Z"
   }
   ```
   - Used by UptimeRobot or cron pings to prevent Render free instance sleep.

2. **`GET /qr`**:
   - **Response**: HTTP 200 HTML page
   - **Case A (`status === 'READY'` or `'AUTHENTICATED'`)**:
     Renders success page: `WhatsApp Client is READY! Authenticated and connected.`
   - **Case B (`currentQrCode` present)**:
     Renders scanning interface with `<meta http-equiv="refresh" content="10">`:
     ```html
     <!DOCTYPE html>
     <html>
       <head>
         <title>WhatsApp Bot - Scan QR Code</title>
         <meta http-equiv="refresh" content="10">
         <style>
           body { font-family: system-ui, sans-serif; text-align: center; background: #f0f2f5; padding: 40px; }
           .card { background: white; border-radius: 12px; padding: 32px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
           img { border: 1px solid #e0e0e0; border-radius: 8px; margin: 20px 0; }
         </style>
       </head>
       <body>
         <div class="card">
           <h1>📱 WhatsApp Web QR Code</h1>
           <p>Apri WhatsApp > Dispositivi collegati > Collega un dispositivo</p>
           <img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(currentQrCode)}" alt="QR Code" />
           <p><small>La pagina si aggiorna automaticamente ogni 10 secondi. Stato: <strong>${clientStatus}</strong></small></p>
         </div>
       </body>
     </html>
     ```
   - **Case C (`status === 'INITIALIZING'`)**:
     Renders waiting message with 5s auto-refresh until QR is generated.

---

## 5. Proposed Component File Specifications

### 5.1 `src/whatsapp/whatsappClient.js`

```javascript
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcodeTerminal from 'qrcode-terminal';
import { MessageParser } from '../domain/MessageParser.js';
import { CommandType } from '../domain/CommandType.js';

export class WhatsAppClientWrapper {
  /**
   * @param {Object} [options]
   * @param {import('../domain/ShoppingListService.js').ShoppingListService} [options.service]
   * @param {Object} [options.puppeteerOptions]
   */
  constructor(options = {}) {
    this.service = options.service || null;
    this.status = 'INITIALIZING';
    this.qrCode = null;
    this.lastQrTimestamp = null;
    this.lastTargetChatId = process.env.WHATSAPP_FAMILY_CHAT_ID || null;

    const puppeteerArgs = options.puppeteerOptions || {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    };

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: options.dataPath || './.wwebjs_auth' }),
      puppeteer: puppeteerArgs
    });

    this._setupListeners();
  }

  _setupListeners() {
    this.client.on('qr', (qr) => {
      this.qrCode = qr;
      this.status = 'QR_READY';
      this.lastQrTimestamp = Date.now();
      console.log(' [WhatsApp] New QR code generated. Scan in terminal or via /qr endpoint:');
      qrcodeTerminal.generate(qr, { small: true });
    });

    this.client.on('authenticated', () => {
      this.qrCode = null;
      this.status = 'AUTHENTICATED';
      console.log(' [WhatsApp] Client authenticated successfully.');
    });

    this.client.on('ready', () => {
      this.qrCode = null;
      this.status = 'READY';
      console.log('🚀 [WhatsApp] Client is READY!');
    });

    this.client.on('auth_failure', (msg) => {
      this.status = 'AUTH_FAILURE';
      console.error('❌ [WhatsApp] Authentication failure:', msg);
    });

    this.client.on('disconnected', (reason) => {
      this.status = 'DISCONNECTED';
      this.qrCode = null;
      console.warn('⚠️ [WhatsApp] Client disconnected:', reason);
    });

    this.client.on('message', async (msg) => {
      await this.handleIncomingMessage(msg);
    });
  }

  async initialize() {
    return this.client.initialize();
  }

  async destroy() {
    return this.client.destroy();
  }

  getQrCode() {
    return this.qrCode;
  }

  getStatus() {
    return this.status;
  }

  getClient() {
    return this.client;
  }

  getLastTargetChatId() {
    return this.lastTargetChatId;
  }

  setTargetChatId(chatId) {
    this.lastTargetChatId = chatId;
  }

  async handleIncomingMessage(msg) {
    if (!msg || msg.fromMe) return;

    const text = msg.body;
    if (!text || typeof text !== 'string') return;

    // Track last chat for broadcasting
    this.lastTargetChatId = msg.from;

    const sender = msg._data?.notifyName || (msg.author ? msg.author.split('@')[0] : msg.from.split('@')[0]) || 'whatsapp_user';
    const parsed = MessageParser.parse(text);

    if (!this.service) {
      console.warn('⚠️ [WhatsApp] ShoppingListService not attached to client wrapper.');
      return;
    }

    try {
      let replyText = '';

      switch (parsed.type) {
        case CommandType.ADD_ITEM: {
          const result = await this.service.addItem(parsed.payload.itemName, parsed.payload.storeName, sender);
          const storeStr = result.item.store ? ` (${result.item.store})` : '';
          replyText = `✅ Aggiunto alla lista: *${result.item.name}*${storeStr}`;
          break;
        }
        case CommandType.RESET_LIST: {
          const result = await this.service.resetList(parsed.payload.storeName, sender);
          const storeStr = result.resetRecord.store ? ` presso *${result.resetRecord.store.toUpperCase()}*` : '';
          replyText = `🧹 Spesa completata${storeStr}! La lista è stata svuotata (${result.itemsCleared} articoli).`;
          break;
        }
        case CommandType.GET_LIST: {
          const items = await this.service.getList();
          replyText = this.service.formatListForDisplay(items);
          break;
        }
        case CommandType.GET_HABITS: {
          const habits = await this.service.getHabits(parsed.payload.itemName);
          if (!habits || habits.length === 0) {
            replyText = '📊 Nessuna abitudine registrata finora.';
          } else {
            const lines = ['📊 *Abitudini di Spesa*:'];
            habits.forEach(h => {
              const fav = h.favoriteStore || 'nessuno';
              lines.push(`- *${h.itemName}*: negozio preferito = ${fav}`);
            });
            replyText = lines.join('\n');
          }
          break;
        }
        case CommandType.HELP: {
          replyText = `🤖 *WhatsApp Shopping List Bot*\n\n` +
            `• *Aggiungere un articolo*: scrivi il nome (es: "pane" oppure "latte esselunga")\n` +
            `• *Mostrare la lista*: scrivi "lista" o "list"\n` +
            `• *Resettare la lista*: scrivi "reset" oppure "reset esselunga"\n` +
            `• *Vedere le abitudini*: scrivi "abitudini" oppure "habits pane"\n` +
            `• *Aiuto*: scrivi "help" o "aiuto"`;
          break;
        }
        default: {
          replyText = '❓ Comando non riconosciuto. Scrivi *help* per la lista dei comandi disponibili.';
        }
      }

      if (msg.reply && typeof msg.reply === 'function') {
        await msg.reply(replyText);
      } else if (this.client && typeof this.client.sendMessage === 'function') {
        await this.client.sendMessage(msg.from, replyText);
      }
    } catch (err) {
      console.error('❌ [WhatsApp] Error processing message:', err);
      if (msg.reply && typeof msg.reply === 'function') {
        await msg.reply(`⚠️ Si è verificato un errore: ${err.message || err}`);
      }
    }
  }
}
```

### 5.2 `src/broadcaster/WhatsAppBroadcaster.js`

```javascript
import { NotificationBroadcaster } from './NotificationBroadcaster.js';

export class WhatsAppBroadcaster extends NotificationBroadcaster {
  /**
   * @param {import('../whatsapp/whatsappClient.js').WhatsAppClientWrapper|Object} clientWrapper
   * @param {Object} [options]
   * @param {string} [options.defaultRecipient]
   */
  constructor(clientWrapper, options = {}) {
    super();
    this.clientWrapper = clientWrapper || null;
    this.defaultRecipient = options.defaultRecipient || process.env.WHATSAPP_FAMILY_CHAT_ID || null;
  }

  /**
   * Broadcasts a text message to WhatsApp chat.
   * @param {string} message 
   * @param {string} [recipient] 
   * @returns {Promise<Object>}
   */
  async broadcast(message, recipient) {
    const targetRecipient = recipient || this.defaultRecipient || (this.clientWrapper?.getLastTargetChatId ? this.clientWrapper.getLastTargetChatId() : null);

    const timestamp = new Date().toISOString();
    const notification = {
      id: `wa_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      message,
      recipient: targetRecipient || 'family_chat',
      timestamp
    };

    if (!targetRecipient) {
      console.warn('⚠️ [WhatsAppBroadcaster] No recipient chat ID available for broadcast.');
      return notification;
    }

    if (this.clientWrapper && this.clientWrapper.getStatus && this.clientWrapper.getStatus() === 'READY') {
      const client = this.clientWrapper.getClient ? this.clientWrapper.getClient() : this.clientWrapper;
      if (client && typeof client.sendMessage === 'function') {
        await client.sendMessage(targetRecipient, message);
      }
    } else {
      console.warn('⚠️ [WhatsAppBroadcaster] WhatsApp client is not READY. Message queued/logged:', message);
    }

    return notification;
  }

  /**
   * Broadcast reset notification.
   * @param {Object} resetRecord 
   * @returns {Promise<Object>}
   */
  async broadcastReset(resetRecord) {
    const store = resetRecord.store || resetRecord.storeName;
    const storeText = store ? ` presso ${store.toUpperCase()}` : '';
    const itemCount = resetRecord.itemsCleared !== undefined
      ? resetRecord.itemsCleared
      : (resetRecord.items ? resetRecord.items.length : 0);

    const message = `Spesa completata${storeText}! La lista è stata svuotata (${itemCount} articoli).`;
    return this.broadcast(message);
  }

  /**
   * Broadcast generic notification.
   * @param {string} messageText 
   * @param {Object} [options] 
   * @returns {Promise<Object>}
   */
  async broadcastNotification(messageText, options = {}) {
    return this.broadcast(messageText, options.recipient);
  }

  /**
   * Broadcast item added notification.
   * @param {Object} item 
   * @returns {Promise<Object>}
   */
  async broadcastItemAdded(item) {
    const storeText = item.store ? ` (${item.store})` : '';
    const message = `Aggiunto alla lista: ${item.name}${storeText}`;
    return this.broadcast(message);
  }
}
```

### 5.3 `src/web/server.js`

```javascript
import express from 'express';

/**
 * Creates Express application instance.
 * @param {Object} options 
 * @param {Function} [options.getStatus] 
 * @param {Function} [options.getQrCode] 
 * @returns {import('express').Express}
 */
export function createExpressApp(options = {}) {
  const app = express();
  const getStatus = options.getStatus || (() => 'INITIALIZING');
  const getQrCode = options.getQrCode || (() => null);

  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      whatsappStatus: getStatus(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  app.get('/qr', (req, res) => {
    const status = getStatus();
    const qrCode = getQrCode();

    if (status === 'READY' || status === 'AUTHENTICATED') {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>WhatsApp Bot - Status</title>
            <style>
              body { font-family: system-ui, sans-serif; text-align: center; background: #e8f5e9; padding: 50px; }
              .card { background: white; border-radius: 12px; padding: 40px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
              h1 { color: #2e7d32; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>✅ WhatsApp Client Connected</h1>
              <p>Status: <strong>${status}</strong></p>
              <p>Bot is active and ready to handle shopping list messages.</p>
            </div>
          </body>
        </html>
      `);
    }

    if (qrCode) {
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`;
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>WhatsApp Bot - Scan QR Code</title>
            <meta http-equiv="refresh" content="10">
            <style>
              body { font-family: system-ui, sans-serif; text-align: center; background: #f0f2f5; padding: 40px; }
              .card { background: white; border-radius: 12px; padding: 32px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
              img { border: 1px solid #e0e0e0; border-radius: 8px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>📱 WhatsApp Web QR Code</h1>
              <p>Apri WhatsApp sul tuo telefono > Dispositivi collegati > Collega un dispositivo</p>
              <img src="${qrImageUrl}" alt="WhatsApp QR Code" />
              <p><small>La pagina si aggiorna automaticamente ogni 10 secondi. Stato: <strong>${status}</strong></small></p>
            </div>
          </body>
        </html>
      `);
    }

    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp Bot - Initializing</title>
          <meta http-equiv="refresh" content="5">
          <style>
            body { font-family: system-ui, sans-serif; text-align: center; background: #fff3e0; padding: 50px; }
            .card { background: white; border-radius: 12px; padding: 40px; display: inline-block; box-shadow: 0 4px 16px rgba(0,0,0,0.1); }
            h1 { color: #e65100; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>⏳ Initializing WhatsApp Client</h1>
            <p>Stato: <strong>${status}</strong></p>
            <p>Generazione QR code in corso... La pagina si aggiornerà tra pochi secondi.</p>
          </div>
        </body>
      </html>
    `);
  });

  return app;
}

/**
 * Starts HTTP web server listening on port.
 * @param {number} [port] 
 * @param {Object} [options] 
 * @returns {Promise<{ server: import('http').Server, app: import('express').Express }>}
 */
export function startWebServer(port = process.env.PORT || 3000, options = {}) {
  const app = createExpressApp(options);
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`🌐 [Web Server] Listening on http://localhost:${port} (/health, /qr)`);
      resolve({ server, app });
    });
  });
}
```

---

## 6. Verification Strategy & Test Harness Plan

To ensure Milestone 4 logic is 100% verified without requiring physical WhatsApp devices or real QR scans during unit/E2E test runs:

1. **`tests/unit/web/server.test.js`**:
   - Tests `/health` endpoint returning status `ok` and status string.
   - Tests `/qr` returning ready HTML when status is `'READY'`.
   - Tests `/qr` returning QR image HTML when QR code string is set.
   - Tests `/qr` returning initializing state when no QR code string exists.

2. **`tests/unit/whatsapp/whatsappClient.test.js`**:
   - Tests `WhatsAppClientWrapper` instantiation and lifecycle state methods (`getStatus()`, `getQrCode()`).
   - Mocking `Client` events (`qr`, `ready`, `authenticated`, `message`) to verify `handleIncomingMessage()` parses commands and triggers `ShoppingListService` methods (`addItem`, `resetList`, `getList`, `getHabits`, `help`).
   - Verifies `msg.reply()` is called with formatted text output.

3. **`tests/unit/broadcaster/WhatsAppBroadcaster.test.js`**:
   - Tests `broadcastReset()` formatting and delivery via mock `clientWrapper`.
   - Tests graceful behavior when client status is not `'READY'`.

---

## 7. Summary & Recommendations for Worker Implementation
1. Worker should implement `src/whatsapp/whatsappClient.js`, `src/broadcaster/WhatsAppBroadcaster.js`, and `src/web/server.js` following the exact contracts outlined in Section 5.
2. Worker should update `src/broadcaster/index.js` to export `WhatsAppBroadcaster`.
3. Worker should write unit tests in `tests/unit/web/server.test.js` and `tests/unit/whatsapp/whatsappClient.test.js`.
