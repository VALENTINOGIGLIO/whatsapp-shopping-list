import { DatabaseAdapter } from './DatabaseAdapter.js';
import { MockDatabaseAdapter } from './MockDatabaseAdapter.js';
import { FirestoreAdapter } from './FirestoreAdapter.js';

/**
 * Creates and returns a DatabaseAdapter instance based on environment variables or options.
 * @param {Object} [options]
 * @param {string} [options.dbType] - Explicit override ("mock" | "firestore")
 * @returns {DatabaseAdapter}
 */
export function createDatabaseAdapter(options = {}) {
  const dbType = options.dbType || process.env.DB_TYPE || (process.env.USE_MOCK_DB === 'false' ? 'firestore' : 'mock');

  if (dbType === 'firestore') {
    return new FirestoreAdapter();
  }

  return new MockDatabaseAdapter();
}

export { DatabaseAdapter, MockDatabaseAdapter, FirestoreAdapter };
