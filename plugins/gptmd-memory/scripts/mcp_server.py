#!/usr/bin/env python3
"""Minimal stdio MCP server for the local gptmd persistence layer."""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gptmd_memory import append_entry, find_root, search, self_improvement, status  # noqa: E402


TOOLS = [
    {
        "name": "memory_recall",
        "description": "Search durable project knowledge in persistence/*.md.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "scope": {"type": "string", "enum": ["all", "agents", "sop", "history", "lessons"]}},
            "required": ["query"],
        },
    },
    {
        "name": "persistence_status",
        "description": "Report persistence document health and scoped git status.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "persistence_record",
        "description": "Append a durable decision, procedure, active rule, or lesson to the matching persistence document.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["agents", "sop", "history", "lessons"]},
                "title": {"type": "string"},
                "content": {"type": "string"},
                "rationale": {"type": "string"},
                "impact": {"type": "string"},
            },
            "required": ["kind", "title", "content"],
        },
    },
    {
        "name": "self_improvement_capture",
        "description": "Record a verified failure, root cause, fix, evidence, and prevention rule as a durable lesson.",
        "inputSchema": {
            "type": "object",
            "properties": {"failure": {"type": "string"}, "cause": {"type": "string"}, "fix": {"type": "string"}, "prevention": {"type": "string"}},
            "required": ["failure", "cause", "fix", "prevention"],
        },
    },
]


def reply(request_id, result=None, error=None):
    response = {"jsonrpc": "2.0", "id": request_id}
    if error is not None:
        response["error"] = {"code": -32603, "message": str(error)}
    else:
        response["result"] = result
    sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def call_tool(name, arguments):
    root = find_root()
    if name == "memory_recall":
        return search(root, arguments.get("query", ""), arguments.get("scope", "all"))
    if name == "persistence_status":
        return status(root)
    if name == "persistence_record":
        return append_entry(root, arguments["kind"], arguments["title"], arguments["content"], arguments.get("rationale"), arguments.get("impact"))
    if name == "self_improvement_capture":
        return self_improvement(root, arguments["failure"], arguments["cause"], arguments["fix"], arguments["prevention"])
    raise ValueError(f"unknown tool: {name}")


for line in sys.stdin:
    if not line.strip():
        continue
    try:
        request = json.loads(line)
        method = request.get("method")
        request_id = request.get("id")
        if method == "initialize":
            reply(request_id, {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "gptmd-memory", "version": "0.1.0"}})
        elif method == "notifications/initialized":
            continue
        elif method == "tools/list":
            reply(request_id, {"tools": TOOLS})
        elif method == "tools/call":
            result = call_tool(request["params"]["name"], request["params"].get("arguments", {}))
            reply(request_id, {"content": [{"type": "text", "text": json.dumps(result, indent=2)}], "structuredContent": result})
        else:
            reply(request_id, error=f"unsupported method: {method}")
    except Exception as exc:  # Keep the server alive after a bad tool call.
        reply(request.get("id") if "request" in locals() else None, error=exc)
