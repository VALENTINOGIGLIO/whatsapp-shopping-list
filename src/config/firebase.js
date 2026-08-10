let admin = null;
let initialized = false;

/**
 * Lazy initialization helper for Firebase Admin SDK and Firestore instance.
 * Reads FIREBASE_SERVICE_ACCOUNT from process.env if available, otherwise initializes default app.
 * @returns {Promise<Object>} Firestore instance
 */
export async function getFirestoreInstance() {
  if (!initialized) {
    if (!admin) {
      try {
        const mod = await import('firebase-admin');
        admin = mod.default || mod;
      } catch (err) {
        throw new Error(`[Firebase] firebase-admin package is not installed: ${err.message}`);
      }
    }

    if (!admin.apps || !admin.apps.length) {
      const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (serviceAccountRaw) {
        try {
          const serviceAccount = JSON.parse(serviceAccountRaw);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
          });
        } catch (err) {
          console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
          admin.initializeApp();
        }
      } else {
        admin.initializeApp();
      }
    }
    initialized = true;
  }
  return admin.firestore();
}
