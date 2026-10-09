<#
  Character Animator MCP server (stdio, JSON-RPC 2.0). No dependencies beyond Windows PowerShell 5.1
  and a virtual MIDI port (loopMIDI, port "Claude MIDI").

  Character Animator has no scripting API, but it listens to MIDI: triggers (swaps, gestures, cycles)
  can be assigned MIDI notes and behavior parameters can follow MIDI controllers (CC). This server
  sends MIDI through the loopback port with WinMM, so Claude can fire triggers, hold them, move
  parameters and play timed performances while Character Animator is live or recording.

  triggers.json (next to this file) maps friendly names ("wave", "smile") to notes/CCs.

  Environment variables (optional):
    CH_MIDI_PORT  Output port name (default "Claude MIDI")
#>
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$WorkDir = Join-Path $env:TEMP 'ch-mcp'
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$LogFile = Join-Path $WorkDir 'server.log'
$MapFile = Join-Path $Root 'triggers.json'

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $Utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $Utf8)
$stdout.AutoFlush = $true

$ServerVersion = '1.0.0'
$Tools = [IO.File]::ReadAllText((Join-Path $Root 'tools.json'), $Utf8) | ConvertFrom-Json
$PortName = 'Claude MIDI'
if ($env:CH_MIDI_PORT) { $PortName = $env:CH_MIDI_PORT }

function Write-Log([string]$msg) {
    try { Add-Content -Path $LogFile -Value ("{0:s} {1}" -f (Get-Date), $msg) -Encoding UTF8 } catch {}
}
function Send-Message($obj) { $stdout.Write((ConvertTo-Json -InputObject $obj -Depth 64 -Compress) + "`n") }
function Send-Result($id, $result) { Send-Message @{ jsonrpc = '2.0'; id = $id; result = $result } }
function Send-Error($id, [int]$code, [string]$message) {
    Send-Message @{ jsonrpc = '2.0'; id = $id; error = @{ code = $code; message = $message } }
}

# ---- MIDI (WinMM) ------------------------------------------------------------

Add-Type -Namespace ChMcp -Name WinMM -MemberDefinition @'
[DllImport("winmm.dll")] public static extern int midiOutGetNumDevs();
[DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern int midiOutGetDevCapsW(IntPtr id, ref CAPS caps, int size);
[DllImport("winmm.dll")] public static extern int midiOutOpen(out IntPtr handle, uint deviceId, IntPtr callback, IntPtr instance, uint flags);
[DllImport("winmm.dll")] public static extern int midiOutShortMsg(IntPtr handle, uint msg);
[DllImport("winmm.dll")] public static extern int midiOutClose(IntPtr handle);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct CAPS { public ushort wMid; public ushort wPid; public uint vDriverVersion;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
  public ushort wTechnology; public ushort wVoices; public ushort wNotes; public ushort wChannelMask; public uint dwSupport; }
'@

$script:Handle = [IntPtr]::Zero

function Get-Ports {
    $list = @()
    for ($i = 0; $i -lt [ChMcp.WinMM]::midiOutGetNumDevs(); $i++) {
        $c = New-Object ChMcp.WinMM+CAPS
        [void][ChMcp.WinMM]::midiOutGetDevCapsW([IntPtr]$i, [ref]$c, [Runtime.InteropServices.Marshal]::SizeOf($c))
        $list += [pscustomobject]@{ id = $i; name = $c.szPname }
    }
    return $list
}

function Open-Port {
    if ($script:Handle -ne [IntPtr]::Zero) { return }
    $port = Get-Ports | Where-Object { $_.name -eq $PortName } | Select-Object -First 1
    if (-not $port) {
        throw "MIDI port '$PortName' not found. Start loopMIDI (it should start with Windows) and make sure it has a port named '$PortName'."
    }
    $h = [IntPtr]::Zero
    $rc = [ChMcp.WinMM]::midiOutOpen([ref]$h, [uint32]$port.id, [IntPtr]::Zero, [IntPtr]::Zero, 0)
    if ($rc -ne 0) { throw "Could not open MIDI port '$PortName' (error $rc)." }
    $script:Handle = $h
    Write-Log "opened $PortName (device $($port.id))"
}

function Send-Midi([int]$status, [int]$d1, [int]$d2) {
    Open-Port
    $msg = [uint32]($status -bor ($d1 -shl 8) -bor ($d2 -shl 16))
    $rc = [ChMcp.WinMM]::midiOutShortMsg($script:Handle, $msg)
    if ($rc -ne 0) {
        # The port may have been recreated; reopen once.
        [void][ChMcp.WinMM]::midiOutClose($script:Handle)
        $script:Handle = [IntPtr]::Zero
        Open-Port
        $rc = [ChMcp.WinMM]::midiOutShortMsg($script:Handle, $msg)
        if ($rc -ne 0) { throw "MIDI send failed (error $rc)." }
    }
}

# Note names: C4 = 60 (middle C). Accepts "C4", "F#3", "Bb2", or a number 0-127.
function Get-NoteNumber($n) {
    if ($n -is [int] -or $n -is [long] -or $n -is [double]) { $v = [int]$n }
    elseif ([string]$n -match '^\d+$') { $v = [int]$n }
    elseif ([string]$n -match '^([A-Ga-g])([#b]?)(-?\d)$') {
        $base = @{ c = 0; d = 2; e = 4; f = 5; g = 7; a = 9; b = 11 }[$Matches[1].ToLower()]
        if ($Matches[2] -eq '#') { $base++ } elseif ($Matches[2] -eq 'b') { $base-- }
        $v = ([int]$Matches[3] + 1) * 12 + $base
    } else { throw "Bad note: $n (use 0-127 or a name like C4, F#3)" }
    if ($v -lt 0 -or $v -gt 127) { throw "Note out of range: $n" }
    return $v
}

function Get-NoteName([int]$v) {
    $names = 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
    return $names[$v % 12] + ([Math]::Floor($v / 12) - 1)
}

function Get-Channel($a) {
    $ch = 1
    if ($a.channel) { $ch = [int]$a.channel }
    if ($ch -lt 1 -or $ch -gt 16) { throw 'channel must be 1-16' }
    return $ch - 1
}

function Clamp7([double]$v) { return [int][Math]::Max(0, [Math]::Min(127, [Math]::Round($v))) }

# ---- Trigger map ----------------------------------------------------------------

function Get-Map {
    if (-not (Test-Path $MapFile)) { return [ordered]@{} }
    $obj = [IO.File]::ReadAllText($MapFile, $Utf8) | ConvertFrom-Json
    $map = [ordered]@{}
    foreach ($p in $obj.PSObject.Properties) { $map[$p.Name] = $p.Value }
    return $map
}

function Save-Map($map) {
    [IO.File]::WriteAllText($MapFile, (ConvertTo-Json -InputObject $map -Depth 5), $Utf8)
}

function Resolve-Target($a) {
    if ($a.name) {
        $m = Get-Map
        if (-not $m.Contains($a.name)) { throw "No mapping named '$($a.name)'. Use map_trigger first, or pass note/cc directly." }
        return $m[$a.name]
    }
    return $null
}

# ---- Actions --------------------------------------------------------------------

function Invoke-Trigger($a) {
    $t = Resolve-Target $a
    $noteArg = $a.note
    $ch = Get-Channel $a
    if ($t) {
        if ($t.type -ne 'note') { throw "'$($a.name)' is mapped to a controller; use control or ramp." }
        $noteArg = $t.note
        if ($t.channel) { $ch = [int]$t.channel - 1 }
    }
    if ($null -eq $noteArg) { throw 'Pass name or note' }
    $note = Get-NoteNumber $noteArg
    $vel = 100; if ($a.velocity) { $vel = Clamp7 $a.velocity }
    $hold = 150; if ($null -ne $a.hold_ms) { $hold = [int]$a.hold_ms }
    $times = 1; if ($a.repeat) { $times = [int]$a.repeat }
    $gap = 150; if ($null -ne $a.gap_ms) { $gap = [int]$a.gap_ms }
    for ($i = 0; $i -lt $times; $i++) {
        Send-Midi (0x90 -bor $ch) $note $vel
        if ($hold -gt 0) { Start-Sleep -Milliseconds $hold }
        Send-Midi (0x80 -bor $ch) $note 0
        if ($i -lt $times - 1 -and $gap -gt 0) { Start-Sleep -Milliseconds $gap }
    }
    return "Triggered $(Get-NoteName $note) ($note) on channel $($ch + 1), held $hold ms" + $(if ($times -gt 1) { ", x$times" } else { '' })
}

function Invoke-Note($a) {
    $t = Resolve-Target $a
    $noteArg = $a.note; $ch = Get-Channel $a
    if ($t) { $noteArg = $t.note; if ($t.channel) { $ch = [int]$t.channel - 1 } }
    $note = Get-NoteNumber $noteArg
    if ($a.on -eq $false) { Send-Midi (0x80 -bor $ch) $note 0; return "Released $(Get-NoteName $note) ($note)" }
    $vel = 100; if ($a.velocity) { $vel = Clamp7 $a.velocity }
    Send-Midi (0x90 -bor $ch) $note $vel
    return "Holding $(Get-NoteName $note) ($note); call note with on=false to release"
}

function Get-CcTarget($a) {
    $t = Resolve-Target $a
    $cc = $a.cc; $ch = Get-Channel $a
    if ($t) {
        if ($t.type -ne 'cc') { throw "'$($a.name)' is mapped to a note; use trigger." }
        $cc = $t.cc; if ($t.channel) { $ch = [int]$t.channel - 1 }
    }
    if ($null -eq $cc) { throw 'Pass name or cc' }
    $cc = [int]$cc
    if ($cc -lt 0 -or $cc -gt 119) { throw 'cc must be 0-119' }
    return @($cc, $ch)
}

function Invoke-Control($a) {
    $cc, $ch = Get-CcTarget $a
    $v = Clamp7 $a.value
    Send-Midi (0xB0 -bor $ch) $cc $v
    return "CC $cc = $v on channel $($ch + 1)"
}

function Invoke-Ramp($a) {
    $cc, $ch = Get-CcTarget $a
    $from = [double]$a.from; $to = [double]$a.to
    $dur = 1000; if ($a.duration_ms) { $dur = [int]$a.duration_ms }
    $steps = [Math]::Max(2, [Math]::Min(500, [int]($dur / 20)))
    $ease = 'linear'; if ($a.ease) { $ease = $a.ease }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    for ($i = 0; $i -le $steps; $i++) {
        $p = $i / $steps
        if ($ease -eq 'ease_in_out') { $p = 0.5 - [Math]::Cos($p * [Math]::PI) / 2 }
        Send-Midi (0xB0 -bor $ch) $cc (Clamp7 ($from + ($to - $from) * $p))
        $target = [int]($dur * $i / $steps)
        $wait = $target - $sw.ElapsedMilliseconds
        if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
    }
    return "Ramped CC $cc from $from to $to over $dur ms ($ease)"
}

function Invoke-Perform($a) {
    $steps = @($a.steps | Sort-Object { [int]$_.at_ms })
    if (-not $steps.Count) { throw 'steps is empty' }
    $last = [int]$steps[-1].at_ms
    if ($last -gt 600000) { throw 'Performances are limited to 10 minutes' }
    $log = @()
    $sw = [Diagnostics.Stopwatch]::StartNew()
    foreach ($s in $steps) {
        $wait = [int]$s.at_ms - $sw.ElapsedMilliseconds
        if ($wait -gt 0) { Start-Sleep -Milliseconds $wait }
        $act = $s.action; if (-not $act) { $act = 'trigger' }
        switch ($act) {
            'trigger' { $r = Invoke-Trigger $s }
            'note' { $r = Invoke-Note $s }
            'control' { $r = Invoke-Control $s }
            'ramp' { $r = Invoke-Ramp $s }
            default { throw "Unknown step action: $act" }
        }
        $log += ('{0,6} ms  {1}' -f $s.at_ms, $r)
    }
    return "Performance done ($($steps.Count) steps, $([Math]::Round($sw.Elapsed.TotalSeconds, 1)) s):`n" + ($log -join "`n")
}

function Invoke-Panic($a) {
    for ($ch = 0; $ch -lt 16; $ch++) {
        Send-Midi (0xB0 -bor $ch) 123 0   # all notes off
        Send-Midi (0xB0 -bor $ch) 121 0   # reset controllers
    }
    return 'Sent All Notes Off and Reset Controllers on all 16 channels'
}

function Invoke-MapTrigger($a) {
    $m = Get-Map
    if ($a.remove) {
        if ($m.Contains($a.name)) { $m.Remove($a.name); Save-Map $m; return "Removed '$($a.name)'" }
        return "No mapping named '$($a.name)'"
    }
    if (-not $a.name) { throw 'Pass name' }
    $entry = [ordered]@{}
    if ($null -ne $a.cc) { $entry.type = 'cc'; $entry.cc = [int]$a.cc }
    else {
        $n = $a.note
        if ($null -eq $n) {
            # Next free note from C2 (36) upward.
            $used = @($m.Values | Where-Object { $_.type -eq 'note' } | ForEach-Object { [int]$_.note })
            $n = 36; while ($used -contains $n) { $n++ }
        }
        $entry.type = 'note'; $entry.note = Get-NoteNumber $n; $entry.noteName = Get-NoteName $entry.note
    }
    if ($a.channel) { $entry.channel = [int]$a.channel }
    if ($a.description) { $entry.description = $a.description }
    if ($a.puppet) { $entry.puppet = $a.puppet }
    $m[$a.name] = $entry
    Save-Map $m
    $how = if ($entry.type -eq 'cc') { "CC $($entry.cc)" } else { "note $($entry.noteName) ($($entry.note))" }
    return "Mapped '$($a.name)' to $how. To link it in Character Animator: select the trigger (or parameter), click its MIDI field so it's waiting for input, then call learn with this name."
}

function Invoke-Learn($a) {
    $t = Resolve-Target $a
    if ($t -and $t.type -eq 'cc') {
        $ch = 0; if ($t.channel) { $ch = [int]$t.channel - 1 }
        foreach ($v in 0, 64, 127, 64) { Send-Midi (0xB0 -bor $ch) ([int]$t.cc) $v; Start-Sleep -Milliseconds 120 }
        return "Sent CC $($t.cc) sweeps for '$($a.name)'. Character Animator should now show it in the MIDI field."
    }
    $r = Invoke-Trigger ([pscustomobject]@{ name = $a.name; note = $a.note; hold_ms = 250 })
    return "$r. Character Animator should now show this note in the trigger's MIDI field."
}

function Get-Status($a) {
    $ports = Get-Ports
    $ok = [bool]($ports | Where-Object { $_.name -eq $PortName })
    $ch = Get-Process 'Character Animator' -ErrorAction SilentlyContinue | Where-Object MainWindowTitle | Select-Object -First 1
    $lm = [bool](Get-Process loopMIDI -ErrorAction SilentlyContinue)
    return ConvertTo-Json -Depth 5 -InputObject ([ordered]@{
            port               = $PortName
            portFound          = $ok
            loopMIDIRunning    = $lm
            characterAnimator  = if ($ch) { 'running' } else { 'not running (or still loading)' }
            midiOutputs        = @($ports | ForEach-Object { $_.name })
            mappings           = Get-Map
            noteNaming         = 'C4 = 60 (middle C). Character Animator may label the same note C3; the number is what matters.'
        })
}

$Handlers = @{
    status      = { param($a) Get-Status $a }
    trigger     = { param($a) Invoke-Trigger $a }
    note        = { param($a) Invoke-Note $a }
    control     = { param($a) Invoke-Control $a }
    ramp        = { param($a) Invoke-Ramp $a }
    perform     = { param($a) Invoke-Perform $a }
    map_trigger = { param($a) Invoke-MapTrigger $a }
    learn       = { param($a) Invoke-Learn $a }
    panic       = { param($a) Invoke-Panic $a }
}

# ---- MCP handlers ---------------------------------------------------------------

function Get-ToolList {
    $list = @()
    foreach ($t in $Tools) { $list += , @{ name = $t.name; description = $t.description; inputSchema = $t.inputSchema } }
    return @{ tools = $list }
}

function Invoke-Tool($id, $params) {
    $name = $params.name
    if (-not $Handlers.ContainsKey($name)) { Send-Error $id -32602 "Unknown tool: $name"; return }
    $a = $params.arguments
    if ($null -eq $a) { $a = [pscustomobject]@{} }
    try {
        Write-Log "call $name"
        $text = & $Handlers[$name] $a
        Send-Result $id @{ content = @(@{ type = 'text'; text = [string]$text }) }
    } catch {
        Write-Log "error $name : $($_.Exception.Message)"
        Send-Result $id @{ content = @(@{ type = 'text'; text = $_.Exception.Message }); isError = $true }
    }
}

Write-Log "server start (pid $PID)"

while ($null -ne ($line = $stdin.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try { $msg = $line | ConvertFrom-Json } catch { Send-Error $null -32700 'Parse error'; continue }
    $hasId = $msg.PSObject.Properties.Name -contains 'id'
    $id = $msg.id
    try {
        switch ($msg.method) {
            'initialize' {
                $pv = '2025-06-18'
                if ($msg.params -and $msg.params.protocolVersion) { $pv = $msg.params.protocolVersion }
                Send-Result $id @{
                    protocolVersion = $pv
                    capabilities    = @{ tools = @{ listChanged = $false } }
                    serverInfo      = @{ name = 'character-animator'; version = $ServerVersion }
                    instructions    = 'Plays Adobe Character Animator over MIDI (it has no scripting API). Start with status. Triggers in Character Animator must be linked to MIDI once: map_trigger a name, have the user click the trigger''s MIDI field, then learn. After that, use trigger/note for swaps and gestures, control/ramp for parameters, perform for timed sequences (e.g. while recording). Use panic if something sticks.'
                }
            }
            'ping' { Send-Result $id @{} }
            'tools/list' { Send-Result $id (Get-ToolList) }
            'tools/call' { Invoke-Tool $id $msg.params }
            'resources/list' { Send-Result $id @{ resources = @() } }
            'prompts/list' { Send-Result $id @{ prompts = @() } }
            default { if ($hasId) { Send-Error $id -32601 "Method not found: $($msg.method)" } }
        }
    } catch {
        Write-Log "handler error: $($_.Exception.Message)"
        if ($hasId) { Send-Error $id -32603 $_.Exception.Message }
    }
}

if ($script:Handle -ne [IntPtr]::Zero) { [void][ChMcp.WinMM]::midiOutClose($script:Handle) }
Write-Log 'server exit'
