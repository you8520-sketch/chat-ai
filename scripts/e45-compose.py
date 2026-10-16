import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = "/tmp/e45-shots"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/e45-evidence"
B, A = "m1", "a2"
os.makedirs(OUT, exist_ok=True)
M = {l: json.load(open(f"{ROOT}/{l}/measure.json")) for l in (B, A)}
S = {l: json.load(open(f"{ROOT}/{l}/states.json")) for l in (B, A, "m1pay", "a2pay")}
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
SMALL = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
RED, GREEN, CYAN, YELLOW = (255, 64, 64), (64, 255, 128), (0, 220, 255), (255, 220, 0)


def dsf(width):
    return 2 if width < 576 else 1


def shot(label, name, width):
    return Image.open(f"{ROOT}/{label}/{name}-{width}.png").convert("RGB")


def label_bar(im, text, color):
    bar = Image.new("RGB", (im.width, 40), (20, 20, 28))
    ImageDraw.Draw(bar).text((10, 8), text, fill=color, font=FONT)
    out = Image.new("RGB", (im.width, im.height + 40))
    out.paste(bar, (0, 0))
    out.paste(im, (0, 40))
    return out


def annotate(im, label, name, width, header=True, lines=True):
    m = M[label][f"{name}-{width}"]
    d = ImageDraw.Draw(im)
    s = dsf(width)
    if header:
        y = int(m["header"]["b"] * s)
        d.line([(0, y), (im.width, y)], fill=RED, width=3)
        d.rectangle([im.width - 330, y + 4, im.width - 4, y + 34], fill=(0, 0, 0))
        d.text((im.width - 322, y + 8), f"header {m['header']['h']:.0f}px", fill=RED, font=SMALL)
    if lines and m.get("main"):
        x = int(m["main"]["l"] * s)
        d.line([(x, 0), (x, im.height)], fill=CYAN, width=2)
        if m.get("h1"):
            hx = int(m["h1"]["l"] * s)
            d.line([(hx, 0), (hx, im.height)], fill=GREEN if abs(hx - x) <= 2 else YELLOW, width=2)
            d.rectangle([min(hx, im.width - 300) + 4, im.height - 70, min(hx, im.width - 300) + 296, im.height - 4], fill=(0, 0, 0))
            d.text((min(hx, im.width - 300) + 8, im.height - 66), f"main.left {m['main']['l']:.1f}", fill=CYAN, font=SMALL)
            d.text((min(hx, im.width - 300) + 8, im.height - 38), f"title.left {m['h1']['l']:.1f}", fill=GREEN if abs(hx - x) <= 2 else YELLOW, font=SMALL)
    return im


def row(panels, out, gap=12):
    h = max(p.height for p in panels)
    w = sum(p.width for p in panels) + gap * (len(panels) - 1)
    sheet = Image.new("RGB", (w, h), (255, 0, 255))
    x = 0
    for p in panels:
        sheet.paste(p, (x, 0))
        x += p.width + gap
    sheet.save(f"{OUT}/{out}")
    print(out, sheet.size)


def ba(name, width, title_b=None, title_a=None, **kw):
    mb, ma = M[B][f"{name}-{width}"], M[A][f"{name}-{width}"]
    pb = label_bar(annotate(shot(B, name, width), B, name, width, **kw), title_b or f"BEFORE  header {mb['header']['h']:.0f}px", RED)
    pa = label_bar(annotate(shot(A, name, width), A, name, width, **kw), title_a or f"AFTER  header {ma['header']['h']:.0f}px", GREEN)
    return pb, pa


def crop(panels, box):
    return [p.crop(box) for p in panels]


# 01 home 390 (guest + user)
pb, pa = ba("home-user", 390)
gb, ga = ba("home-guest", 390)
row([pb, pa, gb, ga], "01-mobile-home-390-before-after.png")

# 02 search + ranking 390
sb, sa = ba("search-user", 390)
rb, ra = ba("ranking-user", 390)
row([sb, sa, rb, ra], "02-mobile-search-ranking-390-before-after.png")

# 03 studio 390
tb, ta = ba("studio", 390)
nb, na = ba("search-user", 390)
row([tb, ta], "03-mobile-studio-390-before-after.png")

# 04 points 390
pob, poa = ba("points", 390)
row([pob, poa], "04-mobile-points-390-before-after.png")

# 05 creator public 390
cb, ca = ba("creator-public", 390)
row([cb, ca], "05-mobile-creator-public-390-before-after.png")

# 06 header states (guest / user / user+payments+long balance) 360 & 390
def hdr(label, state, width, pay=False):
    key = {"m1": "m1pay", "a2": "a2pay"}[label] if pay else label
    return Image.open(f"{ROOT}/{key}/hdr-{state}-{width}.png").convert("RGB")


def hdr_cell(state, width, pay, title):
    b = hdr(B, state, width, pay)
    a = hdr(A, state, width, pay)
    hb = S["m1pay" if pay else B][f"{state}-{width}"]["h"]
    ha = S["a2pay" if pay else A][f"{state}-{width}"]["h"]
    cb = label_bar(b, f"BEFORE {title} {width}px  header {hb}px", RED)
    ca = label_bar(a, f"AFTER  {title} {width}px  header {ha}px", GREEN)
    return cb, ca


cells = []
for width in (390, 360):
    for state, pay, title in (("guest", False, "guest"), ("user", False, "user"), ("user", True, "user+shop"), ("user-long", True, "user+shop+long")):
        cb_, ca_ = hdr_cell(state, width, pay, title)
        cells.append((cb_, ca_))
rows = []
for cb_, ca_ in cells:
    r = Image.new("RGB", (cb_.width * 2 + 12, cb_.height), (255, 0, 255))
    r.paste(cb_, (0, 0))
    r.paste(ca_, (cb_.width + 12, 0))
    rows.append(r)
H = sum(r.height for r in rows) + 12 * (len(rows) - 1)
sheet = Image.new("RGB", (rows[0].width, H), (255, 0, 255))
y = 0
for r in rows:
    sheet.paste(r, (0, y))
    y += r.height + 12
sheet.save(f"{OUT}/06-header-states-guest-user-shop-long-before-after.png")
print("06", sheet.size)

# 07 narrow 360 header with full viewport (home)
b7, a7 = ba("home-user", 360)
row([b7, a7], "07-narrow-360-home-before-after.png")

# 08 575 / 576 boundary
panels = []
for w in (575, 576):
    for nm in ("home-user",):
        pb_, pa_ = ba(nm, w)
        panels += [pb_.crop((0, 0, pb_.width, 520)), pa_.crop((0, 0, pa_.width, 520))]
row(panels, "08-boundary-575-576-before-after.png")

# 09 1023 / 1024 boundary
panels = []
for w in (1023, 1024):
    pb_, pa_ = ba("home-user", w)
    panels += [pb_.crop((0, 0, pb_.width, 420)), pa_.crop((0, 0, pa_.width, 420))]
rows = [Image.new("RGB", (panels[0].width * 2 + 12, panels[0].height), (255, 0, 255)) for _ in range(2)]
for i, r in enumerate(rows):
    r.paste(panels[i * 2], (0, 0))
    r.paste(panels[i * 2 + 1], (panels[0].width + 12, 0))
sheet = Image.new("RGB", (rows[0].width, rows[0].height * 2 + 12), (255, 0, 255))
sheet.paste(rows[0], (0, 0))
sheet.paste(rows[1], (0, rows[0].height + 12))
sheet.save(f"{OUT}/09-boundary-1023-1024-before-after.png")
print("09", sheet.size)

# 10 desktop 1440
b10, a10 = ba("ranking-user", 1440)
rows = Image.new("RGB", (b10.width, b10.height * 2 + 12), (255, 0, 255))
rows.paste(b10, (0, 0))
rows.paste(a10, (0, b10.height + 12))
rows.save(f"{OUT}/10-desktop-1440-ranking-before-after.png")
print("10", rows.size)

# 11 left baseline overlays
def baseline_sheet(width, names, out, crop_h):
    rows = []
    for nm in names:
        pb_, pa_ = ba(nm, width, title_b=f"BEFORE {nm}", title_a=f"AFTER {nm}", header=False)
        s = dsf(width)
        pb_ = pb_.crop((0, 0, pb_.width, 40 + crop_h * s))
        pa_ = pa_.crop((0, 0, pa_.width, 40 + crop_h * s))
        r = Image.new("RGB", (pb_.width * 2 + 12, pb_.height), (255, 0, 255))
        r.paste(pb_, (0, 0))
        r.paste(pa_, (pb_.width + 12, 0))
        rows.append(r)
    sheet = Image.new("RGB", (rows[0].width, sum(r.height for r in rows) + 12 * (len(rows) - 1)), (255, 0, 255))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 12
    sheet.save(f"{OUT}/{out}")
    print(out, sheet.size)


baseline_sheet(1440, ["search-user", "ranking-user", "studio", "creator-dash", "creator-public", "settings", "persona", "points"], "11a-left-baseline-1440-before-after.png", 330)
baseline_sheet(390, ["search-user", "studio", "creator-dash", "creator-public", "settings", "points"], "11b-left-baseline-390-before-after.png", 330)
baseline_sheet(1000, ["creator-dash", "settings", "persona"], "11c-left-baseline-1000-tablet.png", 330) if f"creator-dash-1000" in M[B] else None
