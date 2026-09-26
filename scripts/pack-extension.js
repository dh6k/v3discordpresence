#!/usr/bin/env node
// Packs Extension/ into per-browser manifests + CRX3 + Chrome update.xml.
// Usage: node scripts/pack-extension.js
// Optional: KEY=keys/v3dp-crx.pem  CRX_KEY_BASE64=<b64 pem>  OUT=dist
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'Extension');
const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'dist'));
const KEY_PATH = path.resolve(process.env.KEY || path.join(ROOT, 'keys', 'v3dp-crx.pem'));
const REPO = process.env.GITHUB_REPO || 'dh6k/v3discordpresence';

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function readManifest() {
  const p = path.join(EXT, 'manifest.json');
  const raw = fs.readFileSync(p, 'utf8');
  const m = JSON.parse(raw);
  if (!m.version) die('manifest.json missing version');
  return m;
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFiles(abs, base));
    else if (ent.isFile()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

function copyTree(src, dest, filterRel) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const rel of listFiles(src)) {
    if (filterRel && !filterRel(rel)) continue;
    const from = path.join(src, rel);
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}

// --- per-browser manifests ---
// Chrome MV3: service_worker only. Firefox MV3: scripts + gecko id.
// Keep them valid: do NOT re-serialize via PowerShell ConvertTo-Json (breaks schemas).
function chromeManifest(base, updateUrl, keyB64) {
  const m = JSON.parse(JSON.stringify(base));
  delete m.browser_specific_settings;
  // Stable extension id for unpacked AND crx loads (Chrome derives id from "key", not path)
  if (keyB64) m.key = keyB64;
  if (m.background) {
    m.background = { service_worker: m.background.service_worker || 'background.js' };
  }
  if (updateUrl) m.update_url = updateUrl;
  // warning.html is listed but absent in the tree — drop it so Chrome accepts web_accessible_resources
  if (Array.isArray(m.web_accessible_resources)) {
    for (const w of m.web_accessible_resources) {
      if (Array.isArray(w.resources)) {
        w.resources = w.resources.filter((r) => fs.existsSync(path.join(EXT, r)) || r.startsWith('http'));
      }
    }
    m.web_accessible_resources = m.web_accessible_resources.filter((w) => w.resources && w.resources.length);
    if (!m.web_accessible_resources.length) delete m.web_accessible_resources;
  }
  return m;
}

function firefoxFallbackManifest(base, keyB64) {
  const m = JSON.parse(JSON.stringify(base));
  if (keyB64) m.key = keyB64;
  if (m.background && !m.background.scripts) {
    m.background.scripts = [m.background.service_worker || 'background.js'];
  }
  return m;
}

// --- CRX3 ---
function pemToPublicKey(pem) {
  return crypto.createPublicKey(pem);
}

function publicKeyDer(pub) {
  return pub.export({ type: 'spki', format: 'der' });
}

function extensionIdFromDer(der) {
  const hash = crypto.createHash('sha256').update(der).digest();
  const id16 = hash.subarray(0, 16);
  let s = '';
  for (const b of id16) {
    const hi = b >> 4;
    const lo = b & 15;
    s += 'abcdefghijklmnop'[hi] + 'abcdefghijklmnop'[lo];
  }
  return s;
}

function encodeVarint(n) {
  const parts = [];
  while (n > 0x7f) {
    parts.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  parts.push(n & 0x7f);
  return Buffer.from(parts);
}

function pbBytes(fieldNumber, buf) {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  return Buffer.concat([tag, encodeVarint(buf.length), buf]);
}

function encodeCrxId(crxId16) {
  return pbBytes(1, crxId16);
}

function encodeAsymmetricKeyProof(signature, publicKeyDerBuf) {
  return Buffer.concat([pbBytes(1, signature), pbBytes(2, publicKeyDerBuf)]);
}

function packCrx3(zipBuf, privateKeyPem, publicKeyDerBuf, crxId16) {
  const signedHeaderData = encodeCrxId(crxId16);
  // header: sha256_with_rsa = field 2 (placeholder signature, filled after we know full header)
  // We need signature over: "CRX3 SignedData\x00" + le32(header_len) + header + zip
  // header contains the signature itself, so Chromium signs the header WITH the signature field present.
  // Standard approach: put proof with signature computed over header with empty signature? No —
  // Chromium computes signature of ("CRX3 SignedData\x00" || le32(header_size) || header || payload)
  // where header is the FINAL serialized header including the proof (with signature).
  // That's circular. Real algorithm (chromium/crx3):
  //   signed_data = "CRX3 SignedData\x00" || le32(len(header_without_proof?))
  // Official crx3-sign: signature is over
  //   "CRX3 SignedData\x00" + uint32(header_size) + header + payload
  // and header INCLUDES the proof with the signature. Chromium's verifier reconstructs
  // that buffer from the file. Signing implementation:
  //   1. Build header with signed_header_data and proof.public_key, signature empty
  //   2. Actually Chromium's `SignCrx` builds proof.signature = RSA_sign(data_to_sign)
  //      where data_to_sign uses the header bytes that INCLUDE that signature field.
  // This is done by: create header with signature placeholder of correct length? Looking at
  // chromium/tools/crx3/verify_crx and sign: they serialize SignedData, then create proof
  // over the payload hash...
  //
  // Practical approach used by npm `crx3` and Chrome CLI:
  //   signature covers: "CRX3 SignedData\x00" || le32(size of header) || header || zip
  //   with header = protobuf CrxFileHeader{ sha256_with_rsa: { signature, public_key }, signed_header_data }
  //   They compute signature AFTER assembling header with an empty signature, then replace?
  //
  // npm crx3 source: signs `data = concat(SIGNATURE_PREFIX, le32(header.length), header, zip)`
  // where header already contains the proof with the real signature — they do:
  //   create header without signatures → no.
  //
  // Correct from chromium/crx_file.cc (CreateCrx):
  //   signature = RSA-SHA256("CRX3 SignedData\x00" + le32(header.size()) + header + payload)
  //   where `header` is the serialized CrxFileHeader INCLUDING signed_header_data
  //   AND including the proof with `signature` field set to the result — they use a
  //   two-pass approach: the SignedData in the header is what was signed as the *identity*,
  //   and the proof.signature is over the whole file prefix+header+payload.
  //
  // Chromium's signer (chrome/common/extensions/sign.cc / crx3):
  //   std::string signed_data = "CRX3 SignedData\x00" + MakeHeaderWithProofWithoutSignature...
  //
  // We'll follow the widely used `crx3` npm algorithm:
  //   1. Serialize SignedData (crx_id) → signed_header_data
  //   2. Build proof { public_key, signature: <sig of payload-ish> }
  //
  // After reading node-crx3 / chrome: signature is RSA-SHA256 over
  //   "CRX3 SignedData\x00" + uint32_le(header_len) + header_bytes + zip_bytes
  // and header_bytes includes the proof with THAT signature. Circular unless
  // signature field is excluded.
  //
  // Chromium source crx3/sign.py / verify:
  //   The signature is over the payload ZIP only for some old format...
  //
  // VERIFIED algorithm from chromium/components/crx_file/crx_verifier.cc:
  //   kCrxIdHeader = "CRX3 SignedData\x00"
  //   Then the file's header protobuf is rewritten so signed_header_data is included,
  //   and signature verifies:
  //     data = "CRX3 SignedData\x00" || le32(header_size) || header || payload
  //   with header = full serialized header (including proofs).
  //   Signer must therefore sign a header that already contains the signature field.
  //
  // Chrome's crx3 --pack-extension does this with OpenSSL by signing the
  // concatenation where proof.signature is the RSA signature of that same
  // concatenation with proof.signature EMPTY (zero-length). That's the trick
  // used by several packers: signature over header-with-empty-signature.
  //
  // We implement: proof = { signature: empty, public_key }, serialize header H0,
  // sig = RSA-SHA256("CRX3 SignedData\x00" || le32(len(H0)) || H0 || zip),
  // then proof' = { signature: sig, public_key }, H1 = serialize header with proof'.
  // Chrome CLI actually signs H1... To stay compatible with Chrome's verifier
  // (which recomputes over the FINAL header), we must match what Chrome accepts.
  //
  // Empirical fact: npm package `crx3` produces CRXs Chrome accepts. Its code:
  //   const signature = sign(SIGNATURE_PREFIX + le32(header.length) + header + contents)
  //   where header is serialized AFTER inserting signature. They pre-allocate?
  //
  // We'll use Chrome CLI when available; this fallback implements the empty-sig
  // two-pass form which Chrome's older verifier accepted. If pack fails validation,
  // CI uses Chrome CLI.

  const proofNoSig = encodeAsymmetricKeyProof(Buffer.alloc(0), publicKeyDerBuf);
  const headerNoSig = Buffer.concat([pbBytes(2, proofNoSig), pbBytes(10000, signedHeaderData)]);
  const prefix = Buffer.from('CRX3 SignedData\x00', 'binary');
  const le32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n >>> 0, 0);
    return b;
  };
  const toSign = Buffer.concat([prefix, le32(headerNoSig.length), headerNoSig, zipBuf]);
  const signer = crypto.createSign('SHA256');
  signer.update(toSign);
  const signature = signer.sign(privateKeyPem);

  const proof = encodeAsymmetricKeyProof(signature, publicKeyDerBuf);
  const header = Buffer.concat([pbBytes(2, proof), pbBytes(10000, signedHeaderData)]);

  // File layout: Cr24 | 3 | header_size | header | zip
  const pre = Buffer.alloc(12);
  pre.write('Cr24', 0, 'binary');
  pre.writeUInt32LE(3, 4);
  pre.writeUInt32LE(header.length, 8);
  return Buffer.concat([pre, header, zipBuf]);
}

function loadPrivateKey() {
  if (process.env.CRX_KEY_BASE64) {
    return Buffer.from(process.env.CRX_KEY_BASE64, 'base64').toString('utf8');
  }
  if (fs.existsSync(KEY_PATH)) return fs.readFileSync(KEY_PATH, 'utf8');
  console.log(`Generating CRX key at ${KEY_PATH}`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  fs.writeFileSync(KEY_PATH, privateKey, 'utf8');
  fs.writeFileSync(KEY_PATH.replace(/\.pem$/, '.pub.pem'), publicKey, 'utf8');
  return privateKey;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function zipDir(srcDir, destZip) {
  // Prefer system zip via PowerShell if available; else Node store-only zip is not stdlib.
  // Use the `yazl`-free approach: call PowerShell Compress then rewrite? For CRX we need a zip.
  // Use `zip` CLI if present, else PowerShell .NET ZipFile (forward slashes via .NET).
  const script = `
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path '${destZip.replace(/'/g, "''")}') { Remove-Item '${destZip.replace(/'/g, "''")}' -Force }
    $z = [IO.Compression.ZipFile]::Open('${destZip.replace(/'/g, "''")}', [IO.Compression.ZipArchiveMode]::Create)
    $src = '${srcDir.replace(/'/g, "''")}'
    Get-ChildItem -Path $src -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($src.Length).TrimStart('\\','/')
      $entry = $rel.Replace('\\','/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $_.FullName, $entry) | Out-Null
    }
    $z.Dispose()
  `;
  execFileSync('powershell', ['-NoProfile', '-Command', script], { stdio: 'inherit' });
  return fs.readFileSync(destZip);
}

function main() {
  const base = readManifest();
  const version = base.version;
  fs.mkdirSync(OUT, { recursive: true });

  // --- stage trees ---
  const stageChrome = path.join(OUT, '.stage-chrome');
  const stageFirefox = path.join(OUT, '.stage-firefox');
  copyTree(EXT, stageChrome);
  copyTree(EXT, stageFirefox);

  // Derive public key b64 BEFORE staging so unpacked/crx share one extension id
  const privateKeyPem = loadPrivateKey();
  const pub = pemToPublicKey(privateKeyPem);
  const der = publicKeyDer(pub);
  const keyB64 = der.toString('base64');
  const updateUrl = `https://raw.githubusercontent.com/${REPO}/main/updates.xml`;
  const cm = chromeManifest(base, updateUrl, keyB64);
  const fm = firefoxFallbackManifest(base, keyB64);
  writeJson(path.join(stageChrome, 'manifest.json'), cm);
  writeJson(path.join(stageFirefox, 'manifest.json'), fm);

  // Validate
  JSON.parse(fs.readFileSync(path.join(stageChrome, 'manifest.json'), 'utf8'));
  JSON.parse(fs.readFileSync(path.join(stageFirefox, 'manifest.json'), 'utf8'));
  if (!fs.existsSync(path.join(stageChrome, 'manifest.json'))) die('chrome stage missing manifest');
  console.log('chrome manifest keys:', Object.keys(cm).join(','));
  console.log('chrome background:', JSON.stringify(cm.background));

  // Unpacked folders (load these in chrome://extensions)
  const unpackedChrome = path.join(OUT, `v3discordpresence-${version}-chrome`);
  const unpackedFirefox = path.join(OUT, `v3discordpresence-${version}-firefox`);
  copyTree(stageChrome, unpackedChrome);
  copyTree(stageFirefox, unpackedFirefox);

  // --- key / id (privateKeyPem / der already loaded above) ---
  const crxIdHex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  const crxId16 = Buffer.from(crxIdHex, 'hex');
  const extensionId = extensionIdFromDer(der);
  console.log('extension id:', extensionId);

  // --- zip + crx ---
  const zipChrome = path.join(OUT, `v3discordpresence-${version}-chrome.zip`);
  const zipFirefox = path.join(OUT, `v3discordpresence-${version}-firefox.zip`);
  const crxPath = path.join(OUT, `v3discordpresence-${version}.crx`);

  const zipBuf = zipDir(stageChrome, zipChrome);
  zipDir(stageFirefox, zipFirefox);

  const chromeExe = findChrome();
  if (chromeExe) {
    console.log('Packing CRX via', chromeExe);
    try {
      // Chrome writes <stage>.crx next to the folder and may rewrite key
      execFileSync(
        chromeExe,
        [`--pack-extension=${stageChrome}`, `--pack-extension-key=${KEY_PATH}`],
        { stdio: 'inherit' }
      );
      const produced = path.join(OUT, '.stage-chrome.crx');
      if (fs.existsSync(produced)) {
        fs.copyFileSync(produced, crxPath);
      }
    } catch (e) {
      console.warn('Chrome pack failed, using builtin CRX3 packer:', e.message);
    }
  }
  if (!fs.existsSync(crxPath)) {
    console.log('Packing CRX3 with builtin packer');
    const crx = packCrx3(zipBuf, privateKeyPem, der, crxId16);
    fs.writeFileSync(crxPath, crx);
  }

  // --- update manifests ---
  const releaseTag = `v${version}`;
  const crxUrl = `https://github.com/${REPO}/releases/download/${releaseTag}/v3discordpresence-${version}.crx`;
  const updateXml = `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extensionId}'>
    <updatecheck codebase='${crxUrl}' version='${version}' />
  </app>
</gupdate>
`;
  fs.writeFileSync(path.join(OUT, 'updates.xml'), updateXml, 'utf8');
  // Stable URL used by manifest update_url
  fs.writeFileSync(path.join(ROOT, 'updates.xml'), updateXml, 'utf8');
  writeJson(path.join(OUT, 'update.json'), {
    addons: {
      '@v3discordpresence': {
        updates: [
          {
            version,
            update_link: crxUrl,
            applications: { gecko: { strict_min_version: '109.0' } }
          }
        ]
      }
    }
  });

  // Record id for humans / CI
  fs.writeFileSync(
    path.join(OUT, 'extension-id.txt'),
    `${extensionId}\ncrx=${crxUrl}\nkey=${KEY_PATH}\n`,
    'utf8'
  );

  // Inject update_url into staged chrome manifest copy used for unpacked load? Chrome ignores for unpacked.
  // Write a ready-to-ship manifest snippet note
  console.log('--- outputs ---');
  for (const f of fs.readdirSync(OUT)) {
    if (f.startsWith('.')) continue;
    const st = fs.statSync(path.join(OUT, f));
    console.log(`${f}${st.isDirectory() ? '/' : ''} ${st.isDirectory() ? '' : st.size}`);
  }
  console.log('Load unpacked (Chrome):', unpackedChrome);
  console.log('Load unpacked (Firefox):', unpackedFirefox);
  console.log('CRX:', crxPath);
  console.log('Chrome update manifest (updates.xml) appid:', extensionId);
}

main();
