import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../check_security_inputs.py", import.meta.url));
const privateText = "PRIVATE_INPUT_MUST_NOT_BE_PRINTED";
const validGo = { "go.mod": "module fixture\n\ngo 1.24.10\n",
  "go.sum": `example.invalid/dependency v1.0.0 h1:${"A".repeat(43)}=\n` };
const validNpm = { "package.json": JSON.stringify({ name: "fixture", dependencies: { sample: "1.0.0" } }),
  "package-lock.json": JSON.stringify({ name: "fixture", lockfileVersion: 3,
    packages: { "": { dependencies: { sample: "1.0.0" } } } }) };

function check(ecosystem, files, extra = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scan-inputs-"));
  try {
    for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), value);
    const output = spawnSync(process.env.PYTHON || "python3",
      [script, ecosystem, "--root", directory, ...extra],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 1_000_000 });
    assert.ifError(output.error);
    assert.ok(!(output.stdout + output.stderr).includes(privateText));
    return output;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

for (const [ecosystem, files] of [["gomod", validGo], ["npm", validNpm]]) {
  test(`${ecosystem} committed inputs validate`, () => assert.equal(check(ecosystem, files).status, 0));
  for (const name of Object.keys(files)) test(`${ecosystem} missing ${name} fails closed`, () => {
    const missing = { ...files }; delete missing[name];
    const output = check(ecosystem, missing);
    assert.equal(output.status, 2);
    assert.equal(JSON.parse(output.stdout).inputs_valid, false);
  });
}
for (const [ecosystem, files] of [
  ["gomod", { ...validGo, "go.mod": privateText }],
  ["gomod", { ...validGo, "go.sum": privateText }],
  ["npm", { ...validNpm, "package-lock.json": privateText }],
  ["npm", { ...validNpm, "package-lock.json": "{}" }],
  ["npm", { ...validNpm, "package.json": JSON.stringify({ name: "other" }) }],
]) test(`${ecosystem} malformed or mismatched inputs fail without content`, () => {
  const output = check(ecosystem, files);
  assert.equal(output.status, 2);
  assert.equal(JSON.parse(output.stdout).inputs_valid, false);
});

test("illegal scanner-contract arguments cannot succeed", () => {
  assert.equal(check("gomod", validGo, ["--unexpected"]).status, 2);
});

test("oversized input is rejected", () => {
  assert.equal(check("gomod", { ...validGo, "go.sum": " ".repeat(5 * 1024 * 1024 + 1) }).status, 2);
});

test("dependency gate uses explicit inventory and fixed trusted reusable workflow", () => {
  const workflow = fs.readFileSync(new URL("../../.github/workflows/dependency-security.yml", import.meta.url), "utf8");
  for (const text of [
    "google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@ffa0a5f39214d80778c9b494822d94d0d9668458",
    "upload-sarif: true", "fail-on-vuln: true", "needs: verify-inputs",
    "security-events: write", "contents: read", "actions: read",
    "node --test scripts/tests/codeql-summary.test.mjs scripts/tests/security-inputs.test.mjs",
  ]) assert.ok(workflow.includes(text), `missing ${text}`);
  assert.ok(/--lockfile=\.\/(?:go\.mod|package-lock\.json)/.test(workflow));
  for (const forbidden of ["ignore-unfixed", "--config", "continue-on-error", "secrets: inherit",
    "pull_request_target", "workflow_call:", "contents: write", "category:"]) {
    assert.ok(!workflow.includes(forbidden), `forbidden ${forbidden}`);
  }
  for (const line of workflow.matchAll(/uses:\s+(\S+)/g)) assert.match(line[1], /@[a-f0-9]{40}$/);
});
