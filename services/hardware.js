// Riftgate — how fast a graphics card or a processor is, roughly, and what a
// game's requirements ask for. Pure logic, no Electron: engine/pc-check.js
// reads this PC and the Steam requirements, this compares them.
//
// Scores are rough relative performance for games (GeForce GTX 1060 6GB =
// 100 for graphics cards, Core i5-8400 = 100 for processors), from public
// benchmarks rounded to tiers. Close calls are treated as close: something
// needs to be clearly slower (under 90% of what's asked) to count as "below".

const norm = (s) => String(s || "").toLowerCase().replace(/\(r\)|\(tm\)|®|™/g, " ").replace(/[^a-z0-9+]+/g, " ").replace(/\s+/g, " ").trim();

// ---- Graphics cards -------------------------------------------------------------------------
// [pattern on the normalised name, score]. More specific patterns first.
const GPUS = [
    // NVIDIA RTX 50 / 40 / 30 / 20
    [/rtx 5090/, 620], [/rtx 5080/, 470], [/rtx 5070 ti/, 430], [/rtx 5070/, 360], [/rtx 5060 ti/, 290], [/rtx 5060/, 250], [/rtx 5050/, 200],
    [/rtx 4090/, 530], [/rtx 4080 super/, 430], [/rtx 4080/, 420], [/rtx 4070 ti super/, 375], [/rtx 4070 ti/, 350], [/rtx 4070 super/, 330], [/rtx 4070/, 290],
    [/rtx 4060 ti/, 235], [/rtx 4060/, 195], [/rtx 4050/, 160],
    [/rtx 3090 ti/, 370], [/rtx 3090/, 340], [/rtx 3080 ti/, 330], [/rtx 3080/, 300], [/rtx 3070 ti/, 255], [/rtx 3070/, 240], [/rtx 3060 ti/, 210], [/rtx 3060/, 170],
    [/rtx 3050 6 ?gb/, 105], [/rtx 3050/, 130],
    [/rtx 2080 ti/, 265], [/rtx 2080 super/, 225], [/rtx 2080/, 215], [/rtx 2070 super/, 200], [/rtx 2070/, 180], [/rtx 2060 super/, 170], [/rtx 2060/, 150],
    [/titan rtx/, 280], [/titan v\b/, 250],
    // GTX 16 / 10 / 9 / 7 / 6 / 5 / 4
    [/gtx 1660 ti/, 125], [/gtx 1660 super/, 120], [/gtx 1660/, 110], [/gtx 1650 super/, 95], [/gtx 1650/, 70], [/gtx 1630/, 50],
    [/gtx 1080 ti/, 215], [/titan xp|titan x pascal/, 225], [/gtx 1080/, 165], [/gtx 1070 ti/, 150], [/gtx 1070/, 135],
    [/gtx 1060 3 ?gb/, 93], [/gtx 1060/, 100], [/gtx 1050 ti/, 55], [/gtx 1050/, 45], [/gt 1030/, 20],
    [/gtx 980 ti/, 115], [/titan x\b/, 118], [/gtx 980/, 92], [/gtx 970/, 78], [/gtx 960/, 55], [/gtx 950/, 45],
    [/gtx 780 ti/, 75], [/gtx titan/, 70], [/gtx 780/, 65], [/gtx 770/, 58], [/gtx 760/, 48], [/gtx 750 ti/, 35], [/gtx 750/, 30],
    [/gtx 690/, 70], [/gtx 680/, 56], [/gtx 670/, 52], [/gtx 660 ti/, 45], [/gtx 660/, 40], [/gtx 650 ti/, 27], [/gtx 650/, 20],
    [/gtx 590/, 50], [/gtx 580/, 38], [/gtx 570/, 35], [/gtx 560 ti/, 30], [/gtx 560/, 26], [/gtx 550 ti/, 20], [/gtx 480/, 33], [/gtx 470/, 28], [/gtx 460/, 22],
    [/gt (7|6)[34]0/, 12], [/gts 450/, 16], [/gts 250|9800 gtx/, 12], [/8800 gt/, 10],
    [/mx ?5[57]0/, 45], [/mx ?450/, 40], [/mx ?350/, 30], [/mx ?330/, 28], [/mx ?250/, 27], [/mx ?230/, 22], [/mx ?150/, 25], [/mx ?130/, 18], [/mx ?110/, 14],
    [/quadro rtx 6000|rtx a6000/, 300], [/quadro p4000/, 120], [/quadro p2000/, 70],
    // AMD RX 9000 / 7000 / 6000 / 5000 / 500 / 400, R9/R7, HD
    [/rx 9070 xt/, 440], [/rx 9070/, 400], [/rx 9060 xt/, 270], [/rx 9060/, 230],
    [/rx 7900 xtx/, 450], [/rx 7900 xt/, 400], [/rx 7900 gre/, 350], [/rx 7800 xt/, 330], [/rx 7700 xt/, 280], [/rx 7700/, 260], [/rx 7600 xt/, 210], [/rx 7600/, 200],
    [/rx 6950 xt/, 370], [/rx 6900 xt/, 350], [/rx 6800 xt/, 330], [/rx 6800/, 290], [/rx 6750 xt/, 245], [/rx 6700 xt/, 235], [/rx 6700/, 215],
    [/rx 6650 xt/, 200], [/rx 6600 xt/, 190], [/rx 6600/, 170], [/rx 6500 xt/, 80], [/rx 6400/, 70],
    [/rx 5700 xt/, 185], [/rx 5700/, 165], [/rx 5600 xt/, 145], [/rx 5600/, 135], [/rx 5500 xt/, 95], [/rx 5500/, 85], [/rx 5300/, 75],
    [/radeon vii/, 190], [/vega 64/, 160], [/vega 56/, 145],
    [/rx 590/, 110], [/rx 580/, 100], [/rx 570/, 90], [/rx 560/, 45], [/rx 550/, 30], [/rx 480/, 95], [/rx 470/, 85], [/rx 460/, 40],
    [/r9 fury x/, 125], [/r9 fury/, 120], [/r9 nano/, 115], [/r9 390x/, 105], [/r9 390/, 100], [/r9 380x/, 78], [/r9 380/, 70],
    [/r9 290x/, 95], [/r9 290/, 88], [/r9 285/, 68], [/r9 280x/, 72], [/r9 280/, 65], [/r9 270x/, 55], [/r9 270/, 50],
    [/r7 370/, 45], [/r7 360/, 35], [/r7 265/, 42], [/r7 260x/, 35], [/r7 260/, 30], [/r7 250/, 20],
    [/hd 7990/, 110], [/hd 7970/, 70], [/hd 7950/, 62], [/hd 7870/, 55], [/hd 7850/, 45], [/hd 7790/, 35], [/hd 7770/, 30], [/hd 7750/, 22],
    [/hd 6990/, 75], [/hd 6970/, 45], [/hd 6950/, 42], [/hd 6870/, 35], [/hd 6850/, 30], [/hd 6790/, 26], [/hd 6770|hd 5770/, 25], [/hd 6670/, 16], [/hd 5870/, 36], [/hd 5850/, 32],
    [/890m/, 95], [/880m/, 90], [/780m/, 80], [/760m/, 70], [/680m/, 65], [/660m/, 55], [/610m/, 20], [/vega 11|rx vega 10/, 33], [/vega 8|vega 7/, 28], [/vega 6|vega 3/, 18],
    // Intel
    [/arc b580/, 260], [/arc b570/, 230], [/arc a770/, 215], [/arc a750/, 200], [/arc a580/, 170], [/arc a380/, 85], [/arc a310/, 55],
    [/arc 140v|arc 130v/, 70], [/arc graphics|intel arc\b/, 60], [/iris xe/, 35], [/iris plus/, 22], [/iris pro/, 20], [/iris/, 18],
    [/uhd (graphics )?7[0-9]{2}/, 22], [/uhd (graphics )?6[0-9]{2}|uhd graphics/, 16], [/hd graphics 6[0-9]{2}|hd 6[0-9]{2}\b/, 15], [/hd graphics 5[0-9]{2}|hd 5[0-9]{2}\b/, 13],
    [/hd graphics 4600|hd 4600/, 12], [/hd graphics 4[0-9]{3}|hd 4[0-9]{3}/, 9], [/hd graphics 3000/, 5], [/hd graphics 2000/, 4]
];
const LAPTOP = /laptop|mobile|max ?q|notebook|(gtx|rtx) \d{3,4}m\b/;

function gpuScore(name) {
    const n = norm(name);
    if (!n) return null;
    for (const [re, score] of GPUS) {
        if (re.test(n)) {
            // a laptop's chip is slower than the desktop card of the same name (not the built-in Radeon ...M chips)
            const mobile = LAPTOP.test(n);
            return Math.round(score * (mobile ? 0.75 : 1));
        }
    }
    return null;
}

// ---- Processors -------------------------------------------------------------------------------
const INTEL_GEN = { 1: 0.4, 2: 0.45, 3: 0.5, 4: 0.55, 5: 0.58, 6: 0.65, 7: 0.7, 8: 1.0, 9: 1.05, 10: 1.15, 11: 1.3, 12: 1.7, 13: 1.95, 14: 2.0 };
const INTEL_TIER = { 3: 0.7, 5: 1.0, 7: 1.25, 9: 1.45 };
const RYZEN_SERIES = { 1: 0.9, 2: 1.0, 3: 1.2, 4: 1.3, 5: 1.55, 6: 1.6, 7: 1.95, 8: 1.9, 9: 2.15 };
const RYZEN_TIER = { 3: 0.7, 5: 1.0, 7: 1.25, 9: 1.45 };
// laptop and low-power chips (U, Y, H, HS…)
function suffixFactor(s) {
    if (/^(u|y|e|g\d?)$/.test(s)) return 0.6;
    if (/^(h|hs|hx|hk|hq|p)$/.test(s)) return /hx/.test(s) ? 0.95 : 0.85;
    return 1;
}

function cpuScore(name) {
    const n = norm(name);
    if (!n) return null;
    let m;
    // Intel Core Ultra 5 245K (Series 2), Ultra 7 155H (Series 1)
    if ((m = /core ultra ([579]) (\d)(\d{2})([a-z]*)/.exec(n))) {
        const base = m[2] === "1" ? 1.6 : 2.0;
        return Math.round(100 * base * (INTEL_TIER[m[1]] || 1) * suffixFactor(m[4]));
    }
    // Intel Core i3/i5/i7/i9 + model (i5-8400, i7 4790K, i9-13900K, i5 650)
    if ((m = /(?:core )?i([3579])[ -]?(\d{3,5})([a-z]*)/.exec(n))) {
        const num = m[2];
        // i9-13900K and i5-10400: 5 digits, 2 for the generation; a laptop's i5-1235U or i7-1165G7: 4 digits starting with 1x
        const gen = num.length === 5 || (num.length === 4 && num[0] === "1") ? Number(num.slice(0, 2)) : num.length === 4 ? Number(num[0]) : 1;
        const f = INTEL_GEN[gen] || (gen > 14 ? 2.0 : 0.5);
        return Math.round(100 * f * (INTEL_TIER[m[1]] || 1) * suffixFactor(m[3]));
    }
    // AMD Ryzen 3/5/7/9 + model (Ryzen 5 1600, Ryzen 7 7800X3D, Ryzen 9 5900HX)
    if ((m = /ryzen ([3579])(?: pro)? (\d)(\d{3})([a-z0-9]*)/.exec(n))) {
        const series = Number(m[2]);
        const x3d = /x3d/.test(m[4]);
        let suffix = m[4].replace("x3d", "");
        if (/^(x|xt|f|e)?$/.test(suffix)) suffix = suffix === "e" ? "e" : "";
        return Math.round(100 * (RYZEN_SERIES[series] || 1) * (RYZEN_TIER[m[1]] || 1) * (x3d ? 1.1 : 1) * suffixFactor(suffix));
    }
    if ((m = /ryzen ai (?:9|7|5)/.exec(n))) return 220;
    if ((m = /threadripper/.exec(n))) return 260;
    // older AMD and Intel
    if ((m = /fx ?-?(\d)(\d{3})/.exec(n))) return { 4: 30, 6: 38, 8: 50, 9: 55 }[m[1]] || 35;
    if (/phenom ii x6/.test(n)) return 35; if (/phenom ii x4/.test(n)) return 27; if (/phenom/.test(n)) return 20;
    if (/athlon ii x4|athlon x4/.test(n)) return 25; if (/athlon/.test(n)) return 20;
    if (/core 2 quad|q[89]\d{3}/.test(n)) return 20; if (/core 2 duo|e[78]\d{3}/.test(n)) return 12;
    if (/pentium|celeron/.test(n)) return /g[67]\d{3}|gold/.test(n) ? 45 : 25;
    if (/xeon/.test(n)) return null; // too varied to guess
    return null;
}

// ---- Memory -------------------------------------------------------------------------------------
function ramGb(text) {
    const m = /(\d+(?:[.,]\d+)?)\s*(gb|mb|g)\b/i.exec(String(text || ""));
    if (!m) return null;
    const v = Number(m[1].replace(",", "."));
    return /mb/i.test(m[2]) ? v / 1024 : v;
}

// ---- Steam's requirements -------------------------------------------------------------------
const plain = (html) => String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/li>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// "Graphics: GeForce GTX 1060 6GB or Radeon RX 580 8GB" -> { text, options: [names] }
function field(text, labels) {
    const re = new RegExp(`^\\s*(?:${labels})\\s*:\\s*(.+)$`, "im");
    const m = re.exec(text);
    return m ? m[1].trim() : null;
}
const options = (s) => String(s || "").split(/\s*(?:\bor\b|\/|\||,|;|\bou\b)\s*/i).map((x) => x.trim()).filter(Boolean);

// One side (minimum or recommended) of Steam's requirements:
// { gpu: { text, score }, cpu: { text, score }, ram: { text, gb } }
function readRequirements(html) {
    const text = plain(html);
    if (!text.trim()) return null;
    const gpuText = field(text, "Graphics|Video Card|Video|GPU");
    const cpuText = field(text, "Processor|CPU");
    const ramText = field(text, "Memory|RAM");
    // any one of the cards or processors named will do: the slowest one recognised sets the bar
    const lowest = (list, score) => {
        const s = list.map(score).filter((x) => typeof x === "number");
        return s.length ? Math.min(...s) : null;
    };
    return {
        gpu: gpuText ? { text: gpuText, score: lowest(options(gpuText), gpuScore) } : null,
        cpu: cpuText ? { text: cpuText, score: lowest(options(cpuText), cpuScore) } : null,
        ram: ramText ? { text: ramText, gb: ramGb(ramText) } : null
    };
}

// How this PC does against one part: "great" (meets recommended), "ok"
// (meets minimum), "below", or "unknown"
function partState(mine, min, rec) {
    if (mine == null || (min == null && rec == null)) return "unknown";
    if (rec != null && mine >= rec * 0.9) return "great";
    if (min != null && mine >= min * 0.9) return "ok";
    if (min == null && rec != null) return mine >= rec * 0.6 ? "ok" : "below";
    return "below";
}

// The whole answer: { verdict, parts: [{id, yours, min, rec, state}], weakest }
function compare(pc, minimum, recommended) {
    const min = minimum || {}, rec = recommended || {};
    const ramRound = (gb) => (gb >= 1 ? `${Math.round(gb)} GB` : `${Math.round(gb * 1024)} MB`);
    const parts = [
        { id: "gpu", yours: pc.gpu && pc.gpu.name, mine: pc.gpu && pc.gpu.score, min: min.gpu, rec: rec.gpu, key: "score" },
        { id: "cpu", yours: pc.cpu && pc.cpu.name, mine: pc.cpu && pc.cpu.score, min: min.cpu, rec: rec.cpu, key: "score" },
        { id: "ram", yours: pc.ramGb ? ramRound(pc.ramGb) : null, mine: pc.ramGb, min: min.ram, rec: rec.ram, key: "gb" }
    ].filter((p) => p.min || p.rec).map((p) => {
        // memory: a 16 GB PC shows 15.8 GB, so round before comparing
        const mine = p.id === "ram" && p.mine ? Math.round(p.mine) : p.mine;
        const state = partState(mine, p.min && p.min[p.key], p.rec && p.rec[p.key]);
        return { id: p.id, yours: p.yours || null, min: p.min ? p.min.text : null, rec: p.rec ? p.rec.text : null, state };
    });
    if (!parts.length) return { verdict: null, parts };
    // the graphics card decides most games: without it, no verdict but "below" when something else is short
    const below = parts.find((p) => p.state === "below");
    const gpu = parts.find((p) => p.id === "gpu");
    let verdict;
    if (below) verdict = "below";
    else if (!gpu || gpu.state === "unknown") verdict = "unknown";
    else if (parts.every((p) => p.state === "great")) verdict = "great";
    else verdict = "ok";
    return { verdict, parts, weakest: below ? below.id : null };
}

// The name Chromium reports: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti SUPER (0x00002705) Direct3D11 vs_5_0 ps_5_0, D3D11)"
function gpuFromRenderer(s) {
    const m = /ANGLE \([^,]*,\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?\s+(?:Direct3D|OpenGL|Vulkan|Metal)/i.exec(String(s || ""));
    return m ? m[1].trim() : null;
}

module.exports = { gpuScore, cpuScore, ramGb, readRequirements, compare, partState, gpuFromRenderer, plain, options };
