import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

const MIGRATION_NAME_PATTERN = /^(\d{4})_([a-z0-9_-]+)\.sql$/;

function applyMigrations(db, migrationsDir) {
    const files = fs.readdirSync(migrationsDir)
        .filter(name => name.endsWith('.sql'))
        .sort();

    for (const fileName of files) {
        const match = MIGRATION_NAME_PATTERN.exec(fileName);
        if (!match) {
            throw new Error(`Invalid migration file name: ${fileName}`);
        }
        const migrationId = Number(match[1]);
        const migrationName = fileName.slice(0, -4);
        const applied = db.prepare(
            'SELECT name FROM schema_migrations WHERE migration_id = ?'
        ).get(migrationId);
        if (applied) {
            if (applied.name !== migrationName) {
                throw new Error(`Migration ${migrationId} was recorded as ${applied.name}, expected ${migrationName}`);
            }
            continue;
        }

        const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf-8');
        db.transaction(() => db.exec(sql))();
        const recorded = db.prepare(
            'SELECT name FROM schema_migrations WHERE migration_id = ?'
        ).get(migrationId);
        if (recorded?.name !== migrationName) {
            throw new Error(`Migration ${migrationName} did not record itself in schema_migrations`);
        }
    }
}

function initSchema(db, schemaPath, migrationsDir) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            expires_at INTEGER
        );
    `);

    if (migrationsDir && fs.existsSync(migrationsDir)) {
        db.exec(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                migration_id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);
        applyMigrations(db, migrationsDir);
    } else if (schemaPath && fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
    }
}

function createKvNamespace(db) {
    const getStmt = db.prepare('SELECT value, expires_at FROM kv_store WHERE key = ?');
    const putStmt = db.prepare('INSERT OR REPLACE INTO kv_store (key, value, expires_at) VALUES (?, ?, ?)');
    const deleteStmt = db.prepare('DELETE FROM kv_store WHERE key = ?');
    const listStmt = db.prepare(`
        SELECT key FROM kv_store
        WHERE key LIKE ?
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY key
        LIMIT ?
    `);
    const cleanupStmt = db.prepare('DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= ?');

    return {
        async get(key, type = 'text') {
            const row = getStmt.get(key);
            if (!row) return null;

            if (row.expires_at && row.expires_at <= Date.now()) {
                deleteStmt.run(key);
                return null;
            }

            if (type === 'json') {
                try {
                    return JSON.parse(row.value);
                } catch {
                    return null;
                }
            }

            return row.value;
        },

        async put(key, value, options = {}) {
            const payload = typeof value === 'string' ? value : JSON.stringify(value);
            const expiresAt = options.expirationTtl
                ? Date.now() + Number(options.expirationTtl) * 1000
                : null;
            putStmt.run(key, payload, expiresAt);
        },

        async delete(key) {
            deleteStmt.run(key);
        },

        async list(options = {}) {
            const prefix = options.prefix || '';
            const limit = Number(options.limit || 1000);
            const now = Date.now();

            cleanupStmt.run(now);
            const rows = listStmt.all(`${prefix}%`, now, limit);
            return {
                keys: rows.map(row => ({ name: row.key })),
                list_complete: true,
                cursor: null
            };
        }
    };
}

class D1PreparedStatement {
    constructor(stmt) {
        this.stmt = stmt;
        this.params = [];
    }

    bind(...params) {
        this.params = params;
        return this;
    }

    async first() {
        const row = this.stmt.get(...this.params);
        return row || null;
    }

    async all() {
        const rows = this.stmt.all(...this.params);
        return { results: rows };
    }

    async run() {
        const info = this.stmt.run(...this.params);
        return {
            success: true,
            meta: {
                changes: info.changes,
                last_row_id: info.lastInsertRowid
            }
        };
    }
}

class D1Database {
    constructor(db) {
        this.db = db;
    }

    async batch(statements) {
        return this.db.transaction(() => statements.map(statement => {
            const info = statement.stmt.run(...statement.params);
            return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
        }))();
    }

    prepare(sql) {
        return new D1PreparedStatement(this.db.prepare(sql));
    }
}

function createD1Database(db) {
    return new D1Database(db);
}

export function createSqliteStore({ dbPath, schemaPath, migrationsDir }) {
    ensureDir(dbPath);
    const db = new Database(dbPath);
    try {
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initSchema(db, schemaPath, migrationsDir);
    } catch (error) {
        db.close();
        throw error;
    }

    return {
        kv: createKvNamespace(db),
        d1: createD1Database(db),
        db
    };
}
