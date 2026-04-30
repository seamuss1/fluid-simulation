param(
    [string]$BuildDir = "build"
)

$ErrorActionPreference = "Stop"
$PSScriptRootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $PSScriptRootPath "cmake-common.ps1")

$repoRoot = Split-Path -Parent $PSScriptRootPath
$ctestCommand = "ctest --test-dir `"$BuildDir`" --output-on-failure"

Push-Location $repoRoot
try {
    Invoke-InVsDevShell -Commands @($ctestCommand)
}
finally {
    Pop-Location
}
