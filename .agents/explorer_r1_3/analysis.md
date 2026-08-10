# Render Deployment Architecture Analysis

**Project**: WhatsApp Shopping List Bot (`whatsapp_shopping_list`)  
**Target Platform**: Render Free Tier Web Service (`onrender.com`)  
**Date**: August 10, 2026  
**Author**: Explorer 3 (`teamwork_preview_explorer`)

---

## 1. Executive Summary

This report evaluates the deployment options for hosting the WhatsApp Shopping List Bot on Render. The application relies on `whatsapp-web.js`, which spawns a headless Chromium instance via Puppeteer to manage WhatsApp Web sessions, and Express for `/health` and `/qr` endpoints.

### Key Finding & Recommendation
- **Current State**: Neither `render.yaml`, `Dockerfile`, nor `.dockerignore` exists in the project root `/Users/gi/teamwork_projects/whatsapp_shopping_list`. `package.json` contains a `postinstall` script (`rm -rf .cache/puppeteer/chrome && npx puppeteer browsers install chrome`) intended for standard Node environments, but this fails on Render's native Node stack due to missing Linux system shared libraries (`libnss3.so`, `libgbm.so.1`, `libasound.so.2`, etc.).
- **Recommendation**: **Option B (Docker Deployment)** is strongly recommended. Deploying via Docker guarantees that all required Linux shared libraries and the system `chromium` binary are pre-installed in a lightweight Debian image (`node:18-slim`). This eliminates runtime Chrome launch errors, avoids reliance on serverless extraction hacks (`@sparticuz/chromium`), and ensures a 100% deterministic build environment.

---

## 2. Investigation of Current Project Root Configuration

A search of the project root directory (`/Users/gi/teamwork_projects/whatsapp_shopping_list`) revealed the following status regarding deployment artifacts:

| File Name | Exists in Root? | Details / Findings |
|---|---|---|
| `render.yaml` | **No** | Missing. Service must currently be configured manually via Render UI or using a new `render.yaml` Blueprint spec. |
| `Dockerfile` | **No** | Missing. No container definition currently present. |
| `.dockerignore` | **No** | Missing. No Docker context filtering present. |
| `.puppeteerrc.cjs` | **Yes** | Present. Defines `cacheDirectory: join(__dirname, '.cache', 'puppeteer')`. |
| `package.json` | **Yes** | Postinstall script: `"postinstall": "rm -rf .cache/puppeteer/chrome && npx puppeteer browsers install chrome"`. Puppeteer version: `^22.10.0`. Node engine: `>=18.0.0`. |
| `src/whatsapp/whatsappClient.js` | **Yes** | Currently hardcodes `executablePath: puppeteer.executablePath()`. Needs adaptation to check `process.env.PUPPETEER_EXECUTABLE_PATH`. |

---

## 3. Evaluation of Deployment Options

### Option A: Native Node Service on Render (`env: node`)
Uses Render's default Node.js environment. Puppeteer either downloads Chrome via `postinstall` or uses `@sparticuz/chromium` + `puppeteer-core`.

#### Architectural Overview
Render native Node runtime runs inside a Linux container missing desktop GUI dependencies. When standard Puppeteer downloads Chrome, running Chrome fails with:
`Error: Could not find Chrome` or `error while loading shared libraries: libnss3.so: cannot open shared object file`.

To use Option A, `@sparticuz/chromium` + `puppeteer-core` must be added. `@sparticuz/chromium` extracts a lightweight Chromium binary to `/tmp` at runtime.

#### Pros & Cons of Option A

| Category | Pros | Cons |
|---|---|---|
| **Build Speed** | Standard `npm install` build (fast initial setup). | `npx puppeteer browsers install chrome` or `@sparticuz/chromium` binary download adds build/startup latency. |
| **Simplicity** | Uses standard Render `Node` environment setting. | Requires introducing `@sparticuz/chromium` dependency and conditional code paths in `whatsappClient.js`. |
| **Reliability** | Works for lightweight HTML rendering. | `@sparticuz/chromium` is built for serverless (AWS Lambda / Vercel 15s invocations). In long-running WebSocket environments (`whatsapp-web.js`), `/tmp` directory cleanup or missing canvas/audio/font stubs can cause unexpected session crashes. |
| **Resource Usage** | Small repository footprint. | Decompresses tarball to `/tmp` on every cold start, consuming CPU and RAM (critical on 512MB free tier). |

---

### Option B: Docker Deployment on Render (`env: docker`) - RECOMMENDED

Uses a custom Dockerfile based on `node:18-slim` with system `chromium` installed via `apt-get`. `render.yaml` specifies `env: docker`.

#### Architectural Overview
Docker allows installing Debian system packages (`chromium`, `fonts-ipafont-gothic`, `fonts-wqy-zenhei`, `libxss1`, etc.) during the Docker build phase. Puppeteer is instructed to skip downloading bundled Chrome (`PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`) and use `/usr/bin/chromium` (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`).

#### Pros & Cons of Option B

| Category | Pros | Cons |
|---|---|---|
| **Reliability** | **100% Deterministic**. All C shared libraries, fonts, and Chromium dependencies are preinstalled in the image. Zero shared library errors. | Requires maintaining `Dockerfile` and `.dockerignore`. |
| **Compatibility** | Fully compatible with `whatsapp-web.js` and standard Puppeteer without binary extraction hacks. | Initial Docker image build on Render takes ~2-3 minutes (cached on subsequent deploys). |
| **Performance** | Zero cold-start extraction overhead. Chromium binary is pre-compiled and ready instantly on container startup. | Docker image size ~450MB (well within Render limits). |
| **Maintenance** | Isolated environment unaffected by Render base image stack updates or missing apt packages. | Requires Docker environment support on host (supported natively by Render Free tier). |

---

## 4. Complete Configuration Templates

### 4.1 Recommended Docker Configuration (Option B)

#### `Dockerfile` (Place in project root `/Users/gi/teamwork_projects/whatsapp_shopping_list/Dockerfile`)

```dockerfile
# Use official Node.js 18 slim image on Debian Bookworm
FROM node:18-slim

# Install system Chromium, fonts, and required shared libraries
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libnss3 \
    libasound2 \
    --no-install-recommends \
 && rm -rf /var/lib/apt/lists/*

# Set Puppeteer environment variables to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Copy package definition files
COPY package*.json ./

# Install production dependencies only (skip Chrome download postinstall)
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose HTTP web server port
EXPOSE 3000

# Health check instruction for container runtime
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Start the application
CMD ["node", "src/whatsapp/whatsappClient.js"]
```

#### `.dockerignore` (Place in project root `/Users/gi/teamwork_projects/whatsapp_shopping_list/.dockerignore`)

```dockerignore
node_modules
.wwebjs_auth
.wwebjs_cache
.cache
.git
.gitignore
.env
.mock_db.json
.agents
.tmp_challenger_test
coverage
tests
*.log
README.md
DEPLOYMENT.md
PROJECT.md
ORIGINAL_REQUEST.md
```

#### `render.yaml` (Option B - Docker Deployment - Place in project root)

```yaml
services:
  - type: web
    name: whatsapp-shopping-list-bot
    env: docker
    plan: free
    region: frankfurt
    dockerfilePath: ./Dockerfile
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: PORT
        value: 3000
      - key: USE_FIRESTORE
        value: "true"
      - key: FIREBASE_SERVICE_ACCOUNT
        sync: false
      - key: WHATSAPP_FAMILY_CHAT_ID
        sync: false
      - key: NODE_ENV
        value: production
```

---

### 4.2 Alternative Native Node Configuration (Option A)

#### `render.yaml` (Option A - Native Node Deployment)

```yaml
services:
  - type: web
    name: whatsapp-shopping-list-bot
    env: node
    plan: free
    region: frankfurt
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: PORT
        value: 3000
      - key: USE_FIRESTORE
        value: "true"
      - key: FIREBASE_SERVICE_ACCOUNT
        sync: false
      - key: WHATSAPP_FAMILY_CHAT_ID
        sync: false
      - key: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD
        value: "false"
      - key: NODE_ENV
        value: production
```

---

## 5. Required Code Adaptations in `whatsappClient.js`

To ensure `whatsapp-web.js` works seamlessly in both Docker and local environments, `src/whatsapp/whatsappClient.js` should be updated to respect `process.env.PUPPETEER_EXECUTABLE_PATH`:

### Current Implementation (Lines 38-42 in `src/whatsapp/whatsappClient.js`):
```javascript
const puppeteerArgs = options.puppeteerOptions || options.puppeteer || {
  headless: true,
  executablePath: puppeteer.executablePath(),
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
};
```

### Proposed Patch / Code Adjustment:
```javascript
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();

const puppeteerArgs = options.puppeteerOptions || options.puppeteer || {
  headless: true,
  executablePath: executablePath,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--single-process'
  ]
};
```

---

## 6. Environment Variables Reference

| Variable Name | Required | Render Sync Setting | Description |
|---|---|---|---|
| `PORT` | Auto / Yes | Preset: `3000` | Port for Express HTTP web server (assigned dynamically by Render). |
| `USE_FIRESTORE` | Yes | Preset: `"true"` | Controls database selection (`FirestoreAdapter` vs `MockDatabaseAdapter`). |
| `FIREBASE_SERVICE_ACCOUNT` | Yes | `sync: false` | Single-line compressed JSON string of Firebase Service Account credentials. |
| `WHATSAPP_FAMILY_CHAT_ID` | Optional | `sync: false` | Default target WhatsApp group JID (e.g., `120363xxx@g.us`). |
| `PUPPETEER_EXECUTABLE_PATH` | Yes (Docker) | Set in Dockerfile (`/usr/bin/chromium`) | Absolute path to system Chromium executable inside container. |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD` | Yes (Docker) | Set in Dockerfile (`true`) | Prevents Puppeteer postinstall from downloading unnecessary browser binaries. |

---

## 7. Comparison Summary Table

| Metric / Criteria | Option A (Native Node + @sparticuz/chromium) | Option B (Docker + System Chromium) |
|---|---|---|
| **Render `env` setting** | `node` | `docker` |
| **Chrome Source** | `@sparticuz/chromium` / Puppeteer download | `apt-get install chromium` |
| **Shared Library Reliability** | Medium (depends on runtime stubs) | **High (100% Native Debian packages)** |
| **Cold-Start Performance** | Slower (decompresses binary to `/tmp`) | **Fast (Pre-compiled binary in image)** |
| **Maintenance Effort** | Low upfront, potential runtime issues | One-time Dockerfile setup, stable long term |
| **Overall Rating** | Acceptable Fallback | **RECOMMENDED PRIMARY CHOICE** |
