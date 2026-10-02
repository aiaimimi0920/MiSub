import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteStore } from '../../server/storage/sqlite.js';
import { DATA_KEYS, DataMigrator, StorageFactory } from '../../functions/storage-adapter.js';
import { handleManifestRequest } from '../../functions/modules/source-handler.js';

describe('EasyProxy legacy migration safety on real SQLite', () => {
    let store;
    let d1;
    const sources = [
        { id: 'a', kind: 'connector', input: 'https://example.test', connector_config: { token: 'test-a' } },
        { id: 'b', kind: 'connector', input: 'https://example.test', connector_config: { token: 'test-b' } },
    ];
    const write = (id, data) => d1.prepare('INSERT OR REPLACE INTO subscriptions (id, data) VALUES (?, ?)').bind(id, JSON.stringify(data)).run();
    const read = async (id) => {
        const row = await d1.prepare('SELECT data FROM subscriptions WHERE id = ?').bind(id).first();
        return row ? JSON.parse(row.data) : null;
    };
    beforeEach(() => {
        store = createSqliteStore({ dbPath: ':memory:', migrationsDir: 'migrations' });
        d1 = store.d1;
    });
    afterEach(() => store.db.close());

    it('preserves distinct connector records exactly and is idempotent', async () => {
        await write('main', sources);
        expect(await DataMigrator.migrateLegacyD1MainRows({ MISUB_DB: d1 })).toMatchObject({ subscriptions: 2, errors: [] });
        expect(await read('main')).toBeNull();
        expect(await read('a')).toEqual(sources[0]);
        expect(await read('b')).toEqual(sources[1]);
        expect(await DataMigrator.migrateLegacyD1MainRows({ MISUB_DB: d1 })).toMatchObject({ subscriptions: 0, errors: [] });
    });

    it('returns the same authenticated Manifest before and after migration', async () => {
        const connectors = sources.map(item => ({ ...item, enabled: true, connector_type: 'ech_worker' }));
        await write('main', connectors);
        await d1.prepare('INSERT INTO profiles (id, data) VALUES (?, ?)').bind('main', JSON.stringify([
            { id: 'profile', enabled: true, subscriptions: [], manualNodes: ['a', 'b'] },
        ])).run();
        const manifest = async () => {
            const response = await handleManifestRequest(new Request('https://misub.example.test/api/manifest/profile', {
                headers: { Authorization: 'Bearer test-manifest' },
            }), { MISUB_DB: d1, MANIFEST_TOKEN: 'test-manifest' }, 'profile');
            expect(response.status).toBe(200);
            const result = await response.json();
            delete result.generated_at;
            return result;
        };
        const before = await manifest();
        expect(before.sources).toHaveLength(2);
        expect(await DataMigrator.migrateLegacyD1MainRows({ MISUB_DB: d1 })).toMatchObject({ errors: [] });
        expect(await manifest()).toEqual(before);
    });

    it.each([{}, [{ name: 'missing id' }], [{ id: 'a' }, { id: 'a' }], [{ id: 'main' }]])('retains invalid legacy input %j', async (data) => {
        await write('main', data);
        const result = await DataMigrator.migrateLegacyD1MainRows({ MISUB_DB: d1 });
        expect(result.errors).toHaveLength(1);
        expect(await read('main')).toEqual(data);
        expect(await read('a')).toBeNull();
    });

    it('refuses to overwrite a conflicting target', async () => {
        await write('main', sources);
        await write('a', { id: 'a', name: 'other writer' });
        const result = await DataMigrator.migrateLegacyD1MainRows({ MISUB_DB: d1 });
        expect(result.errors[0]).toContain('different data');
        expect(await read('main')).toEqual(sources);
        expect(await read('a')).toEqual({ id: 'a', name: 'other writer' });
        expect(await read('b')).toBeNull();
    });

    it('rolls back a failed insert batch and retains main', async () => {
        await write('main', sources);
        store.db.exec("CREATE TRIGGER fail_b BEFORE INSERT ON subscriptions WHEN NEW.id = 'b' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
        const result = await DataMigrator.migrateLegacyD1MainRows({ MISUB_DB: d1 });
        expect(result.errors).toHaveLength(1);
        expect(await read('main')).toEqual(sources);
        expect(await read('a')).toBeNull();
    });

    it('does not remove main if another writer changes it', async () => {
        await write('main', sources);
        const batch = d1.batch.bind(d1);
        d1.batch = async (statements) => {
            const result = await batch(statements);
            await write('main', [{ id: 'new-source' }]);
            return result;
        };
        const result = await DataMigrator.migrateLegacyD1MainRows({ MISUB_DB: d1 });
        expect(result.errors[0]).toContain('changed during migration');
        expect(await read('main')).toEqual([{ id: 'new-source' }]);
    });

    it('whole-collection writes remove stale rows atomically', async () => {
        await write('old', { id: 'old' });
        const adapter = StorageFactory.createAdapter({ MISUB_DB: d1 }, 'd1');
        await adapter.put(DATA_KEYS.SUBSCRIPTIONS, sources);
        expect(await read('old')).toBeNull();
        expect(await adapter.get(DATA_KEYS.SUBSCRIPTIONS)).toEqual(sources);
        store.db.exec("CREATE TRIGGER fail_c BEFORE INSERT ON subscriptions WHEN NEW.id = 'c' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
        await expect(adapter.put(DATA_KEYS.SUBSCRIPTIONS, [{ id: 'c' }])).rejects.toThrow('injected failure');
        expect(await read('a')).toEqual(sources[0]);
        expect(await read('b')).toEqual(sources[1]);
    });
});
