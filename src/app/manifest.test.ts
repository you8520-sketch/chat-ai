import assert from "node:assert/strict";
import test from "node:test";
import manifest from "./manifest";

test("PWA manifest uses canonical brand and preserves install behavior and icons", () => {
  const result = manifest();

  assert.equal(result.name, "하브 - AI 캐릭터 채팅");
  assert.equal(result.short_name, "하브");
  assert.equal(result.id, "/");
  assert.equal(result.description, "AI 캐릭터와 대화하는 채팅 플랫폼");
  assert.equal(result.lang, "ko-KR");
  assert.equal(result.start_url, "/?pwa_icon=door-v2");
  assert.equal(result.scope, "/");
  assert.equal(result.display, "standalone");
  assert.equal(result.orientation, "portrait-primary");
  assert.equal(result.background_color, "#070910");
  assert.equal(result.theme_color, "#070910");
  assert.deepEqual(result.categories, ["entertainment", "social"]);
  assert.deepEqual(result.related_applications, [
    { platform: "webapp", url: "/manifest.webmanifest" },
  ]);
  assert.deepEqual(result.icons, [
    {
      src: "/icons/icon-door-v2-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/icons/icon-door-v2-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/icons/icon-door-v2-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ]);
});
