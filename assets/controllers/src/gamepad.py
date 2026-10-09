# Riftgate's own gamepad renders (no real product is shown): one generic
# controller, drawn so each button sits exactly where the controls screen
# expects it (PHOTOS[...].at in src/app/gamepad.js). Product-shot style,
# matching remote.py: straight down, soft studio light, shadow on white.
import sys
LAYOUTS = {
    "xbox": dict(W=428, H=385, at={"LT": [118, 30], "LB": [92, 50], "VIEW": [183, 107], "LS": [105, 105], "DPAD": [160, 175], "RT": [312, 30], "RB": [338, 50], "MENU": [245, 107], "Y": [325, 78], "X": [293, 107], "B": [350, 107], "A": [322, 134], "RS": [270, 170]},
                 face={"A": ("A", "#3ab14a"), "B": ("B", "#e3342f"), "X": ("X", "#2f78d6"), "Y": ("Y", "#f2b705")}),
    "playstation": dict(W=495, H=493, at={"LT": [95, 92], "LB": [100, 110], "VIEW": [132, 126], "LS": [170, 247], "DPAD": [95, 182], "RT": [398, 92], "RB": [395, 110], "MENU": [361, 126], "Y": [398, 146], "X": [370, 182], "B": [433, 182], "A": [398, 216], "RS": [325, 247]},
                 face={"A": ("✕", "#7b9cf2"), "B": ("○", "#ef6b75"), "X": ("□", "#e58bd8"), "Y": ("△", "#3fc9a8")}),
    "nintendo": dict(W=438, H=361, at={"LT": [92, 62], "LB": [70, 80], "VIEW": [162, 100], "LS": [97, 135], "DPAD": [160, 200], "RT": [346, 62], "RB": [368, 80], "MENU": [270, 100], "Y": [335, 105], "X": [306, 134], "B": [365, 134], "A": [335, 163], "RS": [272, 200]},
                 face={"A": ("B", "#d8d8de"), "B": ("A", "#d8d8de"), "X": ("Y", "#d8d8de"), "Y": ("X", "#d8d8de")}),
}

def render(kind):
    L = LAYOUTS[kind]; W, H, at = L["W"], L["H"], L["at"]
    cx = (at["VIEW"][0] + at["MENU"][0]) / 2
    xs = [p[0] for k, p in at.items()]
    left = min(at["LB"][0], at["LS"][0], at["DPAD"][0]) - 52
    right = max(at["RB"][0], at["B"][0], at["RS"][0]) + 52
    top = min(at["LB"][1], at["RB"][1]) - 4
    mid = max(at["LS"][1], at["RS"][1], at["DPAD"][1]) + 40
    gb = min(H - 22, mid + 120)               # grip bottoms
    o = []; A = o.append
    A(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
    A('''<defs>
<linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a42"/><stop offset=".45" stop-color="#2a2a31"/><stop offset="1" stop-color="#17171b"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".3" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="trig" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4a52"/><stop offset="1" stop-color="#1c1c20"/></linearGradient>
<radialGradient id="btn" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#4c4c54"/><stop offset=".7" stop-color="#2b2b31"/><stop offset="1" stop-color="#18181b"/></radialGradient>
<radialGradient id="cap" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#3e3e46"/><stop offset=".8" stop-color="#1f1f24"/><stop offset="1" stop-color="#121215"/></radialGradient>
<radialGradient id="well" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#0c0c0f"/><stop offset="1" stop-color="#1a1a1e"/></radialGradient>
<filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="13"/></filter>
<filter id="press" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#000" flood-opacity=".7"/></filter>
<filter id="glow"><feGaussianBlur stdDeviation="2"/></filter>
</defs>''')
    A(f'<rect width="{W}" height="{H}" fill="#fff"/>')
    # triggers peek out above the shoulders
    for k in ("LT", "RT"):
        x, y = at[k]
        A(f'<rect x="{x-30}" y="{y-14}" width="60" height="34" rx="14" fill="url(#trig)" filter="url(#press)"/>')
    # body: shoulders across the top, a grip on each side
    gl, gr = left + 8, right - 8
    d = (f"M{left+46},{top} L{right-46},{top} C{right-14},{top} {right+4},{top+30} {right+6},{mid-30} "
         f"C{right+10},{mid+40} {right+6},{gb-20} {gr-26},{gb} C{gr-48},{gb+8} {gr-74},{gb-6} {gr-84},{gb-34} "
         f"C{gr-96},{mid+16} {cx+70},{mid+6} {cx+40},{mid+6} L{cx-40},{mid+6} C{cx-70},{mid+6} {gl+96},{mid+16} {gl+84},{gb-34} "
         f"C{gl+74},{gb-6} {gl+48},{gb+8} {gl+26},{gb} C{left-6},{gb-20} {left-10},{mid+40} {left-6},{mid-30} "
         f"C{left-4},{top+30} {left+14},{top} {left+46},{top} Z")
    A(f'<path d="{d}" fill="#000" opacity=".3" filter="url(#shadow)" transform="translate(6,14)"/>')
    A(f'<path d="{d}" fill="url(#body)"/>')
    A(f'<path d="{d}" fill="url(#sheen)"/>')
    A(f'<path d="{d}" fill="none" stroke="#000" stroke-opacity=".6"/>')
    # bumpers along the shoulder edge
    for k, s in (("LB", 1), ("RB", -1)):
        x, y = at[k]
        A(f'<path d="M{x-30*s},{y+8} Q{x},{y-10} {x+30*s},{y-2}" fill="none" stroke="#4b4b53" stroke-width="9" stroke-linecap="round" filter="url(#press)"/>')
    def btn(x, y, r, fill="url(#btn)"):
        A(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" filter="url(#press)"/>')
        A(f'<circle cx="{x}" cy="{y}" r="{r-.6}" fill="none" stroke="#fff" stroke-opacity=".1"/>')
    def txt(x, y, s, size, fill="#e6e6ea", w=700):
        A(f'<text x="{x}" y="{y}" font-family="Segoe UI Symbol, Segoe UI, Helvetica, Arial, sans-serif" font-size="{size}" font-weight="{w}" fill="{fill}" text-anchor="middle" dominant-baseline="central">{s}</text>')
    # sticks
    for k in ("LS", "RS"):
        x, y = at[k]
        A(f'<circle cx="{x}" cy="{y}" r="30" fill="url(#well)"/>')
        btn(x, y, 23, "url(#cap)")
        A(f'<circle cx="{x}" cy="{y}" r="16" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>')
    # d-pad
    x, y = at["DPAD"]
    A(f'<circle cx="{x}" cy="{y}" r="30" fill="url(#well)"/>')
    A(f'<path d="M{x-9},{y-24} h18 v15 h15 v18 h-15 v15 h-18 v-15 h-15 v-18 h15 z" fill="url(#btn)" filter="url(#press)" stroke="#fff" stroke-opacity=".08"/>')
    for ang in (0, 90, 180, 270):
        A(f'<path d="M0 -4 L4 2 L-4 2 Z" fill="#cfcfd6" transform="translate({x},{y}) rotate({ang}) translate(0,-16)"/>')
    # face buttons
    for k in ("Y", "X", "B", "A"):
        x, y = at[k]; label, colour = L["face"][k]
        btn(x, y, 13)
        txt(x, y + .5, label, 12 if len(label) == 1 and label.isalpha() else 13, fill=colour)
    # view / menu
    for k in ("VIEW", "MENU"):
        x, y = at[k]
        A(f'<rect x="{x-9}" y="{y-6}" width="18" height="12" rx="6" fill="url(#btn)" filter="url(#press)"/>')
    # Riftgate's gem as the home button
    gy = max(top + 26, min(at["VIEW"][1], at["MENU"][1]) - 30)
    A(f'<circle cx="{cx}" cy="{gy}" r="14" fill="#101013"/>')
    A(f'<path d="M{cx},{gy-9} L{cx+8},{gy-2} L{cx},{gy+10} L{cx-8},{gy-2} Z" fill="#a66bff" filter="url(#glow)" opacity=".8"/>')
    A(f'<path d="M{cx},{gy-9} L{cx+8},{gy-2} L{cx},{gy+10} L{cx-8},{gy-2} Z M{cx-8},{gy-2} H{cx+8}" fill="#c9a6ff" stroke="#efe4ff" stroke-width=".8" stroke-opacity=".7"/>')
    A('</svg>')
    return "\n".join(o)

for k in LAYOUTS:
    open(f"{k}.svg", "w").write(render(k))
