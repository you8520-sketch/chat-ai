import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const routeUrl = new URL("./route.ts", import.meta.url);

describe("/api/chat contextBuildInput — Muse scene-bootstrap chatId wiring", () => {
  it("passes chat.id into contextBuildInput.chatId", () => {
    const src = readFileSync(routeUrl, "utf8");
    const start = src.indexOf("const contextBuildInput = {");
    assert.ok(start >= 0, "contextBuildInput object missing");
    const end = src.indexOf("};", start);
    assert.ok(end > start, "contextBuildInput close missing");
    const block = src.slice(start, end);
    assert.match(block, /userId:\s*user\.id/);
    assert.match(block, /chatId:\s*chat\.id/);
  });

  it("does not invent assistant-role scene-state injection in route", () => {
    const src = readFileSync(routeUrl, "utf8");
    assert.equal(src.includes("CURRENT SCENE STATE"), false);
    assert.equal(src.includes("rule-muse-compact-scene-state"), false);
    assert.equal(src.includes("rule-muse-structural-length-anchor"), false);
  });
});
