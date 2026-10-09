# Adobe + Blender MCP Servers

MCP servers that let Claude (or any MCP client) drive running creative apps on Windows.
Each folder is self-contained, with its own README covering setup and tools.

| Folder | App | Transport |
|---|---|---|
| [`ae-mcp`](ae-mcp) | Adobe After Effects | PowerShell stdio server → ExtendScript |
| [`ps-mcp`](ps-mcp) | Adobe Photoshop | PowerShell stdio server → ExtendScript |
| [`ai-mcp`](ai-mcp) | Adobe Illustrator | PowerShell stdio server → ExtendScript |
| [`pr-mcp`](pr-mcp) | Adobe Premiere Pro | PowerShell stdio server → CEP bridge extension (localhost TCP + token) |
| [`blender-mcp`](blender-mcp) | Blender | PowerShell stdio server → Blender add-on bridge (localhost TCP + token) |
| [`ch-mcp`](ch-mcp) | Adobe Character Animator | PowerShell stdio server → virtual MIDI (no scripting API exists) |
| [`vscode-mcp`](vscode-mcp) | VS Code | Extension hosting a Streamable HTTP MCP server on 127.0.0.1 |

## Requirements

- Windows with Windows PowerShell 5.1 (built in). The PowerShell servers have no other dependencies.
- The target app installed and running. The servers don't launch apps for you.
- `pr-mcp` and `blender-mcp` need their bridge installed once via `install.ps1`; `ch-mcp` needs a virtual MIDI cable; `vscode-mcp` installs as a `.vsix`.

## Quick start (Claude Code)

```bash
claude mcp add after-effects --scope user -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\adobe-blender-mcp-servers\ae-mcp\server.ps1"
```

Swap `ae-mcp` / the server name for any other folder. See each folder's README for Claude Desktop config and app-specific notes.

## Security

Bridges listen on `127.0.0.1` only. `pr-mcp` and `blender-mcp` require a random per-session token written to `%LOCALAPPDATA%`, so other local processes can't send commands. The Adobe servers run ExtendScript in the app you point them at, so only connect clients you trust.

## License

[MIT](LICENSE)
