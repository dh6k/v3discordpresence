# Stamps ProductVersion + a fresh ProductCode into the vdproj so MSI major-upgrade works.
# UpgradeCode is left alone (that is what finds the previous install).
# Windows Installer ERROR 1638 happens when a different package reuses the same ProductCode.
param(
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$vdproj = Join-Path $PSScriptRoot '..\..\Host\v3dpsetup\v3dpsetup.vdproj'
$vdproj = (Resolve-Path $vdproj).Path

if (-not $Version) {
  if ($env:GITHUB_REF_TYPE -eq 'tag' -and $env:GITHUB_REF_NAME) {
    $Version = $env:GITHUB_REF_NAME.TrimStart('v')
  }
  elseif ($env:YTDPP_MSI_VERSION) {
    $Version = $env:YTDPP_MSI_VERSION
  }
  else {
    $pkg = Join-Path $PSScriptRoot '..\..\NodeHost\package.json'
    $Version = (Get-Content $pkg -Raw | ConvertFrom-Json).version
  }
}

# MSI ProductVersion uses only major.minor.build (X.Y.Z)
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  throw "MSI ProductVersion must be X.Y.Z, got '$Version'"
}

# New ProductCode every stamp — required for "update over previous" to work.
$newProductCode = '{' + ([guid]::NewGuid().ToString().ToUpper()) + '}'
$newPackageCode = '{' + ([guid]::NewGuid().ToString().ToUpper()) + '}'

$text = [IO.File]::ReadAllText($vdproj)

# Only replace the Product section identities (not BootstrapperCfg ProductCode = .NETFramework...)
$text = $text -replace '"ProductCode" = "8:\{[0-9A-Fa-f-]{36}\}"', ('"ProductCode" = "8:' + $newProductCode + '"')
$text = $text -replace '"PackageCode" = "8:\{[0-9A-Fa-f-]{36}\}"', ('"PackageCode" = "8:' + $newPackageCode + '"')
$text = $text -replace '"ProductVersion" = "8:\d+\.\d+\.\d+"', ('"ProductVersion" = "8:' + $Version + '"')

[IO.File]::WriteAllText($vdproj, $text)

Write-Host "MSI identity stamped:"
Write-Host "  ProductVersion = $Version"
Write-Host "  ProductCode    = $newProductCode"
Write-Host "  PackageCode    = $newPackageCode"
Write-Host "  UpgradeCode    = (unchanged - required for RemovePreviousVersions)"
exit 0
