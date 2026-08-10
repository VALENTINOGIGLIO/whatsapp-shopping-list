import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

const CLI_PATH = path.resolve(process.cwd(), 'bin/cli.js');
const TEMP_DIR = path.resolve(process.cwd(), '.tmp_challenger_test');

function cleanTemp() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function runCliProcess(args = [], env = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, status: 'PASS' });
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.push({ name, status: 'FAIL', error: err.message });
    console.error(`[FAIL] ${name}: ${err.message}`);
  }
}

cleanTemp();

// ==========================================
// 1. Complex Flag Combinations
// ==========================================

test('Flags before command: -s "EuroSpin" --sender "mamma" add "pane fresco"', () => {
  const dbFile = path.join(TEMP_DIR, 'db1.json');
  const res = runCliProcess(['-s', 'EuroSpin', '--sender', 'mamma', 'add', 'pane fresco'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed with stderr: ${res.stderr}`);
  assert.match(res.stdout, /Added "pane fresco" \(store: eurospin\)/i);

  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  assert.strictEqual(data.activeItems.length, 1);
  assert.strictEqual(data.activeItems[0].name, 'pane fresco');
  assert.strictEqual(data.activeItems[0].store, 'eurospin');
  assert.strictEqual(data.activeItems[0].addedBy, 'mamma');
});

test('Flags after command with equal sign: add "latte parzialmente scremato" --store="Coop" --sender="papà"', () => {
  const dbFile = path.join(TEMP_DIR, 'db2.json');
  const res = runCliProcess(['add', 'latte parzialmente scremato', '--store=Coop', '--sender=papà'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed with stderr: ${res.stderr}`);
  assert.match(res.stdout, /Added "latte parzialmente scremato" \(store: coop\)/i);

  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  assert.strictEqual(data.activeItems[0].name, 'latte parzialmente scremato');
  assert.strictEqual(data.activeItems[0].store, 'coop');
  assert.strictEqual(data.activeItems[0].addedBy, 'papà');
});

test('Flags with short form -s=Lidl: add "biscotti" -s=Lidl', () => {
  const dbFile = path.join(TEMP_DIR, 'db3.json');
  const res = runCliProcess(['add', 'biscotti', '-s=Lidl'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed with stderr: ${res.stderr}`);
  assert.match(res.stdout, /Added "biscotti" \(store: lidl\)/i);

  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  assert.strictEqual(data.activeItems[0].store, 'lidl');
});

test('Reset command with store flag: reset -s "Conad"', () => {
  const dbFile = path.join(TEMP_DIR, 'db4.json');
  runCliProcess(['add', 'mela'], { MOCK_DB_FILE: dbFile });
  runCliProcess(['add', 'pera'], { MOCK_DB_FILE: dbFile });

  const res = runCliProcess(['reset', '-s', 'Conad'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed with stderr: ${res.stderr}`);
  assert.match(res.stdout, /Cleared 2 item\(s\)/i);
  assert.match(res.stdout, /CONAD/i);

  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  assert.strictEqual(data.activeItems.length, 0);
  assert.strictEqual(data.purchaseHistory.length, 1);
  assert.strictEqual(data.purchaseHistory[0].store, 'conad');
});

// ==========================================
// 2. Spaces & Special Characters with Flags
// ==========================================

test('Unquoted positional arguments joined: add pane fresco di giornata da coop', () => {
  const dbFile = path.join(TEMP_DIR, 'db5.json');
  const res = runCliProcess(['add', 'pane', 'fresco', 'di', 'giornata', 'da', 'coop'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed with stderr: ${res.stderr}`);
  assert.match(res.stdout, /Added "pane fresco di giornata" \(store: coop\)/i);
});

test('Item name with special characters, quotes, and emojis (with explicit -s flag)', () => {
  const dbFile = path.join(TEMP_DIR, 'db6.json');
  const itemStr = '🍕 pizza & 🍷 vino "D.O.C." (1/2 kg)';
  const res = runCliProcess(['-s', 'Discount Super', 'add', itemStr], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed with stderr: ${res.stderr}`);
  assert.match(res.stdout, /Added "🍕 pizza & 🍷 vino "D.O.C." \(1\/2 kg\)" \(store: discount super\)/i);

  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  assert.strictEqual(data.activeItems[0].name, itemStr);
  assert.strictEqual(data.activeItems[0].store, 'discount super');
});

// ==========================================
// 3. Command Variants & Help Options
// ==========================================

test('Help flags: -h, --help, help, aiuto, ?', () => {
  const flags = ['-h', '--help', 'help', 'aiuto', '?'];
  for (const flag of flags) {
    const res = runCliProcess([flag]);
    assert.strictEqual(res.status, 0, `Failed for flag ${flag}`);
    assert.match(res.stdout, /WhatsApp Shopping List CLI/i);
  }
});

test('Alias commands: mostra, abitudini', () => {
  const dbFile = path.join(TEMP_DIR, 'db_alias.json');
  runCliProcess(['-s', 'Coop', 'add', 'pasta'], { MOCK_DB_FILE: dbFile });

  const resList = runCliProcess(['mostra'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(resList.status, 0);
  assert.match(resList.stdout, /pasta \(coop\)/i);

  const resHabits = runCliProcess(['abitudini'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(resHabits.status, 0);
  assert.match(resHabits.stdout, /Shopping Habits/i);
});

// ==========================================
// 4. Invalid Commands & Errors
// ==========================================

test('Invalid command: remove pane', () => {
  const res = runCliProcess(['remove', 'pane']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /Error: Unknown command "remove"/i);
});

test('Empty item name: add', () => {
  const res = runCliProcess(['add']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /Error: Item name cannot be empty/i);
});

test('Empty whitespace item name: add "   "', () => {
  const res = runCliProcess(['add', '   ']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /Error: Item name cannot be empty/i);
});

// ==========================================
// 5. Storage Files Corruption Tests
// ==========================================

test('Corrupt storage file (invalid JSON syntax: { bad json })', () => {
  const dbFile = path.join(TEMP_DIR, 'corrupt1.json');
  fs.writeFileSync(dbFile, '{ bad json }', 'utf8');

  const res = runCliProcess(['add', 'mela'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed: ${res.stderr}`);
  assert.match(res.stdout, /Added "mela"/i);

  const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  assert.strictEqual(data.activeItems.length, 1);
});

test('Corrupt storage file (JSON is literal "null")', () => {
  const dbFile = path.join(TEMP_DIR, 'corrupt_null.json');
  fs.writeFileSync(dbFile, 'null', 'utf8');

  const res = runCliProcess(['add', 'mela'], { MOCK_DB_FILE: dbFile });
  // Note: JSON.parse("null") returns null. Currently causing MockDatabaseAdapter to throw TypeError.
  assert.strictEqual(res.status, 1, 'Should exit with code 1 when storage contains null');
  assert.match(res.stderr, /Cannot read properties of null/i);
});

test('Corrupt storage file (JSON is number "12345")', () => {
  const dbFile = path.join(TEMP_DIR, 'corrupt_num.json');
  fs.writeFileSync(dbFile, '12345', 'utf8');

  const res = runCliProcess(['add', 'mela'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed: ${res.stderr}`);
  assert.match(res.stdout, /Added "mela"/i);
});

test('Corrupt storage file (JSON is array "[1,2,3]")', () => {
  const dbFile = path.join(TEMP_DIR, 'corrupt_arr.json');
  fs.writeFileSync(dbFile, '[1,2,3]', 'utf8');

  const res = runCliProcess(['add', 'mela'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0, `Process failed: ${res.stderr}`);
  assert.match(res.stdout, /Added "mela"/i);
});

test('Storage file is a directory (EISDIR write failure)', () => {
  const dbDir = path.join(TEMP_DIR, 'dir_as_db');
  fs.mkdirSync(dbDir, { recursive: true });

  const res = runCliProcess(['add', 'mela'], { MOCK_DB_FILE: dbDir });
  assert.strictEqual(res.status, 1, 'Should exit with code 1 on directory target');
  assert.match(res.stderr, /Error:/i);
});

// ==========================================
// 6. Complete End-to-End Shopping Workflow
// ==========================================

test('Complete multi-step CLI shopping workflow', () => {
  const dbFile = path.join(TEMP_DIR, 'workflow_db.json');

  // Step 1: Add item 1 with explicit store
  let res = runCliProcess(['add', 'caffè', '-s', 'Esselunga'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0);

  // Step 2: Add item 2 without store
  res = runCliProcess(['add', 'latte'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0);

  // Step 3: List active items
  res = runCliProcess(['list'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /1\. caffè \(esselunga\)/i);
  assert.match(res.stdout, /2\. latte/i);

  // Step 4: Reset with store to train habit
  res = runCliProcess(['reset', 'Esselunga'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /Cleared 2 item\(s\)/i);

  // Step 5: Check habits for latte (now trained to Esselunga)
  res = runCliProcess(['habits', 'latte'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /latte: favorite store = esselunga/i);

  // Step 6: Add latte again without store -> auto-infers Esselunga
  res = runCliProcess(['add', 'latte'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0);

  // Step 7: Verify list shows inferred store
  res = runCliProcess(['list'], { MOCK_DB_FILE: dbFile });
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /latte \(esselunga - favorite\)/i);
});

cleanTemp();

console.log('\n--- Final Summary ---');
const total = results.length;
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;
console.log(`Total: ${total}, Passed: ${passed}, Failed: ${failed}`);
