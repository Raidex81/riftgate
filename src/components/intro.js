// Riftgate — the opening: the rift tears open, the rune rings draw themselves,
// the gem rises out of the tear, lightning strikes from it, the name decodes
// from alien script, and the rift opens wide onto your Nexus.
//
// Same length as Riftgate 1.x's (5.5 s, then a 0.55 s fade). Plays on a real
// start only (not on Ctrl+R), never with reduced motion, and not when it's
// turned off in Settings (the same "startupAnimation" setting as 1.x). Any
// click, key or controller button skips straight to the opening of the rift.
// Everything is drawn on one canvas in the theme's colours, while the app
// loads underneath.

import { Rift } from "./rift.js";

const LENGTH = 5.5, FADE = 0.55;
const TAU = Math.PI * 2;
const ease = {
    out: (t) => 1 - Math.pow(1 - t, 3),
    inOut: (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    expo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// progress of a segment [a, b] at time t, eased
const seg = (t, a, b, e = ease.out) => e(clamp01((t - a) / (b - a)));
function rgba(hex, a) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
    return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})` : `rgba(139,61,255,${a})`;
}
const SCRIPT = "ᚱᛁᚠᛏᚷᚨᛖᛟᛞᚹᛉᛜ⟁⌖◇⟐⧫";

let resolveDone;
export const done = new Promise((r) => { resolveDone = r; });

export function playIntro({ enabled = true } = {}) {
    const el = document.getElementById("intro");
    const finish = () => { if (el) el.remove(); document.documentElement.classList.remove("intro-on"); resolveDone(); };
    let played = false;
    try { played = sessionStorage.getItem("r2-intro") === "1"; sessionStorage.setItem("r2-intro", "1"); } catch (e) { /* no storage */ }
    if (!el || !enabled || played || matchMedia("(prefers-reduced-motion: reduce)").matches) { finish(); return done; }

    const canvas = el.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    // A Rift that never runs on its own: it lends its rings, its gem and its lightning
    const scratch = document.createElement("canvas");
    const rift = new Rift(scratch, {});
    rift.stop();
    const col = rift.col;
    const voidCol = getComputedStyle(document.documentElement).getPropertyValue("--void").trim() || "#07040d";

    let W = 0, H = 0, dpr = 1, R = 100, cx = 0, cy = 0;
    const size = () => {
        dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        R = Math.min(H * .2, W * .15);
        cx = W / 2; cy = H * .43;
    };
    size();
    window.addEventListener("resize", size);

    // stars that rush toward the rift at first, then settle
    const stars = Array.from({ length: 260 }, () => ({ a: Math.random() * TAU, d: .15 + Math.random() * 1.1, z: .2 + Math.random() * .8, tw: Math.random() * TAU }));
    // crystal shards that sweep in once the rift is open
    const shards = Array.from({ length: 34 }, (_, i) => ({ a: (i / 34) * TAU + Math.random() * .3, d0: 2.6 + Math.random() * 1.6, s: 3 + Math.random() * 7, spin: (Math.random() - .5) * 6, delay: Math.random() * .6 }));
    // sparks thrown off the tear
    const sparks = [];
    const bolts = [];
    const strikesAt = [3.02, 3.16, 3.38, 3.9, 4.45];
    let nextStrike = 0, flash = 0;
    const letters = "RIFTGATE".split("").map((ch, i) => ({ ch, settle: 3.75 + i * .085 }));

    let skipAt = null;
    const skip = () => { if (skipAt === null) skipAt = now(); };
    const t0 = performance.now();
    // (window.__introT freezes time, for checking single frames)
    const now = () => (typeof window.__introT === "number" ? window.__introT : (performance.now() - t0) / 1000);
    const onSkip = (e) => { if (e.type === "keydown" && ["Shift", "Control", "Alt", "Meta"].includes(e.key)) return; skip(); };
    window.addEventListener("pointerdown", onSkip, true);
    window.addEventListener("keydown", onSkip, true);
    let padTimer = setInterval(() => { for (const p of navigator.getGamepads ? navigator.getGamepads() : []) if (p && p.buttons.some((b) => b.pressed)) skip(); }, 120);

    // On a skip, time jumps to the opening of the rift
    const OPEN = 4.95;
    let shift = 0;
    let last = 0;

    function frame() {
        let t = now() + shift;
        if (skipAt !== null && t < OPEN) { shift += OPEN - t; t = OPEN; skipAt = Infinity; }
        const dt = Math.min(.05, Math.max(0, t - last)); last = t;
        draw(t, dt);
        // the canvas paints the dark itself from now on, so the opening rift can show the app through it
        if (el.style.background !== "transparent") el.style.background = "transparent";
        if (t < LENGTH) { requestAnimationFrame(frame); return; }
        // the fade: the canvas has already opened onto the app; ease the rest away
        el.classList.add("intro-out");
        window.removeEventListener("pointerdown", onSkip, true);
        window.removeEventListener("keydown", onSkip, true);
        clearInterval(padTimer);
        window.removeEventListener("resize", size);
        setTimeout(() => { rift.destroy(); finish(); }, FADE * 1000);
    }

    function draw(t, dt) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.fillStyle = voidCol; ctx.fillRect(0, 0, W, H);
        const a = col.a, b = col.b, soft = col.soft;

        // ---- nebula wash, swelling as the rift opens
        const wash = seg(t, .8, 2.6);
        let g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * .75);
        g.addColorStop(0, rgba(a, .35 * wash)); g.addColorStop(.35, rgba(b, .12 * wash)); g.addColorStop(1, rgba(a, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

        // ---- stars: a rush toward the centre (0 - 1.6 s), then a slow drift
        const rush = 1 - seg(t, 0, 1.6, ease.inOut);
        ctx.lineCap = "round";
        stars.forEach((s) => {
            s.d -= dt * (rush * 1.4 + .02) * s.z;
            if (s.d < .05) { s.d = 1.25; s.a = Math.random() * TAU; }
            const r1 = s.d * Math.max(W, H) * .7, r0 = r1 * (1 + rush * .18 * s.z);
            const x1 = cx + Math.cos(s.a) * r1, y1 = cy + Math.sin(s.a) * r1;
            const x0 = cx + Math.cos(s.a) * r0, y0 = cy + Math.sin(s.a) * r0;
            const tw = .55 + .45 * Math.sin(t * 3 + s.tw);
            ctx.strokeStyle = rgba(rush > .05 ? soft : "#ffffff", Math.min(1, .25 + s.z * .6) * tw * Math.min(1, t * 2));
            ctx.lineWidth = s.z * 1.6;
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        });

        ctx.save();
        ctx.translate(cx, cy);

        // ---- the seed of light: appears, beats twice (0.2 - 1.0 s)
        const seed = seg(t, .2, .6) * (1 - seg(t, 1.9, 2.5));
        const beat = Math.max(0, Math.sin(clamp01((t - .45) / .55) * Math.PI * 2)) * .6;
        if (seed > 0) {
            const sr = R * (.05 + .12 * beat + .15 * seg(t, .9, 1.6));
            g = ctx.createRadialGradient(0, 0, 0, 0, 0, sr * 4);
            g.addColorStop(0, rgba("#ffffff", .95 * seed)); g.addColorStop(.2, rgba(soft, .75 * seed)); g.addColorStop(1, rgba(a, 0));
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, sr * 4, 0, TAU); ctx.fill();
        }

        // ---- the tear: a jagged vertical slit of light (0.9 - 2.6 s), widening into an eye
        const tear = seg(t, .9, 1.5, ease.expo) * (1 - seg(t, 2.5, 3.1));
        if (tear > 0) {
            const len = R * 1.45 * tear, wide = R * (.035 + .5 * seg(t, 2.05, 2.6, ease.inOut));
            const pts = [];
            for (let i = 0; i <= 24; i++) {
                const f = i / 24, y = -len + 2 * len * f;
                const jag = (Math.sin(f * 37 + t * 40) + Math.sin(f * 13 - t * 23)) * R * .02 * (1 - Math.abs(f - .5) * 1.6);
                pts.push([jag, y, Math.sin(f * Math.PI)]);
            }
            ctx.globalCompositeOperation = "lighter";
            for (const [w, al, c] of [[wide * 3.2, .18, a], [wide * 1.6, .35, b], [wide * .55, .9, "#ffffff"]]) {
                ctx.fillStyle = rgba(c, al * tear);
                ctx.beginPath();
                pts.forEach(([x, y, s], i) => (i ? ctx.lineTo(x + w * s, y) : ctx.moveTo(x + w * s, y)));
                for (let i = pts.length - 1; i >= 0; i--) { const [x, y, s] = pts[i]; ctx.lineTo(x - w * s, y); }
                ctx.closePath(); ctx.fill();
            }
            // sparks thrown sideways from the tear
            if (t < 2.6 && Math.random() < .9) for (let k = 0; k < 3; k++) {
                const y = (Math.random() * 2 - 1) * len * .9;
                sparks.push({ x: 0, y, vx: (Math.random() < .5 ? -1 : 1) * (60 + Math.random() * 220), vy: (Math.random() - .5) * 120, life: .5 + Math.random() * .5, age: 0 });
            }
        }
        ctx.globalCompositeOperation = "lighter";
        for (let i = sparks.length - 1; i >= 0; i--) {
            const p = sparks[i]; p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt;
            if (p.age > p.life) { sparks.splice(i, 1); continue; }
            const al = 1 - p.age / p.life;
            ctx.strokeStyle = rgba(al > .6 ? "#ffffff" : soft, al);
            ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * .025, p.y - p.vy * .025); ctx.stroke();
        }

        // ---- rune rings: the three lines trace themselves (1.4 - 2.4 s), glyphs ignite as the line passes
        const ring = rift.ringSprites(R, a, soft);
        const draw0 = seg(t, 1.4, 2.4, ease.inOut);
        const settle = seg(t, 2.3, 2.9);
        const openK = seg(t, OPEN, LENGTH, ease.inOut);
        if (draw0 > 0) {
            const spinIn = Math.max(0, t - 2.4);
            const rings = [[R * 1.12, 1, 0], [R * 1.3, -1, .12], [R * 1.53, 1, .24]];
            ctx.globalCompositeOperation = "source-over";
            ctx.save();
            ctx.scale(1 + openK * .9, 1 + openK * .9);
            ctx.globalAlpha = 1 - openK;
            // the finished, turning rings fade in over the traced lines
            if (settle > 0) {
                ctx.globalAlpha = settle * (1 - openK);
                ctx.drawImage(ring.lines, -ring.lh, -ring.lh, ring.lh * 2, ring.lh * 2);
                for (const [band, speed] of [[ring.inner, .08], [ring.outer, -.12]]) {
                    ctx.save(); ctx.rotate(spinIn * speed * 6 * (1 - seg(t, 2.4, 3.6)) + spinIn * speed);
                    ctx.drawImage(band.base, -band.half, -band.half, band.half * 2, band.half * 2);
                    ctx.restore();
                }
            }
            // the tracing heads
            ctx.globalAlpha = 1 - openK;
            ctx.globalCompositeOperation = "lighter";
            ctx.shadowColor = rgba(a, .9); ctx.shadowBlur = 12;
            rings.forEach(([rr, dir, delay]) => {
                const p = clamp01((draw0 - delay) / (1 - delay));
                if (p <= 0) return;
                const start = -Math.PI / 2;
                ctx.strokeStyle = rgba(soft, .9 * (1 - settle * .6));
                ctx.lineWidth = Math.max(2, R * .03);
                ctx.beginPath(); ctx.arc(0, 0, rr, start, start + dir * p * TAU, dir < 0); ctx.stroke();
                if (p < 1) {
                    const ang = start + dir * p * TAU;
                    g = ctx.createRadialGradient(Math.cos(ang) * rr, Math.sin(ang) * rr, 0, Math.cos(ang) * rr, Math.sin(ang) * rr, R * .14);
                    g.addColorStop(0, rgba("#ffffff", .95)); g.addColorStop(1, rgba(b, 0));
                    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, R * .14, 0, TAU); ctx.fill();
                }
            });
            ctx.shadowBlur = 0;
            // glyphs ignite as their line reaches them
            for (const [band, delay, dir] of [[ring.inner, 0, 1], [ring.outer, .24, 1]]) {
                const p = clamp01((draw0 - delay) / (1 - delay));
                band.lit.forEach((sp, i) => {
                    const at = i / band.count;
                    const since = p - at;
                    if (since < 0) return;
                    const lit = Math.max(0, 1 - since * 2.2) * (1 - settle * .7) + .25 * Math.max(0, Math.sin(t * 2.2 - i * .6)) * settle;
                    if (lit < .04) return;
                    ctx.save(); ctx.rotate(at * TAU * dir); ctx.translate(0, -band.radius);
                    ctx.globalAlpha = Math.min(1, lit) * (1 - openK);
                    ctx.drawImage(sp.c, -sp.half, -sp.half, sp.half * 2, sp.half * 2);
                    ctx.restore();
                });
            }
            ctx.restore();
        }

        // ---- shockwave when the gem bursts through (2.55 s)
        const wave = seg(t, 2.55, 3.4);
        if (wave > 0 && wave < 1) {
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = 1;
            ctx.strokeStyle = rgba(soft, .55 * (1 - wave));
            ctx.lineWidth = R * .08 * (1 - wave) + 1;
            ctx.beginPath(); ctx.arc(0, 0, R * (.5 + wave * 3.4), 0, TAU); ctx.stroke();
            ctx.strokeStyle = rgba(b, .35 * (1 - wave));
            ctx.lineWidth = R * .2 * (1 - wave) + 1;
            ctx.beginPath(); ctx.arc(0, 0, R * (.4 + wave * 2.6), 0, TAU); ctx.stroke();
        }

        // ---- shards sweeping in (2.0 - 3.4 s)
        ctx.globalCompositeOperation = "lighter";
        shards.forEach((s) => {
            const p = seg(t, 2.0 + s.delay, 3.0 + s.delay, ease.inOut);
            if (p <= 0 || p >= 1) return;
            const d = (s.d0 - (s.d0 - .7) * p) * R, ang = s.a + p * .9;
            ctx.save(); ctx.translate(Math.cos(ang) * d, Math.sin(ang) * d); ctx.rotate(s.spin * p);
            ctx.globalAlpha = Math.sin(p * Math.PI) * (1 - openK);
            ctx.fillStyle = rgba(soft, .9);
            ctx.beginPath(); ctx.moveTo(0, -s.s); ctx.lineTo(s.s * .55, 0); ctx.lineTo(0, s.s * 1.3); ctx.lineTo(-s.s * .55, 0); ctx.closePath(); ctx.fill();
            ctx.restore();
        });

        // ---- the gem rises out of the tear (2.25 - 3.0 s), glints, breathes
        const gemIn = seg(t, 2.25, 3.0, ease.back);
        if (gemIn > 0) {
            const gr = R * .78;
            const sprite = rift.logoSprite(gr);
            const sc = gemIn * (1 + openK * 1.6) * (1 + .02 * Math.sin(t * 3));
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = clamp01(gemIn * 1.4) * (1 - openK);
            // halo under the gem
            g = ctx.createRadialGradient(0, 0, 0, 0, 0, gr * 1.5 * sc);
            g.addColorStop(0, rgba(a, .55)); g.addColorStop(1, rgba(a, 0));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, gr * 1.5 * sc, 0, TAU); ctx.fill();
            ctx.save(); ctx.scale(sc, sc); ctx.rotate((1 - gemIn) * -.6);
            if (sprite) ctx.drawImage(sprite.c, -sprite.w / 2, -sprite.h / 2 + gr * .03, sprite.w, sprite.h);
            ctx.restore();
            // a glint crossing the gem
            const gl = seg(t, 3.0, 3.5);
            if (gl > 0 && gl < 1) {
                ctx.save();
                ctx.beginPath(); ctx.arc(0, 0, gr * .95 * sc, 0, TAU); ctx.clip();
                ctx.globalCompositeOperation = "lighter";
                const gx = (-1 + gl * 2) * gr * 1.4;
                g = ctx.createLinearGradient(gx - gr * .3, -gr, gx + gr * .3, gr);
                g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.5, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
                ctx.fillStyle = g; ctx.fillRect(-gr * 2, -gr * 2, gr * 4, gr * 4);
                ctx.restore();
            }
        }

        // ---- lightning from the gem (3.0 - 4.6 s)
        rift.ctx = ctx; rift.R = R;
        while (nextStrike < strikesAt.length && t >= strikesAt[nextStrike]) {
            const bo = rift.bolt(nextStrike === 1 ? bolts[0] && bolts[0].ang + Math.PI : null);
            bolts.push(bo);
            if (nextStrike === 0) flash = 1;
            nextStrike++;
        }
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1 - openK;
        for (let i = bolts.length - 1; i >= 0; i--) {
            const bo = bolts[i];
            if (bo.age >= bo.max) { bolts.splice(i, 1); continue; }
            rift.drawBolt(bo, dt * 1000);
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        // ---- the name decodes from alien script (3.6 - 4.5 s), the tagline follows
        const nameY = cy + R * 1.95;
        const nameIn = seg(t, 3.55, 3.9);
        if (nameIn > 0) {
            const size = Math.max(26, Math.min(R * .48, W / 12));
            ctx.save();
            ctx.globalAlpha = nameIn * (1 - openK);
            ctx.font = `700 ${size}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-display") || "sans-serif"}`;
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            const spacing = size * (.42 - .12 * seg(t, 3.6, 4.6));
            const widths = letters.map((l) => ctx.measureText(l.ch).width);
            const total = widths.reduce((s, w) => s + w, 0) + spacing * (letters.length - 1);
            let x = cx - total / 2;
            g = ctx.createLinearGradient(cx - total / 2, 0, cx + total / 2, 0);
            g.addColorStop(0, soft); g.addColorStop(.5, "#ffffff"); g.addColorStop(1, soft);
            letters.forEach((l, i) => {
                const settled = t >= l.settle;
                const ch = settled ? l.ch : SCRIPT[Math.floor((t * 22 + i * 7) % SCRIPT.length)];
                ctx.shadowColor = rgba(settled ? b : a, .9); ctx.shadowBlur = settled ? 18 * (1 - seg(t, l.settle, l.settle + .5)) + 6 : 10;
                ctx.fillStyle = settled ? g : rgba(soft, .7);
                ctx.fillText(ch, x + widths[i] / 2, nameY);
                x += widths[i] + spacing;
            });
            ctx.shadowBlur = 0;
            // tagline + an underline that sweeps out from the centre
            const tag = seg(t, 4.35, 4.85);
            if (tag > 0) {
                const ts = Math.max(12, size * .3);
                ctx.font = `600 ${ts}px ${getComputedStyle(document.body).fontFamily || "sans-serif"}`;
                ctx.fillStyle = rgba("#ffffff", .8 * tag);
                ctx.fillText("ALL YOUR WORLDS. ONE GATEWAY.".split("").join(String.fromCharCode(8202)), cx, nameY + size * .85);
                const uw = total * .6 * tag;
                g = ctx.createLinearGradient(cx - uw / 2, 0, cx + uw / 2, 0);
                g.addColorStop(0, rgba(a, 0)); g.addColorStop(.5, rgba(b, 1)); g.addColorStop(1, rgba(a, 0));
                ctx.fillStyle = g; ctx.fillRect(cx - uw / 2, nameY + size * .55, uw, 2);
            }
            ctx.restore();
        }

        // ---- the first strike lights the whole sky
        if (flash > 0) {
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = rgba(soft, .28 * flash); ctx.fillRect(0, 0, W, H);
            flash = Math.max(0, flash - dt * 3.2);
        }

        // ---- the rift opens onto the app: a widening hole from the gem outwards
        if (openK > 0) {
            ctx.globalCompositeOperation = "destination-out";
            const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) * 1.15;
            const r = far * openK;
            g = ctx.createRadialGradient(cx, cy, Math.max(0, r - R * 1.2), cx, cy, r + 1);
            g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
            // the rim of the opening glows
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = rgba(soft, .5 * (1 - openK));
            ctx.lineWidth = R * .12;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
        }
    }

    requestAnimationFrame(frame);
    return done;
}
