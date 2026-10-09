<#
  Installs the Premiere Pro side of the MCP server:
    1. Copies bridge/ to %APPDATA%\Adobe\CEP\extensions\luminary-mcp-bridge (a CEP extension).
    2. Sets PlayerDebugMode=1 for CSXS.11 and CSXS.12 under HKCU so Premiere loads this unsigned
       extension. (Undo: install.ps1 -Uninstall, which removes the extension and the setting.)
  Restart Premiere Pro afterwards.
#>
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\luminary-mcp-bridge'
$keys = @('HKCU:\Software\Adobe\CSXS.11', 'HKCU:\Software\Adobe\CSXS.12')

if ($Uninstall) {
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force; "Removed $dest" }
    foreach ($k in $keys) {
        if (Test-Path $k) { Remove-ItemProperty -Path $k -Name PlayerDebugMode -ErrorAction SilentlyContinue; "Cleared PlayerDebugMode in $k" }
    }
    return
}

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Copy-Item (Join-Path $PSScriptRoot 'bridge') $dest -Recurse
"Installed extension -> $dest"
foreach ($k in $keys) {
    if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
    Set-ItemProperty -Path $k -Name PlayerDebugMode -Value '1' -Type String
    "PlayerDebugMode=1 in $k"
}
'Restart Premiere Pro to load it.'
