# Blender MCP Server

An MCP server that lets Claude (or any MCP client) drive a running Blender on Windows.
Sibling of `../ae-mcp`, `../ps-mcp` and `../ai-mcp`. Tested with Blender 5.2.

## How it works

```
MCP client ──stdio JSON-RPC──▶ server.ps1 ──TCP 127.0.0.1:9876 (JSON line + token)──▶ mcp_bridge.py inside Blender
                                   ▲                                                         │ (runs on Blender's
                                   └──────────────────── JSON result line ◀──────────────────┘  main thread via a timer)
```

- `bridge/mcp_bridge.py` lives in Blender's `scripts/startup` folder, so it starts with Blender. It listens on
  localhost only and writes a random token to `%LOCALAPPDATA%\blender-mcp\session.json`; requests without
  that token are refused. It doesn't start in background (`blender -b`) sessions.
- `server.ps1` (pure Windows PowerShell 5.1) forwards each MCP tool call over the socket.
- All tools are implemented in Python in `mcp_bridge.py`; `tools.json` holds their MCP schemas.
- Each modifying call pushes one undo step ("MCP: <tool>").

## Setup (one time)

```bash
powershell -ExecutionPolicy Bypass -File "C:\path\to\adobe-blender-mcp-servers\blender-mcp\install.ps1"
```

```bash
claude mcp add blender --scope user -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\adobe-blender-mcp-servers\blender-mcp\server.ps1"
```

Then (re)start Blender. **After editing `bridge/mcp_bridge.py`, run `install.ps1` again and restart Blender**:
the installed copy is what Blender loads.

Optional env vars: `BLENDER_MCP_PORT` (default 9876, set it for Blender and the server alike),
`BLENDER_MCP_TIMEOUT` (seconds, default 120).

## Tools

| Tool | What it does |
|---|---|
| `get_scene_info` / `get_object_info` | Scene overview / one object's mesh, modifiers, materials, keyframes |
| `create_object` | Primitives, text, empty, camera, lights (with look_at, color, collection) |
| `modify_object` | Transform, look_at, parent, hide, shading, text, light/camera settings, apply transform, rename |
| `delete_objects` / `duplicate_object` | Delete, or duplicate with an offset (linked optional) |
| `set_material` | Principled BSDF: color, metal, roughness, emission, glass, alpha, image texture |
| `add_modifier` | Any modifier with settings by Python name, optionally applied |
| `animate` | Keyframes for location/rotation/scale/energy/color/lens, interpolation, frame range |
| `set_world` | Background color or HDRI |
| `render_settings` | Engine, resolution, samples, fps, frames, transparency, output, format, view transform |
| `viewport_screenshot` | Returns the 3D Viewport as an image |
| `render_preview` | Quick camera render returned as an image |
| `render` | Full still or animation render to disk |
| `import_file` / `export_file` | obj, fbx, glb/gltf, stl, ply, usd, abc, svg, images-as-planes |
| `file` | Save / Save As, open, new |
| `undo` | Undo / redo |
| `run_python` | Escape hatch: any bpy code, returns the last expression and printed output |

## Adding a tool

1. Add `def t_<name>(a):` to `bridge/mcp_bridge.py` returning a dict (`{"__image": path}` sends an image back).
   Add its name to `READ_ONLY` if it doesn't change the scene.
2. Add the schema to `tools.json`.
3. Run `install.ps1` and restart Blender.

## Troubleshooting

- **"Blender is not running, or its MCP bridge is not loaded"**: start Blender; run `install.ps1` if new.
  Blender's console (Window > Toggle System Console) shows `[mcp_bridge] listening on 127.0.0.1:9876`.
- **"port 9876 is busy"** in the console: another Blender already has the bridge; only the first one is driven.
- Logs go to `%TEMP%\blender-mcp\server.log`.
