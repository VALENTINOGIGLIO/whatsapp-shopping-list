import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HabitTracker } from '../../../src/domain/HabitTracker.js';
import { MockDatabaseAdapter } from '../../../src/db/MockDatabaseAdapter.js';

describe('Unit Test: HabitTracker', () => {
  let db, tracker;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
    tracker = new HabitTracker(db);
  });

  test('Normalizes item and store names correctly', () => {
    assert.equal(tracker.normalizeItemName('  Cioccolato   Fondente  '), 'cioccolato fondente');
    assert.equal(tracker.normalizeStoreName('   EuroSpin  '), 'eurospin');
  });

  test('Calculates favorite store based on maximum frequency', () => {
    const storeCounts = { coop: 2, esselunga: 5, lidl: 1 };
    assert.equal(tracker.calculateFavoriteStore(storeCounts), 'esselunga');
  });

  test('Applies deterministic tie-breaking (alphabetical order)', () => {
    // Both 'lidl' and 'coop' have frequency 3
    const storeCounts = { lidl: 3, coop: 3 };
    // Alphabetically 'coop' comes before 'lidl'
    assert.equal(tracker.calculateFavoriteStore(storeCounts), 'coop');
  });

  test('Returns null favorite store for empty storeCounts', () => {
    assert.equal(tracker.calculateFavoriteStore({}), null);
    assert.equal(tracker.calculateFavoriteStore(null), null);
  });

  test('trackPurchase updates store frequency and persists to database', async () => {
    await tracker.trackPurchase('Pane', 'Coop');
    await tracker.trackPurchase('pane', 'Coop');
    await tracker.trackPurchase('pane', 'Lidl');

    const habit = await db.getHabit('pane');
    assert.ok(habit);
    assert.equal(habit.itemName, 'pane');
    assert.equal(habit.favoriteStore, 'coop');
    assert.equal(habit.stores['coop'], 2);
    assert.equal(habit.stores['lidl'], 1);
  });

  test('updateHabitsForBatch updates habits for multiple items', async () => {
    await tracker.updateHabitsForBatch(db, ['latte', 'burro', 'formaggio'], 'conad');

    const habitLatte = await tracker.getFavoriteStore('latte');
    const habitBurro = await tracker.getFavoriteStore('burro');
    const habitFormaggio = await tracker.getFavoriteStore('formaggio');

    assert.equal(habitLatte, 'conad');
    assert.equal(habitBurro, 'conad');
    assert.equal(habitFormaggio, 'conad');
  });

  test('getHabits retrieves single item habit or all habits', async () => {
    await tracker.trackPurchase('mela', 'coop');
    await tracker.trackPurchase('pera', 'lidl');

    const singleHabit = await tracker.getHabits('mela');
    assert.equal(singleHabit.length, 1);
    assert.equal(singleHabit[0].favoriteStore, 'coop');

    const allHabits = await tracker.getHabits();
    assert.equal(allHabits.length, 2);
  });
});
