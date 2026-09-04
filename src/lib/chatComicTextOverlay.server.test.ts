import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import { compileComicTextOverlaySvg } from "./chatComicTextOverlay";
import { renderComicTextOverlay } from "./chatComicTextOverlay.server";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "./chatImageScenePlan";
import { duoVisualSubjectsForCast } from "./chatComicPanelSpec.fixtures";

async function makeDummyImageBuffer(width = 1008, height = 1408): Promise<Buffer> {
  return await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 245, g: 245, b: 247, alpha: 1 },
    },
  })
    .webp()
    .toBuffer();
}

describe("chatComicTextOverlay.server sharp composite", () => {
  it("BUILD-3: server render imports, SVG compile, sharp composite, final webp buffer", async () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"안녕."' },
      { id: 2, role: "assistant", content: '"반가워."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "유저",
      characterName: "캐릭터",
    });
    const subjects = duoVisualSubjectsForCast({ characterName: "캐릭터", personaName: "유저" });
    const providerBuffer = await makeDummyImageBuffer(1008, 1408);

    const svg = compileComicTextOverlaySvg({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
      subjects,
    });
    assert.match(svg, /speech-bubble/);

    const finalBuffer = await renderComicTextOverlay({
      imageBuffer: providerBuffer,
      panelCount: 2,
      plan,
      subjects,
    });
    assert.ok(finalBuffer.length > 0);
    const meta = await sharp(finalBuffer).metadata();
    assert.equal(meta.format, "webp");
  });
});
