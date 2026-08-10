# Handoff Report: Milestone 2 CLI / Mock Mode Runner Specification (`bin/cli.js`)

## 1. Observation
- **Project Structure**:
  - Codebase uses ES Modules (`"type": "module"` in `package.json:5`).
  - Core domain services already exist in `src/domain/ShoppingListService.js`, `src/domain/MessageParser.js`, `src/domain/HabitTracker.js`, `src/db/MockDatabaseAdapter.js`, `src/db/FirestoreAdapter.js`, and `src/broadcaster/MockBroadcaster.js`.
- **E2E Test Specifications**:
  - `tests/e2e/tier4_real_world.test.js` lines 98–120 define `T4.4: CLI Binary Execution End-to-End (bin/cli.js)` using `child_process.spawnSync`:
    - `spawnSync('node', [cliPath, 'add', 'mele', '--store', 'coop'])` -> status 0
    - `spawnSync('node', [cliPath, 'list'])` -> status 0, stdout includes `'mele'`
    - `spawnSync('node', [cliPath, 'reset', '--store', 'coop'])` -> status 0
- **Requirements & Acceptance Criteria**:
  - `ORIGINAL_REQUEST.md` lines 25–28 mandate CLI / Mock mode to verify logic programmatically (`add`, `add with store`, `reset` with broadcast notification).
  - `PROJECT.md` line 15 defines Milestone 2 CLI Runner `bin/cli.js`.

---

## 2. Logic Chain
1. **Observation**: E2E test `T4.4` spawns separate `node bin/cli.js` processes sequentially.
2. **Inference**: Each CLI invocation starts in a new Node.js process environment. An in-memory database adapter alone would lose data across distinct invocations.
3. **Deduction**: `bin/cli.js` must implement file-backed persistence for `MockDatabaseAdapter` (reading and writing `.mock_db.json` or `process.env.MOCK_DB_FILE`) so state persists across CLI invocations when running in Mock mode.
4. **Observation**: `MessageParser` standardizes command parsing for `add`, `reset`, `list`, `habits`, and `help`.
5. **Deduction**: `bin/cli.js` should combine command-line flag parsing (`-s`, `--store`, `--sender`, `--db`) with `MessageParser` natural text processing so both CLI flag syntax (`add mele --store coop`) and freeform text syntax (`add "mele @ coop"`) work seamlessly.
6. **Observation**: `ShoppingListService.resetList()` triggers `MockBroadcaster.broadcastReset()`, which returns broadcast payloads and emits real-time events.
7. **Deduction**: `bin/cli.js` should attach an `onBroadcast` listener to `MockBroadcaster` to format and print broadcast notification banners to `stdout`.

---

## 3. Caveats
- **Environment Constraints**: `FirestoreAdapter` requires `FIREBASE_SERVICE_ACCOUNT` or default GCP credentials. If not set, CLI defaults to `MockDatabaseAdapter` with `.mock_db.json` persistence.
- **Process Signals**: Signal handling (e.g. `SIGINT`/`SIGTERM`) is not strictly needed for non-interactive single-command CLI execution, but graceful exit and state flushing must occur before process exit.

---

## 4. Conclusion
`bin/cli.js` must be implemented as an ES module binary with:
1. `#!/usr/bin/env node` shebang line and `chmod +x` permissions.
2. Argument parser handling `add`, `reset`, `list`, `habits`, `help` and options `--store`, `-s`, `--sender`, `--db`.
3. Wiring of `ShoppingListService`, `MessageParser`, `HabitTracker`, `MockBroadcaster`, and `MockDatabaseAdapter` with `.mock_db.json` JSON file state persistence (or `FirestoreAdapter` when configured).
4. Broadcast message printing to `stdout` (`📢 [BROADCAST] ...`).
5. Standard exit code behavior: `0` on success, `1` on invalid command or validation/runtime errors (with error details output to `stderr`).

---

## 5. Verification Method
1. **Manual Execution Verification**:
   - `node bin/cli.js add "mele" --store "coop"` -> exit status 0.
   - `node bin/cli.js list` -> exit status 0, stdout contains `"mele"`.
   - `node bin/cli.js reset --store "coop"` -> exit status 0, stdout contains broadcast banner.
   - `node bin/cli.js list` -> exit status 0, stdout contains `"empty"`.
   - `node bin/cli.js invalid` -> exit status 1, stderr contains error message.
2. **Automated Test Suite**:
   - Run `npm test` or `node --test tests/e2e/tier4_real_world.test.js` to run end-to-end tests including `T4.4`.
