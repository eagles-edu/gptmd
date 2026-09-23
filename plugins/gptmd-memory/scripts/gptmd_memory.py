#!/usr/bin/env python3
"""Safe, local persistence primitives for the gptmd Codex plugin."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import Any


STORE_NAMES = {
    "agents": "AGENTS.md",
    "sop": "SOP.md",
    "history": "HISTORY.md",
    "lessons": "LESSONS-LEARNED.md",
}

SECRET_PATTERNS = [
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b(password|passwd|token|secret|api[_-]?key)\s*[:=]\s*[^\s<>{}\[\]]{8,}", re.I),
]


def find_root() -> Path:
    configured = os.environ.get("GPTMD_PROJECT_ROOT")
    if configured:
        root = Path(configured).expanduser().resolve()
        if (root / "persistence").is_dir():
            return root
        raise RuntimeError("GPTMD_PROJECT_ROOT must contain a persistence directory")

    starts = [Path.cwd(), Path(__file__).resolve()]
    for start in starts:
        current = start if start.is_dir() else start.parent
        for candidate in (current, *current.parents):
            if (candidate / "persistence").is_dir() and (candidate / "package.json").exists():
                return candidate
    raise RuntimeError("Could not find project root; set GPTMD_PROJECT_ROOT")


def store_paths(root: Path) -> dict[str, Path]:
    persistence = root / "persistence"
    return {key: persistence / filename for key, filename in STORE_NAMES.items()}


def reject_secrets(*values: str | None) -> None:
    combined = "\n".join(value or "" for value in values)
    for pattern in SECRET_PATTERNS:
        if pattern.search(combined):
            raise ValueError("Refusing to persist content that resembles a credential or private key")


def clean(value: Any, field: str, limit: int = 20_000) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    if "\x00" in value:
        raise ValueError(f"{field} contains a NUL byte")
    if len(value) > limit:
        raise ValueError(f"{field} exceeds the {limit}-character limit")
    return value.strip()


def search(root: Path, query: str, scope: str = "all", limit: int = 40) -> dict[str, Any]:
    query = clean(query, "query", 500)
    terms = [term.lower() for term in re.findall(r"\S+", query)]
    if not terms:
        raise ValueError("query must contain at least one search term")
    paths = store_paths(root)
    selected = paths if scope == "all" else {scope: paths.get(scope)}
    if scope != "all" and selected[scope] is None:
        raise ValueError(f"unknown scope: {scope}")

    matches: list[dict[str, Any]] = []
    for name, path in selected.items():
        if not path.exists():
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        for number, line in enumerate(lines, start=1):
            lowered = line.lower()
            if all(term in lowered for term in terms):
                matches.append({"store": name, "file": str(path.relative_to(root)), "line": number, "text": line[:1000]})
                if len(matches) >= limit:
                    return {"query": query, "matches": matches, "truncated": True}
    return {"query": query, "matches": matches, "truncated": False}


def status(root: Path) -> dict[str, Any]:
    stores = []
    for name, path in store_paths(root).items():
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        stores.append({"store": name, "file": str(path.relative_to(root)), "exists": path.exists(), "bytes": len(text.encode()), "lines": len(text.splitlines())})

    git_status = ""
    try:
        result = subprocess.run(
            ["git", "status", "--short", "--", "persistence"],
            cwd=root,
            text=True,
            capture_output=True,
            check=False,
            timeout=5,
        )
        git_status = result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        git_status = "unavailable"
    return {"root": str(root), "stores": stores, "git_status": git_status}


def append_entry(root: Path, kind: str, title: str, content: str, rationale: str | None = None, impact: str | None = None) -> dict[str, Any]:
    title = clean(title, "title", 300)
    content = clean(content, "content")
    rationale = rationale.strip() if rationale else ""
    impact = impact.strip() if impact else ""
    reject_secrets(title, content, rationale, impact)

    if kind not in STORE_NAMES:
        raise ValueError(f"kind must be one of: {', '.join(STORE_NAMES)}")
    path = store_paths(root)[kind]
    path.parent.mkdir(parents=True, exist_ok=True)

    if kind == "history":
        entry = f"\n## {date.today().isoformat()} — {title}\n\n**Decision:** {content}\n"
        if rationale:
            entry += f"\n**Rationale:** {rationale}\n"
        if impact:
            entry += f"\n**Impact:** {impact}\n"
    elif kind == "lessons":
        entry = f"\n## {title}\n\n**Date:** {date.today().isoformat()}\n\n**Lesson:** {content}\n"
        if rationale:
            entry += f"\n**Trigger / root cause:** {rationale}\n"
        if impact:
            entry += f"\n**Preventative rule:** {impact}\n"
    elif kind == "sop":
        entry = f"\n## {title}\n\n**Added:** {date.today().isoformat()}\n\n{content}\n"
        if impact:
            entry += f"\n**Verification:** {impact}\n"
    else:
        entry = f"\n- {content}\n"
        if rationale:
            entry += f"  - **Why:** {rationale}\n"

    with path.open("a", encoding="utf-8") as handle:
        handle.write(entry)
    return {"written": True, "kind": kind, "file": str(path.relative_to(root)), "title": title}


def self_improvement(root: Path, failure: str, cause: str, fix: str, prevention: str) -> dict[str, Any]:
    failure = clean(failure, "failure", 2_000)
    cause = clean(cause, "cause", 2_000)
    fix = clean(fix, "fix", 4_000)
    prevention = clean(prevention, "prevention", 2_000)
    return append_entry(
        root,
        "lessons",
        f"Verified fix: {failure[:120]}",
        f"{fix}\n\n**Evidence:** The failure was reproduced or observed, and the fix was verified.",
        rationale=f"{failure}\n\n{cause}",
        impact=prevention,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    search_parser = sub.add_parser("search")
    search_parser.add_argument("query")
    search_parser.add_argument("--scope", default="all", choices=["all", *STORE_NAMES])
    record_parser = sub.add_parser("record")
    record_parser.add_argument("kind", choices=STORE_NAMES)
    record_parser.add_argument("title")
    record_parser.add_argument("content")
    record_parser.add_argument("--rationale")
    record_parser.add_argument("--impact")
    improve_parser = sub.add_parser("improve")
    improve_parser.add_argument("failure")
    improve_parser.add_argument("cause")
    improve_parser.add_argument("fix")
    improve_parser.add_argument("prevention")
    args = parser.parse_args()
    try:
        root = find_root()
        if args.command == "status":
            result = status(root)
        elif args.command == "search":
            result = search(root, args.query, args.scope)
        elif args.command == "record":
            result = append_entry(root, args.kind, args.title, args.content, args.rationale, args.impact)
        else:
            result = self_improvement(root, args.failure, args.cause, args.fix, args.prevention)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(json.dumps({"written": False, "error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
