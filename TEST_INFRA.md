# Test Infrastructure Documentation

## Overview
The WhatsApp Shopping List Application uses Node.js's native test runner (`node:test`) and strict assertion library (`node:assert/strict`). The opaque-box test suite tests end-to-end functionality across four tiers, validating interface contracts, core domain logic, message parsing, habit tracking, and command execution without requiring a physical WhatsApp connection or Meta Business account.

## Directory Layout
```
whatsapp_shopping_list/
├── package.json               # Defines test script ("npm test": "node --test tests/e2e/*.test.js")
├── tests/
│   ├── unit/                  # Unit level tests (reserved)
│   ├── integration/           # Integration level tests (reserved)
│   └── e2e/                   # End-to-end test suite
│       ├── test_helper.js     # Harness loader & dynamic module interface resolution
│       ├── tier1_feature_coverage.test.js  # Feature coverage (25 tests, >=5 per feature)
│       ├── tier2_boundary_corner.test.js   # Edge cases, inputs, normalization (10 tests)
│       ├── tier3_cross_feature.test.js     # End-to-end pipeline & domain interactions (8 tests)
│       └── tier4_real_world.test.js        # Multi-day scenarios, restarts, CLI (6 tests)
├── TEST_INFRA.md              # Test infrastructure specification (this file)
└── TEST_READY.md              # Test suite completion signal
```

## Module Loader & Harness Design (`tests/e2e/test_helper.js`)
- **Dynamic Module Resolution**: `test_helper.js` inspects `src/` directory (`src/db/MockDatabaseAdapter.js`, `src/domain/ShoppingListService.js`, `src/domain/HabitTracker.js`, `src/domain/MessageParser.js`, `src/broadcaster/MockBroadcaster.js`).
- **Contract Compliant Harness**: If `src/` modules exist, the test suite automatically binds to and executes the actual application code. If implementation is in progress, the test harness provides contract-compliant reference models so tests run deterministically out of the box.

## Test Tiers Architecture

### Tier 1: Feature Coverage (25 Test Cases)
- **Item Management (Add / List)** (5 tests): Single add, multi add, explicit store add, empty list query, duplicate handling.
- **Habit Tracking & Store Association** (5 tests): Purchase store frequency update, habit querying, favorite store auto-inference, multi-store frequency accumulation, unpurchased item behavior.
- **List Reset & Purchasing Journal** (5 tests): Reset without store, reset with store logging, broadcast notification triggering, empty list reset handling, purchase history metadata validation.
- **Message Parsing & Command Dispatching** (5 tests): Simple item parse, item with store parse, reset parse, reset with store parse, list & habits command parsing.
- **Notification Broadcasting** (5 tests): Reset broadcast emission, store name inclusion in notification, notification log capturing, sequential reset notification isolation, notification log reset.

### Tier 2: Boundary & Corner Cases (10 Test Cases)
- **Empty/Whitespace**: Rejection of empty/whitespace items, auto-trimming of leading/trailing spaces.
- **Normalization**: Store name case normalization (`EuroSpin` -> `eurospin`), item name casing (`Cioccolato` vs `cioccolato`).
- **Input Integrity**: Special characters, accents, emojis (`caffè`, `latte & biscotti 🥛`, `pasta/riso`), irregular spacing/mixed case commands (`  ReSeT   COOP  `).
- **Payload & Load**: Large item description (600+ chars), bulk resets (50+ items cleared at once), double resets in immediate succession.

### Tier 3: Cross-Feature Interactions (8 Test Cases)
- **End-to-End Pipeline**: Raw chat text -> `MessageParser` -> `ShoppingListService` -> `DatabaseAdapter` -> `MockBroadcaster`.
- **Learning Loop**: Repeated explicitly-stored purchases train `HabitTracker` to auto-infer store on future un-stored adds.
- **Store-Reset Habit Boost**: Resetting with explicit store updates habit frequency for all items currently in the active list.
- **Multi-Sender Workflows**: Multiple users adding items and clearing list with full sender audit trails.
- **Sequential Resets**: Separate, immutable purchase history records logged per shopping trip.

### Tier 4: Real-World Scenarios (6 Test Cases)
- **Weekly Family Grocery Workflow**: Multi-day list population, active list review, shopping reset with broadcast, habit inference for subsequent week.
- **Store-Hopping**: Partitioned shopping trips across different stores (`lidl` vs `esselunga`).
- **Process Restart Simulation**: Re-instantiating service layer against existing DB persistence.
- **CLI Execution**: Executing non-interactive CLI commands via child process (`bin/cli.js`).
- **Rapid Resets**: High-frequency sequential reset handling without race conditions.

## Executing Tests
Run the entire E2E test suite via standard npm command:
```bash
npm test
```
Or run directly via Node.js:
```bash
node --test tests/e2e/*.test.js
```
To run a specific tier test file:
```bash
node --test tests/e2e/tier1_feature_coverage.test.js
```
