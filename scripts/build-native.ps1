param(
    [string]$BuildDir = "build",
    [string]$Target = ""
)

$ErrorActionPreference = "Stop"
$PSScriptRootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $PSScriptRootPath "cmake-common.ps1")

$repoRoot = Split-Path -Parent $PSScriptRootPath
$cmakePath = Get-CMakePath

$buildCommand = "`"$cmakePath`" --build `"$BuildDir`""
if (-not [string]::IsNullOrWhiteSpace($Target)) {
    $buildCommand += " --target `"$Target`""
}

Push-Location $repoRoot
try {
    Invoke-InVsDevShell -Commands @($buildCommand)
}
finally {
    Pop-Location
}
