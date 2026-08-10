import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppClientWrapper } from '../src/whatsapp/whatsappClient.js';
import { startWebServer, stopWebServer } from '../src/web/server.js';
import { ShoppingListService } from '../src/domain/ShoppingListService.js';
import { MockDatabaseAdapter } from '../src/db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../src/broadcaster/MockBroadcaster.js';

class MockFailingClient extends EventEmitter {
  constructor(shouldThrowAsync = true, errorMsg = 'Puppeteer launch failed: Chrome binary not found') {
    super();
    this.shouldThrowAsync = shouldThrowAsync;
    this.errorMsg = errorMsg;
    this.sendMessage = async (to, text) => {
      throw new Error('Client sendMessage error');
    };
  }

  async initialize() {
    if (this.shouldThrowAsync) {
      throw new Error(this.errorMsg);
    } else {
      throw new Error(this.errorMsg);
    }
  }

  async destroy() {}
}

class MockWorkingClient extends EventEmitter {
  constructor() {
    super();
    this.sentMessages = [];
  }
  async initialize() {}
  async destroy() {}
  async sendMessage(to, text) {
    this.sentMessages.push({ to, text });
    return { id: 'msg_1' };
  }
}

describe('Challenger 2 Empirical Verification Suite', () => {

  describe('1. WhatsApp Client Initialization Failure & /health Resilience', () => {
    it('handles asynchronous initialize rejection, updates status to INITIALIZE_FAILED, and /health returns 200 OK', async () => {
      const mockClient = new MockFailingClient(true, 'Chrome binary not found on Render');
      const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });

      const { server } = await startWebServer(0, { whatsappClient: wrapper });
      const address = server.address();
      const port = address.port;

      // Simulate the initialization process in whatsappClient.js main block
      let initError = null;
      await wrapper.initialize().catch((err) => {
        initError = err;
        wrapper.status = 'INITIALIZE_FAILED';
      });

      assert.ok(initError);
      assert.equal(initError.message, 'Chrome binary not found on Render');
      assert.equal(wrapper.getStatus(), 'INITIALIZE_FAILED');

      // Query /health endpoint
      const resHealth = await fetch(`http://localhost:${port}/health`);
      assert.equal(resHealth.status, 200);
      const dataHealth = await resHealth.json();
      assert.equal(dataHealth.status, 'ok');
      assert.equal(dataHealth.whatsappStatus, 'INITIALIZE_FAILED');
      assert.equal(typeof dataHealth.uptime, 'number');

      // Query /healthz endpoint
      const resHealthz = await fetch(`http://localhost:${port}/healthz`);
      assert.equal(resHealthz.status, 200);
      const dataHealthz = await resHealthz.json();
      assert.equal(dataHealthz.status, 'ok');
      assert.equal(dataHealthz.whatsappStatus, 'INITIALIZE_FAILED');

      // Query /qr endpoint under INITIALIZE_FAILED status
      const resQr = await fetch(`http://localhost:${port}/qr`);
      assert.equal(resQr.status, 200);
      const htmlQr = await resQr.text();
      assert.ok(htmlQr.includes('INITIALIZE_FAILED'));

      await stopWebServer(server);
    });

    it('handles synchronous initialize exception, updates status to INITIALIZE_FAILED, and /health returns 200 OK', async () => {
      const mockClient = {
        initialize: () => {
          throw new Error('Synchronous initialization crash');
        }
      };
      const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });

      const { server } = await startWebServer(0, { whatsappClient: wrapper });
      const address = server.address();
      const port = address.port;

      try {
        await wrapper.initialize();
      } catch (err) {
        wrapper.status = 'INITIALIZE_FAILED';
      }

      assert.equal(wrapper.getStatus(), 'INITIALIZE_FAILED');

      const resHealth = await fetch(`http://localhost:${port}/health`);
      assert.equal(resHealth.status, 200);
      const data = await resHealth.json();
      assert.equal(data.status, 'ok');
      assert.equal(data.whatsappStatus, 'INITIALIZE_FAILED');

      await stopWebServer(server);
    });
  });

  describe('2. Message Handling Error Catches & Edge Cases', () => {
    it('handles invalid / non-object / non-string message inputs safely without throwing', async () => {
      const wrapper = new WhatsAppClientWrapper({ showTerminalQr: false });

      assert.equal(await wrapper.handleIncomingMessage(null), null);
      assert.equal(await wrapper.handleIncomingMessage(undefined), null);
      assert.equal(await wrapper.handleIncomingMessage(12345), null);
      assert.equal(await wrapper.handleIncomingMessage('string message'), null);
      assert.equal(await wrapper.handleIncomingMessage(true), null);
      assert.equal(await wrapper.handleIncomingMessage({}), null);
      assert.equal(await wrapper.handleIncomingMessage({ body: null }), null);
      assert.equal(await wrapper.handleIncomingMessage({ body: 12345 }), null);
      assert.equal(await wrapper.handleIncomingMessage({ body: {} }), null);
      assert.equal(await wrapper.handleIncomingMessage({ body: 'pane', fromMe: true }), null);
    });

    it('handles missing ShoppingListService gracefully', async () => {
      const wrapper = new WhatsAppClientWrapper({ service: null, showTerminalQr: false });
      const mockMsg = {
        from: '1234@c.us',
        fromMe: false,
        body: 'pane',
        reply: async () => {}
      };
      const res = await wrapper.handleIncomingMessage(mockMsg);
      assert.equal(res, null);
    });

    it('catches domain service errors in addItem and sends error reply', async () => {
      const mockClient = new MockWorkingClient();
      const failingService = {
        addItem: async () => {
          throw new Error('Database disk full');
        }
      };
      const wrapper = new WhatsAppClientWrapper({ client: mockClient, service: failingService, showTerminalQr: false });

      let replyMsg = '';
      const msg = {
        from: '12345@c.us',
        fromMe: false,
        body: 'pane coop',
        reply: async (t) => { replyMsg = t; }
      };

      const result = await wrapper.handleIncomingMessage(msg);
      assert.ok(result.includes('Si è verificato un errore'));
      assert.ok(result.includes('Database disk full'));
      assert.ok(replyMsg.includes('Database disk full'));
    });

    it('catches domain service errors in resetList and sends error reply', async () => {
      const mockClient = new MockWorkingClient();
      const failingService = {
        resetList: async () => {
          throw new Error('Firestore connection timeout');
        }
      };
      const wrapper = new WhatsAppClientWrapper({ client: mockClient, service: failingService, showTerminalQr: false });

      let replyMsg = '';
      const msg = {
        from: '12345@c.us',
        fromMe: false,
        body: 'reset coop',
        reply: async (t) => { replyMsg = t; }
      };

      const result = await wrapper.handleIncomingMessage(msg);
      assert.ok(result.includes('Firestore connection timeout'));
      assert.ok(replyMsg.includes('Firestore connection timeout'));
    });

    it('catches domain service errors in getList and sends error reply', async () => {
      const mockClient = new MockWorkingClient();
      const failingService = {
        getList: async () => {
          throw new Error('Read index missing');
        }
      };
      const wrapper = new WhatsAppClientWrapper({ client: mockClient, service: failingService, showTerminalQr: false });

      let replyMsg = '';
      const msg = {
        from: '12345@c.us',
        fromMe: false,
        body: 'lista',
        reply: async (t) => { replyMsg = t; }
      };

      const result = await wrapper.handleIncomingMessage(msg);
      assert.ok(result.includes('Read index missing'));
    });

    it('catches domain service errors in getHabits and sends error reply', async () => {
      const mockClient = new MockWorkingClient();
      const failingService = {
        getHabits: async () => {
          throw new Error('Habit collection corrupted');
        }
      };
      const wrapper = new WhatsAppClientWrapper({ client: mockClient, service: failingService, showTerminalQr: false });

      let replyMsg = '';
      const msg = {
        from: '12345@c.us',
        fromMe: false,
        body: 'abitudini',
        reply: async (t) => { replyMsg = t; }
      };

      const result = await wrapper.handleIncomingMessage(msg);
      assert.ok(result.includes('Habit collection corrupted'));
    });

    it('handles secondary error when msg.reply throws during error handling', async () => {
      const mockClient = new MockWorkingClient();
      const failingService = {
        addItem: async () => {
          throw new Error('Primary error in addItem');
        }
      };
      const wrapper = new WhatsAppClientWrapper({ client: mockClient, service: failingService, showTerminalQr: false });

      const msg = {
        from: '12345@c.us',
        fromMe: false,
        body: 'pane',
        reply: async () => {
          throw new Error('Network socket disconnected during reply');
        }
      };

      // Should not throw, should return replyText safely
      const resultText = await wrapper.handleIncomingMessage(msg);
      assert.ok(resultText.includes('Primary error in addItem'));
    });

    it('uses fallback client.sendMessage when msg.reply is not a function', async () => {
      const mockClient = new MockWorkingClient();
      const db = new MockDatabaseAdapter();
      const broadcaster = new MockBroadcaster();
      const service = new ShoppingListService(db, broadcaster);

      const wrapper = new WhatsAppClientWrapper({ client: mockClient, service, showTerminalQr: false });

      const msg = {
        from: '9999@c.us',
        fromMe: false,
        body: 'latte'
        // no msg.reply function!
      };

      const result = await wrapper.handleIncomingMessage(msg);
      assert.ok(result.includes('latte'));
      assert.equal(mockClient.sentMessages.length, 1);
      assert.equal(mockClient.sentMessages[0].to, '9999@c.us');
      assert.ok(mockClient.sentMessages[0].text.includes('latte'));
    });

    it('handles fallback client.sendMessage rejection safely when msg.reply throws', async () => {
      const failingClient = {
        sendMessage: async () => {
          throw new Error('Client sendMessage network failure');
        }
      };
      const failingService = {
        addItem: async () => {
          throw new Error('Service error');
        }
      };

      const wrapper = new WhatsAppClientWrapper({ client: failingClient, service: failingService, showTerminalQr: false });

      const msg = {
        from: '8888@c.us',
        fromMe: false,
        body: 'latte',
        reply: async () => {
          throw new Error('Reply function failed');
        }
      };

      // Should not bubble uncaught error
      const result = await wrapper.handleIncomingMessage(msg);
      assert.ok(result.includes('Service error'));
    });

    it('safely evaluates sender name when msg._data, msg.author, msg.from have missing or unusual formats', async () => {
      const db = new MockDatabaseAdapter();
      const broadcaster = new MockBroadcaster();
      const service = new ShoppingListService(db, broadcaster);

      const wrapper = new WhatsAppClientWrapper({ service, showTerminalQr: false });

      const msg1 = {
        fromMe: false,
        body: 'pane',
        reply: async () => {}
      };
      const result1 = await wrapper.handleIncomingMessage(msg1);
      assert.ok(result1.includes('pane'));

      const msg2 = {
        fromMe: false,
        body: 'latte',
        author: 'mario@c.us',
        reply: async () => {}
      };
      const result2 = await wrapper.handleIncomingMessage(msg2);
      assert.ok(result2.includes('latte'));

      const msg3 = {
        fromMe: false,
        body: 'mela',
        from: 'luigi@c.us',
        reply: async () => {}
      };
      const result3 = await wrapper.handleIncomingMessage(msg3);
      assert.ok(result3.includes('mela'));
    });
  });

});
