# Server Setup and Health Check Analysis

## Executive Summary

This report presents a thorough inspection of the HTTP server setup, `/health` endpoint implementation, environment variable handling (`PORT`), lifecycle interactions with the WhatsApp Web client (`whatsapp-web.js`), and potential runtime error / process crash vectors on Render free tier hosting.

---

## 1. HTTP Server Entry Point & Architecture

- **Entry Point**: `src/whatsapp/whatsappClient.js` (lines 230–251) serves as the primary executable script (`npm start`).
- **HTTP Framework**: Express 4 (`express` module in `src/web/server.js`).
- **Server Module**: `src/web/server.js` exports:
  - `createWebServer(options)` / `createApp(options)` / `createExpressApp(options)`: Instantiates Express app, configures JSON middleware, and registers routes (`/`, `/health`, `/healthz`, `/qr`).
  - `startWebServer(portOrOptions, maybeOptions)`: Starts listening on specified port.
  - `stopWebServer(serverOrInstance)`: Gracefully stops the HTTP listener.

---

## 2. Health Endpoint (`/health` & `/healthz`) & Port Configuration

### 2.1 Port Configuration
- In `src/web/server.js` (line 194):
  ```javascript
  port = options.port || process.env.PORT || 3000;
  ```
- In `src/whatsapp/whatsappClient.js` (line 243):
  ```javascript
  const port = process.env.PORT || 3000;
  startWebServer({ port, whatsappClient: clientWrapper })
  ```
- **Evaluation**: Port parsing respects `process.env.PORT` provided by cloud environments (Render automatically injects `PORT`), falling back to `3000` for local development.

### 2.2 Health Check Implementation (`/health` and `/healthz`)
- Implementation in `src/web/server.js` (lines 60–74):
  ```javascript
  const handleHealth = (req, res) => {
    const status = resolveStatus(getStatus);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.status(200).json({
      status: 'ok',
      whatsappStatus: status,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      service: 'whatsapp-shopping-list'
    });
  };
  ```
- **Evaluation**:
  - Sets HTTP status `200 OK` unconditionally.
  - Headers disable response caching (`Cache-Control: no-cache, no-store, must-revalidate`).
  - Evaluates live WhatsApp status (`INITIALIZING`, `QR_READY`, `AUTHENTICATED`, `READY`, `AUTH_FAILURE`, `DISCONNECTED`, `UNKNOWN`).
  - Exposes process uptime and ISO timestamp.
  - Endpoint behavior is correct for external pinging/keep-alive services (e.g. UptimeRobot, Render probes).

---

## 3. Server Lifecycle vs. WhatsApp Client Initialization

### 3.1 Startup Sequence Analysis
In `src/whatsapp/whatsappClient.js` (lines 244–250):
```javascript
startWebServer({ port, whatsappClient: clientWrapper }).then(() => {
  console.log(`🌐 [Web Server] Started on port ${port}`);
  return clientWrapper.initialize();
}).catch((err) => {
  console.error('❌ Failed to start application:', err);
  process.exit(1);
});
```

### 3.2 Key Findings on Lifecycle Interaction
1. **Order of Operation**: The Express server starts **first** (`startWebServer` calls `app.listen`).
2. **Immediate Availability**: `/health` is responsive as soon as the socket opens, returning `whatsappStatus: "INITIALIZING"`.
3. **Critical Lifecycle Coupling Bug**:
   - `clientWrapper.initialize()` returns a Promise from Puppeteer/whatsapp-web.js initialization.
   - If `clientWrapper.initialize()` fails or rejects (for example, missing Chrome binary, missing shared Linux libraries, or Puppeteer launch error on Render), the error bubbles up into the `.catch((err) => process.exit(1))` block.
   - Calling `process.exit(1)` **kills the entire Node.js process**, shutting down the Express HTTP web server as well.
   - **Result on Render**: A Puppeteer initialization error causes an immediate process crash loop. The HTTP server dies, preventing Render from performing health checks or serving `/qr` for diagnostics/re-authentication.

---

## 4. Identified Runtime Crash Risks & Unhandled Rejections

### 4.1 Risk 1: Hard Process Exit on Initialization Failure
- **Location**: `src/whatsapp/whatsappClient.js` lines 247-250.
- **Cause**: `.catch` handler terminates the process on any WhatsApp client initialization failure.
- **Impact**: Server process exits with code 1 when Chromium fails to launch.

### 4.2 Risk 2: Missing Linux Shared Libraries & Chromium Binary on Render
- **Location**: `src/whatsapp/whatsappClient.js` lines 38-42 & `package.json` postinstall script.
- **Cause**: Standard `puppeteer` downloads full Chrome desktop build during `npm install` via `npx puppeteer browsers install chrome`. On Render's Linux container environment (Debian/Ubuntu minimal base), standard Chrome lacks mandatory system shared libraries (e.g. `libnss3`, `libatk1.0-0`, `libgbm1`, `libasound2`).
- **Impact**: `puppeteer.launch()` throws `Error: Could not find Chrome` or `Failed to launch browser process: error while loading shared libraries`.

### 4.3 Risk 3: Unhandled Rejections in Event Handlers & Message Processing
- **Location**: `src/whatsapp/whatsappClient.js` lines 93–95:
  ```javascript
  this.client.on('message', async (msg) => {
    await this.handleIncomingMessage(msg);
  });
  ```
- **Cause**: In Node.js 18+, unhandled promise rejections outside `try/catch` or in async event listeners terminate the process with exit code 1.
- **Impact**: Any uncaught promise rejection inside event callbacks can crash the server process.

### 4.4 Risk 4: Secondary Exceptions Inside Error Handler (`handleIncomingMessage`)
- **Location**: `src/whatsapp/whatsappClient.js` lines 215–222:
  ```javascript
  } catch (err) {
    console.error('❌ [WhatsApp] Error processing message:', err);
    replyText = `⚠️ Si è verificato un errore: ${err.message || err}`;
    if (typeof msg.reply === 'function') {
      await msg.reply(replyText); // <--- CAN THROW IF DISCONNECTED!
    } else if (this.client && typeof this.client.sendMessage === 'function' && msg.from) {
      await this.client.sendMessage(msg.from, replyText); // <--- CAN THROW!
    }
  }
  ```
- **Cause**: If an error occurred because the WhatsApp client was disconnected or lost session, attempting to send the error message via `msg.reply` or `client.sendMessage` inside the `catch` block throws a second exception. This secondary exception is uncaught and causes `handleIncomingMessage` to reject.

### 4.5 Risk 5: Render Memory (RAM) Exhaustion / OOM Kills
- **Location**: `src/whatsapp/whatsappClient.js` lines 38–42 (Puppeteer launch args).
- **Cause**: Render Free tier instances provide 512 MB of RAM. Puppeteer launch arguments include `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`, but lack `--single-process` or `--no-zygote` / `--disable-gpu`.
- **Impact**: Chromium process tree can exceed 512 MB memory limit, causing Linux kernel OOM (Out Of Memory) killer to terminate the Node process.

---

## 5. Summary of Recommended Remediation Steps for Implementation Phase

1. **Decouple Initialization from Process Exit**:
   - In `whatsappClient.js`, catch `clientWrapper.initialize()` errors gracefully without calling `process.exit(1)`. Update internal status to `'INITIALIZE_FAILED'` or `'FAILED'`, allowing the web server to remain online and serve `/health` (returning 200 with status info) and `/qr` (showing error/retry UI).
2. **Add Global Process Exception & Rejection Handlers**:
   - Attach `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers to log errors without immediately crashing the process.
3. **Fix Render Puppeteer Deployment**:
   - Provide a Dockerfile / Docker deployment configuration or integrate `@sparticuz/chromium` / system Chromium fallback with complete memory flags (`--single-process`, `--no-zygote`, `--disable-gpu`, `--no-sandbox`, `--disable-dev-shm-usage`).
4. **Safeguard Secondary Error Messaging**:
   - Wrap `msg.reply` / `client.sendMessage` calls inside a nested `try/catch` in `handleIncomingMessage`.
