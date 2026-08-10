import { getFirestoreInstance } from './src/config/firebase.js';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const db = await getFirestoreInstance();
  const snapshot = await db.collection('whatsapp_auth').get();
  console.log(`whatsapp_auth docs count: ${snapshot.size}`);
}
run().catch(console.error);
