// Riftgate — the opening's sound. Everything is synthesised live with Web
// Audio (no sound files): a rising rush as the stars pour in, two heartbeats
// of the seed, the tear ripping open with sparks crackling off it, chimes as
// the rune rings draw themselves, a breath in, then the gem bursting through
// with a deep boom and a crystal chord. Every bolt of lightning cracks and
// sizzles at the very frame it strikes, rolling into thunder; the name
// decodes in blips; the rift opens with a wide whoosh and a bloom of light.
//
// intro.js calls the cues as the picture reaches them, so sound and image
// can't drift apart. render() schedules the whole thing ahead instead (used
// to preview it offline).

// When the rift opens onto the app: the name has fully appeared at 4.85 s,
// and stays two more seconds so it can be read
export const OPEN_AT = 6.85;
export const STRIKES = [3.02, 3.16, 3.38, 3.9, 4.45];

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

// prebuild: build the heavy sounds (the hall's echo, the arc, every strike)
// ahead of time, a few milliseconds at a time while the page is idle, so
// nothing is computed on the frame a bolt strikes (that froze the opening
// for a tenth of a second right as the lightning began).
export function createIntroSound(ac, { volume = 0.7, prebuild = false, season = null } = {}) {
    // ---- work done in slices while the page is idle ----
    const jobs = [];
    const job = (gen) => { const j = { gen, done: false, value: null }; jobs.push(j); return j; };
    const finish = (j) => { while (!j.done) { const r = j.gen.next(); if (r.done) { j.done = true; j.value = r.value; } } const i = jobs.indexOf(j); if (i >= 0) jobs.splice(i, 1); return j.value; };
    let pumping = false;
    const pump = (deadline) => {
        const end = performance.now() + Math.min(4, Math.max(2, deadline && deadline.timeRemaining ? deadline.timeRemaining() : 3));
        while (jobs.length && performance.now() < end) { const j = jobs[0]; const r = j.gen.next(); if (r.done) { j.done = true; j.value = r.value; jobs.shift(); } }
        pumping = false; schedule();
    };
    const schedule = () => {
        if (pumping || !jobs.length) return;
        pumping = true;
        if (window.requestIdleCallback) requestIdleCallback(pump, { timeout: 50 }); else setTimeout(pump, 16);
    };

    const out = ac.createDynamicsCompressor();
    out.threshold.value = -14; out.knee.value = 12; out.ratio.value = 4; out.attack.value = .003; out.release.value = .25;
    const master = ac.createGain(); master.gain.value = volume;
    master.connect(out); out.connect(ac.destination);

    // everything up to the opening of the rift goes through `pre`, so a skip can silence it at once
    const pre = ac.createGain(); pre.connect(master);
    const post = ac.createGain(); post.connect(master);

    // a big, dark hall for the boom, the chord and the thunder
    const verb = ac.createConvolver();
    const hall = job((function* () {
        const len = Math.floor(ac.sampleRate * 3.2), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = ir.getChannelData(ch);
            for (let i = 0; i < len; i++) { const x = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 2.6) * (x < .01 ? x / .01 : 1); if ((i & 16383) === 16383) yield; }
        }
        verb.buffer = ir;
    })());
    // only the body of a sound goes into the hall, so the tail rumbles instead of hissing
    const verbIn = ac.createGain(); verbIn.gain.value = .55;
    const verbLp = ac.createBiquadFilter(); verbLp.type = "lowpass"; verbLp.frequency.value = 2200;
    verbIn.connect(verbLp); verbLp.connect(verb);
    const verbOut = ac.createGain(); verbOut.gain.value = .9;
    verb.connect(verbOut); verbOut.connect(master);

    const noise = (() => {
        const b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return b;
    })();

    // ---- small builders ----
    const gain = (v, dest) => { const g = ac.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; };
    const pan = (p, dest) => { if (!ac.createStereoPanner) return dest; const s = ac.createStereoPanner(); s.pan.value = p; s.connect(dest); return s; };
    function noiseSrc(at, dur) {
        const s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
        s.start(at, Math.random() * 1.5); s.stop(at + dur + .05);
        return s;
    }
    function filter(type, f, q = 1) { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
    // attack / hold / exponential release envelope on a gain param
    function env(p, at, peak, a, d, hold = 0) {
        p.cancelScheduledValues(at);
        p.setValueAtTime(0.0001, at);
        p.linearRampToValueAtTime(peak, at + a);
        if (hold) p.setValueAtTime(peak, at + a + hold);
        p.exponentialRampToValueAtTime(0.0001, at + a + hold + d);
    }
    function tone(type, f, at, peak, a, d, dest, f2) {
        const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, at);
        if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + a + d);
        const g = gain(0, dest); env(g.gain, at, peak, a, d);
        o.connect(g); o.start(at); o.stop(at + a + d + .05);
        return o;
    }
    // a struck bell: fundamental + inharmonic partials
    function bell(f, at, peak, d, dest) {
        [[1, 1], [2.76, .35], [5.4, .12]].forEach(([m, k]) => tone("sine", f * m, at, peak * k, .004, d / m ** .4, dest));
    }

    // ---- the cues ----
    const cues = {
        // 0 - 1.8 s: the stars rush in; a sub drone rises under everything until the rift opens
        rush(at) {
            const n = noiseSrc(at, 2);
            const bp = filter("bandpass", 260, 1.1);
            bp.frequency.setValueAtTime(260, at); bp.frequency.exponentialRampToValueAtTime(2600, at + 1.5);
            const g = gain(0, pan(0, pre)); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(.5, at + 1.2); g.gain.exponentialRampToValueAtTime(.0001, at + 1.95);
            n.connect(bp); bp.connect(g);
            // the drone: two detuned low sines and a slow wobble
            [41.2, 41.7, 82.4].forEach((f, i) => {
                const o = ac.createOscillator(); o.type = i === 2 ? "triangle" : "sine"; o.frequency.value = f;
                const dg = gain(0, pre);
                dg.gain.setValueAtTime(0.0001, at);
                dg.gain.exponentialRampToValueAtTime(i === 2 ? .04 : .16, at + 2.4);
                dg.gain.setValueAtTime(i === 2 ? .04 : .16, at + OPEN_AT - .25);
                dg.gain.exponentialRampToValueAtTime(0.0001, at + OPEN_AT + .35);
                o.connect(dg); o.start(at); o.stop(at + OPEN_AT + .45);
            });
        },
        // the seed of light beats
        beat(at, big = 1) {
            tone("sine", 70, at, .55 * big, .006, .32, pre, 34);
            const n = noiseSrc(at, .05), lp = filter("lowpass", 1400), g = gain(0, pre);
            env(g.gain, at, .12 * big, .002, .04); n.connect(lp); lp.connect(g);
        },
        // the tear rips open, and keeps fizzing with sparks
        tear(at) {
            const n = noiseSrc(at, 1.2);
            const hp = filter("highpass", 900), bp = filter("bandpass", 700, 2.2);
            bp.frequency.setValueAtTime(700, at); bp.frequency.exponentialRampToValueAtTime(6500, at + .35); bp.frequency.exponentialRampToValueAtTime(2200, at + 1.1);
            const g = gain(0, pre); env(g.gain, at, .42, .015, 1.0);
            n.connect(hp); hp.connect(bp); bp.connect(g);
            // a tearing low groan beneath it
            tone("sawtooth", 55, at, .07, .05, .9, filterTo("lowpass", 380, pre), 38);
            // sparks: tiny clicks all along the tear's life
            for (let i = 0; i < 46; i++) {
                const t = at + .05 + Math.random() * 1.65;
                const s = noiseSrc(t, .02), f = filter("bandpass", 2500 + Math.random() * 5000, 4), sg = gain(0, pan(Math.random() * 1.6 - .8, pre));
                env(sg.gain, t, .05 + Math.random() * .07, .001, .015 + Math.random() * .03);
                s.connect(f); f.connect(sg);
            }
        },
        // the rune rings trace themselves: a glyph chime each time a line passes one
        rings(at) {
            const scale = [76, 79, 81, 83, 86, 88, 91, 93]; // E minor pentatonic, high
            for (let i = 0; i < 18; i++) {
                const t = at + (i / 18) * 1.0 + Math.random() * .03;
                bell(NOTE(scale[(i * 3) % scale.length]), t, .035, 1.1, pan(Math.sin(i * 1.7) * .7, pre));
            }
            // and the lines themselves hum as they draw
            const n = noiseSrc(at, 1.1), bp = filter("bandpass", 1800, 8), g = gain(0, pre);
            bp.frequency.setValueAtTime(1200, at); bp.frequency.linearRampToValueAtTime(3400, at + 1.0);
            env(g.gain, at, .05, .2, .8, .1); n.connect(bp); bp.connect(g);
        },
        // the rift breathes in before the gem
        inhale(at) {
            const n = noiseSrc(at, .55), lp = filter("lowpass", 200, .9), g = gain(0, pre);
            lp.frequency.setValueAtTime(200, at); lp.frequency.exponentialRampToValueAtTime(5200, at + .5);
            g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(.3, at + .48); g.gain.exponentialRampToValueAtTime(.0001, at + .53);
            n.connect(lp); lp.connect(g);
            tone("sine", 120, at, .1, .45, .06, pre, 260);
        },
        // the gem bursts through: a boom, a blast of air, and a crystal chord that rings out
        gem(at) {
            tone("sine", 95, at, .95, .005, 1.6, pre, 28);
            tone("triangle", 190, at, .25, .005, .5, pre, 50);
            const n = noiseSrc(at, .9), lp = filter("lowpass", 1100), g = gain(0, pre);
            lp.frequency.setValueAtTime(2400, at); lp.frequency.exponentialRampToValueAtTime(180, at + .8);
            env(g.gain, at, .55, .004, .85); n.connect(lp); lp.connect(g); g.connect(verbIn);
            // the crystal: E major add9, shimmering (each note a slightly detuned pair)
            [64, 71, 76, 78, 80, 83, 88].forEach((m, i) => {
                [-4, 4].forEach((cents) => {
                    const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = NOTE(m) * Math.pow(2, cents / 1200);
                    const cg = gain(0, pan(i % 2 ? .35 : -.35, pre));
                    env(cg.gain, at + .03 + i * .012, .03 + (m < 72 ? .02 : 0), .06, 2.6);
                    o.connect(cg); cg.connect(verbIn); o.start(at); o.stop(at + 3);
                });
            });
        },
        // the glint crossing the gem
        glint(at) {
            tone("sine", 2600, at, .05, .01, .2, pan(-.4, pre), 6200);
            bell(NOTE(100), at + .12, .03, 1.2, pan(.4, pre));
        },
        // lightning: a real electric arc, the way games do it. A sharp broadband
        // crack, then mains-rate (60 Hz) bursts of crackling noise, bright and
        // stuttering, like a cable shorting out, with sparks spitting over it
        strike(at, i = 0) {
            const big = i === 0 ? 1 : i === 3 ? .9 : .72;
            const side = [0, .55, -.5, .3, -.25][i % 5];
            const src = ac.createBufferSource();
            src.buffer = take(`strike${i}`) || electric(...strikeSpec(i));
            const g = gain(.8 * big, null);
            const sh = shape(1500, 4600, 13000); src.connect(sh.input); sh.output.connect(g); g.connect(pan(side, pre)); g.connect(verbIn);
            src.start(at);
            // the snap of air underneath, and a short rumble
            tone("sine", 160, at, .45 * big, .002, .14, pan(side, pre), 45);
            const th = noiseSrc(at, 1.4), tlp = filter("lowpass", 240, .7), tg = gain(0, pre);
            tg.gain.setValueAtTime(0.0001, at + .03); tg.gain.linearRampToValueAtTime(.16 * big, at + .12); tg.gain.exponentialRampToValueAtTime(.0001, at + .45 + .8 * big);
            th.connect(tlp); tlp.connect(tg); tg.connect(verbIn);
        },
        // between the strikes the air stays charged: an arc that hums at mains
        // rate, swelling and cutting out, with a high neon-like fizz flickering over it
        arc(at) {
            const len = OPEN_AT - 2.9; // until the rift opens
            const src = ac.createBufferSource();
            src.buffer = take("arc") || electric(...arcSpec());
            const g = gain(0, null);
            g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(.32, at + .3);
            g.gain.setValueAtTime(.32, at + len - .35); g.gain.exponentialRampToValueAtTime(.0001, at + len);
            const sh = shape(2200, 7800, 12500); src.connect(sh.input); sh.output.connect(g); g.connect(pre);
            src.start(at);
        },
        // the name: alien script scrambling, then a click as each letter settles
        scramble(at) {
            for (let i = 0; i < 16; i++) tone("square", 900 + Math.random() * 1800, at + i * .013, .012, .001, .012, filterTo("bandpass", 2400, pre));
        },
        letter(at, i = 0) {
            tone("triangle", NOTE(83 + [0, 2, 4, 7, 9, 12, 14, 16][i % 8]), at, .05, .002, .09, pan(-.6 + i * .17, pre));
            const n = noiseSrc(at, .02), f = filter("highpass", 5000), g = gain(0, pre);
            env(g.gain, at, .04, .001, .012); n.connect(f); f.connect(g);
        },
        tagline(at) {
            const n = noiseSrc(at, .6), bp = filter("bandpass", 3000, 3), g = gain(0, pre);
            bp.frequency.setValueAtTime(5000, at); bp.frequency.exponentialRampToValueAtTime(1500, at + .5);
            env(g.gain, at, .045, .12, .4); n.connect(bp); bp.connect(g);
        },
        // Riftgate closing: the power dies. The arc sputters and slows down,
        // everything is sucked back into the gem (a reversed whoosh), a falling
        // tone powers down, and the rift shuts with a deep thump and a last chime.
        farewell(at) {
            // a calm goodbye: a soft, warm chord that settles a step lower and
            // fades out through a closing filter, a quiet breath, two gentle chimes
            const lp = filter("lowpass", 1800, .5), pg = gain(0, post);
            lp.connect(pg); pg.connect(verbIn);
            lp.frequency.setValueAtTime(1800, at); lp.frequency.exponentialRampToValueAtTime(260, at + 1.5);
            pg.gain.setValueAtTime(0.0001, at); pg.gain.linearRampToValueAtTime(.11, at + .25); pg.gain.exponentialRampToValueAtTime(.0001, at + 1.6);
            [[57, 52], [64, 59], [69, 64], [73, 68]].forEach(([m, to]) => [-4, 4].forEach((c) => {
                const o = ac.createOscillator(); o.type = "triangle";
                o.frequency.setValueAtTime(NOTE(m) * Math.pow(2, c / 1200), at);
                o.frequency.setValueAtTime(NOTE(m) * Math.pow(2, c / 1200), at + .45);
                o.frequency.exponentialRampToValueAtTime(NOTE(to) * Math.pow(2, c / 1200), at + .9);
                const og = gain(.14, lp); o.connect(og); o.start(at); o.stop(at + 1.7);
            }));
            // a soft breath, like air settling as the rift closes
            const n = noiseSrc(at, 1.4), bp = filter("bandpass", 1200, .7), ng = gain(0, post);
            bp.frequency.setValueAtTime(1200, at); bp.frequency.exponentialRampToValueAtTime(300, at + 1.3);
            ng.gain.setValueAtTime(0.0001, at); ng.gain.linearRampToValueAtTime(.035, at + .5); ng.gain.exponentialRampToValueAtTime(.0001, at + 1.4);
            n.connect(bp); bp.connect(ng); ng.connect(verbIn);
            // a low, round hum underneath
            tone("sine", 110, at, .12, .3, 1.2, post, 82);
            // the gem's last light
            bell(NOTE(81), at + .1, .022, 1.4, pan(.25, post));
            bell(NOTE(76), at + .7, .02, 1.5, pan(-.2, post));
            return 1.55; // seconds until it's done enough to close
        },
        // The Hallowed Rift (season.js): a haunted wind under the opening, a
        // low choir breathing in a minor key, and a distant howl as the rings draw
        haunt(at) {
            const end = at + 6.4;
            // wind: noise through a slowly wandering band, gusting
            const n = noiseSrc(at, 6.6), bp = filter("bandpass", 420, 2.2), wg = gain(0, pre);
            [[0, 380], [1.3, 820], [2.4, 460], [3.6, 980], [4.9, 520], [6.4, 300]].forEach(([dt, f]) => bp.frequency.linearRampToValueAtTime(f, at + dt));
            wg.gain.setValueAtTime(0.0001, at); wg.gain.linearRampToValueAtTime(.075, at + 1.2); wg.gain.linearRampToValueAtTime(.05, at + 2.6);
            wg.gain.linearRampToValueAtTime(.085, at + 3.8); wg.gain.exponentialRampToValueAtTime(.0001, end);
            n.connect(bp); bp.connect(wg); wg.connect(verbIn);
            // choir: a D minor chord on detuned saws, through a dark filter, with a slow vibrato
            const lp = filter("lowpass", 700, .7), cg = gain(0, pre);
            lp.connect(cg); cg.connect(verbIn);
            cg.gain.setValueAtTime(0.0001, at + .5); cg.gain.linearRampToValueAtTime(.03, at + 2.2); cg.gain.setValueAtTime(.03, at + 4.2); cg.gain.exponentialRampToValueAtTime(.0001, end);
            const vib = ac.createOscillator(), vg = gain(9, null); vib.frequency.value = 4.6; vib.connect(vg); vib.start(at); vib.stop(end + .1);
            [50, 57, 62, 65].forEach((m) => [-7, 7].forEach((c) => {
                const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = NOTE(m); o.detune.value = c; vg.connect(o.detune);
                const og = gain(.18, lp); o.connect(og); o.start(at + .5); o.stop(end + .1);
            }));
            // a far-off howl, mostly echo
            const hw = at + 1.9, ho = ac.createOscillator(); ho.type = "sine";
            ho.frequency.setValueAtTime(360, hw); ho.frequency.exponentialRampToValueAtTime(640, hw + .7); ho.frequency.linearRampToValueAtTime(590, hw + 1.4); ho.frequency.exponentialRampToValueAtTime(290, hw + 2.4);
            const hv = ac.createOscillator(), hvg = gain(14, null); hv.frequency.value = 5.5; hv.connect(hvg); hvg.connect(ho.detune);
            const hb = filter("bandpass", 700, 1.4), hg = gain(0, null); env(hg.gain, hw, .05, .5, 1.9, .2);
            ho.connect(hb); hb.connect(hg); hg.connect(verbIn); hg.connect(gain(.25, pre));
            ho.start(hw); hv.start(hw); ho.stop(hw + 2.8); hv.stop(hw + 2.8);
        },
        // the rift opens wide: a great whoosh, a falling boom and a bloom of light
        open(at) {
            const n = noiseSrc(at, 1.6), bp = filter("bandpass", 220, .8), g = gain(0, post);
            bp.frequency.setValueAtTime(220, at); bp.frequency.exponentialRampToValueAtTime(3800, at + .7); bp.frequency.exponentialRampToValueAtTime(900, at + 1.5);
            g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(.38, at + .4); g.gain.exponentialRampToValueAtTime(.0001, at + 1.55);
            n.connect(bp); bp.connect(g); g.connect(verbIn);
            tone("sine", 60, at, .6, .02, 1.3, post, 30);
            // the bloom: a warm chord opening up through a filter
            const lp = filter("lowpass", 300, 1.2); const pg = gain(0, post); lp.connect(pg); pg.connect(verbIn);
            lp.frequency.setValueAtTime(300, at); lp.frequency.exponentialRampToValueAtTime(5200, at + .6); lp.frequency.exponentialRampToValueAtTime(800, at + 1.6);
            pg.gain.setValueAtTime(0.0001, at); pg.gain.exponentialRampToValueAtTime(.16, at + .35); pg.gain.exponentialRampToValueAtTime(.0001, at + 1.9);
            [52, 59, 64, 68, 71, 76].forEach((m, i) => [-6, 6].forEach((c) => {
                const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = NOTE(m) * Math.pow(2, c / 1200);
                const og = gain(.12, lp); o.connect(og); o.start(at); o.stop(at + 2);
            }));
            bell(NOTE(88), at + .25, .05, 1.8, pan(.3, post));
            bell(NOTE(95), at + .4, .035, 1.6, pan(-.3, post));
        }
    };
    function filterTo(type, f, dest) { const b = filter(type, f, 1); b.connect(dest); return b; }
    // Electricity, built sample by sample: at `hz` (mains rate) the arc fires a
    // short burst of crackling noise; the bursts swell and cut out (swell),
    // stutter on and off like a shorting cable (stutter) or flicker like a
    // failing neon tube (flicker); sparks are single sharp snaps on top, and
    // `crack` is the opening snap of a strike. Two channels, each its own.
    function electric(dur, o) { const j = { gen: electricGen(dur, o), done: false, value: null }; return finish(j); }
    function* electricGen(dur, o) {
        let work = 0;
        const sr = ac.sampleRate, n = Math.max(1, Math.floor(dur * sr)), buf = ac.createBuffer(2, n, sr);
        const level = o.level || 1;
        // on/off pattern shared by both channels
        const gates = [];
        for (let t = 0; t < dur;) {
            const on = o.stutter ? .02 + Math.random() * .07 : o.flicker ? .05 + Math.random() * .3 : dur;
            const off = o.stutter ? (Math.random() < .4 ? .008 + Math.random() * .035 : 0) : o.flicker ? (Math.random() < .3 ? .01 + Math.random() * .05 : 0) : 0;
            gates.push([t, t + on, .55 + Math.random() * .45]); t += on + off;
        }
        const gateAt = (t) => { for (const [a, b, v] of gates) if (t >= a && t < b) return v; return 0; };
        const envAt = (t) => {
            let e = o.decay ? Math.exp(-t / o.decay) : 1;
            if (o.swell) { const c = (t % o.swell) / o.swell; e *= .3 + .7 * c * c; } // builds up, then snaps off
            return e * Math.min(1, t / .004);
        };
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            const hzAt = (t) => (o.hzEnd ? o.hz + (o.hzEnd - o.hz) * (t / dur) : (o.hz || 60));
            let period = sr / hzAt(0);
            for (let p = 0; p < n; p += period * (1 + (Math.random() - .5) * .04)) {
                period = sr / hzAt(p / sr);
                const t = p / sr, amp = envAt(t) * gateAt(t) * (.6 + Math.random() * .4) * level;
                if (amp < .002) continue;
                const len = Math.floor(sr * (.002 + Math.random() * .004)), tau = len * .35, i0 = Math.floor(p);
                for (let j = 0; j < len && i0 + j < n; j++) d[i0 + j] += amp * (Math.random() * 2 - 1) * Math.exp(-j / tau);
                // the arc's second, weaker discharge in the same cycle (gives the 120 Hz edge)
                const i1 = i0 + Math.floor(period / 2);
                for (let j = 0; j < len * .6 && i1 + j < n; j++) d[i1 + j] += amp * .45 * (Math.random() * 2 - 1) * Math.exp(-j / (tau * .6));
                if ((++work & 15) === 0) yield;
            }
            for (let k = 0; k < (o.sparks || 0); k++) {
                const t = Math.pow(Math.random(), o.decay ? 1.6 : 1) * dur, i0 = Math.floor(t * sr);
                const len = Math.floor(sr * (.0004 + Math.random() * .0018)), amp = (.5 + Math.random() * .9) * (o.decay ? envAt(t) + .2 : .6) * level;
                for (let j = 0; j < len && i0 + j < n; j++) d[i0 + j] += amp * (Math.random() * 2 - 1) * (1 - j / len);
            }
            if (o.crack) {
                const len = Math.floor(sr * .03);
                for (let j = 0; j < len && j < n; j++) d[j] += o.crack * (Math.random() * 2 - 1) * Math.exp(-j / (len * .3));
            }
            for (let j = 0; j < n; j++) { d[j] = Math.max(-1, Math.min(1, d[j])); if ((j & 32767) === 32767) yield; } // a touch of clipping, like a real arc
        }
        return buf;
    }
    // the tone of electricity: no low end, a hot presence peak, the very top rolled off
    function shape(hp, peak, lp) {
        const a = filter("highpass", hp, .7), b = filter("peaking", peak, 1.1), c = filter("lowpass", lp, .7);
        b.gain.value = 7;
        a.connect(b); b.connect(c);
        return { input: a, output: c };
    }
    // overdrive: a hard-clipping waveshaper (the grit of game electricity)
    function drive(k) {
        const w = ac.createWaveShaper(), n = 1024, c = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
        w.curve = c; w.oversample = "2x";
        return w;
    }

    // What each electric sound is made of (the same whether built ahead or on the spot)
    function strikeSpec(i) { const big = i === 0 ? 1 : i === 3 ? .9 : .72, dur = .5 + .35 * big; return [dur, { hz: 60, stutter: true, crack: 1, sparks: 70 * big, decay: dur * .55 }]; }
    function arcSpec() { return [OPEN_AT - 2.9, { hz: 60, swell: .7, flicker: true, sparks: 50, level: .55 }]; }
    const ready = new Map();
    // a sound built ahead: finished now if it isn't quite done; null if it was never started
    function take(key) { const j = ready.get(key); if (!j) return null; ready.delete(key); return finish(j); }
    if (prebuild) {
        ready.set("arc", job(electricGen(...arcSpec())));
        STRIKES.forEach((_, i) => ready.set(`strike${i}`, job(electricGen(...strikeSpec(i)))));
    }
    schedule();

    // The timeline, matching intro.js (seconds from the start)
    const TIMELINE = [
        ...(season === "halloween" ? [[.15, "haunt"]] : []),
        [0, "rush"], [.55, "beat", 1], [.86, "beat", .7], [.9, "tear"], [1.4, "rings"], [2.05, "inhale"], [2.55, "gem"], [3.0, "glint"], [3.02, "arc"],
        ...STRIKES.map((t, i) => [t, "strike", i]),
        [3.55, "scramble"], ...Array.from({ length: 8 }, (_, i) => [3.75 + i * .085, "letter", i]), [4.35, "tagline"], [OPEN_AT, "open"]
    ];
    TIMELINE.sort((x, y) => x[0] - y[0]);

    return {
        TIMELINE,
        // play one cue now (or at an audio-clock time)
        cue(name, arg, at = ac.currentTime) {
            try {
                if (name !== "rush" && !hall.done) finish(hall); // the hall's echo, if idle time hasn't finished it yet
                return cues[name](Math.max(at, ac.currentTime), arg);
            } catch (e) { /* never break the opening for a sound */ }
        },
        // a skip: everything before the opening falls silent at once
        hush() { const t = ac.currentTime; pre.gain.cancelScheduledValues(t); pre.gain.setValueAtTime(pre.gain.value, t); pre.gain.linearRampToValueAtTime(0, t + .08); },
        // schedule the whole soundtrack ahead (for an offline preview)
        render(start = 0) { finish(hall); TIMELINE.forEach(([t, name, arg]) => cues[name](start + t, arg)); },
        close() { setTimeout(() => { try { ac.close(); } catch (e) { /* */ } }, 2500); }
    };
}
