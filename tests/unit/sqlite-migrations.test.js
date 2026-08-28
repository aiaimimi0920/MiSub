import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteStore } from '../../server/storage/sqlite.js';

const migrationsDir = path.resolve('migrations');
const tempDirs = [];

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'misub-migration-'));
    tempDirs.push(dir);
    return dir;
}

function createLegacyDatabase(dbPath) {
    const db = new Database(dbPath);
    db.exec(`
        CREATE TABLE subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME, updated_at DATETIME);
        CREATE TABLE profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME, updated_at DATETIME);
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at DATETIME, updated_at DATETIME);
    `);
    const sources = [
        { id: 'sub-paid', kind: 'subscription', input: 'https://paid.example/sub', enabled: true },
        { id: 'proxy-one', kind: 'proxy_uri', input: 'ss://cipher:secret@example.com:443', enabled: true },
        { id: 'ech-one', kind: 'connector', input: 'https://ech.example:443', connector_type: 'ech_worker', connector_config: { access_token: 'test-ech-token' } },
        { id: 'zen-one', kind: 'connector', input: 'https://zen.example', connector_type: 'zenproxy_client', connector_config: { api_key: 'test-zen-key' } }
    ];
    const profiles = [
        { id: 'private', customId: 'private-profile', subscriptions: ['sub-paid'], manualNodes: ['proxy-one', 'ech-one', 'zen-one'], isPublic: false }
    ];
    const settings = { storageType: 'd1', cronSecret: 'test-cron-secret', customField: { keep: true } };
    db.prepare('INSERT INTO subscriptions (id, data) VALUES (?, ?)').run('main', JSON.stringify(sources));
    db.prepare('INSERT INTO profiles (id, data) VALUES (?, ?)').run('main', JSON.stringify(profiles));
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('main', JSON.stringify(settings));
    db.close();
}

function businessRows(db) {
    return {
        subscriptions: db.prepare('SELECT id, data FROM subscriptions ORDER BY id').all(),
        profiles: db.prepare('SELECT id, data FROM profiles ORDER BY id').all(),
        settings: db.prepare('SELECT key, value FROM settings ORDER BY key').all()
    };
}

function digest(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('SQLite migrations', () => {
    it('expands a populated legacy database without changing business rows and is idempotent', () => {
        const dbPath = path.join(makeTempDir(), 'misub.db');
        createLegacyDatabase(dbPath);
        const beforeDb = new Database(dbPath, { readonly: true });
        const beforeHash = digest(businessRows(beforeDb));
        beforeDb.close();

        const first = createSqliteStore({ dbPath, migrationsDir });
        expect(first.db.prepare('SELECT migration_id, name FROM schema_migrations ORDER BY migration_id').all()).toEqual([
            { migration_id: 1, name: '0001_initial' },
            { migration_id: 2, name: '0002_cron_executions' }
        ]);
        expect(digest(businessRows(first.db))).toBe(beforeHash);
        expect(first.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cron_executions'").get()).toBeTruthy();
        first.db.close();

        const second = createSqliteStore({ dbPath, migrationsDir });
        expect(digest(businessRows(second.db))).toBe(beforeHash);
        expect(second.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(2);
        second.db.close();
    });

    it('rolls back a failing migration file', () => {
        const dir = makeTempDir();
        const brokenMigrations = path.join(dir, 'migrations');
        fs.mkdirSync(brokenMigrations);
        fs.copyFileSync(path.join(migrationsDir, '0001_initial.sql'), path.join(brokenMigrations, '0001_initial.sql'));
        fs.writeFileSync(path.join(brokenMigrations, '0002_broken.sql'), `
            CREATE TABLE must_rollback (id TEXT PRIMARY KEY);
            INSERT INTO missing_table (id) VALUES ('fail');
        `, 'utf8');
        const dbPath = path.join(dir, 'broken.db');

        expect(() => createSqliteStore({ dbPath, migrationsDir: brokenMigrations })).toThrow();
        const db = new Database(dbPath, { readonly: true });
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='must_rollback'").get()).toBeUndefined();
        db.close();
    });
});
