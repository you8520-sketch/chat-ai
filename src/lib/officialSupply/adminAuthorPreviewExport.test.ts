import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import {
  adminAuthorPreviewDownloadName,
  adminAuthorPreviewExportJson,
  copyOrDownloadAdminAuthorPreviewJson,
  downloadAdminAuthorPreviewJson,
  readAdminAuthorServerFailure,
  type AdminAuthorPreviewExport,
} from "@/lib/officialSupply/adminAuthorPreviewExport";
import { adminAuthorPreviewFailureFromGateErrorForTests } from "@/lib/officialSupply/adminAuthorDraft";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";

const preview: AdminAuthorPreviewExport = {
  previewId: "abc",
  qaOk: false,
  issues: [{ code: "sfw_public_text_has_adult_terms", message: "all-ages public text contains adult terms" }],
  warnings: [{ code: "bible_speech_band", message: "speech.description 131 chars (recommended band 250-600)" }],
  repairable: false,
  voiceRepairs: 0,
  adult: false,
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
      "adult",
      "creatorComment",
      "issues",
      "manuscript",
      "previewId",
      "qaOk",
      "repairable",
      "resolved",
      "textLock",
      "voiceRepairs",
      "warnings",
    ]);
    assert.equal(JSON.stringify(parsed).includes("hidden"), false);
    assert.equal(JSON.stringify(parsed).includes("systemPrompt"), false);
    assert.deepEqual(parsed.warnings, preview.warnings);
    const manuscript = parsed.manuscript as { name: string; tags: string[] };
    assert.equal(manuscript.name, "강서윤 (테이프대장)");
    assert.deepEqual(manuscript.tags, ["생활"]);
    const resolved = parsed.resolved as { tone: string; humor: string; pacing: string; nameWordplay: string };
    assert.equal(resolved.tone, "light");
    assert.equal(resolved.humor, "central");
    assert.equal(resolved.pacing, "dialogue");
    assert.equal(resolved.nameWordplay, "nickname");
  });

  it("preserves general and adult modes in the exported JSON", () => {
    for (const adult of [false, true]) {
      const parsed = JSON.parse(
        adminAuthorPreviewExportJson({ ...preview, adult })
      ) as Record<string, unknown>;
      assert.equal(parsed.adult, adult);
    }
  });

  it("includes the experience canon and still drops a system prompt", () => {
    const parsed = JSON.parse(
      adminAuthorPreviewExportJson({
        ...preview,
        systemPrompt: "hidden",
        experience: {
          desire: "무대에 서기 두려워하면서도 남을 웃기는 일을 그만두지 못한다",
          contradiction: "박수를 원하면서 칭찬을 받으면 농담으로 자리를 피한다",
          behavior: "긴장이 오면 먼저 짧은 농담을 던지고 그다음 자기 차례를 미룬다",
          incident: "오늘 밤 즉흥 무대의 순서가 비어 스스로 한 곡을 넣었다",
          tension: "처음 만난 상대가 그 빈 순서를 보았고 그녀는 먼저 말을 건다",
          daily: "낮에는 악보를 정리하고 밤에는 빈 연습실에서 혼자 리허설을 한다",
          cost: "순서를 미룰수록 자기가 설 자리가 다음 주로 밀린다",
          play: "같이 순서를 정하고 그녀의 농담 뒤에서 망설임을 보는 경험",
          voice: "짧은 반말과 과장된 리허설 용어로 겁을 숨긴다",
          firstAction: "마이크를 상대 쪽이 아니라 자기 악보 위에 내려놓는다",
        },
      } as AdminAuthorPreviewExport)
    ) as { experience?: { desire?: string } };
    assert.equal(parsed.experience?.desire, "무대에 서기 두려워하면서도 남을 웃기는 일을 그만두지 못한다");
    assert.equal(JSON.stringify(parsed).includes("hidden"), false);
  });

  it("omits an empty creator comment", () => {
    const parsed = JSON.parse(adminAuthorPreviewExportJson({ ...preview, creatorComment: "  " })) as Record<string, unknown>;
    assert.equal("creatorComment" in parsed, false);
  });

  it("keeps allowed 422 diagnostics and still drops hidden canon", () => {
    const parsed = JSON.parse(
      adminAuthorPreviewExportJson({
        ...preview,
        previewId: "",
        qaOk: false,
        textLock: "",
        manuscript: { name: "", tagline: "", description: "", greeting: "", genres: [], tags: [] },
        issues: [{ code: "world_lorebook_hidden", message: "lorebook[0] contains hidden-knowledge wording" }],
        httpStatus: 422,
        error: "world bible failed QA",
        stage: "world_atlas_qa",
        selection: {
          genre: "현대/일상",
          tone: "auto",
          humor: "auto",
          pacing: "auto",
          nameWordplay: "auto",
          gender: "female",
          castIntent: "",
        },
        resolvedSource: "client_recommendation",
        manuscriptPresent: false,
        worldProjection: { stage: "world_projection", code: "user_binding", hits: [{ field: "premise", excerpt: "당신" }] },
        systemPrompt: "hidden",
        lorebook: "진짜 정체는 적국의 공주다.",
      } as AdminAuthorPreviewExport)
    ) as Record<string, unknown>;
    assert.equal(parsed.httpStatus, 422);
    assert.equal(parsed.error, "world bible failed QA");
    assert.equal(parsed.stage, "world_atlas_qa");
    assert.equal(parsed.resolvedSource, "client_recommendation");
    assert.equal(parsed.manuscriptPresent, false);
    assert.equal((parsed.selection as { gender: string }).gender, "female");
    assert.equal((parsed.worldProjection as { stage: string }).stage, "world_projection");
    assert.equal(JSON.stringify(parsed).includes("systemPrompt"), false);
    assert.equal(JSON.stringify(parsed).includes("진짜 정체는 적국의 공주다"), false);
    assert.equal("lorebook" in parsed, false);
    assert.equal((parsed.issues as { message: string }[])[0]?.message.includes("lorebook[0]"), true);
  });

  it("exports Voice QA gate failures without a false world_bible_qa stage", () => {
    const gate = adminAuthorPreviewFailureFromGateErrorForTests(
      new OfficialSupplyGateError("author_voice_rejected", "character_bible_voice: tagline", {
        ok: false,
        errors: [{ code: "voice_structure_tagline", message: "tagline required" }],
      })
    );
    assert.equal(gate.ok, false);
    if (gate.ok) return;
    const parsed = JSON.parse(
      adminAuthorPreviewExportJson({
        ...preview,
        previewId: "",
        qaOk: false,
        textLock: "",
        manuscript: { name: "", tagline: "", description: "", greeting: "", genres: [], tags: [] },
        httpStatus: 422,
        error: gate.error,
        issues: gate.issues,
        systemPrompt: "hidden",
      } as AdminAuthorPreviewExport)
    ) as Record<string, unknown>;
    assert.equal("stage" in parsed, false);
    assert.equal(parsed.error, gate.error);
    assert.equal(JSON.stringify(parsed).includes("hidden"), false);
  });

  it("reads only server-provided 422 fields", () => {
    const diagnostics = readAdminAuthorServerFailure({
      httpStatus: 422,
      payload: {
        ok: false,
        error: "world bible failed QA",
        stage: "world_atlas_qa",
        issues: [{ code: "world_lorebook_hidden", message: "lorebook[0] contains hidden-knowledge wording" }],
        lorebook: "do-not-copy",
      },
    });
    assert.deepEqual(diagnostics, {
      httpStatus: 422,
      error: "world bible failed QA",
      stage: "world_atlas_qa",
    });
  });
});

describe("admin author preview copy or download", () => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  let dom: JSDOM | null = null;

  function installDom() {
    dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
    const window = dom.window;
    for (const [name, value] of Object.entries({
      window,
      document: window.document,
      navigator: window.navigator,
      HTMLAnchorElement: window.HTMLAnchorElement,
      Blob: window.Blob,
    })) {
      if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    }
  }

  afterEach(() => {
    dom?.window.close();
    dom = null;
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
    originals.clear();
  });

  it("writes the public JSON to the clipboard when the clipboard is available", async () => {
    installDom();
    let copied = "";
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    });
    const json = adminAuthorPreviewExportJson(preview);
    assert.equal(await copyOrDownloadAdminAuthorPreviewJson(json, adminAuthorPreviewDownloadName(preview.previewId)), "copied");
    const parsed = JSON.parse(copied) as Record<string, unknown>;
    assert.equal(parsed.textLock, "bb65bc713ed1deadbeef");
    assert.equal((parsed.manuscript as { tags: string[] }).tags[0], "생활");
    assert.equal((parsed.resolved as { humor: string }).humor, "central");
    assert.equal(JSON.stringify(parsed).includes("systemPrompt"), false);
    assert.equal(JSON.stringify(parsed).includes("OPENROUTER"), false);
  });

  it("downloads the same public JSON when the clipboard write fails", async () => {
    installDom();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    const created: string[] = [];
    const clicks: { download: string; attached: boolean; href: string }[] = [];
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      value: (blob: Blob) => {
        created.push(blob.type);
        return "blob:preview-json";
      },
    });
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    });
    const proto = globalThis.HTMLAnchorElement.prototype;
    proto.click = function click(this: HTMLAnchorElement) {
      clicks.push({
        download: this.download,
        attached: document.body.contains(this),
        href: this.href,
      });
    };
    const json = adminAuthorPreviewExportJson(preview);
    assert.equal(await copyOrDownloadAdminAuthorPreviewJson(json, adminAuthorPreviewDownloadName("abc")), "downloaded");
    assert.deepEqual(created, ["application/json"]);
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0]?.download, "official-author-preview-abc.json");
    assert.equal(clicks[0]?.attached, true);
    assert.match(clicks[0]?.href ?? "", /blob:preview-json/);
  });

  it("does not start a download from a detached anchor", () => {
    installDom();
    const clicks: { attached: boolean }[] = [];
    const proto = globalThis.HTMLAnchorElement.prototype;
    proto.click = function click(this: HTMLAnchorElement) {
      clicks.push({ attached: document.body.contains(this) });
    };
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:detached",
    });
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    });
    const detached = document.createElement("a");
    detached.href = "blob:detached";
    detached.download = "official-author-preview-held.json";
    detached.click();
    assert.equal(clicks[0]?.attached, false);
    downloadAdminAuthorPreviewJson("{}", "official-author-preview-held.json");
    assert.equal(clicks[1]?.attached, true);
  });
});
