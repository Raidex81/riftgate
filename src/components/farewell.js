// Riftgate — closing for good. When Riftgate really quits (not when it only
// hides in the tray), the engine asks for a farewell first: a soft, warm
// chord settles and fades with two quiet chimes. On screen the app closes in on a point of light, like the
// opening in reverse. Then the engine finishes quitting (it never waits more
// than a couple of seconds). Settings → "Sound when Riftgate closes" turns
// the sound off; the picture stays, it's only about a second.

import { on, send, settings } from "../app/api.js";
import { createIntroSound } from "./intro-sound.js";

let started = false;

export function listenForFarewell() {
    on("r2-farewell", async () => {
        if (started) return;
        started = true;
        let s = {};
        try { s = await settings({ fresh: true }); } catch (e) { /* defaults */ }
        let length = 1.1;
        if (s.quitSound !== false) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                const ac = new AC({ latencyHint: "interactive" });
                const sound = createIntroSound(ac, { volume: .7 });
                length = sound.cue("farewell") || 1.55;
            } catch (e) { /* silent farewell */ }
        }
        if (!document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches) closeIn(length);
        setTimeout(() => send("r2-farewell-done"), length * 1000);
    });
}

// the app shrinks into the rift: a dark iris closing on a bright point
function closeIn(length) {
    const veil = document.createElement("div");
    veil.className = "farewell";
    veil.style.setProperty("--len", `${Math.max(.6, length - .15)}s`);
    veil.innerHTML = '<i class="farewell-point"></i>';
    document.body.appendChild(veil);
    document.documentElement.classList.add("farewell-on");
}
