# TV remote, product-shot style: straight down, soft studio light, shadow on white
W, H = 320, 810
o = []
A = o.append
A(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">')
A('''<defs>
<linearGradient id="body" x1="0" x2="1"><stop offset="0" stop-color="#151518"/><stop offset=".18" stop-color="#2c2c31"/><stop offset=".5" stop-color="#36363c"/><stop offset=".82" stop-color="#26262a"/><stop offset="1" stop-color="#121214"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".25" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<radialGradient id="btn" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#4a4a51"/><stop offset=".7" stop-color="#2a2a2f"/><stop offset="1" stop-color="#18181b"/></radialGradient>
<radialGradient id="ok" cx=".42" cy=".36" r=".8"><stop offset="0" stop-color="#55555d"/><stop offset=".75" stop-color="#2d2d33"/><stop offset="1" stop-color="#1a1a1e"/></radialGradient>
<radialGradient id="ring" cx=".5" cy=".42" r=".6"><stop offset=".55" stop-color="#3a3a41"/><stop offset=".85" stop-color="#2a2a30"/><stop offset="1" stop-color="#1b1b1f"/></radialGradient>
<radialGradient id="power" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#3b3b42"/><stop offset="1" stop-color="#1a1a1e"/></radialGradient>
<linearGradient id="rocker" x1="0" x2="1"><stop offset="0" stop-color="#202024"/><stop offset=".5" stop-color="#3c3c43"/><stop offset="1" stop-color="#1e1e22"/></linearGradient>
<filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="press" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.4" flood-color="#000" flood-opacity=".7"/></filter>
<filter id="ledglow"><feGaussianBlur stdDeviation="1.4"/></filter>
</defs>''')
A(f'<rect width="{W}" height="{H}" fill="#fff"/>')
# shadow
A('<ellipse cx="166" cy="414" rx="96" ry="380" fill="#000" opacity=".28" filter="url(#shadow)"/>')
bx, by, bw, bh = 70, 26, 180, 748
A(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="78" fill="url(#body)"/>')
A(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="78" fill="url(#sheen)"/>')
A(f'<rect x="{bx+1}" y="{by+1}" width="{bw-2}" height="{bh-2}" rx="77" fill="none" stroke="#fff" stroke-opacity=".10"/>')
A(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="78" fill="none" stroke="#000" stroke-opacity=".6"/>')
cx = 160
def btn(x, y, r, fill="url(#btn)"):
    A(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" filter="url(#press)"/>')
    A(f'<circle cx="{x}" cy="{y}" r="{r-.6}" fill="none" stroke="#fff" stroke-opacity=".09"/>')
def txt(x, y, s, size=9, fill="#d9d9de", w=600, anchor="middle", op=1):
    A(f'<text x="{x}" y="{y}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="{size}" font-weight="{w}" fill="{fill}" fill-opacity="{op}" text-anchor="{anchor}">{s}</text>')
# IR window + LED
A(f'<rect x="{cx-22}" y="{by+8}" width="44" height="6" rx="3" fill="#0b0b0d"/>')
A(f'<circle cx="{cx}" cy="{by+38}" r="2.2" fill="#ff4d6d" filter="url(#ledglow)"/><circle cx="{cx}" cy="{by+38}" r="1.2" fill="#ffb3c1"/>')
# power + input
btn(cx-44, 96, 15, "url(#power)")
A(f'<g transform="translate({cx-44},96)" fill="none" stroke="#ff5a6e" stroke-width="2" stroke-linecap="round"><path d="M-4.6 -4.2 A6.5 6.5 0 1 0 4.6 -4.2"/><path d="M0 -7.4 V-1.2"/></g>')
btn(cx+44, 96, 15)
A(f'<g transform="translate({cx+44},96)" fill="none" stroke="#d9d9de" stroke-width="1.5" stroke-linejoin="round"><rect x="-6.5" y="-5" width="13" height="9" rx="1"/><path d="M-1.5 -2 L2 0 L-1.5 2"/></g>')
txt(cx+44, 124, "INPUT", 7.5, op=.7)
# Info (VIEW) / Settings row
btn(cx-44, 156, 14); txt(cx-44, 159.5, "i", 12, w=700)
txt(cx-44, 182, "INFO", 7.5, op=.7)
btn(cx+44, 156, 14)
A(f'<g transform="translate({cx+44},156)" fill="none" stroke="#d9d9de" stroke-width="1.5"><circle r="3"/><path d="M0 -7V-5M0 5V7M-7 0H-5M5 0H7M-5 -5l1.4 1.4M3.6 3.6 5 5M-5 5l1.4-1.4M3.6-3.6 5-5"/></g>')
txt(cx+44, 182, "SETTINGS", 7.5, op=.7)
# D-pad ring
dy = 262
A(f'<circle cx="{cx}" cy="{dy}" r="66" fill="#0d0d10"/>')
A(f'<circle cx="{cx}" cy="{dy}" r="63" fill="url(#ring)" filter="url(#press)"/>')
A(f'<circle cx="{cx}" cy="{dy}" r="62.4" fill="none" stroke="#fff" stroke-opacity=".08"/>')
for ang, (ax, ay) in [(0, (0, -46)), (90, (46, 0)), (180, (0, 46)), (270, (-46, 0))]:
    A(f'<path d="M0 -5 L5 2.5 L-5 2.5 Z" fill="#e3e3e8" transform="translate({cx+ax},{dy+ay}) rotate({ang})"/>')
A(f'<circle cx="{cx}" cy="{dy}" r="31" fill="#0d0d10"/>')
btn(cx, dy, 28, "url(#ok)"); txt(cx, dy+4.5, "OK", 13, w=700)
# Back / Home / Menu
for x, lab in [(cx-50, "BACK"), (cx, "HOME"), (cx+50, "MENU")]:
    btn(x, 368, 15)
    txt(x, 395, lab, 7.5, op=.7)
A(f'<path d="M{cx-50+4} 362.5 a6 6 0 1 1 0 11 h-6 M{cx-50-4} 367 l-3.5 3.5 3.5 3.5" fill="none" stroke="#d9d9de" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(1,-2.5)"/>')
A(f'<path d="M{cx-7} 369 L{cx} 362 L{cx+7} 369 M{cx-5} 367.5 V375 H{cx+5} V367.5" fill="none" stroke="#d9d9de" stroke-width="1.5" stroke-linejoin="round"/>')
A(f'<path d="M{cx+50-6} 363.5 h12 M{cx+50-6} 368 h12 M{cx+50-6} 372.5 h12" stroke="#d9d9de" stroke-width="1.6" stroke-linecap="round"/>')
# Volume / Channel rockers + mute
def rocker(x, y, lab):
    A(f'<rect x="{x-17}" y="{y-58}" width="34" height="116" rx="17" fill="#0d0d10"/>')
    A(f'<rect x="{x-15}" y="{y-56}" width="30" height="112" rx="15" fill="url(#rocker)" filter="url(#press)"/>')
    A(f'<rect x="{x-14.4}" y="{y-55.4}" width="28.8" height="110.8" rx="14.4" fill="none" stroke="#fff" stroke-opacity=".08"/>')
    A(f'<path d="M{x-5} {y-36} h10 M{x} {y-41} v10" stroke="#e3e3e8" stroke-width="1.8" stroke-linecap="round"/>')
    A(f'<path d="M{x-5} {y+36} h10" stroke="#e3e3e8" stroke-width="1.8" stroke-linecap="round"/>')
    txt(x, y+3, lab, 8, w=700, op=.85)
rocker(cx-50, 486, "VOL"); rocker(cx+50, 486, "CH")
btn(cx, 462, 13)
A(f'<g transform="translate({cx},462)" fill="#d9d9de" stroke="#d9d9de" stroke-width="1.3" stroke-linejoin="round"><path d="M-6 -2.5h3l4-3.5v12l-4-3.5h-3z" stroke="none"/><path d="M3 -3l5 6M8 -3l-5 6" fill="none"/></g>')
btn(cx, 512, 13)
A(f'<g transform="translate({cx},512)" fill="none" stroke="#d9d9de" stroke-width="1.5" stroke-linecap="round"><rect x="-2.6" y="-7" width="5.2" height="9" rx="2.6"/><path d="M-5.5 0a5.5 5.5 0 0 0 11 0M0 5.5v2.5"/></g>')
# Colour keys
for i, c in enumerate(["#e5484d", "#30a46c", "#f5d90a", "#3e63dd"]):
    x = cx - 54 + i * 36
    A(f'<rect x="{x-14}" y="566" width="28" height="11" rx="5.5" fill="#0d0d10"/><rect x="{x-13}" y="566.5" width="26" height="9.5" rx="4.75" fill="{c}" filter="url(#press)"/><rect x="{x-12}" y="567.3" width="24" height="3.5" rx="1.7" fill="#fff" opacity=".25"/>')
# Number pad
nums = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", ""]
for i, n in enumerate(nums):
    if not n: continue
    x = cx - 46 + (i % 3) * 46; y = 604 + (i // 3) * 30
    A(f'<rect x="{x-17}" y="{y-10}" width="34" height="21" rx="10.5" fill="#0d0d10"/>')
    A(f'<rect x="{x-16}" y="{y-9.5}" width="32" height="19.5" rx="9.75" fill="url(#btn)" filter="url(#press)"/>')
    txt(x, y+4, n, 11, w=600)
# Wordmark
A(f'<text x="{cx}" y="{by+bh-28}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="9" font-weight="800" letter-spacing="3.4" fill="#fff" fill-opacity=".38" text-anchor="middle">RIFTGATE</text>')
A('</svg>')
open('remote.svg', 'w').write("\n".join(o))
# button centres for the layout (viewBox coordinates)
print({"MOVE": [cx, dy - 46], "A": [cx, dy], "B": [cx - 50, 368], "MENU": [cx + 50, 368], "VIEW": [cx - 44, 156], "LB": [cx + 50, 522], "RB": [cx + 50, 450], "HOME": [cx, 368]})
