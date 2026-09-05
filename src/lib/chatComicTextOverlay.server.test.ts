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

function providerComicSvg(balloons: Array<{ x: number; y: number; w: number; h: number }>): Buffer {
  const bodies = balloons
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="30" fill="#fff" stroke="#111" stroke-width="14"/>`
    )
    .join("\n");
  return Buffer.from(
    `<svg width="1008" height="1408" xmlns="http://www.w3.org/2000/svg">
      <rect width="1008" height="1408" fill="#52606d"/>
      ${bodies}
    </svg>`
  );
}

function hybridPlan(dialogues: ReadonlyArray<readonly { speaker: "character" | "persona"; text: string }[]>): ReturnType<typeof buildDeterministicScenePlan> {
  return {
    sceneBackground: "",
    events: [],
    heroEventIds: [],
    heroScene: "",
    recommendedPanelCount: 2 as const,
    panels: dialogues.map((panelDialogue, index) => ({
      index: index + 1,
      sourceEventIds: [],
      situation: "",
      dialogue: panelDialogue.map((line) => ({
        speaker: line.speaker,
        text: line.text,
        provenance: "user_edit" as const,
      })),
    })),
  };
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

  it("HYBRID-5 canonical local detection: detected provider region owns glyph bounds", async () => {
    const plan = hybridPlan([
      [{ speaker: "character", text: "짧은 대사" }],
      [],
    ]);
    const providerBuffer = await sharp(providerComicSvg([{ x: 80, y: 60, w: 480, h: 240 }]))
      .png()
      .toBuffer();

    const regions = await detectBlankBalloonRegions(providerBuffer, 2);
    assert.ok(regions.length >= 1);
    const drawn = regions[0]!;
    // Region interior must sit inside the provider-drawn balloon body
    // (balloon x:[80,560], y:[60,300] with a thick dark stroke border).
    assert.ok(drawn.x >= 84, `region x ${drawn.x} inside balloon`);
    assert.ok(drawn.y >= 62, `region y ${drawn.y} inside balloon`);
    assert.ok(drawn.x + drawn.width <= 556, `region right ${drawn.x + drawn.width} inside balloon`);
    assert.ok(drawn.y + drawn.height <= 296, `region bottom ${drawn.y + drawn.height} inside balloon`);
    assert.ok(drawn.width >= 300, `region width ${drawn.width} covers balloon interior`);

    const rendered = await renderComicBlankBalloonHybrid({
      imageBuffer: providerBuffer,
      panelCount: 2,
      plan,
      textStrategy: "local_image_detection",
    });
    assert.equal(rendered.detection.expectedTextRegionCount, 1);
    assert.equal(rendered.detection.detectedRegionCount, regions.length);
    assert.equal(rendered.detection.insertedTextRegionCount, 1);
    assert.equal(rendered.detection.missingTextRegionCount, 0);
    assert.equal(rendered.detection.textInsertionComplete, true);
  });

  it("HYBRID-6 ambiguous detection rejects the text region instead of covering artwork", async () => {
    const plan = hybridPlan([
      [
        { speaker: "character", text: "안녕" },
        { speaker: "character", text: "반가워" },
      ],
      [],
    ]);
    // Two separate enclosed white balloons near both planned bubble anchors →
    // every bubble has two candidate regions → ambiguous, nothing inserted.
    const providerBuffer = await sharp(
      providerComicSvg([
        { x: 120, y: 70, w: 440, h: 180 },
        { x: 140, y: 230, w: 440, h: 160 },
      ])
    )
      .png()
      .toBuffer();

    const rendered = await renderComicBlankBalloonHybrid({
      imageBuffer: providerBuffer,
      panelCount: 2,
      plan,
      textStrategy: "local_image_detection",
    });
    assert.equal(rendered.detection.expectedTextRegionCount, 2);
    assert.ok(rendered.detection.detectedRegionCount >= 2);
    assert.ok(rendered.detection.ambiguousRegionCount >= 1);
    assert.equal(rendered.detection.insertedTextRegionCount, 0);
    assert.equal(rendered.detection.textInsertionComplete, false);
  });

  it("HYBRID-7 missing region: TEXT_INSERTION_COMPLETE is false", async () => {
    const plan = hybridPlan([
      [{ speaker: "character", text: "어디갔어" }],
      [],
    ]);
    const providerBuffer = await sharp(providerComicSvg([])).png().toBuffer();

    const rendered = await renderComicBlankBalloonHybrid({
      imageBuffer: providerBuffer,
      panelCount: 2,
      plan,
      textStrategy: "local_image_detection",
    });
    assert.equal(rendered.detection.expectedTextRegionCount, 1);
    assert.equal(rendered.detection.detectedRegionCount, 0);
    assert.equal(rendered.detection.insertedTextRegionCount, 0);
    assert.equal(rendered.detection.missingTextRegionCount, 1);
    assert.equal(rendered.detection.textInsertionComplete, false);
  });
});
