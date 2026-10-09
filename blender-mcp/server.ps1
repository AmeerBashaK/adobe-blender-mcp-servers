<#
  Blender MCP server (stdio, JSON-RPC 2.0). No dependencies beyond Windows PowerShell 5.1.

  The work happens inside Blender: bridge/mcp_bridge.py (installed into Blender's scripts/startup
  folder by install.ps1) listens on 127.0.0.1 and runs each tool on Blender's main thread. This
  server just forwards tool calls over that socket, using the token Blender writes to
  %LOCALAPPDATA%\blender-mcp\session.json.

  Environment variables (optional):
    BLENDER_MCP_TIMEOUT  Seconds to wait for a result (default 120; some tools set longer)
#>
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)

$WorkDir = Join-Path $env:TEMP 'blender-mcp'
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$LogFile = Join-Path $WorkDir 'server.log'
$SessionFile = Join-Path $env:LOCALAPPDATA 'blender-mcp\session.json'

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $Utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $Utf8)
$stdout.AutoFlush = $true

$ServerVersion = '1.0.0'
$Tools = [IO.File]::ReadAllText((Join-Path $Root 'tools.json'), $Utf8) | ConvertFrom-Json
$DefaultTimeout = 120
if ($env:BLENDER_MCP_TIMEOUT) { $DefaultTimeout = [int]$env:BLENDER_MCP_TIMEOUT }

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

# ---- Blender bridge -------------------------------------------------------

$NotRunning = 'Blender is not running, or its MCP bridge is not loaded. Open Blender (the bridge starts with it). ' +
    'If this is the first time, run install.ps1 in the blender-mcp folder and restart Blender.'

function Invoke-Blender([string]$toolName, [string]$argsJson, [int]$timeout) {
    if (-not (Get-Process blender -ErrorAction SilentlyContinue)) { throw $NotRunning }
    if (-not (Test-Path $SessionFile)) { throw $NotRunning }
    $session = [IO.File]::ReadAllText($SessionFile, $Utf8) | ConvertFrom-Json

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $client.BeginConnect('127.0.0.1', [int]$session.port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne(3000) -or -not $client.Connected) { throw $NotRunning }
        $client.EndConnect($ar)
        $stream = $client.GetStream()
        $stream.ReadTimeout = ($timeout + 5) * 1000
        $req = '{"token":' + (ConvertTo-Json $session.token) + ',"tool":' + (ConvertTo-Json $toolName) +
            ',"timeout":' + $timeout + ',"args":' + $argsJson + '}' + "`n"
        $bytes = $Utf8.GetBytes($req)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()

        Write-Log "call $toolName"
        $reader = New-Object System.IO.StreamReader($stream, $Utf8)
        try { $line = $reader.ReadLine() }
        catch { throw "Blender did not respond within $timeout s. It may be busy (rendering?) or showing a dialog." }
        if (-not $line) { throw 'Blender closed the connection without a result.' }
        return $line | ConvertFrom-Json
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
    $timeout = $DefaultTimeout
    if ($tool.timeout) { $timeout = [Math]::Max([int]$tool.timeout, $DefaultTimeout) }

    try {
        $res = Invoke-Blender $name $argsJson $timeout
    } catch {
        Write-Log "error $name : $($_.Exception.Message)"
        Send-Result $id @{ content = @(@{ type = 'text'; text = $_.Exception.Message }); isError = $true }
        return
    }

    if (-not $res.ok) {
        $msg = $res.error
        if ($res.trace) { $msg += "`n" + $res.trace }
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
                    serverInfo      = @{ name = 'blender'; version = $ServerVersion }
                    instructions    = 'Controls the running Blender. Start with get_scene_info; check work with viewport_screenshot (fast) or render_preview (needs a camera). Units are meters, rotations in degrees, colors "#rrggbb". Objects are referenced by name (omit for the active object). Each modifying call is one undo step. run_python is the escape hatch for anything else.'
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
