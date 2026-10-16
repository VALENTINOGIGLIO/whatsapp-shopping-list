import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppClientWrapper, extractMessageText } from '../../../src/whatsapp/whatsappClient.js';
import { ShoppingListService } from '../../../src/domain/ShoppingListService.js';
import { MockDatabaseAdapter } from '../../../src/db/MockDatabaseAdapter.js';
import { MockBroadcaster } from '../../../src/broadcaster/MockBroadcaster.js';

describe('Unit Test: WhatsAppClientWrapper Sessions & Self-Messages', () => {
  let db;
  let broadcaster;
  let service;

  beforeEach(() => {
    db = new MockDatabaseAdapter();
    broadcaster = new MockBroadcaster();
    service = new ShoppingListService(db, broadcaster);
  });

  it('correctly extracts text from diverse Baileys message shapes', () => {
    assert.equal(extractMessageText({ message: { conversation: 'hello conversation' } }), 'hello conversation');
    assert.equal(extractMessageText({ message: { extendedTextMessage: { text: 'hello extended' } } }), 'hello extended');
    assert.equal(extractMessageText({ message: { imageMessage: { caption: 'apple caption' } } }), 'apple caption');
    assert.equal(extractMessageText({ message: { videoMessage: { caption: 'video caption' } } }), 'video caption');
    assert.equal(extractMessageText({ message: { documentMessage: { caption: 'doc caption' } } }), 'doc caption');
    assert.equal(extractMessageText({ message: { ephemeralMessage: { message: { conversation: 'ephemeral text' } } } }), 'ephemeral text');
    assert.equal(extractMessageText({ message: { viewOnceMessage: { message: { conversation: 'view once text' } } } }), 'view once text');
    assert.equal(extractMessageText({ message: { buttonsResponseMessage: { selectedButtonId: 'btn_1', selectedDisplayText: 'Button 1' } } }), 'Button 1');
    assert.equal(extractMessageText({ message: { templateButtonReplyMessage: { selectedId: 'template_id' } } }), 'template_id');
    assert.equal(extractMessageText({ message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'row_1' } } } }), 'row_1');
    assert.equal(extractMessageText(null), null);
    assert.equal(extractMessageText({}), null);
  });

  it('ignores status@broadcast messages', async () => {
    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });

    const msg = {
      key: { remoteJid: 'status@broadcast', fromMe: false },
      message: { conversation: '/avvia' }
    };

    const res = await wrapper.handleIncomingMessage(msg);
    assert.equal(res, null);
  });

  it('activates session on /avvia and responds with activation message', async () => {
    const sentReplies = [];
    const mockSock = {
      sendMessage: async (to, payload) => {
        sentReplies.push({ to, text: payload.text });
        return { key: { id: 'sent_id' } };
      }
    };

    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    wrapper.sock = mockSock;

    const userJid = '39333123456@s.whatsapp.net';
    const msg = {
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/avvia' }
    };

    const res = await wrapper.handleIncomingMessage(msg);
    assert.ok(res.includes('Modalità Spesa ATTIVATA'));
    assert.ok(wrapper.activeSessions.has(userJid));
    assert.equal(sentReplies.length, 1);
    assert.equal(sentReplies[0].to, userJid);
    assert.ok(sentReplies[0].text.includes('Modalità Spesa ATTIVATA'));
  });

  it('deactivates session on /ferma and responds with deactivation message', async () => {
    const sentReplies = [];
    const mockSock = {
      sendMessage: async (to, payload) => {
        sentReplies.push({ to, text: payload.text });
        return { key: { id: 'sent_id' } };
      }
    };

    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    wrapper.sock = mockSock;

    const userJid = '39333123456@s.whatsapp.net';
    wrapper.activeSessions.add(userJid);

    const msg = {
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/ferma' }
    };

    const res = await wrapper.handleIncomingMessage(msg);
    assert.ok(res.includes('Modalità Spesa DISATTIVATA'));
    assert.ok(!wrapper.activeSessions.has(userJid));
    assert.equal(sentReplies.length, 1);
    assert.equal(sentReplies[0].to, userJid);
  });

  it('ignores plain text and ! prefix when session is NOT active', async () => {
    const sentReplies = [];
    const mockSock = {
      sendMessage: async (to, payload) => {
        sentReplies.push({ to, text: payload.text });
      }
    };

    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    wrapper.sock = mockSock;

    const userJid = '39333123456@s.whatsapp.net';

    // 1. Plain text without active session -> ignored
    const msg1 = {
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'latte' }
    };
    const res1 = await wrapper.handleIncomingMessage(msg1);
    assert.equal(res1, null);
    assert.equal(sentReplies.length, 0);

    // 2. Prefix with ! without active session -> ignored
    const msg2 = {
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '!latte @ eurospin' }
    };
    const res2 = await wrapper.handleIncomingMessage(msg2);
    assert.equal(res2, null);
    assert.equal(sentReplies.length, 0);

    const items = await service.getList(userJid);
    assert.equal(items.length, 0);
  });

  it('adds items with plain text when session IS active', async () => {
    const sentReplies = [];
    const mockSock = {
      sendMessage: async (to, payload) => {
        sentReplies.push({ to, text: payload.text });
      }
    };

    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    wrapper.sock = mockSock;

    const userJid = '39333123456@s.whatsapp.net';

    // Activate session
    await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/avvia' }
    });

    // Send plain grocery item
    const res = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'cioccolato @ conad' }
    });

    assert.ok(res.includes('Aggiunto alla lista: cioccolato (conad)'));
    const items = await service.getList(userJid);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'cioccolato');
    assert.equal(items[0].store, 'conad');
  });

  it('supports self-messages (fromMe: true) without creating infinite loops', async () => {
    const sentReplies = [];
    const mockSock = {
      sendMessage: async (to, payload) => {
        sentReplies.push({ to, text: payload.text });
      }
    };

    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    wrapper.sock = mockSock;

    const myJid = '39333999888@s.whatsapp.net';

    // 1. User sends /avvia to themselves
    const avviaMsg = {
      key: { remoteJid: myJid, fromMe: true },
      message: { conversation: '/avvia' }
    };
    const avviaRes = await wrapper.handleIncomingMessage(avviaMsg);
    assert.ok(avviaRes.includes('Modalità Spesa ATTIVATA'));
    assert.ok(wrapper.activeSessions.has(myJid));

    // 2. The bot reply itself arrives back via fromMe: true -> must be IGNORED
    const botReplyMsg = {
      key: { remoteJid: myJid, fromMe: true },
      message: { conversation: sentReplies[0].text }
    };
    const loopCheck1 = await wrapper.handleIncomingMessage(botReplyMsg);
    assert.equal(loopCheck1, null, 'Bot activation reply should be ignored for loop prevention');

    // 3. User sends item to themselves
    const itemMsg = {
      key: { remoteJid: myJid, fromMe: true },
      message: { conversation: 'biscotti' }
    };
    const itemRes = await wrapper.handleIncomingMessage(itemMsg);
    assert.ok(itemRes.includes('Aggiunto alla lista: biscotti'));

    // 4. The bot reply for item added arrives back via fromMe: true -> must be IGNORED
    const botItemReply = {
      key: { remoteJid: myJid, fromMe: true },
      message: { conversation: '✅ Aggiunto alla lista: biscotti' }
    };
    const loopCheck2 = await wrapper.handleIncomingMessage(botItemReply);
    assert.equal(loopCheck2, null, 'Bot added-item reply should be ignored for loop prevention');

    // 5. Check other bot prefixes for loop prevention (🤖, 🛒, 🏪, 📊, ❌, Spesa completata)
    const prefixes = [
      '🤖 *WhatsApp Shopping List Bot*',
      '🛒 *Shopping List / Lista della Spesa*',
      '🛒 Shopping list is empty / La lista è vuota.',
      '🏪 *Lista per Supermercati*',
      '📊 *Abitudini di Spesa*',
      '❌ Si è verificato un errore: Database error',
      'Spesa completata! La lista è stata svuotata (1 articoli).'
    ];

    for (const prefixText of prefixes) {
      const pMsg = {
        key: { remoteJid: myJid, fromMe: true },
        message: { conversation: prefixText }
      };
      const loopRes = await wrapper.handleIncomingMessage(pMsg);
      assert.equal(loopRes, null, `Prefix "${prefixText}" must be ignored for self-messages`);
    }

    // Verify only the user's item is in the list
    const items = await service.getList(myJid);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'biscotti');
  });

  it('ignores explicit commands (list, reset, habits, help) when session is not active, but processes them after /avvia', async () => {
    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });

    const userJid = '39333123456@s.whatsapp.net';

    await service.addItem(userJid, 'pasta', 'de cecco', 'user1');

    // 1. Without active session -> all ignored
    const listIgnored = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'lista' }
    });
    assert.equal(listIgnored, null);

    const helpIgnored = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'aiuto' }
    });
    assert.equal(helpIgnored, null);

    const resetIgnored = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'reset' }
    });
    assert.equal(resetIgnored, null);

    // 2. Activate session with /avvia
    const avviaRes = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/avvia' }
    });
    assert.ok(avviaRes.includes('Modalità Spesa ATTIVATA'));

    // 3. Now commands work
    const listRes = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'lista' }
    });
    assert.ok(listRes.includes('pasta'));

    const helpRes = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'aiuto' }
    });
    assert.ok(helpRes.includes('WhatsApp Shopping List Bot'));

    const resetRes = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'reset' }
    });
    assert.ok(resetRes.includes('Spesa completata'));
    const itemsAfter = await service.getList(userJid);
    assert.equal(itemsAfter.length, 0);
  });

  it('correctly processes user self-messages starting with food/item emojis without false loop drop', async () => {
    const sentReplies = [];
    const mockSock = {
      sendMessage: async (to, payload) => {
        sentReplies.push({ to, text: payload.text });
      }
    };

    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    wrapper.sock = mockSock;

    const myJid = '39333999888@s.whatsapp.net';

    // Activate session
    await wrapper.handleIncomingMessage({
      key: { remoteJid: myJid, fromMe: true },
      message: { conversation: '/avvia' }
    });

    const emojiFoodItems = [
      '🍕 pizza margherita',
      '🥛 latte parzialmente scremato',
      '🥖 pane integrale',
      '🧀 parmigiano reggiano',
      '🍎 mele fuji',
      '🍫 cioccolato fondente',
      '🍪 biscotti plasmon'
    ];

    for (const itemText of emojiFoodItems) {
      const res = await wrapper.handleIncomingMessage({
        key: { remoteJid: myJid, fromMe: true },
        message: { conversation: itemText }
      });
      assert.ok(res, `Message "${itemText}" should NOT be dropped by loop prevention`);
      assert.ok(res.startsWith('✅ Aggiunto alla lista:'));
    }

    const items = await service.getList(myJid);
    assert.equal(items.length, emojiFoodItems.length);
  });

  it('correctly extracts edited, extended, and interactive messages', async () => {
    // Protocol edited message
    const editedMsg1 = {
      key: { remoteJid: 'user1@s.whatsapp.net', fromMe: false },
      message: {
        protocolMessage: {
          editedMessage: {
            conversation: 'edited coffee'
          }
        }
      }
    };
    assert.equal(extractMessageText(editedMsg1), 'edited coffee');

    // Edited message wrapper
    const editedMsg2 = {
      key: { remoteJid: 'user1@s.whatsapp.net', fromMe: false },
      message: {
        editedMessage: {
          message: {
            extendedTextMessage: { text: 'edited milk' }
          }
        }
      }
    };
    assert.equal(extractMessageText(editedMsg2), 'edited milk');

    // Interactive response message
    const interactiveMsg = {
      key: { remoteJid: 'user1@s.whatsapp.net', fromMe: false },
      message: {
        interactiveResponseMessage: {
          body: { text: 'selected item' }
        }
      }
    };
    assert.equal(extractMessageText(interactiveMsg), 'selected item');
  });

  it('handles rapid burst of self-messages interleaved with /avvia and /ferma across multiple chats', async () => {
    const sentReplies = [];
    const mockSock = {
      sendMessage: async (to, payload) => {
        sentReplies.push({ to, text: payload.text });
      }
    };

    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    wrapper.sock = mockSock;

    const chat1 = 'group_family@g.us';
    const chat2 = 'self_me@s.whatsapp.net';

    // Chat 1 activates
    await wrapper.handleIncomingMessage({ key: { remoteJid: chat1, fromMe: false, participant: '393331@s.whatsapp.net' }, message: { conversation: '/avvia' } });
    assert.ok(wrapper.activeSessions.has(chat1));
    assert.ok(!wrapper.activeSessions.has(chat2));

    // Chat 1 adds item without prefix
    const res1 = await wrapper.handleIncomingMessage({ key: { remoteJid: chat1, fromMe: false, participant: '393331@s.whatsapp.net' }, message: { conversation: 'pasta barilla' } });
    assert.ok(res1.includes('pasta') && res1.includes('barilla'));

    // Chat 2 (inactive) sends item without prefix -> ignored
    const res2 = await wrapper.handleIncomingMessage({ key: { remoteJid: chat2, fromMe: true }, message: { conversation: 'latte' } });
    assert.equal(res2, null);

    // Chat 2 (inactive) sends with ! prefix -> also ignored because chat is not active
    const res3 = await wrapper.handleIncomingMessage({ key: { remoteJid: chat2, fromMe: true }, message: { conversation: '!latte' } });
    assert.equal(res3, null);

    // Chat 2 activates with /avvia -> now item can be added
    await wrapper.handleIncomingMessage({ key: { remoteJid: chat2, fromMe: true }, message: { conversation: '/avvia' } });
    assert.ok(wrapper.activeSessions.has(chat2));
    const res3b = await wrapper.handleIncomingMessage({ key: { remoteJid: chat2, fromMe: true }, message: { conversation: 'latte' } });
    assert.ok(res3b.includes('latte'));

    // Chat 1 stops session
    await wrapper.handleIncomingMessage({ key: { remoteJid: chat1, fromMe: false, participant: '393331@s.whatsapp.net' }, message: { conversation: '/ferma' } });
    assert.ok(!wrapper.activeSessions.has(chat1));

    // Chat 1 sends item without prefix -> now ignored
    const res4 = await wrapper.handleIncomingMessage({ key: { remoteJid: chat1, fromMe: false, participant: '393331@s.whatsapp.net' }, message: { conversation: 'pomodori' } });
    assert.equal(res4, null);
  });

  it('handles prefixed /avvia and /ferma variations (!/avvia, !avvia, !/ferma, !ferma)', async () => {
    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    const mockSock = {
      sendMessage: async () => ({})
    };
    wrapper.sock = mockSock;
    const chatJid = 'test_chat@s.whatsapp.net';

    // 1. !/avvia
    const r1 = await wrapper.handleIncomingMessage({
      key: { remoteJid: chatJid, fromMe: false },
      message: { conversation: '!/avvia' }
    });
    assert.ok(r1.includes('Modalità Spesa ATTIVATA'));
    assert.ok(wrapper.activeSessions.has(chatJid));

    // 2. !/ferma
    const r2 = await wrapper.handleIncomingMessage({
      key: { remoteJid: chatJid, fromMe: false },
      message: { conversation: '!/ferma' }
    });
    assert.ok(r2.includes('Modalità Spesa DISATTIVATA'));
    assert.ok(!wrapper.activeSessions.has(chatJid));

    // 3. !avvia
    const r3 = await wrapper.handleIncomingMessage({
      key: { remoteJid: chatJid, fromMe: false },
      message: { conversation: '!avvia' }
    });
    assert.ok(r3.includes('Modalità Spesa ATTIVATA'));
    assert.ok(wrapper.activeSessions.has(chatJid));

    // 4. !ferma
    const r4 = await wrapper.handleIncomingMessage({
      key: { remoteJid: chatJid, fromMe: false },
      message: { conversation: '!ferma' }
    });
    assert.ok(r4.includes('Modalità Spesa DISATTIVATA'));
    assert.ok(!wrapper.activeSessions.has(chatJid));
  });

  it('recursively unrolls multi-nested message wrappers (ephemeral + edited + viewOnce)', () => {
    const deepMsg = {
      message: {
        ephemeralMessage: {
          message: {
            viewOnceMessageV2: {
              message: {
                protocolMessage: {
                  editedMessage: {
                    conversation: 'deeply nested grocery item'
                  }
                }
              }
            }
          }
        }
      }
    };

    assert.equal(extractMessageText(deepMsg), 'deeply nested grocery item');
  });

  it('correctly suppresses broadcaster un-emojified messages (Aggiunto alla lista) in self chat', async () => {
    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: true
    });
    const myJid = '39333999888@s.whatsapp.net';

    const broadcasterMsg = {
      key: { remoteJid: myJid, fromMe: true },
      message: { conversation: 'Aggiunto alla lista: latte (eurospin)' }
    };

    const res = await wrapper.handleIncomingMessage(broadcasterMsg);
    assert.equal(res, null, 'Un-emojified item added broadcast must be ignored in self chat');
  });

  it('supports native flow response messages and template button clicks', async () => {
    const nativeFlowMsg = {
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ id: 'reset' })
          }
        }
      }
    };
    assert.equal(extractMessageText(nativeFlowMsg), 'reset');

    const templateMsg = {
      message: {
        templateButtonReplyMessage: {
          selectedDisplayText: 'lista'
        }
      }
    };
    assert.equal(extractMessageText(templateMsg), 'lista');
  });

  it('correctly handles slash commands (/help, /lista, /reset, /habits)', async () => {
    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: true
    });
    const userJid = '39333123456@s.whatsapp.net';

    await service.addItem(userJid, 'biscotti', 'coop', 'user');

    // /help
    const helpRes = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/help' }
    });
    assert.ok(helpRes.includes('WhatsApp Shopping List Bot'));

    // /lista
    const listRes = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/lista' }
    });
    assert.ok(listRes.includes('biscotti'));

    // /habits
    const habitsRes = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/habits biscotti' }
    });
    assert.ok(habitsRes.includes('biscotti'));

    // /reset
    const resetRes = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/reset' }
    });
    assert.ok(resetRes.includes('Spesa completata'));
    const items = await service.getList(userJid);
    assert.equal(items.length, 0);
  });

  it('correctly displays grouped store list on "lista supermercati" or "/lista supermercati"', async () => {
    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: true
    });
    const userJid = '39333123456@s.whatsapp.net';

    await service.addItem(userJid, 'pasta', 'barilla', 'user');
    await service.addItem(userJid, 'mele', 'coop', 'user');

    const res1 = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: 'lista supermercati' }
    });
    assert.ok(res1.includes('Lista per Supermercati'));

    const res2 = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/lista supermercati' }
    });
    assert.ok(res2.includes('Lista per Supermercati'));
  });

  it('handles /start, /stop, and spaced ! avvia commands properly', async () => {
    const wrapper = new WhatsAppClientWrapper({
      service,
      allowSelfMessages: true,
      defaultActive: false
    });
    const mockSock = { sendMessage: async () => ({}) };
    wrapper.sock = mockSock;
    const userJid = '39333123456@s.whatsapp.net';

    // /start
    const r1 = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/start' }
    });
    assert.ok(r1.includes('Modalità Spesa ATTIVATA'));
    assert.ok(wrapper.activeSessions.has(userJid));

    // /stop
    const r2 = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '/stop' }
    });
    assert.ok(r2.includes('Modalità Spesa DISATTIVATA'));
    assert.ok(!wrapper.activeSessions.has(userJid));

    // ! avvia
    const r3 = await wrapper.handleIncomingMessage({
      key: { remoteJid: userJid, fromMe: false },
      message: { conversation: '! avvia' }
    });
    assert.ok(r3.includes('Modalità Spesa ATTIVATA'));
    assert.ok(wrapper.activeSessions.has(userJid));
  });

  it('extracts text from arbitrary nested m.message objects and native flow titles', () => {
    const nestedMsg = {
      message: {
        message: {
          message: {
            conversation: 'deep arbitrary wrapper'
          }
        }
      }
    };
    assert.equal(extractMessageText(nestedMsg), 'deep arbitrary wrapper');

    const nativeFlowTitleMsg = {
      message: {
        interactiveResponseMessage: {
          nativeFlowResponseMessage: {
            paramsJson: JSON.stringify({ text: 'button clicked' })
          }
        }
      }
    };
    assert.equal(extractMessageText(nativeFlowTitleMsg), 'button clicked');
  });

  it('persists session activation and deactivation to database and auto-restores on loadActiveSessions', async () => {
    const mockDb = new MockDatabaseAdapter();
    const svc = new ShoppingListService(mockDb);
    const wrapper = new WhatsAppClientWrapper({
      service: svc,
      allowSelfMessages: true,
      defaultActive: false,
      activeSessions: []
    });

    const testChat = 'test_chat_persistence@g.us';

    // 1. /avvia activates and saves to db
    await wrapper.handleIncomingMessage({
      key: { remoteJid: testChat, fromMe: false },
      message: { conversation: '/avvia' }
    });
    assert.ok(wrapper.activeSessions.has(testChat));
    const sessionDoc1 = await mockDb.getChatSession(testChat);
    assert.equal(sessionDoc1.active, true);

    // 2. Simulate new process / reboot: create a new wrapper and call loadActiveSessions()
    const newWrapper = new WhatsAppClientWrapper({
      service: svc,
      allowSelfMessages: true,
      defaultActive: false,
      activeSessions: []
    });
    await newWrapper.loadActiveSessions();
    assert.ok(newWrapper.activeSessions.has(testChat));
    assert.ok(newWrapper.activeSessions.has('120363410246350492@g.us'));

    // 3. /ferma deactivates and saves to db
    await newWrapper.handleIncomingMessage({
      key: { remoteJid: testChat, fromMe: false },
      message: { conversation: '/ferma' }
    });
    assert.ok(!newWrapper.activeSessions.has(testChat));
    const sessionDoc2 = await mockDb.getChatSession(testChat);
    assert.equal(sessionDoc2.active, false);
  });
});


