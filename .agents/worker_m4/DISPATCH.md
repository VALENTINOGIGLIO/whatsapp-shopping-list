## 2026-08-10T15:50:24Z
You are worker_m4.
Your working directory is: /Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/worker_m4

Read the following files before starting your work:
- /Users/gi/teamwork_projects/whatsapp_shopping_list/ORIGINAL_REQUEST.md
- /Users/gi/teamwork_projects/whatsapp_shopping_list/PROJECT.md
- /Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/orchestrator/handoff.md
- /Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/explorer_m4_1/analysis.md
- /Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/explorer_m4_2/analysis.md
- /Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/explorer_m4_3/analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Task — Implement Milestone 4: WhatsApp Integration & Express Web Server:
1. Implement `src/broadcaster/WhatsAppBroadcaster.js`:
   - Inherits from `NotificationBroadcaster`.
   - Sends notification messages via WhatsApp client (`sendMessage` or `reply`).
2. Implement `src/whatsapp/whatsappClient.js`:
   - `WhatsAppClientWrapper` class handling `whatsapp-web.js` lifecycle, QR event capturing, session persistence support, and incoming message routing to `MessageParser` and `ShoppingListService`.
   - Support Puppeteer args (`--no-sandbox`, `--disable-setuid-sandbox`, `--disable-dev-shm-usage`) for headless hosting on Render.
   - Accept injected client instance / mock for 100% offline unit testing.
3. Implement `src/web/server.js`:
   - Express server app factory (`createApp({ getStatus, getQrCode })`, `startWebServer`, `stopWebServer`).
   - `/health`: HTTP 200 OK JSON status (uptime, timestamp, status).
   - `/qr`: Dynamic HTML page rendering QR code image/SVG with auto-refresh meta tag when QR is available, connected state card when connected, initializing spinner when initializing.
4. Implement unit tests:
   - `tests/unit/broadcaster/WhatsAppBroadcaster.test.js`
   - `tests/unit/whatsapp/whatsappClient.test.js`
   - `tests/unit/web/server.test.js`
5. Run unit & E2E tests using `node --test tests/**/*.test.js` and verify all tests pass with zero failures.

Write your handoff report to `/Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/worker_m4/handoff.md` with test output and file lists.
