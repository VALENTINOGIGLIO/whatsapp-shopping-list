import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer, startWebServer, stopWebServer } from '../src/web/server.js';
import { WhatsAppClientWrapper } from '../src/whatsapp/whatsappClient.js';
import { WhatsAppBroadcaster } from '../src/broadcaster/WhatsAppBroadcaster.js';
import { ShoppingListService } from '../src/domain/ShoppingListService.js';
import { MockDatabaseAdapter } from '../src/db/MockDatabaseAdapter.js';
import { HabitTracker } from '../src/domain/HabitTracker.js';
import { MockBroadcaster } from '../src/broadcaster/MockBroadcaster.js';

describe('Empirical Challenger: Milestone 4 Stress & Resilience Suite', () => {

  describe('1. Express Web Server Route Concurrency & Invalid Route Stress', () => {
    let serverInstance = null;
    let port = 0;
    let currentStatus = 'INITIALIZING';
    let currentQr = null;

    beforeEach(async () => {
      const res = await startWebServer(0, {
        getStatus: () => currentStatus,
        getQrCode: () => currentQr
      });
      serverInstance = res.server;
      port = serverInstance.address().port;
    });

    afterEach(async () => {
      if (serverInstance) {
        await stopWebServer(serverInstance);
        serverInstance = null;
      }
    });

    it('handles 200 concurrent requests across /health, /qr, /, /healthz without failing or dropping requests', async () => {
      currentStatus = 'READY';
      currentQr = null;

      const endpoints = ['/health', '/healthz', '/qr', '/'];
      const requests = Array.from({ length: 200 }, (_, i) => {
        const path = endpoints[i % endpoints.length];
        return fetch(`http://localhost:${port}${path}`, { redirect: 'manual' });
      });

      const responses = await Promise.all(requests);
      assert.equal(responses.length, 200);

      for (let i = 0; i < responses.length; i++) {
        const res = responses[i];
        const path = endpoints[i % endpoints.length];
        if (path === '/') {
          assert.equal(res.status, 302);
          assert.equal(res.headers.get('location'), '/qr');
        } else {
          assert.equal(res.status, 200);
        }
      }
    });

    it('handles invalid HTTP routes and methods gracefully (404 and method handling)', async () => {
      const invalidPaths = [
        '/invalid-route',
        '/health/subpath',
        '/qr/subpath',
        '/..%2f..%2fetc/passwd',
        '/api/v1/unknown'
      ];

      for (const path of invalidPaths) {
        const res = await fetch(`http://localhost:${port}${path}`);
        assert.equal(res.status, 404, `Expected 404 for ${path}`);
      }

      // POST to GET-only endpoints
      const postRes = await fetch(`http://localhost:${port}/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'val' })
      });
      assert.equal(postRes.status, 404, 'POST to /health should return 404');
    });

    it('reflects dynamic status changes and QR code states across server endpoints', async () => {
      // INITIALIZING state
      currentStatus = 'INITIALIZING';
      currentQr = null;
      let res = await fetch(`http://localhost:${port}/qr`);
      let html = await res.text();
      assert.ok(html.includes('Inizializzazione WhatsApp Client'));

      // QR_READY state with payload
      currentStatus = 'QR_READY';
      currentQr = 'whatsapp_qr_code_sample_12345';
      res = await fetch(`http://localhost:${port}/qr`);
      html = await res.text();
      assert.ok(html.includes('whatsapp_qr_code_sample_12345'));

      // CONNECTED state
      currentStatus = 'CONNECTED';
      currentQr = null;
      res = await fetch(`http://localhost:${port}/qr`);
      html = await res.text();
      assert.ok(html.includes('WhatsApp Client Connected'));

      // Check health JSON response reflecting state
      res = await fetch(`http://localhost:${port}/health`);
      const data = await res.json();
      assert.equal(data.whatsappStatus, 'CONNECTED');
      assert.equal(data.status, 'ok');
    });
  });

  describe('2. WhatsApp Client Wrapper Message Parsing & Edge Case Stress', () => {
    let mockDb;
    let habitTracker;
    let broadcaster;
    let service;
    let clientWrapper;
    let mockClient;

    beforeEach(() => {
      mockDb = new MockDatabaseAdapter();
      habitTracker = new HabitTracker(mockDb);
      broadcaster = new MockBroadcaster();
      service = new ShoppingListService({ dbAdapter: mockDb, habitTracker, broadcaster });

      mockClient = {
        on: (event, cb) => {},
        sendMessage: async (to, text) => ({ id: 'sent_msg_id' })
      };

      clientWrapper = new WhatsAppClientWrapper({
        client: mockClient,
        service: service,
        allowSelfMessages: false
      });
    });

    it('handles malformed inputs safely (null, undefined, non-object, missing text, non-string text)', async () => {
      assert.equal(await clientWrapper.handleIncomingMessage(null), null);
      assert.equal(await clientWrapper.handleIncomingMessage(undefined), null);
      assert.equal(await clientWrapper.handleIncomingMessage("just a string"), null);
      assert.equal(await clientWrapper.handleIncomingMessage(12345), null);
      assert.equal(await clientWrapper.handleIncomingMessage({}), null);
      assert.equal(await clientWrapper.handleIncomingMessage({ body: null }), null);
      assert.equal(await clientWrapper.handleIncomingMessage({ body: 12345 }), null);
      assert.equal(await clientWrapper.handleIncomingMessage({ body: "" }), null);
    });

    it('filters out self-messages by default unless allowSelfMessages is true', async () => {
      const selfMsg = { fromMe: true, body: 'pane', from: '12345@c.us' };
      assert.equal(await clientWrapper.handleIncomingMessage(selfMsg), null);

      const wrapperWithSelf = new WhatsAppClientWrapper({
        client: mockClient,
        service: service,
        allowSelfMessages: true
      });
      const result = await wrapperWithSelf.handleIncomingMessage(selfMsg);
      assert.ok(result.includes('pane'));
    });

    it('handles adversarial strings: special characters, emojis, large strings, injection attacks', async () => {
      const replies = [];
      const createMsg = (body) => ({
        body,
        from: '393330000000@c.us',
        _data: { notifyName: 'Tester' },
        reply: async (text) => { replies.push(text); }
      });

      // Emojis & Special Chars
      let res = await clientWrapper.handleIncomingMessage(createMsg('latte 🥛 & biscotti 🍪 da coop'));
      assert.ok(res.includes('latte 🥛 & biscotti 🍪'));
      assert.ok(res.includes('coop'));

      // Very long item name
      const longName = 'x'.repeat(1000);
      res = await clientWrapper.handleIncomingMessage(createMsg(longName));
      assert.ok(res.includes(longName));

      // SQL / Script Injection Attempt
      res = await clientWrapper.handleIncomingMessage(createMsg("<script>alert('xss')</script>"));
      assert.ok(res.includes("<script>alert('xss')</script>"));
    });

    it('processes rapid-fire concurrent incoming messages cleanly', async () => {
      const items = ['pane', 'latte', 'mela', 'pera', 'formaggio', 'pasta', 'riso', 'olio', 'sale', 'pepe'];
      const replies = [];

      const requests = items.map((item, i) => {
        return clientWrapper.handleIncomingMessage({
          body: `${item} store${i % 3}`,
          from: `user${i}@c.us`,
          _data: { notifyName: `User${i}` },
          reply: async (text) => { replies.push(text); }
        });
      });

      const results = await Promise.all(requests);
      assert.equal(results.length, 10);
      assert.equal(replies.length, 10);

      const activeItems = await service.getList();
      assert.equal(activeItems.length, 10);
    });

    it('handles unexpected service errors gracefully without crashing or throwing', async () => {
      const faultService = {
        addItem: async () => { throw new Error('Database connection lost'); }
      };

      const faultWrapper = new WhatsAppClientWrapper({
        client: mockClient,
        service: faultService
      });

      let replySent = null;
      const msg = {
        body: 'cioccolato',
        from: '12345@c.us',
        reply: async (text) => { replySent = text; }
      };

      const result = await faultWrapper.handleIncomingMessage(msg);
      assert.ok(result.includes('Database connection lost'));
      assert.ok(replySent.includes('Database connection lost'));
    });
  });

  describe('3. WhatsAppBroadcaster Operational & Fallback Resilience', () => {
    it('formats reset, item added, and generic notifications accurately', async () => {
      const sentMessages = [];
      const mockClient = {
        sendMessage: async (to, text) => { sentMessages.push({ to, text }); }
      };

      const mockWrapper = {
        getStatus: () => 'READY',
        getClient: () => mockClient,
        getLastTargetChatId: () => 'family_chat_123'
      };

      const broadcaster = new WhatsAppBroadcaster(mockWrapper);

      // broadcastReset
      const resetRes = await broadcaster.broadcastReset({ store: 'ESSELUNGA', itemsCleared: 5 });
      assert.equal(resetRes.type, 'RESET');
      assert.ok(resetRes.message.includes('ESSELUNGA'));
      assert.ok(resetRes.message.includes('5 articoli'));
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].to, 'family_chat_123');

      // broadcastItemAdded
      const itemRes = await broadcaster.broadcastItemAdded({ name: 'pasta', store: 'coop' });
      assert.equal(itemRes.type, 'ITEM_ADDED');
      assert.ok(itemRes.message.includes('pasta'));
      assert.ok(itemRes.message.includes('(coop)'));
      assert.equal(sentMessages.length, 2);

      // broadcastNotification (generic)
      const genRes = await broadcaster.broadcastNotification('Attenzione: lista aggiornata', { recipient: 'user_456' });
      assert.equal(genRes.type, 'GENERIC');
      assert.equal(sentMessages[2].to, 'user_456');
    });

    it('gracefully logs warning when client is NOT ready and returns valid notification object', async () => {
      const notReadyWrapper = {
        getStatus: () => 'INITIALIZING',
        getClient: () => null,
        getLastTargetChatId: () => null
      };

      const broadcaster = new WhatsAppBroadcaster(notReadyWrapper);
      const res = await broadcaster.broadcast('Messaggio di test');

      assert.ok(res.id);
      assert.equal(res.message, 'Messaggio di test');
      assert.equal(res.recipient, 'family_chat');
    });
  });

});
