import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { optimizeUploadImage } from "./uploadImageOptimize";

describe("optimizeUploadImage", () => {
  it("keeps GIF bytes unchanged", async () => {
    // Minimal 1x1 GIF
    const gif = Buffer.from(
      "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      "base64"
    );
    const out = await optimizeUploadImage(gif, "image/gif");
    assert.equal(out.mime, "image/gif");
    assert.equal(out.ext, "gif");
    assert.ok(out.buffer.equals(gif));
  });

  it("never returns a larger buffer than the original for PNG", async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 40, b: 60 } },
    })
      .png()
      .toBuffer();
    const out = await optimizeUploadImage(png, "image/png");
    assert.ok(out.buffer.length <= png.length);
    assert.ok(["image/png", "image/webp"].includes(out.mime));
  });

  it("may convert JPEG to smaller lossless WebP, else keep original size bound", async () => {
    const jpeg = await sharp({
      create: { width: 48, height: 48, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const out = await optimizeUploadImage(jpeg, "image/jpeg");
    assert.ok(out.buffer.length <= jpeg.length);
  });
});
