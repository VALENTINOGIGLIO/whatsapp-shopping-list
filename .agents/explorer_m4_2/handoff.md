# Handoff Report — Milestone 4: Express Web Server Specification (`src/web/server.js`)

**Agent:** `explorer_m4_2`  
**Working Directory:** `/Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/explorer_m4_2`  
**Target Module:** `src/web/server.js`  
**Report File:** `/Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/explorer_m4_2/analysis.md`

---

## 1. Observation

1. **`package.json` inspection (`package.json` lines 15-21):**
   ```json
   "dependencies": {
     "dotenv": "^16.4.5",
     "express": "^4.19.2",
     "firebase-admin": "^12.1.0",
     "qrcode-terminal": "^0.12.0",
     "whatsapp-web.js": "^1.23.0"
   }
   ```
   `express` (^4.19.2) is already installed as a primary production dependency.

2. **Project Specification (`PROJECT.md` lines 18 & 59):**
   - Line 18: `| 8 | Express Web Server (/health & /qr) | Express HTTP server providing /health endpoint for uptime pings and /qr endpoint for browser QR scanning. | M4 | survey |`
   - Line 59: `src/web/server.js` listed in the standard code layout under `src/web/`.

3. **Orchestrator Directive (`.agents/orchestrator/handoff.md` lines 20-21):**
   - Line 20: `Dispatch Explorer to specify ... src/web/server.js (Express server providing /health keep-alive ping and /qr HTML page for web QR scanning) ...`
   - Line 21: `Dispatch Worker to implement M4 modules and test coverage (tests/unit/web/server.test.js ...)`

4. **Directory Structure (`src/` inspection):**
   `src/web/` directory does not exist yet. `src/web/server.js` needs to be created during M4 implementation by the Worker.

---

## 2. Logic Chain

1. **Dependency Verification:**
   - Observation 1 shows `express@^4.19.2` is present in `package.json`.
   - Therefore, no external web framework needs to be installed. Standard Express ES module imports (`import express from 'express'`) can be used directly.

2. **Requirement 1 — Keep-Alive Ping (`/health`):**
   - Observations 2 and 3 state that Render free instances spin down after 15 minutes of HTTP inactivity.
   - External uptime monitors (e.g. UptimeRobot) issue periodic HTTP GET requests to `/health`.
   - Returning HTTP 200 OK with JSON `{ status: 'ok', uptime: process.uptime(), whatsappStatus: ... }` satisfies keep-alive monitors and prevents instance sleep.

3. **Requirement 2 — Browser QR Scanning (`/qr`):**
   - Observations 2 and 3 establish that headless cloud containers lack interactive terminal displays.
   - Rendering a responsive HTML page at `/qr` with state-aware conditional rendering (QR ready, connected, initializing) allows users to scan QR codes from any web browser.
   - Generating QR images via client-side rendering or `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}` enables HTML QR rendering without requiring additional npm packages.
   - Adding auto-refresh meta tags (`<meta http-equiv="refresh" content="15">`) handles QR expiration automatically.

4. **Requirement 3 — Decoupled Architecture & Testing:**
   - Using Dependency Injection (`createWebServer({ getStatus, getQrCode })`) decouples the web server from `whatsapp-web.js` network objects.
   - This allows unit tests (`tests/unit/web/server.test.js`) to test HTTP routes synchronously and deterministically using mock status getters.

5. **Requirement 4 — Startup & Graceful Shutdown:**
   - Binding to `process.env.PORT || 3000` on host `0.0.0.0` ensures compatibility with Render's dynamically assigned container ports.
   - Exporting `startWebServer` and `stopWebServer` allows clean integration into main bot process entrypoints and teardown hooks in test runners.

---

## 3. Caveats

1. **QR Code Image Generator Dependency:**
   - The primary design uses client-side rendering / dynamic image URL (`https://api.qrserver.com/v1/create-qr-code/...`). If the cloud host environment operates in a completely air-gapped network with zero external internet egress for client browsers, installing the `qrcode` npm package (`npm i qrcode`) for server-side base64 data URI generation (`QRCode.toDataURL()`) is recommended as an offline alternative.
2. **WhatsApp Client Integration:**
   - Wiring the state getter callbacks (`getStatus`, `getQrCode`) to the actual `whatsappClient` instance is within the scope of M4 integration (handled by `explorer_m4_1` and worker). `src/web/server.js` remains pure and state-agnostic.

---

## 4. Conclusion

`src/web/server.js` specification is complete and fully documented in `/Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/explorer_m4_2/analysis.md`.

### Key Interface Contracts:
- `createWebServer({ getStatus, getQrCode } = {})`: Returns Express `app` instance.
- `startWebServer(options)`: Listens on `process.env.PORT || 3000` (`0.0.0.0`) and returns `http.Server`.
- `stopWebServer(server)`: Gracefully closes HTTP listener returning a `Promise`.
- `/health`: HTTP 200 OK JSON (`status`, `uptime`, `timestamp`, `whatsappStatus`).
- `/qr`: HTTP 200 OK HTML (QR scanning interface, connected status card, or initializing state).

---

## 5. Verification Method

### 1. File Inspection
Inspect `/Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/explorer_m4_2/analysis.md` for full implementation proposal and architectural details.

### 2. Implementation & Test Verification Command
Once implemented by Worker, verify using:
```bash
node --test tests/unit/web/server.test.js
```
All unit tests should pass with 100% route coverage across `/health`, `/qr` (all 3 states), `/` redirect, and clean server startup/teardown.
