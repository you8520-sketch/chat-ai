import os, sys, json
from PIL import Image, ImageDraw, ImageFont

SRC = "/opt/cursor/artifacts/e43f"
DST = sys.argv[1]
os.makedirs(f"{DST}/compare", exist_ok=True)
FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
LABELS = {"before": "BEFORE (main d981d1c0)", "a": "A  Quiet Creator Studio", "b": "B  Guided Creator Studio"}
BG = (11, 13, 22)
SMALL = ImageFont.truetype("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", 22)


def load(variant, name, scale):
    folder = f"final-{variant}" if name.startswith("limit-") else variant
    im = Image.open(f"{SRC}/{folder}/{name}.png").convert("RGB")
    if scale != 1:
        im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
    return im


def compare(out, name, scale=1.0, variants=("before", "a", "b"), maxh=None):
    ims = [(v, load(v, name, scale)) for v in variants]
    if maxh:
        ims = [(v, im.crop((0, 0, im.width, min(im.height, maxh)))) for v, im in ims]
    gap, head = 24, 56
    w = sum(im.width for _, im in ims) + gap * (len(ims) + 1)
    h = max(im.height for _, im in ims) + head + gap
    canvas = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(canvas)
    x = gap
    for v, im in ims:
        d.text((x, 12), LABELS[v], fill=(230, 230, 240), font=FONT)
        canvas.paste(im, (x, head))
        x += im.width + gap
    path = f"{DST}/compare/{out}.webp"
    canvas.save(path, "WEBP", quality=90, method=6)
    print(out, canvas.size, os.path.getsize(path) // 1024, "KB")


def timeline(out, names, labels, variant_rows=("before", "a", "b"), scale=0.55):
    rows = []
    for v in variant_rows:
        ims = [load(v, n, scale) for n in names]
        rows.append((v, ims))
    gap, head, rowhead = 20, 44, 40
    colw = rows[0][1][0].width
    colh = rows[0][1][0].height
    w = (colw + gap) * len(names) + gap
    h = head + (colh + rowhead + gap) * len(rows) + gap
    canvas = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(canvas)
    for i, lab in enumerate(labels):
        d.text((gap + i * (colw + gap), 8), f"{i + 1}. {lab}", fill=(230, 230, 240), font=SMALL)
    y = head
    for v, ims in rows:
        d.text((gap, y + 4), LABELS[v], fill=(250, 204, 21), font=FONT)
        for i, im in enumerate(ims):
            canvas.paste(im, (gap + i * (colw + gap), y + rowhead))
        y += colh + rowhead + gap
    path = f"{DST}/compare/{out}.webp"
    canvas.save(path, "WEBP", quality=90, method=6)
    print(out, canvas.size, os.path.getsize(path) // 1024, "KB")


# 390 full create screen (valid, 12,000) and empty
compare("01-create-390-full-valid12000", "new-valid12000-390-full", scale=0.5)
compare("02-create-390-full-empty", "new-empty-390-full", scale=0.5)
compare("03-create-390-top-valid12000", "new-valid12000-390-top", scale=0.6)
compare("04-create-390-top-empty", "new-empty-390-top", scale=0.6)
compare("05-create-768-top-valid12000", "new-valid12000-768-top", scale=0.6)
compare("06-create-768-full-valid12000", "new-valid12000-768-full", scale=0.4)
compare("07-create-1440-top-valid12000", "new-valid12000-1440-top", scale=0.55)
compare("08-create-1440-top-empty", "new-empty-1440-top", scale=0.55)
compare("09-create-1440-full-valid12000", "new-valid12000-1440-full", scale=0.3)
# long text
compare("10-long-12000-input-390", "long-12000-390-viewport", scale=0.6)
compare("11-long-12000-input-1440", "long-12000-1440-viewport", scale=0.55)
compare("12-over-12000-390", "limit-12000-before-save-390-viewport", scale=0.6)
compare("12b-limit-12001-before-save-390", "limit-12001-before-save-390-viewport", scale=0.6)
compare("13-over-12001-rejected-390", "over-12001-390-viewport", scale=0.6)
# preview
compare("14-preview-tab-390", "tab-preview-390-viewport", scale=0.6)
compare("15-preview-tab-1440", "tab-preview-1440-viewport", scale=0.55)
# image management
compare("16-images-many-390", "images-many-390-viewport", scale=0.6)
compare("17-images-rep-change-390", "images-rep-change-390-viewport", scale=0.6)
compare("18-images-none-390", "images-none-390-viewport", scale=0.6)
compare("19-images-one-390", "images-one-390-viewport", scale=0.6)
compare("20-images-many-1440", "images-many-1440-viewport", scale=0.55)
# status widget
compare("21-widget-basic-390", "widget-basic-390-viewport", scale=0.6)
compare("22-widget-direct-390", "widget-direct-390-viewport", scale=0.6)
compare("23-widget-tab-390-full", "tab-widget-390-full", scale=0.5)
# save / draft / publish bar
compare("24-save-bar-missing-required-390", "missing-required-390-top", scale=0.6)
compare("25-save-bar-name-empty-submit-390", "submit-name-empty-390-viewport", scale=0.6)
compare("26-draft-saved-390", "draft-saved-390-viewport", scale=0.6)
compare("27-draft-restored-390", "draft-restored-390-viewport", scale=0.6)
compare("28-publish-tab-390", "tab-publish-390-viewport", scale=0.6)
compare("29-publish-tab-1440", "tab-publish-1440-viewport", scale=0.55)
# keyboard
compare("30-keyboard-open-textarea-390", "keyboard-open-390-viewport", scale=0.6)
compare("31-keyboard-open-short-field-390", "keyboard-short-field-390-viewport", scale=0.6)
# edit mode
compare("32-edit-full-390-top", "edit-full-390-top", scale=0.6)
compare("33-edit-noimg-390-top", "edit-noimg-390-top", scale=0.6)
compare("34-edit-minor-390-top", "edit-minor-390-top", scale=0.6)
compare("35-edit-long-390-top", "edit-long-390-top", scale=0.6)
# scrolled sticky tabs
compare("36-sticky-tabs-scrolled-390", "tabs-scrolled-390-viewport", scale=0.6)

# time-ordered scenes
timeline(
    "40-timeline-tab-switch-390",
    ["tab-create-390-viewport", "tab-preview-390-viewport", "tab-widget-390-viewport", "tab-publish-390-viewport"],
    ["제작", "공개 소개", "상태창", "공개 설정"],
)
timeline(
    "41-timeline-keyboard-390",
    ["new-valid12000-390-top", "keyboard-short-field-390-viewport", "keyboard-open-390-viewport", "over-12001-390-viewport"],
    ["initial", "short field + keyboard", "textarea + keyboard", "12,001 rejected"],
)
timeline(
    "42-timeline-save-draft-390",
    ["missing-required-390-top", "submit-name-empty-390-viewport", "draft-saved-390-viewport", "draft-restored-390-viewport"],
    ["missing required", "submit, empty name", "draft saved", "draft restored"],
)

# rail scenes (B only)
for w, h in [(1024, 800), (1280, 720), (1440, 900)]:
    src = f"{SRC}/b/rail-{w}x{h}-y900-viewport.png"
    Image.open(src).convert("RGB").save(f"{DST}/compare/50-b-guide-rail-{w}x{h}.webp", "WEBP", quality=90, method=6)
