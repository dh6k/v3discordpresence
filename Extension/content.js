/*
Copyright (c) 2022–Present Michael Ren
Copyright (c) 2026–Present Charles Kim
Licensing and distribution info can be found at the GitHub repository
https://github.com/XFG16/YouTubeDiscordPresence

Runs in the page context (injected by content_loader.js).
Compatible with both modern polymer YouTube and Project VORAPIS (V3) watch7 UI.
*/

(function() {
const LOGGING = false;
const NORMAL_MESSAGE_DELAY = 1000;
const LIVESTREAM_TIME_ID = -1;

// Modern polymer / HTML5 chrome ads
const AD_SELECTOR = "div.ytp-ad-player-overlay-instream-info";
// VORAPIS / classic 2014 player ad chrome (best-effort)
const CLASSIC_AD_SELECTORS = [
    ".ytp-ad-overlay-container",
    ".ytp-ad-text-overlay",
    "div.ytp-ad-player-overlay",
    ".video-ads .ad-container",
    "#player .ytp-ad-module"
];

const PLAYER_SELECTORS = ["#movie_player", ".html5-video-player"];

// VORAPIS (watch7) DOM
const VOR_TITLE_SELECTORS = [
    "#watch7-headline .yt-uix-expander-head",
    "#eow-title",
    "#watch-headline-title .watch-title-text-container",
    ".watch-title-text-container"
];
const VOR_AUTHOR_SELECTORS = [
    "#watch7-user-header .yt-user-name",
    "#watch7-user-header a.yt-user-name",
    "#watch7-user-header .yt-user-info a"
];
const VOR_LIVE_SELECTORS = [
    ".yt-badge.yt-badge-live",
    "#watch7-content .yt-badge-live",
    "#watch-headline .yt-badge-live"
];

// Modern polymer DOM (upstream fallback)
const MAIN_LIVESTREAM_TITLE_SELECTOR = "div.ytp-chrome-top > div.ytp-title > div.ytp-title-text > a.ytp-title-link";
const MAIN_LIVESTREAM_AUTHOR_SELECTOR = "#upload-info > #channel-name > #container > #text-container > #text > a";
const MINIPLAYER_LIVESTREAM_AUTHOR_SELECTOR = "#video-container #info-bar #owner-name";
const LIVESTREAM_ELEMENT_SELECTOR = "div.ytp-chrome-bottom > div.ytp-chrome-controls > div.ytp-left-controls > div.ytp-time-display.notranslate.ytp-live > button";
const MINIPLAYER_ELEMENT_SELECTOR = "div.ytp-miniplayer-ui";
const NO_MINIPLAYER_ATTRIBUTE = "display: none;";

let documentData = new Object();
let videoPlayer = null;

if (LOGGING) {
    console.log("YouTubeDiscordPresence - content.js created (vorapis-compat)");
}

// ---------- PLAYER ----------

function findPlayer() {
    for (let i = 0; i < PLAYER_SELECTORS.length; i++) {
        const el = document.querySelector(PLAYER_SELECTORS[i]);
        if (el && typeof el.getPlayerState === "function") return el;
    }
    // Vorapis sometimes mounts late; accept DOM node and probe methods later
    for (let i = 0; i < PLAYER_SELECTORS.length; i++) {
        const el = document.querySelector(PLAYER_SELECTORS[i]);
        if (el) return el;
    }
    return null;
}

function safeCall(fn) {
    try {
        return fn();
    } catch (e) {
        return null;
    }
}

function getVideoDataSafe(player) {
    return safeCall(() => (player && typeof player.getVideoData === "function" ? player.getVideoData() : null)) || {};
}

// ---------- IDS / URLS ----------

function getVideoIdFromUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url, location.origin);
        const v = u.searchParams.get("v");
        if (v && v.length >= 11) return v.slice(0, 11);
        const parts = u.pathname.split("/");
        const last = parts[parts.length - 1];
        if (last && last.length >= 11 && !last.includes(".")) return last.slice(0, 11);
    } catch (e) {}
    if (url.includes("v=")) {
        const id = url.split("v=")[1].split("&")[0];
        if (id && id.length >= 11) return id.slice(0, 11);
    }
    return null;
}

function resolveVideoId(player) {
    const data = getVideoDataSafe(player);
    if (data.video_id) return data.video_id;
    if (data.videoId) return data.videoId;

    const fromPlayerUrl = safeCall(() => (typeof player.getVideoUrl === "function" ? player.getVideoUrl() : null));
    const idFromPlayerUrl = getVideoIdFromUrl(fromPlayerUrl);
    if (idFromPlayerUrl) return idFromPlayerUrl;

    const cfg = window.currentlyInvokedPlayerConfig;
    if (cfg) {
        if (cfg.video_id) return cfg.video_id;
        if (cfg.videoId) return cfg.videoId;
        if (cfg.args && cfg.args.video_id) return cfg.args.video_id;
    }

    return getVideoIdFromUrl(location.href);
}

function absoluteUrl(href) {
    if (!href || href === "undefined") return null;
    try {
        return new URL(href, location.origin).href;
    } catch (e) {
        return href.startsWith("http") ? href : null;
    }
}

// ---------- LIVE / ADS ----------

function isLivestream(player) {
    const data = getVideoDataSafe(player);
    if (data.is_live === true || data.isLive === true) return true;
    if (data.is_live === false && data.liveBroadcastContent === "none") return false;

    for (let i = 0; i < VOR_LIVE_SELECTORS.length; i++) {
        if (document.querySelector(VOR_LIVE_SELECTORS[i])) return true;
    }

    if (player && safeCall(() => player.querySelector(LIVESTREAM_ELEMENT_SELECTOR))) return true;

    // classic live badge in player chrome
    if (document.querySelector(".ytp-live-badge, button.ytp-live-badge")) return true;

    return false;
}

function isPlayingAd(player) {
    if (document.querySelector(AD_SELECTOR)) return true;
    for (let i = 0; i < CLASSIC_AD_SELECTORS.length; i++) {
        const el = document.querySelector(CLASSIC_AD_SELECTORS[i]);
        if (el && el.offsetParent !== null) return true;
    }
    const adState = safeCall(() => (player && typeof player.getAdState === "function" ? player.getAdState() : null));
    // -1 = idle, 0 = not started, 1/3 = ad playing across player generations
    if (adState === 1 || adState === 3) return true;
    return false;
}

// ---------- METADATA ----------

const getOEmbedJSON = async videoId => {
    const response = await fetch("https://www.youtube.com/oembed?url=http%3A//youtube.com/watch%3Fv%3D" + videoId + "&format=json");
    if (!response.ok) {
        throw new Error(response.statusText);
    }
    return response.json();
};

function textFromSelectors(selectors) {
    for (let i = 0; i < selectors.length; i++) {
        const el = document.querySelector(selectors[i]);
        if (el && el.innerText && el.innerText.trim()) {
            return { text: el.innerText.trim(), element: el };
        }
    }
    return { text: null, element: null };
}

function getVorapisDomMeta() {
    const title = textFromSelectors(VOR_TITLE_SELECTORS);
    const author = textFromSelectors(VOR_AUTHOR_SELECTORS);
    return {
        title: title.text,
        author: author.text,
        channelUrl: author.element ? absoluteUrl(author.element.href || author.element.getAttribute("href")) : null
    };
}

function getModernDomMeta(player) {
    const miniplayerHTML = player && player.querySelector ? player.querySelector(MINIPLAYER_ELEMENT_SELECTOR) : null;
    const useMini = miniplayerHTML && miniplayerHTML.getAttribute("style") !== NO_MINIPLAYER_ATTRIBUTE;
    const titleHTML = player && player.querySelector ? player.querySelector(MAIN_LIVESTREAM_TITLE_SELECTOR) : null;
    const authorHTML = document.querySelector(useMini ? MINIPLAYER_LIVESTREAM_AUTHOR_SELECTOR : MAIN_LIVESTREAM_AUTHOR_SELECTOR);
    return {
        title: titleHTML ? titleHTML.innerText : null,
        author: authorHTML ? authorHTML.innerText : null,
        channelUrl: authorHTML ? absoluteUrl(authorHTML.href) : null
    };
}

function getAlbumFromDOM() {
    if (!location.href.includes("music.youtube")) return null;
    const byline =
        document.querySelector("yt-formatted-string.byline.ytmusic-player-bar") ||
        document.querySelector(".subtitle.ytmusic-player-bar yt-formatted-string.byline") ||
        document.querySelector("ytmusic-player-bar .byline");
    if (!byline) return null;
    const links = byline.querySelectorAll("a");
    return links.length >= 2 ? (links[links.length - 1].textContent?.trim() || null) : null;
}

function getTimeData(player) {
    const duration = safeCall(() => player && typeof player.getDuration === "function" ? player.getDuration() : null);
    const current = safeCall(() => player && typeof player.getCurrentTime === "function" ? player.getCurrentTime() : null);
    if (duration && current != null && duration > 0) {
        documentData.duration = duration;
        documentData.timeLeft = duration - current;
        if (documentData.timeLeft < 0) {
            documentData.timeLeft = null;
        }
    } else {
        documentData.timeLeft = null;
        if (LOGGING) console.log("Unable to get timestamp data for YouTubeDiscordPresence");
    }
}

function sendDocumentData() {
    if (documentData.title && documentData.author && documentData.timeLeft) {
        if (documentData.author.endsWith(" - Topic")) {
            documentData.author = documentData.author.slice(0, -8);
        }
        const messageEvent = new CustomEvent("SendToLoader", { detail: documentData });
        window.dispatchEvent(messageEvent);
    }
}

function finalizeRegular(player) {
    getTimeData(player);
    sendDocumentData();
}

function handleYouTubeData() {
    const player = videoPlayer;
    const data = getVideoDataSafe(player);
    const videoId = resolveVideoId(player);
    if (!videoId) return;

    documentData.videoId = videoId;
    documentData.applicationType = location.href.includes("music.youtube") ? "youtubeMusic" : "youtube";
    documentData.album = getAlbumFromDOM();
    documentData.thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    // Reset meta each tick so a new video never inherits the previous title/author
    documentData.title = null;
    documentData.author = null;
    documentData.channelUrl = null;
    documentData.timeLeft = null;
    documentData.duration = null;

    const vor = getVorapisDomMeta();
    const modern = getModernDomMeta(player);

    // Prefer live player/DOM signals over oEmbed title for livestreams
    if (isLivestream(player)) {
        documentData.title = data.title || vor.title || modern.title;
        documentData.author = data.author || vor.author || modern.author;
        documentData.channelUrl =
            absoluteUrl(data.author_url) ||
            vor.channelUrl ||
            modern.channelUrl ||
            (data.author_id ? `https://www.youtube.com/channel/${data.author_id}` : null);
        documentData.timeLeft = LIVESTREAM_TIME_ID;
        sendDocumentData();
        return;
    }

    // Regular video: player metadata → oEmbed → DOM (VORAPIS then modern)
    const applyPlayerMeta = () => {
        if (data.title) documentData.title = data.title;
        if (data.author) documentData.author = data.author;
        if (data.author_url) documentData.channelUrl = absoluteUrl(data.author_url);
        else if (data.author_id) documentData.channelUrl = `https://www.youtube.com/channel/${data.author_id}`;
        else if (vor.channelUrl) documentData.channelUrl = vor.channelUrl;
        else if (modern.channelUrl) documentData.channelUrl = modern.channelUrl;
    };

    applyPlayerMeta();

    if (documentData.title && documentData.author) {
        finalizeRegular(player);
        return;
    }

    getOEmbedJSON(videoId).then(oembed => {
        documentData.title = documentData.title || oembed.title;
        documentData.author = documentData.author || oembed.author_name;
        documentData.channelUrl = documentData.channelUrl || absoluteUrl(oembed.author_url);
        finalizeRegular(player);
    }).catch(error => {
        if (!documentData.title) documentData.title = vor.title || modern.title;
        if (!documentData.author) documentData.author = vor.author || modern.author;
        if (!documentData.channelUrl) documentData.channelUrl = vor.channelUrl || modern.channelUrl;
        finalizeRegular(player);
        if (LOGGING) console.error(error);
    });
}

// ---------- POLL LOOP ----------

setInterval(function () {
    if (!videoPlayer || !videoPlayer.isConnected) {
        videoPlayer = findPlayer();
    }
    if (!videoPlayer) return;

    const state = safeCall(() => (typeof videoPlayer.getPlayerState === "function" ? videoPlayer.getPlayerState() : null));
    if (state === 1 && !isPlayingAd(videoPlayer)) {
        handleYouTubeData();
    }
}, NORMAL_MESSAGE_DELAY);
})();
