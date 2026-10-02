# Upstream Tracking

## Repositories

- Upstream: https://github.com/imzyb/MiSub
- EasyProxy fork: https://github.com/aiaimimi0920/MiSub
- Root integration path: upstreams/misub

## Baseline

- Audited upstream main: 8b0b6ff3e698483f4dc66c23eb3272f0138461bb
- EasyProxy integration branch: main

The integration branch carries EasyProxy-specific source aggregation,
connector metadata, deployment, persistence, and regression hardening. The
EasyProxy root repository pins a verified commit from this branch.

## EasyProxy Delta

- Aggregator-managed source partitions and manifest generation.
- ECH Worker and ZenProxy connector metadata for local EasyProxy runtimes.
- Cloudflare D1 and local SQLite storage adapters.
- Cron dashboard, operator-chain documentation, and deployment contracts.
- Regression coverage for authentication, storage, manifests, and sources.

## 2026-10-02 Upgrade Candidate

This integration is a deployment candidate, not authorization to migrate the
production database. The root production pointer must remain unchanged until
the operator approves migration, a protected backup is verified, and the
restore procedure is tested against an isolated database.

- Preserves fail-closed administrator authentication, stable runtime secrets,
  Manifest bearer authentication, Aggregator synchronization, and Cron history.
- Adapts collection reads/writes to the upstream row-level D1 model while
  retaining the Docker SQLite backend and advanced connector editor.
- Legacy migration validates IDs and existing rows, verifies inserted data,
  and conditionally removes the original main row only if it is unchanged.
  Migration requires a maintenance window: it is not atomic across both tables.
- Real SQLite regression tests cover invalid and conflicting input, failed
  batch rollback, concurrent source changes, idempotence, Manifest equivalence,
  and atomic collection replacement without stale rows.
- Automatic upstream merge and force-mirror workflows are disabled. They must
  not overwrite EasyProxy customizations or bypass migration review.

Rollback requires restoring the protected pre-migration database backup as well
as the previous Pages deployment. Reverting code alone is not a data rollback.

## Sync Policy

1. Fetch the official upstream into a dedicated sync branch.
2. Merge or cherry-pick upstream changes without dropping EasyProxy tests.
3. Review storage schema, authentication, source normalization, and connector
   metadata explicitly.
4. Run `npm ci`, `npm run test:run`, and `npm run build`.
5. Update the EasyProxy root submodule pointer only after data migration and
   deployment rollback checks pass.

Never copy runtime `.env`, SQLite data, generated `dist`, or deployment secrets
into the fork.
