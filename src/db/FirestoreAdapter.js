import { DatabaseAdapter } from './DatabaseAdapter.js';
import { getFirestoreInstance } from '../config/firebase.js';

export class FirestoreAdapter extends DatabaseAdapter {
  /**
   * @param {Object} [db] - Optional Firestore instance (for custom configuration or mocking)
   */
  constructor(db = null) {
    super();
    this.db = db;
    if (db) {
      this.shoppingListColl = db.collection('shopping_list');
      this.habitsColl = db.collection('habits');
      this.historyColl = db.collection('purchase_history');
    }
  }

  async _getDb() {
    if (!this.db) {
      this.db = await getFirestoreInstance();
      this.shoppingListColl = this.db.collection('shopping_list');
      this.habitsColl = this.db.collection('habits');
      this.historyColl = this.db.collection('purchase_history');
    }
    return this.db;
  }

  /**
   * Helper to get collections for a specific chat.
   * @param {string} [chatId] 
   */
  async _getCollections(chatId = 'family_chat') {
    await this._getDb();
    const targetChat = chatId || 'family_chat';
    if (targetChat !== 'family_chat' && targetChat !== 'default_chat') {
      try {
        const chatDoc = this.db.collection('chats').doc(targetChat);
        if (chatDoc && typeof chatDoc.collection === 'function') {
          return {
            shoppingListColl: chatDoc.collection('shopping_list'),
            habitsColl: chatDoc.collection('habits'),
            historyColl: chatDoc.collection('purchase_history')
          };
        }
      } catch (_) {}
    }
    return {
      shoppingListColl: this.db.collection('shopping_list'),
      habitsColl: this.db.collection('habits'),
      historyColl: this.db.collection('purchase_history')
    };
  }

  async getActiveItems(chatId = 'family_chat') {
    const { shoppingListColl } = await this._getCollections(chatId);
    const snapshot = await shoppingListColl.get();
    const items = [];
    if (snapshot && snapshot.forEach) {
      snapshot.forEach(doc => {
        items.push(doc.data());
      });
    }
    return items;
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
    const { shoppingListColl } = await this._getCollections(chatId);
    const key = (item.canonicalName || item.normalizedName || item.name).trim().toLowerCase();
    const data = {
      ...item,
      canonicalName: key
    };
    await shoppingListColl.doc(key).set(data, { merge: true });
  }

  async deleteActiveItems(chatId = 'family_chat') {
    const { shoppingListColl } = await this._getCollections(chatId);
    const snapshot = await shoppingListColl.get();
    if (!snapshot || snapshot.empty || snapshot.size === 0 || !snapshot.docs || snapshot.docs.length === 0) return 0;

    const batch = this.db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref || doc);
    });
    await batch.commit();
    return snapshot.size !== undefined ? snapshot.size : snapshot.docs.length;
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

    if (!itemName || typeof itemName !== 'string') return false;
    const { shoppingListColl } = await this._getCollections(chatId);
    const key = itemName.trim().toLowerCase();
    const docRef = shoppingListColl.doc(key);
    const doc = await docRef.get();
    if (doc.exists) {
      if (typeof docRef.delete === 'function') {
        await docRef.delete();
      } else {
        const batch = this.db.batch();
        batch.delete(docRef);
        await batch.commit();
      }
      return true;
    }
    return false;
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
    const { habitsColl } = await this._getCollections(chatId);
    const key = itemName.trim().toLowerCase();
    const doc = await habitsColl.doc(key).get();
    if (!doc.exists) return null;
    return doc.data();
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
    const { habitsColl } = await this._getCollections(chatId);
    const key = habit.itemName.trim().toLowerCase();
    await habitsColl.doc(key).set(habit, { merge: true });
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
    const { historyColl } = await this._getCollections(chatId);
    const docId = record.id || `reset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await historyColl.doc(docId).set(record);
  }

  async getPurchaseHistory(chatId = 'family_chat') {
    const { historyColl } = await this._getCollections(chatId);
    const snapshot = await historyColl.get();
    const history = [];
    if (snapshot && snapshot.forEach) {
      snapshot.forEach(doc => {
        history.push(doc.data());
      });
    }
    return history;
  }

  async getAllHabits(chatId = 'family_chat') {
    const { habitsColl } = await this._getCollections(chatId);
    const snapshot = await habitsColl.get();
    const habits = [];
    if (snapshot && snapshot.forEach) {
      snapshot.forEach(doc => {
        habits.push(doc.data());
      });
    }
    return habits;
  }

  async clearAllData(chatId = 'family_chat') {
    const { shoppingListColl, habitsColl, historyColl } = await this._getCollections(chatId);
    
    const deleteColl = async (collRef) => {
      const snapshot = await collRef.get();
      if (!snapshot || snapshot.empty || !snapshot.docs || snapshot.docs.length === 0) return;
      const batch = this.db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref || doc));
      await batch.commit();
    };

    await deleteColl(shoppingListColl);
    await deleteColl(habitsColl);
    await deleteColl(historyColl);
  }

  async getChatSession(chatId) {
    if (!chatId) return null;
    await this._getDb();
    try {
      const doc = await this.db.collection('chats').doc(chatId).get();
      if (!doc.exists) return null;
      return doc.data();
    } catch (err) {
      console.error(`[FirestoreAdapter] Error getting chat session for ${chatId}:`, err);
      return null;
    }
  }

  async saveChatSession(chatId, sessionData = {}) {
    if (!chatId) return null;
    await this._getDb();
    const nowIso = new Date().toISOString();
    const data = {
      ...sessionData,
      updatedAt: sessionData.updatedAt || nowIso
    };
    try {
      await this.db.collection('chats').doc(chatId).set(data, { merge: true });
      return data;
    } catch (err) {
      console.error(`[FirestoreAdapter] Error saving chat session for ${chatId}:`, err);
      return null;
    }
  }

  async getActiveChatSessions() {
    await this._getDb();
    const activeSessions = new Set();
    const PRIMARY_GROUP = '120363410246350492@g.us';

    try {
      if (typeof this.db.collection('chats').listDocuments === 'function') {
        const docRefs = await this.db.collection('chats').listDocuments();
        for (const ref of docRefs) {
          try {
            const docSnap = await ref.get();
            const data = docSnap.exists ? docSnap.data() : null;
            if (data && data.active === true) {
              activeSessions.add(ref.id);
            }
          } catch (e) {
            console.error(`[FirestoreAdapter] Error inspecting chat doc ${ref.id}:`, e.message);
          }
        }
      } else {
        const snapshot = await this.db.collection('chats').get();
        if (snapshot && snapshot.forEach) {
          snapshot.forEach(doc => {
            const data = doc.data();
            if (data && data.active === true) {
              activeSessions.add(doc.id);
            }
          });
        }
      }
    } catch (err) {
      console.error('[FirestoreAdapter] Error fetching active chat sessions:', err);
    }

    // Ensure primary group list is included unless explicitly deactivated
    try {
      const primaryDoc = await this.db.collection('chats').doc(PRIMARY_GROUP).get();
      if (!primaryDoc.exists) {
        activeSessions.add(PRIMARY_GROUP);
      } else if (primaryDoc.data()?.active === true) {
        activeSessions.add(PRIMARY_GROUP);
      }
    } catch (_) {
      activeSessions.add(PRIMARY_GROUP);
    }

    return Array.from(activeSessions);
  }
}

