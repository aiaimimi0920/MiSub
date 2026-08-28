/**
 * 数据存储抽象层
 * 支持 KV 和 D1 两种存储方式
 * 根据设置自动选择存储类型
 */

// 存储类型常量
export const STORAGE_TYPES = {
    KV: 'kv',
    D1: 'd1'
};

function normalizeStorageType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.values(STORAGE_TYPES).includes(normalized) ? normalized : '';
}

// 数据键映射
export const DATA_KEYS = {
    SUBSCRIPTIONS: 'misub_subscriptions_v1',
    PROFILES: 'misub_profiles_v1',
    SETTINGS: 'worker_settings_v1',
    CRON_LAST_EXECUTION: 'cron_last_execution'
};

/**
 * KV 存储适配器
 */
class KVStorageAdapter {
    constructor(kvNamespace) {
        this.kv = kvNamespace;
    }

    async get(key) {
        try {
            const raw = await this.kv.get(key);
            if (raw === null || raw === undefined) return null;
            try {
                return JSON.parse(raw);
            } catch {
                return raw;
            }
        } catch (error) {
            console.error(`[KV] Failed to get key ${key}:`, error);
            return null;
        }
    }

    async put(key, value) {
        try {
            const data = typeof value === 'string' ? value : JSON.stringify(value);
            await this.kv.put(key, data);
            return true;
        } catch (error) {
            console.error(`[KV] Failed to put key ${key}:`, error);
            throw error;
        }
    }

    async delete(key) {
        try {
            await this.kv.delete(key);
            return true;
        } catch (error) {
            console.error(`[KV] Failed to delete key ${key}:`, error);
            throw error;
        }
    }

    async list(prefix) {
        try {
            const result = await this.kv.list({ prefix });
            return result.keys || [];
        } catch (error) {
            console.error(`[KV] Failed to list keys with prefix ${prefix}:`, error);
            return [];
        }
    }
}

/**
 * D1 存储适配器
 */
class D1StorageAdapter {
    constructor(d1Database) {
        this.db = d1Database;
    }

    async get(key, type = 'json') {
        try {
            // 根据 key 确定查询的表和字段
            const { table, queryField, queryValue, dataField } = this._parseKey(key);

            const result = await this.db.prepare(
                `SELECT ${dataField} as data FROM ${table} WHERE ${queryField} = ?`
            ).bind(queryValue).first();

            if (!result) return null;

            return type === 'json' ? JSON.parse(result.data) : result.data;
        } catch (error) {
            // 如果是表不存在的错误，说明 D1 还未初始化或未被使用，直接返回 null
            if (error.message && error.message.includes('no such table')) {
                return null;
            }
            throw new Error(`[D1] Failed to get key ${key}: ${error.message}`, { cause: error });
        }
    }

    async put(key, value) {
        try {
            const { table, queryField, queryValue } = this._parseKey(key);
            const data = typeof value === 'string' ? value : JSON.stringify(value);

            if (table === 'settings') {
                // settings 表使用 key-value 结构
                await this.db.prepare(`
                    INSERT OR REPLACE INTO ${table} (key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                `).bind(queryValue, data).run();
            } else {
                await this.db.prepare(`
                    INSERT OR REPLACE INTO ${table} (id, data, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                `).bind(queryValue, data).run();
            }

            return true;
        } catch (error) {
            console.error(`[D1] Failed to put key ${key}:`, error);
            throw error;
        }
    }

    async delete(key) {
        try {
            const { table, queryField, queryValue } = this._parseKey(key);

            await this.db.prepare(
                `DELETE FROM ${table} WHERE ${queryField} = ?`
            ).bind(queryValue).run();

            return true;
        } catch (error) {
            console.error(`[D1] Failed to delete key ${key}:`, error);
            throw error;
        }
    }

    async list(prefix) {
        try {
            // D1 中的 list 操作需要根据前缀查询相应的表
            const tables = [
                { name: 'subscriptions', keyField: 'id' },
                { name: 'profiles', keyField: 'id' },
                { name: 'settings', keyField: 'key' },
                { name: 'cron_executions', keyField: 'id' }
            ];
            const keys = [];
            const effectivePrefix = prefix || '';
            const matchesKnownKey =
                DATA_KEYS.SUBSCRIPTIONS.startsWith(effectivePrefix) ||
                DATA_KEYS.PROFILES.startsWith(effectivePrefix) ||
                DATA_KEYS.SETTINGS.startsWith(effectivePrefix) ||
                DATA_KEYS.CRON_LAST_EXECUTION.startsWith(effectivePrefix) ||
                effectivePrefix.startsWith(DATA_KEYS.SUBSCRIPTIONS) ||
                effectivePrefix.startsWith(DATA_KEYS.PROFILES) ||
                effectivePrefix.startsWith(DATA_KEYS.SETTINGS) ||
                effectivePrefix.startsWith(DATA_KEYS.CRON_LAST_EXECUTION);

            const shouldQuerySubscriptions = !effectivePrefix || effectivePrefix.startsWith(DATA_KEYS.SUBSCRIPTIONS);
            const shouldQueryProfiles = !effectivePrefix || effectivePrefix.startsWith(DATA_KEYS.PROFILES);
            const shouldQuerySettings = !effectivePrefix || !matchesKnownKey || effectivePrefix.startsWith(DATA_KEYS.SETTINGS);
            const shouldQueryCron = !effectivePrefix || effectivePrefix.startsWith(DATA_KEYS.CRON_LAST_EXECUTION);

            for (const table of tables) {
                if (table.name === 'subscriptions' && !shouldQuerySubscriptions) continue;
                if (table.name === 'profiles' && !shouldQueryProfiles) continue;
                if (table.name === 'settings' && !shouldQuerySettings) continue;
                if (table.name === 'cron_executions' && !shouldQueryCron) continue;

                let results;
                if (table.name === 'settings' && effectivePrefix) {
                    results = await this.db.prepare(
                        `SELECT ${table.keyField} FROM ${table.name} WHERE ${table.keyField} LIKE ?`
                    ).bind(`${effectivePrefix}%`).all();
                } else {
                    results = await this.db.prepare(
                        `SELECT ${table.keyField} FROM ${table.name}`
                    ).all();
                }

                results.results.forEach(row => {
                    const key = this._buildKey(table.name, row[table.keyField]);
                    if (key.startsWith(effectivePrefix)) {
                        keys.push({ name: key });
                    }
                });
            }

            return keys;
        } catch (error) {
            console.error(`[D1] Failed to list keys with prefix ${prefix}:`, error);
            return [];
        }
    }

    /**
     * 解析 key，确定对应的表、查询字段和查询值
     */
    _parseKey(key) {
        if (key === DATA_KEYS.SUBSCRIPTIONS) {
            return { table: 'subscriptions', queryField: 'id', queryValue: 'main', dataField: 'data' };
        } else if (key === DATA_KEYS.PROFILES) {
            return { table: 'profiles', queryField: 'id', queryValue: 'main', dataField: 'data' };
        } else if (key === DATA_KEYS.SETTINGS) {
            return { table: 'settings', queryField: 'key', queryValue: 'main', dataField: 'value' };
        } else if (key === DATA_KEYS.CRON_LAST_EXECUTION) {
            return { table: 'cron_executions', queryField: 'id', queryValue: 'last', dataField: 'data' };
        } else {
            // 处理其他格式的 key，默认作为 settings 表的 key，但记录警告
            console.warn(`[D1 Storage] Unknown key format: ${key}, treating as settings key`);
            return { table: 'settings', queryField: 'key', queryValue: key, dataField: 'value' };
        }
    }

    /**
     * 构建 key
     */
    _buildKey(table, keyValue) {
        if (table === 'subscriptions' && keyValue === 'main') {
            return DATA_KEYS.SUBSCRIPTIONS;
        } else if (table === 'profiles' && keyValue === 'main') {
            return DATA_KEYS.PROFILES;
        } else if (table === 'settings' && keyValue === 'main') {
            return DATA_KEYS.SETTINGS;
        } else if (table === 'cron_executions' && keyValue === 'last') {
            return DATA_KEYS.CRON_LAST_EXECUTION;
        } else {
            return keyValue;
        }
    }
}

/**
 * 判断一个值是否像 KV namespace（有 get/put/delete 方法）
 */
function isKVNamespace(val) {
    return val && typeof val === 'object' &&
        typeof val.get === 'function' &&
        typeof val.put === 'function' &&
        typeof val.delete === 'function';
}

/**
 * 解析 KV 命名空间
 * EdgeOne Pages: KV 作为全局变量注入（globalThis.MISUB_KV），而非通过 env
 * Cloudflare Pages: KV 通过 env.MISUB_KV 注入
 * 同时支持自动探测，兼容任意绑定名
 * @param {Object} env
 * @returns {Object|null}
 */
function resolveKV(env) {
    // 1. Cloudflare Pages 方式：env.MISUB_KV
    if (env && isKVNamespace(env.MISUB_KV)) return env.MISUB_KV;

    // 2. EdgeOne Pages 方式：KV 作为全局变量注入
    if (typeof MISUB_KV !== 'undefined' && isKVNamespace(MISUB_KV)) return MISUB_KV;  // eslint-disable-line no-undef

    // 3. 自动探测 env 中其他 KV 绑定（仅允许变量名包含 KV，避免误识别）
    if (env) {
        for (const key of Object.keys(env)) {
            if (!String(key).toUpperCase().includes('KV')) continue;
            if (isKVNamespace(env[key])) {
                console.log(`[Storage] Auto-detected KV in env: ${key}`);
                return env[key];
            }
        }
    }

    // 4. 自动探测 globalThis 中其他 KV 绑定（仅允许变量名包含 KV，避免误识别）
    for (const key of Object.keys(globalThis)) {
        if (key.startsWith('_') || key === 'globalThis') continue;
        if (!String(key).toUpperCase().includes('KV')) continue;
        try {
            const val = globalThis[key];
            if (isKVNamespace(val)) {
                console.log(`[Storage] Auto-detected KV in globalThis: ${key}`);
                return val;
            }
        } catch (_) { /* 忽略访问器异常 */ }
    }

    return null;
}

let _globalSettingsCache = {
    data: null,
    timestamp: 0
};
const SETTINGS_CACHE_TTL_MS = 60 * 1000; // 60秒缓存过时

export class SettingsCache {
    /**
     * 带内存缓存的设置读取
     */
    static async get(env) {
        const now = Date.now();
        if (_globalSettingsCache.data && (now - _globalSettingsCache.timestamp < SETTINGS_CACHE_TTL_MS)) {
            return _globalSettingsCache.data;
        }

        try {
            let settings = null;
            if (env.MISUB_DB) {
                try {
                    const d1Adapter = new D1StorageAdapter(env.MISUB_DB);
                    settings = await d1Adapter.get(DATA_KEYS.SETTINGS);
                } catch (d1Error) {
                    console.warn('[Storage Cache] Failed to read from D1:', d1Error.message);
                }
            }

            const kvNs = resolveKV(env);
            if (!settings && kvNs) {
                try {
                    const raw = await kvNs.get(DATA_KEYS.SETTINGS);
                    settings = raw ? JSON.parse(raw) : null;
                } catch (kvError) {
                    console.warn('[Storage Cache] Failed to read from KV:', kvError.message);
                }
            }

            if (settings) {
                _globalSettingsCache.data = settings;
                _globalSettingsCache.timestamp = now;
                return settings;
            }
        } catch (error) {
            console.error('[Storage Cache] Failed to read settings:', error);
        }

        return null;
    }

    /**
     * 在更新设置后主动清除缓存
     */
    static clear() {
        _globalSettingsCache = { data: null, timestamp: 0 };
    }
}

/**
 * 存储工厂类
 * 根据配置创建相应的存储适配器
 */
export class StorageFactory {
    /**
     * 解析 KV 命名空间（委托顶层函数）
     */
    static resolveKV(env) {
        return resolveKV(env);
    }

    /**
     * 创建存储适配器
     * @param {Object} env - Cloudflare 环境对象
     * @param {string} storageType - 存储类型 ('kv' | 'd1')
     * @returns {KVStorageAdapter|D1StorageAdapter}
     */
    static createAdapter(env, storageType = STORAGE_TYPES.D1) {
        const resolvedStorageType = normalizeStorageType(storageType) || StorageFactory.getDefaultStorageType(env);

        switch (resolvedStorageType) {
            case STORAGE_TYPES.D1:
                if (!env.MISUB_DB) {
                    throw new Error('D1 storage was selected but MISUB_DB is not bound');
                }
                return new D1StorageAdapter(env.MISUB_DB);

            case STORAGE_TYPES.KV:
            default: {
                const kv = StorageFactory.resolveKV(env);
                if (kv) {
                    return new KVStorageAdapter(kv);
                }
                throw new Error('KV storage was selected but MISUB_KV is not bound');
            }
        }
    }

    static getDefaultStorageType(env) {
        if (env?.MISUB_DB) {
            return STORAGE_TYPES.D1;
        }

        if (StorageFactory.resolveKV(env)) {
            return STORAGE_TYPES.KV;
        }

        return STORAGE_TYPES.D1;
    }


    /**
     * 获取当前存储类型设置
     * @param {Object} env - Cloudflare 环境对象
     * @returns {Promise<string>} 存储类型
     */
    static async getStorageType(env) {
        try {
            const settings = await SettingsCache.get(env);
            const configuredStorageType = normalizeStorageType(settings?.storageType);
            if (configuredStorageType) {
                return configuredStorageType;
            }
            return StorageFactory.getDefaultStorageType(env);
        } catch (error) {
            console.error('[Storage] Failed to get storage type:', error);
            return StorageFactory.getDefaultStorageType(env);
        }
    }

    /**
     * 检查是否配置了双重存储
     * @param {Object} env - Cloudflare环境对象
     * @returns {boolean} 是否配置了双重存储
     */
    static hasDualStorage(env) {
        return !!(StorageFactory.resolveKV(env) && env.MISUB_DB);
    }
}

/**
 * 数据迁移工具
 */
export class DataMigrator {
    /**
     * 从 KV 迁移到 D1
     * @param {Object} env - Cloudflare 环境对象
     * @returns {Promise<Object>} 迁移结果
     */
    static async migrateKVToD1(env) {
        const kvNs = resolveKV(env);
        if (!kvNs) throw new Error('No KV binding found');
        if (!env.MISUB_DB) throw new Error('No D1 binding found');
        const source = new KVStorageAdapter(kvNs);
        const target = new D1StorageAdapter(env.MISUB_DB);
        const results = { subscriptions: 'absent', profiles: 'absent', settings: 'absent', errors: [] };
        const entries = [
            ['subscriptions', DATA_KEYS.SUBSCRIPTIONS, value => value],
            ['profiles', DATA_KEYS.PROFILES, value => value],
            ['settings', DATA_KEYS.SETTINGS, value => ({ ...value, storageType: STORAGE_TYPES.D1 })]
        ];

        for (const [label, key, transform] of entries) {
            try {
                const sourceValue = await source.get(key);
                if (sourceValue === null) continue;
                const expected = transform(sourceValue);
                const current = await target.get(key);
                if (current !== null && JSON.stringify(current) !== JSON.stringify(expected)) {
                    throw new Error('target contains different data');
                }
                if (current === null) await target.put(key, expected);
                const verified = await target.get(key);
                if (JSON.stringify(verified) !== JSON.stringify(expected)) {
                    throw new Error('read-after-write verification failed');
                }
                results[label] = current === null ? 'migrated' : 'verified';
            } catch (error) {
                results.errors.push(`${label}: ${error.message}`);
            }
        }
        return results;
    }
}
