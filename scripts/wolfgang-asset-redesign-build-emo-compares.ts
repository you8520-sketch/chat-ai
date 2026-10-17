import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DOC = path.join(process.cwd(), "docs/official-supply/reviews/assets/wolfgang-asset-redesign");
const ART = "/opt/cursor/artifacts";
const F = path.join(DOC, "rep-f-raw.webp");

const candidates = {
  anger: {
    label: "anger",
    file: path.join(DOC, "emo2-anger-f-raw.webp"),
    windows: {
      face: { left: 420, top: 60, width: 400, height: 400 },
      hair: { left: 460, top: 0, width: 340, height: 260 },
      fur: { left: 0, top: 260, width: 300, height: 240 },
      armor: { left: 380, top: 420, width: 460, height: 340 },
    },
  },
  relief: {
    label: "relief",
    file: path.join(DOC, "emo6-relief-f-raw.webp"),
    windows: {
      face: { left: 560, top: 90, width: 380, height: 380 },
      hair: { left: 600, top: 0, width: 300, height: 220 },
      fur: { left: 60, top: 280, width: 260, height: 220 },
      armor: { left: 500, top: 440, width: 420, height: 320 },
    },
  },
} as const;

const fWindows = {
  face: { left: 280, top: 160, width: 460, height: 460 },
  hair: { left: 300, top: 0, width: 420, height: 360 },
  fur: { left: 10, top: 520, width: 180, height: 180 },
  armor: { left: 340, top: 700, width: 340, height: 260 },
} as const;

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function labeled(buf: Buffer, label: string, width: number, height: number) {
  const bar = await sharp({ create: { width, height: 32, channels: 3, background: "#111111" } })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${width}" height="32"><text x="8" y="22" font-size="16" fill="#ffffff" font-family="sans-serif">${label}</text></svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
  return sharp({ create: { width, height: height + 32, channels: 3, background: "#000" } })
    .composite([
      { input: bar, top: 0, left: 0 },
      { input: buf, top: 32, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function pair(items: Array<{ label: string; buf: Buffer; width: number; height: number }>) {
  const cells = await Promise.all(items.map((item) => labeled(item.buf, item.label, item.width, item.height)));
  const width = items.reduce((sum, item) => sum + item.width, 0);
  const height = Math.max(...items.map((item) => item.height)) + 32;
  let left = 0;
  const placed = items.map((item, index) => {
    const out = { input: cells[index], top: 0, left };
    left += item.width;
    return out;
  });
  return sharp({ create: { width, height, channels: 3, background: "#000" } })
    .composite(placed)
    .webp({ quality: 90 })
    .toBuffer();
}

async function buildOne(key: keyof typeof candidates) {
  const candidate = candidates[key];
  const outputs: Record<string, unknown> = {};
  const fFull = await sharp(F).resize(512, 768, { fit: "fill" }).webp({ quality: 90 }).toBuffer();
  const cFull = await sharp(candidate.file).resize(768, 512, { fit: "fill" }).webp({ quality: 90 }).toBuffer();
  const full = await pair([
    { label: "F 0.5x 1024x1536", buf: fFull, width: 512, height: 768 },
    { label: `${candidate.label} 0.5x 1536x1024`, buf: cFull, width: 768, height: 512 },
  ]);
  const fullName = `compare-${candidate.label}-f-full.webp`;
  fs.writeFileSync(path.join(DOC, fullName), full);
  fs.writeFileSync(path.join(ART, fullName), full);
  outputs[fullName] = { sha256: sha256(full), bytes: full.length };

  for (const [name, box] of Object.entries(candidate.windows)) {
    const fBox = fWindows[name as keyof typeof fWindows];
    const fBuf = await sharp(F).extract(fBox).webp({ quality: 92 }).toBuffer();
    const cBuf = await sharp(candidate.file).extract(box).webp({ quality: 92 }).toBuffer();
    const image = await pair([
      { label: `F 1:1 ${fBox.width}x${fBox.height}`, buf: fBuf, width: fBox.width, height: fBox.height },
      {
        label: `${candidate.label} 1:1 ${box.width}x${box.height}`,
        buf: cBuf,
        width: box.width,
        height: box.height,
      },
    ]);
    const file = `compare-${candidate.label}-f-${name}.webp`;
    fs.writeFileSync(path.join(DOC, file), image);
    fs.writeFileSync(path.join(ART, file), image);
    outputs[file] = { sha256: sha256(image), bytes: image.length, window: { F: fBox, candidate: box } };
  }

  const record = {
    candidate: key,
    windows: { F: fWindows, candidate: candidate.windows },
    outputs,
  };
  const jsonName = `compare-${candidate.label}-f-windows.json`;
  const text = `${JSON.stringify(record, null, 2)}\n`;
  fs.writeFileSync(path.join(DOC, jsonName), text);
  fs.writeFileSync(path.join(ART, jsonName), text);
}

async function main() {
  await buildOne("anger");
  await buildOne("relief");
  console.log("done");
}

main();
