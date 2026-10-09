<#
  Premiere Pro MCP server (stdio, JSON-RPC 2.0). No dependencies beyond Windows PowerShell 5.1.

  Each tool call builds an ExtendScript (jsx/_lib.jsx + jsx/<tool>.jsx) and sends it over a local
  socket to the "MCP Bridge" CEP extension inside Premiere (bridge/, installed by install.ps1),
  which evaluates it with Premiere's ExtendScript engine and returns the JSON result. The bridge
  writes its port and a random token to %LOCALAPPDATA%\premiere-mcp\session.json.

  Environment variables (optional):
    PREMIERE_MCP_TIMEOUT  Seconds to wait for a result (default 120; some tools set longer)
#>
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)

$WorkDir = Join-Path $env:TEMP 'premiere-mcp'
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$LogFile = Join-Path $WorkDir 'server.log'
$SessionFile = Join-Path $env:LOCALAPPDATA 'premiere-mcp\session.json'

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $Utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $Utf8)
$stdout.AutoFlush = $true

$ServerVersion = '1.0.0'
$Lib = [IO.File]::ReadAllText((Join-Path $Root 'jsx\_lib.jsx'), $Utf8)
$Tools = [IO.File]::ReadAllText((Join-Path $Root 'tools.json'), $Utf8) | ConvertFrom-Json
$DefaultTimeout = 120
if ($env:PREMIERE_MCP_TIMEOUT) { $DefaultTimeout = [int]$env:PREMIERE_MCP_TIMEOUT }

function Write-Log([string]$msg) {
    try { Add-Content -Path $LogFile -Value ("{0:s} {1}" -f (Get-Date), $msg) -Encoding UTF8 } catch {}
}

function Send-Message($obj) {
    $stdout.Write((ConvertTo-Json -InputObject $obj -Depth 64 -Compress) + "`n")
}

function Send-Result($id, $result) {
    Send-Message @{ jsonrpc = '2.0'; id = $id; result = $result }
}

function Send-Error($id, [int]$code, [string]$message) {
    Send-Message @{ jsonrpc = '2.0'; id = $id; error = @{ code = $code; message = $message } }
}

# ---- Premiere bridge ------------------------------------------------------

$NotRunning = 'Premiere Pro is not running, or its MCP Bridge extension is not loaded. Open Premiere Pro (the bridge starts with it). ' +
    'If this is the first time, run install.ps1 in the pr-mcp folder and restart Premiere.'

function Invoke-Premiere([string]$toolName, [string]$body, [string]$argsJson, [int]$timeout) {
    if (-not (Get-Process 'Adobe Premiere Pro' -ErrorAction SilentlyContinue)) { throw $NotRunning }
    if (-not (Test-Path $SessionFile)) { throw $NotRunning }
    $session = [IO.File]::ReadAllText($SessionFile, $Utf8) | ConvertFrom-Json

    $wrapper = @'
var __MCP_WORKDIR = "%WORKDIR%";
(function () {
    var out;
    try {
        var value = (function (ARGS) {
%BODY%
        })(%ARGS%);
        out = { ok: true };
        if (value && value.constructor === Object && value.__image) {
            out.image = value.__image;
            delete value.__image;
        }
        out.text = value === undefined ? 'OK' : __json(value, 2);
    } catch (e) {
        out = { ok: false, error: String(e), line: e.line };
    }
    return __json(out);
})();
'@
    $script = $Lib + "`n" + $wrapper.
        Replace('%WORKDIR%', $WorkDir.Replace('\', '/')).
        Replace('%ARGS%', $argsJson).
        Replace('%BODY%', $body)

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $client.BeginConnect('127.0.0.1', [int]$session.port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne(3000) -or -not $client.Connected) { throw $NotRunning }
        $client.EndConnect($ar)
        $stream = $client.GetStream()
        $stream.ReadTimeout = ($timeout + 5) * 1000
        $req = '{"token":' + (ConvertTo-Json $session.token) + ',"timeout":' + $timeout +
            ',"script":' + (ConvertTo-Json $script -Compress) + '}' + "`n"
        $bytes = $Utf8.GetBytes($req)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()

        Write-Log "call $toolName"
        $reader = New-Object System.IO.StreamReader($stream, $Utf8)
        try { $line = $reader.ReadLine() }
        catch { throw "Premiere did not respond within $timeout s. It may be busy or showing a dialog." }
        if (-not $line) { throw 'Premiere closed the connection without a result.' }
        $resp = $line | ConvertFrom-Json
        if (-not $resp.ok) { return [pscustomobject]@{ ok = $false; error = $resp.error } }
        return $resp.result | ConvertFrom-Json
    } catch [System.Net.Sockets.SocketException] {
        throw $NotRunning
    } finally {
        $client.Close()
    }
}

function Get-PreviewJpegBase64([string]$pngPath, [int]$maxSize) {
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Path $pngPath) -or (Get-Item $pngPath).Length -eq 0) {
        if ((Get-Date) -gt $deadline) { throw "Image was not written: $pngPath" }
        Start-Sleep -Milliseconds 100
    }
    Add-Type -AssemblyName System.Drawing
    $bytes = $null
    for ($i = 0; $i -lt 50; $i++) {
        try { $bytes = [IO.File]::ReadAllBytes($pngPath); break } catch { Start-Sleep -Milliseconds 100 }
    }
    $src = [System.Drawing.Image]::FromStream((New-Object IO.MemoryStream(, $bytes)))
    try {
        $scale = [Math]::Min(1.0, $maxSize / [double][Math]::Max($src.Width, $src.Height))
        $w = [Math]::Max(1, [int]($src.Width * $scale))
        $h = [Math]::Max(1, [int]($src.Height * $scale))
        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear([System.Drawing.Color]::White)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($src, 0, 0, $w, $h)
        $g.Dispose()
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]85)
        $ms = New-Object IO.MemoryStream
        $bmp.Save($ms, $codec, $ep)
        $bmp.Dispose()
        return [Convert]::ToBase64String($ms.ToArray())
    } finally {
        $src.Dispose()
        Remove-Item $pngPath -ErrorAction SilentlyContinue
    }
}

# ---- MCP handlers ---------------------------------------------------------

function Get-ToolList {
    $list = @()
    foreach ($t in $Tools) {
        $list += , @{ name = $t.name; description = $t.description; inputSchema = $t.inputSchema }
    }
    return @{ tools = $list }
}

function Invoke-Tool($id, $params) {
    $name = $params.name
    $tool = $Tools | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if (-not $tool) { Send-Error $id -32602 "Unknown tool: $name"; return }

    $argsJson = '{}'
    if ($null -ne $params.arguments) { $argsJson = ConvertTo-Json -InputObject $params.arguments -Depth 64 -Compress }
    $body = [IO.File]::ReadAllText((Join-Path $Root "jsx\$name.jsx"), $Utf8)
    $timeout = $DefaultTimeout
    if ($tool.timeout) { $timeout = [Math]::Max([int]$tool.timeout, $DefaultTimeout) }

    try {
        $res = Invoke-Premiere $name $body $argsJson $timeout
    } catch {
        Write-Log "error $name : $($_.Exception.Message)"
        Send-Result $id @{ content = @(@{ type = 'text'; text = $_.Exception.Message }); isError = $true }
        return
    }

    if (-not $res.ok) {
        $msg = $res.error
        if ($res.line) { $msg += " (script line $($res.line))" }
        Send-Result $id @{ content = @(@{ type = 'text'; text = $msg }); isError = $true }
        return
    }

    if ($res.image) {
        $maxSize = 1024
        if ($params.arguments -and $params.arguments.max_size) { $maxSize = [int]$params.arguments.max_size }
        try {
            $b64 = Get-PreviewJpegBase64 $res.image $maxSize
        } catch {
            Send-Result $id @{ content = @(@{ type = 'text'; text = $_.Exception.Message }); isError = $true }
            return
        }
        # Splice the base64 in afterwards: ConvertTo-Json in PS 5.1 is slow and size-limited on large strings.
        $json = ConvertTo-Json -Depth 64 -Compress -InputObject @{
            jsonrpc = '2.0'; id = $id
            result  = @{ content = @(
                    @{ type = 'image'; data = '__B64__'; mimeType = 'image/jpeg' },
                    @{ type = 'text'; text = $res.text }
                ) }
        }
        $stdout.Write($json.Replace('__B64__', $b64) + "`n")
        return
    }

    Send-Result $id @{ content = @(@{ type = 'text'; text = $res.text }) }
}

Write-Log "server start (pid $PID)"

while ($null -ne ($line = $stdin.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try {
        $msg = $line | ConvertFrom-Json
    } catch {
        Send-Error $null -32700 'Parse error'
        continue
    }
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
                    serverInfo      = @{ name = 'premiere-pro'; version = $ServerVersion }
                    instructions    = 'Controls the running Adobe Premiere Pro. Start with get_project_info; check edits with preview_frame. Times are in seconds on the sequence timeline. Tracks are 1-based (V1, A1); clips are 0-based indexes on their track (or names). Project items are referenced by name or "Bin/Name" path. Premiere has no scripted undo, so save before big changes. run_extendscript is the escape hatch (QE DOM via app.enableQE()).'
                }
            }
            'ping' { Send-Result $id @{} }
            'tools/list' { Send-Result $id (Get-ToolList) }
            'tools/call' { Invoke-Tool $id $msg.params }
            'resources/list' { Send-Result $id @{ resources = @() } }
            'prompts/list' { Send-Result $id @{ prompts = @() } }
            default {
                if ($hasId) { Send-Error $id -32601 "Method not found: $($msg.method)" }
            }
        }
    } catch {
        Write-Log "handler error: $($_.Exception.Message)"
        if ($hasId) { Send-Error $id -32603 $_.Exception.Message }
    }
}

Write-Log 'server exit'
