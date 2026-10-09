# Illustrator MCP Server

An MCP server that lets Claude (or any MCP client) drive a running Adobe Illustrator on Windows.
It's pure Windows PowerShell 5.1, so there's nothing to install. Sibling of `../ps-mcp` and `../ae-mcp`.

## How it works

```
MCP client ──stdio JSON-RPC──▶ server.ps1 ──COM: Illustrator.Application.DoJavaScript(script)──▶ Illustrator
                                   ▲                                                             │
                                   └──────────────────── JSON result (return value) ◀────────────┘
```

For each tool call the server builds an ExtendScript (`jsx/_lib.jsx` + `jsx/<tool>.jsx`) and runs it in the
running Illustrator through COM. The script runs with alerts suppressed and **artboard coordinates**:
tools take x/y from the active artboard's top-left with y pointing down (Illustrator's own API points y
up; `_lib.jsx` flips it). Units are points, which equal pixels in Web/RGB documents.
Keep scripts ES3: ExtendScript has no JSON, `let`, arrow functions, etc.

Keep Illustrator open. The server won't launch it for you.

## Connect it to Claude

```bash
claude mcp add illustrator --scope user -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\adobe-blender-mcp-servers\ai-mcp\server.ps1"
```

Optional env var: `AI_MCP_TIMEOUT` (seconds, default 120).

## Tools

| Tool | What it does |
|---|---|
| `get_document_info` | Version, open documents, artboards, layers and their items |
| `create_document` / `open_file` | New document (size, RGB/CMYK, artboards, background) or open .ai/.pdf/.svg/.eps |
| `add_shape` | rectangle, rounded_rectangle, ellipse, polygon, star, line, path (with optional smooth curves) |
| `add_text` | Point or area text with font, size, color, alignment |
| `set_item_properties` | Fill, stroke, opacity, blend, position, size, scale, rotate, flip, text styling |
| `item_action` | delete, duplicate, group/ungroup, clipping mask, compound path, outline text, z-order, move to layer, align to artboard |
| `layers` / `artboards` | Manage layers and artboards (incl. fit artboard to art) |
| `place_image` | Place/embed an image |
| `image_trace` | Vectorize an image with an Image Trace preset and expand it |
| `preview_document` | Returns an artboard as an image so Claude can see the result |
| `export_document` | PNG / JPG / SVG |
| `save_document` / `close_document` | Save (As .ai / .pdf) and close |
| `undo` | Undo / redo |
| `run_extendscript` | Escape hatch: run any ExtendScript, get the last expression's value back |

Items are referenced by uuid or name; omit for the single selected item.

## Adding a tool

1. Add an entry to `tools.json` (`name`, `description`, `inputSchema`, optional `"timeout": <seconds>`).
2. Create `jsx/<name>.jsx`: the body of a function that receives `ARGS` and `return`s a plain object
   (return `{ __image: <png path> }` to send an image back). Helpers in `jsx/_lib.jsx` are available.

## Troubleshooting

- **"did not respond within N s"**: Illustrator is showing a dialog or busy.
- Logs go to `%TEMP%\ai-mcp\server.log`.
