#!/usr/bin/env python3
"""Local-first CuratorMD primitives for the gptmd project."""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator


STORE_NAMES = {
    "agents": "AGENTS.md",
    "sop": "SOP.md",
    "history": "HISTORY.md",
    "lessons": "LESSONS-LEARNED.md",
}
STORE_KINDS = frozenset(STORE_NAMES)
INBOX_RETENTION_DAYS = 30
MAX_PAYLOAD_BYTES = 24_000
SCHEMA_VERSION = 2

SECRET_PATTERNS = (
    re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----", re.I | re.S),
    re.compile(r"\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"(?i)\b(?:password|passwd|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s<>{}\[\]]{8,}"),
    re.compile(r"(?i)\b(?:https?|redis|postgres(?:ql)?)://[^\s/@:]+:[^\s/@]+@"),
)
SECRET_KEY_RE = re.compile(r"(?i)(?:password|passwd|token|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)")


class CuratorError(RuntimeError):
    """A safe, user-facing CuratorMD failure."""


class CurationBusy(CuratorError):
    """Another curator currently owns the project lock."""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat().replace("+00:00", "Z")


def clean(value: Any, field: str, limit: int = 20_000) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    if "\x00" in value:
        raise ValueError(f"{field} contains a NUL byte")
    if len(value) > limit:
        raise ValueError(f"{field} exceeds the {limit}-character limit")
    return value.strip()


def reject_secrets(*values: str | None) -> None:
    combined = "\n".join(value or "" for value in values)
    for pattern in SECRET_PATTERNS:
        if pattern.search(combined):
            raise ValueError("Refusing to persist content that resembles a credential or private key")


def redact_text(value: str) -> str:
    redacted = value
    for pattern in SECRET_PATTERNS:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def redact_payload(value: Any, *, key: str = "") -> Any:
    if SECRET_KEY_RE.search(key):
        return "[REDACTED]"
    if isinstance(value, str):
        return redact_text(value[:8_000])
    if isinstance(value, dict):
        return {str(k)[:120]: redact_payload(v, key=str(k)) for k, v in list(value.items())[:100]}
    if isinstance(value, list):
        return [redact_payload(item, key=key) for item in value[:100]]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return redact_text(str(value)[:8_000])


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _run_git(root: Path, *args: str, timeout: int = 5) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=root, text=True, capture_output=True, check=False, timeout=timeout)


def resolve_project_root(project_root: str | os.PathLike[str] | None, *, allow_default: bool = False) -> Path:
    """Fail closed unless the path resolves to the Git worktree root with persistence/."""
    if project_root is None:
        if not allow_default:
            raise CuratorError("project_root is required and must be an absolute path")
        configured = os.environ.get("GPTMD_PROJECT_ROOT")
        candidate = Path(configured).expanduser() if configured else Path.cwd()
    else:
        candidate = Path(project_root).expanduser()
    if not candidate.is_absolute():
        raise CuratorError("project_root must be an absolute path")
    try:
        root = candidate.resolve(strict=True)
    except OSError as exc:
        raise CuratorError(f"project_root is missing or unreadable: {candidate}") from exc
    if not root.is_dir():
        raise CuratorError("project_root must be a directory")
    result = _run_git(root, "rev-parse", "--show-toplevel")
    if result.returncode != 0 or not result.stdout.strip():
        raise CuratorError("project_root must be inside a Git worktree")
    try:
        worktree = Path(result.stdout.strip()).resolve(strict=True)
    except OSError as exc:
        raise CuratorError("Git worktree root is unavailable") from exc
    if root != worktree:
        raise CuratorError(f"project_root must be the Git worktree root: {worktree}")
    if not (root / "persistence").is_dir():
        raise CuratorError("project_root must contain persistence/")
    return root


def store_paths(root: Path) -> dict[str, Path]:
    persistence = root / "persistence"
    return {key: persistence / filename for key, filename in STORE_NAMES.items()}


def _safe_relpath(path: Path, root: Path) -> str:
    try:
        return str(path.resolve().relative_to(root))
    except ValueError:
        return "[outside-project]"


def _file_metadata(root: Path, relative: str) -> dict[str, Any]:
    path = root / relative
    if not path.is_file():
        return {"path": relative, "present": False}
    data = path.read_bytes()
    return {"path": relative, "present": True, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def _approved_manifest_metadata(root: Path) -> dict[str, Any]:
    manifests = [
        "package.json", "package-lock.json", "nuxt.config.ts", "tsconfig.json",
        "Dockerfile", "compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml",
        ".github/workflows", ".circleci/config.yml",
    ]
    result: dict[str, Any] = {}
    for relative in manifests:
        path = root / relative
        if path.is_dir():
            result[relative] = {"present": True, "files": sorted(_safe_relpath(item, root) for item in path.rglob("*") if item.is_file())[:100]}
        else:
            result[relative] = _file_metadata(root, relative)
    package = root / "package.json"
    if package.is_file():
        try:
            data = json.loads(package.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                result["package.json"]["name"] = data.get("name")
                result["package.json"]["scripts"] = sorted(str(k) for k in (data.get("scripts") or {}) if isinstance(k, str))
                result["package.json"]["dependencies"] = sorted(str(k) for k in (data.get("dependencies") or {}) if isinstance(k, str))
                result["package.json"]["devDependencies"] = sorted(str(k) for k in (data.get("devDependencies") or {}) if isinstance(k, str))
        except (OSError, json.JSONDecodeError):
            result["package.json"]["parse"] = "unavailable"
    return result


def _persistence_health(root: Path) -> dict[str, Any]:
    stores = []
    for name, path in store_paths(root).items():
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        stores.append({
            "store": name, "file": str(path.relative_to(root)), "exists": path.exists(),
            "bytes": len(text.encode()), "lines": len(text.splitlines()),
            "merge_conflict_markers": any(marker in text for marker in ("<<<<<<<", "=======", ">>>>>>>")),
        })
    return {"stores": stores, "healthy": all(item["exists"] and not item["merge_conflict_markers"] for item in stores)}


def _git_state(root: Path) -> dict[str, Any]:
    branch = _run_git(root, "branch", "--show-current").stdout.strip()
    status = _run_git(root, "status", "--short", "--untracked-files=all").stdout.splitlines()
    diff = _run_git(root, "diff", "--", "persistence").stdout
    staged = _run_git(root, "diff", "--cached", "--", "persistence").stdout
    return {
        "branch": branch or "detached", "status": status[:200], "status_truncated": len(status) > 200,
        "persistence_diff_sha256": sha256_text(diff + "\n" + staged), "persistence_diff_bytes": len((diff + staged).encode()),
    }


def environment_snapshot(project_root: str | os.PathLike[str]) -> dict[str, Any]:
    root = resolve_project_root(project_root)
    manifests = _approved_manifest_metadata(root)
    return {
        "schema_version": SCHEMA_VERSION, "project_root": str(root), "captured_at": iso_now(),
        "git": _git_state(root), "approved_manifests": manifests,
        "ci_container_markers": {
            "github_workflows": (root / ".github/workflows").is_dir(), "circleci": (root / ".circleci/config.yml").is_file(),
            "dockerfiles": sorted(path.name for path in root.glob("Dockerfile*")),
            "compose_files": sorted(path.name for path in root.glob("*compose*.y*ml")),
        },
        "known_commands": {"package_scripts": manifests.get("package.json", {}).get("scripts", []), "fixed": ["git status --short", "npm run build", "hermes status", "codex doctor"]},
        "persistence": _persistence_health(root),
    }


def _plugin_data_root(root: Path, profile: str | None = None) -> Path:
    configured = os.environ.get("CURATORMD_PLUGIN_DATA")
    base = Path(configured).expanduser() if configured else Path(os.environ.get("HERMES_HOME", "~/.hermes")).expanduser() / "PLUGIN_DATA"
    profile_name = clean(profile or os.environ.get("HERMES_PROFILE", "gptmd-coding"), "profile", 120)
    return base / "curatormd" / profile_name / sha256_text(str(root))[:24]


def _state_path(root: Path, profile: str | None = None) -> Path:
    return _plugin_data_root(root, profile) / "state.json"


def _load_state(root: Path, profile: str | None = None) -> dict[str, Any]:
    path = _state_path(root, profile)
    if not path.is_file():
        return {"schema_version": SCHEMA_VERSION, "project_root": str(root), "processed": {}, "cursor": None, "observer": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CuratorError(f"CuratorMD state is unreadable: {path}") from exc
    if not isinstance(data, dict) or data.get("project_root") != str(root):
        raise CuratorError("CuratorMD state belongs to another project")
    return data


def _atomic_json(path: Path, data: Any, *, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def _save_state(root: Path, state: dict[str, Any], profile: str | None = None) -> None:
    state["schema_version"] = SCHEMA_VERSION
    state["project_root"] = str(root)
    _atomic_json(_state_path(root, profile), state)


def _inbox_dir(root: Path) -> Path:
    path = root / ".curatormd" / "native-inbox"
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(root / ".curatormd", 0o700)
    os.chmod(path, 0o700)
    return path


def _cleanup_inbox(root: Path) -> int:
    cutoff = utc_now() - timedelta(days=INBOX_RETENTION_DAYS)
    removed = 0
    for path in _inbox_dir(root).glob("*.json"):
        try:
            if datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) < cutoff:
                path.unlink()
                removed += 1
        except (OSError, ValueError):
            continue
    return removed


def native_projection_record(project_root: str | os.PathLike[str], source_id: str, event_type: str, payload: Any, cursor: str | None = None, profile: str | None = None) -> dict[str, Any]:
    root = resolve_project_root(project_root)
    source_id = clean(source_id, "source_id", 300)
    event_type = clean(event_type, "event_type", 120)
    if not isinstance(payload, (dict, list, str)):
        raise ValueError("payload must be an object, array, or string")
    safe_payload = redact_payload(payload)
    if len(canonical_json(safe_payload).encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ValueError(f"payload exceeds the {MAX_PAYLOAD_BYTES}-byte limit")
    fingerprint = sha256_text(canonical_json({"source_id": source_id, "event_type": event_type, "payload": safe_payload}))
    record_id = sha256_text(f"{source_id}:{fingerprint}")[:32]
    record = {
        "schema_version": SCHEMA_VERSION, "record_id": record_id, "project_root": str(root),
        "source_id": source_id, "event_type": event_type, "fingerprint": fingerprint,
        "cursor": clean(cursor, "cursor", 300) if cursor else None, "captured_at": iso_now(),
        "reviewed": False, "payload": safe_payload,
    }
    path = _inbox_dir(root) / f"{record_id}.json"
    duplicate = path.exists()
    if not duplicate:
        _atomic_json(path, record)
    state = _load_state(root, profile)
    state["observer"] = {"last_seen_at": record["captured_at"], "last_source_id": source_id, "status": "healthy", "inbox": ".curatormd/native-inbox/"}
    state["capture_status"] = "healthy"
    if cursor:
        state["cursor"] = cursor
    _save_state(root, state, profile)
    _cleanup_inbox(root)
    return {"written": not duplicate, "duplicate": duplicate, "record_id": record_id, "file": _safe_relpath(path, root), "capture": "healthy"}


def _knowledge_conflict(root: Path, path: Path) -> bool:
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    if any(marker in text for marker in ("<<<<<<<", "=======", ">>>>>>>")):
        return True
    return bool(_run_git(root, "status", "--short", "--", str(path.relative_to(root))).stdout.strip())


def _append_reviewed(root: Path, kind: str, title: str, content: str, rationale: str, impact: str) -> dict[str, Any]:
    title, content = clean(title, "title", 300), clean(content, "content")
    rationale, impact = rationale.strip(), impact.strip()
    reject_secrets(title, content, rationale, impact)
    if kind not in STORE_KINDS:
        raise ValueError(f"kind must be one of: {', '.join(sorted(STORE_KINDS))}")
    path = store_paths(root)[kind]
    if _knowledge_conflict(root, path):
        raise CuratorError(f"knowledge document has unresolved or uncommitted edits: {path.relative_to(root)}")
    if kind == "history":
        entry = f"\n## {datetime.now().date().isoformat()} — {title}\n\n**Decision:** {content}\n"
        if rationale: entry += f"\n**Rationale:** {rationale}\n"
        if impact: entry += f"\n**Impact:** {impact}\n"
    elif kind == "lessons":
        entry = f"\n## {title}\n\n**Date:** {datetime.now().date().isoformat()}\n\n**Lesson:** {content}\n"
        if rationale: entry += f"\n**Trigger / root cause:** {rationale}\n"
        if impact: entry += f"\n**Preventative rule:** {impact}\n"
    elif kind == "sop":
        entry = f"\n## {title}\n\n**Added:** {datetime.now().date().isoformat()}\n\n{content}\n"
        if impact: entry += f"\n**Verification:** {impact}\n"
    else:
        entry = f"\n- {content}\n" + (f"  - **Why:** {rationale}\n" if rationale else "")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(entry)
    return {"written": True, "kind": kind, "file": str(path.relative_to(root)), "title": title}


@contextlib.contextmanager
def curation_lock(root: Path) -> Iterator[dict[str, Any]]:
    lock_path = root / ".curatormd" / "curation.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(lock_path.parent, 0o700)
    handle = lock_path.open("a+", encoding="utf-8")
    try:
        os.chmod(lock_path, 0o600)
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise CurationBusy("another CuratorMD run holds the project lock") from exc
        owner = {"pid": os.getpid(), "started_at": iso_now(), "lock": str(lock_path.relative_to(root))}
        handle.seek(0)
        handle.truncate()
        json.dump(owner, handle)
        handle.flush()
        yield owner
    finally:
        with contextlib.suppress(OSError): fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def _load_inbox(root: Path) -> list[dict[str, Any]]:
    records = []
    for path in sorted(_inbox_dir(root).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and data.get("project_root") == str(root): records.append(data)
    return records


def curate(project_root: str | os.PathLike[str], *, schedule_slot: str = "06:00 Asia/Ho_Chi_Minh", profile: str | None = None) -> dict[str, Any]:
    root = resolve_project_root(project_root)
    with curation_lock(root) as owner:
        state = _load_state(root, profile)
        state["lock"], state["schedule_slot"], state["last_run_started_at"] = owner, schedule_slot, owner["started_at"]
        _save_state(root, state, profile)
        before = environment_snapshot(str(root))
        _cleanup_inbox(root)
        processed = state.setdefault("processed", {})
        written, ambiguous, duplicates, conflicts = [], [], [], []
        for record in _load_inbox(root):
            record_id, fingerprint = str(record.get("record_id") or ""), str(record.get("fingerprint") or "")
            if not record_id or not fingerprint: continue
            if processed.get(record_id) == fingerprint:
                duplicates.append(record_id); continue
            candidate = record.get("candidate")
            if not record.get("reviewed") or not isinstance(candidate, dict):
                ambiguous.append(record_id); processed[record_id] = fingerprint; continue
            try:
                result = _append_reviewed(root, str(candidate.get("kind") or ""), str(candidate.get("title") or ""), str(candidate.get("content") or ""), str(candidate.get("rationale") or ""), str(candidate.get("impact") or ""))
            except CuratorError as exc:
                conflicts.append(f"{record_id}: {exc}"); continue
            written.append(result); processed[record_id] = fingerprint
        state["processed"] = processed
        state["cursor"] = max((str(item.get("cursor")) for item in _load_inbox(root) if item.get("cursor")), default=state.get("cursor"))
        state["last_run_finished_at"] = iso_now()
        state["lock"] = None
        state["capture_status"] = "healthy" if (state.get("observer") or {}).get("last_seen_at") else "degraded"
        _save_state(root, state, profile)
        after = environment_snapshot(str(root))
        return {"project_root": str(root), "schedule_slot": schedule_slot, "capture": state["capture_status"], "written": written, "ambiguous": ambiguous, "duplicates": duplicates, "conflicts": conflicts, "before": before, "after": after, "state": str(_state_path(root, profile)), "lock": "released"}


def search(root: Path, query: str, scope: str = "all", limit: int = 40) -> dict[str, Any]:
    query = clean(query, "query", 500)
    terms = [term.lower() for term in re.findall(r"\S+", query)]
    if not terms: raise ValueError("query must contain at least one search term")
    paths = store_paths(root)
    selected = paths if scope == "all" else {scope: paths.get(scope)}
    if scope != "all" and selected[scope] is None: raise ValueError(f"unknown scope: {scope}")
    matches = []
    for name, path in selected.items():
        if not path.exists(): continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if all(term in line.lower() for term in terms):
                matches.append({"store": name, "file": str(path.relative_to(root)), "line": number, "text": redact_text(line[:1000])})
                if len(matches) >= limit: return {"query": query, "matches": matches, "truncated": True}
    return {"query": query, "matches": matches, "truncated": False}


def status(root: Path, profile: str | None = None) -> dict[str, Any]:
    state = _load_state(root, profile)
    observer = state.get("observer") or {}
    capture_status = "healthy" if observer.get("status") == "healthy" else state.get("capture_status", "degraded")
    return {"root": str(root), "stores": _persistence_health(root)["stores"], "git": _git_state(root), "inbox_records": len(_load_inbox(root)), "capture_status": capture_status, "state": str(_state_path(root, profile)), "schedule_slot": state.get("schedule_slot")}


def append_entry(root: Path, kind: str, title: str, content: str, rationale: str | None = None, impact: str | None = None) -> dict[str, Any]:
    return _append_reviewed(root, kind, title, content, rationale or "", impact or "")


def self_improvement(root: Path, failure: str, cause: str, fix: str, prevention: str) -> dict[str, Any]:
    failure, cause, fix, prevention = clean(failure, "failure", 2_000), clean(cause, "cause", 2_000), clean(fix, "fix", 4_000), clean(prevention, "prevention", 2_000)
    return append_entry(root, "lessons", f"Verified fix: {failure[:120]}", f"{fix}\n\n**Evidence:** The failure was reproduced or observed, and the fix was verified.", rationale=f"{failure}\n\n{cause}", impact=prevention)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", help="Absolute Git worktree root")
    parser.add_argument("--profile", default=None)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status"); sub.add_parser("snapshot")
    search_parser = sub.add_parser("search"); search_parser.add_argument("query"); search_parser.add_argument("--scope", default="all", choices=["all", *STORE_NAMES])
    record_parser = sub.add_parser("record"); record_parser.add_argument("kind", choices=STORE_NAMES); record_parser.add_argument("title"); record_parser.add_argument("content"); record_parser.add_argument("--rationale"); record_parser.add_argument("--impact")
    observe_parser = sub.add_parser("observe"); observe_parser.add_argument("source_id"); observe_parser.add_argument("event_type"); observe_parser.add_argument("payload_json"); observe_parser.add_argument("--cursor")
    curate_parser = sub.add_parser("curate"); curate_parser.add_argument("--schedule-slot", default="06:00 Asia/Ho_Chi_Minh")
    improve_parser = sub.add_parser("improve"); improve_parser.add_argument("failure"); improve_parser.add_argument("cause"); improve_parser.add_argument("fix"); improve_parser.add_argument("prevention")
    args = parser.parse_args()
    try:
        root = resolve_project_root(args.project_root, allow_default=True)
        if args.command == "status": result = status(root, args.profile)
        elif args.command == "snapshot": result = environment_snapshot(str(root))
        elif args.command == "search": result = search(root, args.query, args.scope)
        elif args.command == "record": result = append_entry(root, args.kind, args.title, args.content, args.rationale, args.impact)
        elif args.command == "observe": result = native_projection_record(root, args.source_id, args.event_type, json.loads(args.payload_json), args.cursor, args.profile)
        elif args.command == "curate": result = curate(root, schedule_slot=args.schedule_slot, profile=args.profile)
        else: result = self_improvement(root, args.failure, args.cause, args.fix, args.prevention)
        print(json.dumps(result, indent=2, ensure_ascii=False)); return 0
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"written": False, "error": str(exc)}), file=sys.stderr); return 1


if __name__ == "__main__":
    raise SystemExit(main())
