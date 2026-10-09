# 75% keyboard, product-shot style: top down, dark aluminium case, light keycaps
import json
U = 56; PAD = 22
rows = [
    [("Esc",1,"acc"),(None,.5),("F1",1),("F2",1),("F3",1),("F4",1),(None,.5),("F5",1),("F6",1),("F7",1),("F8",1),(None,.5),("F9",1),("F10",1),("F11",1),("F12",1),(None,.5),("Del",1,"mod")],
    [("`",1),("1",1),("2",1),("3",1),("4",1),("5",1),("6",1),("7",1),("8",1),("9",1),("0",1),("-",1),("=",1),("Backspace",2,"mod"),("Home",1,"mod")],
    [("Tab",1.5,"mod"),("Q",1),("W",1),("E",1),("R",1),("T",1),("Y",1),("U",1),("I",1),("O",1),("P",1),("[",1),("]",1),("\\",1.5),("PgUp",1,"mod")],
    [("Caps",1.75,"mod"),("A",1),("S",1),("D",1),("F",1),("G",1),("H",1),("J",1),("K",1),("L",1),(";",1),("'",1),("Enter",2.25,"acc"),("PgDn",1,"mod")],
    [("Shift",2.25,"mod"),("Z",1),("X",1),("C",1),("V",1),("B",1),("N",1),("M",1),(",",1),(".",1),("/",1),("Shift",1.75,"mod"),("↑",1,"arrow"),("End",1,"mod")],
    [("Ctrl",1.25,"mod"),("Win",1.25,"mod"),("Alt",1.25,"mod"),("",6.25),("Alt",1,"mod"),("Fn",1,"mod"),("Ctrl",1,"mod"),("←",1,"arrow"),("↓",1,"arrow"),("→",1,"arrow")],
]
gapTop = 14
W = int(16 * U + PAD * 2 + 60); H = int(6 * U + gapTop + PAD * 2 + 60)
ox, oy = 30, 26
o = []; A = o.append
A(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
A('''<defs>
<linearGradient id="case" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4a52"/><stop offset=".08" stop-color="#2f2f35"/><stop offset=".9" stop-color="#25252a"/><stop offset="1" stop-color="#17171a"/></linearGradient>
<linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121215"/><stop offset="1" stop-color="#1c1c20"/></linearGradient>
<linearGradient id="capSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9c9cf"/><stop offset="1" stop-color="#a3a3ab"/></linearGradient>
<linearGradient id="capTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfbfc"/><stop offset="1" stop-color="#e6e6ea"/></linearGradient>
<linearGradient id="modSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d8d97"/><stop offset="1" stop-color="#6b6b75"/></linearGradient>
<linearGradient id="modTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9b9c2"/><stop offset="1" stop-color="#a2a2ac"/></linearGradient>
<linearGradient id="accSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b2fd0"/><stop offset="1" stop-color="#4c1fa0"/></linearGradient>
<linearGradient id="accTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a5cff"/><stop offset="1" stop-color="#7d3cf0"/></linearGradient>
<filter id="shadow" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="cap" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="2.2" stdDeviation="1.6" flood-color="#000" flood-opacity=".55"/></filter>
</defs>''')
A(f'<rect width="{W}" height="{H}" fill="#fff"/>')
cw = 16 * U + PAD * 2; ch = 6 * U + gapTop + PAD * 2
A(f'<rect x="{ox+10}" y="{oy+26}" width="{cw-20}" height="{ch-10}" rx="20" fill="#000" opacity=".33" filter="url(#shadow)"/>')
A(f'<rect x="{ox}" y="{oy}" width="{cw}" height="{ch}" rx="16" fill="url(#case)"/>')
A(f'<rect x="{ox+.5}" y="{oy+.5}" width="{cw-1}" height="{ch-1}" rx="15.5" fill="none" stroke="#fff" stroke-opacity=".14"/>')
A(f'<rect x="{ox+PAD-6}" y="{oy+PAD-6}" width="{cw-2*PAD+12}" height="{ch-2*PAD+12}" rx="7" fill="url(#plate)"/>')
centres = {}
for r, row in enumerate(rows):
    x = ox + PAD; y = oy + PAD + r * U + (gapTop if r > 0 else 0)
    for k in row:
        label, w = k[0], k[1]; kind = k[2] if len(k) > 2 else "alpha"
        if label is None: x += w * U; continue
        kw = w * U - 5; kh = U - 5
        side, top = {"alpha": ("capSide", "capTop"), "mod": ("modSide", "modTop"), "acc": ("accSide", "accTop"), "arrow": ("modSide", "modTop")}[kind]
        kx, ky = x + 2.5, y + 2.5
        A(f'<g filter="url(#cap)"><rect x="{kx}" y="{ky}" width="{kw}" height="{kh}" rx="6" fill="url(#{side})"/>')
        A(f'<rect x="{kx+4.5}" y="{ky+2.5}" width="{kw-9}" height="{kh-11}" rx="5" fill="url(#{top})"/>')
        A(f'<rect x="{kx+4.5}" y="{ky+2.5}" width="{kw-9}" height="{kh-11}" rx="5" fill="none" stroke="#fff" stroke-opacity=".55"/></g>')
        col = "#ffffff" if kind == "acc" else ("#26262c" if kind in ("alpha",) else "#1d1d22")
        if label:
            size = 15 if len(label) == 1 else (10.5 if len(label) <= 4 else 9.5)
            if kind == "arrow": size = 15
            if len(label) == 1 or kind == "arrow":
                A(f'<text x="{kx+kw/2}" y="{ky+kh/2+1}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="{size}" font-weight="600" fill="{col}" text-anchor="middle">{label.replace("&","&amp;")}</text>')
            else:
                A(f'<text x="{kx+10}" y="{ky+19}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="{size}" font-weight="600" fill="{col}">{label}</text>')
        key = {"↑": "UP", "↓": "DOWN", "←": "LEFT", "→": "RIGHT"}.get(label, label)
        centres.setdefault(key, [round(kx + kw / 2 - ox + ox), round(ky + kh / 2 - 3)])
        x += w * U
# a subtle Riftgate badge on the case
A(f'<text x="{ox+cw-PAD}" y="{oy+12}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="7.5" font-weight="800" letter-spacing="3" fill="#fff" fill-opacity=".45" text-anchor="end">RIFTGATE</text>')
A(f'<circle cx="{ox+PAD+2}" cy="{oy+11}" r="2" fill="#a46bff"/>')
A('</svg>')
open('keyboard.svg', 'w').write("\n".join(o))
print(W, H); print(json.dumps({k: centres[k] for k in ["Esc", "F1", "Enter", "Backspace", "P", "I", "M", "W", "R", "[", "]", "PgUp", "PgDn", "UP", "LEFT", "DOWN", "RIGHT"]}))
