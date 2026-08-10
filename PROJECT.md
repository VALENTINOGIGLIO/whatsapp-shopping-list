# Project: WhatsApp Shopping List Application

## Architecture
- Decoupled 3-tier architecture: Transport Adapters (WhatsApp / CLI) -> Core Business Logic (ShoppingListService, MessageParser, Broadcaster) -> Data Layer (DatabaseAdapter with MockDatabaseAdapter & FirestoreAdapter).
- Express Web Server for health check pings (`/health`, preventing Render free instance 15-min sleep) and web UI for QR code scanning (`/qr`).

## Feature Inventory
Every feature from the Survey phase is mapped to a specific milestone.
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Database Abstraction & Mock Adapter | `DatabaseAdapter` interface with `MockDatabaseAdapter` (in-memory/file storage for fast offline tests) and `FirestoreAdapter` (cloud DB persistence). | M1 | survey |
| 2 | Habit Tracker & Journaling Domain Service | `HabitTracker` logic tracking item-to-store purchase frequency, favorite store calculation, and `purchase_history` reset logging. | M1 | survey |
| 3 | Shopping List Domain Service & Parser | `ShoppingListService` for adding items, adding items with store, inferring store preferences, and resetting lists. `MessageParser` for command matching. | M1 | survey |
| 4 | Notification Broadcaster | `NotificationBroadcaster` interface with `MockBroadcaster` (capturing broadcast notifications programmatically) and `WhatsAppBroadcaster`. | M1 | survey |
| 5 | CLI / Mock Mode Runner | Non-interactive CLI binary (`bin/cli.js`) supporting `add`, `add [store]`, `reset`, `reset [store]`, and verifying DB updates & broadcast triggers. | M2 | survey |
| 6 | E2E Test Harness & Suite | Opaque-box test suite (Tiers 1-4) running via `npm test` against CLI/Mock mode without physical WhatsApp connection. | M3 | survey |
| 7 | WhatsApp Integration Adapter | `whatsapp-web.js` (or Node.js alternative) client integration handling message events, command dispatching, and broadcast notifications. | M4 | survey |
| 8 | Express Web Server (/health & /qr) | Express HTTP server providing `/health` endpoint for uptime pings and `/qr` endpoint for browser QR scanning. | M4 | survey |
| 9 | Cloud Deployment Guide | Comprehensive markdown documentation (`DEPLOYMENT.md`) covering Render deployment, environment variables, and QR code setup. | M5 | survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Data & Domain Core Layer | DatabaseAdapter (Mock & Firestore), HabitTracker, ShoppingListService, MessageParser, NotificationBroadcaster | none | DONE |
| 2 | CLI / Mock Mode Runner | CLI interface (`bin/cli.js`) wrapping ShoppingListService to execute commands programmatically | M1 | DONE |
| 3 | E2E Testing Suite | E2E test runner and test cases (Tiers 1-4) testing CLI / Mock mode | M1, M2 | DONE |
| 4 | WhatsApp Integration & Web Server | WhatsApp Web client adapter, Express server (`/health`, `/qr`), session persistence | M1, M2 | DONE |
| 5 | Cloud Deployment Documentation | Render deployment guide, env vars setup, QR code scanning instructions (`DEPLOYMENT.md`) | M4 | DONE |

## Interface Contracts
### Transport Layer (WhatsApp / CLI) ↔ Core Business Logic (`ShoppingListService`)
- `addItem(itemName: string, storeName?: string, sender?: string): Promise<{ item: ShoppingListItem, habitUpdated: boolean }>`
- `resetList(storeName?: string, sender?: string): Promise<{ resetRecord: PurchaseHistoryRecord, itemsCleared: number }>`
- `getList(): Promise<ShoppingListItem[]>`
- `getHabits(itemName?: string): Promise<ItemHabit[]>`

### Core Business Logic ↔ Database Layer (`DatabaseAdapter`)
- `getActiveItems(): Promise<ShoppingListItem[]>`
- `saveActiveItem(item: ShoppingListItem): Promise<void>`
- `deleteActiveItems(): Promise<number>`
- `getHabit(itemName: string): Promise<ItemHabit | null>`
- `saveHabit(habit: ItemHabit): Promise<void>`
- `savePurchaseHistory(record: PurchaseHistoryRecord): Promise<void>`

## Code Layout
- `package.json`
- `src/`
  - `config/firebase.js`
  - `db/DatabaseAdapter.js`
  - `db/MockDatabaseAdapter.js`
  - `db/FirestoreAdapter.js`
  - `domain/ShoppingListService.js`
  - `domain/HabitTracker.js`
  - `domain/MessageParser.js`
  - `broadcaster/NotificationBroadcaster.js`
  - `broadcaster/MockBroadcaster.js`
  - `broadcaster/WhatsAppBroadcaster.js`
  - `whatsapp/whatsappClient.js`
  - `web/server.js`
- `bin/cli.js`
- `tests/`
  - `unit/`
  - `integration/`
  - `e2e/`
- `DEPLOYMENT.md`
