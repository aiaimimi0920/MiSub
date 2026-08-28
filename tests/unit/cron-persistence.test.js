import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_KEYS, SettingsCache, StorageFactory, STORAGE_TYPES } from '../../functions/storage-adapter.js';
import { handleCronTrigger } from '../../functions/modules/notifications.js';
import { createSqliteStore } from '../../server/storage/sqlite.js';

let store;
let tempDir;

afterEach(() => {
    SettingsCache.clear();
    store?.db.close();
    store = null;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
});

describe('D1 Cron persistence', () => {
    it('records a successful run when no KV namespace is bound', async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'misub-cron-'));
        store = createSqliteStore({
            dbPath: path.join(tempDir, 'misub.db'),
            migrationsDir: path.resolve('migrations')
        });
        const env = { MISUB_DB: store.d1 };
        const adapter = StorageFactory.createAdapter(env, STORAGE_TYPES.D1);
        await adapter.put(DATA_KEYS.SUBSCRIPTIONS, []);
        await adapter.put(DATA_KEYS.SETTINGS, { storageType: 'd1', aggregatorSync: { enabled: false } });

        const response = await handleCronTrigger(env, 'test');
        expect(response.status).toBe(200);
        await expect(adapter.get(DATA_KEYS.CRON_LAST_EXECUTION)).resolves.toMatchObject({
            type: 'test',
            result: { total: 0, updated: 0, failed: 0 }
        });
    });
});
