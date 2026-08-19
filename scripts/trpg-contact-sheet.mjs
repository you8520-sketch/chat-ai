#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = path.join(ROOT, "public/d20-result/d20-result-base.webp");
const OUT_DIR = "/opt/cursor/artifacts";
const FACES = [1, 2, 4, 9, 10, 11, 16, 19, 20];
const CELL = 768;
const PAD = 48;
const COLS = 3;

function tone(face) {
  if (face === 1) return "nat1";
  if (face === 20) return "nat20";
  return "normal";
}

function numeralColor(face) {
  const t = tone(face);
  if (t === "nat20") return "#f0dc9a";
  if (t === "nat1") return "#d98a92";
  return "#e6d3a3";
}

function numeralSvg(face) {
  const twoDigit = face >= 10;
  const displayPx = 218;
  const scale = CELL / displayPx;
  const fontSize = Math.round((twoDigit ? 104 : 128) * scale);
  const letterSpacing = twoDigit ? "-0.04em" : "0";
  const color = numeralColor(face);
  const y = Math.round(CELL * 0.52);
  return Buffer.from(`<svg width="${CELL}" height="${CELL}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.65)"/>
      <feDropShadow dx="0" dy="0" stdDeviation="9" flood-color="rgba(230,211,163,0.28)"/>
    </filter>
  </defs>
  <text x="50%" y="${y}" text-anchor="middle" dominant-baseline="middle"
    font-family="Georgia, 'Times New Roman', serif" font-weight="600" font-size="${fontSize}px"
    fill="${color}" letter-spacing="${letterSpacing}" filter="url(#shadow)">${face}</text>
</svg>`);
}

async function renderFace(face) {
  const svg = numeralSvg(face);
  return sharp(BASE)
    .composite([{ input: svg, top: 0, left: 0 }])
    .png()
    .toBuffer();
}

async function bodyMask() {
  const { data, info } = await sharp(BASE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cx = info.width / 2;
  const cy = info.height / 2;
  const r = info.width * 0.16;
  const mask = Buffer.alloc(info.width * info.height);
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const insideNumeral = dx * dx + dy * dy <= r * r;
      mask[y * info.width + x] = insideNumeral ? 0 : 1;
    }
  }
  return { mask, width: info.width, height: info.height };
}

async function compareBodies(tiles, maskInfo, baseRaw) {
  for (const tile of tiles) {
    let diff = 0;
    for (let p = 0; p < maskInfo.mask.length; p++) {
      if (!maskInfo.mask[p]) continue;
      const o = p * 4;
      if (
        baseRaw[o] !== tile.raw[o] ||
        baseRaw[o + 1] !== tile.raw[o + 1] ||
        baseRaw[o + 2] !== tile.raw[o + 2] ||
        baseRaw[o + 3] !== tile.raw[o + 3]
      ) {
        diff++;
      }
    }
    if (diff > 0) {
      throw new Error(`body pixels differ for face ${tile.face}: ${diff} mismatches outside numeral disc`);
    }
  }
  return true;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tiles = [];
  for (const face of FACES) {
    const png = await renderFace(face);
    tiles.push({ face, png });
  }

  const rows = Math.ceil(FACES.length / COLS);
  const sheetW = COLS * CELL + (COLS + 1) * PAD;
  const sheetH = rows * CELL + (rows + 1) * PAD + 56;
  const composites = [];
  const labelSvgParts = [];

  tiles.forEach((tile, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const left = PAD + col * (CELL + PAD);
    const top = PAD + row * (CELL + PAD);
    composites.push({ input: tile.png, left, top });
    labelSvgParts.push(
      `<text x="${left + CELL / 2}" y="${top + CELL + 34}" text-anchor="middle" fill="#d6c7a1" font-family="Georgia, serif" font-size="28">${tile.face}</text>`
    );
  });

  const backdrop = `<svg width="${sheetW}" height="${sheetH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#0b0a0f"/>
    ${labelSvgParts.join("\n")}
  </svg>`;

  const outPath = path.join(OUT_DIR, "d20_contact_sheet_1_2_4_9_10_11_16_19_20.png");
  await sharp(Buffer.from(backdrop))
    .composite(composites)
    .png()
    .toFile(outPath);

  console.log(JSON.stringify({ outPath, faces: FACES, baseAsset: BASE }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
