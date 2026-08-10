import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';

export const useFirestoreAuthState = async (db, collectionName = 'whatsapp_auth') => {
  const collection = db.collection(collectionName);

  const writeData = async (data, id) => {
    try {
      const str = JSON.stringify(data, BufferJSON.replacer);
      await collection.doc(id).set({ data: str });
    } catch (err) {
      console.error(`[FirestoreAuthState] Error writing ${id}:`, err);
    }
  };

  const readData = async (id) => {
    try {
      const doc = await collection.doc(id).get();
      if (doc.exists && doc.data().data) {
        return JSON.parse(doc.data().data, BufferJSON.reviver);
      }
      return null;
    } catch (error) {
      console.error(`[FirestoreAuthState] Error reading ${id}:`, error);
      return null;
    }
  };

  const removeData = async (id) => {
    try {
      await collection.doc(id).delete();
    } catch (err) {
      console.error(`[FirestoreAuthState] Error removing ${id}:`, err);
    }
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = typeof value === 'string' ? value : JSON.stringify(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => {
      return writeData(creds, 'creds');
    },
  };
};
