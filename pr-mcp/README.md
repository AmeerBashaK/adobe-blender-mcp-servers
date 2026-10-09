# Premiere Pro MCP Server

An MCP server that lets Claude (or any MCP client) drive a running Adobe Premiere Pro on Windows.
Sibling of `../ae-mcp`, `../ps-mcp`, `../ai-mcp` and `../blender-mcp`. Tested with Premiere Pro 2026 (26.5).

## How it works

```
MCP client ──stdio JSON-RPC──▶ server.ps1 ──TCP 127.0.0.1:9877 (script + token)──▶ "MCP Bridge" CEP extension
                                   ▲                                                    │ evalScript (ExtendScript)
                                   └───────────────── JSON result line ◀────────────────┘
```

- `bridge/` is a tiny CEP extension (Node enabled) that starts invisibly with Premiere, listens on localhost
  only and evaluates the ExtendScript it's sent. It writes its port and a random token to
  `%LOCALAPPDATA%\premiere-mcp\session.json`; requests without that token are refused.
- `server.ps1` (pure Windows PowerShell 5.1) builds each tool's script from `jsx/_lib.jsx` + `jsx/<tool>.jsx`,
  so tools can be edited without reinstalling the extension.
- Premiere's ExtendScript has no undo; save the project before big scripted changes.

## Setup (one time)

```bash
powershell -ExecutionPolicy Bypass -File "C:\path\to\adobe-blender-mcp-servers\pr-mcp\install.ps1"
```

This copies `bridge/` to `%APPDATA%\Adobe\CEP\extensions\luminary-mcp-bridge` and sets `PlayerDebugMode=1`
under `HKCU\Software\Adobe\CSXS.11` and `CSXS.12`, which Adobe requires for unsigned extensions (it lets any
unsigned CEP panel load). `install.ps1 -Uninstall` removes both. Restart Premiere afterwards.

```bash
claude mcp add premiere-pro --scope user -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\adobe-blender-mcp-servers\pr-mcp\server.ps1"
```

Optional env vars: `PREMIERE_MCP_PORT` (default 9877), `PREMIERE_MCP_TIMEOUT` (seconds, default 120).
A visible status panel is under Window > Extensions (Legacy) > MCP Bridge.

## Tools

| Tool | What it does |
|---|---|
| `get_project_info` / `list_items` | Project, sequences, tracks, clips, markers / bin tree |
| `project` | open, new, save, save_as, close |
| `import_files` | Import media into a bin |
| `create_sequence` | From clips or a .sqpreset; custom frame size (e.g. 1080x1920 reels) |
| `add_clip` | Overwrite/insert a project item on a track at a time, with optional in/out |
| `clip_action` | remove, ripple delete, move, trim, rename, enable/disable, select, speed |
| `set_clip_property` | Read/set Motion, Opacity and effect properties, with keyframes |
| `apply_effect` / `add_transition` | Effects and transitions by name (QE DOM) |
| `markers` / `playhead` | Sequence markers; playhead and in/out points |
| `preview_frame` | Returns a sequence frame as an image so Claude can see the edit |
| `export_sequence` | Export to MP4 (default H.264 Match Source) or queue in Media Encoder |
| `import_mogrt` | Motion Graphics Templates with parameters (not yet tested) |
| `run_extendscript` | Escape hatch: any ExtendScript (QE via `app.enableQE()`) |

Times are seconds; tracks are 1-based (V1, A1); clips are 0-based indexes on their track or names.

## Adding a tool

1. Add an entry to `tools.json`.
2. Create `jsx/<name>.jsx`: the body of a function that receives `ARGS` and `return`s a plain object
   (`{ __image: <png path> }` sends an image back). Helpers in `jsx/_lib.jsx` are available.
   Premiere's QE calls want Windows backslash paths: use `new File(p).fsName`.

## Troubleshooting

- **"MCP Bridge extension is not loaded"**: restart Premiere; if new, run `install.ps1` first.
- Logs go to `%TEMP%\premiere-mcp\server.log`.
