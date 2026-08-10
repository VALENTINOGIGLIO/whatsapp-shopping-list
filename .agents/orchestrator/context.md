# Orchestrator Context

## Project Info
- Project: WhatsApp Shopping List Application
- Target Working Directory: /Users/gi/teamwork_projects/whatsapp_shopping_list
- Agent Workspace: /Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/orchestrator
- Original Request: /Users/gi/teamwork_projects/whatsapp_shopping_list/ORIGINAL_REQUEST.md

## High Level Requirements
1. WhatsApp integration using free method (`whatsapp-web.js` or free Node alternative).
2. Cloud database persistence (e.g. Firebase Firestore).
3. Item management & journaling:
   - Add item ("cioccolato")
   - Add item with store ("cioccolato eurospin") -> store habit tracking
   - Reset command -> clears active list, broadcasts notification to all members
   - Reset [store] command -> logs store purchase before clearing active list
4. CLI / Mock mode:
   - CLI add item -> writes item to DB
   - CLI add item with store -> extracts store name and updates habit tracker in DB
   - CLI reset -> clears active list in DB and triggers broadcast notification logic
5. Cloud Deployment Guide:
   - Render deployment & QR code scan instructions.
