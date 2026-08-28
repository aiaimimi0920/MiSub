# MiSub database migrations

`schema.sql` is a snapshot for creating a new database. Existing databases must
be upgraded with the ordered SQL files in this directory.

## Apply

Local SQLite applies these files transactionally at startup. Cloudflare D1 uses
Wrangler's migration runner:

```sh
npx wrangler d1 migrations list <database-name> --remote
npx wrangler d1 migrations apply <database-name> --remote
```

Migration names use a four-digit monotonically increasing prefix. Every file is
expand-only during its first stable release and records its ID in
`schema_migrations`.

## Verify

After applying migrations, verify that `schema_migrations` contains all expected
IDs and compare the logical backup counts and checksum captured before the
upgrade. Existing `subscriptions`, `profiles`, and `settings` rows must remain
byte-for-byte unchanged.

## Recovery

Do not edit an applied migration. On failure, keep the existing database and
deployment, then restore the encrypted pre-update export into a disposable D1
database first. Promote a restore only after its schema version, row counts,
logical checksum, profile references, and connector records match the backup.

Migration `0002` only adds `cron_executions`; the optimization baseline can
therefore run against the expanded schema without a database rollback.
