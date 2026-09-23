#!/usr/bin/env python3
"""Enable a new Git repository in the local Hermes + CuratorMD workflow."""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import subprocess
import sys
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[3]
CURATOR_SOURCE = SOURCE_ROOT / "plugins" / "gptmd-memory" / "scripts"
OPENAI_DOCS_URL = "https://developers.openai.com/mcp"
PROFILE_RE = re.compile(r"^[a-z][a-z0-9-]{1,63}$")
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class EnableError(RuntimeError):
    pass


def command_text(args: list[str], *, input_text: str | None = None) -> str:
    completed = subprocess.run(args, input=input_text, text=True, capture_output=True, check=False)
    if completed.returncode:
        detail = (completed.stderr or completed.stdout).strip()
        raise EnableError(f"command failed ({completed.returncode}): {' '.join(args)}\n{detail}")
    return completed.stdout


def run(args: list[str], *, dry_run: bool = False, input_text: str | None = None) -> str:
    print("$", " ".join(args))
    if dry_run:
        return ""
    return command_text(args, input_text=input_text)


def repo_root(value: str) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        raise EnableError("--project-root must be an absolute path")
    root = candidate.resolve(strict=True)
    result = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],
        cwd=root,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise EnableError("--project-root must be the root of a Git worktree")
    worktree = Path(result.stdout.strip()).resolve(strict=True)
    if root != worktree:
        raise EnableError(f"--project-root must be the Git worktree root: {worktree}")
    return root


def profile_names(hermes: str, *, dry_run: bool = False) -> list[str]:
    if dry_run:
        return []
    output = command_text([hermes, "profile", "list"])
    names = []
    for line in output.splitlines():
        match = re.match(r"^\s*[◆ ]*([a-z][a-z0-9-]{1,63})\s+", line)
        if match and match.group(1) not in names:
            names.append(match.group(1))
    return names


def write_if_missing(path: Path, content: str, *, dry_run: bool) -> bool:
    if path.exists():
        return False
    print("create", path)
    if not dry_run:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        os.chmod(path, 0o600)
    return True


def scaffold_knowledge(root: Path, profile: str, *, dry_run: bool) -> None:
    persistence = root / "persistence"
    today = dt.date.today().isoformat()
    write_if_missing(
        root / "AGENTS.md",
        "# Project contract\n\n"
        "Read `persistence/AGENTS.md` before changing this repository.\n"
        "Durable project knowledge belongs in the four files under `persistence/`.\n"
        "Always use the OpenAI developer documentation MCP server for OpenAI product, API, plugin, or Codex questions.\n"
        f"Agent-driven coding uses Hermes profile `{profile}`.\n",
        dry_run=dry_run,
    )
    write_if_missing(
        persistence / "AGENTS.md",
        "# Active project rules\n\n"
        "Keep durable knowledge concise, verified, actionable, and local-only.\n"
        "Never record credentials, tokens, private keys, connection strings, personal data, or raw transcripts.\n"
        "Use the OpenAI developer documentation MCP server for OpenAI product, API, plugin, or Codex questions.\n"
        "Use an absolute project root with CuratorMD. Leave curation changes uncommitted for review.\n"
        "CuratorMD must never add, commit, push, deploy, migrate, delete project data, or modify application source.\n",
        dry_run=dry_run,
    )
    write_if_missing(
        persistence / "SOP.md",
        "# Standard operating procedures\n\n"
        "## Start a coding session\n\n"
        f"Use `hermes -p {profile}` for agent-driven coding and keep the Codex app-server runtime selected.\n"
        "Read `persistence/AGENTS.md` and search the four persistence files before non-trivial work.\n\n"
        "## CuratorMD\n\n"
        "Use the absolute project root with CuratorMD status, snapshot, search, and curation commands.\n"
        "Review ambiguous or conflicting candidates; do not commit automatically.\n",
        dry_run=dry_run,
    )
    write_if_missing(
        persistence / "HISTORY.md",
        f"# Decision history\n\n## {today} — Enable Hermes profile\n\n"
        f"**Decision:** Use `{profile}` as the isolated Hermes/Codex profile for this repository.\n\n"
        "**Rationale:** Keep profile memory, sessions, scheduler state, and CuratorMD state separate from other repositories.\n",
        dry_run=dry_run,
    )
    write_if_missing(
        persistence / "LESSONS-LEARNED.md",
        "# Lessons learned\n\n",
        dry_run=dry_run,
    )
    ignore = root / ".gitignore"
    existing = ignore.read_text(encoding="utf-8") if ignore.exists() else ""
    if not any(line.strip() == ".curatormd/" for line in existing.splitlines()):
        print("append", ignore, ".curatormd/")
        if not dry_run:
            prefix = existing if not existing or existing.endswith("\n") else existing + "\n"
            ignore.write_text(prefix + ".curatormd/\n", encoding="utf-8")


def daily_expression(time_of_day: str) -> str:
    hour, minute = time_of_day.split(":", 1)
    return f"{int(minute)} {int(hour)} * * *"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True, help="Absolute Git worktree root")
    parser.add_argument("--profile", required=True, help="Unique lowercase Hermes profile name")
    parser.add_argument("--time", required=True, help="Daily local time, HH:MM in Asia/Ho_Chi_Minh")
    parser.add_argument("--hermes", default="hermes")
    parser.add_argument("--hermes-home", default=os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))
    parser.add_argument("--source-dir", default=str(CURATOR_SOURCE), help="Central CuratorMD scripts directory")
    parser.add_argument("--no-scaffold", action="store_true", help="Do not create missing AGENTS/persistence files")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not PROFILE_RE.fullmatch(args.profile) or args.profile == "default":
        raise EnableError("--profile must be a non-default lowercase name using letters, numbers, and hyphens")
    if not TIME_RE.fullmatch(args.time):
        raise EnableError("--time must use HH:MM, for example 06:15")
    root = repo_root(args.project_root)
    source_dir = Path(args.source_dir).expanduser().resolve(strict=True)
    if not (source_dir / "gptmd_memory.py").is_file():
        raise EnableError(f"CuratorMD source is missing gptmd_memory.py: {source_dir}")
    expression = daily_expression(args.time)
    print(f"Enabling {root} as Hermes profile {args.profile} at {args.time} Asia/Ho_Chi_Minh ({expression})")

    if not args.no_scaffold:
        scaffold_knowledge(root, args.profile, dry_run=args.dry_run)

    names = profile_names(args.hermes, dry_run=args.dry_run)
    if args.profile not in names:
        run(
            [args.hermes, "profile", "create", args.profile, "--no-alias", "--description",
             f"Codex-primary Hermes profile for {root.name}"],
            dry_run=args.dry_run,
        )

    for key, value in (
        ("model.provider", "openai-codex"),
        ("model.default", "gpt-5.6-luna"),
        ("model.openai_runtime", "codex_app_server"),
        ("cron.max_parallel_jobs", "1"),
    ):
        run([args.hermes, "-p", args.profile, "config", "set", key, value], dry_run=args.dry_run)
    run([args.hermes, "config", "set", "cron.max_parallel_jobs", "1"], dry_run=args.dry_run)

    mcp_listing = "" if args.dry_run else command_text([args.hermes, "-p", args.profile, "mcp", "list"])
    mcp_servers = (
        ("curatormd", ["--command", sys.executable, "--args", str(source_dir / "mcp_server.py")], "Y\n"),
        ("openaiDeveloperDocs", ["--url", OPENAI_DOCS_URL], "n\nY\n"),
    )
    for server_name, server_args, prompt_answers in mcp_servers:
        if server_name not in mcp_listing:
            run(
                [args.hermes, "-p", args.profile, "mcp", "add", server_name, *server_args],
                dry_run=args.dry_run,
                input_text=prompt_answers,
            )
            mcp_listing += server_name
        else:
            print(f"MCP server {server_name} already exists; no duplicate created")

    installer = source_dir / "install_hermes_integration.py"
    run(
        [sys.executable, str(installer), "--project-root", str(root), "--profile", args.profile,
         "--hermes-home", args.hermes_home, "--source-dir", str(source_dir),
         "--schedule-slot", f"{args.time} Asia/Ho_Chi_Minh"],
        dry_run=args.dry_run,
    )

    cron_listing = "" if args.dry_run else command_text([args.hermes, "-p", args.profile, "cron", "list", "--all"])
    has_curator_job = "Name:      gptmd-curatormd" in cron_listing
    if has_curator_job and f"Schedule:  {expression}" not in cron_listing:
        raise EnableError(f"profile {args.profile} already has gptmd-curatormd at a different schedule")
    if not args.dry_run and not has_curator_job:
        for existing_profile in profile_names(args.hermes):
            if existing_profile == args.profile:
                continue
            other_listing = command_text([args.hermes, "-p", existing_profile, "cron", "list", "--all"])
            if f"Schedule:  {expression}" in other_listing:
                raise EnableError(f"daily slot {args.time} is already used by profile {existing_profile}")
    if not has_curator_job:
        run(
            [args.hermes, "-p", args.profile, "cron", "create", expression, "--name", "gptmd-curatormd",
             "--script", "gptmd-curatormd.py", "--no-agent", "--workdir", str(root), "--continuity",
             "--deliver", "local", "--failure-deliver", "local"],
            dry_run=args.dry_run,
        )
    else:
        print("cron job already exists; no duplicate created")

    print("\nNext steps:")
    print(f"  hermes -p {args.profile} model        # sign in/select OpenAI Codex interactively")
    print(f"  hermes -p {args.profile} status")
    print(f"  http://127.0.0.1:9119/cron?profile={args.profile}")
    print(f"  python3 {source_dir / 'gptmd_memory.py'} --project-root {root} status")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except EnableError as exc:
        print(f"enable_repo: {exc}", file=sys.stderr)
        raise SystemExit(2)
