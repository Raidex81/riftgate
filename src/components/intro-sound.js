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

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

export function createIntroSound(ac, { volume = 0.7 } = {}) {
    const out = ac.createDynamicsCompressor();
    out.threshold.value = -14; out.knee.value = 12; out.ratio.value = 4; out.attack.value = .003; out.release.value = .25;
    const master = ac.createGain(); master.gain.value = volume;
    master.connect(out); out.connect(ac.destination);

    // everything up to the opening of the rift goes through `pre`, so a skip can silence it at once
    const pre = ac.createGain(); pre.connect(master);
    const post = ac.createGain(); post.connect(master);

    // a big, dark hall for the boom, the chord and the thunder
    const verb = ac.createConvolver();
    {
        const len = Math.floor(ac.sampleRate * 3.2), ir = ac.createBuffer(2, len, ac.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const d = ir.getChannelData(ch);
            for (let i = 0; i < len; i++) { const x = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 2.6) * (x < .01 ? x / .01 : 1); }
        }
        verb.buffer = ir;
    }
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
                dg.gain.setValueAtTime(i === 2 ? .04 : .16, at + 4.7);
                dg.gain.exponentialRampToValueAtTime(0.0001, at + 5.3);
                o.connect(dg); o.start(at); o.stop(at + 5.4);
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
        // lightning: a crack exactly as the bolt appears, an electric sizzle, then thunder
        strike(at, i = 0) {
            const big = i === 0 ? 1 : i === 3 ? .85 : .65;
            const side = [0, .5, -.45, .3, -.2][i % 5];
            const dest = pan(side, pre);
            // the crack
            const n = noiseSrc(at, .2), hp = filter("highpass", 1800), g = gain(0, dest);
            env(g.gain, at, 1.5 * big, .0015, .12 + .06 * big);
            n.connect(hp); hp.connect(g); g.connect(verbIn);
            // the snap of the air (low thump)
            tone("sine", 140, at, .55 * big, .002, .18, dest, 45);
            // the electric sizzle: buzzing saws with a jittering pitch, chopped by a fast flutter
            const sizz = gain(0, dest);
            env(sizz.gain, at + .005, .4 * big, .004, .55 + .35 * big);
            const bp = filter("bandpass", 1500, 1.8); bp.connect(sizz);
            const chop = ac.createGain(); chop.gain.value = .5; chop.connect(bp);
            const lfo = ac.createOscillator(); lfo.type = "square"; lfo.frequency.setValueAtTime(38 + Math.random() * 20, at);
            lfo.frequency.linearRampToValueAtTime(11, at + .9);
            const lfoG = gain(.5); lfo.connect(lfoG); lfoG.connect(chop.gain); lfo.start(at); lfo.stop(at + 1.1);
            [92, 137, 211].forEach((f) => {
                const o = ac.createOscillator(); o.type = "sawtooth";
                const curve = new Float32Array(48).map(() => f * (.7 + Math.random() * .8));
                o.frequency.setValueCurveAtTime(curve, at, .9);
                o.connect(chop); o.start(at); o.stop(at + 1.0);
            });
            const fz = noiseSrc(at, .9), fzb = filter("bandpass", 4200, 2.5), fzg = gain(0, dest);
            env(fzg.gain, at, .26 * big, .003, .5 + .3 * big); fz.connect(fzb); fzb.connect(fzg);
            // thunder rolling away (bigger strikes roll longer)
            const th = noiseSrc(at, 3), tlp = filter("lowpass", 260, .7), tg = gain(0, pre);
            tlp.frequency.setValueAtTime(420, at + .05); tlp.frequency.exponentialRampToValueAtTime(90, at + 2.4);
            tg.gain.setValueAtTime(0.0001, at + .04);
            tg.gain.linearRampToValueAtTime(.45 * big, at + .16);
            tg.gain.exponentialRampToValueAtTime(.0001, at + .9 + 1.6 * big);
            th.connect(tlp); tlp.connect(tg); tg.connect(verbIn);
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

    // The timeline, matching intro.js (seconds from the start)
    const STRIKES = [3.02, 3.16, 3.38, 3.9, 4.45];
    const TIMELINE = [
        [0, "rush"], [.55, "beat", 1], [.86, "beat", .7], [.9, "tear"], [1.4, "rings"], [2.05, "inhale"], [2.55, "gem"], [3.0, "glint"],
        ...STRIKES.map((t, i) => [t, "strike", i]),
        [3.55, "scramble"], ...Array.from({ length: 8 }, (_, i) => [3.75 + i * .085, "letter", i]), [4.35, "tagline"], [4.95, "open"]
    ];

    return {
        TIMELINE,
        // play one cue now (or at an audio-clock time)
        cue(name, arg, at = ac.currentTime) { try { cues[name](Math.max(at, ac.currentTime), arg); } catch (e) { /* never break the opening for a sound */ } },
        // a skip: everything before the opening falls silent at once
        hush() { const t = ac.currentTime; pre.gain.cancelScheduledValues(t); pre.gain.setValueAtTime(pre.gain.value, t); pre.gain.linearRampToValueAtTime(0, t + .08); },
        // schedule the whole soundtrack ahead (for an offline preview)
        render(start = 0) { TIMELINE.forEach(([t, name, arg]) => cues[name](start + t, arg)); },
        close() { setTimeout(() => { try { ac.close(); } catch (e) { /* */ } }, 2500); }
    };
}
