param(
    [ValidateSet("FP16S", "FP16C")]
    [string]$Mode = "FP16S",
    [string]$DeviceId = "1",
    [switch]$BuildOnly
)

$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Join-Path $workspace "FluidX3D"
$definesPath = Join-Path $repo "src\\defines.hpp"

if (-not (Test-Path $repo)) {
    throw "FluidX3D repo not found at $repo"
}

if (-not (Test-Path $definesPath)) {
    throw "defines.hpp not found at $definesPath"
}

$defines = Get-Content -Raw $definesPath
switch ($Mode) {
    "FP16S" {
        $defines = $defines -replace "(?m)^(?://)?#define FP16S", "#define FP16S"
        $defines = $defines -replace "(?m)^(?://)?#define FP16C", "//#define FP16C"
    }
    "FP16C" {
        $defines = $defines -replace "(?m)^(?://)?#define FP16S", "//#define FP16S"
        $defines = $defines -replace "(?m)^(?://)?#define FP16C", "#define FP16C"
    }
}
Set-Content -Path $definesPath -Value $defines

$vsRoots = @(
    "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community",
    "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools"
)

$vsRoot = $null
$vsDevCmd = $null
$msbuild = $null
foreach ($candidate in $vsRoots) {
    $candidateVsDevCmd = Join-Path $candidate "Common7\\Tools\\VsDevCmd.bat"
    $candidateMsbuild = Join-Path $candidate "MSBuild\\Current\\Bin\\amd64\\MSBuild.exe"
    if ((Test-Path $candidateVsDevCmd) -and (Test-Path $candidateMsbuild)) {
        $vsRoot = $candidate
        $vsDevCmd = $candidateVsDevCmd
        $msbuild = $candidateMsbuild
        break
    }
}

if (-not $vsRoot) {
    throw "Visual Studio with MSBuild was not found."
}

Write-Host "Using Visual Studio at: $vsRoot"
Write-Host "Benchmark mode: $Mode"
if ([string]::IsNullOrWhiteSpace($DeviceId)) {
    Write-Host "OpenCL device: auto-select"
} else {
    Write-Host "OpenCL device ID: $DeviceId"
}

Push-Location $repo
try {
    $buildCommand = ('call "{0}" -arch=amd64 && "{1}" FluidX3D.sln /m /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143' -f $vsDevCmd, $msbuild)
    cmd /c $buildCommand
    if ($LASTEXITCODE -ne 0) {
        throw "FluidX3D build failed."
    }

    if (-not $BuildOnly) {
        $exe = Join-Path $repo "bin\\FluidX3D.exe"
        if ([string]::IsNullOrWhiteSpace($DeviceId)) {
            & $exe
        } else {
            & $exe $DeviceId
        }
        if ($LASTEXITCODE -ne 0) {
            throw "FluidX3D benchmark run failed."
        }
    }
}
finally {
    Pop-Location
}
