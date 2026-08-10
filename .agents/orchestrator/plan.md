# Project Plan: WhatsApp Shopping List Application

## Objectives
1. Build a Node.js WhatsApp shopping list bot using `whatsapp-web.js` (or Node.js alternative).
2. Cloud DB persistence (Firestore / adapter pattern with mock storage for tests).
3. List management with store habit tracking (`cioccolato`, `cioccolato eurospin`, `reset`, `reset [store]`).
4. CLI / Mock mode runner to programmatically execute and test all features without requiring active WhatsApp connection during automated tests.
5. Deployment guide for free cloud hosting (Render) & QR code scanning instructions.

## Work Breakdown & Milestones
- **Step 0: Survey & Architecture Setup**
  - Spawn 3 Explorers in parallel to survey project structure, existing files, npm environment, dependencies, and requirements.
  - Synthesize findings and write `PROJECT.md` with Feature Inventory, Architecture, Code Layout, and Milestones.

- **Track 1: E2E Testing Suite**
  - Spawn E2E Testing Orchestrator / Test Writers to create full test harness and test cases (Tiers 1-4).
  - Publish `TEST_INFRA.md` and `TEST_READY.md`.

- **Track 2: Implementation Milestones**
  - **M1: Data Storage & Habit Tracking Domain Layer**
    - Cloud DB integration (Firestore / configurable local mock adapter).
    - Shopping list CRUD and habit tracking logic (item -> store mapping, frequency counter).
  - **M2: Message Handling & WhatsApp Bot Integration**
    - `whatsapp-web.js` integration layer (QR generation, message listener, chat broadcasting).
    - Command parser & handler for `add item`, `add item store`, `reset`, `reset [store]`.
  - **M3: CLI / Mock Mode Runner**
    - CLI runner enabling programmatic execution of commands: add, add with store, reset, reset store.
    - CLI output & broadcast notification trigger verification.
  - **M4: Final Integration & E2E Verification**
    - Phase 1: Pass 100% of E2E test suite (Tiers 1-4).
    - Phase 2: Adversarial coverage hardening (Tier 5).
  - **M5: Deployment Documentation**
    - Comprehensive guide for deploying to Render (or free cloud service), environment variables setup, and QR code scanning procedure.

## Verification Gate Criteria per Milestone
1. Build and unit/integration tests pass.
2. All 2 Reviewer verdicts are APPROVE.
3. All 2 Challenger verdicts confirm empirical correctness.
4. Forensic Auditor verdict is CLEAN (no hardcoding, fake facade implementations, or cheating).
