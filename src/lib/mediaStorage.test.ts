import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { filenameFromPrivateMediaUrl, storePrivateMedia } from "@/lib/mediaStorage";

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

describe("mediaStorage", () => {
  const previous = process.env.DATA_DIR;
  let dataDir = "";

  before(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hav-media-"));
    process.env.DATA_DIR = dataDir;
  });

  after(() => {
    if (previous == null) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("writes private originals and public/blur renditions without blob", async () => {
    const stored = await storePrivateMedia(PIXEL_PNG, "image/png", 42);
    assert.equal(stored.url.startsWith("/media/private/"), true);
    assert.equal(stored.publicRenditionUrl.startsWith("/media/public/"), true);
    assert.equal(stored.blurPreviewUrl.startsWith("/media/public/"), true);
    assert.equal(filenameFromPrivateMediaUrl(stored.url) != null, true);
    assert.equal(fs.existsSync(stored.localPath), true);
    assert.equal(stored.publicRenditionUrl.includes("/media/private/"), false);
  });
});
