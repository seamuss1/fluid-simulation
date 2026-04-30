param(
    [string]$BuildDir = "build"
)

$ErrorActionPreference = "Stop"
$PSScriptRootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $PSScriptRootPath "cmake-common.ps1")

$repoRoot = Split-Path -Parent $PSScriptRootPath
$cmakePath = Get-CMakePath
$toolchainPath = Join-Path $repoRoot "cmake\toolchains\windows-msvc.cmake"

Push-Location $repoRoot
try {
    Invoke-InVsDevShell -Commands @(
        "`"$cmakePath`" -S . -B `"$BuildDir`" -G `"NMake Makefiles`" -DCMAKE_TOOLCHAIN_FILE=`"$toolchainPath`""
    )
}
finally {
    Pop-Location
}
