// Riftgate 2 — the rift. A procedural portal drawn on canvas: a faceted gem,
// a turning ring of rune ticks, lightning tendrils that fork, flare and fade,
// and drifting shards. Colours come from the theme tokens, so it follows the
// accent the user picks. Pauses off-screen / when the window is hidden; with
// reduced motion it paints one still frame.

const TAU = Math.PI * 2;

function cssColor(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}
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

    bolt() {
        // A tendril from the portal's rim outward, jagged, with forks.
        const ang = Math.random() * TAU;
        const len = this.R * (1.6 + Math.random() * 2.6);
        const pts = [];
        let x = Math.cos(ang) * this.R * 1.02, y = Math.sin(ang) * this.R * 1.02;
        const steps = 14 + Math.floor(Math.random() * 10);
        let a = ang;
        for (let i = 0; i < steps; i++) {
            pts.push([x, y]);
            a += (Math.random() - .5) * .7;
            const s = len / steps;
            x += Math.cos(a) * s; y += Math.sin(a) * s;
        }
        const forks = [];
        if (Math.random() < .7) {
            const at = 3 + Math.floor(Math.random() * (steps - 6));
            let [fx, fy] = pts[at]; let fa = a + (Math.random() < .5 ? -1 : 1) * (.6 + Math.random() * .6);
            const fp = [[fx, fy]];
            for (let i = 0; i < 6; i++) { fa += (Math.random() - .5) * .8; fx += Math.cos(fa) * len / steps; fy += Math.sin(fa) * len / steps; fp.push([fx, fy]); }
            forks.push(fp);
        }
        return { pts, forks, life: 0, max: .5 + Math.random() * .9 };
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

        // Lightning
        if (dt && Math.random() < .12 * this.o.intensity && this.bolts.length < 9) this.bolts.push(this.bolt());
        if (!dt && !this.bolts.length) for (let i = 0; i < 6; i++) { const bb = this.bolt(); bb.life = bb.max * .3; this.bolts.push(bb); }
        ctx.globalCompositeOperation = "lighter";
        this.bolts = this.bolts.filter((bo) => {
            bo.life += (dt || 0) / 1000;
            const k = 1 - bo.life / bo.max;
            if (k <= 0) return false;
            const flick = .6 + Math.random() * .4;
            const stroke = (pts, width, alpha, col) => {
                ctx.strokeStyle = rgba(col, alpha * k * flick);
                ctx.lineWidth = width;
                ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
            };
            stroke(bo.pts, 7, .12, b);
            stroke(bo.pts, 2.4, .55, a);
            stroke(bo.pts, .9, .95, "#ffffff");
            bo.forks.forEach((f) => { stroke(f, 4, .1, b); stroke(f, 1.2, .6, soft); });
            return true;
        });

        // Rune ring
        ctx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.rotate(t * .08);
        ctx.strokeStyle = rgba(soft, .45);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, R * 1.32, 0, TAU); ctx.stroke();
        ctx.strokeStyle = rgba(a, .35);
        ctx.beginPath(); ctx.arc(0, 0, R * 1.18, 0, TAU); ctx.stroke();
        for (let i = 0; i < 48; i++) {
            const ang = i / 48 * TAU;
            const long = i % 4 === 0;
            ctx.strokeStyle = rgba(long ? soft : a, long ? .7 : .35);
            ctx.lineWidth = long ? 1.6 : 1;
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * R * 1.19, Math.sin(ang) * R * 1.19);
            ctx.lineTo(Math.cos(ang) * R * (long ? 1.31 : 1.25), Math.sin(ang) * R * (long ? 1.31 : 1.25));
            ctx.stroke();
        }
        ctx.restore();

        // The gem: a hexagonal crystal seen from the front, lit from the top-left
        const gr = R * .78;
        const hex = Array.from({ length: 6 }, (_, i) => { const an = -Math.PI / 2 + i * TAU / 6; return [Math.cos(an) * gr, Math.sin(an) * gr]; });
        const core = [0, gr * .08];
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
