import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import {
  adminAuthorPreviewDownloadName,
  adminAuthorPreviewExportJson,
  copyOrDownloadAdminAuthorPreviewJson,
  downloadAdminAuthorPreviewJson,
  type AdminAuthorPreviewExport,
} from "@/lib/officialSupply/adminAuthorPreviewExport";

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
