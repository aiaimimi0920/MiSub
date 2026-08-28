import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATA_KEYS, DataMigrator, SettingsCache, StorageFactory, STORAGE_TYPES } from '../../functions/storage-adapter.js';
import { createSqliteStore } from '../../server/storage/sqlite.js';

const tempDirs = [];

function createKvNamespace() {
    return {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn()
    };
}

function createMapKvNamespace(initial = {}) {
    const values = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
    return {
        values,
        async get(key) { return values.get(key) ?? null; },
        async put(key, value) { values.set(key, String(value)); },
        async delete(key) { values.delete(key); },
        async list({ prefix = '' } = {}) {
            return { keys: [...values.keys()].filter(key => key.startsWith(prefix)).map(name => ({ name })) };
        }
    };
}

function createD1Store() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misub-storage-'));
    tempDirs.push(dir);
    return createSqliteStore({ dbPath: path.join(dir, 'misub.db'), migrationsDir: path.resolve('migrations') });
}

describe('StorageFactory', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        SettingsCache.clear();
        for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
    });

    it('defaults to D1 when MISUB_DB is available and no explicit storageType is saved', async () => {
        vi.spyOn(SettingsCache, 'get').mockResolvedValue(null);

        const storageType = await StorageFactory.getStorageType({ MISUB_DB: {} });

        expect(storageType).toBe(STORAGE_TYPES.D1);
    });

    it('defaults to KV when D1 is unavailable but KV is bound', async () => {
        vi.spyOn(SettingsCache, 'get').mockResolvedValue(null);

        const storageType = await StorageFactory.getStorageType({ MISUB_KV: createKvNamespace() });

        expect(storageType).toBe(STORAGE_TYPES.KV);
    });

    it('honors an explicitly saved storageType', async () => {
        vi.spyOn(SettingsCache, 'get').mockResolvedValue({ storageType: STORAGE_TYPES.KV });

        const storageType = await StorageFactory.getStorageType({ MISUB_DB: {}, MISUB_KV: createKvNamespace() });

        expect(storageType).toBe(STORAGE_TYPES.KV);
    });

    it('fails closed instead of silently switching to a different or empty backend', () => {
        expect(() => StorageFactory.createAdapter({ MISUB_DB: {} }, STORAGE_TYPES.KV)).toThrow('MISUB_KV');
        expect(() => StorageFactory.createAdapter({ MISUB_KV: createKvNamespace() }, STORAGE_TYPES.D1)).toThrow('MISUB_DB');
        expect(() => StorageFactory.createAdapter({}, STORAGE_TYPES.D1)).toThrow('MISUB_DB');
    });

    it('persists Cron status through the D1 adapter', async () => {
        const store = createD1Store();
        const adapter = StorageFactory.createAdapter({ MISUB_DB: store.d1 }, STORAGE_TYPES.D1);
        const status = { timestamp: '2026-08-29T00:00:00.000Z', result: { updated: 4 } };

        await adapter.put(DATA_KEYS.CRON_LAST_EXECUTION, status);
        await expect(adapter.get(DATA_KEYS.CRON_LAST_EXECUTION)).resolves.toEqual(status);
        store.db.close();
    });

    it('migrates KV data once, verifies repeat runs, and refuses a conflicting D1 overwrite', async () => {
        const settings = { storageType: 'kv', cronSecret: 'test-cron', unknown: true };
        const kv = createMapKvNamespace({
            [DATA_KEYS.SUBSCRIPTIONS]: [{ id: 'sub-one', kind: 'subscription', input: 'https://example.test/sub' }],
            [DATA_KEYS.PROFILES]: [{ id: 'profile-one', subscriptions: ['sub-one'] }],
            [DATA_KEYS.SETTINGS]: settings
        });
        const store = createD1Store();
        const env = { MISUB_KV: kv, MISUB_DB: store.d1 };

        await expect(DataMigrator.migrateKVToD1(env)).resolves.toMatchObject({
            subscriptions: 'migrated', profiles: 'migrated', settings: 'migrated', errors: []
        });
        expect(settings.storageType).toBe('kv');
        await expect(DataMigrator.migrateKVToD1(env)).resolves.toMatchObject({
            subscriptions: 'verified', profiles: 'verified', settings: 'verified', errors: []
        });

        await kv.put(DATA_KEYS.SUBSCRIPTIONS, JSON.stringify([{ id: 'different' }]));
        const conflict = await DataMigrator.migrateKVToD1(env);
        expect(conflict.errors).toContain('subscriptions: target contains different data');
        const d1 = StorageFactory.createAdapter(env, STORAGE_TYPES.D1);
        await expect(d1.get(DATA_KEYS.SUBSCRIPTIONS)).resolves.toEqual([
            { id: 'sub-one', kind: 'subscription', input: 'https://example.test/sub' }
        ]);
        store.db.close();
    });
});
