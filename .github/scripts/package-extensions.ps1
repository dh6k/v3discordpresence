# Packages Extension/ into chrome/firefox zips under dist/.
# Uses ZipArchive with forward-slash entry names (Compress-Archive writes "\" which stores reject).
$ErrorActionPreference = 'Stop'

function Compress-Directory {
    param([string]$SourceDir, [string]$ZipPath)
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::Open($ZipPath, [IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -Path $SourceDir -Recurse -File | ForEach-Object {
            $rel = $_.FullName.Substring($SourceDir.Length).TrimStart('\', '/')
            $entryName = $rel.Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName) | Out-Null
        }
    }
    finally {
        $zip.Dispose()
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$ext = Join-Path $repoRoot 'Extension'
$dist = Join-Path $repoRoot 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null

$manifestPath = Join-Path $ext 'manifest.json'
$version = (Get-Content $manifestPath -Raw | ConvertFrom-Json).version
if (!$version) { throw "Cannot read version from $manifestPath" }
Write-Host "Extension version: $version"

# Firefox: ship as-is (gecko id lives in browser_specific_settings).
$ffZip = Join-Path $dist "v3discordpresence-$version-firefox.zip"
Compress-Directory -SourceDir $ext -ZipPath $ffZip
Write-Host "OK: $ffZip"

# Chrome: drop browser_specific_settings (Chrome warns / store tooling is happier).
$chromeStage = Join-Path $env:TEMP "v3dp-chrome-ext-$version"
if (Test-Path $chromeStage) { Remove-Item $chromeStage -Recurse -Force }
Copy-Item $ext $chromeStage -Recurse
$chromeManifestPath = Join-Path $chromeStage 'manifest.json'
$chromeManifest = Get-Content $chromeManifestPath -Raw | ConvertFrom-Json
$chromeManifest.PSObject.Properties.Remove('browser_specific_settings')
# WriteAllText avoids BOM that some store linters reject.
[System.IO.File]::WriteAllText($chromeManifestPath, ($chromeManifest | ConvertTo-Json -Depth 20))

$crZip = Join-Path $dist "v3discordpresence-$version-chrome.zip"
Compress-Directory -SourceDir $chromeStage -ZipPath $crZip
Write-Host "OK: $crZip"
