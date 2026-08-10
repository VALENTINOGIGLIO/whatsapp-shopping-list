import { ShoppingListService } from './src/domain/ShoppingListService.js';
import { MockDatabaseAdapter } from './src/db/MockDatabaseAdapter.js';
import { HabitTracker } from './src/domain/HabitTracker.js';

async function run() {
  const db = new MockDatabaseAdapter();
  const service = new ShoppingListService(db, null, new HabitTracker(db));

  // Chat 1
  await service.addItem('chat_1', 'latte', 'eurospin', 'mom');
  const list1 = await service.getList('chat_1');
  console.log('List 1:', list1.map(i => i.name));

  // Chat 2
  await service.addItem('chat_2', 'pane', 'conad', 'dad');
  const list2 = await service.getList('chat_2');
  console.log('List 2:', list2.map(i => i.name));

  // Habit check
  const habits1 = await service.getHabits('chat_1');
  console.log('Habits 1:', habits1.map(h => `${h.itemName} - ${h.favoriteStore}`));

  const habits2 = await service.getHabits('chat_2');
  console.log('Habits 2:', habits2.map(h => `${h.itemName} - ${h.favoriteStore}`));
}

run().catch(console.error);
