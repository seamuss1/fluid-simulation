[CmdletBinding(SupportsShouldProcess)]
param(
    [int]$Port = 4173,
    [string]$ExpectedGpu = "Arc Pro B70",
    [string]$BrowserPath = "",
    [switch]$SkipServer
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Get-PreferredBrowserPath {
    param([string]$RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
            throw "BrowserPath does not exist: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
    )

    $browser = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $browser) {
        throw "Chrome or Edge was not found. Pass -BrowserPath with the browser executable to route to the Arc."
    }

    return $browser
}

function Test-ViewerEndpoint {
    param([int]$TestPort)

    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TestPort/viewer-web/" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match 'id="sim-canvas"'
    }
    catch {
        return $false
    }
}

function Wait-ViewerEndpoint {
    param(
        [int]$TestPort,
        [int]$Attempts = 8
    )

    for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
        if (Test-ViewerEndpoint -TestPort $TestPort) {
            return $true
        }
        Start-Sleep -Milliseconds 250
    }

    return $false
}

function Test-GpuNameMatch {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExpectedName,
        [Parameter(Mandatory = $true)]
        [string]$ActualName
    )

    $normalize = {
        param([string]$Value)
        return (($Value.ToLowerInvariant() -replace '\b(?:tm|r)\b', ' ') -replace '[^a-z0-9]+', ' ').Trim()
    }

    $actual = & $normalize $ActualName
    $expectedTokens = (& $normalize $ExpectedName).Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
    if ($expectedTokens.Count -eq 0) {
        return $false
    }

    foreach ($token in $expectedTokens) {
        if (-not $actual.Contains($token)) {
            return $false
        }
    }

    return $true
}

$displayAdapters = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, Status, PNPDeviceID)
$expectedAdapter = $displayAdapters | Where-Object { Test-GpuNameMatch -ExpectedName $ExpectedGpu -ActualName $_.Name } | Select-Object -First 1

Write-Host "Detected display adapters:"
$displayAdapters | Format-Table Name, DriverVersion, Status -AutoSize | Out-String | Write-Host

if (-not $expectedAdapter) {
    throw "Required GPU '$ExpectedGpu' was not found. Refusing to launch a browser that could silently fall back to the integrated GPU."
}

if ($expectedAdapter.Status -and $expectedAdapter.Status -notmatch "OK") {
    throw "Required GPU '$($expectedAdapter.Name)' is not healthy (status: $($expectedAdapter.Status))."
}

$resolvedBrowserPath = Get-PreferredBrowserPath -RequestedPath $BrowserPath
$encodedGpu = [System.Uri]::EscapeDataString($ExpectedGpu)
$viewerUrl = "http://127.0.0.1:$Port/viewer-web/?requireGpu=$encodedGpu"

$serverProcess = $null
if (-not (Test-ViewerEndpoint -TestPort $Port)) {
    if ($SkipServer) {
        throw "No Fluid Simulation viewer is responding at http://127.0.0.1:$Port/viewer-web/. Start it first or omit -SkipServer."
    }

    $python = Get-Command python -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $python) {
        throw "Python is required to serve the static viewer. Install Python or start your own server and rerun with -SkipServer."
    }

    $serverArguments = "-m http.server $Port --bind 127.0.0.1 --directory `"$repoRoot`""
    if ($PSCmdlet.ShouldProcess("http://127.0.0.1:$Port", "start static Fluid Simulation server")) {
        $serverProcess = Start-Process -FilePath $python.Source -ArgumentList $serverArguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
        if (-not (Wait-ViewerEndpoint -TestPort $Port)) {
            throw "The static Fluid Simulation viewer did not start on port $Port."
        }
    }
}

$profileRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("fluid-sim-arc-poc-" + [guid]::NewGuid().ToString("N"))
$browserArguments = @(
    "--force-high-performance-gpu",
    "--user-data-dir=`"$profileRoot`"",
    "--new-window",
    "`"$viewerUrl`""
) -join " "

Write-Host "Required GPU: $($expectedAdapter.Name)"
Write-Host "Browser: $resolvedBrowserPath"
Write-Host "Viewer URL: $viewerUrl"
Write-Host "The page will stop immediately unless its WebGL renderer matches the required GPU and returns a valid asynchronous GPU-timing sample."
Write-Host "For a durable route, set this exact browser executable to High performance in Windows Settings > System > Display > Graphics, then close every browser process before rerunning."

if ($PSCmdlet.ShouldProcess($resolvedBrowserPath, "launch an isolated high-performance GPU proof-of-concept window")) {
    $browserProcess = Start-Process -FilePath $resolvedBrowserPath -ArgumentList $browserArguments -PassThru
    Write-Host "Browser PID: $($browserProcess.Id)"
}

if ($serverProcess) {
    Write-Host "Static-server PID: $($serverProcess.Id)"
}
