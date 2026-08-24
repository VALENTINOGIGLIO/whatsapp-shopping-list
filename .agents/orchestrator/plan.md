# Orchestration Plan — Fix WhatsApp Shopping List Bot (R1-R3)

## Mission & Scope
Fix the WhatsApp Shopping List bot so that it runs, deploys correctly, and functions as intended without errors.
- R1: Understand Architecture (read source code, PROJECT.md, DEPLOYMENT.md, config files).
- R2: Diagnose & Fix Issues (identify runtime errors, WhatsApp client auth/pairing, deployment config, command handling).
- R3: Verify Deployment and Functionality (ensure bot can start, pair/QR without crash, all tests pass, responds to shopping list commands).

## Plan Steps

### Phase 1: Architecture & Diagnostic Exploration (3 Explorers)
- Explorer 1: WhatsApp Client, Authentication/Pairing (Baileys/Puppeteer), session persistence, and QR handling.
- Explorer 2: Core Domain (ShoppingListService, HabitTracker, MessageParser), CLI runner (`bin/cli.js`), and test suites (`tests/`).
- Explorer 3: Web Server (`src/web/server.js`), Dockerfile, `render.yaml`, environment variables, and deployment readiness.

### Phase 2: Synthesis & Diagnostic Strategy Formulation
- Synthesize all findings from Explorers into an authoritative remediation plan.
- Identify exact bugs, architectural flaws, syntax errors, or deployment issues.
- Assign clear write boundaries and implementation instructions for Worker.

### Phase 3: Implementation by Worker
- Dispatch `teamwork_preview_worker` to apply the required fixes.
- Mandatory integrity warning included.
- Worker runs tests and build verification locally.

### Phase 4: Multi-Tier Verification & Gating
- Dispatch Reviewer 1 (Code & Architecture Review)
- Dispatch Reviewer 2 (Deployment & Runtime Review)
- Dispatch Challenger 1 (Test Suite & CLI execution)
- Dispatch Challenger 2 (Adversarial & Failure Mode execution)
- Dispatch Forensic Auditor (`teamwork_preview_auditor`) for integrity audit.
- Strict AND Gate evaluation in `GATE_STATUS.md`.

### Phase 5: Finalization & Victory Report
- Write final handoff and briefing state.
- Send completion message to parent.

