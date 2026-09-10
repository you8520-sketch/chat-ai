import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { UploadImageError, optimizeUploadImage } from "./uploadImageOptimize";

function png(width: number, height: number, alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha
        ? { r: 10, g: 120, b: 240, alpha: 0.4 }
        : { r: 20, g: 40, b: 60 },
    },
  })
    .png()
    .toBuffer();
}

describe("optimizeUploadImage — canonical WebP normalization + validation", () => {
  it("keeps animated GIF bytes unchanged", async () => {
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    const out = await optimizeUploadImage(gif, "image/gif");
    assert.equal(out.mime, "image/gif");
    assert.equal(out.ext, "gif");
    assert.ok(out.buffer.equals(gif));
  });

  it("normalizes PNG to canonical WebP without changing dimensions", async () => {
    const input = await png(640, 960);
    const out = await optimizeUploadImage(input, "image/png");
    assert.equal(out.mime, "image/webp");
    assert.equal(out.ext, "webp");
    const metadata = await sharp(out.buffer).metadata();
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 960);
    assert.equal(metadata.format, "webp");
  });

  it("accepts landscape / portrait / square / unusual ratios unchanged", async () => {
    for (const [w, h] of [[1600, 900], [900, 1600], [1000, 1000], [2000, 213]] as const) {
      const out = await optimizeUploadImage(await png(w, h), "image/png");
      const metadata = await sharp(out.buffer).metadata();
      assert.equal(metadata.width, w, `${w}x${h} width`);
      assert.equal(metadata.height, h, `${w}x${h} height`);
    }
  });

  it("preserves alpha through the WebP normalization", async () => {
    const input = await png(128, 128, true);
    const out = await optimizeUploadImage(input, "image/png");
    const metadata = await sharp(out.buffer).metadata();
    assert.equal(metadata.hasAlpha, true);
  });

  it("normalizes JPEG to WebP and records before/after bytes", async () => {
    const input = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg({ quality: 92 })
      .toBuffer();
    const out = await optimizeUploadImage(input, "image/jpeg");
    assert.equal(out.mime, "image/webp");
    assert.equal(out.ext, "webp");
    // Recorded for the report; canonical WebP must be sane size.
    assert.ok(out.buffer.length > 0);
    assert.ok(input.length > 0);
  });

  it("applies EXIF orientation (no sideways storage)", async () => {
    const input = await sharp({
      create: { width: 100, height: 50, channels: 3, background: { r: 30, g: 30, b: 30 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await optimizeUploadImage(input, "image/jpeg");
    const metadata = await sharp(out.buffer).metadata();
    // Orientation 6 => 90° CW => 50x100 after auto-orient.
    assert.equal(metadata.width, 50);
    assert.equal(metadata.height, 100);
  });

  it("rejects corrupt input", async () => {
    await assert.rejects(
      () => optimizeUploadImage(Buffer.from("definitely not an image"), "image/png"),
      (err: unknown) => err instanceof UploadImageError
    );
  });

  it("rejects MIME/content mismatch (declared JPEG but PNG bytes)", async () => {
    const input = await png(64, 64);
    await assert.rejects(
      () => optimizeUploadImage(input, "image/jpeg"),
      (err: unknown) => err instanceof UploadImageError
    );
  });

  it("rejects excessive decoded dimensions", async () => {
    const huge = await sharp({
      create: { width: 13000, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    await assert.rejects(
      () => optimizeUploadImage(huge, "image/png"),
      (err: unknown) => err instanceof UploadImageError
    );
  });
});