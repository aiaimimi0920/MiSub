import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useManualNodes } from '../../src/composables/useManualNodes.js';
import { useSubscriptions } from '../../src/composables/useSubscriptions.js';
import { isManualNodeEntry } from '../../src/composables/manual-nodes/filters.js';
import { buildAutoSortedSubscriptions } from '../../src/composables/manual-nodes/sorting.js';

const sources = () => [
    {
        id: 'zen',
        name: 'ZenProxy Primary',
        kind: 'connector',
        connector_type: 'zenproxy_client',
        url: 'https://zen.example',
        connector_config: { api_key: 'test-key' },
        enabled: true,
    },
    {
        id: 'ech',
        name: 'ECH Worker',
        kind: 'connector',
        connector_type: 'ech_worker',
        input: 'https://ech.example',
        connector_config: { access_token: 'test-token' },
        enabled: true,
    },
    {
        id: 'http',
        name: 'HTTP Proxy',
        kind: 'proxy_uri',
        url: 'https://proxy.example',
        enabled: true,
    },
    { id: 'ss', name: 'SS Node', url: 'ss://example', enabled: true },
    { id: 'sub', name: 'Subscription', url: 'https://sub.example/list', enabled: true },
];

describe('connector source visibility and preservation', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        localStorage.clear();
    });

    it('includes connectors and explicit HTTP proxies in manual/profile choices, not subscriptions', () => {
        const store = useDataStore();
        store.subscriptions = sources();
        expect(useManualNodes(vi.fn()).manualNodes.value.map((x) => x.id)).toEqual([
            'zen',
            'ech',
            'http',
            'ss',
        ]);
        expect(useSubscriptions(vi.fn()).subscriptions.value.map((x) => x.id)).toEqual(['sub']);
        expect(isManualNodeEntry(null)).toBe(false);
        expect(isManualNodeEntry({ url: 123 })).toBe(false);
        expect(isManualNodeEntry({ url: 'invalid' })).toBe(false);
    });

    it('preserves connector configs and profile references when reordering subscriptions', () => {
        const store = useDataStore();
        store.subscriptions = sources();
        store.profiles = [{ id: 'profile', manualNodes: ['zen', 'ech'], subscriptions: ['sub'] }];
        const before = JSON.parse(JSON.stringify(store.subscriptions));
        useSubscriptions(vi.fn()).reorderSubscriptions([store.subscriptions[4]]);
        expect(store.subscriptions).toEqual(before);
        expect(store.profiles[0].manualNodes).toEqual(['zen', 'ech']);
    });

    it('does not duplicate HTTP connectors when reordering or auto-sorting manual sources', () => {
        const store = useDataStore();
        store.subscriptions = sources();
        const manual = useManualNodes(vi.fn());
        manual.reorderManualNodes([...manual.manualNodes.value].reverse());
        expect(store.subscriptions).toHaveLength(5);
        expect(new Set(store.subscriptions.map((x) => x.id)).size).toBe(5);
        const sorted = buildAutoSortedSubscriptions(store.subscriptions, manual.manualNodes.value);
        expect(sorted).toHaveLength(5);
        expect(new Set(sorted.map((x) => x.id)).size).toBe(5);
        expect(sorted.find((x) => x.id === 'zen').connector_config.api_key).toBe('test-key');
    });
});
