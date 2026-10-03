"""Validate the declared committed scan inputs without printing their content."""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

MAX_BYTES = 5 * 1024 * 1024


def validate_npm_tree(root: Path) -> None:
    npm = shutil.which("npm")
    if npm is None:
        raise ValueError("native_npm_unavailable")
    command = [npm]
    if Path(npm).suffix.lower() in {".cmd", ".bat"}:
        node = shutil.which("node")
        if node is None:
            raise ValueError("native_npm_unavailable")
        cli = Path(node).resolve().parent / "node_modules/npm/bin/npm-cli.js"
        if not cli.is_file():
            raise ValueError("native_npm_unavailable")
        command = [node, str(cli)]
    with tempfile.TemporaryDirectory(prefix="npm-input-check-") as cache:
        with tempfile.TemporaryFile() as output:
            result = subprocess.run(
                [*command, "ls", "--package-lock-only", "--depth=0", "--json",
                 "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
                 "--cache", cache],
                cwd=root, stdout=output, stderr=subprocess.DEVNULL, timeout=30,
                check=False,
            )
            output.seek(0)
            raw = output.read(MAX_BYTES + 1)
    if result.returncode != 0 or len(raw) > MAX_BYTES:
        raise ValueError("invalid_npm_direct_resolution")
    report = json.loads(raw)
    if not isinstance(report, dict) or report.get("problems"):
        raise ValueError("invalid_npm_direct_resolution")


def read_input(root: Path, name: str) -> str:
    path = root / name
    if path.is_symlink() or not path.is_file():
        raise ValueError("missing_or_unsafe_input")
    with path.open("rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("input_limit_exceeded")
    return raw.decode("utf-8")


def validate(root: Path, ecosystem: str) -> list[str]:
    if ecosystem == "gomod":
        manifest = read_input(root, "go.mod")
        checksums = read_input(root, "go.sum").splitlines()
        if not re.search(r"(?m)^module\s+\S+\s*$", manifest):
            raise ValueError("invalid_go_manifest")
        if not re.search(r"(?m)^go\s+\d+\.\d+(?:\.\d+)?\s*$", manifest):
            raise ValueError("invalid_go_manifest")
        checksum = re.compile(r"\S+ v\S+(?:/go.mod)? h1:[A-Za-z0-9+/]{43}=")
        if not checksums or any(not checksum.fullmatch(line) for line in checksums):
            raise ValueError("invalid_go_checksums")
        return ["go.mod", "go.sum"]
    manifest = json.loads(read_input(root, "package.json"))
    lock = json.loads(read_input(root, "package-lock.json"))
    if not isinstance(manifest, dict) or not isinstance(lock, dict):
        raise ValueError("invalid_npm_input")
    packages = lock.get("packages")
    if (type(lock.get("lockfileVersion")) is not int
            or lock["lockfileVersion"] not in {2, 3}
            or not isinstance(packages, dict) or "" not in packages
            or not isinstance(packages[""], dict)
            or len(packages) > 50_000
            or any(not isinstance(item, dict) for item in packages.values())):
        raise ValueError("invalid_npm_lock")
    if not isinstance(manifest.get("name"), str) or lock.get("name") != manifest["name"]:
        raise ValueError("npm_manifest_lock_mismatch")
    for field in ["dependencies", "devDependencies", "optionalDependencies"]:
        declared = manifest.get(field, {})
        if not isinstance(declared, dict) or packages[""].get(field, {}) != declared:
            raise ValueError("npm_manifest_lock_mismatch")
    validate_npm_tree(root)
    return ["package.json", "package-lock.json"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ecosystem", choices=["gomod", "npm"])
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        inputs = validate(args.root, args.ecosystem)
    except (OSError, UnicodeError, ValueError, TypeError, RecursionError,
            subprocess.SubprocessError):
        print(json.dumps({"inputs_valid": False, "error": "invalid_scan_inputs"}))
        return 2
    print(json.dumps({"inputs_valid": True, "inputs": inputs}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
