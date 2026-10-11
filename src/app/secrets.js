// Riftgate — secrets. Not documented anywhere in the app on purpose (each
// earns a secret Seal):
//   The old code  ↑ ↑ ↓ ↓ ← → ← → B A, anywhere: a golden storm in the Nexus rift.
//   Seven knocks  click the gem at the top of the rail seven times, quickly.
//   Golden strike one click on the Nexus gem in forty strikes gold (hero.js).

import { flag } from "./seals.js";

const CODE = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
const fire = (id) => window.dispatchEvent(new CustomEvent("r2-secret", { detail: { id } }));

export function watchSecrets({ toast }) {
    let pos = 0;
    window.addEventListener("keydown", (e) => {
        const k = String(e.key || "").toLowerCase();
        pos = k === CODE[pos] ? pos + 1 : k === CODE[0] ? 1 : 0;
        if (pos < CODE.length) return;
        pos = 0;
        flag("old-code");
        // the storm happens in the Nexus rift: go there first if needed
        if (location.hash && location.hash !== "#nexus") { window.__pendingStorm = true; location.hash = "nexus"; } else fire("old-code");
        toast("The old code still works.");
    }, true);

    let knocks = [];
    document.addEventListener("click", (e) => {
        if (!e.target.closest || !e.target.closest(".brand-gem")) return;
        const now = performance.now();
        knocks = [...knocks.filter((t) => now - t < 3500), now];
        if (knocks.length < 7) return;
        knocks = [];
        const gem = e.target.closest(".brand-gem");
        gem.classList.remove("knocked"); void gem.offsetWidth; gem.classList.add("knocked");
        flag("knock");
        fire("knock");
        toast("Who's there? … The rift.");
    }, true);
}
