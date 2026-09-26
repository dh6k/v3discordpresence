# Adds a Chrome extension ID to the native-host allow list (repo + installed copy).
# Usage:
#   .\scripts\allow-extension-id.ps1 -Id <32-char id from chrome://extensions>
#   .\scripts\allow-extension-id.ps1 -Path D:\...\my-unpacked-ext   # computes Chrome unpacked id
param(
  [string]$Id,
  [string]$Path
)

$ErrorActionPreference = 'Stop'

function Get-UnpackedExtensionId([string]$extPath) {
  $extPath = (Resolve-Path $extPath).Path
  $code = @"
const crypto = require('crypto');
function extId(input) {
  const hash = crypto.createHash('sha256').update(Buffer.from(input, 'utf8')).digest().subarray(0, 16);
  let s = '';
  for (const b of hash) s += 'abcdefghijklmnop'[(b >> 4) & 15] + 'abcdefghijklmnop'[b & 15];
  return s;
}
// Chrome hashes the native path string (Windows UTF-8). Try the common normalizations.
const p = process.argv[1];
const cands = [p, p + '\\\\', p.toLowerCase(), p.replace(/\\\\/g, '/')];
const seen = new Set();
for (const c of cands) {
  const id = extId(c);
  if (!seen.has(id)) { seen.add(id); console.log(id + '  ' + c); }
}
"@
  $tmp = Join-Path $env:TEMP 'ytdp-unpacked-id.js'
  Set-Content -Path $tmp -Value $code -Encoding UTF8
  $out = & node $tmp $extPath
  Write-Host 'Candidate unpacked IDs (use the one chrome://extensions shows):'
  $out | ForEach-Object { Write-Host "  $_" }
  # return first
  return (($out | Select-Object -First 1) -split '\s+')[0]
}

if ($Path) {
  $Id = Get-UnpackedExtensionId $Path
  Write-Host "Using computed id: $Id"
}
if (-not $Id) { throw 'Pass -Id <32-char> or -Path <extension folder>' }
if ($Id -notmatch '^[a-p]{32}$') {
  throw "Invalid extension id '$Id' (expect 32 chars a-p, from chrome://extensions)"
}

$origin = "chrome-extension://$Id/"
$targets = @(
  (Join-Path $PSScriptRoot '..\Host\main.json'),
  'C:\Program Files\v3discordpresence\main.json'
)

foreach ($t in $targets) {
  if (!(Test-Path $t)) {
    Write-Host "skip (missing): $t"
    continue
  }
  $json = Get-Content $t -Raw | ConvertFrom-Json
  $list = @($json.allowed_origins)
  if ($list -contains $origin) {
    Write-Host "already allowed: $t"
    continue
  }
  $list += $origin
  $json.allowed_origins = $list
  # Write JSON without PowerShell array collapse
  $tmp = Join-Path $env:TEMP 'main-json-out.json'
  node -e "const fs=require('fs');const p=process.argv[1];const j=JSON.parse(fs.readFileSync(p,'utf8'));j.allowed_origins=process.argv.slice(2);fs.writeFileSync(p, JSON.stringify(j,null,4)+'\n');" $t @($list)
  Write-Host "updated: $t => $origin"
}

Write-Host 'Reload the extension in chrome://extensions (click the refresh icon).'
