import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MessageParser } from '../../../src/domain/MessageParser.js';
import { CommandType } from '../../../src/domain/CommandType.js';

describe('Unit Test: MessageParser', () => {
  test('Parses simple add item command ("cioccolato")', () => {
    const parsed = MessageParser.parse('cioccolato');
    assert.equal(parsed.command, 'add');
    assert.equal(parsed.type, CommandType.ADD_ITEM);
    assert.equal(parsed.item, 'cioccolato');
    assert.equal(parsed.payload.itemName, 'cioccolato');
    assert.equal(parsed.payload.storeName, null);
    assert.equal(parsed.isValid, true);
  });

  test('Parses add item command with store ("cioccolato @ eurospin")', () => {
    const parsed = MessageParser.parse('cioccolato @ eurospin');
    assert.equal(parsed.command, 'add');
    assert.equal(parsed.type, CommandType.ADD_ITEM);
    assert.equal(parsed.item, 'cioccolato');
    assert.equal(parsed.store, 'eurospin');
    assert.equal(parsed.payload.itemName, 'cioccolato');
    assert.equal(parsed.payload.storeName, 'eurospin');
  });

  test('Parses add item command with explicit delimiter ("cioccolato @ eurospin")', () => {
    const parsed = MessageParser.parse('cioccolato @ eurospin');
    assert.equal(parsed.command, 'add');
    assert.equal(parsed.type, CommandType.ADD_ITEM);
    assert.equal(parsed.item, 'cioccolato');
    assert.equal(parsed.store, 'eurospin');
  });

  test('Parses add item with preposition delimiter ("pane integral da coop")', () => {
    const parsed = MessageParser.parse('pane integral da coop');
    assert.equal(parsed.command, 'add');
    assert.equal(parsed.type, CommandType.ADD_ITEM);
    assert.equal(parsed.item, 'pane integral');
    assert.equal(parsed.store, 'coop');
  });

  test('Parses reset command without store ("reset")', () => {
    const parsed = MessageParser.parse('reset');
    assert.equal(parsed.command, 'reset');
    assert.equal(parsed.type, CommandType.RESET_LIST);
    assert.equal(parsed.store, undefined);
    assert.equal(parsed.payload.storeName, null);
  });

  test('Parses reset command with store ("reset eurospin")', () => {
    const parsed = MessageParser.parse('reset eurospin');
    assert.equal(parsed.command, 'reset');
    assert.equal(parsed.type, CommandType.RESET_LIST);
    assert.equal(parsed.store, 'eurospin');
    assert.equal(parsed.payload.storeName, 'eurospin');
  });

  test('Parses reset command with mixed casing and preposition ("  ReSeT   COOP  ")', () => {
    const parsed = MessageParser.parse('  ReSeT   COOP  ');
    assert.equal(parsed.command, 'reset');
    assert.equal(parsed.type, CommandType.RESET_LIST);
    assert.equal(parsed.store, 'COOP');
  });

  test('Parses list commands ("list", "lista", "mostra")', () => {
    assert.equal(MessageParser.parse('list').command, 'list');
    assert.equal(MessageParser.parse('lista').command, 'list');
    assert.equal(MessageParser.parse('mostra').command, 'list');
    assert.equal(MessageParser.parse('show list').command, 'list');
  });

  test('Parses habits commands ("habits", "abitudini", "habits latte")', () => {
    const p1 = MessageParser.parse('habits');
    assert.equal(p1.command, 'habits');
    assert.equal(p1.type, CommandType.GET_HABITS);

    const p2 = MessageParser.parse('habits latte');
    assert.equal(p2.command, 'habits');
    assert.equal(p2.item, 'latte');
  });

  test('Parses help commands ("help", "aiuto", "?")', () => {
    assert.equal(MessageParser.parse('help').command, 'help');
    assert.equal(MessageParser.parse('aiuto').command, 'help');
    assert.equal(MessageParser.parse('?').command, 'help');
  });

  test('Handles null, empty, or whitespace inputs gracefully', () => {
    const pNull = MessageParser.parse(null);
    assert.equal(pNull.command, 'unknown');
    assert.equal(pNull.type, CommandType.UNKNOWN);
    assert.equal(pNull.isValid, false);

    const pEmpty = MessageParser.parse('   ');
    assert.equal(pEmpty.command, 'unknown');
    assert.equal(pEmpty.type, CommandType.UNKNOWN);
    assert.equal(pEmpty.isValid, false);
  });
});
