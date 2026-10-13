// Riftgate's one window, for the sections that talk to it from the engine:
// send it an event, or bring it to the front. main.js sets it when it's made.
"use strict";
let current = null;

const set = (w) => { current = w; };
const get = () => (current && !current.isDestroyed() ? current : null);

function send(channel, payload) {
    const w = get();
    if (w) w.webContents.send(channel, payload);
}

function show() {
    const w = get();
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
}

module.exports = { set, get, send, show };
