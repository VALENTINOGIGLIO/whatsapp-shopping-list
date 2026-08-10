import assert from 'node:assert/strict';
import { ShoppingListService } from '../../src/domain/ShoppingListService.js';
import { MessageParser } from '../../src/domain/MessageParser.js';
import { HabitTracker } from '../../src/domain/HabitTracker.js';
import { MockDatabaseAdapter } from '../../src/db/MockDatabaseAdapter.js';
import { FirestoreAdapter } from '../../src/db/FirestoreAdapter.js';
import { MockBroadcaster } from '../../src/broadcaster/MockBroadcaster.js';
import { CommandType } from '../../src/domain/CommandType.js';

console.log('=== EXTENDED EMPIRICAL STRESS & ADVERSARIAL HARNESS ===');

const results = [];

function recordResult(category, testName, passed, details = '') {
  results.push({ category, testName, passed, details });
  const status = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${status}] [${category}] ${testName} ${details ? '(' + details + ')' : ''}`);
}

async function runExtendedTests() {

  // ==========================================
  // SECTION 1: DEEP CLONING & MUTATION ISOLATION
  // ==========================================
  try {
    const db = new MockDatabaseAdapter();
    const service = new ShoppingListService(db);

    const { item } = await service.addItem("pasta", "coop");
    item.name = "CORRUPTED_NAME";
    item.store = "CORRUPTED_STORE";

    const fetchedActive = await service.getList();
    const isIsolated = fetchedActive[0].name === "pasta" && fetchedActive[0].store === "coop";
    recordResult('MutationIsolation', 'Active item deep clone on return & save', isIsolated);

    // Test Habit mutation isolation with fresh DB
    const dbHabit = new MockDatabaseAdapter();
    const tracker = new HabitTracker(dbHabit);
    await tracker.trackPurchase("pasta", "coop", dbHabit);
    const habits = await tracker.getHabits("pasta", dbHabit);
    const initialCount = habits[0].stores.coop;
    habits[0].stores.coop = 99999;
    const habitsAgain = await tracker.getHabits("pasta", dbHabit);
    const isHabitIsolated = habitsAgain[0].stores.coop === initialCount && initialCount === 1;
    recordResult('MutationIsolation', 'Habits deep clone isolation', isHabitIsolated);
  } catch (err) {
    recordResult('MutationIsolation', 'Mutation suite error', false, err.message);
  }

  // ==========================================
  // SECTION 2: INPUT VALIDATION & TYPE SAFETY
  // ==========================================
  try {
    const db = new MockDatabaseAdapter();
    const service = new ShoppingListService(db);

    let rejectedInvalidTypes = true;

    const invalidInputs = [
      "",
      "   ",
      "\n\t  ",
      null,
      undefined,
      123,
      true,
      {},
      [],
      () => {}
    ];

    for (const input of invalidInputs) {
      try {
        await service.addItem(input);
        rejectedInvalidTypes = false;
        console.error(`Failed to reject invalid input: ${JSON.stringify(input)}`);
      } catch (err) {
        // Expected error
      }
    }
    recordResult('InputValidation', 'Rejection of non-string and empty item names', rejectedInvalidTypes);
  } catch (err) {
    recordResult('InputValidation', 'Input validation suite error', false, err.message);
  }

  // ==========================================
  // SECTION 3: EMPTY LIST RESETS & BROADCAST RESILIENCE
  // ==========================================
  try {
    const db = new MockDatabaseAdapter();
    const broadcaster = new MockBroadcaster();
    const service = new ShoppingListService({ dbAdapter: db, broadcaster });

    // Reset empty list
    const res1 = await service.resetList();
    recordResult('ResetResilience', 'Reset on empty list', res1.itemsCleared === 0 && res1.resetRecord.items.length === 0);

    // Immediate second reset with store
    const res2 = await service.resetList("esselunga");
    recordResult('ResetResilience', 'Sequential reset on empty list with store', res2.itemsCleared === 0 && res2.resetRecord.store === "esselunga");

    const notifications = broadcaster.getSentNotifications();
    recordResult('ResetResilience', 'Broadcaster captured empty resets', notifications.length === 2);
  } catch (err) {
    recordResult('ResetResilience', 'Reset suite error', false, err.message);
  }

  // ==========================================
  // SECTION 4: FIRESTORE ADAPTER MOCK INTERACTION
  // ==========================================
  try {
    // Memory mock for Firestore SDK methods
    const mockStore = new Map();
    const mockFirestore = {
      collection: (collName) => ({
        doc: (docId) => ({
          get: async () => {
            const data = mockStore.get(`${collName}/${docId}`);
            return {
              exists: !!data,
              data: () => data ? JSON.parse(JSON.stringify(data)) : null
            };
          },
          set: async (data, opts) => {
            const existing = mockStore.get(`${collName}/${docId}`) || {};
            const merged = opts && opts.merge ? { ...existing, ...data } : data;
            mockStore.set(`${collName}/${docId}`, JSON.parse(JSON.stringify(merged)));
          }
        }),
        get: async () => {
          const docs = [];
          for (const [key, val] of mockStore.entries()) {
            if (key.startsWith(`${collName}/`)) {
              docs.push({
                ref: key,
                data: () => JSON.parse(JSON.stringify(val))
              });
            }
          }
          return {
            empty: docs.length === 0,
            size: docs.length,
            forEach: (cb) => docs.forEach(cb),
            docs
          };
        }
      }),
      batch: () => {
        const ops = [];
        return {
          delete: (ref) => ops.push(() => mockStore.delete(ref)),
          commit: async () => { ops.forEach(fn => fn()); }
        };
      }
    };

    const firestoreAdapter = new FirestoreAdapter(mockFirestore);
    await firestoreAdapter.saveActiveItem({ name: 'latte', canonicalName: 'latte', store: 'coop' });
    const items = await firestoreAdapter.getActiveItems();
    recordResult('FirestoreAdapter', 'Firestore mock save and read', items.length === 1 && items[0].name === 'latte');

    await firestoreAdapter.saveHabit({ itemName: 'latte', favoriteStore: 'coop' });
    const habit = await firestoreAdapter.getHabit('latte');
    recordResult('FirestoreAdapter', 'Firestore mock habit save and read', habit.favoriteStore === 'coop');

    await firestoreAdapter.clearAllData();
    const itemsCleared = await firestoreAdapter.getActiveItems();
    recordResult('FirestoreAdapter', 'Firestore mock clearAllData', itemsCleared.length === 0);
  } catch (err) {
    recordResult('FirestoreAdapter', 'Firestore adapter suite error', false, err.message);
  }

  // ==========================================
  // SECTION 5: HABIT TIE-BREAKING & DYNAMIC PREFERENCE CHANGE
  // ==========================================
  try {
    const db = new MockDatabaseAdapter();
    const tracker = new HabitTracker(db);

    // Track 2 purchases for coop, 2 purchases for conad
    await tracker.trackPurchase("pane", "coop", db);
    await tracker.trackPurchase("pane", "coop", db);
    await tracker.trackPurchase("pane", "conad", db);
    await tracker.trackPurchase("pane", "conad", db);

    const fav1 = await tracker.getFavoriteStore("pane", db);
    // Alphabetical tie breaking: "conad" comes before "coop"
    recordResult('HabitTracker', 'Alphabetical tie-breaking (conad vs coop)', fav1 === "conad", `Favorite: ${fav1}`);

    // Track 1 more purchase for coop -> coop has 3, conad has 2
    await tracker.trackPurchase("pane", "coop", db);
    const fav2 = await tracker.getFavoriteStore("pane", db);
    recordResult('HabitTracker', 'Dynamic favorite update (coop takes lead)', fav2 === "coop", `Favorite: ${fav2}`);
  } catch (err) {
    recordResult('HabitTracker', 'HabitTracker suite error', false, err.message);
  }

  // Summary
  console.log('\n=== EXTENDED STRESS TEST SUMMARY ===');
  const total = results.length;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = total - passedCount;
  console.log(`Total: ${total} | Passed: ${passedCount} | Failed: ${failedCount}`);

  if (failedCount > 0) {
    console.error('FAILURES FOUND:');
    results.filter(r => !r.passed).forEach(r => console.error(` - [${r.category}] ${r.testName}: ${r.details}`));
    process.exit(1);
  }
}

runExtendedTests();
