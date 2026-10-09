# After Effects MCP Server

An MCP server that lets Claude (or any MCP client) drive a running Adobe After Effects on Windows.
It's pure Windows PowerShell 5.1, so there's nothing to install.

## How it works

```
MCP client ──stdio JSON-RPC──▶ server.ps1 ──AfterFX.exe -s "$.evalFile(tool.jsx)"──▶ After Effects
                                   ▲                                       │
                                   └──── %TEMP%\ae-mcp\<id>.json ◀─────────┘
```

For each tool call the server builds an ExtendScript file (`jsx/_lib.jsx` + `jsx/<tool>.jsx`) and hands it
to the running After Effects with `AfterFX.exe -s` (a running AE 26.x ignores `-r <file>`, so `-s` loads the
file with `$.evalFile`). The script writes a JSON result back. Keep scripts ES3: ExtendScript rejects some
modern syntax and even some regex literals. Each modifying
call is a single undo step ("MCP: <tool>") in After Effects.

## After Effects setup (one time)

In After Effects: **Edit > Preferences > Scripting & Expressions**

- ✅ **Allow Scripts to Write Files and Access Network**: required, because results come back through a file.
- ⬜ **Warn User When Executing Files**: turn this off. Otherwise After Effects shows a confirmation dialog on every tool call.

Keep After Effects open with a project loaded. The server won't launch After Effects for you.

## Connect it to Claude

**Claude Code:**

```bash
claude mcp add after-effects --scope user -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\ae-mcp\server.ps1"
```

**Claude Desktop:** add this to `%APPDATA%\Claude\claude_desktop_config.json`, then restart Claude:

```json
{
  "mcpServers": {
    "after-effects": {
      "command": "powershell.exe",
      "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\path\\to\\ae-mcp\\server.ps1"]
    }
  }
}
```

Optional env vars: `AE_PATH` (full path to `AfterFX.exe`) and `AE_MCP_TIMEOUT` (seconds, default 60).

## Tools

| Tool | What it does |
|---|---|
| `get_project_info` | Version, project file, active item, all comps |
| `list_items` | Project items (comps / footage / folders) |
| `get_comp_details` | Comp settings and every layer |
| `create_composition` | New comp |
| `add_layer` | text, solid, adjustment, null, shape (rect/ellipse), camera, light |
| `set_layer_properties` | Any property by path (`Position`, `Opacity`, `Source Text`, `Effects/Glow/Glow Radius`…), name, parent, timing, blend mode |
| `set_keyframes` | Keyframes with linear / easy_ease / ease_in / ease_out / hold |
| `set_expression` | Add or clear expressions |
| `list_effects` / `apply_effect` | Find effects and apply them with parameters |
| `get_layer_properties` | Browse a layer's property tree to discover paths |
| `layer_action` | delete, duplicate, reorder, precompose |
| `import_file` | Import footage, optionally into a comp |
| `render_comp` | Add to Render Queue, optionally render now |
| `preview_frame` | Returns a rendered frame as an image so Claude can see the result |
| `save_project` | Save / Save As |
| `run_extendscript` | Escape hatch: run any ExtendScript, get the last expression's value back |

## Adding a tool

1. Add an entry to `tools.json` (`name`, `description`, `inputSchema`, and optionally `"undoGroup": false` or `"timeout": <seconds>`).
2. Create `jsx/<name>.jsx`. It's the body of a function that receives `ARGS` and `return`s a plain object.
   All helpers in `jsx/_lib.jsx` are available.

## Troubleshooting

- **"did not respond within 60 s"**: After Effects is showing a dialog, is busy rendering, or one of the preferences above is wrong.
- Logs go to `%TEMP%\ae-mcp\server.log`.
