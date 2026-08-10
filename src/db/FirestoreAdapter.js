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
   * @param {string} chatId 
   */
  async _getCollections(chatId) {
    if (!chatId) throw new Error('chatId is required');
    await this._getDb();
    const chatDoc = this.db.collection('chats').doc(chatId);
    return {
      shoppingListColl: chatDoc.collection('shopping_list'),
      habitsColl: chatDoc.collection('habits'),
      historyColl: chatDoc.collection('purchase_history')
    };
  }

  async getActiveItems(chatId) {
    const { shoppingListColl } = await this._getCollections(chatId);
    const snapshot = await shoppingListColl.get();
    const items = [];
    snapshot.forEach(doc => {
      items.push(doc.data());
    });
    return items;
  }

  async saveActiveItem(chatId, item) {
    if (!item || !item.name) return;
    const { shoppingListColl } = await this._getCollections(chatId);
    const key = (item.canonicalName || item.normalizedName || item.name).trim().toLowerCase();
    const data = {
      ...item,
      canonicalName: key
    };
    await shoppingListColl.doc(key).set(data, { merge: true });
  }

  async deleteActiveItems(chatId) {
    const { shoppingListColl } = await this._getCollections(chatId);
    const snapshot = await shoppingListColl.get();
    if (snapshot.empty) return 0;

    const batch = this.db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    return snapshot.size;
  }

  async deleteActiveItem(chatId, itemName) {
    if (!itemName || typeof itemName !== 'string') return false;
    const { shoppingListColl } = await this._getCollections(chatId);
    const key = itemName.trim().toLowerCase();
    const docRef = shoppingListColl.doc(key);
    const doc = await docRef.get();
    if (doc.exists) {
      await docRef.delete();
      return true;
    }
    return false;
  }

  async getHabit(chatId, itemName) {
    if (!itemName || typeof itemName !== 'string') return null;
    const { habitsColl } = await this._getCollections(chatId);
    const key = itemName.trim().toLowerCase();
    const doc = await habitsColl.doc(key).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async saveHabit(chatId, habit) {
    if (!habit || !habit.itemName) return;
    const { habitsColl } = await this._getCollections(chatId);
    const key = habit.itemName.trim().toLowerCase();
    await habitsColl.doc(key).set(habit, { merge: true });
  }

  async savePurchaseHistory(chatId, record) {
    if (!record) return;
    const { historyColl } = await this._getCollections(chatId);
    const docId = record.id || `reset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await historyColl.doc(docId).set(record);
  }

  async getPurchaseHistory(chatId) {
    const { historyColl } = await this._getCollections(chatId);
    const snapshot = await historyColl.get();
    const history = [];
    snapshot.forEach(doc => {
      history.push(doc.data());
    });
    return history;
  }

  async getAllHabits(chatId) {
    const { habitsColl } = await this._getCollections(chatId);
    const snapshot = await habitsColl.get();
    const habits = [];
    snapshot.forEach(doc => {
      habits.push(doc.data());
    });
    return habits;
  }

  async clearAllData(chatId) {
    const { shoppingListColl, habitsColl, historyColl } = await this._getCollections(chatId);
    
    const deleteColl = async (collRef) => {
      const snapshot = await collRef.get();
      if (snapshot.empty) return;
      const batch = this.db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    };

    await deleteColl(shoppingListColl);
    await deleteColl(habitsColl);
    await deleteColl(historyColl);
  }
}
