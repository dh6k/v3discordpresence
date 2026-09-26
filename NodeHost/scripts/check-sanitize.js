// Self-check: node scripts/check-sanitize.js
const assert = require('assert');
const { sanitizePresence } = require('../src/sanitize');

assert.strictEqual(sanitizePresence(null), null);
assert.strictEqual(sanitizePresence("x"), null);

const a = sanitizePresence({
    details: "T".repeat(200),
    state: "S".repeat(200),
    assets: { large_image: "youtube3", large_text: "L".repeat(200) },
    buttons: [
        { label: "L".repeat(50), url: "https://x/" + "u".repeat(600) },
        { label: "View Channel", url: "https://youtube.com/channel/x" },
        { label: "dropped" }
    ]
});
assert.strictEqual(a.details.length, 128);
assert.strictEqual(a.state.length, 128);
assert.strictEqual(a.assets.large_text.length, 128);
assert.strictEqual(a.buttons.length, 2);
assert.strictEqual(a.buttons[0].label.length, 32);
assert.strictEqual(a.buttons[0].url.length, 512);
assert.strictEqual(a.buttons[1].label, "View Channel");

const b = sanitizePresence({ details: "hi", buttons: [{ label: "", url: "https://x" }, { url: "https://y" }] });
assert.strictEqual(b.buttons, undefined);
assert.strictEqual(b.details, "hi");

console.log("sanitizePresence: all checks passed");
