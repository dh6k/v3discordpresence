// Shared presence sanitizer for Discord SET_ACTIVITY limits.
function sanitizePresence(activity) {
    if (!activity || typeof activity !== "object") return null;
    const out = { ...activity };

    const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : v);
    if (out.details != null) out.details = clip(String(out.details), 128);
    if (out.state != null) out.state = clip(String(out.state), 128);

    if (out.assets && typeof out.assets === "object") {
        out.assets = {
            ...out.assets,
            large_text: out.assets.large_text != null ? clip(String(out.assets.large_text), 128) : out.assets.large_text,
            small_text: out.assets.small_text != null ? clip(String(out.assets.small_text), 128) : out.assets.small_text
        };
    }

    if (Array.isArray(out.buttons)) {
        out.buttons = out.buttons
            .filter(b => b && typeof b.label === "string" && typeof b.url === "string" && b.label && b.url)
            .map(b => ({ label: clip(b.label, 32), url: clip(b.url, 512) }))
            .slice(0, 2);
        if (out.buttons.length === 0) delete out.buttons;
    }

    return out;
}

module.exports = { sanitizePresence };
