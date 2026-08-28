import { DATA_KEYS } from '../storage-adapter.js';
import {
    isConnectorSource,
    isProxyURISource,
    isSubscriptionSource,
    normalizeSourceCollection
} from '../../src/shared/source-utils.js';
import {
    BACKUP_FORMAT,
    BACKUP_FORMAT_VERSION,
    DATABASE_SCHEMA_VERSION,
    canonicalJSONStringify,
    sha256Hex
} from '../../src/shared/backup-format.js';

export async function buildLogicalBackup({ storageAdapter, storageType, resourceIdentity = {} }) {
    const [rawSources, profiles, settings, cronLastExecution] = await Promise.all([
        storageAdapter.get(DATA_KEYS.SUBSCRIPTIONS),
        storageAdapter.get(DATA_KEYS.PROFILES),
        storageAdapter.get(DATA_KEYS.SETTINGS),
        storageAdapter.get(DATA_KEYS.CRON_LAST_EXECUTION)
    ]);
    const sources = normalizeSourceCollection(rawSources || []);
    const subscriptions = sources.filter(isSubscriptionSource);
    const proxyUris = sources.filter(isProxyURISource);
    const connectors = sources.filter(isConnectorSource);
    const data = {
        sources,
        subscriptions,
        proxyUris,
        connectors,
        manualNodes: [...proxyUris, ...connectors],
        profiles: profiles || [],
        settings: settings || {},
        cron: { lastExecution: cronLastExecution || null }
    };
    const canonicalData = canonicalJSONStringify(data);

    return {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        createdAt: new Date().toISOString(),
        applicationVersion: '2.4.0',
        schemaVersion: DATABASE_SCHEMA_VERSION,
        storageType,
        containsSensitiveData: true,
        resourceIdentity: {
            deploymentName: resourceIdentity.deploymentName || null,
            pagesProject: resourceIdentity.pagesProject || null,
            d1DatabaseId: resourceIdentity.d1DatabaseId || null,
            d1Binding: 'MISUB_DB'
        },
        counts: {
            sources: sources.length,
            subscriptions: subscriptions.length,
            proxyUris: proxyUris.length,
            connectors: connectors.length,
            profiles: data.profiles.length,
            settings: Object.keys(data.settings).length,
            cronExecutions: cronLastExecution ? 1 : 0
        },
        integrity: {
            algorithm: 'SHA-256',
            canonicalDataSha256: await sha256Hex(canonicalData)
        },
        data
    };
}
