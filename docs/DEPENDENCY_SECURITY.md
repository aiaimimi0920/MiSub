# Dependency and source security

This repository adapts the verified configuration from
[aiaimimi0920/Loom at 34f541c](https://github.com/aiaimimi0920/Loom/tree/34f541c4b6c60a868637f531db3b5dd04e5e4b66).
The SARIF summary and synthetic tests are reused from that exact source.

Dependabot checks root npm dependencies and GitHub Actions weekly. Version updates
allow three npm and two Actions PRs; minor/patch npm updates are grouped and
major versions remain individual PRs. The version-update cooldown is seven days,
with major/minor/patch npm cooldowns of 21/7/3 days. Security updates are
separate from these version-update limits. No workflow approves, merges,
dismisses, or ignores alerts.

Dependency Security runs on PRs, main pushes, weekly, and manual dispatch.
OSV-Scanner is 2.5.1, with reusable workflow commit
`ffa0a5f39214d80778c9b494822d94d0d9668458` and underlying scanner/reporter
commit `baa4139e56d6312335d899e6ba045fa16d1d3d0b`.
It scans the committed root `package-lock.json`, after validating it against
`package.json`. Development and transitive entries stay in scope.
SARIF upload and fail-on-vuln are enabled. There are initially zero vulnerability
exceptions and no ignore-unfixed filter. Real findings must retain the failed
gate and be triaged; a successful scan reflects the database at scan time.

CodeQL scans JavaScript/TypeScript and GitHub Actions
with security-extended queries and full-branch analysis. JavaScript and Actions
use no-build extraction.
The source scope includes `src`, `functions`, and `server`; no package install
or product startup is needed for CodeQL extraction.
Language categories stay `/language:${{ matrix.language }}`.
All direct actions are immutable SHA pins. Checkout disables persisted credentials.
Permissions are contents:read, plus actions:read and security-events:write only
for the scan jobs. No production credentials or publishing workflow is called.

The bounded summary keeps finding metadata separate from scanner diagnostics:
`inventory_complete` means SARIF inventory validation succeeded;
`analysis_complete` also requires no failed invocation or error diagnostic.
Messages, source snippets and flows are omitted. Missing/invalid SARIF fails
closed; upload failures remain workflow failures. Counts are SARIF results,
not GitHub's deduplicated open alerts.

Run local synthetic checks from the repository root:

```sh
python3 scripts/check_security_inputs.py npm
node --test scripts/tests/codeql-summary.test.mjs scripts/tests/security-inputs.test.mjs
```

On Windows, set `PYTHON` to an available Python 3 executable for the Node tests.
For a real local advisory scan, use a verified OSV-Scanner 2.5.1 executable:

```sh
osv-scanner scan --format=json --lockfile=./package-lock.json
```

Repository files establish CI entrypoints, not native account settings.
Dependabot alerts, dependency graph, automatic security updates, secret scanning,
and repository branch protection were not enabled or changed by this work.
Their native availability/settings require separate read-only verification.
The connector's Actions workflow-list endpoint was unavailable during preparation.
