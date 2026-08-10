# Original User Request

## Initial Request — 2026-08-10T15:40:33Z

A WhatsApp bot for managing a shared family shopping list. It allows users to add items via chat, clears the list and notifies everyone upon a "reset" command, and tracks shopping habits (e.g., associating specific items with specific stores).

Working directory: ~/teamwork_projects/whatsapp_shopping_list
Integrity mode: development

## Requirements

### R1. WhatsApp Integration
The system must use a free WhatsApp integration method (e.g., `whatsapp-web.js` in Node.js) to send and receive messages without requiring a Meta Business account. The bot will act as a participant in a family chat or receive direct messages.

### R2. Cloud Database
The system must use a free cloud database (e.g., Firebase) to persist the active shopping list and long-term shopping habits, ensuring data isn't lost if the bot restarts.

### R3. List Management & Journaling
- **Add:** When a user texts an item (e.g., "cioccolato"), it is added to the list. If they mention a store (e.g., "cioccolato eurospin"), the system must log this as a habit/preference for future reference.
- **Reset:** Sending "reset" clears the list and broadcasts a notification to all members that the shopping is done. Sending "reset [store]" logs that the current list was purchased at that specific store before clearing it.

## Acceptance Criteria

### Testing & Verification
Since testing a WhatsApp bot requires physical QR code scanning, the system must include a local CLI or Mock mode to verify logic programmatically.
- [ ] A simulated "add item" command (e.g., via CLI) successfully writes the item to the database.
- [ ] A simulated "add item with store" command correctly extracts the store name and updates the habit tracker in the database.
- [ ] A simulated "reset" command clears the active list in the database and triggers the broadcast notification logic.
- [ ] Documentation is provided on how to deploy the bot to a free cloud hosting service (e.g., Render) and how to scan the QR code.
