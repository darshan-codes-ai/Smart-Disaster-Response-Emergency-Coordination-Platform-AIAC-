#!/usr/bin/env python3
"""
Automated conflict marker scanner.

Scans the repository for genuine Git merge conflict markers:
- Line starting with 7+ '<' (<<<<<<<)
- Line starting with 7+ '>' (>>>>>>>)
- Line starting with 7+ '|' (|||||||)
- Line consisting exclusively of 7+ '=' (=======)

Ignores .git, .next, node_modules, venv, and binary/cache files.
Exits with 0 if clean, or 1 if any genuine conflict marker is discovered.
"""

import os
import re
import sys
from pathlib import Path

# Conflict marker regexes
CONFLICT_PATTERNS = [
    (re.compile(r"^<{7}(?: .+)?$"), "conflict marker start (<<<<<<<)"),
    (re.compile(r"^>{7}(?: .+)?$"), "conflict marker end (>>>>>>>)"),
    (re.compile(r"^\|{7}(?: .+)?$"), "conflict marker ancestor (|||||||)"),
    (re.compile(r"^={7,}$"), "conflict marker separator (=======)"),
]

IGNORED_DIRS = {
    ".git",
    ".next",
    "node_modules",
    "venv",
    ".venv",
    "env",
    "__pycache__",
    "coverage",
    ".nyc_output",
    "out",
}

IGNORED_EXTENSIONS = {
    ".pyc",
    ".pyo",
    ".png",
    ".jpg",
    ".jpeg",
    ".ico",
    ".svg",
    ".webp",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".zip",
    ".tar",
    ".gz",
}


def scan_file(file_path: Path) -> list[tuple[int, str, str]]:
    findings = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line_no, line in enumerate(f, start=1):
                stripped = line.rstrip("\r\n")
                for pattern, desc in CONFLICT_PATTERNS:
                    if pattern.match(stripped):
                        findings.append((line_no, desc, stripped))
                        break
    except Exception as exc:
        print(f"Warning: could not read {file_path}: {exc}", file=sys.stderr)
    return findings


def scan_repository(root_dir: Path) -> dict[str, list[tuple[int, str, str]]]:
    all_findings = {}
    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Prune ignored directories in-place
        dirnames[:] = [d for d in dirnames if d not in IGNORED_DIRS]

        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext in IGNORED_EXTENSIONS:
                continue

            full_path = Path(dirpath) / fname
            findings = scan_file(full_path)
            if findings:
                rel_path = full_path.relative_to(root_dir).as_posix()
                all_findings[rel_path] = findings

    return all_findings


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    print(f"Scanning {repo_root} for unresolved Git merge conflict markers...")
    findings = scan_repository(repo_root)

    if findings:
        print("\n[ERROR] Unresolved conflict markers detected:")
        for rel_path, items in findings.items():
            for line_no, desc, snippet in items:
                print(f"  {rel_path}:{line_no} [{desc}] -> {snippet}")
        print(f"\nTotal files with conflict markers: {len(findings)}")
        return 1

    print("[OK] No unresolved conflict markers found across the repository.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

