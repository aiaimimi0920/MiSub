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
Only verified reports can upload. Development workflows explicitly pass
`--advisory`: valid vulnerability exit 1 becomes a successful finding report,
while scanner/reporter exits and all findings remain recorded. Faults are never
converted: unknown exits, missing/bad JSON, invalid inventory/SARIF and upload
errors still fail. The OSV CLI's default mode retains vulnerability exit 1. The category preserves the previous OSV analysis key.
There are zero exceptions and no ignore-unfixed filter.

The upstream reporter can return 0 and empty SARIF for missing/bad JSON.
Hosted CI runs actual pinned binaries against offline synthetic fixtures to
reproduce and reject those cases, abnormal scanner/reporter exits, zero inputs,
and empty inventory, alongside healthy and known-vulnerability cases.
The advisory fixture is GO-2021-0053 from OSV-Scanner's v2.5.1 test data; it is
not a production exception. These binary tests are skipped outside hosted Linux.
The shared npm validator uses the existing npm's bundled Arborist to load the
virtual lock graph offline, without installs or lifecycle scripts. It follows all
applicable mandatory, peer, alias and linked resolutions, rejects missing or
incompatible transitive entries and missing link targets, and uses npm's platform
rules. Missing optional/optional-peer edges are allowed. Inapplicable optional
OS/CPU/libc subtrees are skipped, while applicable optional packages must still
have complete mandatory dependencies. This platform-specific graph check does
not remove any packages or vulnerabilities from OSV's full lock scan.

CodeQL scans JavaScript/TypeScript and GitHub Actions with security-extended
queries and full-branch analysis. Both languages use no-build extraction. Language categories remain
`/language:${{ matrix.language }}`. All actions have immutable SHA pins.
Checkout disables persisted credentials. Permissions are contents:read, plus
actions:read and security-events:write for upload jobs.

The summary separates finding metadata from diagnostic errors and failed
invocations. Development CodeQL workflows use `--advisory` after uploading complete SARIF.
Valid findings are reported without blocking the development check, including
all High and standard error findings. `--fail-on-findings` remains the explicit
strict mode: security severity >=7 or standard SARIF error level exits 1.
Diagnostic/inventory failures exit 2 in both modes. Counts include findings
beyond the bounded summary cap. Conflicting mode flags fail. Missing/invalid SARIF or upload errors
fail their job. Summary counts are SARIF results, not deduplicated native alerts;
source snippets, messages, and flows are omitted.

Local checks:

```sh
python3 scripts/check_security_inputs.py npm
node --test scripts/tests/codeql-summary.test.mjs scripts/tests/security-inputs.test.mjs
```

On Windows set `PYTHON` to an available Python 3 executable for the Node tests.
Real binary tests run through the pure dependency workflow. The known vulnerable
fixture proves raw scanner/reporter exit 1 and nonempty SARIF in both modes;
strict returns 1 and advisory returns 0 only after all validations pass.
Run `python3 scripts/tests/test_security_policy.py` for reporting policy checks.

Repository files establish CI entrypoints, not native security settings.
Dependabot alerts, dependency graph, automatic security updates, secret scanning,
and protection settings were not changed. Native status has not been independently verified by this task. Development reports use `GITHUB_STEP_SUMMARY` and existing Security alerts with
stable categories, so there is no new Issue/PR-comment write permission and no
repeated automatic Issue creation. Summaries contain bounded counts/rule IDs,
not source snippets, messages or credentials. Functional build/test steps and
scanner/upload failure propagation remain intact. Native required checks or
thresholds may act independently; this task does not change them. SARIF uploads succeeded in
real CI, but upload-failure fault injection has not been executed.

Development advisory is separate from publishing policy. Existing release and
production workflow files are unchanged; strict scanning entrypoints remain
available for their separately managed checks. This task runs no publication,
deployment, signing or maintenance workflows.

The existing docker-publish workflow logs in and pushes only when the repository
is `imzyb/misub`. The `aiaimimi0920/MiSub` fork retains both guards and only
builds on main pushes. A regression checks the exact login/push conditions.
