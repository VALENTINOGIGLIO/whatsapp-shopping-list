# Handoff Report: MessageParser, NotificationBroadcaster & MockBroadcaster Specification

**Agent:** teamwork_preview_explorer_m1_3  
**Working Directory:** `/Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/teamwork_preview_explorer_m1_3`  
**Date:** 2026-08-10  
**Handoff Type:** Hard  

---

## 1. Observation

- **Original Request (`ORIGINAL_REQUEST.md`)**:
  - Line 19: *"Add: When a user texts an item (e.g., 'cioccolato'), it is added to the list. If they mention a store (e.g., 'cioccolato eurospin'), the system must log this as a habit/preference for future reference."*
  - Line 20: *"Reset: Sending 'reset' clears the list and broadcasts a notification to all members that the shopping is done. Sending 'reset [store]' logs that the current list was purchased at that specific store before clearing it."*
  - Line 28: *"A simulated 'reset' command clears the active list in the database and triggers the broadcast notification logic."*

- **Project Specification (`PROJECT.md`)**:
  - Line 13: Feature 3: *"ShoppingListService for adding items, adding items with store... MessageParser for command matching."*
  - Line 14: Feature 4: *"NotificationBroadcaster interface with MockBroadcaster (capturing broadcast notifications programmatically) and WhatsAppBroadcaster."*
  - Line 54-56: Code Layout:
    - `src/domain/MessageParser.js`
    - `src/broadcaster/NotificationBroadcaster.js`
    - `src/broadcaster/MockBroadcaster.js`

- **Directory State**:
  - Investigated root project directory `/Users/gi/teamwork_projects/whatsapp_shopping_list`. `find_by_name` returned `ORIGINAL_REQUEST.md` and `PROJECT.md`. Source files have not been implemented yet.

---

## 2. Logic Chain

1. **Observation Reference**: `ORIGINAL_REQUEST.md` lines 19-20 define user commands `"cioccolato"`, `"cioccolato eurospin"`, `"reset"`, and `"reset eurospin"`.
   - **Reasoning**: A central parser (`MessageParser`) is necessary to normalize raw user input from WhatsApp or CLI before calling `ShoppingListService`. The parser must classify inputs into distinct command types (`ADD_ITEM`, `RESET_LIST`, `GET_LIST`, `GET_HABITS`, `HELP`, `UNKNOWN`) and extract store names using explicit delimiters (`@`, `at`, `da`, `in`, `-`) and multi-word token heuristics.

2. **Observation Reference**: `PROJECT.md` line 14 & `ORIGINAL_REQUEST.md` line 28 require decoupling notification broadcasting from physical WhatsApp infrastructure to support offline testing and CLI output.
   - **Reasoning**: `NotificationBroadcaster` must be designed as an abstract base class defining standard contracts (`broadcastReset`, `broadcastNotification`, `broadcastItemAdded`). `MockBroadcaster` inherits from `NotificationBroadcaster` and captures all broadcast events in an internal array while supporting event listeners (`onBroadcast`), allowing CLI tools and test runners to inspect broadcast outputs deterministically.

3. **Observation Reference**: Architectural alignment across Milestone 1 modules (DB Adapters by `m1_1`, Domain Services by `m1_2`, and Parsers/Broadcasters by `m1_3`).
   - **Reasoning**: When `ShoppingListService.resetList()` executes, it accepts a `storeName` parameter parsed by `MessageParser`, executes DB clearing via `DatabaseAdapter`, and calls `broadcaster.broadcastReset(resetRecord)`. The contract signatures across all three explorer specifications are strictly aligned.

---

## 3. Caveats

- **Store Extraction Ambiguity in Free Text**: In multi-word item strings without explicit delimiters (e.g. `"pane latte coop"` vs `"pane latte fresco"`), `MessageParser` relies on explicit delimiters (`@`, `da`, `at`, `-`), 2-token heuristics (`itemName` `storeName`), or a list of known stores to avoid misidentifying item adjectives as store names.
- **Subclass Requirement**: `NotificationBroadcaster` methods throw descriptive runtime errors if called directly without subclassing.

---

## 4. Conclusion

The specification and architecture for `src/domain/MessageParser.js`, `src/broadcaster/NotificationBroadcaster.js`, and `src/broadcaster/MockBroadcaster.js` are complete and fully specified in `analysis.md`:
1. `MessageParser` maps all user input forms to strongly-typed `ParsedCommand` objects.
2. `NotificationBroadcaster` establishes an abstract contract for event dispatching.
3. `MockBroadcaster` captures event payloads in memory for fast, offline, 100% deterministic unit/E2E test verification.
4. An actionable 3-step implementation plan has been established for implementer agents.

---

## 5. Verification Method

To verify this report and specification:
1. View `/Users/gi/teamwork_projects/whatsapp_shopping_list/.agents/teamwork_preview_explorer_m1_3/analysis.md` to inspect the full class code blueprints, grammar rules, data contracts, and edge-case matrix.
2. Compare `MessageParser` edge-case matrix against requirement lines 19-20 in `ORIGINAL_REQUEST.md`.
3. Invalidation condition: If any command string specified in `ORIGINAL_REQUEST.md` fails to parse into the correct `ParsedCommand` schema, or if `MockBroadcaster` fails to capture `broadcastReset` payloads, the specification is invalid.
