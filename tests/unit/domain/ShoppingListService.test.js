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
});
