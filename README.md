# v3discordpresence

<p align="left">
    <a href="https://github.com/dh6k/v3discordpresence/blob/main/LICENSE.txt" alt="MIT License">
        <img src="https://img.shields.io/badge/License-MIT-yellow" /></a>
    <a href="https://github.com/dh6k/v3discordpresence/actions" alt="Build">
        <img src="https://img.shields.io/github/actions/workflow/status/dh6k/v3discordpresence/build.yml" /></a>
</p>

> **Fork notice.** `v3discordpresence` is a fork of [XFG16/YouTubeDiscordPresence](https://github.com/XFG16/YouTubeDiscordPresence) (MIT).
> Upstream built the original YouTube / YouTube Music → Discord rich-presence pipeline (extension + Windows native host).
> This fork is **not** affiliated with the upstream project. Feature credit for the base product belongs to the original authors.

**v3discordpresence** (v3dp) is a desktop application and browser extension that creates a detailed Discord rich presence for YouTube and YouTube Music. Only **Windows (x64)** is supported.

It is **designed to run alongside Project VORAPIS (V3)** — the userscript / browser extension that restores the 2013–2014 YouTube frontend. V3 replaces the modern polymer player and watch page, which breaks stock v3dp selectors. This fork reads both:

- the **VORAPIS watch7 UI** (`#eow-title`, `#watch7-user-header .yt-user-name`, `.yt-badge-live`, `getVideoData().video_id`), and
- the **modern polymer YouTube** player / DOM (upstream behaviour).

So the same build works on plain YouTube, YouTube Music, and V3.

---

## Installation

1. Add the browser extension:
   - load `Extension/` unpacked, or
   - install the `v3discordpresence-<version>-chrome.zip` / `-firefox.zip` from [**<ins>Releases</ins>**](https://github.com/dh6k/v3discordpresence/releases/latest).

2. Download the latest `v3dpsetup.msi` from [**<ins>Releases</ins>**](https://github.com/dh6k/v3discordpresence/releases/latest) and run it to install the desktop native-messaging host.
   - Installs to `C:\Program Files\v3discordpresence`.
   - Registers `com.v3dp.discord.presence` for Chrome and Firefox.
   - **Windows x64 only.**

3. Use Discord **desktop** (not browser Discord) with *Activity Privacy → Share my activity* on.

Restarting the PC after a first install usually clears any remaining connection issues.

> If you also have upstream `YouTubeDiscordPresence` installed, uninstall it first. The products are separate (different native-host id) but the presence pipes are the same.

---

## Using with VORAPIS (V3)

1. Install Project VORAPIS (userscript or its own extension) so YouTube loads the watch7 UI.
2. Install this extension + the `v3dpsetup.msi` host.
3. Play a video. Presence appears when playback starts and clears when the video ends or pauses.

The extension polls the page player API every second and tolerates missing fields, so a partial V3 DOM still produces presence when title/author/time are recoverable (via `getVideoData()`, oEmbed, or watch7 selectors).

---

## Troubleshooting / Known issues

- Discord’s own limitation: *Listen Along* / *View Channel* buttons do not show on **your own** profile, only for others.
- Browser Discord is not supported — use the desktop client.
- V3-specific: if presence never appears, check that the video is actually playing (`getPlayerState() == 1`) and that no ad overlay is up. Live streams are detected via `is_live` / `.yt-badge-live` / the player live badge.

---

## Building

Desktop host:

```text
cd NodeHost
npm ci
npm run compile
```

- Output: `NodeHost/src/v3dpwin.exe`.
- Copy it over `C:\Program Files\v3discordpresence\v3dpwin.exe` for a local install.

MSI (optional, also done in CI):

- Visual Studio + **Microsoft Visual Studio Installer Projects**.
- Open `Host/v3dpsetup/v3dpsetup.vdproj` and build `v3dpsetup`.
- Or push / run the `Build` GitHub Actions workflow (builds `v3dpsetup.msi` + extension zips).

Extension:

- Load `Extension/` unpacked.
- For a local unpacked Chrome install, add the extension ID to `allowed_origins` in `C:\Program Files\v3discordpresence\main.json`.

Self-check for the host payload sanitizer:

```text
cd NodeHost
node scripts/check-sanitize.js
```

---

## AI assistance

Parts of this fork (VORAPIS compatibility layer, CI workflow, presence-payload sanitizer, and this documentation) were produced with **AI-assisted development** (Xiaomi MiMo / agent tooling) under human review. Treat AI-touched code as best-effort: verify on your machine before relying on it. Upstream `YouTubeDiscordPresence` code remains under its original authorship.

---

## Miscellaneous

This is not a PreMiD clone. Like the Spotify rich presence, it shows **only while a video is playing** and disappears when nothing is playing or the video is paused. Idling and searching are not shown.

---

## License

MIT — see [LICENSE.txt](LICENSE.txt).

- Original work: Copyright (c) 2022–Present Michael Ren ([XFG16/YouTubeDiscordPresence](https://github.com/XFG16/YouTubeDiscordPresence)).
- This fork: Copyright (c) 2026–Present Charles Kim and other contributors.
