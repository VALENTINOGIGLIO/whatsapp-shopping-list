# Milestone 4 Analysis: Express Web Server (`/health` & `/qr`)

**Author:** `explorer_m4_2`  
**Date:** 2026-08-10  
**Target File:** `src/web/server.js`  
**Milestone:** M4 (WhatsApp Integration & Web Server)

---

## 1. Executive Summary

This report defines the complete technical design and specification for `src/web/server.js` — the Express web server component of the WhatsApp Shopping List Application.

The Express server solves two critical operational requirements for cloud deployment (specifically Render's free web service tier):
1. **Preventing Cloud Instance Sleep (`/health`):** Render free instances spin down after 15 minutes of HTTP inactivity. Exposing a lightweight `/health` endpoint allows external uptime services (e.g., UptimeRobot, Cron-Job.org, or self-pings) to perform keep-alive requests every 5–10 minutes, keeping the WhatsApp bot process and WebSocket connection active 24/7.
2. **Remote QR Code Scanning (`/qr`):** When deploying to headless server environments (Render, Cloud Run, Heroku), terminal QR code scanning (`qrcode-terminal`) is inaccessible. Exposing a `/qr` HTTP endpoint renders a web-based HTML interface displaying the active WhatsApp QR code (or connection status), enabling operators to pair their mobile WhatsApp client using any browser.

---

## 2. Dependency Audit (`package.json`)

An audit of `package.json` confirms the following dependency status:

```json
{
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "firebase-admin": "^12.1.0",
    "qrcode-terminal": "^0.12.0",
    "whatsapp-web.js": "^1.23.0"
  }
}
```

### Analysis & Recommendations:
1. **Web Framework (`express`):** `express@^4.19.2` is already installed and listed in `package.json`. No additional web server framework is needed.
2. **QR Code Rendering Strategy for `/qr`:**
   - `qrcode-terminal` only outputs ASCII QR codes to stdout/terminal.
   - For rendering QR codes in browser HTML, we recommend generating an `<img>` tag using client-side JavaScript or a reliable public image API (e.g. `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`).
   - Alternatively, if offline/zero-external-API rendering is preferred, the optional package `qrcode` (`QRCode.toDataURL(qrString)`) can be added to `package.json`. However, using a client-side API/script URL or inline SVG inside HTML requires **zero extra npm dependencies**, staying lean and lightweight.

---

## 3. Module Architecture & Decoupled State Management

To satisfy modularity and testability, `src/web/server.js` must be **completely decoupled** from the transport layer (`whatsappClient.js`) and database adapters.

### Architectural Pattern: Dependency Injection (DI) State Provider
Rather than reaching into global state or importing `whatsappClient.js` directly, `src/web/server.js` exports factory functions that accept getter functions for state resolution:

```javascript
/**
 * State Provider Interface (Options parameter passed to createWebServer)
 * @typedef {Object} ServerStateOptions
 * @property {function(): { status: string, uptime: number, clientName?: string }} [getStatus]
 * @property {function(): string|null} [getQrCode]
 * @property {number|string} [port]
 */
```

This design guarantees that unit tests (`tests/unit/web/server.test.js`) can easily mock status responses and test `/health` and `/qr` states without starting a real WhatsApp web socket or connecting to Firebase.

---

## 4. Endpoint Specifications

### 4.1. `/health` Endpoint

- **HTTP Method:** `GET`
- **Path:** `/health` (with alias support for `/` root or `/healthz`)
- **HTTP Response Status:** `200 OK`
- **Response Headers:** `Content-Type: application/json`, `Cache-Control: no-cache, no-store, must-revalidate`
- **Payload Schema:**

```json
{
  "status": "ok",
  "uptime": 1425.8,
  "timestamp": "2026-08-10T15:50:00.000Z",
  "whatsappStatus": "CONNECTED",
  "service": "whatsapp-shopping-list"
}
```

#### Field Descriptions:
- `status`: Constant `"ok"` indicating HTTP server health.
- `uptime`: Server uptime in seconds (`process.uptime()`).
- `timestamp`: ISO 8601 UTC timestamp.
- `whatsappStatus`: Operational status derived from `getStatus().status` (e.g., `'DISCONNECTED'`, `'INITIALIZING'`, `'QR_READY'`, `'CONNECTED'`).
- `service`: Service identification string.

---

### 4.2. `/qr` Endpoint

- **HTTP Method:** `GET`
- **Path:** `/qr`
- **HTTP Response Status:** `200 OK`
- **Response Headers:** `Content-Type: text/html; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate`
- **Dynamic Render States:**

#### State 1: QR Code Available (`getQrCode()` returns QR string & status is not `'CONNECTED'`)
- **UI:** Clean, centered HTML card with viewport meta tag for mobile responsiveness.
- **QR Display:** Renders QR code image (`<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=..." alt="WhatsApp QR Code" />`).
- **Auto-Refresh:** `<meta http-equiv="refresh" content="15">` (or client JS polling every 10s) to refresh expired QR codes (WhatsApp QR codes rotate every 20-30s).
- **Instructions:** Display clear steps:
  1. Open WhatsApp on your mobile phone.
  2. Tap **Menu** (⋮ or Settings) > **Linked Devices**.
  3. Tap **Link a Device** and scan the QR code displayed on screen.

#### State 2: Authenticated & Connected (`getStatus().status === 'CONNECTED'`)
- **UI:** Green success banner/card: `"WhatsApp Shopping List Bot is Connected & Active! ✅"`.
- **Details:** Displays connected bot name, session uptime, and status.
- **Auto-Refresh:** `<meta http-equiv="refresh" content="30">` to keep status monitored.

#### State 3: Initializing / Waiting for QR (`getQrCode() === null` & status is not `'CONNECTED'`)
- **UI:** Loading spinner / status card: `"Initializing WhatsApp Client... Please wait a few seconds. ⏳"`.
- **Auto-Refresh:** `<meta http-equiv="refresh" content="5">` for quick polling until QR code becomes available.

---

## 5. Server Startup, Port Binding & Graceful Shutdown

### 5.1. Port Binding & Environment Configuration
- Default Port: `process.env.PORT || 3000`.
- Host Binding: `0.0.0.0` (required for containerized Render deployments).
- Render Environment: Render automatically assigns the `PORT` environment variable (e.g., `10000`).

### 5.2. Export Interface
`src/web/server.js` exports two primary functions:

1. `createWebServer({ getStatus, getQrCode })`:
   - Instantiates Express application.
   - Registers middlewares (`express.json()`) and routes (`/health`, `/qr`, `/` redirect).
   - Returns the Express `app` instance (ideal for `supertest` or manual HTTP request injection).

2. `startWebServer(options)`:
   - Invokes `createWebServer(options)`.
   - Calls `app.listen(port, '0.0.0.0', callback)`.
   - Returns the active Node.js `http.Server` instance.
   - Attaches a helper `.stop()` / `.closeServer()` method returning a Promise for clean async shutdown.

### 5.3. Graceful Shutdown Protocol
When the host environment triggers `SIGINT` or `SIGTERM`:
```javascript
export function stopWebServer(server) {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => {
      if (err) return reject(err);
      console.log('[Web Server] HTTP server closed gracefully.');
      resolve();
    });
  });
}
```

---

## 6. Proposed Code Structure for `src/web/server.js`

```javascript
import express from 'express';

/**
 * Creates and configures the Express web application.
 * @param {Object} options
 * @param {function(): { status: string, uptime?: number }} [options.getStatus]
 * @param {function(): string|null} [options.getQrCode]
 * @returns {import('express').Express}
 */
export function createWebServer({ getStatus = () => ({ status: 'UNKNOWN' }), getQrCode = () => null } = {}) {
  const app = express();

  app.use(express.json());

  // Root redirect to /qr
  app.get('/', (req, res) => {
    res.redirect('/qr');
  });

  // Keep-alive health check endpoint
  app.get('/health', (req, res) => {
    const statusData = getStatus();
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      whatsappStatus: statusData.status || 'UNKNOWN',
      service: 'whatsapp-shopping-list'
    });
  });

  // Browser QR code scanner page
  app.get('/qr', (req, res) => {
    const statusData = getStatus();
    const qrCode = getQrCode();
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Content-Type', 'text/html; charset=utf-8');

    if (statusData.status === 'CONNECTED') {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="refresh" content="30">
          <title>WhatsApp Shopping List - Connected</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
            .badge { background: #dcf8c6; color: #075e54; padding: 0.5rem 1rem; border-radius: 20px; font-weight: bold; display: inline-block; margin-bottom: 1rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">Connected & Active ✅</div>
            <h2>WhatsApp Shopping List Bot</h2>
            <p>Bot is online and actively monitoring messages.</p>
            <p><small>System Uptime: ${Math.floor(process.uptime())}s</small></p>
          </div>
        </body>
        </html>
      `);
    }

    if (qrCode) {
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`;
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="refresh" content="15">
          <title>WhatsApp Shopping List - Scan QR</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 420px; width: 90%; }
            img { margin: 1rem 0; border: 1px solid #e0e0e0; border-radius: 8px; }
            ol { text-align: left; background: #f8f9fa; padding: 1rem 1.5rem; border-radius: 8px; font-size: 0.9rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Scan QR Code</h2>
            <p>Pair your WhatsApp account to start using the bot.</p>
            <img src="${qrImageUrl}" alt="WhatsApp QR Code" width="300" height="300" />
            <ol>
              <li>Open WhatsApp on your phone</li>
              <li>Tap Menu or Settings > Linked Devices</li>
              <li>Tap Link a Device and point camera at this screen</li>
            </ol>
            <p><small>Page auto-refreshes every 15 seconds.</small></p>
          </div>
        </body>
        </html>
      `);
    }

    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="refresh" content="5">
        <title>WhatsApp Shopping List - Initializing</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Initializing... ⏳</h2>
          <p>Connecting to WhatsApp service. Please wait a few seconds...</p>
        </div>
      </body>
      </html>
    `);
  });

  return app;
}

/**
 * Starts the HTTP web server on process.env.PORT or specified port.
 * @param {Object} options
 * @returns {import('http').Server}
 */
export function startWebServer(options = {}) {
  const port = options.port || process.env.PORT || 3000;
  const app = createWebServer(options);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[Web Server] Listening on http://0.0.0.0:${port}`);
  });
  return server;
}

/**
 * Closes the HTTP web server gracefully.
 * @param {import('http').Server} server
 * @returns {Promise<void>}
 */
export function stopWebServer(server) {
  return new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}
```

---

## 7. Verification & Test Strategy (`tests/unit/web/server.test.js`)

Unit tests must use Node's native test runner (`node:test`) and native `node:http` or `fetch` / supertest against a temporary port (e.g. port 0 for random available port).

### Verification Test Cases:
1. **GET `/health` Returns 200 OK & Valid JSON:**
   - Start test server with `getStatus = () => ({ status: 'CONNECTED' })`.
   - Perform HTTP GET `/health`.
   - Verify HTTP status === 200.
   - Verify `json.status === 'ok'`, `json.whatsappStatus === 'CONNECTED'`, `json.uptime` is numeric.

2. **GET `/qr` When QR Code Present:**
   - Start test server with `getQrCode = () => 'mock-qr-code-string'`.
   - Perform HTTP GET `/qr`.
   - Verify HTTP status === 200.
   - Verify response headers include `text/html`.
   - Verify HTML body includes `"Scan QR Code"` and encoded QR string.

3. **GET `/qr` When Bot Connected:**
   - Start test server with `getStatus = () => ({ status: 'CONNECTED' })` and `getQrCode = () => null`.
   - Perform HTTP GET `/qr`.
   - Verify HTTP status === 200.
   - Verify HTML body contains `"Connected & Active"`.

4. **GET `/qr` When Initializing:**
   - Start test server with `getStatus = () => ({ status: 'INITIALIZING' })` and `getQrCode = () => null`.
   - Perform HTTP GET `/qr`.
   - Verify HTML body contains `"Initializing"`.

5. **Root Redirect `/` -> `/qr`:**
   - Perform GET `/`.
   - Verify 302 redirect to `/qr`.

6. **Clean Server Shutdown:**
   - Call `stopWebServer(server)` and verify socket closes cleanly without leaving handles open.

---

## 8. Summary & Handoff Readiness

The specified Express web server design satisfies all requirements for Milestone 4:
- Express framework verified in `package.json`.
- Light, non-blocking `/health` endpoint keeps Render free instances alive via Uptime pings.
- Dynamic `/qr` endpoint renders scanning interface across all 3 client states.
- Clean DI interface enables isolated, fast unit testing.
- Fully compatible with ES Modules (`type: "module"`) and `node --test`.
