import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WhatsAppClientWrapper } from '../../src/whatsapp/whatsappClient.js';
import { WhatsAppBroadcaster } from '../../src/broadcaster/WhatsAppBroadcaster.js';
import { ShoppingListService } from '../../src/domain/ShoppingListService.js';
import { MockDatabaseAdapter } from '../../src/db/MockDatabaseAdapter.js';

class MockClient extends EventEmitter {
  constructor() {
    super();
    this.initialize = async () => {};
    this.destroy = async () => {};
    this.sentMessages = [];
    this.shouldThrowOnSend = false;
    this.sendMessage = async (to, text) => {
      if (this.shouldThrowOnSend) {
        throw new Error('Network error: Failed to send WhatsApp message');
      }
      const record = { id: `msg_${Date.now()}`, to, text };
      this.sentMessages.push(record);
      return record;
    };
  }
}

async function runEmpiricalTests() {
  console.log('🧪 Starting Empirical Verification for WhatsApp Client Lifecycle & Broadcaster...');
  let totalTests = 0;
  let passedTests = 0;

  function runTest(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✔ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}:`, err.message);
    }
  }

  async function runAsyncTest(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✔ [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✖ [FAIL] ${name}:`, err.message);
    }
  }

  // ==========================================
  // SECTION 1: Lifecycle Event Transitions
  // ==========================================
  console.log('\n--- 1. Testing WhatsAppClientWrapper Lifecycle & State Transitions ---');

  runTest('Initial state is INITIALIZING with null QR code', () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    assert.equal(wrapper.getStatus(), 'INITIALIZING');
    assert.equal(wrapper.getQrCode(), null);
    assert.equal(wrapper.isReady(), false);
  });

  runTest('Transition: qr event -> QR_READY state and stores qrCode string', () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('qr', 'QR_DATA_ABC_123');
    assert.equal(wrapper.getStatus(), 'QR_READY');
    assert.equal(wrapper.getQrCode(), 'QR_DATA_ABC_123');
    assert.equal(wrapper.isReady(), false);
    assert.ok(wrapper.lastQrTimestamp > 0);
  });

  runTest('Transition: authenticated event -> AUTHENTICATED state and clears qrCode', () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('qr', 'QR_DATA_ABC_123');
    mockClient.emit('authenticated');
    assert.equal(wrapper.getStatus(), 'AUTHENTICATED');
    assert.equal(wrapper.getQrCode(), null);
    assert.equal(wrapper.isReady(), false);
  });

  runTest('Transition: ready event -> READY state', () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('qr', 'QR_DATA_ABC_123');
    mockClient.emit('authenticated');
    mockClient.emit('ready');
    assert.equal(wrapper.getStatus(), 'READY');
    assert.equal(wrapper.getQrCode(), null);
    assert.equal(wrapper.isReady(), true);
  });

  runTest('Transition: disconnected event -> DISCONNECTED state and clears qrCode', () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('ready');
    mockClient.emit('disconnected', 'NAVIGATION');
    assert.equal(wrapper.getStatus(), 'DISCONNECTED');
    assert.equal(wrapper.getQrCode(), null);
    assert.equal(wrapper.isReady(), false);
  });

  runTest('Transition: auth_failure event -> AUTH_FAILURE state', () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('auth_failure', 'Session revoked');
    assert.equal(wrapper.getStatus(), 'AUTH_FAILURE');
    assert.equal(wrapper.isReady(), false);
  });

  runTest('Re-authentication loop transition (DISCONNECTED -> qr -> authenticated -> ready)', () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('ready');
    mockClient.emit('disconnected', 'RESTART');
    assert.equal(wrapper.getStatus(), 'DISCONNECTED');

    mockClient.emit('qr', 'NEW_QR_CODE_456');
    assert.equal(wrapper.getStatus(), 'QR_READY');
    assert.equal(wrapper.getQrCode(), 'NEW_QR_CODE_456');

    mockClient.emit('authenticated');
    assert.equal(wrapper.getStatus(), 'AUTHENTICATED');
    assert.equal(wrapper.getQrCode(), null);

    mockClient.emit('ready');
    assert.equal(wrapper.getStatus(), 'READY');
    assert.equal(wrapper.isReady(), true);
  });

  // ==========================================
  // SECTION 2: WhatsAppBroadcaster Edge Cases
  // ==========================================
  console.log('\n--- 2. Testing WhatsAppBroadcaster Error Handling & Edge Cases ---');

  await runAsyncTest('Empty clientWrapper handles broadcast gracefully without throwing', async () => {
    const broadcaster = new WhatsAppBroadcaster(null);
    const result = await broadcaster.broadcast('Test message');
    assert.equal(result.message, 'Test message');
    assert.equal(result.recipient, 'family_chat');
    assert.ok(result.id);
  });

  await runAsyncTest('Non-READY clientWrapper logs warning and returns notification object without throwing', async () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('qr', 'MOCK_QR');

    const broadcaster = new WhatsAppBroadcaster(wrapper);
    const result = await broadcaster.broadcast('Pending notification');
    assert.equal(result.message, 'Pending notification');
    assert.equal(mockClient.sentMessages.length, 0);
  });

  await runAsyncTest('Client.sendMessage throwing network error is caught gracefully without propagating error', async () => {
    const mockClient = new MockClient();
    mockClient.shouldThrowOnSend = true;
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('ready');

    const broadcaster = new WhatsAppBroadcaster(wrapper);
    const result = await broadcaster.broadcast('Critical Alert');
    assert.equal(result.message, 'Critical Alert');
    assert.ok(result.id);
  });

  await runAsyncTest('Empty resetRecord (0 items, null store) formatted correctly', async () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('ready');

    const broadcaster = new WhatsAppBroadcaster(wrapper, { defaultRecipient: 'group_123' });
    const resetRecord = { store: null, itemsCleared: 0 };
    const result = await broadcaster.broadcastReset(resetRecord);

    assert.equal(result.type, 'RESET');
    assert.equal(result.message, 'Spesa completata! La lista è stata svuotata (0 articoli).');
    assert.equal(mockClient.sentMessages[0].text, 'Spesa completata! La lista è stata svuotata (0 articoli).');
    assert.equal(mockClient.sentMessages[0].to, 'group_123');
  });

  await runAsyncTest('broadcastItemAdded without store', async () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('ready');

    const broadcaster = new WhatsAppBroadcaster(wrapper, { defaultRecipient: 'group_123' });
    const item = { name: 'Pane' };
    const result = await broadcaster.broadcastItemAdded(item);

    assert.equal(result.type, 'ITEM_ADDED');
    assert.equal(result.message, 'Aggiunto alla lista: Pane');
    assert.equal(mockClient.sentMessages[0].text, 'Aggiunto alla lista: Pane');
  });

  await runAsyncTest('broadcastNotification with empty options falls back safely', async () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    mockClient.emit('ready');

    const broadcaster = new WhatsAppBroadcaster(wrapper);
    const result = await broadcaster.broadcastNotification('Custom notice');

    assert.equal(result.type, 'GENERIC');
    assert.equal(result.messageText, 'Custom notice');
  });

  await runAsyncTest('Target recipient resolution hierarchy (explicit -> default -> lastTarget -> fallback)', async () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });

    // 1. Fallback 'family_chat' when nothing set
    const b1 = new WhatsAppBroadcaster(wrapper);
    const r1 = await b1.broadcast('msg1');
    assert.equal(r1.recipient, 'family_chat');

    // 2. lastTargetChatId from wrapper when set
    wrapper.setTargetChatId('chat_from_last_msg@g.us');
    const r2 = await b1.broadcast('msg2');
    assert.equal(r2.recipient, 'chat_from_last_msg@g.us');

    // 3. defaultRecipient override
    const b2 = new WhatsAppBroadcaster(wrapper, { defaultRecipient: 'default_chat@g.us' });
    const r3 = await b2.broadcast('msg3');
    assert.equal(r3.recipient, 'default_chat@g.us');

    // 4. Explicit recipient override
    const r4 = await b2.broadcast('msg4', 'explicit_chat@g.us');
    assert.equal(r4.recipient, 'explicit_chat@g.us');
  });

  // ==========================================
  // SECTION 3: Incoming Message Edge Cases
  // ==========================================
  console.log('\n--- 3. Testing Message Handling Edge Cases & Exception Safety ---');

  await runAsyncTest('Incoming message with null or invalid body returns null safely', async () => {
    const mockClient = new MockClient();
    const wrapper = new WhatsAppClientWrapper({ client: mockClient, showTerminalQr: false });
    assert.equal(await wrapper.handleIncomingMessage(null), null);
    assert.equal(await wrapper.handleIncomingMessage({ body: null }), null);
    assert.equal(await wrapper.handleIncomingMessage({ body: 12345 }), null);
  });

  await runAsyncTest('Double error in msg.reply when reply fails on initial send and error send', async () => {
    const mockClient = new MockClient();
    const db = new MockDatabaseAdapter();
    const service = new ShoppingListService(db);
    const wrapper = new WhatsAppClientWrapper({
      client: mockClient,
      service,
      showTerminalQr: false
    });

    let replyCalls = 0;
    const msgWithFailingReply = {
      from: '123@c.us',
      fromMe: false,
      body: 'pane',
      reply: async () => {
        replyCalls++;
        throw new Error('Reply socket disconnected');
      }
    };

    try {
      await wrapper.handleIncomingMessage(msgWithFailingReply);
      assert.fail('Expected exception from double failing msg.reply');
    } catch (err) {
      assert.equal(err.message, 'Reply socket disconnected');
      assert.equal(replyCalls, 2, 'Should attempt reply in try and reply in catch');
    }
  });

  console.log(`\n==========================================`);
  console.log(`Empirical Verification Summary: ${passedTests}/${totalTests} tests passed.`);
  console.log(`==========================================`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runEmpiricalTests();
