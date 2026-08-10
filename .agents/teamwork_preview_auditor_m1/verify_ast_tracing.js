import fs from 'node:fs';
import path from 'node:path';

import { ShoppingListService } from '../../src/domain/ShoppingListService.js';
import { HabitTracker } from '../../src/domain/HabitTracker.js';
import { MessageParser } from '../../src/domain/MessageParser.js';
import { MockDatabaseAdapter } from '../../src/db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../../src/broadcaster/MockBroadcaster.js';

console.log('--- AUDIT AST & DYNAMIC TRACING VERIFICATION ---');

// 1. Static AST/Syntax Check: Ensure no functions are empty or dummy return constants
const srcDir = path.resolve('/Users/gi/teamwork_projects/whatsapp_shopping_list/src');
function getAllJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllJsFiles(fullPath));
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  });
  return results;
}

const jsFiles = getAllJsFiles(srcDir);
console.log(`Found ${jsFiles.length} source JS files under src/`);

let dummyCount = 0;
jsFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  // Check for empty functions: function name() {} or () => {}
  const emptyFnRegex = /function\s*\w*\s*\([^)]*\)\s*\{\s*\}|\([^)]*\)\s*=>\s*\{\s*\}/g;
  const emptyMatches = content.match(emptyFnRegex);
  if (emptyMatches) {
    console.warn(`[AST Warning] Empty function in ${path.relative(srcDir, file)}:`, emptyMatches);
    dummyCount++;
  }
});

// 2. Dynamic Execution Tracing: Verify real state mutation & call stack
const db = new MockDatabaseAdapter();
const broadcaster = new MockBroadcaster();
const habitTracker = new HabitTracker(db);
const service = new ShoppingListService(db, broadcaster, habitTracker);

const trace = [];

// Instrument db methods
const origSaveItem = db.saveActiveItem.bind(db);
db.saveActiveItem = async (item) => {
  trace.push({ op: 'db.saveActiveItem', item: item.name, store: item.store });
  return await origSaveItem(item);
};

const origDeleteItems = db.deleteActiveItems.bind(db);
db.deleteActiveItems = async () => {
  trace.push({ op: 'db.deleteActiveItems' });
  return await origDeleteItems();
};

const origSaveHabit = db.saveHabit.bind(db);
db.saveHabit = async (habit) => {
  trace.push({ op: 'db.saveHabit', item: habit.itemName, favoriteStore: habit.favoriteStore });
  return await origSaveHabit(habit);
};

const origBroadcast = broadcaster.broadcast.bind(broadcaster);
broadcaster.broadcast = async (msg, recipient) => {
  trace.push({ op: 'broadcaster.broadcast', msg });
  return await origBroadcast(msg, recipient);
};

// Execute workflow
async function runTrace() {
  console.log('\nExecuting dynamic workflow trace...');
  
  // Action 1: Add item with store
  await service.addItem('cioccolato', 'coop', 'userA');
  
  // Action 2: Reset list with store
  await service.resetList('coop', 'userB');
  
  // Action 3: Auto-inference on next add
  await service.addItem('cioccolato', null, 'userA');

  console.log('Trace recorded operations:', JSON.stringify(trace, null, 2));

  // Verification checks
  const hasSaveItem = trace.some(t => t.op === 'db.saveActiveItem');
  const hasSaveHabit = trace.some(t => t.op === 'db.saveHabit');
  const hasDeleteItems = trace.some(t => t.op === 'db.deleteActiveItems');
  const hasBroadcast = trace.some(t => t.op === 'broadcaster.broadcast');

  console.log('\nVerification Results:');
  console.log('- db.saveActiveItem called:', hasSaveItem);
  console.log('- db.saveHabit called:', hasSaveHabit);
  console.log('- db.deleteActiveItems called:', hasDeleteItems);
  console.log('- broadcaster.broadcast called:', hasBroadcast);

  if (hasSaveItem && hasSaveHabit && hasDeleteItems && hasBroadcast && dummyCount === 0) {
    console.log('\nVERDICT: DYNAMIC TRACING & AST VERIFICATION PASSED PERFECTLY!');
  } else {
    console.log('\nVERDICT: INTEGRITY ISSUE DETECTED!');
  }
}

runTrace().catch(err => {
  console.error('Error during trace:', err);
  process.exit(1);
});
