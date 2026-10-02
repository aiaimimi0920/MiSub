import { afterEach, describe, expect, it, vi } from 'vitest';
import { enrichSourcesWithProbeMetadata } from '../../functions/modules/source-probe.js';
import { handleManifestRequest } from '../../functions/modules/source-handler.js';
import { StorageFactory } from '../../functions/storage-adapter.js';
import { KV_KEY_SUBS, KV_KEY_PROFILES } from '../../functions/modules/config.js';

describe('explicit HTTP proxy probe semantics', () => {
    afterEach(() => vi.restoreAllMocks());
    it.each(['http://proxy.example.test:80#node', 'http://proxy.example.test:8080#node', 'https://proxy.example.test:443'])('preserves %s without subscription fetch', async (input) => {
        const fetchImpl = vi.fn(() => { throw new Error('unexpected fetch'); });
        const source = { id: 'proxy', kind: 'proxy_uri', input, enabled: true };
        const [result] = await enrichSourcesWithProbeMetadata([source], [{
            ...source, probe_status: 'unreachable', detected_kind: 'unknown',
            probe_input: input, last_probe_at: '2026-01-01T00:00:00Z',
        }], { fetchImpl });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(result).toMatchObject({ id: 'proxy', input, kind: 'proxy_uri', probe_status: 'skipped' });
        vi.spyOn(StorageFactory, 'getStorageType').mockResolvedValue('d1');
        vi.spyOn(StorageFactory, 'createAdapter').mockReturnValue({
            get: async key => key === KV_KEY_SUBS ? [result] : key === KV_KEY_PROFILES ? [
                { id: 'profile', enabled: true, manualNodes: ['proxy'], subscriptions: [] },
            ] : null,
        });
        const response = await handleManifestRequest(new Request('https://misub.example.test/api/manifest/profile', {
            headers: { Authorization: 'Bearer test-manifest' },
        }), { MANIFEST_TOKEN: 'test-manifest' }, 'profile');
        expect(response.status).toBe(200);
        const manifest = await response.json();
        expect(manifest.sources).toHaveLength(1);
        expect(manifest.sources[0]).toMatchObject({ id: 'proxy', input, kind: 'proxy_uri' });
    });
});
