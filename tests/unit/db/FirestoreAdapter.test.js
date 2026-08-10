import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreAdapter } from '../../../src/db/FirestoreAdapter.js';

describe('Unit Test: FirestoreAdapter', () => {
  let mockDb, firestoreAdapter;
  let shoppingListData, habitsData, historyData;

  beforeEach(() => {
    shoppingListData = new Map();
    habitsData = new Map();
    historyData = new Map();

    // In-memory fake firestore implementation for unit testing FirestoreAdapter methods
    mockDb = {
      collection: (collName) => {
        const getTargetMap = () => {
          if (collName === 'shopping_list') return shoppingListData;
          if (collName === 'habits') return habitsData;
          if (collName === 'purchase_history') return historyData;
          return new Map();
        };

        return {
          get: async () => {
            const targetMap = getTargetMap();
            const docs = [];
            targetMap.forEach((val, key) => {
              docs.push({
                id: key,
                data: () => val,
                ref: { id: key }
              });
            });
            return {
              empty: docs.length === 0,
              size: docs.length,
              docs,
              forEach: (cb) => docs.forEach(cb)
            };
          },
          doc: (docId) => ({
            get: async () => {
              const targetMap = getTargetMap();
              const val = targetMap.get(docId);
              return {
                exists: val !== undefined,
                data: () => val
              };
            },
            set: async (data, options = {}) => {
              const targetMap = getTargetMap();
              if (options.merge && targetMap.has(docId)) {
                targetMap.set(docId, { ...targetMap.get(docId), ...data });
              } else {
                targetMap.set(docId, data);
              }
            }
          })
        };
      },
      batch: () => {
        const operations = [];
        return {
          delete: (ref) => {
            operations.push(ref);
          },
          commit: async () => {
            operations.forEach(ref => {
              shoppingListData.delete(ref.id);
              habitsData.delete(ref.id);
              historyData.delete(ref.id);
            });
          }
        };
      }
    };

    firestoreAdapter = new FirestoreAdapter(mockDb);
  });

  test('saveActiveItem and getActiveItems in FirestoreAdapter', async () => {
    await firestoreAdapter.saveActiveItem({ name: 'Pane', store: 'coop' });
    const items = await firestoreAdapter.getActiveItems();

    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'Pane');
    assert.equal(items[0].canonicalName, 'pane');
  });

  test('getHabit and saveHabit in FirestoreAdapter', async () => {
    await firestoreAdapter.saveHabit({ itemName: 'caffè', favoriteStore: 'esselunga' });
    const habit = await firestoreAdapter.getHabit('caffè');

    assert.ok(habit);
    assert.equal(habit.favoriteStore, 'esselunga');
  });

  test('savePurchaseHistory and getPurchaseHistory in FirestoreAdapter', async () => {
    await firestoreAdapter.savePurchaseHistory({ id: 'rec_1', store: 'lidl', items: [] });
    const history = await firestoreAdapter.getPurchaseHistory();

    assert.equal(history.length, 1);
    assert.equal(history[0].id, 'rec_1');
  });

  test('deleteActiveItems in FirestoreAdapter clears active collection', async () => {
    await firestoreAdapter.saveActiveItem({ name: 'mela' });
    await firestoreAdapter.saveActiveItem({ name: 'pera' });

    const deletedCount = await firestoreAdapter.deleteActiveItems();
    assert.equal(deletedCount, 2);

    const items = await firestoreAdapter.getActiveItems();
    assert.equal(items.length, 0);
  });

  test('clearAllData in FirestoreAdapter resets all collections', async () => {
    await firestoreAdapter.saveActiveItem({ name: 'mela' });
    await firestoreAdapter.saveHabit({ itemName: 'mela', favoriteStore: 'coop' });
    await firestoreAdapter.savePurchaseHistory({ id: 'p1', store: 'coop' });

    await firestoreAdapter.clearAllData();

    assert.equal((await firestoreAdapter.getActiveItems()).length, 0);
    assert.equal(await firestoreAdapter.getHabit('mela'), null);
    assert.equal((await firestoreAdapter.getPurchaseHistory()).length, 0);
  });
});
