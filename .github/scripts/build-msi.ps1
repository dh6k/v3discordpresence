# Builds Host/v3dpsetup/Release/v3dpsetup.msi via Visual Studio Installer Projects (vdproj).
# Requires NodeHost/src/v3dpwin.exe to already exist (npm run compile).
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$exe = Join-Path $repoRoot 'NodeHost\src\v3dpwin.exe'
$sln = Join-Path $repoRoot 'Host\v3dpsetup\v3dpsetup.sln'
$outMsi = Join-Path $repoRoot 'Host\v3dpsetup\Release\v3dpsetup.msi'
$log = Join-Path $env:TEMP 'v3dp-msi-build.log'

if (!(Test-Path $exe)) {
    throw "Missing $exe - run 'npm ci; npm run compile' in NodeHost first."
}

# Fresh ProductCode + ProductVersion each build so Windows Installer can replace
# a previous install (otherwise ERROR 1638: "Another version of this product is already installed").
# Note: do NOT test $LASTEXITCODE after a child .ps1 — it stays $null, and ($null -ne 0) is $true.
& (Join-Path $PSScriptRoot 'stamp-msi-identity.ps1')
if (-not $?) { throw 'stamp-msi-identity.ps1 failed' }

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (!(Test-Path $vswhere)) {
    throw 'vswhere.exe not found - Visual Studio Installer is missing on this runner.'
}

$devenv = & $vswhere -latest -products * -find 'Common7\IDE\devenv.com' | Select-Object -First 1
if (!$devenv) {
    throw 'devenv.com not found via vswhere.'
}
$ideDir = Split-Path $devenv -Parent
Write-Host "Using devenv: $devenv"

# VS Installer Projects is not preinstalled on GitHub runners.
$vsix = Join-Path $env:TEMP 'MicrosoftVisualStudioInstallerProjects.vsix'
$marketplace = 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/VisualStudioClient/vsextensions/MicrosoftVisualStudio2022InstallerProjects/latest/vspackage'
Write-Host 'Downloading Installer Projects VSIX...'
Invoke-WebRequest -Uri $marketplace -OutFile $vsix

# Marketplace vspackage may be gzip-wrapped; VSIXInstaller wants a real .vsix.
$bytes = [IO.File]::ReadAllBytes($vsix)
if ($bytes.Length -ge 2 -and $bytes[0] -eq 0x1f -and $bytes[1] -eq 0x8b) {
    Write-Host 'Decompressing gzip-wrapped VSIX...'
    $ms = New-Object IO.MemoryStream
    $gzip = New-Object IO.Compression.GzipStream((New-Object IO.MemoryStream(,$bytes)), [IO.Compression.CompressionMode]::Decompress)
    $gzip.CopyTo($ms)
    $gzip.Dispose()
    [IO.File]::WriteAllBytes($vsix, $ms.ToArray())
    $ms.Dispose()
}

$vsixInstaller = Join-Path $ideDir 'VSIXInstaller.exe'
if (!(Test-Path $vsixInstaller)) {
    throw "VSIXInstaller.exe not found at $vsixInstaller"
}

Write-Host 'Installing VS Installer Projects extension (quiet)...'
& $vsixInstaller /quiet /admin $vsix | Out-Null
# 1001 = already installed, 2003 = restart required (extension still usable)
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1001 -and $LASTEXITCODE -ne 2003) {
    Write-Host "VSIXInstaller exit code: $LASTEXITCODE (continuing)"
}

# Refresh MEF/project-system cache so vdproj is recognized.
& $devenv /updateconfiguration | Out-Null

if (Test-Path $outMsi) { Remove-Item $outMsi -Force }

Write-Host "Building MSI: $sln"
& $devenv $sln /Build 'Release|Any CPU' /Project 'v3dpsetup' /Out $log
$buildExit = $LASTEXITCODE
if (Test-Path $log) {
    Get-Content $log | Write-Host
}
if ($buildExit -ne 0) {
    throw "devenv build failed with exit code $buildExit"
}
if (!(Test-Path $outMsi)) {
    throw "Expected MSI not produced: $outMsi"
}

Write-Host ("OK: {0} ({1} KB)" -f $outMsi, [math]::Round((Get-Item $outMsi).Length / 1KB, 1))
