import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ShoppingListService } from '../../../src/domain/ShoppingListService.js';
import { MockDatabaseAdapter } from '../../../src/db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../../../src/broadcaster/MockBroadcaster.js';
import { HabitTracker } from '../../../src/domain/HabitTracker.js';

describe('Unit Test: ShoppingListService', () => {
  let db, broadcaster, habitTracker, service;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
    broadcaster = new MockBroadcaster();
    habitTracker = new HabitTracker(db);
    service = new ShoppingListService(db, broadcaster, habitTracker);
  });

  test('addItem adds a new item to the active shopping list', async () => {
    const result = await service.addItem('cioccolato', null, 'mamma');
    assert.ok(result.item);
    assert.equal(result.item.name, 'cioccolato');
    assert.equal(result.item.addedBy, 'mamma');
    assert.equal(result.habitUpdated, false);

    const list = await service.getList();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'cioccolato');
  });

  test('addItem with store updates habit tracker and sets storeInferred to false', async () => {
    const result = await service.addItem('pane', 'coop', 'papà');
    assert.equal(result.item.store, 'coop');
    assert.equal(result.item.storeInferred, false);
    assert.equal(result.habitUpdated, true);

    const favorite = await habitTracker.getFavoriteStore('pane');
    assert.equal(favorite, 'coop');
  });

  test('addItem auto-infers favorite store when store is missing and habit exists', async () => {
    await habitTracker.trackPurchase('caffè', 'esselunga');

    const result = await service.addItem('caffè', null, 'figlio');
    assert.equal(result.item.name, 'caffè');
    assert.equal(result.item.store, 'esselunga');
    assert.equal(result.item.storeInferred, true);
    assert.equal(result.habitUpdated, false);
  });

  test('addItem throws Error for empty or whitespace-only item name', async () => {
    await assert.rejects(
      async () => await service.addItem(''),
      /cannot be empty/i
    );
    await assert.rejects(
      async () => await service.addItem('   '),
      /cannot be empty/i
    );
  });

  test('resetList clears list, saves purchase history, updates store habits, and sends broadcast', async () => {
    await service.addItem('latte');
    await service.addItem('biscotti');

    const result = await service.resetList('eurospin', 'papà');
    assert.equal(result.itemsCleared, 2);
    assert.equal(result.resetRecord.store, 'eurospin');
    assert.equal(result.resetRecord.resetBy, 'papà');

    const activeList = await service.getList();
    assert.equal(activeList.length, 0);

    const sent = broadcaster.getSentNotifications();
    assert.equal(sent.length, 1);
    assert.ok(sent[0].message.toLowerCase().includes('eurospin'));

    const habitLatte = await habitTracker.getFavoriteStore('latte');
    assert.equal(habitLatte, 'eurospin');
  });

  test('resetList handles empty list gracefully', async () => {
    const result = await service.resetList(null, 'mamma');
    assert.equal(result.itemsCleared, 0);

    const sent = broadcaster.getSentNotifications();
    assert.equal(sent.length, 1);
  });

  test('formatListForDisplay produces formatted readable text', async () => {
    const emptyOutput = service.formatListForDisplay([]);
    assert.ok(emptyOutput.includes('empty'));

    const items = [
      { name: 'Pane', store: 'coop', storeInferred: false },
      { name: 'Latte', store: 'esselunga', storeInferred: true }
    ];

    const output = service.formatListForDisplay(items);
    assert.ok(output.includes('Pane (coop)'));
    assert.ok(output.includes('Latte (esselunga - favorite)'));
  });

  describe('removeItem and List Indexing', () => {
    test('formatListForDisplay clearly numbers all items 1-based even when urgent or checked', async () => {
      const items = [
        { name: 'Pane', store: 'coop', isChecked: false, isUrgent: false },
        { name: 'Latte', store: 'esselunga', isChecked: false, isUrgent: true },
        { name: 'Pasta', store: 'lidl', isChecked: true, isUrgent: false }
      ];

      const output = service.formatListForDisplay(items);
      const lines = output.split('\n');
      assert.ok(lines[1].startsWith('1. Pane'));
      assert.ok(lines[2].startsWith('2. 🔴 Latte'));
      assert.ok(lines[3].startsWith('3. ✅ ~Pasta~'));
    });

    test('formatListGroupedByStore numbers items with global 1-based indices', async () => {
      const items = [
        { name: 'Pane', store: 'coop' },
        { name: 'Latte', store: 'esselunga' },
        { name: 'Mela', store: null }
      ];

      const output = service.formatListGroupedByStore(items);
      assert.ok(output.includes('1. Pane'));
      assert.ok(output.includes('2. Latte'));
      assert.ok(output.includes('3. Mela'));
    });

    test('removeItem by numeric index (1-based)', async () => {
      await service.addItem('latte');
      await service.addItem('pane');
      await service.addItem('pasta');

      const res = await service.removeItem(2); // Remove 'pane'
      assert.equal(res.success, true);
      assert.equal(res.removedItem.name, 'pane');

      const list = await service.getList();
      assert.equal(list.length, 2);
      assert.equal(list[0].name, 'latte');
      assert.equal(list[1].name, 'pasta');
    });

    test('removeItem by string numeric index ("1")', async () => {
      await service.addItem('latte');
      const res = await service.removeItem('1');
      assert.equal(res.success, true);
      assert.equal(res.removedItem.name, 'latte');

      const list = await service.getList();
      assert.equal(list.length, 0);
    });

    test('removeItem by name is case-insensitive', async () => {
      await service.addItem('Latte Macchiato');

      const res = await service.removeItem('latte macchiato');
      assert.equal(res.success, true);
      assert.equal(res.removedItem.name, 'Latte Macchiato');

      const list = await service.getList();
      assert.equal(list.length, 0);
    });

    test('removeItem removes item with status emoji (🔴 latte)', async () => {
      await service.addItem('🔴 latte');

      const res = await service.removeItem('latte');
      assert.equal(res.success, true);
      assert.equal(res.removedItem.name, '🔴 latte');

      const list = await service.getList();
      assert.equal(list.length, 0);
    });

    test('removeItem with multiple indices: "1,2,3"', async () => {
      await service.addItem('latte');
      await service.addItem('pane');
      await service.addItem('pasta');
      await service.addItem('biscotti');

      const res = await service.removeItem('1,2,3');
      assert.equal(res.success, true);
      assert.equal(res.removedItems.length, 3);
      assert.deepEqual(res.removedItems.map(i => i.name), ['latte', 'pane', 'pasta']);

      const list = await service.getList();
      assert.equal(list.length, 1);
      assert.equal(list[0].name, 'biscotti');
    });

    test('removeItem with space separated indices: "1 2 3"', async () => {
      await service.addItem('mela');
      await service.addItem('pera');
      await service.addItem('banana');

      const res = await service.removeItem('1 2 3');
      assert.equal(res.success, true);
      assert.equal(res.removedItems.length, 3);

      const list = await service.getList();
      assert.equal(list.length, 0);
    });

    test('removeItem with slash separated indices: "1/2/3"', async () => {
      await service.addItem('arancia');
      await service.addItem('limone');
      await service.addItem('mandarino');

      const res = await service.removeItem('1/2/3');
      assert.equal(res.success, true);
      assert.equal(res.removedItems.length, 3);

      const list = await service.getList();
      assert.equal(list.length, 0);
    });

    test('removeItem with semicolon or range separators: "1;3" and "1-2"', async () => {
      await service.addItem('uova');
      await service.addItem('farina');
      await service.addItem('zucchero');

      const resSemi = await service.removeItem('1;3');
      assert.equal(resSemi.success, true);
      assert.equal(resSemi.removedItems.length, 2);
      assert.deepEqual(resSemi.removedItems.map(i => i.name), ['uova', 'zucchero']);

      const remaining = await service.getList();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].name, 'farina');
    });

    test('removeItem with index range notation: "1-3"', async () => {
      await service.addItem('item1');
      await service.addItem('item2');
      await service.addItem('item3');
      await service.addItem('item4');

      const res = await service.removeItem('1-3');
      assert.equal(res.success, true);
      assert.equal(res.removedItems.length, 3);

      const list = await service.getList();
      assert.equal(list.length, 1);
      assert.equal(list[0].name, 'item4');
    });

    test('removeItem handles mixed valid and invalid indices', async () => {
      await service.addItem('cioccolato');

      const res = await service.removeItem('1, 99');
      assert.equal(res.success, true);
      assert.equal(res.removedItems.length, 1);
      assert.equal(res.removedItems[0].name, 'cioccolato');
      assert.deepEqual(res.invalidIndices, [99]);

      const list = await service.getList();
      assert.equal(list.length, 0);
    });

    test('removeItem returns INVALID_INDEX when all indices are out of range', async () => {
      await service.addItem('caffè');

      const res = await service.removeItem(99);
      assert.equal(res.success, false);
      assert.equal(res.reason, 'INVALID_INDEX');

      const resZero = await service.removeItem(0);
      assert.equal(resZero.success, false);
      assert.equal(resZero.reason, 'INVALID_INDEX');
    });

    test('removeItem returns EMPTY_QUERY for empty input', async () => {
      const res1 = await service.removeItem(null);
      assert.equal(res1.success, false);
      assert.equal(res1.reason, 'EMPTY_QUERY');

      const res2 = await service.removeItem('   ');
      assert.equal(res2.success, false);
      assert.equal(res2.reason, 'EMPTY_QUERY');
    });

    test('removeItem returns NOT_FOUND for non-existent product name', async () => {
      await service.addItem('latte');
      const res = await service.removeItem('caviale');
      assert.equal(res.success, false);
      assert.equal(res.reason, 'NOT_FOUND');
    });

    test('removeItem supports multiple product names separated by comma or slash', async () => {
      await service.addItem('latte');
      await service.addItem('pane');
      await service.addItem('burro');

      const res = await service.removeItem('latte, burro');
      assert.equal(res.success, true);
      assert.equal(res.removedItems.length, 2);

      const list = await service.getList();
      assert.equal(list.length, 1);
      assert.equal(list[0].name, 'pane');
    });
  });
});
