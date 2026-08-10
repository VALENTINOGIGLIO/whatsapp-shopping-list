import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockBroadcaster } from '../../../src/broadcaster/MockBroadcaster.js';
import { NotificationBroadcaster } from '../../../src/broadcaster/NotificationBroadcaster.js';

describe('Unit Test: NotificationBroadcaster & MockBroadcaster', () => {
  let broadcaster;

  beforeEach(() => {
    broadcaster = new MockBroadcaster();
  });

  test('Abstract base NotificationBroadcaster methods throw Error when un-implemented', async () => {
    const base = new NotificationBroadcaster();
    await assert.rejects(async () => await base.broadcast('msg'), /must be implemented/i);
    await assert.rejects(async () => await base.broadcastReset({}), /must be implemented/i);
    await assert.rejects(async () => await base.broadcastNotification('msg'), /must be implemented/i);
    await assert.rejects(async () => await base.broadcastItemAdded({}), /must be implemented/i);
  });

  test('MockBroadcaster stores sent notifications', async () => {
    await broadcaster.broadcast('Hello World', 'family_chat');
    const sent = broadcaster.getSentNotifications();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].message, 'Hello World');
    assert.equal(sent[0].recipient, 'family_chat');
    assert.ok(sent[0].timestamp);
  });

  test('broadcastReset formats reset message and includes store name', async () => {
    const resetRecord = { store: 'coop', itemsCleared: 3 };
    const res = await broadcaster.broadcastReset(resetRecord);

    assert.ok(res.message.includes('COOP'));
    assert.ok(res.message.includes('3'));
    assert.equal(broadcaster.getSentNotifications().length, 1);
  });

  test('broadcastItemAdded formats item addition message', async () => {
    const res = await broadcaster.broadcastItemAdded({ name: 'latte', store: 'lidl' });
    assert.ok(res.message.includes('latte'));
    assert.ok(res.message.includes('lidl'));
  });

  test('onBroadcast listener fires on notification broadcast', async () => {
    let received = null;
    const unsubscribe = broadcaster.onBroadcast(entry => {
      received = entry;
    });

    await broadcaster.broadcastNotification('Alert!');
    assert.ok(received);
    assert.equal(received.messageText, 'Alert!');

    unsubscribe();
    received = null;
    await broadcaster.broadcastNotification('Second Alert');
    assert.equal(received, null);
  });

  test('clearNotifications and clear reset notification history', async () => {
    await broadcaster.broadcast('Message 1');
    assert.equal(broadcaster.getSentNotifications().length, 1);

    broadcaster.clearNotifications();
    assert.equal(broadcaster.getSentNotifications().length, 0);

    await broadcaster.broadcast('Message 2');
    broadcaster.clear();
    assert.equal(broadcaster.getSentNotifications().length, 0);
  });
});
