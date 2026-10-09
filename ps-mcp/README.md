# Photoshop MCP Server

An MCP server that lets Claude (or any MCP client) drive a running Adobe Photoshop on Windows.
It's pure Windows PowerShell 5.1, so there's nothing to install. It is the sibling of `../ae-mcp`.

## How it works

```
MCP client ──stdio JSON-RPC──▶ server.ps1 ──COM: Photoshop.Application.DoJavaScript(script)──▶ Photoshop
                                   ▲                                                         │
                                   └──────────────────── JSON result (return value) ◀────────┘
```

For each tool call the server builds an ExtendScript (`jsx/_lib.jsx` + `jsx/<tool>.jsx`) and runs it in the
running Photoshop through COM, which returns the result directly (no temp files, no preference changes).
The COM call runs on its own runspace so a stuck Photoshop times out instead of hanging the server.
Each modifying call is one History step ("MCP: <tool>"); the `undo` tool steps back through History.
Keep scripts ES3: ExtendScript has no JSON, `let`, arrow functions, etc.

Keep Photoshop open. The server won't launch it for you.

## Connect it to Claude

**Claude Code:**

```bash
claude mcp add photoshop --scope user -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\adobe-blender-mcp-servers\ps-mcp\server.ps1"
```

**Claude Desktop:** add this to `%APPDATA%\Claude\claude_desktop_config.json`, then restart Claude:

```json
{
  "mcpServers": {
    "photoshop": {
      "command": "powershell.exe",
      "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "C:\\path\\to\\adobe-blender-mcp-servers\\ps-mcp\\server.ps1"]
    }
  }
}
```

Optional env var: `PS_MCP_TIMEOUT` (seconds, default 120).

## Tools

| Tool | What it does |
|---|---|
| `get_document_info` | Version, open documents, active document and its full layer tree |
| `create_document` / `open_file` | New document (size, PPI, background) or open a file |
| `add_layer` | pixel, text (point or paragraph), group, solid, rectangle, ellipse |
| `set_layer_properties` | Name, visibility, opacity, fill, blend mode, lock, text/font/size/color |
| `transform_layer` | Move, scale, rotate, flip, center, fit/fill canvas |
| `layer_action` | delete, duplicate, reorder, move into group, merge, rasterize, mask from selection, **remove_background**, smart object |
| `place_image` | Place a file as a smart object, fit/fill/position |
| `apply_filter` | Blurs, noise, sharpen, high pass, levels, brightness/contrast, hue/sat, colorize, photo filter, ... |
| `selection` | all/none/invert/rect/ellipse, **subject** (Select Subject), layer pixels, fill, clear, stroke, crop |
| `resize_document` | Image size, canvas size, crop |
| `preview_document` | Returns the composite as an image so Claude can see the result |
| `export_document` | PNG / JPG / PSD / TIFF copy |
| `save_document` / `close_document` | Save (As) and close |
| `undo` | Step back/forward in History |
| `run_extendscript` | Escape hatch: run any ExtendScript, get the last expression's value back |

Layers are referenced by id (number), `"Group/Layer"` path, or name; omit for the active layer.

## Adding a tool

1. Add an entry to `tools.json` (`name`, `description`, `inputSchema`, and optionally `"undoGroup": false` or `"timeout": <seconds>`).
2. Create `jsx/<name>.jsx`. It's the body of a function that receives `ARGS` and `return`s a plain object
   (return `{ __image: <png path> }` to send an image back). All helpers in `jsx/_lib.jsx` are available.

## Troubleshooting

- **"did not respond within N s"**: Photoshop is showing a dialog or busy.
- Logs go to `%TEMP%\ps-mcp\server.log`.
