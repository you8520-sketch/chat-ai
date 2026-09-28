import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { squareCropRect } from "./worldCoverCrop";
import {
  parseWorldStudioKind,
  sanitizeWorldCoverUrl,
  worldContentBundleCharCount,
  worldPrivatePromptContent,
} from "./worlds";

describe("world private setting helpers", () => {
  it("counts public + secret settings under one shared limit without a secret-only cap", () => {
    assert.equal(worldContentBundleCharCount("가".repeat(6_000), "나".repeat(4_000)), 10_000);
    assert.equal(worldContentBundleCharCount(" 본문 ", " 비밀 "), 4);
  });

  it("labels secret settings only in private AI prompt material", () => {
    assert.equal(worldPrivatePromptContent("공개 세계", ""), "공개 세계");
    const combined = worldPrivatePromptContent("공개 세계", "왕은 이미 죽었다.");
    assert.match(combined, /공개 세계/);
    assert.match(combined, /비밀 설정 — AI 전용/);
    assert.match(combined, /왕은 이미 죽었다/);
  });
});

describe("world cover helpers", () => {
  it("accepts app uploads and public Vercel Blob uploads", () => {
    assert.equal(sanitizeWorldCoverUrl("/uploads/abc-123.webp"), "/uploads/abc-123.webp");
    assert.equal(
      sanitizeWorldCoverUrl(
        "https://example.public.blob.vercel-storage.com/uploads/abc-123.webp",
      ),
      "https://example.public.blob.vercel-storage.com/uploads/abc-123.webp",
    );
    assert.equal(sanitizeWorldCoverUrl(""), "");
    assert.equal(sanitizeWorldCoverUrl("https://evil.example/x.png"), "");
    assert.equal(sanitizeWorldCoverUrl("/uploads/../secret.png"), "");
  });

  it("center-crops landscape and portrait to a square", () => {
    assert.deepEqual(squareCropRect(1200, 800), { sx: 200, sy: 0, size: 800 });
    assert.deepEqual(squareCropRect(600, 1000), { sx: 0, sy: 200, size: 600 });
    assert.deepEqual(squareCropRect(512, 512), { sx: 0, sy: 0, size: 512 });
  });

  it("parses the world/scenario studio tab", () => {
    assert.equal(parseWorldStudioKind("scenario"), "scenario");
    assert.equal(parseWorldStudioKind("trpg"), "scenario");
    assert.equal(parseWorldStudioKind("world"), "world");
    assert.equal(parseWorldStudioKind(null), "world");
  });
});
