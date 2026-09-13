import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getImplementationModules } from './test_helper.js';

describe('Tier 1: Feature Coverage (>=5 test cases per feature)', () => {
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

  // ---------------------------------------------------------------------------
  // Feature 1: Item Management (Add / List)
  // ---------------------------------------------------------------------------
  describe('Feature 1: Item Management (Add / List)', () => {
    test('T1.1.1: Add single item without store creates item in active list', async () => {
      const result = await service.addItem('cioccolato', null, 'mamma');
      assert.ok(result.item);
      assert.equal(result.item.name, 'cioccolato');
      assert.equal(result.item.addedBy, 'mamma');
      assert.equal(result.habitUpdated, false);

      const list = await service.getList();
      assert.equal(list.length, 1);
      assert.equal(list[0].name, 'cioccolato');
    });

    test('T1.1.2: Add multiple distinct items stores all items in active list', async () => {
      await service.addItem('latte', null, 'user1');
      await service.addItem('pane', null, 'user2');
      await service.addItem('mele', null, 'user1');

      const list = await service.getList();
      assert.equal(list.length, 3);
      const names = list.map(i => i.name);
      assert.deepEqual(names, ['latte', 'pane', 'mele']);
    });

    test('T1.1.3: Add item with explicit store attaches store to item', async () => {
      const result = await service.addItem('cioccolato', 'eurospin', 'papà');
      assert.equal(result.item.name, 'cioccolato');
      assert.equal(result.item.store, 'eurospin');

      const list = await service.getList();
      assert.equal(list.length, 1);
      assert.equal(list[0].store, 'eurospin');
    });

    test('T1.1.4: Querying getList on an empty database returns empty array', async () => {
      const list = await service.getList();
      assert.ok(Array.isArray(list));
      assert.equal(list.length, 0);
    });

    test('T1.1.5: Adding duplicate item is handled gracefully without crashing', async () => {
      await service.addItem('latte');
      await service.addItem('latte');

      const list = await service.getList();
      assert.ok(list.length >= 1);
      assert.equal(list[0].name, 'latte');
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 2: Habit Tracking & Store Association
  // ---------------------------------------------------------------------------
  describe('Feature 2: Habit Tracking & Store Association', () => {
    test('T1.2.1: Add item with store updates habit tracker frequency', async () => {
      const result = await service.addItem('pane', 'coop', 'user1');
      assert.equal(result.habitUpdated, true);

      const habits = await service.getHabits('pane');
      assert.equal(habits.length, 1);
      assert.equal(habits[0].itemName, 'pane');
      assert.equal(habits[0].favoriteStore, 'coop');
      assert.equal(habits[0].stores['coop'], 1);
    });

    test('T1.2.2: Retrieve habits for specific item returns store breakdown and favorite', async () => {
      await habitTracker.trackPurchase('latte', 'conad');
      await habitTracker.trackPurchase('latte', 'conad');
      await habitTracker.trackPurchase('latte', 'lidl');

      const habits = await service.getHabits('latte');
      assert.equal(habits.length, 1);
      assert.equal(habits[0].favoriteStore, 'conad');
      assert.equal(habits[0].stores['conad'], 2);
      assert.equal(habits[0].stores['lidl'], 1);
    });

    test('T1.2.3: Adding item without store auto-infers favorite store from habits', async () => {
      await habitTracker.trackPurchase('caffè', 'esselunga');

      const result = await service.addItem('caffè');
      assert.equal(result.item.name, 'caffè');
      assert.equal(result.item.store, 'esselunga');
    });

    test('T1.2.4: Multi-store purchase habit frequency accumulates correctly', async () => {
      await habitTracker.trackPurchase('pasta', 'barilla_store');
      await habitTracker.trackPurchase('pasta', 'coop');
      await habitTracker.trackPurchase('pasta', 'coop');

      const favorite = await habitTracker.getFavoriteStore('pasta');
      assert.equal(favorite, 'coop');
    });

    test('T1.2.5: Querying habits for unpurchased item returns empty list or null', async () => {
      const habits = await service.getHabits('prosciutto_disattivato');
      assert.equal(habits.length, 0);

      const favorite = await habitTracker.getFavoriteStore('prosciutto_disattivato');
      assert.equal(favorite, null);
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 3: List Reset & Purchasing Journal
  // ---------------------------------------------------------------------------
  describe('Feature 3: List Reset & Purchasing Journal', () => {
    test('T1.3.1: Reset active list without store clears active items', async () => {
      await service.addItem('latte');
      await service.addItem('pane');

      const result = await service.resetList(null, 'mamma');
      assert.equal(result.itemsCleared, 2);

      const list = await service.getList();
      assert.equal(list.length, 0);
    });

    test('T1.3.2: Reset active list with store logs purchase history record with store name', async () => {
      await service.addItem('mele');
      await service.addItem('pere');

      const result = await service.resetList('eurospin', 'papà');
      assert.equal(result.itemsCleared, 2);
      assert.equal(result.resetRecord.store, 'eurospin');
      assert.equal(result.resetRecord.resetBy, 'papà');
      assert.equal(result.resetRecord.items.length, 2);

      const activeList = await service.getList();
      assert.equal(activeList.length, 0);
    });

    test('T1.3.3: Reset command triggers broadcast notification', async () => {
      await service.addItem('acqua');
      await service.resetList(null, 'figlio');

      const notifications = broadcaster.getSentNotifications();
      assert.equal(notifications.length, 1);
      assert.ok(notifications[0].message.includes('Spesa completata'));
    });

    test('T1.3.4: Reset on an empty list handles gracefully returning 0 items cleared', async () => {
      const result = await service.resetList(null, 'mamma');
      assert.equal(result.itemsCleared, 0);

      const notifications = broadcaster.getSentNotifications();
      assert.equal(notifications.length, 1);
    });

    test('T1.3.5: Purchase history record contains required metadata', async () => {
      await service.addItem('biscotti');
      const { resetRecord } = await service.resetList('esselunga', 'mamma');

      assert.ok(resetRecord.id);
      assert.ok(resetRecord.timestamp);
      assert.equal(resetRecord.resetBy, 'mamma');
      assert.equal(resetRecord.store, 'esselunga');
      assert.equal(resetRecord.items[0].name, 'biscotti');
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 4: Message Parsing & CLI Command Dispatching
  // ---------------------------------------------------------------------------
  describe('Feature 4: Message Parsing & Command Dispatching', () => {
    test('T1.4.1: Parse simple add command ("cioccolato")', () => {
      const parsed = MessageParser.parse('cioccolato');
      assert.equal(parsed.command, 'add');
      assert.equal(parsed.item, 'cioccolato');
    });

    test('T1.4.2: Parse add command with store ("cioccolato @ eurospin")', () => {
      const parsed = MessageParser.parse('cioccolato @ eurospin');
      assert.equal(parsed.command, 'add');
      assert.equal(parsed.item, 'cioccolato');
      assert.equal(parsed.store, 'eurospin');
    });

    test('T1.4.3: Parse reset command ("reset")', () => {
      const parsed = MessageParser.parse('reset');
      assert.equal(parsed.command, 'reset');
      assert.equal(parsed.store, undefined);
    });

    test('T1.4.4: Parse reset command with store ("reset coop")', () => {
      const parsed = MessageParser.parse('reset coop');
      assert.equal(parsed.command, 'reset');
      assert.equal(parsed.store, 'coop');
    });

    test('T1.4.5: Parse list ("list") and habits ("habits") commands', () => {
      const parsedList = MessageParser.parse('list');
      assert.equal(parsedList.command, 'list');

      const parsedHabits = MessageParser.parse('habits');
      assert.equal(parsedHabits.command, 'habits');

      const parsedItemHabits = MessageParser.parse('habits latte');
      assert.equal(parsedItemHabits.command, 'habits');
      assert.equal(parsedItemHabits.item, 'latte');
    });
  });

  // ---------------------------------------------------------------------------
  // Feature 5: Notification Broadcasting (Mock Broadcaster)
  // ---------------------------------------------------------------------------
  describe('Feature 5: Notification Broadcasting', () => {
    test('T1.5.1: Reset list emits broadcast notification message', async () => {
      await service.resetList(null, 'mamma');
      const sent = broadcaster.getSentNotifications();
      assert.equal(sent.length, 1);
      assert.ok(sent[0].message.length > 0);
    });

    test('T1.5.2: Reset with store includes store name in broadcast message', async () => {
      await service.resetList('conad', 'papà');
      const sent = broadcaster.getSentNotifications();
      assert.equal(sent.length, 1);
      assert.ok(sent[0].message.toLowerCase().includes('conad'));
    });

    test('T1.5.3: MockBroadcaster records broadcast details in log', async () => {
      await broadcaster.broadcast('Test message', 'group123');
      const sent = broadcaster.getSentNotifications();
      assert.equal(sent.length, 1);
      assert.equal(sent[0].message, 'Test message');
      assert.equal(sent[0].recipient, 'group123');
      assert.ok(sent[0].timestamp);
    });

    test('T1.5.4: Multiple sequential resets emit multiple distinct notifications', async () => {
      await service.resetList('store1', 'user1');
      await service.resetList('store2', 'user2');

      const sent = broadcaster.getSentNotifications();
      assert.equal(sent.length, 2);
      assert.ok(sent[0].message.toLowerCase().includes('store1'));
      assert.ok(sent[1].message.toLowerCase().includes('store2'));
    });

    test('T1.5.5: clearNotifications resets broadcast history log', async () => {
      await broadcaster.broadcast('Message 1');
      assert.equal(broadcaster.getSentNotifications().length, 1);

      broadcaster.clearNotifications();
      assert.equal(broadcaster.getSentNotifications().length, 0);
    });
  });
});
