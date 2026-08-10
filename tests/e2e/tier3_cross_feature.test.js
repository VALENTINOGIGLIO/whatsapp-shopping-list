import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getImplementationModules } from './test_helper.js';

describe('Tier 3: Cross-Feature Interactions', () => {
  let MockDatabaseAdapter, ShoppingListService, HabitTracker, MessageParser, MockBroadcaster;
  let db, broadcaster, habitTracker, service;

  beforeEach(async () => {
    const mods = await getImplementationModules();
    MockDatabaseAdapter = mods.MockDatabaseAdapter;
    ShoppingListService = mods.ShoppingListService;
    HabitTracker = mods.HabitTracker;
    MessageParser = mods.MessageParser;
    MockBroadcaster = mods.MockBroadcaster;

    db = new MockDatabaseAdapter();
    broadcaster = new MockBroadcaster();
    habitTracker = new HabitTracker(db);
    service = new ShoppingListService(db, broadcaster, habitTracker);
  });

  test('T3.1: Full Pipeline (Parser -> Service -> Database -> Broadcaster)', async () => {
    const incomingText1 = 'mela coop';
    const parsed1 = MessageParser.parse(incomingText1);
    assert.equal(parsed1.command, 'add');
    await service.addItem(parsed1.item, parsed1.store, 'senderA');

    const incomingText2 = 'reset coop';
    const parsed2 = MessageParser.parse(incomingText2);
    assert.equal(parsed2.command, 'reset');
    const resetResult = await service.resetList(parsed2.store, 'senderB');

    assert.equal(resetResult.itemsCleared, 1);
    assert.equal(resetResult.resetRecord.store, 'coop');

    const notifications = broadcaster.getSentNotifications();
    assert.equal(notifications.length, 1);
    assert.ok(notifications[0].message.includes('COOP'));
  });

  test('T3.2: Habit Learning & Auto-Inference Loop', async () => {
    // Phase 1: User specifies store explicitly across purchases
    await service.addItem('mele', 'coop');
    await service.resetList('coop');

    await service.addItem('mele', 'coop');
    await service.resetList('coop');

    // Phase 2: User adds item WITHOUT specifying store
    const addResult = await service.addItem('mele');

    // Auto-inference should pick 'coop'
    assert.equal(addResult.item.store, 'coop');
  });

  test('T3.3: Reset with Store updates HabitTracker for all active items', async () => {
    await service.addItem('pane');
    await service.addItem('latte');
    await service.addItem('burro');

    // Reset specifying 'esselunga'
    await service.resetList('esselunga', 'mamma');

    // Habits for all 3 items should now include 'esselunga'
    const habitPane = await habitTracker.getFavoriteStore('pane');
    const habitLatte = await habitTracker.getFavoriteStore('latte');
    const habitBurro = await habitTracker.getFavoriteStore('burro');

    assert.equal(habitPane, 'esselunga');
    assert.equal(habitLatte, 'esselunga');
    assert.equal(habitBurro, 'esselunga');
  });

  test('T3.4: Multi-Sender Interaction & Notification Broadcast', async () => {
    await service.addItem('pasta', null, 'mamma');
    await service.addItem('salsa', null, 'papà');

    const resetResult = await service.resetList('conad', 'figlio');

    assert.equal(resetResult.resetRecord.resetBy, 'figlio');
    assert.equal(resetResult.resetRecord.items.length, 2);

    const notifications = broadcaster.getSentNotifications();
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].recipient, 'family_chat');
  });

  test('T3.5: Sequential Resets preserve separate audit records in Purchase History', async () => {
    // Cycle 1
    await service.addItem('farina', 'lidl');
    await service.resetList('lidl', 'mamma');

    // Cycle 2
    await service.addItem('zucchero', 'conad');
    await service.resetList('conad', 'papà');

    const history = await db.getPurchaseHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].store, 'lidl');
    assert.equal(history[1].store, 'conad');
    assert.equal(history[0].items[0].name, 'farina');
    assert.equal(history[1].items[0].name, 'zucchero');
  });

  test('T3.6: Habit Store Frequency Competition & Favorite Recalculation', async () => {
    // Buy 3 times at Store A
    for (let i = 0; i < 3; i++) {
      await habitTracker.trackPurchase('caffè', 'store_a');
    }
    // Buy 5 times at Store B
    for (let i = 0; i < 5; i++) {
      await habitTracker.trackPurchase('caffè', 'store_b');
    }

    const favorite = await habitTracker.getFavoriteStore('caffè');
    assert.equal(favorite, 'store_b');
  });

  test('T3.7: Clearing active list does not erase habits or purchase history', async () => {
    await service.addItem('tè', 'coop');
    await service.resetList('coop');

    // Active list is empty
    const list = await service.getList();
    assert.equal(list.length, 0);

    // Habits & history persist
    const habit = await habitTracker.getFavoriteStore('tè');
    assert.equal(habit, 'coop');

    const history = await db.getPurchaseHistory();
    assert.equal(history.length, 1);
  });

  test('T3.8: Concurrent add operations maintain list integrity', async () => {
    const promises = [
      service.addItem('item1'),
      service.addItem('item2'),
      service.addItem('item3'),
      service.addItem('item4')
    ];

    await Promise.all(promises);

    const list = await service.getList();
    assert.equal(list.length, 4);
  });
});
