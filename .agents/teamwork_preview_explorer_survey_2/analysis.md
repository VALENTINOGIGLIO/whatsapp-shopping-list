# Technical Analysis & Feasibility Survey: WhatsApp Shopping List Bot

**Project:** WhatsApp Shared Family Shopping List Bot  
**Agent:** `teamwork_preview_explorer_survey_2`  
**Date:** 2026-08-10  
**Target Architecture:** Node.js, Firebase Cloud Database, Render Free Tier, WhatsApp Web Automation  

---

## 1. Executive Summary & Survey Objectives

This analysis investigates the technical requirements, architectural patterns, and deployment strategy for building a free, serverless/cloud-hosted WhatsApp bot for family shopping list management. The system enables multi-user list editing, store-based habit tracking, broadcast reset notifications, and programmatic testing via a local CLI mock mode.

### Core Goals:
1. **Zero-Cost Operation:** Utilize free cloud database infrastructure (Firebase Firestore Spark Tier) and free cloud hosting (Render Free Tier Web Service).
2. **WhatsApp Automation without Paid APIs:** Evaluate `whatsapp-web.js` and `@whiskeysockets/baileys` to bypass Meta WhatsApp Business API costs while ensuring operational stability.
3. **Robust Session Persistence & Cloud Compatibility:** Overcome Render’s ephemeral filesystem limitations by implementing remote session persistence in the cloud database.
4. **Programmatic Verification:** Architect a decoupled controller layer to allow offline CLI testing without requiring physical WhatsApp QR code scanning.

---

## 2. WhatsApp Integration Survey: `whatsapp-web.js` vs `@whiskeysockets/baileys`

### 2.1 Technical Comparison

| Dimension | `whatsapp-web.js` | `@whiskeysockets/baileys` |
| :--- | :--- | :--- |
| **Underlying Technology** | Puppeteer (Headless Chromium) | Direct WebSockets + WhatsApp Protobuf API |
| **RAM Footprint** | 350 MB – 600 MB (High OOM risk on 512 MB instances) | 30 MB – 80 MB (Lightweight & efficient) |
| **System Dependencies** | Chromium binaries, Linux X11/GL libraries (`libnss3`, `libatk-bridge`, etc.) | None (Pure JavaScript/TypeScript) |
| **Render Compatibility** | Requires Docker container or special buildpack flags | Runs directly out-of-the-box on Standard Node runtime |
| **Session Persistence** | `LocalAuth` (Local disk) or `RemoteAuth` (`wwebjs-mongo` / custom adapter) | `useMultiFileAuthState` (Local JSON) or custom Firebase/Mongo Auth Store |
| **QR Code Delivery** | String event `qr` -> rendered via `qrcode-terminal` or Data URI | String event `connection.update` -> rendered via `qrcode-terminal` or Data URI |
| **Maintenance & Community** | High adoption, active community | High performance, widely used for resource-constrained bots |

### 2.2 In-Depth Analysis of `whatsapp-web.js`

If `whatsapp-web.js` is selected:
- **Puppeteer Flags for Render:** Headless Chrome must be initialized with strict resource-limiting flags to avoid crashing Render’s 512MB RAM limit:
  ```javascript
  const client = new Client({
    authStrategy: new RemoteAuth({ store: firestoreStore, backupSyncIntervalMs: 60000 }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    }
  });
  ```
- **RemoteAuth Strategy:** Standard `LocalAuth` writes to `./.wwebjs_auth`, which Render wipes on container restart. `RemoteAuth` must be implemented using a custom Firebase Firestore adapter or MongoDB Atlas store (`wwebjs-mongo`).

### 2.3 In-Depth Analysis of `@whiskeysockets/baileys` (Recommended Alternative)

If `@whiskeysockets/baileys` is selected:
- **Zero-Browser Footprint:** Baileys directly connects to WhatsApp WebSocket servers using Protobuf payloads. This consumes under 60 MB of RAM, leaving plenty of memory headroom on Render's 512 MB free tier.
- **Custom Auth Provider for Firebase:** Session credentials and signal keys can be serialized into a Firestore collection (`whatsapp_session`), eliminating local file dependencies completely:
  ```javascript
  // Custom Firestore Auth Handler for Baileys
  const useFirestoreAuthState = async (db, sessionId) => {
    // Reads and writes credentials directly to doc: `whatsapp_sessions/${sessionId}`
  };
  ```

### 2.4 Verdict & Recommendation
For deployment on Render’s 512 MB Free Tier, **`@whiskeysockets/baileys` is technically superior** due to its low RAM footprint and zero native binary requirements. However, if standard `whatsapp-web.js` is strictly required, the system **must use Docker** or set explicit Puppeteer flags `--disable-dev-shm-usage --no-sandbox` with a Firestore `RemoteAuth` adapter.

---

## 3. Database & State Architecture (Firebase Firestore)

Firebase Firestore (Spark Free Plan) provides 1 GiB storage, 50,000 reads/day, and 20,000 writes/day, which easily accommodates family usage.

### 3.1 Data Schema Design

```
firestore-root/
│
├── active_list/ (Collection)
│   └── {itemId} (Document)
│       ├── name: string ("cioccolato")
│       ├── store: string | null ("eurospin")
│       ├── addedBy: string ("+393331234567" or "CLI User")
│       ├── addedAt: timestamp
│       └── status: "pending"
│
├── habits/ (Collection)
│   └── {normalizedItemName} (Document, e.g., "cioccolato")
│       ├── itemName: string ("cioccolato")
│       ├── defaultStore: string ("eurospin")
│       ├── totalPurchased: number (12)
│       ├── storeCounts: map { "eurospin": 10, "coop": 2 }
│       └── lastUpdated: timestamp
│
├── purchase_history/ (Collection)
│   └── {resetId} (Document)
│       ├── resetAt: timestamp
│       ├── resetBy: string
│       ├── store: string | null ("eurospin")
│       ├── itemsCleared: array [ { name: "cioccolato", store: "eurospin" }, ... ]
│       └── itemCount: number
│
└── whatsapp_session/ (Collection - for Cloud RemoteAuth)
    └── auth_data (Document)
        └── sessionData: map / json string
```

### 3.2 Key Database Operations

1. **`addItem(itemName, storeName, sender)`**
   - Normalizes `itemName` (lowercase, trimmed).
   - If `storeName` is omitted, queries `habits/{normalizedItemName}` to auto-suggest or infer `defaultStore`.
   - Inserts document into `active_list`.
   - Updates `habits/{normalizedItemName}` with `storeCounts` increment if store was explicitly provided.

2. **`resetList(storeName, sender)`**
   - Retrieves all documents in `active_list`.
   - Creates a new document in `purchase_history` recording the cleared items and specified store.
   - Batch deletes all documents in `active_list`.
   - Updates `habits` collection for each cleared item, recording the purchase event under `storeName`.

---

## 4. System Architecture & Component Decoupling

To satisfy requirement R3 and Acceptance Criteria (CLI verification without WhatsApp scanning), the application must be designed using the **Adapter / Controller Pattern**.

### 4.1 Layered Architecture Diagram

```
+------------------------------------+      +-----------------------------------+
|      WhatsApp Client Driver        |      |         CLI Mock Driver           |
| (whatsapp-web.js / Baileys Engine) |      |     (npm run cli / Test Suite)    |
+------------------------------------+      +-----------------------------------+
                  \                                   /
                   \                                 /
                    v                               v
         +-----------------------------------------------------+
         |              Message Router & Parser                |
         |  - Matches commands: "add", "reset", "list", etc.   |
         |  - Extracts item name and store name parameters     |
         +-----------------------------------------------------+
                                    |
                                    v
         +-----------------------------------------------------+
         |             ShoppingListService (Core)              |
         |  - Business Logic: Add, Habit Tracking, Reset       |
         |  - Event Dispatcher: Broadcast Notifications        |
         +-----------------------------------------------------+
                                    |
                                    v
         +-----------------------------------------------------+
         |            Firebase Repository Layer                |
         |  - Firestore SDK operations                         |
         +-----------------------------------------------------+
```

### 4.2 Message Router Rules & Command Syntax

- **Add Item:** `[item]` or `[item] [store]`
  - Examples: `cioccolato`, `cioccolato eurospin`, `latte coop`, `pane, pasta, pomodori`
  - Parser logic:
    1. Checks if string contains known store names (e.g. `eurospin`, `coop`, `esselunga`, `conad`, `lidl`).
    2. Alternatively splits by whitespace: trailing word checked against known store dictionary or habit DB.
- **Reset List:** `reset` or `reset [store]`
  - Examples: `reset`, `reset eurospin`
  - Logic: Clears active list, logs purchase history, fires `ShoppingListService.on('reset', payload)` event to broadcast to group/subscribers.
- **View List:** `lista` or `list`
  - Formats current list grouped by store for chat/console display.

---

## 5. Deployment Strategy on Render (Free Cloud Service)

### 5.1 Render Environment Challenges & Solutions

1. **Ephemeral Disk Storage:**
   - *Problem:* Local auth directories (e.g., `.wwebjs_auth` or `auth_info_baileys`) disappear whenever Render restarts or deploys.
   - *Solution:* Implement Remote Firestore Auth Persistence. Auth tokens are saved to Firestore on `creds.update` or `remote_session_saved` and loaded on server startup.

2. **Render 15-Minute Inactivity Sleep (Web Services):**
   - *Problem:* Free Web Services on Render go to sleep after 15 minutes of inbound HTTP inactivity, causing WhatsApp WebSocket/Puppeteer connection to drop.
   - *Solution:*
     - Expose an Express web server inside the bot app on `process.env.PORT` with `/health` and `/qr` routes.
     - Set up an external cron ping (e.g., UptimeRobot, cron-job.org, or self-ping script) to hit `GET https://<your-render-app>.onrender.com/health` every 10 minutes.

3. **QR Code Scanning in Cloud Environment:**
   - *Problem:* Terminal QR codes in Render web log viewer can be difficult to scan due to line wrap and font rendering.
   - *Solution:* Express server serves an HTML dashboard at `/qr`:
     ```javascript
     app.get('/qr', (req, res) => {
       if (!latestQrCodeDataUrl) return res.send('<h1>Bot is connected or initializing...</h1>');
       res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;">
                  <div><h2>Scan WhatsApp QR Code</h2><img src="${latestQrCodeDataUrl}" /></div>
                 </body></html>`);
     });
     ```

### 5.2 Environment Variables Configuration

| Variable | Description | Example / Note |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Web server port (Render auto-injects) | `10000` |
| `FIREBASE_SERVICE_ACCOUNT` | Base64 encoded JSON string of Firebase SA key | `eyJ0eXBlIjoic2VydmljZV9hY2NvdW50...` |
| `ALLOWED_CHAT_ID` | WhatsApp Group ID or phone number filter | `12036301234567890@g.us` |
| `ADMIN_PASSCODE` | Passcode to protect `/qr` webpage | `supersecret123` |
| `ENABLE_MOCK_MODE` | Toggle CLI / WhatsApp execution | `false` |

---

## 6. Verification & Testing Strategy

### 6.1 CLI / Programmatic Mock Mode Suite

To meet the mandatory acceptance criteria without requiring a active WhatsApp connection:

1. **CLI Simulator (`src/cli/index.js`):**
   - Command-line interface accepting interactive input or flag arguments:
     - `node src/cli/index.js add "cioccolato eurospin"`
     - `node src/cli/index.js reset "eurospin"`
     - `node src/cli/index.js list`

2. **Automated Verification Script (`npm run test:integration`):**
   - Executes programmatic calls against Firebase (or Firestore Emulator):
     - **Test 1:** Execute `addItem("pasta", "coop")` -> Verify document exists in `active_list` and habit count for `pasta -> coop` is 1.
     - **Test 2:** Execute `addItem("cioccolato")` -> Verify habit tracker infers default store if previously recorded.
     - **Test 3:** Execute `resetList("coop")` -> Verify `active_list` count is 0, `purchase_history` contains entry, and broadcast listener receives notification payload.

---

## 7. Recommended Project Layout

```
whatsapp_shopping_list/
├── ORIGINAL_REQUEST.md
├── package.json
├── render.yaml
├── Dockerfile (Optional for whatsapp-web.js chrome deps)
├── src/
│   ├── index.js               # Entry point (Express + WhatsApp Client)
│   ├── config/
│   │   └── firebase.js        # Firebase Admin initialization
│   ├── core/
│   │   ├── shoppingListService.js  # Core business logic & event emitter
│   │   ├── habitTracker.js         # Habit frequency calculation engine
│   │   └── commandParser.js        # Natural language item/store parser
│   ├── repositories/
│   │   └── firestoreRepository.js  # Firestore database access methods
│   ├── adapters/
│   │   ├── whatsappAdapter.js # WhatsApp Web JS / Baileys event listener
│   │   └── remoteAuthStore.js # Custom Firestore Auth Store for session
│   ├── web/
│   │   └── server.js          # Express server (/health, /qr routes)
│   └── cli/
│       └── mockCli.js         # Local CLI simulator for offline testing
└── tests/
    └── integration.test.js    # Programmatic verification suite
```

---

## 8. Conclusion & Actionable Recommendations

1. **Architecture:** Use a decoupled modular design separating WhatsApp transport (`adapters/whatsappAdapter.js`) from domain logic (`core/shoppingListService.js`).
2. **Library Selection:** Prefer `@whiskeysockets/baileys` for low RAM footprint on Render free tier, or configure `whatsapp-web.js` with Puppeteer sandbox flags and Docker if wweb.js is preferred.
3. **Session Persistence:** Implement custom Firestore Auth persistence to survive Render container rebuilds.
4. **Offline Testing:** Implement `src/cli/mockCli.js` and automated integration tests to fulfill all acceptance criteria programmatically.
