import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adminAuthorPreviewExportJson, type AdminAuthorPreviewExport } from "@/lib/officialSupply/adminAuthorPreviewExport";

const preview: AdminAuthorPreviewExport = {
  previewId: "abc",
  qaOk: false,
  issues: [{ code: "sfw_public_text_has_adult_terms", message: "all-ages public text contains adult terms" }],
  repairable: false,
  voiceRepairs: 0,
  textLock: "bb65bc713ed1deadbeef",
  creatorComment: "지금 상황",
  manuscript: {
    name: "강서윤 (테이프대장)",
    tagline: "한 줄",
    description: "개인 사정을 함부로 공개하지 않는다",
    greeting: "좋아요.",
    genres: ["현대/일상"],
    tags: ["생활"],
  },
  resolved: {
    genre: "현대/일상",
    tone: "light",
    humor: "central",
    pacing: "dialogue",
    nameWordplay: "nickname",
    worldScale: "scene",
    namingProfile: "korean_modern",
    castIntent: "전체 이용자 대상",
  },
};

describe("admin author preview export", () => {
  it("copies the public preview fields and leaves out hidden canon", () => {
    const parsed = JSON.parse(adminAuthorPreviewExportJson({ ...preview, systemPrompt: "hidden" } as AdminAuthorPreviewExport)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), [
      "creatorComment",
      "issues",
      "manuscript",
      "previewId",
      "qaOk",
      "repairable",
      "resolved",
      "textLock",
      "voiceRepairs",
    ]);
    assert.equal(JSON.stringify(parsed).includes("hidden"), false);
    assert.equal(JSON.stringify(parsed).includes("systemPrompt"), false);
    const manuscript = parsed.manuscript as { name: string; tags: string[] };
    assert.equal(manuscript.name, "강서윤 (테이프대장)");
    assert.deepEqual(manuscript.tags, ["생활"]);
    const resolved = parsed.resolved as { tone: string; humor: string; pacing: string; nameWordplay: string };
    assert.equal(resolved.tone, "light");
    assert.equal(resolved.humor, "central");
    assert.equal(resolved.pacing, "dialogue");
    assert.equal(resolved.nameWordplay, "nickname");
  });

  it("omits an empty creator comment", () => {
    const parsed = JSON.parse(adminAuthorPreviewExportJson({ ...preview, creatorComment: "  " })) as Record<string, unknown>;
    assert.equal("creatorComment" in parsed, false);
  });
});
