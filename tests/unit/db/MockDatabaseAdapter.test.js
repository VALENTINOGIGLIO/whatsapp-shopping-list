import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockDatabaseAdapter } from '../../../src/db/MockDatabaseAdapter.js';
import { createDatabaseAdapter } from '../../../src/db/index.js';

describe('Unit Test: MockDatabaseAdapter', () => {
  let db;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
  });

  test('createDatabaseAdapter creates MockDatabaseAdapter by default', () => {
    const adapter = createDatabaseAdapter({ dbType: 'mock' });
    assert.ok(adapter instanceof MockDatabaseAdapter);
  });

  test('Save and retrieve active shopping list items', async () => {
    await db.saveActiveItem({ name: 'Pane', store: 'Coop' });
    await db.saveActiveItem({ name: 'Latte', store: 'Lidl' });

    const items = await db.getActiveItems();
    assert.equal(items.length, 2);
    assert.equal(items[0].name, 'Pane');
    assert.equal(items[1].name, 'Latte');
  });

  test('Deduplicates or updates existing active item with same normalized name', async () => {
    await db.saveActiveItem({ name: 'cioccolato', store: 'coop' });
    await db.saveActiveItem({ name: 'Cioccolato', store: 'eurospin' });

    const items = await db.getActiveItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].store, 'eurospin');
  });

  test('deleteActiveItems clears active list and returns count', async () => {
    await db.saveActiveItem({ name: 'Mele' });
    await db.saveActiveItem({ name: 'Pere' });

    const count = await db.deleteActiveItems();
    assert.equal(count, 2);

    const items = await db.getActiveItems();
    assert.equal(items.length, 0);
  });

  test('Save and retrieve habits', async () => {
    const habit = {
      itemName: 'caffè',
      stores: { esselunga: 3 },
      favoriteStore: 'esselunga',
      lastUpdated: new Date().toISOString()
    };

    await db.saveHabit(habit);

    const retrievedUpper = await db.getHabit('Caffè');
    const retrievedLower = await db.getHabit('caffè');

    assert.ok(retrievedUpper);
    assert.ok(retrievedLower);
    assert.equal(retrievedUpper.favoriteStore, 'esselunga');

    const allHabits = await db.getAllHabits();
    assert.equal(allHabits.length, 1);
  });

  test('Save and retrieve purchase history records', async () => {
    const record = {
      id: 'rec_123',
      store: 'conad',
      items: [{ name: 'biscotti' }],
      resetBy: 'mamma',
      timestamp: new Date().toISOString()
    };

    await db.savePurchaseHistory(record);

    const history = await db.getPurchaseHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'rec_123');
    assert.equal(history[0].store, 'conad');
  });

  test('clearAllData resets active items, habits, and history', async () => {
    await db.saveActiveItem({ name: 'test' });
    await db.saveHabit({ itemName: 'test', stores: { coop: 1 } });
    await db.savePurchaseHistory({ id: '1' });

    await db.clearAllData();

    assert.equal((await db.getActiveItems()).length, 0);
    assert.equal(await db.getHabit('test'), null);
    assert.equal((await db.getPurchaseHistory()).length, 0);
  });

  test('Initialize with initialData', async () => {
    const customDb = new MockDatabaseAdapter({
      activeItems: [{ name: 'pasta', canonicalName: 'pasta' }],
      habits: [{ itemName: 'pasta', stores: { coop: 2 }, favoriteStore: 'coop' }],
      purchaseHistory: [{ id: 'p1', store: 'coop' }]
    });

    assert.equal((await customDb.getActiveItems()).length, 1);
    assert.equal((await customDb.getHabit('pasta')).favoriteStore, 'coop');
    assert.equal((await customDb.getPurchaseHistory()).length, 1);
  });

  test('Save, retrieve, and query active chat sessions', async () => {
    const chatDb = new MockDatabaseAdapter();
    assert.equal(await chatDb.getChatSession('chat_1'), null);

    await chatDb.saveChatSession('chat_1', { active: true });
    const s1 = await chatDb.getChatSession('chat_1');
    assert.equal(s1.active, true);
    assert.ok(s1.updatedAt);

    await chatDb.saveChatSession('chat_2', { active: false });
    const activeSessions = await chatDb.getActiveChatSessions();
    assert.ok(activeSessions.includes('chat_1'));
    assert.ok(!activeSessions.includes('chat_2'));
    assert.ok(activeSessions.includes('120363410246350492@g.us'));
  });
});
