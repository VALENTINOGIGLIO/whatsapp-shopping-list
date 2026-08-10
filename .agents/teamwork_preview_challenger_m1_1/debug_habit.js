import assert from 'node:assert/strict';
import { ShoppingListService } from '../../src/domain/ShoppingListService.js';
import { HabitTracker } from '../../src/domain/HabitTracker.js';
import { MockDatabaseAdapter } from '../../src/db/MockDatabaseAdapter.js';

async function testHabitIsolation() {
  const db = new MockDatabaseAdapter();
  const tracker = new HabitTracker(db);
  await tracker.trackPurchase("pasta", "coop", db);
  
  const habits = await tracker.getHabits("pasta", db);
  console.log('Habits before mutation:', JSON.stringify(habits));
  
  habits[0].stores.coop = 99999;
  
  const habitsAgain = await tracker.getHabits("pasta", db);
  console.log('Habits after mutation:', JSON.stringify(habitsAgain));
}

testHabitIsolation();
