import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getImplementationModules } from './test_helper.js';

describe('Tier 2: Boundary & Corner Cases (Empty, Special Chars, Store Normalization)', () => {
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

  test('T2.1: Adding item with empty string or pure whitespace throws an Error', async () => {
    await assert.rejects(
      async () => await service.addItem('   '),
      /empty|invalid/i
    );
    await assert.rejects(
      async () => await service.addItem(''),
      /empty|invalid/i
    );
  });

  test('T2.2: Leading and trailing whitespace is automatically trimmed from item name', async () => {
    const result = await service.addItem('   pane  ');
    assert.equal(result.item.name, 'pane');

    const list = await service.getList();
    assert.equal(list[0].name, 'pane');
  });

  test('T2.3: Store name case sensitivity normalization ("EuroSpin", "EUROSPIN", "eurospin")', async () => {
    await service.addItem('latte', 'EuroSpin');
    await service.addItem('biscotti', 'EUROSPIN');
    await service.resetList('eurospin');

    const habits = await service.getHabits('latte');
    assert.equal(habits.length, 1);
    assert.equal(habits[0].favoriteStore, 'eurospin');
    assert.equal(habits[0].stores['eurospin'], 2); // both purchases logged under normalized store key
  });

  test('T2.4: Item name case normalization ("Cioccolato" vs "cioccolato")', async () => {
    await habitTracker.trackPurchase('Cioccolato', 'coop');
    await habitTracker.trackPurchase('cioccolato', 'coop');

    const habitUpper = await db.getHabit('Cioccolato');
    const habitLower = await db.getHabit('cioccolato');

    assert.ok(habitUpper || habitLower);
    const stores = (habitUpper || habitLower).stores;
    assert.equal(stores['coop'], 2);
  });

  test('T2.5: Special characters, accents, and emojis ("caffè", "latte & biscotti 🥛", "pasta/riso")', async () => {
    const item1 = await service.addItem('caffè', 'coop');
    const item2 = await service.addItem('latte & biscotti 🥛', 'lidl');
    const item3 = await service.addItem('pasta/riso', 'conad');

    assert.equal(item1.item.name, 'caffè');
    assert.equal(item2.item.name, 'latte & biscotti 🥛');
    assert.equal(item3.item.name, 'pasta/riso');

    const list = await service.getList();
    assert.equal(list.length, 3);
    assert.equal(list[1].name, 'latte & biscotti 🥛');
  });

  test('T2.6: Reset command with irregular whitespace and mixed casing ("  ReSeT   COOP  ")', () => {
    const parsed = MessageParser.parse('  ReSeT   COOP  ');
    assert.equal(parsed.command, 'reset');
    assert.equal(parsed.store, 'COOP');
  });

  test('T2.7: Large payload item description (500+ characters) is processed without error', async () => {
    const longString = 'mela_'.repeat(120); // 600 characters
    const result = await service.addItem(longString);
    assert.equal(result.item.name, longString);

    const list = await service.getList();
    assert.equal(list.length, 1);
    assert.equal(list[0].name.length, 600);
  });

  test('T2.8: Bulk list reset with 50+ active items executes efficiently', async () => {
    for (let i = 1; i <= 55; i++) {
      await service.addItem(`articolo_${i}`);
    }

    const initialList = await service.getList();
    assert.equal(initialList.length, 55);

    const result = await service.resetList('maxi_store', 'mamma');
    assert.equal(result.itemsCleared, 55);
    assert.equal(result.resetRecord.items.length, 55);

    const remaining = await service.getList();
    assert.equal(remaining.length, 0);
  });

  test('T2.9: MessageParser handles empty and null inputs safely', () => {
    const nullParsed = MessageParser.parse(null);
    assert.equal(nullParsed.command, 'unknown');

    const emptyParsed = MessageParser.parse('');
    assert.equal(emptyParsed.command, 'unknown');
  });

  test('T2.10: Double reset in immediate succession executes safely', async () => {
    await service.addItem('latte');
    const reset1 = await service.resetList('coop');
    assert.equal(reset1.itemsCleared, 1);

    const reset2 = await service.resetList('coop');
    assert.equal(reset2.itemsCleared, 0);

    const notifications = broadcaster.getSentNotifications();
    assert.equal(notifications.length, 2);
  });
});
