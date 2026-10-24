import { DatabaseAdapter } from './DatabaseAdapter.js';

export class MockDatabaseAdapter extends DatabaseAdapter {
  constructor(initialData = {}) {
    super();
    this.activeItems = {}; // { chatId: [] }
    this.habits = {}; // { chatId: Map }
    this.history = {}; // { chatId: [] }
    this.chatSessions = {}; // { chatId: { active: boolean, updatedAt: string } }

    if (initialData && typeof initialData === 'object') {
      if (initialData.activeItems) {
        if (Array.isArray(initialData.activeItems)) {
          this.activeItems['family_chat'] = [...initialData.activeItems];
        } else if (typeof initialData.activeItems === 'object') {
          for (const [cid, items] of Object.entries(initialData.activeItems)) {
            this.activeItems[cid] = Array.isArray(items) ? [...items] : [];
          }
        }
      }

      if (initialData.habits) {
        if (Array.isArray(initialData.habits)) {
          const map = new Map();
          initialData.habits.forEach(h => {
            if (h && h.itemName) {
              const key = h.itemName.trim().toLowerCase();
              map.set(key, { ...h });
            }
          });
          this.habits['family_chat'] = map;
        } else if (initialData.habits instanceof Map) {
          this.habits['family_chat'] = new Map(initialData.habits);
        } else if (typeof initialData.habits === 'object') {
          for (const [cid, habitsVal] of Object.entries(initialData.habits)) {
            const map = new Map();
            if (Array.isArray(habitsVal)) {
              habitsVal.forEach(h => {
                if (h && h.itemName) map.set(h.itemName.trim().toLowerCase(), { ...h });
              });
            } else if (habitsVal instanceof Map) {
              habitsVal.forEach((v, k) => map.set(k, { ...v }));
            } else if (typeof habitsVal === 'object' && habitsVal !== null) {
              Object.entries(habitsVal).forEach(([k, v]) => map.set(k, { ...v }));
            }
            this.habits[cid] = map;
          }
        }
      }

      const historyData = initialData.purchaseHistory || initialData.history;
      if (historyData) {
        if (Array.isArray(historyData)) {
          this.history['family_chat'] = [...historyData];
        } else if (typeof historyData === 'object') {
          for (const [cid, hist] of Object.entries(historyData)) {
            this.history[cid] = Array.isArray(hist) ? [...hist] : [];
          }
        }
      }
    }
  }

  _getChatItems(chatId = 'family_chat') {
    const key = chatId || 'family_chat';
    if (!this.activeItems[key]) this.activeItems[key] = [];
    return this.activeItems[key];
  }

  _getChatHabits(chatId = 'family_chat') {
    const key = chatId || 'family_chat';
    if (!this.habits[key]) this.habits[key] = new Map();
    return this.habits[key];
  }

  _getChatHistory(chatId = 'family_chat') {
    const key = chatId || 'family_chat';
    if (!this.history[key]) this.history[key] = [];
    return this.history[key];
  }

  async getActiveItems(chatId = 'family_chat') {
    const targetChat = chatId || 'family_chat';
    return [...this._getChatItems(targetChat)];
  }

  async saveActiveItem(arg1, arg2) {
    let chatId = 'family_chat';
    let item = null;

    if (typeof arg1 === 'object' && arg1 !== null && arg2 === undefined) {
      chatId = 'family_chat';
      item = arg1;
    } else {
      chatId = arg1 || 'family_chat';
      item = arg2;
    }

    if (!item || !item.name) return;
    const items = this._getChatItems(chatId);
    const key = (item.canonicalName || item.name).trim().toLowerCase();
    const existingIndex = items.findIndex(i => (i.canonicalName || i.name.toLowerCase()) === key);
    
    if (existingIndex >= 0) {
      items[existingIndex] = { ...items[existingIndex], ...item, canonicalName: key };
    } else {
      items.push({ ...item, canonicalName: key });
    }
  }

  async deleteActiveItems(chatId = 'family_chat') {
    const targetChat = chatId || 'family_chat';
    const items = this._getChatItems(targetChat);
    const count = items.length;
    this.activeItems[targetChat] = [];
    return count;
  }

  async deleteActiveItem(arg1, arg2) {
    let chatId = 'family_chat';
    let itemName = null;

    if (arg2 === undefined) {
      chatId = 'family_chat';
      itemName = arg1;
    } else {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
    }

    if (!itemName) return false;
    const key = itemName.trim().toLowerCase();
    const items = this._getChatItems(chatId);
    const initialLength = items.length;
    this.activeItems[chatId] = items.filter(i => (i.canonicalName !== key && i.name.toLowerCase() !== key));
    return this.activeItems[chatId].length < initialLength;
  }

  async getHabit(arg1, arg2) {
    let chatId = 'family_chat';
    let itemName = null;

    if (arg2 === undefined) {
      chatId = 'family_chat';
      itemName = arg1;
    } else {
      chatId = arg1 || 'family_chat';
      itemName = arg2;
    }

    if (!itemName || typeof itemName !== 'string') return null;
    const key = itemName.trim().toLowerCase();
    const habits = this._getChatHabits(chatId);
    return habits.get(key) || null;
  }

  async saveHabit(arg1, arg2) {
    let chatId = 'family_chat';
    let habit = null;

    if (typeof arg1 === 'object' && arg1 !== null && arg2 === undefined) {
      chatId = 'family_chat';
      habit = arg1;
    } else {
      chatId = arg1 || 'family_chat';
      habit = arg2;
    }

    if (!habit || !habit.itemName) return;
    const key = habit.itemName.trim().toLowerCase();
    const habits = this._getChatHabits(chatId);
    const existing = habits.get(key) || {};
    habits.set(key, { ...existing, ...habit });
  }

  async savePurchaseHistory(arg1, arg2) {
    let chatId = 'family_chat';
    let record = null;

    if (typeof arg1 === 'object' && arg1 !== null && arg2 === undefined) {
      chatId = 'family_chat';
      record = arg1;
    } else {
      chatId = arg1 || 'family_chat';
      record = arg2;
    }

    if (!record) return;
    const history = this._getChatHistory(chatId);
    history.push(record);
  }

  async getPurchaseHistory(chatId = 'family_chat') {
    const targetChat = chatId || 'family_chat';
    return [...this._getChatHistory(targetChat)];
  }

  async getAllHabits(chatId = 'family_chat') {
    const targetChat = chatId || 'family_chat';
    const habits = this._getChatHabits(targetChat);
    return Array.from(habits.values());
  }

  async clearAllData(chatId = null) {
    if (chatId) {
      this.activeItems[chatId] = [];
      this.habits[chatId] = new Map();
      this.history[chatId] = [];
      delete this.chatSessions[chatId];
    } else {
      this.activeItems = {};
      this.habits = {};
      this.history = {};
      this.chatSessions = {};
    }
  }

  async getChatSession(chatId) {
    if (!chatId) return null;
    return this.chatSessions[chatId] || null;
  }

  async saveChatSession(chatId, sessionData = {}) {
    if (!chatId) return null;
    const nowIso = new Date().toISOString();
    this.chatSessions[chatId] = {
      ...this.chatSessions[chatId],
      ...sessionData,
      updatedAt: sessionData.updatedAt || nowIso
    };
    return this.chatSessions[chatId];
  }

  async getActiveChatSessions() {
    const active = new Set();
    for (const [cid, session] of Object.entries(this.chatSessions)) {
      if (session && session.active === true) {
        active.add(cid);
      }
    }
    // Always include primary group unless explicitly false
    const PRIMARY_GROUP = process.env.PRIMARY_GROUP_ID || '120363410246350492@g.us';
    if (!this.chatSessions[PRIMARY_GROUP] || this.chatSessions[PRIMARY_GROUP].active === true) {
      active.add(PRIMARY_GROUP);
    }
    return Array.from(active);
  }
}

