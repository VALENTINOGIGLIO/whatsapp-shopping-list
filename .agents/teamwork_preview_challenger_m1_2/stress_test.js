import { HabitTracker } from '../../src/domain/HabitTracker.js';
import { ShoppingListService } from '../../src/domain/ShoppingListService.js';
import { MessageParser } from '../../src/domain/MessageParser.js';
import { MockDatabaseAdapter } from '../../src/db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../../src/broadcaster/MockBroadcaster.js';
import { FirestoreAdapter } from '../../src/db/FirestoreAdapter.js';

async function runStressTests() {
  console.log('=== EMPIRICAL STRESS TEST SUITE ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // TEST GROUP 1: HABIT FREQUENCY CALCULATION & CORNER CASES
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: Habit Frequency Calculation ---');
  {
    const db = new MockDatabaseAdapter();
    const tracker = new HabitTracker(db);

    // 1.1 Incremental Purchases
    await tracker.trackPurchase('latte', 'coop');
    await tracker.trackPurchase('latte', 'coop');
    await tracker.trackPurchase('latte', 'conad');
    
    let habit = await tracker.getHabits('latte');
    assert(habit.length === 1, 'getHabits("latte") returns 1 record');
    assert(habit[0].stores.coop === 2, 'coop purchase count is 2');
    assert(habit[0].stores.conad === 1, 'conad purchase count is 1');
    assert(habit[0].favoriteStore === 'coop', 'favorite store is coop (2 > 1)');
    assert(habit[0].totalPurchases === 3, 'totalPurchases is 3');

    // 1.2 Case & Accent Normalization
    await tracker.trackPurchase('  CAFFÈ  ', '  ÈLECLERC  ');
    await tracker.trackPurchase('caffè', 'èleclerc');
    let caffeHabit = await tracker.getHabits('caffè');
    assert(caffeHabit.length === 1, 'Normalizes caffe item key correctly');
    assert(caffeHabit[0].stores['èleclerc'] === 2, 'Normalizes store èleclerc count to 2');

    // 1.3 Null & Boundary Inputs
    const res1 = await tracker.trackPurchase(null, 'coop');
    assert(res1 === null, 'trackPurchase with null item returns null');
    const res2 = await tracker.trackPurchase('latte', '');
    assert(res2 === null, 'trackPurchase with empty store returns null');
    const favNull = tracker.calculateFavoriteStore(null);
    assert(favNull === null, 'calculateFavoriteStore(null) returns null');
    const favEmpty = tracker.calculateFavoriteStore({});
    assert(favEmpty === null, 'calculateFavoriteStore({}) returns null');
  }

  // -------------------------------------------------------------
  // TEST GROUP 2: STORE PREFERENCE TIE-BREAKING
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Store Preference Tie-Breaking ---');
  {
    const tracker = new HabitTracker();

    // 2.1 Lexicographical Tie-Breaking: 'albert' vs 'coop' vs 'esselunga' (all count 2)
    const storeCounts1 = { esselunga: 2, coop: 2, albert: 2 };
    const fav1 = tracker.calculateFavoriteStore(storeCounts1);
    assert(fav1 === 'albert', `Tie-break [esselunga:2, coop:2, albert:2] -> expected 'albert', got '${fav1}'`);

    // 2.2 Dynamic Frequency Shift Overcoming Tie
    const db = new MockDatabaseAdapter();
    const trackerDb = new HabitTracker(db);

    await trackerDb.trackPurchase('pane', 'coop');
    await trackerDb.trackPurchase('pane', 'conad');
    let favTie = await trackerDb.getFavoriteStore('pane');
    // 'conad' vs 'coop' (both count 1) -> 'conad' is alphabetically first
    assert(favTie === 'conad', `Initial 1-1 tie ('coop' vs 'conad') -> expected 'conad', got '${favTie}'`);

    // Add another purchase at 'coop' -> count 2
    await trackerDb.trackPurchase('pane', 'coop');
    let favCoop = await trackerDb.getFavoriteStore('pane');
    assert(favCoop === 'coop', `After coop reaches 2 vs conad 1 -> expected 'coop', got '${favCoop}'`);

    // 2.3 Special characters in tie breaking
    const storeCounts2 = { 'z-store': 5, 'a-store': 5 };
    const favSpecial = tracker.calculateFavoriteStore(storeCounts2);
    assert(favSpecial === 'a-store', `Tie-break 'a-store' vs 'z-store' -> expected 'a-store', got '${favSpecial}'`);
  }

  // -------------------------------------------------------------
  // TEST GROUP 3: RESET PURCHASE JOURNALING
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Reset Purchase Journaling ---');
  {
    const db = new MockDatabaseAdapter();
    const broadcaster = new MockBroadcaster();
    const service = new ShoppingListService(db, broadcaster);

    // 3.1 Reset with items and store
    await service.addItem('cioccolato');
    await service.addItem('latte', 'coop');
    const resetResult = await service.resetList('eurospin', 'mario');

    assert(resetResult.itemsCleared === 2, 'itemsCleared is 2');
    assert(resetResult.resetRecord.store === 'eurospin', 'resetRecord store is eurospin');
    assert(resetResult.resetRecord.resetBy === 'mario', 'resetRecord resetBy is mario');
    assert(resetResult.resetRecord.items.length === 2, 'resetRecord items length is 2');

    // Check active items empty
    const active = await db.getActiveItems();
    assert(active.length === 0, 'Active list cleared after reset');

    // Check purchase history in DB
    const history = await db.getPurchaseHistory();
    assert(history.length === 1, '1 purchase history record in DB');
    assert(history[0].store === 'eurospin', 'DB history record store is eurospin');

    // Check habits updated for both items at eurospin
    const habitCioccolato = await db.getHabit('cioccolato');
    const habitLatte = await db.getHabit('latte');
    assert(habitCioccolato.stores.eurospin === 1, 'cioccolato habit updated with eurospin');
    assert(habitLatte.stores.eurospin === 1, 'latte habit updated with eurospin (was coop before)');
    assert(habitLatte.stores.coop === 1, 'latte retains previous coop purchase');

    // 3.2 Reset on empty list
    const emptyReset = await service.resetList('conad', 'luigi');
    assert(emptyReset.itemsCleared === 0, 'Empty list reset clears 0 items');
    const history2 = await db.getPurchaseHistory();
    assert(history2.length === 2, '2 purchase history records now in DB');
    assert(history2[1].itemsCleared === 0, 'Second history record has itemsCleared = 0');
  }

  // -------------------------------------------------------------
  // TEST GROUP 4: NOTIFICATION EVENTS & LISTENER AUDITING
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Notification Events & Listeners ---');
  {
    const broadcaster = new MockBroadcaster();
    const events = [];

    broadcaster.onBroadcast(evt => {
      events.push({ ...evt }); // snapshot when listener is called
    });

    // 4.1 Test broadcastReset listener snapshot vs eventual object state
    const dummyRecord = {
      id: 'reset_123',
      store: 'COOP',
      itemsCleared: 3,
      items: [{ name: 'pane' }, { name: 'latte' }, { name: 'burro' }]
    };

    await broadcaster.broadcastReset(dummyRecord);

    const sent = broadcaster.getSentNotifications();
    assert(sent.length === 1, '1 sent notification recorded in broadcaster');
    assert(sent[0].type === 'RESET', 'Sent notification has type RESET');
    assert(sent[0].message.includes('COOP'), 'Sent notification message includes COOP');
    assert(sent[0].message.includes('3 articoli'), 'Sent notification message includes 3 articoli');

    // Audit listener snapshot!
    assert(events.length === 1, 'Listener was called 1 time');
    console.log('    Listener snapshot at callback time:', JSON.stringify(events[0]));
    console.log('    Eventual notification in store:', JSON.stringify(sent[0]));

    if (events[0].type === undefined) {
      console.warn('    [OBSERVATION] Listener callback receives notification snapshot BEFORE type/payload are assigned!');
    } else {
      console.log('    Listener received notification with type already assigned.');
    }

    // 4.2 Test broadcastItemAdded
    await broadcaster.broadcastItemAdded({ name: 'mele', store: 'esselunga' });
    const sent2 = broadcaster.getSentNotifications();
    assert(sent2.length === 2, '2 sent notifications in broadcaster');
    assert(sent2[1].type === 'ITEM_ADDED', 'Second notification has type ITEM_ADDED');
    assert(sent2[1].message === 'Aggiunto alla lista: mele (esselunga)', 'Formatted item added message correct');
  }

  console.log(`\n=== STRESS TEST SUMMARY ===`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runStressTests().catch(err => {
  console.error('Stress test crashed:', err);
  process.exit(1);
});
