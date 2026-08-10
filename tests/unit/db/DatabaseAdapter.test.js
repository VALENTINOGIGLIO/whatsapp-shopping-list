import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseAdapter } from '../../../src/db/DatabaseAdapter.js';

describe('Unit Test: DatabaseAdapter (Abstract Base Class)', () => {
  const adapter = new DatabaseAdapter();

  test('getActiveItems throws Not Implemented error', async () => {
    await assert.rejects(
      async () => await adapter.getActiveItems(),
      /must be implemented by subclass/i
    );
  });

  test('saveActiveItem throws Not Implemented error', async () => {
    await assert.rejects(
      async () => await adapter.saveActiveItem({ name: 'test' }),
      /must be implemented by subclass/i
    );
  });

  test('deleteActiveItems throws Not Implemented error', async () => {
    await assert.rejects(
      async () => await adapter.deleteActiveItems(),
      /must be implemented by subclass/i
    );
  });

  test('getHabit throws Not Implemented error', async () => {
    await assert.rejects(
      async () => await adapter.getHabit('test'),
      /must be implemented by subclass/i
    );
  });

  test('saveHabit throws Not Implemented error', async () => {
    await assert.rejects(
      async () => await adapter.saveHabit({ itemName: 'test' }),
      /must be implemented by subclass/i
    );
  });

  test('savePurchaseHistory throws Not Implemented error', async () => {
    await assert.rejects(
      async () => await adapter.savePurchaseHistory({ id: '1' }),
      /must be implemented by subclass/i
    );
  });

  test('getPurchaseHistory throws Not Implemented error', async () => {
    await assert.rejects(
      async () => await adapter.getPurchaseHistory(),
      /must be implemented by subclass/i
    );
  });

  test('clearAllData throws Not Implemented error', async () => {
    await assert.rejects(
      async () => await adapter.clearAllData(),
      /must be implemented by subclass/i
    );
  });
});
