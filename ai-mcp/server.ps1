<#
  Illustrator MCP server (stdio, JSON-RPC 2.0). No dependencies beyond Windows PowerShell 5.1.

  Each tool call builds an ExtendScript (jsx/_lib.jsx + jsx/<tool>.jsx) and runs it in the running
  Illustrator through its COM interface (Illustrator.Application.DoJavaScript), which returns the
  script's JSON result directly. The COM call runs on a separate runspace so a hung Illustrator
  (a modal dialog, say) times out instead of freezing the server.

  Environment variables (optional):
    AI_MCP_TIMEOUT  Seconds to wait for a result (default 120; some tools set longer)
#>
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)

$WorkDir = Join-Path $env:TEMP 'ai-mcp'
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$LogFile = Join-Path $WorkDir 'server.log'

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $Utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $Utf8)
$stdout.AutoFlush = $true

$ServerVersion = '1.0.0'
$Lib = [IO.File]::ReadAllText((Join-Path $Root 'jsx\_lib.jsx'), $Utf8)
$Tools = [IO.File]::ReadAllText((Join-Path $Root 'tools.json'), $Utf8) | ConvertFrom-Json
$DefaultTimeout = 120
if ($env:AI_MCP_TIMEOUT) { $DefaultTimeout = [int]$env:AI_MCP_TIMEOUT }

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

# ---- Illustrator bridge ---------------------------------------------------

$ComScript = {
    param($code)
    $app = New-Object -ComObject Illustrator.Application
    try { return $app.DoJavaScript($code) }
    finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
}

function Invoke-Illustrator([string]$toolName, [string]$body, [string]$argsJson, [int]$timeout) {
    if (-not (Get-Process Illustrator -ErrorAction SilentlyContinue)) {
        throw 'Illustrator is not running. Open Illustrator, then try again.'
    }

    $wrapper = @'
var __MCP_WORKDIR = "%WORKDIR%";
var __mcpOut;
(function () {
    var out;
    var oldUIL = app.userInteractionLevel;
    var oldCS = app.coordinateSystem;
    try {
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        app.coordinateSystem = CoordinateSystem.ARTBOARDCOORDINATESYSTEM;
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
    } finally {
        try { app.coordinateSystem = oldCS; app.userInteractionLevel = oldUIL; } catch (e2) {}
    }
    __mcpOut = __json(out);
})();
__mcpOut;
'@
    $script = $Lib + "`n" + $wrapper.
        Replace('%WORKDIR%', $WorkDir.Replace('\', '/')).
        Replace('%ARGS%', $argsJson).
        Replace('%BODY%', $body)

    Write-Log "call $toolName"
    $rs = [runspacefactory]::CreateRunspace()
    $rs.ApartmentState = 'STA'
    $rs.Open()
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript($ComScript).AddArgument($script)
    $handle = $ps.BeginInvoke()
    if (-not $handle.AsyncWaitHandle.WaitOne($timeout * 1000)) {
        # Abandon the stuck call; disposing would block until Illustrator returns.
        Write-Log "timeout $toolName"
        throw ("Illustrator did not respond within $timeout s. Check that it isn't showing a dialog or busy, then try again.")
    }
    try {
        $out = $ps.EndInvoke($handle)
        if ($ps.Streams.Error.Count) { throw $ps.Streams.Error[0].Exception }
    } catch {
        $m = $_.Exception.Message
        if ($_.Exception.InnerException) { $m = $_.Exception.InnerException.Message }
        throw "Illustrator scripting error: $m"
    } finally {
        $ps.Dispose()
        $rs.Dispose()
    }
    $text = [string]($out | Select-Object -Last 1)
    if (-not $text) { throw 'Illustrator returned no result.' }
    return $text | ConvertFrom-Json
}

function Get-PreviewJpegBase64([string]$pngPath, [int]$maxSize) {
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Path $pngPath) -or (Get-Item $pngPath).Length -eq 0) {
        if ((Get-Date) -gt $deadline) { throw "Preview was not written: $pngPath" }
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
        # Composite over a checkerboard-free white so transparent areas are visible as white.
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
        $res = Invoke-Illustrator $name $body $argsJson $timeout
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
                    serverInfo      = @{ name = 'illustrator'; version = $ServerVersion }
                    instructions    = 'Controls the running Adobe Illustrator. Start with get_document_info, and use preview_document to see results. Coordinates are points (= px in Web/RGB documents) from the active artboard top-left, y pointing down. Colors "#rrggbb" or "none", fonts by PostScript name. Items are referenced by uuid or name (omit for the single selected item).'
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
