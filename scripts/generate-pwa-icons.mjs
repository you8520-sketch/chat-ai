import sharp from "sharp";
import { copyFile, mkdir } from "node:fs/promises";

const source = "public/icons/icon-door-source.png";

function roundedMask(size) {
  const radius = Math.round(size * 0.22);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${radius}" fill="white"/>
    </svg>
  `);
}

await mkdir("public/icons", { recursive: true });

await Promise.all([
  sharp(source)
    .resize(192, 192)
    .composite([{ input: roundedMask(192), blend: "dest-in" }])
    .png()
    .toFile("public/icons/icon-door-v2-192.png"),
  sharp(source)
    .resize(512, 512)
    .composite([{ input: roundedMask(512), blend: "dest-in" }])
    .png()
    .toFile("public/icons/icon-door-v2-512.png"),
  // Android applies its own adaptive mask. Keep every edge opaque and square.
  sharp(source).resize(512, 512).png().toFile("public/icons/icon-door-v2-maskable-512.png"),
  // iOS applies its own corner mask, so the touch icon also stays fully opaque.
  sharp(source).resize(180, 180).png().toFile("public/icons/apple-touch-icon-door-v2.png"),
]);

// Keep legacy URLs working for old service workers and external bookmarks,
// but serve the current door artwork from every historical brand-icon path.
await Promise.all([
  copyFile("public/icons/icon-door-v2-192.png", "public/icons/icon-192.png"),
  copyFile("public/icons/icon-door-v2-512.png", "public/icons/icon-512.png"),
  copyFile("public/icons/icon-door-v2-maskable-512.png", "public/icons/icon-maskable-512.png"),
  copyFile("public/icons/apple-touch-icon-door-v2.png", "public/icons/apple-touch-icon.png"),
]);
