param(
    [ValidateSet("FP16S", "FP16C")]
    [string]$Mode = "FP16S",
    [string]$DeviceId = "1",
    [string]$ExpectedDeviceName = "Arc(TM) Pro B70",
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
if (-not [string]::IsNullOrWhiteSpace($ExpectedDeviceName)) {
    Write-Host "Expecting device name to contain: $ExpectedDeviceName"
}

Push-Location $repo
try {
    $buildCommand = ('set Path=&& set "PATH={0}"&& call "{1}" -arch=amd64 && "{2}" FluidX3D.sln /m /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v143' -f $env:Path, $vsDevCmd, $msbuild)
    cmd /c $buildCommand
    if ($LASTEXITCODE -ne 0) {
        throw "FluidX3D build failed."
    }

    if (-not $BuildOnly) {
        $exe = Join-Path $repo "bin\\FluidX3D.exe"
        $launchArgs = @()
        if ([string]::IsNullOrWhiteSpace($DeviceId)) {
            & $exe 2>&1 | Tee-Object -Variable capturedOutput
        } else {
            $launchArgs += $DeviceId
            & $exe @launchArgs 2>&1 | Tee-Object -Variable capturedOutput
        }
        if ($LASTEXITCODE -ne 0) {
            throw "FluidX3D benchmark run failed."
        }
        if (-not [string]::IsNullOrWhiteSpace($ExpectedDeviceName)) {
            $runText = $capturedOutput | Out-String -Width 4096
            $match = [regex]::Match($runText, "\|\s*Device Name\s*\|\s*(?<name>.+?)\s+\|")
            if (-not $match.Success) {
                throw "FluidX3D ran, but the selected OpenCL device name was not found in its output."
            }
            $selectedDeviceName = $match.Groups["name"].Value.Trim()
            if ($selectedDeviceName -notlike "*$ExpectedDeviceName*") {
                throw "FluidX3D selected '$selectedDeviceName' instead of the expected Arc Pro B70 device."
            }
            Write-Host "Verified OpenCL device: $selectedDeviceName"
        }
    }
}
finally {
    Pop-Location
}
