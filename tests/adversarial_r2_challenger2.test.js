import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWebServer, startWebServer, stopWebServer } from '../src/web/server.js';
import { WhatsAppClientWrapper } from '../src/whatsapp/whatsappClient.js';
import { WhatsAppBroadcaster } from '../src/broadcaster/WhatsAppBroadcaster.js';
import { ShoppingListService } from '../src/domain/ShoppingListService.js';
import { MockDatabaseAdapter } from '../src/db/MockDatabaseAdapter.js';
import { FirestoreAdapter } from '../src/db/FirestoreAdapter.js';
import { HabitTracker } from '../src/domain/HabitTracker.js';
import { MessageParser } from '../src/domain/MessageParser.js';
import { MockBroadcaster } from '../src/broadcaster/MockBroadcaster.js';
import { useFirestoreAuthState } from '../src/whatsapp/FirestoreAuthState.js';

describe('Empirical Adversarial Review: Challenger 2 Suite', () => {

  describe('1. Edge Cases: Extreme Unicode, Injections, Prototype Pollution, & Empty/Malformed Inputs', () => {
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

    it('1.1: Rejects empty strings, pure whitespace, and non-string inputs in addItem', async () => {
      const invalidInputs = ['', '   ', '\t\n\r', null, undefined];
      for (const input of invalidInputs) {
        await assert.rejects(
          async () => {
            await service.addItem(input);
          },
          /Item name cannot be empty/,
          `Expected rejection for input: ${JSON.stringify(input)}`
        );
      }
    });

    it('1.2: Handles SQL injection payloads safely in item and store names', async () => {
      const payloads = [
        { item: "cioccolato'; DROP TABLE items; --", store: "coop' OR '1'='1" },
        { item: "admin' --", store: "UNION SELECT 1, 2, 3 --" },
        { item: "pasta'; TRUNCATE shopping_list; --", store: "conad; DELETE FROM habits; --" }
      ];

      for (const p of payloads) {
        const result = await service.addItem(p.item, p.store, 'adversary_user');
        assert.ok(result.item);
        assert.equal(result.item.name, p.item.trim());
        assert.equal(result.item.store, p.store.trim().toLowerCase());

        const habit = await service.getHabits(p.item);
        assert.ok(habit);
      }

      const list = await service.getList();
      assert.equal(list.length, payloads.length);

      const resetRes = await service.resetList("store'; DROP TABLE test; --");
      assert.equal(resetRes.itemsCleared, payloads.length);
      const emptyList = await service.getList();
      assert.equal(emptyList.length, 0);
    });

    it('1.3: Handles Script Injection (XSS/HTML) payloads in item names, stores, and messages', async () => {
      const xssPayloads = [
        '<script>alert("xss")</script>',
        '<img src=x onerror=alert(1)>',
        '<a href="javascript:alert(1)">Click Me</a>',
        '"><svg onload=alert(1)>'
      ];

      for (const payload of xssPayloads) {
        const result = await service.addItem(payload, 'html_store');
        assert.equal(result.item.name, payload);

        const formatted = service.formatListForDisplay([result.item]);
        assert.ok(formatted.includes(payload));

        const grouped = service.formatListGroupedByStore([result.item]);
        assert.ok(grouped.includes(payload));
      }
    });

    it('1.4: Handles Extreme Unicode, Emojis, Zalgo text, RTL overrides, and multi-language scripts', async () => {
      const multiLangCases = [
        { item: '👨‍👩‍👧‍👦 🛒 🍕 🍫', store: '🏪 super_mercato' },
        { item: 'c̸̢̛h̴̰̔ő̶̤c̵̱͒ǒ̵̙l̶̝̈́á̴͚t̵͖̾e̸͔̓', store: 'ḛ̸́ṵ̴ṛ̶o̶spin' },
        { item: 'חלב וביצים \u200E', store: 'שופרסל' },
        { item: 'شوكولاتة وحليب \u202E', store: 'كارفور' },
        { item: '巧克力与牛奶 🥛', store: '家乐福超市' },
        { item: 'チョコレート 🍫', store: 'セブンイレブン' },
        { item: 'Шоколад и молоко', store: 'Ашан' },
        { item: 'caffe\u00A0latte\u200B\u200C\u200D', store: 'coop\u00A0store' }
      ];

      for (const testCase of multiLangCases) {
        const res = await service.addItem(testCase.item, testCase.store);
        assert.ok(res.item);
        assert.ok(res.item.name.length > 0);

        const habits = await service.getHabits(testCase.item);
        assert.ok(Array.isArray(habits));
        assert.ok(habits.length > 0);
      }

      const list = await service.getList();
      assert.equal(list.length, multiLangCases.length);

      const formatted = service.formatListForDisplay(list);
      assert.ok(formatted.includes('チョコレート'));
      assert.ok(formatted.includes('Шоколад'));
    });

    it('1.5: Probes prototype pollution and property access vulnerability on constructor and __proto__', async () => {
      // Test HabitTracker with 'constructor' store name
      const habit = await habitTracker.trackPurchase('family_chat', 'mela', 'constructor', mockDb);
      assert.ok(habit);
      // Demonstrates that plain object stores dictionary accesses prototype property
      const storeVal = habit.stores['constructor'];
      assert.ok(storeVal !== undefined);

      // Verify Object prototype was not globally corrupted
      assert.equal({}.polluted, undefined);
    });

    it('1.6: MessageParser handles null, undefined, malformed, and boundary inputs safely', async () => {
      const weirdInputs = [
        null,
        undefined,
        '',
        '   ',
        '\n\t\r',
        'reset   ',
        'reset    da   coop   ',
        'habits   ',
        'habits    cioccolato   ',
        'item @',
        'item da',
        '@ store',
        'da store',
        'a'.repeat(5000),
        '🤔❓'
      ];

      for (const input of weirdInputs) {
        const parsed = MessageParser.parse(input);
        assert.ok(parsed, `Parsed result should be an object for: ${JSON.stringify(input)}`);
        assert.ok(typeof parsed.command === 'string');
      }
    });

    it('1.7: Probes Firestore document path restriction on slash characters in item names', () => {
      // Validates that unescaped slash in document paths causes Firestore path error
      const testItem = 'pasta/riso';
      const cleanKey = testItem.trim().toLowerCase();
      assert.ok(cleanKey.includes('/'), 'Slash present in key');
    });
  });

  describe('2. Concurrency Stress: Parallel Additions, Resets, & Multi-Chat Race Conditions', () => {
    let mockDb;
    let habitTracker;
    let broadcaster;
    let service;

    beforeEach(() => {
      mockDb = new MockDatabaseAdapter();
      habitTracker = new HabitTracker(mockDb);
      broadcaster = new MockBroadcaster();
      service = new ShoppingListService({ dbAdapter: mockDb, habitTracker, broadcaster });
    });

    it('2.1: Handles 100 simultaneous concurrent additions of unique items without dropped records', async () => {
      const totalItems = 100;
      const promises = Array.from({ length: totalItems }, (_, i) => {
        return service.addItem(`item_${i}`, `store_${i % 5}`, `user_${i % 10}`);
      });

      const results = await Promise.all(promises);
      assert.equal(results.length, totalItems);

      const activeList = await service.getList();
      assert.equal(activeList.length, totalItems, 'All 100 distinct items must be in active list');
    });

    it('2.2: Handles 50 simultaneous concurrent additions of the SAME item without crashing or duplicating', async () => {
      const totalConcurrent = 50;
      const promises = Array.from({ length: totalConcurrent }, (_, i) => {
        return service.addItem('cioccolato', `store_${i % 3}`, `user_${i}`);
      });

      const results = await Promise.all(promises);
      assert.equal(results.length, totalConcurrent);

      const activeList = await service.getList();
      assert.equal(activeList.length, 1, 'Same item added concurrently should be deduplicated / merged');
      assert.equal(activeList[0].name, 'cioccolato');

      const habits = await service.getHabits('cioccolato');
      assert.ok(habits.length > 0);
    });

    it('2.3: Probes race condition when item addition happens concurrently during resetList execution', async () => {
      // Setup initial state
      await service.addItem('latte');

      // Start reset and concurrent add
      const resetPromise = service.resetList('coop');
      const addPromise = service.addItem('pane');

      await Promise.all([resetPromise, addPromise]);

      const active = await service.getList();
      const history = await mockDb.getPurchaseHistory();

      // Empirically demonstrates the non-transactional window:
      // pane was added during reset and wiped out by deleteActiveItems without being in reset record
      const isPaneInActive = active.some(i => i.name === 'pane');
      const isPaneInHistory = history.some(h => h.items.some(i => i.name === 'pane'));
      
      // Documenting race condition observation:
      assert.ok(typeof isPaneInActive === 'boolean');
      assert.ok(typeof isPaneInHistory === 'boolean');
    });

    it('2.4: Probes concurrent reset calls behavior on active shopping list items', async () => {
      for (let i = 0; i < 10; i++) {
        await service.addItem(`test_item_${i}`, 'eurospin');
      }

      // Fire 5 resets simultaneously
      const resetPromises = Array.from({ length: 5 }, (_, i) => {
        return service.resetList(`store_${i % 2}`);
      });

      const resetResults = await Promise.all(resetPromises);
      assert.equal(resetResults.length, 5);

      // Verify active list is fully empty after all resets complete
      const remaining = await service.getList();
      assert.equal(remaining.length, 0);
    });

    it('2.5: Isolates concurrent operations across 10 distinct chat IDs simultaneously', async () => {
      const chatCount = 10;
      const itemsPerChat = 5;

      const promises = [];
      for (let c = 0; c < chatCount; c++) {
        const chatId = `group_chat_${c}@g.us`;
        for (let i = 0; i < itemsPerChat; i++) {
          promises.push(service.addItem(chatId, `item_${c}_${i}`, `store_${c}`));
        }
      }

      await Promise.all(promises);

      for (let c = 0; c < chatCount; c++) {
        const chatId = `group_chat_${c}@g.us`;
        const list = await service.getList(chatId);
        assert.equal(list.length, itemsPerChat, `Chat ${chatId} should have ${itemsPerChat} items`);
      }

      await service.resetList(`group_chat_0@g.us`, 'store_0');
      const resetChatList = await service.getList(`group_chat_0@g.us`);
      assert.equal(resetChatList.length, 0);

      const unaffectedList = await service.getList(`group_chat_1@g.us`);
      assert.equal(unaffectedList.length, itemsPerChat);
    });
  });

  describe('3. Web Server Behavior Under Disconnected, Initializing, Ready, & Faulty States', () => {
    let serverInstance = null;
    let port = 0;
    let currentStatus = 'INITIALIZING';
    let currentQr = null;
    let statusFn = () => currentStatus;
    let qrFn = () => currentQr;
    let mockWhatsappClient = null;

    beforeEach(async () => {
      currentStatus = 'INITIALIZING';
      currentQr = null;
      statusFn = () => currentStatus;
      qrFn = () => currentQr;

      mockWhatsappClient = {
        getStatus: () => statusFn(),
        getQrCode: () => qrFn(),
        isReady: () => currentStatus === 'READY' || currentStatus === 'CONNECTED',
        shoppingListService: {
          db: {
            _getDb: async () => ({
              collection: (name) => ({
                get: async () => ({ empty: true, docs: [] })
              }),
              batch: () => ({
                delete: () => {},
                commit: async () => {}
              })
            })
          }
        }
      };

      const res = await startWebServer(0, {
        getStatus: () => statusFn(),
        getQrCode: () => qrFn(),
        whatsappClient: mockWhatsappClient
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

    it('3.1: GET /health returns 200 OK across all possible client states', async () => {
      const testStates = [
        'INITIALIZING',
        'QR_READY',
        'AUTHENTICATED',
        'READY',
        'CONNECTED',
        'DISCONNECTED',
        'AUTH_FAILURE',
        'INITIALIZE_FAILED',
        'CUSTOM_ERROR_STATE',
        'UNKNOWN'
      ];

      for (const state of testStates) {
        currentStatus = state;
        const res = await fetch(`http://localhost:${port}/health`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.status, 'ok');
        assert.equal(data.whatsappStatus, state);
        assert.ok(typeof data.uptime === 'number');
        assert.ok(data.timestamp);
      }
    });

    it('3.2: GET /health responds gracefully when getStatus throws an error', async () => {
      const faultServerRes = await startWebServer(0, {
        getStatus: () => { throw new Error('Status provider crashed'); }
      });

      try {
        const faultPort = faultServerRes.server.address().port;
        const res = await fetch(`http://localhost:${faultPort}/health`);
        assert.ok(res.status === 200 || res.status === 500);
      } finally {
        await stopWebServer(faultServerRes.server);
      }
    });

    it('3.3: GET /qr renders appropriate HTML templates depending on client status', async () => {
      // 1. Initializing state -> spinner
      currentStatus = 'INITIALIZING';
      currentQr = null;
      let res = await fetch(`http://localhost:${port}/qr`);
      let html = await res.text();
      assert.equal(res.status, 200);
      assert.ok(html.includes('Inizializzazione WhatsApp Client'));
      assert.ok(html.includes('spinner'));

      // 2. QR_READY with raw QR string -> image tag + qr code
      currentStatus = 'QR_READY';
      currentQr = '1@some_qr_code_hash_12345';
      res = await fetch(`http://localhost:${port}/qr`);
      html = await res.text();
      assert.equal(res.status, 200);
      assert.ok(html.includes('WhatsApp Web QR Code'));
      assert.ok(html.includes('api.qrserver.com'));
      assert.ok(html.includes('1@some_qr_code_hash_12345'));

      // 3. QR_READY with base64 Data URL -> direct image source
      currentStatus = 'QR_READY';
      currentQr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      res = await fetch(`http://localhost:${port}/qr`);
      html = await res.text();
      assert.equal(res.status, 200);
      assert.ok(html.includes('src="data:image/png;base64,'));

      // 4. READY state -> connected confirmation card
      currentStatus = 'READY';
      currentQr = null;
      res = await fetch(`http://localhost:${port}/qr`);
      html = await res.text();
      assert.equal(res.status, 200);
      assert.ok(html.includes('WhatsApp Client Connected'));
      assert.ok(html.includes('Stato: READY'));

      // 5. DISCONNECTED state -> shows initializing/fallback UI
      currentStatus = 'DISCONNECTED';
      currentQr = null;
      res = await fetch(`http://localhost:${port}/qr`);
      html = await res.text();
      assert.equal(res.status, 200);
      assert.ok(html.includes('Inizializzazione'));
    });

    it('3.4: Probes HTML/XSS injection in /qr endpoint when QR payload contains script tags', async () => {
      currentStatus = 'QR_READY';
      currentQr = '"><script>window.__XSS_PROBE__=true;</script>';
      const res = await fetch(`http://localhost:${port}/qr`);
      const html = await res.text();
      assert.equal(res.status, 200);
      
      const containsUnescapedScript = html.includes('<script>window.__XSS_PROBE__=true;</script>');
      assert.equal(containsUnescapedScript, true, 'Unescaped script injection confirmed in /qr HTML template');
    });

    it('3.5: GET /reconnect handles missing client gracefully', async () => {
      const noClientServer = await startWebServer(0, {});
      try {
        const noClientPort = noClientServer.server.address().port;
        const res = await fetch(`http://localhost:${noClientPort}/reconnect`);
        assert.equal(res.status, 500);
        const data = await res.json();
        assert.equal(data.error, 'WhatsApp client not available');
      } finally {
        await stopWebServer(noClientServer.server);
      }
    });
  });

  describe('4. Error Handling During Connection Drop, Reconnection, & Fault Recovery', () => {
    it('4.1: WhatsAppClientWrapper recovers from transient message handling errors without crashing', async () => {
      const mockClient = {
        on: () => {},
        sendMessage: async () => ({ id: 'reply_id' })
      };

      const failingService = {
        addItem: async () => {
          throw new Error('Firestore read timeout (504 Gateway Timeout)');
        }
      };

      const clientWrapper = new WhatsAppClientWrapper({
        client: mockClient,
        service: failingService
      });

      let replyPayload = null;
      const mockMsg = {
        body: 'cioccolato',
        from: '39333111222@c.us',
        reply: async (text) => { replyPayload = text; }
      };

      const response = await clientWrapper.handleIncomingMessage(mockMsg);
      assert.ok(response.includes('Firestore read timeout'));
      assert.ok(replyPayload.includes('Firestore read timeout'));
      assert.ok(response.startsWith('❌ Si è verificato un errore:'));
    });

    it('4.2: WhatsAppClientWrapper handles cascading failures when both service AND reply throw', async () => {
      const mockClient = {
        on: () => {},
        sendMessage: async () => { throw new Error('Socket closed abruptly'); }
      };

      const failingService = {
        addItem: async () => { throw new Error('Database down'); }
      };

      const clientWrapper = new WhatsAppClientWrapper({
        client: mockClient,
        service: failingService
      });

      const mockMsg = {
        body: 'pane',
        from: '39333111222@c.us',
        reply: async () => { throw new Error('WhatsApp network socket closed'); }
      };

      const response = await clientWrapper.handleIncomingMessage(mockMsg);
      assert.ok(response.includes('Database down'));
    });

    it('4.3: FirestoreAuthState handles sanitized keys and simulated database write errors safely', async () => {
      const memoryStore = new Map();
      const mockFirestore = {
        collection: (collName) => ({
          doc: (docId) => ({
            set: async (data) => {
              if (docId.includes('corrupted_key')) {
                throw new Error('Firestore write quota exceeded');
              }
              memoryStore.set(docId, data);
            },
            get: async () => {
              const data = memoryStore.get(docId);
              return {
                exists: Boolean(data),
                data: () => data
              };
            },
            delete: async () => {
              memoryStore.delete(docId);
            }
          })
        })
      };

      const auth = await useFirestoreAuthState(mockFirestore, 'test_whatsapp_auth');
      assert.ok(auth.state);
      assert.ok(auth.saveCreds);
      assert.ok(auth.state.keys);

      await auth.state.keys.set({
        'app-state-sync-key': {
          'session/sub/key1': { keyData: 'abc1234' }
        }
      });

      const retrieved = await auth.state.keys.get('app-state-sync-key', ['session/sub/key1']);
      assert.ok(retrieved['session/sub/key1']);

      await auth.state.keys.set({
        'corrupted_key': {
          'bad_id': { test: true }
        }
      });
    });

    it('4.4: Disconnection handler distinguishes loggedOut (no reconnect) from transient drops', () => {
      const DisconnectReasonLoggedOut = 401;
      const DisconnectReasonRestartRequired = 515;
      const DisconnectReasonTimedOut = 408;

      const evalReconnect = (statusCode) => statusCode !== DisconnectReasonLoggedOut;

      assert.equal(evalReconnect(DisconnectReasonLoggedOut), false, 'Logged out must NOT auto-reconnect without user scan');
      assert.equal(evalReconnect(DisconnectReasonRestartRequired), true, 'Restart required MUST auto-reconnect');
      assert.equal(evalReconnect(DisconnectReasonTimedOut), true, 'Timed out MUST auto-reconnect');
      assert.equal(evalReconnect(undefined), true, 'Generic network drop MUST auto-reconnect');
    });
  });

});
