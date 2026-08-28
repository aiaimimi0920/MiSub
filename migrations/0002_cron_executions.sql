CREATE TABLE IF NOT EXISTS cron_executions (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cron_executions_updated_at ON cron_executions(updated_at);

INSERT OR IGNORE INTO schema_migrations (migration_id, name)
VALUES (2, '0002_cron_executions');
