import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  parseCliArgs,
  getHelpText,
  formatHabitsForDisplay,
  runCli
} from '../../../bin/cli.js';

describe('Unit Test: bin/cli.js', () => {
  let tmpDir;
  let testStateFile;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
    testStateFile = path.join(tmpDir, '.test_mock_db.json');
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function createStreamCapturer() {
    let output = '';
    return {
      write: (msg) => { output += msg + '\n'; },
      get text() { return output; },
      clear: () => { output = ''; }
    };
  }

  describe('Argument Parsing (parseCliArgs)', () => {
    test('parseCliArgs parses store flags (-s and --store)', () => {
      const res1 = parseCliArgs(['add', 'mele', '-s', 'coop']);
      assert.equal(res1.store, 'coop');
      assert.deepEqual(res1.positionals, ['add', 'mele']);

      const res2 = parseCliArgs(['add', 'pane', '--store=eurospin']);
      assert.equal(res2.store, 'eurospin');
      assert.deepEqual(res2.positionals, ['add', 'pane']);
    });

    test('parseCliArgs parses sender and db flags', () => {
      const res = parseCliArgs(['add', 'latte', '--sender', 'mamma', '--db', 'mock']);
      assert.equal(res.sender, 'mamma');
      assert.equal(res.dbType, 'mock');
      assert.deepEqual(res.positionals, ['add', 'latte']);
    });

    test('parseCliArgs detects help flags', () => {
      assert.equal(parseCliArgs(['-h']).help, true);
      assert.equal(parseCliArgs(['--help']).help, true);
      assert.equal(parseCliArgs(['add', 'mele']).help, false);
    });
  });

  describe('Help & Helper Functions', () => {
    test('getHelpText returns CLI usage guide', () => {
      const helpText = getHelpText();
      assert.ok(helpText.includes('WhatsApp Shopping List CLI'));
      assert.ok(helpText.includes('Usage:'));
      assert.ok(helpText.includes('Commands:'));
    });

    test('formatHabitsForDisplay formats empty and non-empty habits', () => {
      assert.equal(formatHabitsForDisplay([]), '📊 Shopping Habits: No habits recorded yet.');

      const habits = [{
        itemName: 'cioccolato',
        favoriteStore: 'eurospin',
        stores: { eurospin: 2, coop: 1 }
      }];
      const output = formatHabitsForDisplay(habits);
      assert.ok(output.includes('cioccolato'));
      assert.ok(output.includes('favorite store = eurospin'));
      assert.ok(output.includes('purchases: eurospin: 2, coop: 1'));
    });
  });

  describe('CLI Command Runner Execution (runCli)', () => {
    test('runCli help command outputs help text with code 0', async () => {
      const stdout = createStreamCapturer();
      const stderr = createStreamCapturer();

      const code = await runCli(['help'], { stdout: stdout.write, stderr: stderr.write, stateFile: testStateFile });
      assert.equal(code, 0);
      assert.ok(stdout.text.includes('WhatsApp Shopping List CLI'));
      assert.equal(stderr.text, '');
    });

    test('runCli unknown command returns exit code 1 with stderr message', async () => {
      const stdout = createStreamCapturer();
      const stderr = createStreamCapturer();

      const code = await runCli(['fooCommand'], { stdout: stdout.write, stderr: stderr.write, stateFile: testStateFile });
      assert.equal(code, 1);
      assert.ok(stderr.text.includes('Error: Unknown command "fooCommand"'));
    });

    test('runCli add command adds item and persists to state file', async () => {
      const stdout = createStreamCapturer();
      const stderr = createStreamCapturer();

      const code = await runCli(['add', 'cioccolato', '--store', 'eurospin'], {
        stdout: stdout.write,
        stderr: stderr.write,
        stateFile: testStateFile
      });

      assert.equal(code, 0);
      assert.ok(stdout.text.includes('Added "cioccolato" (store: eurospin)'));

      // Verify file persistence
      assert.ok(fs.existsSync(testStateFile));
      const stateData = JSON.parse(fs.readFileSync(testStateFile, 'utf8'));
      assert.equal(stateData.activeItems.length, 1);
      assert.equal(stateData.activeItems[0].name, 'cioccolato');
      assert.equal(stateData.activeItems[0].store, 'eurospin');
    });

    test('runCli add command with empty item returns code 1', async () => {
      const stdout = createStreamCapturer();
      const stderr = createStreamCapturer();

      const code = await runCli(['add'], { stdout: stdout.write, stderr: stderr.write, stateFile: testStateFile });
      assert.equal(code, 1);
      assert.ok(stderr.text.includes('Error: Item name cannot be empty.'));
    });

    test('runCli list command displays items from persisted state', async () => {
      const stdoutAdd = createStreamCapturer();
      const stderrAdd = createStreamCapturer();

      await runCli(['add', 'pane'], { stdout: stdoutAdd.write, stderr: stderrAdd.write, stateFile: testStateFile });

      const stdoutList = createStreamCapturer();
      const stderrList = createStreamCapturer();

      const code = await runCli(['list'], { stdout: stdoutList.write, stderr: stderrList.write, stateFile: testStateFile });
      assert.equal(code, 0);
      assert.ok(stdoutList.text.includes('pane'));
    });

    test('runCli reset command clears active items and emits broadcast', async () => {
      const stdoutDummy = createStreamCapturer();
      const stderrDummy = createStreamCapturer();

      // Add items
      await runCli(['add', 'mele', '--store', 'coop'], { stdout: stdoutDummy.write, stderr: stderrDummy.write, stateFile: testStateFile });
      await runCli(['add', 'latte', '--store', 'coop'], { stdout: stdoutDummy.write, stderr: stderrDummy.write, stateFile: testStateFile });

      const stdoutReset = createStreamCapturer();
      const stderrReset = createStreamCapturer();

      const code = await runCli(['reset', '--store', 'coop'], {
        stdout: stdoutReset.write,
        stderr: stderrReset.write,
        stateFile: testStateFile
      });

      assert.equal(code, 0);
      assert.ok(stdoutReset.text.includes('BROADCAST NOTIFICATION'));
      assert.ok(stdoutReset.text.includes('COOP'));
      assert.ok(stdoutReset.text.includes('Shopping list reset. Cleared 2 item(s).'));

      // Verify state file active items cleared
      const stateData = JSON.parse(fs.readFileSync(testStateFile, 'utf8'));
      assert.equal(stateData.activeItems.length, 0);
      assert.equal(stateData.purchaseHistory.length, 1);
    });

    test('runCli habits command queries habit statistics', async () => {
      const stdoutDummy = createStreamCapturer();
      const stderrDummy = createStreamCapturer();

      await runCli(['add', 'caffè', '--store', 'coop'], { stdout: stdoutDummy.write, stderr: stderrDummy.write, stateFile: testStateFile });
      await runCli(['reset', '--store', 'coop'], { stdout: stdoutDummy.write, stderr: stderrDummy.write, stateFile: testStateFile });

      const stdoutHabits = createStreamCapturer();
      const stderrHabits = createStreamCapturer();

      const code = await runCli(['habits', 'caffè'], {
        stdout: stdoutHabits.write,
        stderr: stderrHabits.write,
        stateFile: testStateFile
      });

      assert.equal(code, 0);
      assert.ok(stdoutHabits.text.includes('caffè'));
      assert.ok(stdoutHabits.text.includes('favorite store = coop'));
    });
  });
});
