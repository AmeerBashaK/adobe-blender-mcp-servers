<#
  Installs the Blender side of the MCP server: copies bridge/mcp_bridge.py into the scripts/startup
  folder of every Blender version found under %APPDATA%\Blender Foundation\Blender (or the version
  you pass), so the bridge starts automatically with Blender. Restart Blender afterwards.

    powershell -ExecutionPolicy Bypass -File install.ps1            # all versions found
    powershell -ExecutionPolicy Bypass -File install.ps1 -Version 5.2
#>
param([string]$Version)
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'bridge\mcp_bridge.py'
$base = Join-Path $env:APPDATA 'Blender Foundation\Blender'

$versions = @()
if ($Version) { $versions = @($Version) }
elseif (Test-Path $base) { $versions = Get-ChildItem $base -Directory | Where-Object { $_.Name -match '^\d+\.\d+$' } | ForEach-Object { $_.Name } }
if (-not $versions) {
    # Fall back to installed Blender versions (config folder not created yet).
    $versions = Get-ChildItem "$env:ProgramFiles\Blender Foundation" -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { if ($_.Name -match '(\d+\.\d+)') { $Matches[1] } }
}
if (-not $versions) { throw 'No Blender version found. Pass -Version, e.g. -Version 5.2' }

foreach ($v in $versions) {
    $dest = Join-Path $base "$v\scripts\startup"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item $src (Join-Path $dest 'mcp_bridge.py') -Force
    "Installed bridge for Blender $v -> $dest"
}
'Restart Blender to load it.'
