# Reusable lessons

CuratorMD lesson entries require a verified trigger, lesson, and preventative
rule. Do not add speculative or transcript-only observations.

## Keep CuratorMD profile binding in workspace settings

**Date:** 2026-09-26

**Lesson:** Trigger: repository status checks can target the wrong project's Hermes and CuratorMD state when curatormdStatus.profile is set in VS Code User settings shared by several workspaces. Lesson: bind each repository to its own Hermes profile at workspace scope. Preventative rule: set curatormdStatus.profile in that repository's .vscode/settings.json; for this workspace use vuepy05-coding. Do not put a repository-specific CuratorMD profile in VS Code User settings.
