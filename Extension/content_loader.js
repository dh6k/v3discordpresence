/*
Copyright (c) 2022–Present Michael Ren
Licensing and distribution info can be found at the GitHub repository
https://github.com/XFG16/YouTubeDiscordPresence

Isolated-world bridge: injects page-context content.js and relays its events
to background.js. Must survive VORAPIS (V3) early page rewrites.
*/

// MAIN VARIABLE INITIALIZATION

const LOGGING = false;

const UPDATE_PRESENCE_MESSAGE = "UPDATE_PRESENCE_DATA";

// REDIRECTION OF DATA FROM INJECTED CONTENT.JS TO BACKGROUND.JS

window.addEventListener("SendToLoader", function (message) {
    const detail = message.detail || {};
    if (!detail.title || !detail.author || detail.timeLeft == null) return;
    chrome.runtime.sendMessage({
        messageType: UPDATE_PRESENCE_MESSAGE,
        title: detail.title,
        author: detail.author,
        album: detail.album,
        timeLeft: detail.timeLeft,
        duration: detail.duration,
        videoId: detail.videoId,
        channelUrl: detail.channelUrl,
        applicationType: detail.applicationType,
        thumbnailUrl: detail.thumbnailUrl,
    }, (response) => {
        if (LOGGING) {
            console.log(`Data was sent by content_loader.js and received by background.js: ${detail.title}`);
        }
    });
}, false);

// INJECTION OF CONTENT.JS INTO MAIN DOM
// VORAPIS rewrites the document at document-start; inject as soon as a root exists.

let injected = false;

function injectContentScript() {
    if (injected) return true;
    const root = document.head || document.documentElement;
    if (!root) return false;

    const mainScript = document.createElement("script");
    mainScript.src = chrome.runtime.getURL("/content.js");
    mainScript.onload = function () {
        this.remove();
    };
    mainScript.onerror = function () {
        // VORAPIS window.stop() can abort a src= load; retry once via blob text
        injected = false;
        fetch(chrome.runtime.getURL("/content.js")).then(r => r.text()).then(code => {
            const inline = document.createElement("script");
            inline.textContent = code;
            root.appendChild(inline);
            inline.remove();
            injected = true;
        }).catch(() => {});
    };
    root.appendChild(mainScript);
    injected = true;
    return true;
}

if (!injectContentScript()) {
    const obs = new MutationObserver(() => {
        if (injectContentScript()) obs.disconnect();
    });
    obs.observe(document.documentElement || document, { childList: true, subtree: true });
}
