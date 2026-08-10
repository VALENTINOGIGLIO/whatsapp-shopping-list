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

  async getActiveItems() {
    await this._getDb();
    const snapshot = await this.shoppingListColl.get();
    const items = [];
    snapshot.forEach(doc => {
      items.push(doc.data());
    });
    return items;
  }

  async saveActiveItem(item) {
    if (!item || !item.name) return;
    await this._getDb();
    const key = (item.canonicalName || item.normalizedName || item.name).trim().toLowerCase();
    const data = {
      ...item,
      canonicalName: key
    };
    await this.shoppingListColl.doc(key).set(data, { merge: true });
  }

  async deleteActiveItems() {
    await this._getDb();
    const snapshot = await this.shoppingListColl.get();
    if (snapshot.empty) return 0;

    const batch = this.db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    return snapshot.size;
  }

  async getHabit(itemName) {
    if (!itemName || typeof itemName !== 'string') return null;
    await this._getDb();
    const key = itemName.trim().toLowerCase();
    const doc = await this.habitsColl.doc(key).get();
    if (!doc.exists) return null;
    return doc.data();
  }

  async saveHabit(habit) {
    if (!habit || !habit.itemName) return;
    await this._getDb();
    const key = habit.itemName.trim().toLowerCase();
    await this.habitsColl.doc(key).set(habit, { merge: true });
  }

  async savePurchaseHistory(record) {
    if (!record) return;
    await this._getDb();
    const docId = record.id || `reset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await this.historyColl.doc(docId).set(record);
  }

  async getPurchaseHistory() {
    await this._getDb();
    const snapshot = await this.historyColl.get();
    const history = [];
    snapshot.forEach(doc => {
      history.push(doc.data());
    });
    return history;
  }

  async getAllHabits() {
    await this._getDb();
    const snapshot = await this.habitsColl.get();
    const habits = [];
    snapshot.forEach(doc => {
      habits.push(doc.data());
    });
    return habits;
  }

  async clearAllData() {
    await this._getDb();
    const deleteColl = async (collRef) => {
      const snapshot = await collRef.get();
      if (snapshot.empty) return;
      const batch = this.db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    };

    await deleteColl(this.shoppingListColl);
    await deleteColl(this.habitsColl);
    await deleteColl(this.historyColl);
  }
}
