// Riftgate 2 — the rift. A procedural portal drawn on canvas: a faceted gem,
// a turning ring of rune ticks, forked lightning that strikes, flickers and
// fades out in an afterglow,
// and drifting shards. Colours come from the theme tokens, so it follows the
// accent the user picks. Pauses off-screen / when the window is hidden; with
// reduced motion it paints one still frame.

const TAU = Math.PI * 2;

function cssColor(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}
// Riftgate's logo, shared by every rift on screen
const logo = new Image();
logo.src = new URL("../../assets/riftgate-gem-mark.png", import.meta.url).href;
let filterCache = { at: 0, v: "none" };
function logoFilter() {
    const now = performance.now();
    if (now - filterCache.at > 600) filterCache = { at: now, v: getComputedStyle(document.documentElement).getPropertyValue("--logo-filter").trim() || "none" };
    return filterCache.v;
}

// Alien glyphs for the rune ring: each is a few strokes joining points on a
// small 3×4 grid, sometimes with a ring, an arc or a dot. Made once.
const GLYPHS = (() => {
    let seed = 9071;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const P = (c, r) => [(c - 1) * .55, (r - 1.5) * .5];
    const out = [];
    for (let i = 0; i < 28; i++) {
        const g = [];
        if (rnd() < .55) g.push([P(1, 0), P(1, 3)]); // a spine
        const strokes = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < strokes; k++) {
            const pts = [];
            const n = 2 + Math.floor(rnd() * 2);
            for (let j = 0; j < n; j++) pts.push(P(Math.floor(rnd() * 3), Math.floor(rnd() * 4)));
            g.push(pts);
        }
        const extra = rnd();
        if (extra < .25) g.push({ arc: [0, -.55 + rnd() * .3, .32, 0, Math.PI * 2] });
        else if (extra < .5) g.push({ arc: [0, rnd() * .4, .38, Math.PI * (rnd() < .5 ? 0 : 1), Math.PI * (rnd() < .5 ? 1 : 2)] });
        if (rnd() < .45) g.push({ dot: P(Math.floor(rnd() * 3), rnd() < .5 ? 0 : 3) });
        out.push(g);
    }
    return out;
})();

function rgba(hex, a) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
    if (!m) return `rgba(139,61,255,${a})`;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

export class Rift {
    // opts: { cx: 0..1 horizontal centre, cy, scale, intensity }
    constructor(canvas, opts = {}) {
        this.c = canvas;
        this.ctx = canvas.getContext("2d");
        this.o = { cx: .74, cy: .5, scale: 1, intensity: 1, ...opts };
        this.bolts = [];
        this.shards = Array.from({ length: 26 }, () => this.newShard(true));
        this.t = 0;
        this.running = false;
        this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.resize = this.resize.bind(this);
        this.frame = this.frame.bind(this);
        this.ro = new ResizeObserver(this.resize);
        this.ro.observe(canvas);
        this.io = new IntersectionObserver(([e]) => { e.isIntersecting ? this.start() : this.stop(); });
        this.io.observe(canvas);
        this.onVis = () => (document.hidden ? this.stop() : this.start());
        document.addEventListener("visibilitychange", this.onVis);
        this.readColours();
        this.resize();
    }

    readColours() {
        this.col = { a: cssColor("--amethyst", "#8b3dff"), b: cssColor("--rift-pink", "#e03cff"), soft: cssColor("--amethyst-soft", "#b98cff") };
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const r = this.c.getBoundingClientRect();
        this.w = Math.max(1, r.width); this.hgt = Math.max(1, r.height);
        this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.hgt * dpr);
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.R = Math.min(this.hgt * .36, this.w * .2) * this.o.scale;
        if (this.reduced || !this.running) this.draw(0);
    }

    start() {
        if (this.running || this.reduced || document.hidden) return;
        this.running = true; this.last = performance.now();
        requestAnimationFrame(this.frame);
    }
    stop() { this.running = false; }
    destroy() { this.stop(); this.ro.disconnect(); this.io.disconnect(); document.removeEventListener("visibilitychange", this.onVis); }

    frame(now) {
        if (!this.running) return;
        const dt = Math.min(50, now - this.last); this.last = now;
        this.t += dt / 1000;
        this.draw(dt);
        requestAnimationFrame(this.frame);
    }

    newShard(anywhere) {
        const ang = Math.random() * TAU;
        const d = anywhere ? .6 + Math.random() * 2.4 : 2.6 + Math.random() * .6;
        return { ang, d, size: 2 + Math.random() * 6, spin: (Math.random() - .5) * 2, rot: Math.random() * TAU, speed: .05 + Math.random() * .12 };
    }

    // ---- Lightning ---------------------------------------------------------------
    // A real-looking strike: a fractal channel (midpoint displacement) with
    // forks and sub-forks. Each strike lives through a leader that races out,
    // a blinding return stroke, sometimes a re-strike or two (the flicker of
    // real lightning), then an afterglow that cools from white-hot to the
    // theme colour and fades out smoothly.
    static channel(x1, y1, x2, y2, rough, depth) {
        let pts = [[x1, y1], [x2, y2]];
        let off = Math.hypot(x2 - x1, y2 - y1) * rough;
        for (let d = 0; d < depth; d++) {
            const next = [pts[0]];
            for (let i = 0; i < pts.length - 1; i++) {
                const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
                const mx = (ax + bx) / 2, my = (ay + by) / 2;
                const nx = -(by - ay), ny = bx - ax, nl = Math.hypot(nx, ny) || 1;
                const o = (Math.random() * 2 - 1) * off;
                next.push([mx + nx / nl * o, my + ny / nl * o], pts[i + 1]);
            }
            pts = next;
            off *= .52;
        }
        return pts;
    }

    bolt(origin) {
        const R = this.R;
        const ang = origin != null ? origin + (Math.random() - .5) * .5 : Math.random() * TAU;
        const len = R * (2.1 + Math.random() * 2.3);
        const bend = (Math.random() - .5) * .9;
        // starts just inside the gem's edge, so the strike comes out of the logo
        const x1 = Math.cos(ang) * R * .58, y1 = Math.sin(ang) * R * .58;
        const x2 = Math.cos(ang + bend) * (R + len), y2 = Math.sin(ang + bend) * (R + len);
        const main = Rift.channel(x1, y1, x2, y2, .18, 7);
        // Dendritic branches, like real lightning: each channel sprouts
        // thinner, dimmer branches, which sprout their own, three levels deep.
        const branches = [];
        const sprout = (pts, level, startFrac, baseDir, baseLen) => {
            if (level > 3) return;
            const count = level === 1 ? 6 + Math.floor(Math.random() * 5) : level === 2 ? 1 + Math.floor(Math.random() * 3) : (Math.random() < .6 ? 1 + Math.floor(Math.random() * 2) : 0);
            for (let k = 0; k < count; k++) {
                const f = .08 + Math.random() * .75;
                const at = Math.floor(pts.length * f);
                const [bx, by] = pts[at];
                const dir = baseDir + (Math.random() < .5 ? -1 : 1) * (.3 + Math.random() * .8);
                const bl = baseLen * (.3 + Math.random() * .4) * (1 - f * .5);
                if (bl < R * .12) continue;
                const bp = Rift.channel(bx, by, bx + Math.cos(dir) * bl, by + Math.sin(dir) * bl, .24, level === 1 ? 6 : 5);
                const start = startFrac + (1 - startFrac) * f;
                branches.push({ pts: bp, start, w: [1, .5, .3, .18][level], dim: [1, .8, .62, .48][level] });
                sprout(bp, level + 1, start, dir, bl);
            }
        };
        sprout(main, 1, 0, Math.atan2(y2 - y1, x2 - x1), len);
        // Return strokes: the first, then sometimes one or two re-strikes
        const strikes = [.08];
        if (Math.random() < .55) strikes.push(.08 + .09 + Math.random() * .08);
        if (Math.random() < .25) strikes.push(strikes[strikes.length - 1] + .1 + Math.random() * .12);
        const last = strikes[strikes.length - 1];
        return { main, branches, strikes, age: 0, max: last + .8 + Math.random() * .5, ang };
    }

    // How bright a strike is at its age (0..1+): leader, flashes, afterglow
    static brightness(bo) {
        const t = bo.age;
        if (t < bo.strikes[0]) return .12 + .18 * (t / bo.strikes[0]);
        let b = 0;
        for (const s of bo.strikes) if (t >= s) b = Math.max(b, Math.exp(-(t - s) / .06) * (s === bo.strikes[0] ? 1.6 : 1.15));
        const glow = .5 * Math.exp(-(t - bo.strikes[0]) / .38);
        const tail = Math.max(0, 1 - Math.max(0, t - (bo.max - .35)) / .35); // smooth fade at the very end
        return (b + glow) * tail;
    }

    drawBolt(bo, dt) {
        const { ctx, R } = this;
        const { a, b, soft } = this.col;
        bo.age += (dt || 0) / 1000;
        const lit = Rift.brightness(bo);
        // the leader reveals the channel progressively; once struck it's whole
        const reveal = bo.age < bo.strikes[0] ? Math.max(.05, bo.age / bo.strikes[0]) : 1;
        const cool = Math.min(1, Math.max(0, (bo.age - bo.strikes[0]) / (bo.max - bo.strikes[0]))); // 0 white-hot -> 1 theme colour
        const scale = Math.max(.6, R / 150);
        // Three passes per channel (bloom, coloured glow, white-hot core),
        // drawn in sections that thin and dim toward the tip.
        const layers = (pts, upto, wf, dim) => {
            const n = Math.max(2, Math.floor(pts.length * upto));
            const parts = 3;
            for (let p = 0; p < parts; p++) {
                const from = Math.floor(n * p / parts), to = Math.min(n, Math.floor(n * (p + 1) / parts) + 1);
                if (to - from < 2) continue;
                const seg = pts.slice(from, to);
                const taper = 1 - p * .28;            // width
                const fade = dim * (1 - p * .22);     // brightness
                const w = wf * taper;
                ctx.beginPath();
                seg.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
                // wide soft bloom (cheap, no blur): the air glowing around the channel
                ctx.shadowBlur = 0;
                ctx.strokeStyle = rgba(b, Math.min(.5, .16 * lit) * fade);
                ctx.lineWidth = (26 + cool * 18) * scale * w;
                ctx.stroke();
                ctx.strokeStyle = rgba(a, Math.min(.6, .22 * lit) * fade);
                ctx.lineWidth = (11 + cool * 8) * scale * w;
                ctx.stroke();
                // coloured glow with a real blur; at the flash it blooms wide
                ctx.shadowColor = rgba(a, Math.min(1, lit) * fade);
                ctx.shadowBlur = (18 + 46 * Math.min(1.4, lit)) * scale * Math.max(.5, w);
                ctx.strokeStyle = rgba(cool > .5 ? a : soft, Math.min(1, .7 * lit) * fade);
                ctx.lineWidth = (3.4 + cool * 2.2) * scale * w;
                ctx.stroke();
                // white-hot core, cooling to the theme colour
                ctx.shadowBlur = 6 * scale * Math.min(1, lit);
                ctx.shadowColor = "#ffffff";
                ctx.strokeStyle = cool < .35 ? rgba("#ffffff", Math.min(1, lit * 1.25) * fade) : rgba(soft, Math.min(1, lit * .95) * fade);
                ctx.lineWidth = Math.max(.5, (1.4 + Math.min(1, lit) * 1.1 - cool * .8) * scale * w);
                ctx.stroke();
            }
        };
        layers(bo.main, reveal, 1, 1);
        bo.branches.forEach((br) => { if (reveal > br.start) layers(br.pts, Math.min(1, (reveal - br.start) / Math.max(.05, 1 - br.start) * 1.6), br.w, br.dim); });
        ctx.shadowBlur = 0;
        // the flash lights up the air along the strike
        if (lit > .45) {
            [.15, .45, .75].forEach((f) => {
                const [ox, oy] = bo.main[Math.floor(bo.main.length * f)];
                const rr = R * (1.3 + f);
                const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, rr);
                g.addColorStop(0, rgba(soft, Math.min(.45, .3 * (lit - .45))));
                g.addColorStop(.4, rgba(a, Math.min(.25, .14 * (lit - .45))));
                g.addColorStop(1, rgba(a, 0));
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(ox, oy, rr, 0, TAU); ctx.fill();
            });
        }
        return lit;
    }

    draw(dt) {
        const { ctx, w, hgt: H, R } = this;
        const cx = w * this.o.cx, cy = H * this.o.cy;
        const { a, b, soft } = this.col;
        const t = this.t;
        ctx.clearRect(0, 0, w, H);
        ctx.save();
        ctx.translate(cx, cy);

        // Halo
        const pulse = .85 + Math.sin(t * 1.3) * .08;
        let g = ctx.createRadialGradient(0, 0, R * .2, 0, 0, R * 2.6);
        g.addColorStop(0, rgba(a, .55 * this.o.intensity * pulse));
        g.addColorStop(.35, rgba(b, .16 * this.o.intensity));
        g.addColorStop(1, rgba(a, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, 0, R * 2.6, 0, TAU); ctx.fill();

        // Lightning: occasional strikes, sometimes two at once from nearby
        if (dt && this.bolts.length < 4 && Math.random() < .022 * this.o.intensity) {
            const first = this.bolt();
            this.bolts.push(first);
            if (Math.random() < .3) this.bolts.push(this.bolt(first.ang));
        }
        if (!dt && !this.bolts.length) for (let i = 0; i < 3; i++) { const bb = this.bolt(); bb.age = bb.strikes[0] + .12; this.bolts.push(bb); }
        ctx.globalCompositeOperation = "lighter";
        let flash = 0;
        this.bolts = this.bolts.filter((bo) => {
            if (bo.age >= bo.max) return false;
            flash = Math.max(flash, this.drawBolt(bo, dt));
            return true;
        });
        // a strike makes the whole portal glow brighter for a moment
        if (flash > .6) {
            const fg = ctx.createRadialGradient(0, 0, R * .3, 0, 0, R * 2.4);
            fg.addColorStop(0, rgba(a, Math.min(.35, .3 * (flash - .6))));
            fg.addColorStop(1, rgba(b, 0));
            ctx.fillStyle = fg;
            ctx.beginPath(); ctx.arc(0, 0, R * 2.4, 0, TAU); ctx.fill();
        }

        // Rune ring
        ctx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.rotate(t * .08);
        ctx.strokeStyle = rgba(soft, .45);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, R * 1.32, 0, TAU); ctx.stroke();
        ctx.strokeStyle = rgba(a, .35);
        ctx.beginPath(); ctx.arc(0, 0, R * 1.18, 0, TAU); ctx.stroke();
        // A band of alien glyphs between the two circles, slowly lit in turn
        const gs = R * .095;
        GLYPHS.forEach((g, i) => {
            const ang = i / GLYPHS.length * TAU;
            const lit = .45 + .55 * Math.max(0, Math.sin(t * 1.1 - i * .55));
            ctx.save();
            ctx.rotate(ang);
            ctx.translate(0, -R * 1.25);
            ctx.strokeStyle = rgba(lit > .8 ? soft : a, .35 + .55 * lit);
            ctx.fillStyle = ctx.strokeStyle;
            ctx.lineWidth = Math.max(1, R * .011);
            ctx.lineCap = "round"; ctx.lineJoin = "round";
            ctx.shadowColor = rgba(a, .9 * lit); ctx.shadowBlur = 8 * lit;
            ctx.beginPath();
            g.forEach((st) => {
                if (st.dot) { ctx.moveTo(st.dot[0] * gs + gs * .09, st.dot[1] * gs); ctx.arc(st.dot[0] * gs, st.dot[1] * gs, gs * .09, 0, TAU); }
                else if (st.arc) { const [cx, cy, r0, a0, a1] = st.arc; ctx.moveTo(cx * gs + Math.cos(a0) * r0 * gs, cy * gs + Math.sin(a0) * r0 * gs); ctx.arc(cx * gs, cy * gs, r0 * gs, a0, a1); }
                else { ctx.moveTo(st[0][0] * gs, st[0][1] * gs); st.slice(1).forEach(([x, y]) => ctx.lineTo(x * gs, y * gs)); }
            });
            ctx.stroke();
            ctx.restore();
        });
        ctx.shadowBlur = 0;
        ctx.restore();

        // The gem: Riftgate's own logo (assets/riftgate-gem-mark.png), tinted to
        // the theme's accent; a drawn crystal stands in until it has loaded.
        const gr = R * .78;
        const core = [0, gr * .08];
        if (logo.complete && logo.naturalWidth) {
            const hgt = gr * 2.05, wid = hgt * logo.naturalWidth / logo.naturalHeight;
            ctx.save();
            ctx.filter = logoFilter();
            ctx.globalAlpha = .96;
            ctx.drawImage(logo, -wid / 2, -hgt / 2 + core[1] * .4, wid, hgt);
            ctx.restore();
        } else {
            const hex = Array.from({ length: 6 }, (_, i) => { const an = -Math.PI / 2 + i * TAU / 6; return [Math.cos(an) * gr, Math.sin(an) * gr]; });
            const facet = (p1, p2, light) => {
                const fg = ctx.createLinearGradient(p1[0], p1[1], p2[0], p2[1]);
                fg.addColorStop(0, rgba(light > .5 ? soft : a, .55 + light * .4));
                fg.addColorStop(1, rgba(light > .5 ? a : "#2a0f5c", .65 + light * .3));
                ctx.fillStyle = fg;
                ctx.beginPath(); ctx.moveTo(core[0], core[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = rgba("#ffffff", .18 + light * .25); ctx.lineWidth = 1; ctx.stroke();
            };
            const lights = [.95, .6, .25, .1, .3, .75];
            const glint = (Math.sin(t * .9) + 1) / 2;
            for (let i = 0; i < 6; i++) facet(hex[i], hex[(i + 1) % 6], Math.min(1, lights[i] + (i === Math.floor(t * .5) % 6 ? glint * .3 : 0)));
            ctx.strokeStyle = rgba(soft, .9); ctx.lineWidth = 1.5;
            ctx.beginPath(); hex.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
        }
        // inner glow
        g = ctx.createRadialGradient(core[0], core[1], 0, core[0], core[1], gr * .7);
        g.addColorStop(0, rgba("#ffffff", .35 * pulse)); g.addColorStop(1, rgba(a, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(core[0], core[1], gr * .7, 0, TAU); ctx.fill();

        // Shards drifting inward
        ctx.globalCompositeOperation = "lighter";
        this.shards.forEach((s, i) => {
            if (dt) { s.d -= s.speed * dt / 1000; s.rot += s.spin * dt / 1000; s.ang += .05 * dt / 1000; }
            if (s.d < 1.15) this.shards[i] = s = this.newShard(false);
            const x = Math.cos(s.ang) * R * s.d, y = Math.sin(s.ang) * R * s.d * .8;
            const alpha = Math.min(1, (3.2 - s.d) / 1.2) * .7;
            ctx.save(); ctx.translate(x, y); ctx.rotate(s.rot);
            ctx.fillStyle = rgba(soft, alpha * .8);
            ctx.beginPath(); ctx.moveTo(0, -s.size); ctx.lineTo(s.size * .55, 0); ctx.lineTo(0, s.size * 1.3); ctx.lineTo(-s.size * .55, 0); ctx.closePath(); ctx.fill();
            ctx.restore();
        });
        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
    }
}
