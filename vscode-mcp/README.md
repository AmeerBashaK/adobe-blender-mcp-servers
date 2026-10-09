# VS Code MCP Bridge

A VS Code extension that hosts an MCP server (Streamable HTTP) inside the running VS Code, so Claude can see and drive the editor.

```
Claude Code ──HTTP JSON-RPC──▶ http://127.0.0.1:3712/mcp ──▶ extension host (vscode API)
```

No dependencies. It listens on 127.0.0.1 only and rejects requests with a non-localhost `Origin`.

## Tools

| Tool | What it does |
|---|---|
| `get_workspace_info` | Workspace folders, open tabs, active file |
| `get_active_editor` | Path, language, selections + selected text, visible range; `includeText` for the full (unsaved) buffer |
| `open_file` | Open a file, jump to / select a range |
| `get_diagnostics` | Problems panel entries, per file or workspace |
| `replace_text` | Undoable edit of a range or the current selection, optional save |
| `save_files` | Save one file or all |
| `run_in_terminal` | Send a command to an integrated terminal (output not captured) |
| `execute_command` / `list_commands` | Run any VS Code command by id |
| `show_message` | Show a notification |

Lines and columns are 1-based.

## Install

```bash
npx @vscode/vsce package --allow-missing-repository --skip-license -o vscode-mcp-bridge.vsix
code --install-extension vscode-mcp-bridge.vsix --force
claude mcp add --transport http vscode --scope user http://127.0.0.1:3712/mcp
```

## Notes

- VS Code must be open. Only the first VS Code window gets the port; other windows skip it.
  Run **VS Code MCP: Show Status** from the command palette to see which.
- Change the port with the `vscodeMcp.port` setting (and update the Claude config to match).
- After editing `extension.js`, re-package, re-install, and run **Developer: Reload Window**.
