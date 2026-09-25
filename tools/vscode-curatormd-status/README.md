# CuratorMD Status LED for VS Code

This project-local extension adds a colored status-bar indicator for the
`gptmd-coding` Hermes profile. It checks local commands and the project-local
CuratorMD state only; it does not read or print credentials.

Status precedence:

- Green: Hermes, Codex, and CuratorMD are healthy and idle.
- Blue: review notes are waiting in the CuratorMD native inbox.
- Purple: Hermes is unhealthy.
- Yellow: Codex authentication/runtime is unhealthy.
- Cyan: CuratorMD is actively running a curation lock.
- Red: more than one system is unhealthy.

## Install for this workspace

From the repository root:

```bash
code --install-extension tools/vscode-curatormd-status
```

Reload VS Code after installation. Click the LED to show details, or run
`CuratorMD: Refresh Status` from the Command Palette.

Copilot list agent prompts:  “Find aligned text blocks in these Markdown files and convert suitable ones to unordered lists” or “Show me the proposed list format for this section without editing.”
