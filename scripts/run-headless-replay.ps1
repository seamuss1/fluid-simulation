param(
    [string]$BuildDir = "build",
    [int]$Steps = 900,
    [string]$OutputPath = "artifacts/tank-fill-replay.html",
    [string]$CsvPath = ""
)

$ErrorActionPreference = "Stop"
$PSScriptRootPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $PSScriptRootPath

function Resolve-RepoPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }

    return Join-Path $repoRoot $PathValue
}

$configureScript = Join-Path $PSScriptRootPath "configure-native.ps1"
$buildScript = Join-Path $PSScriptRootPath "build-native.ps1"
$buildRoot = Resolve-RepoPath $BuildDir
$cachePath = Join-Path $buildRoot "CMakeCache.txt"

if (-not (Test-Path -LiteralPath $cachePath)) {
    & $configureScript -BuildDir $BuildDir
}

& $buildScript -BuildDir $BuildDir -Target "fluidsim-tank-fill-benchmark"

$exeCandidates = @(
    (Join-Path $buildRoot "fluidsim-tank-fill-benchmark.exe"),
    (Join-Path $buildRoot "benchmarks\\fluidsim-tank-fill-benchmark.exe")
)

$benchmarkExe = $exeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $benchmarkExe) {
    $benchmarkExe = Get-ChildItem -Path $buildRoot -Recurse -Filter "fluidsim-tank-fill-benchmark.exe" -File |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not $benchmarkExe) {
    throw "Benchmark executable was not found under $buildRoot."
}

$resolvedOutputPath = Resolve-RepoPath $OutputPath
$resolvedCsvPath = ""
if (-not [string]::IsNullOrWhiteSpace($CsvPath)) {
    $resolvedCsvPath = Resolve-RepoPath $CsvPath
}

Push-Location $repoRoot
try {
    if ([string]::IsNullOrWhiteSpace($resolvedCsvPath)) {
        & $benchmarkExe "$Steps" "$resolvedOutputPath"
    }
    else {
        & $benchmarkExe "$Steps" "$resolvedOutputPath" "$resolvedCsvPath"
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Headless replay generation failed with exit code $LASTEXITCODE."
    }

    Write-Host "Replay viewer ready at $resolvedOutputPath"
    if (-not [string]::IsNullOrWhiteSpace($resolvedCsvPath)) {
        Write-Host "Benchmark CSV ready at $resolvedCsvPath"
    }
}
finally {
    Pop-Location
}
