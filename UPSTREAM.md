# Upstream Tracking

## Repositories

- Upstream: https://github.com/imzyb/MiSub
- EasyProxy fork: https://github.com/aiaimimi0920/MiSub
- Root integration path: upstreams/misub

## Baseline

- Audited upstream main: 8f18021
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
