# Project Survey & Codebase Analysis

## 1. Executive Summary
This survey report presents a comprehensive analysis of the **WhatsApp Shopping List** project repository at `/Users/gi/teamwork_projects/whatsapp_shopping_list`. 

The repository is currently at **initial state (clean slate)** with no existing source code, package configurations, or tests present. The only repository content consists of `ORIGINAL_REQUEST.md` and agent metadata in `.agents/`.

Node.js `v24.16.0` and npm `11.13.0` are installed in the local execution environment.

---

## 2. Repository Layout & Current State Inspection

### 2.1 File & Directory Inventory
- **Project Root**: `/Users/gi/teamwork_projects/whatsapp_shopping_list`
- **Existing Files**:
  - `ORIGINAL_REQUEST.md` (2043 bytes): Defines requirements R1-R3, acceptance criteria, and testing expectations.
- **Directories**:
  - `.agents/`: Agent metadata workspace containing subdirectories:
    - `orchestrator/` (`plan.md`, `context.md`, `DISPATCH.md`, `BRIEFING.md`, `progress.md`)
    - `sentinel/`
    - `teamwork_preview_explorer_survey_1/` (current working directory)
    - `teamwork_preview_explorer_survey_2/`
    - `teamwork_preview_explorer_survey_3/`
- **Missing Core Project Files**:
  - `package.json` / `package-lock.json`
  - `.gitignore`
  - `.env` / `.env.example`
  - Source directories (`src/`, `lib/`, etc.)
  - Test suites (`tests/`, `__tests__/`, etc.)

---

## 3. Environment & Runtime Technical Assessment

| Component | Value / Status | Notes |
| --- | --- | --- |
| **Node.js Version** | `v24.16.0` | Modern LTS/Current supporting ES Modules, Top-level await, native fetch, and `node:test` |
| **npm Version** | `11.13.0` | Package manager ready |
| **Platform OS** | macOS (`darwin x64/arm64`) | Development environment |
| **Project Type** | Node.js Backend App | Recommend ESM (`"type": "module"`) in `package.json` |

---

## 4. Requirements & Core Features Analysis

### R1. WhatsApp Integration
- **Goal**: Enable direct messaging and group chat interaction without Meta Business API fees.
- **Recommended Library**: `whatsapp-web.js` (or `@whiskeysockets/baileys` as alternative). `whatsapp-web.js` uses Puppeteer headless browser to interact with WhatsApp Web.
- **Auth Flow**: QR code rendering in terminal via `qrcode-terminal` on startup. Session persistence via LocalAuth strategy.
- **Message Listener**: Intercept incoming messages, filter commands (`reset`, `reset [store]`, item addition), and reply/broadcast updates.

### R2. Cloud Database Persistence & Storage Abstraction
- **Goal**: Persist active shopping list items and long-term shopping habits/preferences.
- **Cloud DB**: Firebase Firestore (`firebase-admin` SDK).
- **Data Models**:
  1. `active_list`: Collection or single document holding active shopping items:
     - `id`: Item identifier
     - `name`: Item name (e.g., "cioccolato")
     - `addedAt`: ISO Timestamp
     - `addedBy`: User/Sender ID
     - `storeHint`: Preferred or specified store (e.g., "eurospin")
  2. `habits`: Store preference mapping:
     - `item`: Item name key (e.g., "cioccolato")
     - `storeCounts`: Map of store names to purchase frequency (e.g., `{ "eurospin": 5, "coop": 1 }`)
     - `lastPurchasedStore`: Most recent store purchased from
     - `updatedAt`: ISO Timestamp
- **Adapter Pattern requirement**: Abstract DB layer with a clean interface (`DatabaseAdapter`):
  - `FirestoreAdapter`: Connects to real Firebase Firestore.
  - `MockAdapter`: In-memory or local JSON file storage for CLI runner and automated testing without external credentials.

### R3. List Management & Journaling Business Logic
- **Item Parsing (`parser.js`)**:
  - `add <item>` / `<item>` (e.g., "cioccolato"): Adds item to list. Checks habit history to provide store suggestions if known.
  - `<item> <store>` (e.g., "cioccolato eurospin"): Adds item "cioccolato" with store "eurospin", and logs/increments store habit counter for "cioccolato" -> "eurospin".
- **Reset Logic**:
  - `reset`: Clears all items from `active_list`. Triggers broadcast notification to chat participants ("Shopping list cleared!").
  - `reset <store>` (e.g., "reset eurospin"): Records that all items currently in `active_list` were purchased at `<store>`, updates habit frequencies for those items, clears `active_list`, and broadcasts notification.

### R4. CLI / Mock Mode Runner & Acceptance Verification
- **Goal**: Verify bot logic programmatically without requiring physical WhatsApp QR scanning or active phone pairing during automated test execution.
- **CLI Capabilities**:
  - `node src/cli.js add "cioccolato"`
  - `node src/cli.js add "cioccolato eurospin"`
  - `node src/cli.js reset`
  - `node src/cli.js reset "eurospin"`
  - `node src/cli.js list`
  - `node src/cli.js habits`
- **Output & Broadcast Verification**:
  - Log DB writes and capture triggered notification callbacks.

---

## 5. Technical Dependencies & Package Recommendations

### Dependencies (`dependencies`)
1. `whatsapp-web.js`: `^1.26.0` (WhatsApp Web automation client)
2. `qrcode-terminal`: `^0.12.0` (Terminal QR code renderer)
3. `firebase-admin`: `^13.0.0` (Firebase Firestore SDK)
4. `dotenv`: `^16.4.5` (Environment variables loader)
5. `commander`: `^12.0.0` (CLI command parsing)

### Dev Dependencies (`devDependencies`)
1. `jest` (or `vitest`): Unit & integration testing framework.
2. `supertest` / test helpers: Mocking and asserting database state.

---

## 6. Proposed Codebase Architecture & Structure

```
whatsapp_shopping_list/
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── src/
│   ├── index.js               # WhatsApp bot main entrypoint
│   ├── cli.js                 # CLI / Mock mode entrypoint
│   ├── config.js              # Env vars & configuration
│   ├── db/
│   │   ├── index.js           # DB factory (returns Firestore or Mock adapter)
│   │   ├── interface.js       # Database adapter contract
│   │   ├── firestore.js       # Firebase Firestore adapter
│   │   └── mock.js            # In-memory mock DB adapter
│   ├── domain/
│   │   ├── listService.js     # Active shopping list business logic
│   │   ├── habitService.js    # Store preference & habit tracking business logic
│   │   └── commandParser.js   # Command and message parsing logic
│   └── whatsapp/
│       ├── client.js          # whatsapp-web.js initialization & handlers
│       └── notifier.js        # Notification broadcast handler
└── tests/
    ├── unit/
    │   ├── commandParser.test.js
    │   ├── listService.test.js
    │   └── habitService.test.js
    └── integration/
        └── cliMock.test.js
```

---

## 7. Key Operational & Deployment Risk Assessment

1. **Puppeteer / Headless Chrome on Render**:
   - `whatsapp-web.js` relies on Puppeteer, which downloads Chromium. On Render free web services, Chromium requires buildpack configuration (`puppeteer` cache path or custom Docker container / `--no-sandbox` flags).
2. **Session Persistence**:
   - WhatsApp Web sessions need saved auth tokens. `LocalAuth` saves sessions to `.wwebjs_auth/`. Render filesystem is ephemeral unless mounted or using remote auth strategy (e.g. `RemoteAuth` with DB).
3. **Database Fallback**:
   - `MockAdapter` ensures test suites and local development run smoothly without requiring live Firebase credentials.

---

## 8. Summary & Next Steps
- Base setup is clean and ready for `package.json` initialization.
- Implementation teams can proceed with M1 (Domain & DB Adapters) and Track 1 (E2E Test Suite) in parallel once project structure is initialized.
