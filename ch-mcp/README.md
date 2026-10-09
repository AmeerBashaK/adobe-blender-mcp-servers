# Character Animator MCP Server (MIDI)

Character Animator has no scripting API (it registers as a BridgeTalk target but never answers), so this
server drives it the way a MIDI controller would. Triggers (swaps, gestures, expressions, cycles) can be
assigned MIDI notes, and many behavior parameters can follow MIDI controllers (CC). Claude sends those
through a virtual MIDI cable, so it can perform a puppet live, while streaming, or during a recording.

```
MCP client ──stdio JSON-RPC──▶ server.ps1 ──WinMM──▶ loopMIDI port "Claude MIDI" ──▶ Character Animator
```

Pure Windows PowerShell 5.1 plus [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html)
(installed; starts with Windows; has a port named **Claude MIDI**).

## Setup (one time)

```bash
claude mcp add character-animator --scope user -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\path\to\adobe-blender-mcp-servers\ch-mcp\server.ps1"
```

Restart Character Animator after creating the port so it picks up the new MIDI input.

## Linking triggers (once per trigger)

1. `map_trigger` gives a friendly name a note (or a CC for a parameter): `{"name": "wave"}`.
2. In Character Animator, select the trigger in the Triggers panel and click its MIDI field so it waits for input.
3. `learn` with that name sends the note, and Character Animator assigns it.

Mappings live in `triggers.json`. After that, Claude can just say `trigger wave`.

## Tools

| Tool | What it does |
|---|---|
| `status` | Port, loopMIDI, Character Animator and saved mappings |
| `map_trigger` / `learn` | Name a note/CC and send it so Character Animator can learn it |
| `trigger` | Press and release a trigger (hold time, repeats) |
| `note` | Press or release and leave it, for held triggers |
| `control` / `ramp` | Set or smoothly move a parameter linked to a CC |
| `perform` | Timed sequence of triggers and parameter moves (up to 10 min) |
| `panic` | Release all notes and reset controllers |

Notes accept numbers (0–127) or names (C4 = 60 = middle C; Character Animator may call the same note C3).

## Limits

MIDI can only drive what Character Animator exposes to MIDI: triggers and linked parameters. It can't
open projects, build scenes, edit the timeline or export. Pair it with the Photoshop/Illustrator
connectors to build puppet artwork, and record in Character Animator while `perform` plays.
