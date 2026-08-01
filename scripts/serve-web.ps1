param(
  [int]$Port = 4173
)

$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "Fluid Simulation is available at http://127.0.0.1:$Port/viewer-web/"
python -m http.server $Port --bind 127.0.0.1 --directory $repoRoot
