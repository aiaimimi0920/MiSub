# Dependency and source security

This repository adapts the verified configuration from
[aiaimimi0920/Loom at 34f541c](https://github.com/aiaimimi0920/Loom/tree/34f541c4b6c60a868637f531db3b5dd04e5e4b66).
The bounded CodeQL summary and synthetic tests derive from that exact source.

Dependabot checks root npm dependencies and GitHub Actions weekly, with at most
three npm and two Actions version PRs. Minor/patch npm updates are grouped;
major versions stay individual. Cooldowns are 21/7/3 days for npm
major/minor/patch and seven days for Actions. No workflow approves, merges,
dismisses, or ignores alerts.

Dependency Security runs on PRs, main pushes, weekly, and manual dispatch.
It executes OSV scanner and reporter 2.5.1 directly from the immutable image
`ghcr.io/google/osv-scanner-action@sha256:dcd947131d8d11b8d0964de6590661fb921a4ecbd7b90a7cb21083acfc3fd8cc`.
The scanner explicitly reads committed root `package-lock.json`, after validating
its root declarations against `package.json` and native direct lock resolutions.
Containers run only in hosted Linux CI with no credentials, a read-only project
mount and filesystem, dropped capabilities, and bounded time/resources.

The repository runner preserves scanner exits: 0 is healthy, 1 is vulnerabilities,
and other statuses fail execution. Before calling the reporter it requires
bounded valid JSON, nonempty package inventory from the exact lock input, and
agreement between vulnerability inventory and exit status. The reporter must
return the matching 0/1 status and valid SARIF with the expected finding count.
Only verified reports can upload; a vulnerability still fails the scan step
while its SARIF uploads. The category preserves the previous OSV analysis key.
There are zero exceptions and no ignore-unfixed filter.

The upstream reporter can return 0 and empty SARIF for missing/bad JSON.
Hosted CI runs actual pinned binaries against offline synthetic fixtures to
reproduce and reject those cases, abnormal scanner/reporter exits, zero inputs,
and empty inventory, alongside healthy and known-vulnerability cases.
The advisory fixture is GO-2021-0053 from OSV-Scanner's v2.5.1 test data; it is
not a production exception. These binary tests are skipped outside hosted Linux.
The shared npm validator also uses native offline lock-only npm resolution for
direct dependencies, including alias, link, and optional dependency semantics.
It does not install packages or validate every transitive subtree.

CodeQL scans JavaScript/TypeScript and GitHub Actions with security-extended
queries and full-branch analysis. Both languages use no-build extraction. Language categories remain
`/language:${{ matrix.language }}`. All actions have immutable SHA pins.
Checkout disables persisted credentials. Permissions are contents:read, plus
actions:read and security-events:write for upload jobs.

The summary separates finding metadata from diagnostic errors and failed
invocations. Analysis success does not assert zero findings or impose a severity
gate. Findings remain visible for review. Missing/invalid SARIF or upload errors
fail their job. Summary counts are SARIF results, not deduplicated native alerts;
source snippets, messages, and flows are omitted.

Local checks:

```sh
python3 scripts/check_security_inputs.py npm
node --test scripts/tests/codeql-summary.test.mjs scripts/tests/security-inputs.test.mjs
```

On Windows set `PYTHON` to an available Python 3 executable for the Node tests.
Real binary tests run through the pure dependency workflow, without production
maintenance, deployment, publishing, signing, or secrets.

Repository files establish CI entrypoints, not native security settings.
Dependabot alerts, dependency graph, automatic security updates, secret scanning,
and protection settings were not changed. Native status is unverified: the
connector workflow-list endpoint was unavailable and no existing gh executable
was found in the local session.
