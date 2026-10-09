<#
  After Effects MCP server (stdio, JSON-RPC 2.0). No dependencies beyond Windows PowerShell 5.1.

  Each tool call writes an ExtendScript file (jsx/_lib.jsx + jsx/<tool>.jsx), hands it to the
  running After Effects with `AfterFX.exe -r <file>`, and waits for the script to write its
  JSON result next to it.

  Environment variables (optional):
    AE_PATH         Full path to AfterFX.exe (default: the running instance, else newest install)
    AE_MCP_TIMEOUT  Seconds to wait for a result (default 60; render_comp uses 3600)
#>
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Utf8Bom = New-Object System.Text.UTF8Encoding($true)

$WorkDir = Join-Path $env:TEMP 'ae-mcp'
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
$LogFile = Join-Path $WorkDir 'server.log'

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $Utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $Utf8)
$stdout.AutoFlush = $true

$ServerVersion = '1.0.0'
$Lib = [IO.File]::ReadAllText((Join-Path $Root 'jsx\_lib.jsx'), $Utf8)
$Tools = [IO.File]::ReadAllText((Join-Path $Root 'tools.json'), $Utf8) | ConvertFrom-Json
$DefaultTimeout = 60
if ($env:AE_MCP_TIMEOUT) { $DefaultTimeout = [int]$env:AE_MCP_TIMEOUT }

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

# ---- After Effects bridge -------------------------------------------------

function Get-AfterFX {
    if ($env:AE_PATH) {
        if (Test-Path $env:AE_PATH) { return $env:AE_PATH }
        throw "AE_PATH does not exist: $env:AE_PATH"
    }
    $proc = Get-Process AfterFX -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) {
        throw 'After Effects is not running. Open After Effects (and a project), then try again.'
    }
    if ($proc.Path) { return $proc.Path }
    $exe = Get-ChildItem (Join-Path $env:ProgramFiles 'Adobe') -Directory -Filter 'Adobe After Effects*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { Join-Path $_.FullName 'Support Files\AfterFX.exe' } |
        Where-Object { Test-Path $_ } |
        Select-Object -First 1
    if (-not $exe) { throw 'Could not find AfterFX.exe. Set the AE_PATH environment variable.' }
    return $exe
}

function Invoke-AE([string]$toolName, [string]$body, [string]$argsJson, [bool]$undoGroup, [int]$timeout) {
    $exe = Get-AfterFX
    $id = [guid]::NewGuid().ToString('N')
    $jsxPath = Join-Path $WorkDir "$id.jsx"
    $resPath = Join-Path $WorkDir "$id.json"

    $undoOpen = ''
    $undoClose = ''
    if ($undoGroup) {
        $undoOpen = "app.beginUndoGroup('MCP: $toolName');"
        $undoClose = 'try { app.endUndoGroup(); } catch (e2) {}'
    }

    $wrapper = @'
var __MCP_WORKDIR = "%WORKDIR%";
(function () {
    var ARGS = %ARGS%;
    var out;
    app.beginSuppressDialogs();
    %UNDO_OPEN%
    try {
        var value = (function (ARGS) {
%BODY%
        })(ARGS);
        out = { ok: true };
        if (value && value.constructor === Object && value.__image) {
            out.image = value.__image;
            delete value.__image;
        }
        out.text = value === undefined ? 'OK' : __json(value, 2);
    } catch (e) {
        out = { ok: false, error: String(e), line: e.line };
    }
    %UNDO_CLOSE%
    try { app.endSuppressDialogs(false); } catch (e3) {}
    __mcpWrite("%RESULT%", out);
})();
'@
    $script = $Lib + "`n" + $wrapper.
        Replace('%WORKDIR%', $WorkDir.Replace('\', '/')).
        Replace('%RESULT%', $resPath.Replace('\', '/')).
        Replace('%UNDO_OPEN%', $undoOpen).
        Replace('%UNDO_CLOSE%', $undoClose).
        Replace('%BODY%', $body).
        Replace('%ARGS%', $argsJson)
    [IO.File]::WriteAllText($jsxPath, $script, $Utf8Bom)

    Write-Log "call $toolName -> $id"
    # `-r <file>` is silently ignored by a running AE 26.x, but `-s <code>` is forwarded, so use it to load the file.
    $loader = "`$.evalFile(new File('" + $jsxPath.Replace('\', '/') + "'))"
    Start-Process -FilePath $exe -ArgumentList @('-s', "`"$loader`"") | Out-Null

    $deadline = (Get-Date).AddSeconds($timeout)
    while (-not (Test-Path $resPath)) {
        if ((Get-Date) -gt $deadline) {
            throw ("After Effects did not respond within $timeout s. Check that it isn't showing a modal dialog or rendering, " +
                'and that Edit > Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" is enabled.')
        }
        Start-Sleep -Milliseconds 100
    }
    $text = [IO.File]::ReadAllText($resPath, $Utf8)
    Remove-Item $jsxPath, $resPath -ErrorAction SilentlyContinue
    return $text | ConvertFrom-Json
}

function Get-PreviewJpegBase64([string]$pngPath, [int]$maxSize) {
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Path $pngPath) -or (Get-Item $pngPath).Length -eq 0) {
        if ((Get-Date) -gt $deadline) { throw "Frame was not written: $pngPath" }
        Start-Sleep -Milliseconds 100
    }
    Add-Type -AssemblyName System.Drawing
    # Read through a stream copy so the file isn't locked while AE may still hold it.
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
    $undo = $tool.undoGroup -ne $false
    $timeout = $DefaultTimeout
    if ($tool.timeout) { $timeout = [Math]::Max([int]$tool.timeout, $DefaultTimeout) }

    try {
        $res = Invoke-AE $name $body $argsJson $undo $timeout
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
                    serverInfo      = @{ name = 'after-effects'; version = $ServerVersion }
                    instructions    = 'Controls the running Adobe After Effects. Start with get_project_info or get_comp_details. Times are in seconds, positions in comp pixels, colors as "#rrggbb". Each modifying call is one undo step in After Effects.'
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
