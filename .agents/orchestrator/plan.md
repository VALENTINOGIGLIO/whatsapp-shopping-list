# Orchestration Plan — Requirement R4: Fix Render Deployment

## Overview
Requirement R4: Fix Render deployment for the WhatsApp Shopping List bot.
The bot currently experiences Puppeteer/Chrome errors ("Error: Could not find Chrome" or missing shared libraries).
Acceptance Criteria:
1. The Render deployment configuration is robust against missing Chrome dependencies (via Dockerfile + render.yaml with system chromium).
2. `src/whatsapp/whatsappClient.js` updated to respect `PUPPETEER_EXECUTABLE_PATH` and handle initialization errors gracefully.
3. The `/health` endpoint responds with a 200 OK after deployment.
4. All 145+ unit/integration tests pass.

## Plan Steps

### Phase 1: Survey & Exploration [COMPLETED]
- Explorer 1: Analyzed Puppeteer dependencies and `executablePath` hardcoding in `whatsappClient.js`.
- Explorer 2: Analyzed Express server setup, `/health` endpoint, and lifecycle crash coupling in `whatsappClient.js`.
- Explorer 3: Evaluated Render deployment options (Docker vs `@sparticuz/chromium`) and provided complete configuration templates.

### Phase 2: Synthesis & Solution Design [COMPLETED]
- Selected Option B: Docker deployment on Render with Debian `node:20-slim` base image, preinstalled `chromium` system dependencies, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`, and `render.yaml`.
- Identified code changes in `src/whatsapp/whatsappClient.js`:
  1. Support `process.env.PUPPETEER_EXECUTABLE_PATH`.
  2. Non-fatal initialization error handling so Express web server and `/health` remain active.
  3. Robust error handling in incoming message handler.

### Phase 3: Implementation [COMPLETED]
- Worker 1 (`worker_r1`):
  - Updated `src/whatsapp/whatsappClient.js`.
  - Created `Dockerfile` in root.
  - Created `.dockerignore` in root.
  - Created `render.yaml` in root.
  - Verified unit and integration tests.

### Phase 4: Verification & Gating [COMPLETED]
- Reviewer 1: APPROVE
- Reviewer 2: APPROVE
- Challenger 1: APPROVE
- Challenger 2: APPROVE
- Auditor 1: CLEAN
- Gate Result: PASS (`GATE_STATUS.md`)

### Phase 5: Finalization & Victory Report [COMPLETED]
- Synthesized all results into victory report.
- Sent victory/completion report to Sentinel (parent ID: `e9d6c04c-7c74-4dad-8af1-5211d136cee4`).
