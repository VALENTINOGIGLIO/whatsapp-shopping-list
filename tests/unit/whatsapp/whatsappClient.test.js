import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppClientWrapper } from '../../../src/whatsapp/whatsappClient.js';
import { ShoppingListService } from '../../../src/domain/ShoppingListService.js';
import { MockDatabaseAdapter } from '../../../src/db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../../../src/broadcaster/MockBroadcaster.js';

class MockWhatsAppClient extends EventEmitter {
  constructor() {
    super();
    this.initialize = async () => {};
    this.destroy = async () => {};
    this.sendMessage = async (to, text) => ({ id: 'msg_id', to, text });
  }
}

describe('Unit Test: WhatsAppClientWrapper', () => {
  it('initializes with default status and event listeners', () => {
    const mockClient = new MockWhatsAppClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });

    assert.equal(wrapper.getStatus(), 'INITIALIZING');
    assert.equal(wrapper.getQrCode(), null);
    assert.equal(wrapper.isReady(), false);
  });

  it('captures qr event and updates status to QR_READY', () => {
    const mockClient = new MockWhatsAppClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });

    mockClient.emit('qr', 'mock_qr_string_12345');

    assert.equal(wrapper.getStatus(), 'QR_READY');
    assert.equal(wrapper.getQrCode(), 'mock_qr_string_12345');
  });

  it('captures authenticated and ready events', () => {
    const mockClient = new MockWhatsAppClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });

    mockClient.emit('qr', 'mock_qr_string_12345');
    mockClient.emit('authenticated');
    assert.equal(wrapper.getStatus(), 'AUTHENTICATED');
    assert.equal(wrapper.getQrCode(), null);

    mockClient.emit('ready');
    assert.equal(wrapper.getStatus(), 'READY');
    assert.equal(wrapper.isReady(), true);
  });

  it('captures auth_failure and disconnected events', () => {
    const mockClient = new MockWhatsAppClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });

    mockClient.emit('auth_failure', 'Invalid credentials');
    assert.equal(wrapper.getStatus(), 'AUTH_FAILURE');

    mockClient.emit('disconnected', 'LOGOUT');
    assert.equal(wrapper.getStatus(), 'DISCONNECTED');
  });

  it('routes ADD_ITEM command to ShoppingListService', async () => {
    const mockClient = new MockWhatsAppClient();
    const db = new MockDatabaseAdapter();
    const broadcaster = new MockBroadcaster();
    const service = new ShoppingListService(db, broadcaster);

    const wrapper = new WhatsAppClientWrapper({
      client: mockClient,
      service,
      showTerminalQr: false
    });

    let repliedText = '';
    const mockMsg = {
      from: '123456789@c.us',
      fromMe: false,
      body: 'pane eurospin',
      _data: { notifyName: 'Mario' },
      reply: async (text) => {
        repliedText = text;
      }
    };

    await wrapper.handleIncomingMessage(mockMsg);

    assert.ok(repliedText.includes('pane'));
    assert.ok(repliedText.includes('eurospin'));

    const items = await service.getList();
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'pane');
    assert.equal(items[0].store, 'eurospin');
  });

  it('routes RESET_LIST command to ShoppingListService', async () => {
    const mockClient = new MockWhatsAppClient();
    const db = new MockDatabaseAdapter();
    const broadcaster = new MockBroadcaster();
    const service = new ShoppingListService(db, broadcaster);

    await service.addItem('latte', 'esselunga', 'Mario');

    const wrapper = new WhatsAppClientWrapper({
      client: mockClient,
      service,
      showTerminalQr: false
    });

    let repliedText = '';
    const mockMsg = {
      from: '123456789@c.us',
      fromMe: false,
      body: 'reset esselunga',
      _data: { notifyName: 'Mario' },
      reply: async (text) => {
        repliedText = text;
      }
    };

    await wrapper.handleIncomingMessage(mockMsg);

    assert.ok(repliedText.includes('Spesa completata'));
    assert.ok(repliedText.includes('ESSELUNGA'));

    const items = await service.getList();
    assert.equal(items.length, 0);
  });

  it('routes GET_LIST command to ShoppingListService', async () => {
    const mockClient = new MockWhatsAppClient();
    const db = new MockDatabaseAdapter();
    const broadcaster = new MockBroadcaster();
    const service = new ShoppingListService(db, broadcaster);

    await service.addItem('mela', 'coop', 'Mario');

    const wrapper = new WhatsAppClientWrapper({
      client: mockClient,
      service,
      showTerminalQr: false
    });

    let repliedText = '';
    const mockMsg = {
      from: '123456789@c.us',
      fromMe: false,
      body: 'lista',
      reply: async (text) => {
        repliedText = text;
      }
    };

    await wrapper.handleIncomingMessage(mockMsg);

    assert.ok(repliedText.includes('Shopping List'));
    assert.ok(repliedText.includes('mela'));
  });

  it('routes GET_HABITS command to ShoppingListService', async () => {
    const mockClient = new MockWhatsAppClient();
    const db = new MockDatabaseAdapter();
    const broadcaster = new MockBroadcaster();
    const service = new ShoppingListService(db, broadcaster);

    await service.addItem('pane', 'coop', 'Mario');

    const wrapper = new WhatsAppClientWrapper({
      client: mockClient,
      service,
      showTerminalQr: false
    });

    let repliedText = '';
    const mockMsg = {
      from: '123456789@c.us',
      fromMe: false,
      body: 'abitudini pane',
      reply: async (text) => {
        repliedText = text;
      }
    };

    await wrapper.handleIncomingMessage(mockMsg);

    assert.ok(repliedText.includes('Abitudini di Spesa'));
    assert.ok(repliedText.includes('pane'));
  });

  it('routes HELP command to user', async () => {
    const mockClient = new MockWhatsAppClient();
    const db = new MockDatabaseAdapter();
    const broadcaster = new MockBroadcaster();
    const service = new ShoppingListService(db, broadcaster);

    const wrapper = new WhatsAppClientWrapper({
      client: mockClient,
      service,
      showTerminalQr: false
    });

    let repliedText = '';
    const mockMsg = {
      from: '123456789@c.us',
      fromMe: false,
      body: 'aiuto',
      reply: async (text) => {
        repliedText = text;
      }
    };

    await wrapper.handleIncomingMessage(mockMsg);

    assert.ok(repliedText.includes('WhatsApp Shopping List Bot'));
    assert.ok(repliedText.includes('Aggiungere un articolo'));
  });

  it('filters out self-messages by default', async () => {
    const mockClient = new MockWhatsAppClient();
    const db = new MockDatabaseAdapter();
    const broadcaster = new MockBroadcaster();
    const service = new ShoppingListService(db, broadcaster);

    const wrapper = new WhatsAppClientWrapper({
      client: mockClient,
      service,
      showTerminalQr: false
    });

    let replied = false;
    const mockMsg = {
      from: '123456789@c.us',
      fromMe: true,
      body: 'pane',
      reply: async () => {
        replied = true;
      }
    };

    const result = await wrapper.handleIncomingMessage(mockMsg);

    assert.equal(result, null);
    assert.equal(replied, false);
  });

  it('handles service errors gracefully and replies with error message', async () => {
    const mockClient = new MockWhatsAppClient();
    const failingService = {
      addItem: async () => {
        throw new Error('Database connection failed');
      }
    };

    const wrapper = new WhatsAppClientWrapper({
      client: mockClient,
      service: failingService,
      showTerminalQr: false
    });

    let repliedText = '';
    const mockMsg = {
      from: '123456789@c.us',
      fromMe: false,
      body: 'pane',
      reply: async (text) => {
        repliedText = text;
      }
    };

    await wrapper.handleIncomingMessage(mockMsg);

    assert.ok(repliedText.includes('Si è verificato un errore'));
    assert.ok(repliedText.includes('Database connection failed'));
  });
});
