#!/usr/bin/env node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MockDatabaseAdapter } from '../src/db/MockDatabaseAdapter.js';
import { FirestoreAdapter } from '../src/db/FirestoreAdapter.js';
import { HabitTracker } from '../src/domain/HabitTracker.js';
import { ShoppingListService } from '../src/domain/ShoppingListService.js';
import { MessageParser } from '../src/domain/MessageParser.js';
import { MockBroadcaster } from '../src/broadcaster/MockBroadcaster.js';

/**
 * Parses raw CLI arguments into structured options and positional commands.
 * @param {string[]} rawArgs
 */
export function parseCliArgs(rawArgs = []) {
  let store = null;
  let sender = 'cli_user';
  let dbType = 'mock';
  let help = false;
  const positionals = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-s' || arg === '--store') {
      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
        store = rawArgs[i + 1];
        i++;
      }
    } else if (arg.startsWith('--store=')) {
      store = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('-s=')) {
      store = arg.split('=').slice(1).join('=');
    } else if (arg === '--sender') {
      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
        sender = rawArgs[i + 1];
        i++;
      }
    } else if (arg.startsWith('--sender=')) {
      sender = arg.split('=').slice(1).join('=');
    } else if (arg === '--db') {
      if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('-')) {
        dbType = rawArgs[i + 1];
        i++;
      }
    } else if (arg.startsWith('--db=')) {
      dbType = arg.split('=').slice(1).join('=');
    } else {
      positionals.push(arg);
    }
  }

  return { store, sender, dbType, help, positionals };
}

/**
 * Returns CLI usage text.
 * @returns {string}
 */
export function getHelpText() {
  return `WhatsApp Shopping List CLI / Mock Mode Runner

Usage:
  node bin/cli.js <command> [options]

Commands:
  add <item> [store]       Add an item to the shopping list (with optional store)
  reset [store]            Clear the shopping list and log purchase history
  list                     Display the active shopping list
  habits [item]            Display tracked shopping habits and store preferences
  help                     Show this help message

Options:
  -s, --store <name>       Specify store name for add or reset
  --sender <name>          Specify sender name (default: cli_user)
  --db <type>              Database adapter to use: mock (default) or firestore
  -h, --help               Show help usage text`;
}

/**
 * Formats habits data array for terminal output.
 * @param {Array<Object>} habits
 * @returns {string}
 */
export function formatHabitsForDisplay(habits) {
  if (!habits || habits.length === 0) {
    return '📊 Shopping Habits: No habits recorded yet.';
  }

  const lines = [`📊 Shopping Habits (${habits.length} item(s)):`];
  habits.forEach((habit) => {
    const itemName = habit.itemName;
    const favorite = habit.favoriteStore || 'none';
    let storesStr = '';
    if (habit.stores && typeof habit.stores === 'object') {
      const entries = Object.entries(habit.stores);
      if (entries.length > 0) {
        storesStr = entries.map(([st, count]) => `${st}: ${count}`).join(', ');
      }
    }
    const details = storesStr ? ` (purchases: ${storesStr})` : '';
    lines.push(`- ${itemName}: favorite store = ${favorite}${details}`);
  });

  return lines.join('\n');
}

/**
 * Main CLI execution entry point.
 * @param {string[]} args
 * @param {Object} [options]
 * @returns {Promise<number>} Exit code (0 for success, 1 for error)
 */
export async function runCli(args = process.argv.slice(2), options = {}) {
  const stdout = options.stdout || (msg => process.stdout.write(msg + '\n'));
  const stderr = options.stderr || (msg => process.stderr.write(msg + '\n'));
  const stateFile = options.stateFile || process.env.MOCK_DB_FILE || path.resolve(process.cwd(), '.mock_db.json');

  const { store: flagStore, sender, dbType, help, positionals } = parseCliArgs(args);

  if (help || positionals.length === 0 || (positionals[0] && ['help', 'aiuto', '?', '-h', '--help'].includes(positionals[0].toLowerCase()))) {
    stdout(getHelpText());
    return 0;
  }

  const firstWord = positionals[0].toLowerCase();
  const knownCommands = [
    'add', 'reset', 'list', 'lista', 'mostra', 'show',
    'habits', 'abitudini', 'preferenze', 'stats', 'statistiche',
    'help', 'aiuto', '?'
  ];

  if (!knownCommands.includes(firstWord)) {
    stderr(`Error: Unknown command "${positionals[0]}". Run "node bin/cli.js help" for usage.`);
    return 1;
  }

  // Database initialization
  let db;
  if (dbType === 'firestore') {
    db = new FirestoreAdapter();
  } else {
    let initialData = {};
    try {
      if (fs.existsSync(stateFile)) {
        const raw = fs.readFileSync(stateFile, 'utf8');
        initialData = JSON.parse(raw);
      }
    } catch (_) {
      initialData = {};
    }
    db = new MockDatabaseAdapter(initialData);
  }

  const broadcaster = new MockBroadcaster();
  const habitTracker = new HabitTracker(db);
  const service = new ShoppingListService(db, broadcaster, habitTracker);

  // Wire broadcast listener for real-time output
  broadcaster.onBroadcast((notification) => {
    stdout(`📢 [BROADCAST NOTIFICATION -> ${notification.recipient || 'family_chat'}]\n${notification.message}`);
  });

  try {
    if (firstWord === 'add') {
      const restText = positionals.slice(1).join(' ').trim();
      let itemName = '';
      let storeName = flagStore || null;

      if (flagStore) {
        itemName = restText;
      } else if (restText) {
        const parsed = MessageParser._parseAddItem(restText);
        itemName = parsed.itemName;
        storeName = parsed.storeName;
      }

      if (!itemName || itemName.trim() === '') {
        stderr('Error: Item name cannot be empty.');
        return 1;
      }

      const result = await service.addItem(itemName, storeName, sender);
      const storeStr = result.item.store ? ` (store: ${result.item.store})` : '';
      stdout(`✅ Added "${result.item.name}"${storeStr} to shopping list.`);
    } else if (firstWord === 'reset') {
      let storeName = flagStore || null;
      if (!storeName) {
        const restText = positionals.slice(1).join(' ').trim();
        if (restText) {
          storeName = restText.replace(/^(@|at|da|in|-)\s+/i, '').trim();
        }
      }

      const result = await service.resetList(storeName, sender);
      stdout(`🧹 Shopping list reset. Cleared ${result.itemsCleared} item(s).`);
    } else if (['list', 'lista', 'mostra', 'show'].includes(firstWord)) {
      const items = await service.getList();
      stdout(service.formatListForDisplay(items));
    } else if (['habits', 'abitudini', 'preferenze', 'stats', 'statistiche'].includes(firstWord)) {
      const targetItem = positionals.slice(1).join(' ').trim() || null;
      const habits = await service.getHabits(targetItem);
      stdout(formatHabitsForDisplay(habits));
    }

    // Save mock database state if using MockDatabaseAdapter
    if (db instanceof MockDatabaseAdapter || dbType === 'mock') {
      const activeItems = await db.getActiveItems();
      const habits = await db.getAllHabits();
      const purchaseHistory = await db.getPurchaseHistory();
      const stateToSave = { activeItems, habits, purchaseHistory };
      fs.writeFileSync(stateFile, JSON.stringify(stateToSave, null, 2), 'utf8');
    }
  } catch (err) {
    stderr(`Error: ${err.message || err}`);
    return 1;
  }

  return 0;
}

// Immediate execution check when invoked directly
const currentFilePath = fileURLToPath(import.meta.url);
const executedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (executedPath && (currentFilePath === executedPath || executedPath.endsWith('bin/cli.js') || executedPath.endsWith('cli.js'))) {
  runCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) {
      process.exit(code);
    }
  }).catch((err) => {
    console.error(`Error: ${err.message || err}`);
    process.exit(1);
  });
}
