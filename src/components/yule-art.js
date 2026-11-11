// Riftgate — the Christmas Rift's pictures (season.js), drawn here once as
// SVG and used everywhere: the opening draws Santa's sleigh from them on its
// canvas, the app shows them as they are (yuletide.js, advent.js). Original
// drawings made for Riftgate.

let uid = 0;
const id = (p) => `${p}${++uid}`;

// ---- Santa's sleigh and his reindeer ------------------------------------------------
// Flying to the right. frame 0: legs stretched out, 1: legs tucked in, "both":
// both sets, for the app to swap with CSS (.f0 / .f1).
function reindeer(x, y, frame, lead) {
    const legs = {
        0: { far: ["M18 6 L28 18 L40 24", "M-20 6 L-30 18 L-44 22"], near: ["M22 6 L34 16 L48 18", "M-24 6 L-36 14 L-52 14"], dy: -3 },
        1: { far: ["M18 6 L24 20 L16 26", "M-20 6 L-14 20 L-22 26"], near: ["M22 6 L30 20 L22 28", "M-24 6 L-20 20 L-28 28"], dy: 3 }
    };
    const one = (f, cls) => {
        const L = legs[f];
        return `<g class="${cls}" transform="translate(${x} ${y + L.dy})">
          <g class="rd-legs far">${L.far.map((d) => `<path d="${d}"/>`).join("")}</g>
          <ellipse class="rd-tail" cx="-35" cy="-7" rx="6" ry="4.5"/>
          <path class="rd-body" d="M-34 0 C-34 -12 -20 -15 0 -15 C14 -15 24 -14 30 -8 C36 -2 34 10 24 13 C10 16 -12 16 -24 13 C-31 11 -34 7 -34 0 Z"/>
          <path class="rd-belly" d="M-22 8 C-10 13 10 13 22 8 C16 14 -14 15 -22 8 Z"/>
          <path class="rd-body" d="M18 -10 C24 -18 30 -28 34 -34 L44 -28 C40 -18 34 -6 28 2 Z"/>
          <path class="rd-head" d="M31 -35 C35 -44 48 -45 56 -39 L66 -34 C70 -32 70 -27 66 -26 L52 -24 C44 -22 35 -24 31 -30 Z"/>
          <path class="rd-ear" d="M38 -40 L28 -46 L35 -36 Z"/>
          <g class="rd-antlers"><path d="M40 -42 C38 -52 34 -58 28 -64 M35 -55 C32 -58 26 -58 22 -56 M37 -50 C42 -56 44 -62 44 -68 M30 -61 C30 -66 28 -70 26 -72"/>
            <path d="M46 -43 C48 -54 52 -60 58 -66 M50 -54 C54 -56 58 -54 62 -50 M53 -59 C54 -64 52 -70 50 -72"/></g>
          <circle class="rd-eye" cx="50" cy="-36" r="1.7"/>
          ${lead ? `<circle class="rd-glow" cx="68" cy="-30" r="11"/><circle class="rd-nose lead" cx="68" cy="-30" r="4.6"/>` : `<circle class="rd-nose" cx="68" cy="-30" r="3"/>`}
          <path class="rd-strap" d="M14 -13 C9 -3 9 7 14 14 M-6 -15 L-6 14"/>
          <circle class="rd-bell" cx="12" cy="16" r="3.6"/><circle class="rd-bell" cx="-6" cy="-6" r="2.2"/><circle class="rd-bell" cx="-6" cy="3" r="2.2"/>
          <g class="rd-legs near">${L.near.map((d) => `<path d="${d}"/>`).join("")}</g>
        </g>`;
    };
    return frame === "both" ? one(0, "f0") + one(1, "f1") : one(frame, "");
}

export function sleighSVG(frame = "both") {
    const g = id("sl");
    // the reindeer bob out of step: odd ones use the other frame
    const deer = [270, 370, 470, 572].map((x, i) => {
        const f = frame === "both" ? "both" : (frame + i) % 2;
        return reindeer(x, 112 + (i % 2 ? -4 : 2), f, i === 3);
    }).join("");
    return `<svg class="sleigh-art" viewBox="0 0 650 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="${g}r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8323d"/><stop offset="1" stop-color="#8e0f19"/></linearGradient>
        <linearGradient id="${g}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".5" stop-color="#f2bf3a"/><stop offset="1" stop-color="#b9821a"/></linearGradient>
        <linearGradient id="${g}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ea3a3f"/><stop offset="1" stop-color="#a5141c"/></linearGradient>
        <linearGradient id="${g}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a06a3c"/><stop offset="1" stop-color="#5e3a1d"/></linearGradient>
        <radialGradient id="${g}n" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ff6a5a" stop-opacity=".95"/><stop offset=".45" stop-color="#ff2a2a" stop-opacity=".45"/><stop offset="1" stop-color="#ff0000" stop-opacity="0"/></radialGradient>
      </defs>
      <style>
        .rd-body,.rd-head{fill:url(#${g}d)} .rd-belly{fill:#d6aa78;opacity:.8} .rd-tail{fill:#f6ead8} .rd-ear{fill:#6b4222}
        .rd-legs path{fill:none;stroke:#5e3a1d;stroke-width:5;stroke-linecap:round;stroke-linejoin:round} .rd-legs.far path{stroke:#43280f}
        .rd-antlers path{fill:none;stroke:#e6d2ad;stroke-width:2.8;stroke-linecap:round}
        .rd-eye{fill:#1b0f08} .rd-nose{fill:#2a1a10} .rd-nose.lead{fill:#ff2b2b} .rd-glow{fill:url(#${g}n)}
        .rd-strap{fill:none;stroke:#c4161c;stroke-width:5;stroke-linecap:round} .rd-bell{fill:url(#${g}g)}
        .rein{fill:none;stroke:url(#${g}g);stroke-width:2;stroke-linecap:round}
        .sl-body{fill:url(#${g}r);stroke:url(#${g}g);stroke-width:4;stroke-linejoin:round}
        .sl-run{fill:none;stroke:url(#${g}g);stroke-width:6;stroke-linecap:round} .sl-deco{fill:none;stroke:url(#${g}g);stroke-width:3;stroke-linecap:round}
        .st-coat{fill:url(#${g}c)} .st-fur{fill:#fbf7f0} .st-skin{fill:#f3c6a2} .st-dark{fill:#1d1410} .st-cheek{fill:#f08a7a;opacity:.7}
        .sack{fill:#8a5a2c} .sack-tie{fill:none;stroke:#5a3616;stroke-width:3}
      </style>
      <path class="rein" d="M146 98 C190 112 220 120 254 112 M286 112 C320 116 340 112 354 106 M386 106 C420 112 440 116 454 112 M486 112 C520 112 540 110 556 106"/>
      ${deer}
      <!-- the sack of presents -->
      <rect x="24" y="30" width="22" height="22" rx="2" fill="#2f9a52" transform="rotate(-12 35 41)"/><rect x="33" y="30" width="4" height="22" fill="#f4c04e" transform="rotate(-12 35 41)"/>
      <rect x="44" y="24" width="20" height="20" rx="2" fill="#2f6fd1" transform="rotate(10 54 34)"/><rect x="44" y="32" width="20" height="4" fill="#fbf7f0" transform="rotate(10 54 34)"/>
      <path class="sack" d="M14 108 C6 84 12 56 30 46 C44 40 60 44 70 54 C80 66 80 92 74 108 Z"/>
      <path class="sack-tie" d="M26 50 C38 56 54 56 66 52"/>
      <!-- Santa -->
      <path class="st-coat" d="M70 112 C66 86 78 68 100 68 C120 68 130 84 128 112 Z"/>
      <path class="st-fur" d="M96 70 L104 70 L106 112 L94 112 Z"/>
      <rect x="70" y="96" width="58" height="7" class="st-dark"/><rect x="94" y="94" width="11" height="11" rx="1.5" fill="none" stroke="#f4c04e" stroke-width="2.4"/>
      <path class="st-coat" d="M116 78 C128 82 138 88 144 96 L138 102 C130 96 120 92 112 90 Z"/>
      <circle cx="145" cy="99" r="6" class="st-dark"/><path class="st-fur" d="M136 92 L144 100 L140 104 L132 96 Z"/>
      <circle class="st-skin" cx="102" cy="54" r="13"/>
      <path class="st-fur" d="M88 56 C88 74 94 86 103 88 C112 86 118 74 117 56 C112 62 107 64 102 64 C97 64 92 62 88 56 Z"/>
      <path class="st-fur" d="M94 63 C98 58 102 60 103 62 C105 59 110 58 113 62 C108 66 104 64 103 64 C100 66 96 66 94 63 Z"/>
      <circle class="st-cheek" cx="110" cy="56" r="3"/><circle class="st-dark" cx="107" cy="51" r="1.6"/><circle class="st-skin" cx="113" cy="57" r="3"/>
      <path class="st-coat" d="M88 46 C86 30 78 20 62 22 C70 28 74 36 76 46 Z"/>
      <path class="st-coat" d="M86 46 C88 36 100 32 114 40 L116 46 Z"/>
      <rect x="84" y="42" width="34" height="9" rx="4.5" class="st-fur"/><circle class="st-fur" cx="62" cy="24" r="6"/>
      <!-- the sleigh -->
      <path class="sl-run" d="M6 172 L168 172 C196 172 210 160 210 140 C210 124 196 118 188 126 M48 152 L48 172 M140 152 L140 172"/>
      <path class="sl-body" d="M14 60 C6 62 6 74 10 82 L22 140 C24 150 32 155 44 155 L160 155 C184 155 198 140 200 118 C202 104 194 96 184 98 C176 100 175 108 180 111 L150 113 L62 113 L54 68 C52 60 32 54 14 60 Z"/>
      <path class="sl-deco" d="M40 132 C50 118 72 118 76 132 C80 144 100 144 106 132 C112 120 132 120 138 134 M30 84 C36 92 36 104 32 112"/>
      <circle cx="164" cy="132" r="5" fill="url(#${g}g)"/>
    </svg>`;
}

// ---- A Christmas tree -------------------------------------------------------------
// tiers with soft scalloped edges, snow on the tips, a gold garland, baubles,
// fairy lights that twinkle (.tw, CSS) and a glowing star
export function treeSVG() {
    const g = id("tr");
    const tier = (top, bottom, half) => {
        const n = 6, w = (half * 2) / n;
        let d = `M100 ${top} L${100 + half} ${bottom}`;
        for (let i = 0; i < n; i++) { const x0 = 100 + half - i * w, x1 = x0 - w; d += ` Q${(x0 + x1) / 2} ${bottom + 9} ${x1} ${bottom}`; }
        return `<path class="tr-tier" d="${d} Z"/><path class="tr-snow" d="M100 ${top} L${100 + half * .3} ${top + (bottom - top) * .3} Q100 ${top + (bottom - top) * .22} ${100 - half * .3} ${top + (bottom - top) * .3} Z"/>`;
    };
    const tiers = [[132, 238, 96], [92, 188, 80], [56, 140, 62], [24, 92, 44]];
    const garland = [[62, 120, 140, 114, 128], [44, 170, 158, 162, 172], [30, 220, 172, 210, 224]]
        .map(([x0, y0, x1, y1, sag]) => `<path class="tr-garland" d="M${x0} ${y0} Q100 ${sag + 22} ${x1} ${y1}"/>`).join("");
    const BAUB = [["#e3263b", 78, 86], ["#f4c04e", 120, 100], ["#3d7bff", 90, 128], ["#e3263b", 132, 150], ["#f4f4ff", 64, 160], ["#f4c04e", 104, 176], ["#e3263b", 70, 210], ["#3d7bff", 150, 200], ["#f4c04e", 120, 224], ["#c04dff", 98, 58]];
    const baubles = BAUB.map(([c, x, y], i) => `<g class="tr-bauble"><circle cx="${x}" cy="${y}" r="${i % 3 ? 6.5 : 8}" fill="${c}"/><circle cx="${x - 2.4}" cy="${y - 2.6}" r="2.2" fill="#fff" opacity=".7"/><rect x="${x - 2}" y="${y - (i % 3 ? 9 : 10.5)}" width="4" height="3" fill="#d8c27a"/></g>`).join("");
    const LIGHTS = [[100, 44], [86, 70], [114, 74], [72, 104], [128, 108], [100, 116], [60, 146], [84, 150], [116, 140], [142, 156], [52, 196], [80, 190], [128, 186], [154, 214], [46, 228], [92, 230], [138, 232], [110, 204], [66, 124]];
    const COLS = ["#ff4a5a", "#ffd25a", "#6ad1ff", "#7dff9a", "#ff8af0"];
    const lights = LIGHTS.map(([x, y], i) => `<circle class="tw" style="--d:${(i * .37) % 2.2}s" cx="${x}" cy="${y}" r="2.6" fill="${COLS[i % COLS.length]}"/>`).join("");
    return `<svg class="tree-art" viewBox="0 0 200 262" aria-hidden="true">
      <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f8f4e"/><stop offset=".55" stop-color="#16603a"/><stop offset="1" stop-color="#0a3a22"/></linearGradient>
        <radialGradient id="${g}s" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff8d0"/><stop offset=".6" stop-color="#ffd24a"/><stop offset="1" stop-color="#e09a12"/></radialGradient></defs>
      <style>.tr-tier{fill:url(#${g})} .tr-snow{fill:#f4fbff;opacity:.85} .tr-garland{fill:none;stroke:#f4c04e;stroke-width:2.2;stroke-dasharray:1 4;stroke-linecap:round}</style>
      <rect x="90" y="234" width="20" height="24" rx="2" fill="#5a3418"/>
      ${tiers.map(([a, b, c]) => tier(a, b, c)).join("")}
      ${garland}${baubles}${lights}
      <path class="tr-star" fill="url(#${g}s)" d="${star(100, 20, 15, 6.5)}"/>
    </svg>`;
}
function star(cx, cy, R, r, n = 5) {
    let d = "";
    for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r : R; d += `${i ? "L" : "M"}${(cx + Math.cos(a) * rr).toFixed(1)} ${(cy + Math.sin(a) * rr).toFixed(1)} `; }
    return d + "Z";
}

// ---- Presents ---------------------------------------------------------------------
export const WRAPS = [
    { box: "#d61f33", ribbon: "#f4c04e", dots: "#ff6b78" },
    { box: "#1f8a4c", ribbon: "#e3263b", dots: null },
    { box: "#2f6fd1", ribbon: "#fbf7f0", dots: "#7fb0ff" },
    { box: "#f4c04e", ribbon: "#d61f33", dots: null },
    { box: "#8a3dd6", ribbon: "#7dffcf", dots: "#b98cff" },
    { box: "#fbf7f0", ribbon: "#1f8a4c", dots: "#e3263b" }
];
export function presentSVG(k = 0, { lid = true } = {}) {
    const w = WRAPS[k % WRAPS.length], g = id("pr");
    const dots = w.dots ? `<g fill="${w.dots}" opacity=".75">${[[14, 32], [34, 40], [46, 30], [20, 50], [44, 52], [28, 28]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2"/>`).join("")}</g>` : "";
    return `<svg class="present-art" viewBox="0 0 60 64" aria-hidden="true">
      <defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient></defs>
      <rect x="6" y="24" width="48" height="38" rx="2.5" fill="${w.box}"/>${dots}
      <rect x="6" y="24" width="48" height="38" rx="2.5" fill="url(#${g})"/>
      <rect x="26" y="24" width="8" height="38" fill="${w.ribbon}"/>
      <g class="present-lid"${lid ? "" : ' style="display:none"'}>
        <rect x="3" y="16" width="54" height="11" rx="2.5" fill="${w.box}"/><rect x="3" y="16" width="54" height="11" rx="2.5" fill="url(#${g})" opacity=".6"/>
        <rect x="26" y="16" width="8" height="11" fill="${w.ribbon}"/>
        <path d="M30 16 C22 4 10 6 14 13 C17 18 26 17 30 16 Z M30 16 C38 4 50 6 46 13 C43 18 34 17 30 16 Z" fill="${w.ribbon}"/>
        <path d="M30 16 C24 20 22 26 20 28 M30 16 C36 20 38 26 40 28" stroke="${w.ribbon}" stroke-width="3" fill="none" stroke-linecap="round"/>
        <circle cx="30" cy="16" r="3.4" fill="${w.ribbon}"/><circle cx="29" cy="15" r="1.2" fill="#fff" opacity=".5"/>
      </g>
    </svg>`;
}

// ---- The fireplace: stone, a mantel with a garland, stockings, a fire ------------------
export function fireplaceSVG() {
    const g = id("fp");
    const bricks = [];
    for (let row = 0; row < 9; row++) {
        const y = 58 + row * 16, off = row % 2 ? 0 : 15;
        for (let x = 14 - off; x < 206; x += 30) {
            const x0 = Math.max(14, x), x1 = Math.min(206, x + 28);
            if (y + 14 > 100 && x1 > 56 && x0 < 164) continue; // the firebox
            if (x1 - x0 > 4) bricks.push(`<rect x="${x0}" y="${y}" width="${x1 - x0}" height="14" rx="2"/>`);
        }
    }
    const stocking = (x, body, cuff, stripe, k) => `<g class="stocking" style="--d:${k * .6}s" transform="translate(${x} 50)">
        <path d="M-9 8 L9 8 L9 40 C9 46 14 48 22 50 C30 52 30 64 20 64 L0 63 C-8 62 -10 56 -10 48 Z" fill="${body}"/>
        ${stripe ? `<path d="M-10 20 L9 20 M-10 32 L9 32 M-10 44 L9 44" stroke="${stripe}" stroke-width="4"/>` : ""}
        <path d="M14 50 C22 51 27 54 27 58 C27 62 23 64 18 64 C20 60 18 54 14 50 Z" fill="${cuff}" opacity=".9"/>
        <rect x="-12" y="2" width="23" height="11" rx="3" fill="${cuff}"/>
        <path d="M0 -4 L0 3" stroke="#d8c27a" stroke-width="2"/></g>`;
    return `<svg class="fireplace-art" viewBox="0 0 220 204" aria-hidden="true">
      <defs>
        <linearGradient id="${g}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a4a26"/><stop offset="1" stop-color="#3f230f"/></linearGradient>
        <radialGradient id="${g}f" cx="50%" cy="100%" r="80%"><stop offset="0" stop-color="#ffb347" stop-opacity=".9"/><stop offset=".5" stop-color="#ff6a1a" stop-opacity=".35"/><stop offset="1" stop-color="#2a0c04" stop-opacity="0"/></radialGradient>
        <linearGradient id="${g}a" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff6c2"/><stop offset=".35" stop-color="#ffc23a"/><stop offset=".75" stop-color="#ff6a1a"/><stop offset="1" stop-color="#d8261a" stop-opacity=".2"/></linearGradient>
      </defs>
      <style>.fp-stone{fill:#5a5560} .fp-bricks rect{fill:#6f6a76;stroke:#4a4652;stroke-width:1.2} .fp-flame{fill:url(#${g}a)}</style>
      <rect class="fp-stone" x="14" y="52" width="192" height="152"/>
      <g class="fp-bricks">${bricks.join("")}</g>
      <path d="M56 204 L56 112 C56 98 70 92 110 92 C150 92 164 98 164 112 L164 204 Z" fill="#140806"/>
      <path d="M56 204 L56 112 C56 98 70 92 110 92 C150 92 164 98 164 112 L164 204 Z" fill="url(#${g}f)" class="fp-glow"/>
      <g class="fp-logs"><rect x="72" y="182" width="76" height="12" rx="6" fill="#5e3618" transform="rotate(-8 110 188)"/><rect x="74" y="182" width="76" height="12" rx="6" fill="#4a2a12" transform="rotate(9 110 188)"/>
        <circle cx="74" cy="192" r="5" fill="#a8743e"/><circle cx="148" cy="191" r="5" fill="#a8743e"/></g>
      <g class="fp-fire">
        <path class="fp-flame f1" d="M84 186 C78 166 92 156 90 136 C102 150 104 162 100 186 Z"/>
        <path class="fp-flame f2" d="M98 188 C92 160 112 150 108 118 C126 140 128 164 122 188 Z"/>
        <path class="fp-flame f3" d="M118 186 C116 168 128 160 132 142 C140 160 142 172 136 186 Z"/>
        <path class="fp-flame f4" d="M104 188 C102 172 110 166 110 154 C118 166 118 176 116 188 Z" style="fill:#fff3b0"/>
      </g>
      <rect x="0" y="38" width="220" height="16" rx="3" fill="url(#${g}m)"/>
      <rect x="6" y="52" width="208" height="4" fill="#2c180a" opacity=".6"/>
      <path class="fp-garland" d="M4 46 C30 64 54 64 74 50 C94 64 126 64 146 50 C166 64 190 64 216 46" fill="none" stroke="#1f6b3a" stroke-width="7" stroke-linecap="round"/>
      ${[[22, "#ff4a5a"], [44, "#ffd25a"], [74, "#6ad1ff"], [100, "#ff4a5a"], [124, "#7dff9a"], [146, "#ffd25a"], [170, "#ff8af0"], [196, "#6ad1ff"]].map(([x, c], i) => `<circle class="tw" style="--d:${(i * .41) % 1.8}s" cx="${x}" cy="${[55, 58, 50, 58, 58, 50, 58, 55][i]}" r="2.8" fill="${c}"/>`).join("")}
      ${stocking(46, "#d61f33", "#fbf7f0", null, 0)}${stocking(110, "#1f8a4c", "#fbf7f0", "#e3263b", 1)}${stocking(174, "#fbf7f0", "#d61f33", "#d61f33", 2)}
    </svg>`;
}

// ---- An elf, waving, a present under his arm --------------------------------------------
export function elfSVG() {
    return `<svg class="elf-art" viewBox="0 0 80 120" aria-hidden="true">
      <style>.e-g{fill:#2a9a4e} .e-gd{fill:#1a6b34} .e-r{fill:#d61f33} .e-s{fill:#f1c29e} .e-w{fill:#fbf7f0} .e-k{fill:#1d1410}</style>
      <path class="e-r" d="M28 92 L26 112 L34 112 L35 92 Z"/><path class="e-r" d="M42 92 L44 112 L52 112 L48 92 Z"/>
      <path class="e-w" d="M26.5 98 L34.5 98 L34.3 101 L26.3 101 Z M26.2 104 L34.2 104 L34 107 L26 107 Z M43 98 L49.5 98 L50 101 L43.4 101 Z M43.6 104 L50.4 104 L50.8 107 L44 107 Z"/>
      <path class="e-gd" d="M22 112 C14 112 10 108 12 104 C16 108 20 108 26 108 L35 108 L35 114 L24 114 Z M44 108 L54 108 C60 108 64 108 68 104 C70 108 66 112 58 112 L56 114 L44 114 Z"/>
      <path class="e-g" d="M22 94 C20 74 26 60 40 60 C54 60 60 74 58 94 L52 98 L46 94 L40 99 L34 94 L28 98 Z"/>
      <rect x="22" y="78" width="36" height="6" class="e-k"/><rect x="36" y="77" width="8" height="8" rx="1" fill="none" stroke="#f4c04e" stroke-width="2"/>
      <path class="e-w" d="M32 60 L48 60 L44 68 L40 64 L36 68 Z"/>
      <g class="elf-arm"><path class="e-g" d="M54 66 C62 60 66 52 68 44 L74 46 C72 56 66 66 58 72 Z"/><circle class="e-s" cx="71" cy="42" r="5"/></g>
      <path class="e-g" d="M26 66 C18 70 14 78 16 84 L22 84 C22 78 26 74 30 72 Z"/>
      <g transform="translate(6 76) scale(.42)">${presentInner(0)}</g>
      <circle class="e-s" cx="40" cy="46" r="13"/>
      <path class="e-s" d="M27 44 L16 36 L28 50 Z M53 44 L64 36 L52 50 Z"/>
      <circle class="e-k" cx="35.5" cy="45" r="1.7"/><circle class="e-k" cx="44.5" cy="45" r="1.7"/>
      <circle cx="33" cy="50" r="2.6" fill="#f08a7a" opacity=".7"/><circle cx="47" cy="50" r="2.6" fill="#f08a7a" opacity=".7"/>
      <path d="M35 52 Q40 57 45 52" fill="none" stroke="#7a2a1a" stroke-width="1.8" stroke-linecap="round"/>
      <path class="e-g" d="M26 38 C28 24 38 14 52 8 C60 4 66 8 64 14 C58 12 54 16 52 24 L54 38 Z"/>
      <rect x="25" y="34" width="30" height="7" rx="3.5" class="e-r"/>
      <circle cx="64" cy="15" r="4.5" fill="#f4c04e"/>
    </svg>`;
}
function presentInner(k) { return presentSVG(k).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, ""); }

// ---- A snowman, with a scarf and a top hat ----------------------------------------------
export function snowmanSVG() {
    return `<svg class="snowman-art" viewBox="0 0 90 120" aria-hidden="true">
      <defs><radialGradient id="snw" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#e3eef8"/><stop offset="1" stop-color="#b9cde0"/></radialGradient></defs>
      <path d="M22 70 L4 54 M10 59 L4 62 M68 70 L86 52 M80 58 L86 60" stroke="#5a3418" stroke-width="3" stroke-linecap="round" fill="none"/>
      <circle cx="45" cy="96" r="24" fill="url(#snw)"/><circle cx="45" cy="64" r="18" fill="url(#snw)"/><circle cx="45" cy="38" r="14" fill="url(#snw)"/>
      <path d="M31 48 C38 54 52 54 59 48 L60 54 C52 60 38 60 30 54 Z" fill="#d61f33"/><path d="M50 52 L56 70 L62 68 L56 52 Z" fill="#b5121f"/>
      <path d="M45 39 L62 42 L45 43 Z" fill="#ff8a1f"/>
      <circle cx="40" cy="34" r="1.8" fill="#1d1410"/><circle cx="50" cy="34" r="1.8" fill="#1d1410"/>
      <circle cx="45" cy="64" r="2" fill="#1d1410"/><circle cx="45" cy="72" r="2" fill="#1d1410"/><circle cx="45" cy="88" r="2.2" fill="#1d1410"/>
      <rect x="30" y="22" width="30" height="4" rx="2" fill="#1d1410"/><rect x="35" y="6" width="20" height="18" rx="2" fill="#1d1410"/><rect x="35" y="18" width="20" height="4" fill="#d61f33"/>
    </svg>`;
}

// ---- A Santa hat, for the gem in the corner ------------------------------------------------
export function hatSVG() {
    return `<svg class="hat-art" viewBox="0 0 64 52" aria-hidden="true">
      <defs><linearGradient id="hatg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ef3a42"/><stop offset="1" stop-color="#9c1019"/></linearGradient></defs>
      <path d="M8 40 C10 22 22 8 38 6 C48 5 56 12 58 22 C60 30 56 36 54 32 C52 24 48 20 44 22 C50 28 52 34 52 40 Z" fill="url(#hatg)"/>
      <rect x="4" y="36" width="52" height="12" rx="6" fill="#fbf7f0"/>
      <circle cx="55" cy="33" r="6.5" fill="#fbf7f0"/>
    </svg>`;
}

// ---- Holly: three spiky leaves and berries -------------------------------------------------
export function hollySVG() {
    const leaf = (rot) => `<path transform="rotate(${rot} 60 40)" d="M60 40 C66 34 72 34 76 30 C76 36 82 36 86 34 C84 40 88 44 94 44 C88 48 86 52 88 56 C82 54 78 56 76 60 C72 54 66 50 60 40 Z" fill="#1f7a3e" stroke="#0f4a24" stroke-width="1.2"/><path transform="rotate(${rot} 60 40)" d="M60 40 C70 46 80 50 90 50" stroke="#0f4a24" stroke-width="1" fill="none"/>`;
    return `<svg class="holly-art" viewBox="0 0 120 90" overflow="visible" aria-hidden="true">
      ${leaf(-20)}${leaf(60)}${leaf(150)}
      <circle cx="56" cy="40" r="7" fill="#d61f33"/><circle cx="66" cy="46" r="7" fill="#c4161c"/><circle cx="58" cy="51" r="6.5" fill="#e3263b"/>
      <circle cx="54" cy="37" r="2" fill="#fff" opacity=".6"/><circle cx="64" cy="43" r="2" fill="#fff" opacity=".6"/>
    </svg>`;
}

// For a canvas: an SVG as a picture, ready when loaded
export function svgImage(svg) {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.includes("xmlns=") ? svg : svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
    return img;
}
