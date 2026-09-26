# Packages Extension/ into Chrome/Firefox unpacked folders, CRX3, and update manifests.
# Implementation lives in scripts/pack-extension.js (PowerShell ConvertTo-Json corrupts MV3 manifests).
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$packer = Join-Path $root 'scripts\pack-extension.js'
if (!(Test-Path $packer)) { throw "missing $packer" }

node $packer
if ($LASTEXITCODE -ne 0) { throw "pack-extension.js failed with exit $LASTEXITCODE" }
