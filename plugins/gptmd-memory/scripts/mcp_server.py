#!/usr/bin/env python3
"""Stdio MCP server for the local CuratorMD project boundary."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gptmd_memory import (  # noqa: E402
    append_entry,
    curate,
    environment_snapshot,
    native_projection_record,
    resolve_project_root,
    search,
    self_improvement,
    status,
)


PROJECT_ROOT = {"type": "string", "description": "Absolute Git worktree root. It must contain persistence/."}

TOOLS = [
    {"name": "memory_recall", "description": "Search durable project knowledge in persistence/*.md.", "inputSchema": {"type": "object", "properties": {"project_root": PROJECT_ROOT, "query": {"type": "string"}, "scope": {"type": "string", "enum": ["all", "agents", "sop", "history", "lessons"]}}, "required": ["project_root", "query"]}},
    {"name": "persistence_status", "description": "Report persistence health, scoped Git state, inbox count, and capture status.", "inputSchema": {"type": "object", "properties": {"project_root": PROJECT_ROOT, "profile": {"type": "string"}}, "required": ["project_root"]}},
    {"name": "environment_snapshot", "description": "Read only approved, safe repository metadata for a validated project root.", "inputSchema": {"type": "object", "properties": {"project_root": PROJECT_ROOT}, "required": ["project_root"]}},
    {"name": "native_projection_record", "description": "Write a bounded, secret-redacted native-projection record to the temporary inbox.", "inputSchema": {"type": "object", "properties": {"project_root": PROJECT_ROOT, "source_id": {"type": "string"}, "event_type": {"type": "string"}, "payload": {"type": ["object", "array", "string"]}, "cursor": {"type": "string"}, "profile": {"type": "string"}}, "required": ["project_root", "source_id", "event_type", "payload"]}},
    {"name": "curation_run", "description": "Run the bounded local curator. Only explicitly reviewed candidates may enter canonical Markdown.", "inputSchema": {"type": "object", "properties": {"project_root": PROJECT_ROOT, "schedule_slot": {"type": "string"}, "profile": {"type": "string"}}, "required": ["project_root"]}},
    {"name": "persistence_record", "description": "Append a reviewed durable decision, procedure, active rule, or lesson.", "inputSchema": {"type": "object", "properties": {"project_root": PROJECT_ROOT, "kind": {"type": "string", "enum": ["agents", "sop", "history", "lessons"]}, "title": {"type": "string"}, "content": {"type": "string"}, "rationale": {"type": "string"}, "impact": {"type": "string"}}, "required": ["project_root", "kind", "title", "content"]}},
    {"name": "self_improvement_capture", "description": "Record a verified failure, root cause, fix, evidence, and prevention rule.", "inputSchema": {"type": "object", "properties": {"project_root": PROJECT_ROOT, "failure": {"type": "string"}, "cause": {"type": "string"}, "fix": {"type": "string"}, "prevention": {"type": "string"}}, "required": ["project_root", "failure", "cause", "fix", "prevention"]}},
]


def reply(request_id, result=None, error=None):
    response = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        response["error"] = {"code": -32603, "message": str(error)}
    else:
        response["result"] = result
    sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def call_tool(name: str, arguments: dict):
    root = resolve_project_root(arguments.get("project_root"))
    if name == "memory_recall":
        return search(root, arguments.get("query", ""), arguments.get("scope", "all"))
    if name == "persistence_status":
        return status(root, arguments.get("profile"))
    if name == "environment_snapshot":
        return environment_snapshot(str(root))
    if name == "native_projection_record":
        return native_projection_record(str(root), arguments["source_id"], arguments["event_type"], arguments["payload"], arguments.get("cursor"), arguments.get("profile"))
    if name == "curation_run":
        return curate(str(root), schedule_slot=arguments.get("schedule_slot", "06:00 Asia/Ho_Chi_Minh"), profile=arguments.get("profile"))
    if name == "persistence_record":
        return append_entry(root, arguments["kind"], arguments["title"], arguments["content"], arguments.get("rationale"), arguments.get("impact"))
    if name == "self_improvement_capture":
        return self_improvement(root, arguments["failure"], arguments["cause"], arguments["fix"], arguments["prevention"])
    raise ValueError(f"unknown tool: {name}")


for line in sys.stdin:
    if not line.strip():
        continue
    request = {}
    try:
        request = json.loads(line)
        method = request.get("method")
        request_id = request.get("id")
        if method == "initialize":
            reply(request_id, {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "curatormd", "version": "0.2.0"}})
        elif method == "notifications/initialized":
            continue
        elif method == "tools/list":
            reply(request_id, {"tools": TOOLS})
        elif method == "tools/call":
            result = call_tool(request["params"]["name"], request["params"].get("arguments", {}))
            reply(request_id, {"content": [{"type": "text", "text": json.dumps(result, indent=2)}], "structuredContent": result})
        else:
            reply(request_id, error=f"unsupported method: {method}")
    except Exception as exc:  # Keep the server alive after a rejected request.
        reply(request.get("id"), error=exc)
