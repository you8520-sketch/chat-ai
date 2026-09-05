import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import {
  compileComicPanelOverlayLayouts,
  compileComicTextOnlyOverlaySvg,
  compileComicTextOverlaySvg,
} from "./chatComicTextOverlay";
import {
  detectBlankBalloonRegions,
  renderComicBlankBalloonHybrid,
  renderComicTextOverlay,
} from "./chatComicTextOverlay.server";
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

  it("blank-balloon hybrid emits glyphs only and never a server balloon body", async () => {
    const plan = {
      sceneBackground: "",
      events: [],
      heroEventIds: [],
      heroScene: "",
      recommendedPanelCount: 2 as const,
      panels: [
        {
          index: 1,
          sourceEventIds: [],
          situation: "",
          dialogue: [
            {
              speaker: "character" as const,
              text: "짧은 대사",
              provenance: "user_edit" as const,
            },
          ],
        },
        {
          index: 2,
          sourceEventIds: [],
          situation: "",
          dialogue: [],
        },
      ],
    };
    const layouts = compileComicPanelOverlayLayouts({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
    });
    const textOnlySvg = compileComicTextOnlyOverlaySvg({
      width: 1008,
      height: 1408,
      panelLayouts: layouts,
    });
    assert.match(textOnlySvg, /speech-text-only/);
    assert.doesNotMatch(textOnlySvg, /<(?:path|rect|ellipse)\b/i);

    const providerSvg = `
      <svg width="1008" height="1408" xmlns="http://www.w3.org/2000/svg">
        <rect width="1008" height="1408" fill="#52606d"/>
        <rect x="60" y="40" width="420" height="220" rx="28" fill="#fff" stroke="#111" stroke-width="12"/>
      </svg>
    `;
    const providerBuffer = await sharp(Buffer.from(providerSvg)).png().toBuffer();
    const regions = await detectBlankBalloonRegions(providerBuffer, 2);
    assert.ok(regions.length >= 1);

    const rendered = await renderComicBlankBalloonHybrid({
      imageBuffer: providerBuffer,
      panelCount: 2,
      plan,
      textStrategy: "local_image_detection",
    });
    assert.equal(rendered.detection.strategy, "local_image_detection");
    assert.ok(rendered.detection.insertedTextRegionCount >= 1);
    assert.ok(rendered.buffer.length > 0);
  });
});
