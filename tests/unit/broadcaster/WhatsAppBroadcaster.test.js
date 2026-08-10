import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppBroadcaster } from '../../../src/broadcaster/WhatsAppBroadcaster.js';

describe('Unit Test: WhatsAppBroadcaster', () => {
  it('instantiates with default options', () => {
    const broadcaster = new WhatsAppBroadcaster();
    assert.ok(broadcaster);
    assert.equal(broadcaster.clientWrapper, null);
  });

  it('broadcasts message when client is READY', async () => {
    let sentTo = null;
    let sentBody = null;

    const mockWrapper = {
      getStatus: () => 'READY',
      getClient: () => ({
        sendMessage: async (to, body) => {
          sentTo = to;
          sentBody = body;
          return { id: 'msg_1' };
        }
      }),
      getLastTargetChatId: () => '123456789@g.us'
    };

    const broadcaster = new WhatsAppBroadcaster(mockWrapper);
    const notification = await broadcaster.broadcast('Hello WhatsApp');

    assert.equal(sentTo, '123456789@g.us');
    assert.equal(sentBody, 'Hello WhatsApp');
    assert.equal(notification.message, 'Hello WhatsApp');
    assert.equal(notification.recipient, '123456789@g.us');
  });

  it('handles client NOT READY gracefully without throwing', async () => {
    const mockWrapper = {
      getStatus: () => 'INITIALIZING',
      getClient: () => null
    };

    const broadcaster = new WhatsAppBroadcaster(mockWrapper, { defaultRecipient: 'group_chat_1' });
    const notification = await broadcaster.broadcast('Queued message');

    assert.equal(notification.message, 'Queued message');
    assert.equal(notification.recipient, 'group_chat_1');
  });

  it('broadcastReset formats reset notification correctly', async () => {
    let sentBody = null;
    const mockWrapper = {
      getStatus: () => 'READY',
      getClient: () => ({
        sendMessage: async (to, body) => {
          sentBody = body;
        }
      }),
      getLastTargetChatId: () => 'family_group@g.us'
    };

    const broadcaster = new WhatsAppBroadcaster(mockWrapper);
    const resetRecord = {
      store: 'coop',
      itemsCleared: 5
    };

    const result = await broadcaster.broadcastReset(resetRecord);

    assert.equal(result.type, 'RESET');
    assert.equal(sentBody, 'Spesa completata presso COOP! La lista è stata svuotata (5 articoli).');
  });

  it('broadcastItemAdded formats item notification correctly', async () => {
    let sentBody = null;
    const mockWrapper = {
      getStatus: () => 'READY',
      getClient: () => ({
        sendMessage: async (to, body) => {
          sentBody = body;
        }
      }),
      getLastTargetChatId: () => 'family_group@g.us'
    };

    const broadcaster = new WhatsAppBroadcaster(mockWrapper);
    const item = { name: 'Latte', store: 'esselunga' };

    const result = await broadcaster.broadcastItemAdded(item);

    assert.equal(result.type, 'ITEM_ADDED');
    assert.equal(sentBody, 'Aggiunto alla lista: Latte (esselunga)');
  });

  it('broadcastNotification handles generic notifications', async () => {
    let sentBody = null;
    let sentTo = null;
    const mockWrapper = {
      getStatus: () => 'READY',
      getClient: () => ({
        sendMessage: async (to, body) => {
          sentTo = to;
          sentBody = body;
        }
      })
    };

    const broadcaster = new WhatsAppBroadcaster(mockWrapper);
    const result = await broadcaster.broadcastNotification('Attenzione spesa!', { recipient: 'custom_chat@g.us' });

    assert.equal(result.type, 'GENERIC');
    assert.equal(sentTo, 'custom_chat@g.us');
    assert.equal(sentBody, 'Attenzione spesa!');
  });
});
