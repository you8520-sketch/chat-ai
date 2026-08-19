#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASE = path.join(ROOT, "public/d20-result/obsidian-royal.webp");
const OUT_DIR = "/opt/cursor/artifacts";
const FACES = [1, 2, 4, 9, 10, 11, 16, 19, 20];
const CELL = 768;
const PAD = 48;
const COLS = 3;

// Cinzel variable font installed system-wide; reference by family name.
const FONT_FAMILY = "Cinzel";

// Die geometry measured from the base asset: die ~589x671 in 768 canvas.
// Front triangular face height ≈ 30% of die height ≈ 201px.
// Reference spec: numeral = 55–65% of face height (~201px) → visual digit height ~120px.
// Cinzel digit cap height ≈ 0.5× font-size, so font-size ≈ 2× target → single 240px, double 192px.
const FACE_CENTER = { x: 385, y: 372 };
const SINGLE_PX = 240;
const DOUBLE_PX = 192;

function tone(face) {
  if (face === 1) return "nat1";
  if (face === 20) return "nat20";
  return "normal";
}

// Metallic pearl-gold gradient stops (reference: "pearl-gold numeral").
function numeralGradient(face) {
  const t = tone(face);
  if (t === "nat1") {
    return { id: "nat1grad", stops: [
      ["0%", "#f5c8c8"], ["38%", "#e08a92"], ["72%", "#b8525a"], ["100%", "#8a2a3a"]
    ]};
  }
  if (t === "nat20") {
    return { id: "nat20grad", stops: [
      ["0%", "#fff6d8"], ["35%", "#f5e0a8"], ["70%", "#e8c56a"], ["100%", "#b8862a"]
    ]};
  }
  return { id: "goldgrad", stops: [
    ["0%", "#fff8e0"], ["30%", "#f0e0b0"], ["62%", "#d4b56a"], ["100%", "#9a7838"]
  ]};
}

function numeralSvg(face) {
  const twoDigit = face >= 10;
  const fontSize = twoDigit ? DOUBLE_PX : SINGLE_PX;
  const letterSpacing = twoDigit ? "-0.02em" : "0";
  const grad = numeralGradient(face);
  const cx = FACE_CENTER.x;
  const cy = FACE_CENTER.y + Math.round(fontSize * 0.05);
  const stops = grad.stops.map(([off, col]) => `<stop offset="${off}" stop-color="${col}"/>`).join("");
  return Buffer.from(`<svg width="${CELL}" height="${CELL}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="${grad.id}" x1="0" y1="0" x2="0" y2="1">
      ${stops}
    </linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff8e0" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#fff8e0" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#1a1206" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="engrave" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="blur"/>
      <feSpecularLighting in="blur" result="spec" lighting-color="#fff4d0" surfaceScale="2.4" specularConstant="0.9" specularExponent="22">
        <feDistantLight azimuth="305" elevation="55"/>
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOnly"/>
      <feMerge>
        <feMergeNode in="SourceGraphic"/>
        <feMergeNode in="specOnly"/>
      </feMerge>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
    font-family="${FONT_FAMILY}" font-weight="900" font-size="${fontSize}px"
    letter-spacing="${letterSpacing}"
    fill="url(#${grad.id})" stroke="#1a1206" stroke-width="1.4"
    filter="url(#engrave)">${face}</text>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
    font-family="${FONT_FAMILY}" font-weight="900" font-size="${fontSize}px"
    letter-spacing="${letterSpacing}"
    fill="url(#rim)" opacity="0.5">${face}</text>
</svg>`);
}

async function renderFace(face) {
  const svg = numeralSvg(face);
  return sharp(BASE)
    .composite([{ input: svg, top: 0, left: 0, blend: "over" }])
    .png()
    .toBuffer();
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

  console.log(JSON.stringify({ outPath, faces: FACES, baseAsset: BASE, numeralFont: "Cinzel Black", singlePx: SINGLE_PX, doublePx: DOUBLE_PX }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
