# Deployment Guide: WhatsApp Shopping List Bot on Render Free Tier Hosting

This guide provides comprehensive, step-by-step instructions for deploying the **WhatsApp Shopping List Application** to Render's free tier web service, setting up Firebase/Firestore cloud persistence, configuring keep-alive uptime monitoring, and authenticating WhatsApp via browser QR code scanning.

---

## Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [System Prerequisites](#2-system-prerequisites)
   - [Node.js Runtime](#21-nodejs-runtime)
   - [Firebase & Firestore Database Setup](#22-firebase--firestore-database-setup)
   - [GitHub Repository Setup](#23-github-repository-setup)
3. [Render Web Service Deployment](#3-render-web-service-deployment)
   - [Step 1: Create a New Web Service](#step-1-create-a-new-web-service)
   - [Step 2: Repository Connection & Service Settings](#step-2-repository-connection--service-settings)
   - [Step 3: Build & Start Commands](#step-3-build--start-commands)
   - [Step 4: Environment Variables Configuration](#step-4-environment-variables-configuration)
4. [Uptime & Anti-Sleep Keep-Alive Configuration](#4-uptime--anti-sleep-keep-alive-configuration)
   - [Render Free Tier Sleep Policy](#41-render-free-tier-sleep-policy)
   - [UptimeRobot / Cron Keep-Alive Setup](#42-uptimerobot--cron-keep-alive-setup)
   - [Health Check Response Verification](#43-health-check-response-verification)
5. [WhatsApp Authentication via Browser QR Scanning](#5-whatsapp-authentication-via-browser-qr-scanning)
   - [Step 1: Accessing the /qr Endpoint](#step-1-accessing-the-qr-endpoint)
   - [Step 2: Scanning QR Code with Physical WhatsApp App](#step-2-scanning-qr-code-with-physical-whatsapp-app)
   - [Step 3: State Verification & Session Persistence](#step-3-state-verification--session-persistence)
6. [Local Verification & Testing](#6-local-verification--testing)
   - [Local CLI / Mock Mode Runner](#61-local-cli--mock-mode-runner)
   - [Executing the Automated Test Suite](#62-executing-the-automated-test-suite)
7. [Troubleshooting & Common Issues](#7-troubleshooting--common-issues)
   - [Puppeteer Build Dependencies & Chromium Flags](#71-puppeteer-build-dependencies--chromium-flags)
   - [Render Free Instance Resource Limitations](#72-render-free-instance-resource-limitations)
   - [Session Invalidation & Re-Authentication Flow](#73-session-invalidation--re-authentication-flow)
   - [Firebase Credentials Parsing Errors](#74-firebase-credentials-parsing-errors)

---

## 1. Overview & Architecture

The WhatsApp Shopping List application uses a decoupled 3-tier architecture:
- **Transport Adapters**: `@whiskeysockets/baileys` (lightweight, direct WebSocket WhatsApp protocol client — zero Chromium / Puppeteer dependencies) and non-interactive CLI runner (`bin/cli.js`).
- **Core Business Logic**: `ShoppingListService` (item addition, store preference inference, list reset), `HabitTracker` (frequent store calculation and purchase history logging), `MessageParser` (command parsing), and `NotificationBroadcaster`.
- **Data Persistence**: `FirestoreAdapter` (cloud database) with fallback to `MockDatabaseAdapter` (in-memory/file storage) and `FirestoreAuthState` (saving session authentication credentials to Firestore `whatsapp_auth` collection).
- **Express HTTP Server**: Built-in HTTP server listening on port `PORT` providing:
  - `/health` endpoint: Returns HTTP 200 JSON status for external keep-alive monitoring.
  - `/qr` endpoint: Renders an HTML page displaying live WhatsApp Web QR code for browser-based QR scanning.
  - `/reconnect` endpoint: Safely resets session credentials from Firestore and restarts client.

```
┌─────────────────────────────────────────────────────────────┐
│                 Render Free Web Service                     │
│  ┌───────────────────────┐       ┌───────────────────────┐  │
│  │  Express HTTP Server  │       │  WhatsApp Baileys     │  │
│  │   (/health, /qr)      │       │     Client            │  │
│  └───────────▲───────────┘       └───────────▲───────────┘  │
│              │                               │              │
│              └───────────────┬───────────────┘              │
│                              │                              │
│                ┌─────────────▼─────────────┐                │
│                │    ShoppingListService    │                │
│                └─────────────┬─────────────┘                │
│                              │                              │
│                ┌─────────────▼─────────────┐                │
│                │     FirestoreAdapter      │                │
│                └─────────────┬─────────────┘                │
│                              │                              │
└──────────────────────────────┼──────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Google Firestore   │
                    │ (data & auth state) │
                    └─────────────────────┘
```

---

## 2. System Prerequisites

### 2.1 Node.js Runtime
Ensure Node.js version `18.0.0` or higher is installed locally and supported by your hosting environment.
```bash
node --version
# Expected output: v18.x.x, v20.x.x, or higher
```

### 2.2 Firebase & Firestore Database Setup
The application uses Firebase Cloud Firestore to persist active shopping items, store habit preferences, and historical purchase records.

1. **Create a Firebase Project**:
   - Go to [Firebase Console](https://console.firebase.google.com/).
   - Click **Add project**, enter a project name (e.g., `whatsapp-shopping-list-prod`), and complete project creation.

2. **Create Firestore Database**:
   - In the Firebase Console side navigation, click **Build** > **Firestore Database**.
   - Click **Create database**.
   - Select **Start in production mode** (or test mode) and choose a location close to your users (e.g., `europe-west3` or `us-central1`).
   - Click **Enable**.

3. **Generate Service Account Private Key**:
   - In Firebase Console, click the gear icon (⚙️) next to *Project Overview* > **Project settings**.
   - Navigate to the **Service accounts** tab.
   - Click **Generate new private key** and confirm by clicking **Generate key**.
   - A `.json` file containing your credentials will be downloaded to your computer.

4. **Format Service Account Key for Environment Variable**:
   - Open the downloaded JSON file in a text editor.
   - Compress the JSON file into a single line string (or remove extra line breaks inside string values while preserving `\n` characters in `private_key`).
   - Example compressed format:
     ```json
     {"type":"service_account","project_id":"your-project-id","private_key_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\nMIIEvg...","client_email":"firebase-adminsdk-...@your-project-id.iam.gserviceaccount.com","client_id":"...","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token"}
     ```

### 2.3 GitHub Repository Setup
1. Commit your codebase to a Git repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: WhatsApp Shopping List application"
   ```
2. Verify that sensitive files are listed in `.gitignore`:
   ```gitignore
   node_modules/
   .wwebjs_auth/
   .wwebjs_cache/
   .env
   .mock_db.json
   ```
3. Push your repository to GitHub:
   ```bash
   git remote add origin https://github.com/your-username/whatsapp-shopping-list.git
   git branch -M main
   git push -u origin main
   ```

---

## 3. Render Web Service Deployment

Render provides free Linux instances ideal for hosting Node.js web applications and bots.

### Step 1: Create a New Web Service
1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click the **New +** button in the top right corner and select **Web Service**.
3. Choose **Build and deploy from a Git repository**.

### Step 2: Repository Connection & Service Settings
1. Connect your GitHub account (if not already connected) and select the `whatsapp-shopping-list` repository.
2. Fill out the service deployment settings:
   - **Name**: `whatsapp-shopping-list-bot` (or your preferred app name).
   - **Region**: Choose a region closest to your location (e.g., *Frankfurt (EU)* or *Oregon (US West)*).
   - **Branch**: `main`.
   - **Root Directory**: Leave blank (defaults to repository root).
   - **Runtime**: `Node`.
   - **Instance Type**: Select **Free** ($0/month).

### Step 3: Build & Start Commands
Configure the build and start execution commands:
- **Build Command**:
  ```bash
  npm install
  ```
- **Start Command**:
  ```bash
  npm start
  ```
  *(Note: `npm start` executes `node src/whatsapp/whatsappClient.js`, which starts both the Express web server on port `PORT` and initializes the WhatsApp client).*

### Step 4: Environment Variables Configuration
In the Render Service setup page under **Environment Variables**, add the following key-value pairs:

| Variable Name | Required | Example Value | Description |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | **Yes** | `{"type":"service_account",...}` | Full single-line JSON string of your Firebase Service Account credentials |
| `USE_FIRESTORE` | **Yes** | `true` | Enables `FirestoreAdapter` for cloud database persistence |
| `PORT` | Auto | `3000` | Port for Express server (automatically assigned by Render) |
| `WHATSAPP_FAMILY_CHAT_ID` | Optional | `120363xxx@g.us` | Default WhatsApp group/chat ID for reset broadcast notifications |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Optional | `false` | Ensures Puppeteer installs bundled Chromium binary |

Click **Create Web Service** to start the initial build and deployment process.

---

## 4. Uptime & Anti-Sleep Keep-Alive Configuration

### 4.1 Render Free Tier Sleep Policy
Render free tier Web Services automatically **spin down (sleep)** after **15 minutes of HTTP inactivity**. 
When the instance enters sleep mode:
- The Node.js process and WebSocket connections to WhatsApp Web are suspended.
- Incoming WhatsApp messages will **not** be processed until an HTTP request wakes up the instance.
- Waking up from sleep mode causes a cold start (10-30 seconds delay), potentially resulting in disconnected WhatsApp sessions.

### 4.2 UptimeRobot / Cron Keep-Alive Setup
To prevent the Render free instance from sleeping, set up an external automated ping service to perform an HTTP GET request to your `/health` endpoint every **10 to 14 minutes**.

#### Option A: UptimeRobot Setup (Recommended)
1. Register a free account at [UptimeRobot](https://uptimerobot.com/).
2. Click **+ Add New Monitor**.
3. Configure the monitor details:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `WhatsApp Bot Health Ping`
   - **URL (or IP)**: `https://<your-app-name>.onrender.com/health` (replace `<your-app-name>` with your actual Render service hostname).
   - **Monitoring Interval**: `Every 10 minutes` (or `Every 14 minutes`).
   - **Monitor Timeout**: `30 seconds`.
4. Click **Create Monitor**.

#### Option B: Cron-Job.org Setup
1. Register a free account at [cron-job.org](https://cron-job.org/).
2. Create a new Cron Job with schedule `*/10 * * * *` (every 10 minutes).
3. Set the Target URL to `https://<your-app-name>.onrender.com/health`.

### 4.3 Health Check Response Verification
You can manually test your keep-alive endpoint by running:
```bash
curl -i https://<your-app-name>.onrender.com/health
```
Expected HTTP 200 Response:
```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-cache, no-store, must-revalidate

{
  "status": "ok",
  "whatsappStatus": "READY",
  "uptime": 1420.53,
  "timestamp": "2026-08-10T18:00:00.000Z",
  "service": "whatsapp-shopping-list"
}
```

---

## 5. WhatsApp Authentication via Browser QR Scanning

Because WhatsApp Web requires physical device pairing via QR code scan, the application provides an integrated web endpoint (`/qr`) that streams the active QR code directly to any browser.

### Step 1: Accessing the `/qr` Endpoint
1. Once your Render Web Service is deployed and running, open a browser window and navigate to:
   ```
   https://<your-app-name>.onrender.com/qr
   ```
   *(Or simply `https://<your-app-name>.onrender.com/`, which automatically redirects to `/qr`).*

2. **Initial State (Initializing)**:
   If Chromium is launching or generating a session, the webpage displays a loading card: `⏳ Inizializzazione WhatsApp Client (Stato: INITIALIZING)`. The page auto-refreshes every 5 seconds.

3. **Active State (QR Ready)**:
   Once the QR code is generated by `whatsapp-web.js`, the webpage displays the live QR code image alongside step-by-step instructions. The page automatically reloads every 10 seconds to display fresh QR codes if they expire.

### Step 2: Scanning QR Code with Physical WhatsApp App
1. Open the **WhatsApp** application on your physical smartphone.
2. Open the Settings / Menu:
   - **Android**: Tap the three vertical dots (`⋮`) in the top right corner > **Linked Devices** (*Dispositivi collegati*).
   - **iOS (iPhone)**: Tap **Settings** (*Impostazioni*) in the bottom right > **Linked Devices** (*Dispositivi collegati*).
3. Tap **Link a Device** (*Collega un dispositivo*).
4. Point your smartphone camera at your computer browser screen showing `https://<your-app-name>.onrender.com/qr` to scan the QR code.

```
┌──────────────────────────────────────────────────────────────┐
│                    WhatsApp Bot - Web UI                     │
│                                                              │
│                  📱 WhatsApp Web QR Code                     │
│            Inquadra il codice per collegare il bot:          │
│                                                              │
│                     ┌──────────────────┐                     │
│                     │  ██████████████  │                     │
│                     │  ██  ██  ██  ██  │                     │
│                     │  ██████████████  │                     │
│                     └──────────────────┘                     │
│                                                              │
│  1. Apri WhatsApp sul tuo telefono                           │
│  2. Vai in Impostazioni > Dispositivi collegati              │
│  3. Premi "Collega un dispositivo" e inquadra questo schermo  │
└──────────────────────────────────────────────────────────────┘
```

### Step 3: State Verification & Session Persistence
1. Once scanned, WhatsApp Web authenticates the session.
2. The client status transitions: `QR_READY` ➔ `AUTHENTICATED` ➔ `READY`.
3. The `/qr` web page automatically updates to display a green success card:
   ```html
   ✅ WhatsApp Client Connected (Stato: READY)
   Il bot è attivo e pronto a gestire i comandi della lista della spesa.
   ```
4. **Session Persistence**:
   - `whatsapp-web.js` stores authentication state files inside the `./.wwebjs_auth` directory using `LocalAuth`.
   - As long as the Render keep-alive ping prevents full instance tear-downs, the WhatsApp session will remain paired indefinitely without requiring re-scanning.

---

## 6. Local Verification & Testing

Before deploying to Render (or during local development), verify the application logic using the included local CLI runner and automated test suite.

### 6.1 Local CLI / Mock Mode Runner
The application includes a standalone CLI runner (`bin/cli.js`) that allows testing all shopping list features offline using `MockDatabaseAdapter` or `FirestoreAdapter` without needing a live WhatsApp connection.

#### CLI Command Usage:
- **Add an Item to Shopping List**:
  ```bash
  node bin/cli.js add "cioccolato"
  # Output: ✅ Added "cioccolato" to shopping list.
  ```

- **Add an Item with Store Preference**:
  ```bash
  node bin/cli.js add "latte" -s "esselunga"
  # Output: ✅ Added "latte" (store: esselunga) to shopping list.
  ```

- **Display Active Shopping List**:
  ```bash
  node bin/cli.js list
  # Output:
  # 🛒 Shopping List (2 item(s)):
  # - cioccolato
  # - latte (esselunga)
  ```

- **View Habit Tracker Statistics**:
  ```bash
  node bin/cli.js habits
  # Output:
  # 📊 Shopping Habits (1 item(s)):
  # - latte: favorite store = esselunga (purchases: esselunga: 1)
  ```

- **Reset Active List & Broadcast Notification**:
  ```bash
  node bin/cli.js reset eurospin
  # Output:
  # 📢 [BROADCAST NOTIFICATION -> family_chat]
  # 🧹 Spesa completata presso EUROSPIN! La lista è stata svuotata (2 articoli).
  # 🧹 Shopping list reset. Cleared 2 item(s).
  ```

### 6.2 Executing the Automated Test Suite
Run the built-in Node.js test runner to execute unit, integration, and end-to-end (E2E) tests:

```bash
# Run all tests (Unit & E2E)
npm run test:all

# Run unit tests only
npm run test:unit

# Run E2E opaque-box tests only
npm run test:e2e
```
*Expected test summary:* `ℹ pass 145 | ℹ fail 0 | ℹ duration_ms ~550ms`.

---

## 7. Troubleshooting & Common Issues

### 7.1 Pure WebSocket Architecture & Zero Chromium Dependencies
The application uses `@whiskeysockets/baileys` (a lightweight native WebSocket WhatsApp client), completely eliminating the need for Chromium, Puppeteer, or OS graphics packages. This ensures that the Render container runs efficiently under 100MB of RAM and boots in milliseconds.

### 7.2 Render Free Instance Resource Limitations
**Symptom**: Service restarts unexpectedly or logs `Out of Memory (OOM)` errors.

**Cause & Solution**:
- Render Free instances have a **512 MB RAM limit**. Headless Chromium can consume significant memory if multiple pages or tabs open.
- Ensure `--disable-dev-shm-usage` is passed to Puppeteer so memory allocations use `/tmp` instead of shared memory space (`/dev/shm`).
- Keep the Express HTTP server simple without heavy static assets.

### 7.3 Session Invalidation & Re-Authentication Flow
**Symptom**: WhatsApp stops responding to messages, or server logs display `⚠️ Client disconnected: LOGOUT` / `❌ Authentication failure`.

**Cause & Solution**:
1. If your phone remains offline for 14+ days or if you manually log out linked devices from the WhatsApp mobile app, the stored `.wwebjs_auth` session token becomes invalid.
2. The client status will automatically transition to `DISCONNECTED` or `AUTH_FAILURE`.
3. To re-authenticate:
   - Navigate to `https://<your-app-name>.onrender.com/qr` in your web browser.
   - A new live QR code will be generated.
   - Scan the new QR code with your phone via **Linked Devices** (*Dispositivi collegati*).

### 7.4 Firebase Credentials Parsing Errors
**Symptom**: Application log shows `[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON`.

**Cause & Solution**:
- Multi-line strings pasted directly into Render environment variables can introduce unescaped newline characters in the `private_key` field.
- Ensure the `FIREBASE_SERVICE_ACCOUNT` value is a valid, single-line JSON string. Replace literal newlines in the private key with `\n` literals.
- Verify JSON validity locally before setting in Render:
  ```bash
  node -e 'console.log(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT).project_id)'
  ```

---

## 8. Summary Checklist for Production Readiness

Before sharing your bot with family members, verify all items on this checklist:

- [ ] Firestore Database created and `FIREBASE_SERVICE_ACCOUNT` env var configured on Render.
- [ ] `USE_FIRESTORE=true` environment variable set.
- [ ] Render Web Service deployed and HTTP GET `/health` returning status `200 OK`.
- [ ] UptimeRobot / Cron service set up to ping `/health` every 10-14 minutes.
- [ ] WhatsApp Web QR scanned via `https://<app-name>.onrender.com/qr` and status showing `READY`.
- [ ] Test message `pane` sent in chat ➔ Bot responds with `✅ Aggiunto alla lista: pane`.
- [ ] Test message `reset` sent in chat ➔ Bot responds with `🧹 Spesa completata! La lista è stata svuotata` and clears database.
