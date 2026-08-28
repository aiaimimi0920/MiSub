import { describe, expect, it } from 'vitest';
import { buildLogicalBackup } from '../../functions/modules/backup-service.js';
import { verifyLogicalBackup } from '../../src/shared/backup-format.js';
import { DATA_KEYS } from '../../functions/storage-adapter.js';

function adapter(values) {
    return { async get(key) { return values[key] ?? null; } };
}

describe('MiSub logical backup', () => {
    it('includes every source kind, settings, Cron status, identity, counts, and checksum', async () => {
        const sources = [
            { id: 'sub', kind: 'subscription', input: 'https://sub.example/data', enabled: true },
            { id: 'proxy', kind: 'proxy_uri', input: 'http://user:pass@proxy.example:8080', enabled: true },
            { id: 'connector', kind: 'connector', input: 'https://zen.example', connector_type: 'zenproxy_client', connector_config: { api_key: 'test-key' } }
        ];
        const values = {
            [DATA_KEYS.SUBSCRIPTIONS]: sources,
            [DATA_KEYS.PROFILES]: [{ id: 'profile', customId: 'public', subscriptions: ['sub'], manualNodes: ['proxy', 'connector'] }],
            [DATA_KEYS.SETTINGS]: { cronSecret: 'test-cron', unknownUserSetting: true },
            [DATA_KEYS.CRON_LAST_EXECUTION]: { timestamp: '2026-08-29T00:00:00.000Z', result: { total: 1 } }
        };

        const backup = await buildLogicalBackup({
            storageAdapter: adapter(values),
            storageType: 'd1',
            resourceIdentity: { deploymentName: 'test', pagesProject: 'test-pages', d1DatabaseId: 'd1-test-id' }
        });

        await expect(verifyLogicalBackup(backup)).resolves.toBe(true);
        expect(backup.counts).toMatchObject({ sources: 3, subscriptions: 1, proxyUris: 1, connectors: 1, profiles: 1, cronExecutions: 1 });
        expect(backup.data.connectors[0].connector_config.api_key).toBe('test-key');
        expect(backup.data.settings.cronSecret).toBe('test-cron');
        expect(backup.resourceIdentity).toMatchObject({ d1DatabaseId: 'd1-test-id', d1Binding: 'MISUB_DB' });
    });

    it('rejects a modified backup payload', async () => {
        const backup = await buildLogicalBackup({ storageAdapter: adapter({}), storageType: 'd1' });
        backup.data.settings.changed = true;
        await expect(verifyLogicalBackup(backup)).rejects.toThrow('checksum mismatch');
    });
});
