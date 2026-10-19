param(
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$dist = Join-Path $PSScriptRoot "dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }

dotnet publish Tern.Windows.csproj `
    -c $Configuration `
    -r $Runtime `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -o $dist

$zip = Join-Path $PSScriptRoot "Tern-Windows-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zip -Force

$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (Test-Path $iscc) {
    & $iscc Tern.iss
    Copy-Item (Join-Path $dist "Tern-Windows-Setup.exe") (Join-Path $PSScriptRoot "Tern-Windows-Setup.exe") -Force
    Write-Host "Built: $PSScriptRoot\Tern-Windows-Setup.exe"
} else {
    Write-Host "Inno Setup 6 not found; skipping installer. Install it from https://jrsoftware.org/isinfo.php"
}

Write-Host "Built: $zip"
