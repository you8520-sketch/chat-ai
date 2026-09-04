import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";

import {
  compileComicTextOverlaySvg,
  filterDialogueForTextOverlay,
  layoutPanelBubbles,
  layoutPanelOverlay,
  layoutPanelNarration,
  extractPanelSfxCue,
  renderComicTextOverlay,
  countLayoutOverlaps,
  countPanelOverlayCollisions,
  countElementsOutsidePanel,
  selectDialogueForPanelLayout,
  compileComicPanelOverlayLayouts,
  BUBBLE_OWNER,
  NARRATION_OWNER,
  SFX_OWNER,
  FINAL_COMIC_TEXT_LAYER_OWNER,
  TEXT_OVERLAY_SAFETY_POLICY_OWNER,
} from "./chatComicTextOverlay";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  normalizePanelDialogueEdits,
  type SceneDialogue,
  type ScenePanel,
  type ScenePlan,
} from "./chatImageScenePlan";
import {
  buildDialogueSpeakerOptions,
  resolveDialogueSpeakerOptionKey,
} from "./chatImageDialogueSpeakerEditor";
import { duoVisualSubjectsForCast } from "./chatComicPanelSpec.fixtures";
import {
  collectApprovedComicText,
  resolveScenePresentationVisibility,
} from "./chatImageScenePlan";

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

function makeSamplePlan(dialogueOverrides?: SceneDialogue[][]): ScenePlan {
  const messages = buildSceneSourceMessages([
    { id: 1, role: "user", content: '"내가 좋아?"' },
    {
      id: 2,
      role: "assistant",
      content: '라이크는 미소를 지으며 다가왔다. "그걸 말이라고 물어? 좋아해."',
    },
  ]);
  const plan = buildDeterministicScenePlan(messages, 2, {
    personaName: "렌",
    characterName: "라이크",
  });
  if (dialogueOverrides) {
    return {
      ...plan,
      panels: plan.panels.map((p, i) => ({
        ...p,
        dialogue: dialogueOverrides[i] ?? p.dialogue,
      })),
    };
  }
  return plan;
}

describe("Comic Text Layer: Text-Layer Tests (T1-T8)", () => {
  it("T1: user-edited dialogue exact parity → final bubble text == editor text", async () => {
    const editedText = "유저가 직접 수정한 특별한 대사 한 줄";
    const plan = makeSamplePlan([
      [
        {
          speaker: "persona",
          text: editedText,
          provenance: "user_edit",
        },
      ],
      [],
    ]);

    const svg = compileComicTextOverlaySvg({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
    });

    assert.ok(
      svg.includes(editedText),
      `Edited text '${editedText}' must be present in SVG overlay`
    );
  });

  it("T2: persona hidden → hidden dialogue absent in final output", () => {
    const plan = makeSamplePlan();
    // In normal visibility, persona dialogue exists
    const normalSvg = compileComicTextOverlaySvg({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
      visibility: { personaVisible: true },
    });
    assert.ok(normalSvg.includes("내가 좋아?"));

    // When personaVisible: false, persona dialogue must be completely absent
    const hiddenSvg = compileComicTextOverlaySvg({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
      visibility: { personaVisible: false },
    });
    assert.ok(
      !hiddenSvg.includes("내가 좋아?"),
      "Hidden persona dialogue must not appear in overlay"
    );
    // Character dialogue must still appear
    assert.ok(
      hiddenSvg.includes("그걸 말이라고 물어?"),
      "Character dialogue must remain visible"
    );
  });

  it("T3: multi-speaker → bubble speaker ownership correct", () => {
    const plan = makeSamplePlan([
      [
        { speaker: "persona", speakerName: "렌", text: "렌의 발화다.", provenance: "source" },
        { speaker: "character", speakerName: "라이크", text: "라이크의 대답이다.", provenance: "source" },
      ],
      [
        { speaker: "other", speakerName: "경비병", text: "경비병의 외침이다.", provenance: "source" },
      ],
    ]);

    const subjects = duoVisualSubjectsForCast({ characterName: "라이크", personaName: "렌" });
    const layout = layoutPanelOverlay({
      panel: plan.panels[0]!,
      approvedDialogue: plan.panels[0]!.dialogue,
      panelX: 0,
      panelY: 0,
      panelWidth: 1008,
      panelHeight: 704,
      personaVisible: true,
      subjects,
    });
    assert.equal(layout.bubbles.length, 2);
    const personaBubble = layout.bubbles.find((b) => b.speaker === "persona");
    const characterBubble = layout.bubbles.find((b) => b.speaker === "character");
    assert.ok(personaBubble && characterBubble);
    assert.ok(
      characterBubble.x < personaBubble.x,
      `Character bubble (${characterBubble.x}) should be left of persona (${personaBubble.x})`
    );

    const layoutP2 = layoutPanelOverlay({
      panel: plan.panels[1]!,
      approvedDialogue: plan.panels[1]!.dialogue,
      panelX: 0,
      panelY: 704,
      panelWidth: 1008,
      panelHeight: 704,
      personaVisible: true,
      subjects,
    });
    assert.equal(layoutP2.bubbles.length, 1);
    assert.equal(layoutP2.bubbles[0]!.speakerName, "경비병");
  });

  it("T4: silent panel → no forced bubble", () => {
    const plan = makeSamplePlan([[], []]);
    const svg = compileComicTextOverlaySvg({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
    });

    assert.ok(
      !svg.includes("class=\"speech-bubble\""),
      "Silent panels must not render forced speech bubbles"
    );
  });

  it("T5: narration box policy → only when needed", () => {
    // Panel with dialogue and standard action: no narration box needed
    const panelWithDialogue: ScenePanel = {
      index: 2,
      situation: "둘이서 걷고 있다.",
      sourceEventIds: ["E1"],
      dialogue: [{ speaker: "character", text: "대사다.", provenance: "source" }],
    };
    const narration1 = layoutPanelNarration({
      panel: panelWithDialogue,
      panelX: 0,
      panelY: 704,
      panelWidth: 1008,
      panelHeight: 704,
      hasBubbles: true,
    });
    assert.equal(narration1, undefined, "Mid-scene panel with bubbles should not force narration box");

    // Silent panel with situation beat: narration box rendered
    const silentPanel: ScenePanel = {
      index: 2,
      situation: "어두운 밤, 골목길은 고요했다.",
      sourceEventIds: ["E2"],
      dialogue: [],
    };
    const narration2 = layoutPanelNarration({
      panel: silentPanel,
      panelX: 0,
      panelY: 704,
      panelWidth: 1008,
      panelHeight: 704,
      hasBubbles: false,
    });
    assert.ok(narration2 != null, "Silent panel with situation beat should render narration box");
    assert.ok(narration2!.lines.join(" ").includes("어두운 밤"));
  });

  it("T6: SFX policy → deterministic, optional, no spam", () => {
    // Without sound cues: no SFX
    const quietPanel: ScenePanel = {
      index: 1,
      situation: "조용히 서로를 바라보았다.",
      sourceEventIds: [],
      dialogue: [],
    };
    assert.equal(extractPanelSfxCue(quietPanel), undefined, "Quiet scene must have 0 SFX");

    // With explicit sound cue: deterministic SFX rendered
    const actionPanel: ScenePanel = {
      index: 2,
      situation: "문이 철컥 닫히며 쿵 소리가 났다.",
      sourceEventIds: [],
      dialogue: [],
    };
    const cue = extractPanelSfxCue(actionPanel);
    assert.ok(cue != null, "Action with sound cue should derive SFX");
    assert.ok(cue!.text.includes("쿵") || cue!.text.includes("철컥"));
  });

  it("T7: duplicate sourceEventId → first-wins or canonical repair proven", () => {
    const plan = makeSamplePlan();
    const eventId = plan.panels[0]!.dialogue[0]!.sourceEventId!;
    // Forged duplication with same sourceEventId across panels
    const duplicatedPlan: ScenePlan = {
      ...plan,
      panels: [
        plan.panels[0]!,
        {
          ...plan.panels[1]!,
          dialogue: [
            {
              speaker: "character",
              text: "중복 이벤트 대사",
              sourceEventId: eventId,
              provenance: "source",
            },
            ...plan.panels[1]!.dialogue,
          ],
        },
      ],
    };

    // When reflowing or validating, same sourceEventId is single-owner
    const reflowed = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: '"내가 좋아?"' },
        { id: 2, role: "assistant", content: '"좋아해."' },
      ]),
      2
    );
    const occurrences = reflowed.panels.flatMap((p) =>
      p.dialogue.filter((d) => d.sourceEventId === eventId)
    );
    assert.ok(occurrences.length <= 1);
  });

  it("T8: recap echo suppressed in overlay — not same-text panel dedupe", () => {
    const plan = buildDeterministicScenePlan(
      buildSceneSourceMessages([
        { id: 1, role: "user", content: '"내가 좋아?"' },
        {
          id: 2,
          role: "assistant",
          content: '"내가 좋아?" 렌의 말에 라이크는 픽 웃었다. "그걸 말이라고 물어?"',
        },
      ]),
      2,
      { personaName: "렌", characterName: "라이크" }
    );

    const planTexts = plan.panels.flatMap((panel) => panel.dialogue.map((line) => line.text));
    assert.equal(planTexts.filter((text) => text === "내가 좋아?").length, 1);
    assert.ok(planTexts.includes("그걸 말이라고 물어?"));

    const subjects = duoVisualSubjectsForCast({ characterName: "라이크", personaName: "렌" });
    const overlayTexts = compileComicPanelOverlayLayouts({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
      subjects,
    }).flatMap((layout) => layout.bubbles.map((bubble) => bubble.rawText));
    assert.equal(overlayTexts.filter((text) => text === "내가 좋아?").length, 1);
    assert.ok(overlayTexts.includes("그걸 말이라고 물어?"));
  });
});

describe("Comic Text Layer: Overlay & Persistence Tests (O1-O5)", () => {
  it("O1: provider image success → overlay render → final saved buffer has overlay", async () => {
    const dummyImage = await makeDummyImageBuffer();
    const plan = makeSamplePlan();

    const resultBuffer = await renderComicTextOverlay({
      imageBuffer: dummyImage,
      panelCount: 2,
      plan,
      visibility: { personaVisible: true },
    });

    assert.ok(resultBuffer instanceof Buffer);
    assert.ok(resultBuffer.length > 0);
    // Composited buffer metadata
    const meta = await sharp(resultBuffer).metadata();
    assert.equal(meta.width, 1008);
    assert.equal(meta.height, 1408);
    assert.equal(meta.format, "webp");
  });

  it("O2: final saved image contains overlay, distinct from raw provider buffer", async () => {
    const dummyImage = await makeDummyImageBuffer();
    const plan = makeSamplePlan();

    const composited = await renderComicTextOverlay({
      imageBuffer: dummyImage,
      panelCount: 2,
      plan,
      visibility: { personaVisible: true },
    });

    // Content should differ from raw input buffer
    assert.notEqual(
      composited.length,
      dummyImage.length,
      "Overlayed buffer should differ in size/content from raw image"
    );
  });

  it("O3: overlay render failure → throws cleanly without false success", async () => {
    const invalidBuffer = Buffer.from("not-an-image");
    const plan = makeSamplePlan();

    await assert.rejects(
      async () => {
        await renderComicTextOverlay({
          imageBuffer: invalidBuffer,
          panelCount: 2,
          plan,
        });
      },
      /Invalid image buffer|Cannot render/i,
      "Invalid image buffer must reject without false success"
    );
  });

  it("O4: safety retry success → overlay applies with safety fallback context", async () => {
    const dummyImage = await makeDummyImageBuffer();
    const plan = makeSamplePlan([
      [
        {
          speaker: "persona",
          text: "위험하지 않은 일반 대사",
          provenance: "source",
        },
      ],
      [],
    ]);

    const resultBuffer = await renderComicTextOverlay({
      imageBuffer: dummyImage,
      panelCount: 2,
      plan,
      isSafetyFallback: true, // Retry success with safety fallback
    });

    assert.ok(resultBuffer instanceof Buffer);
    assert.ok(resultBuffer.length > 0);
  });

  it("O5: empty image buffer → immediate rejection, 0 points charged", async () => {
    await assert.rejects(
      async () => {
        await renderComicTextOverlay({
          imageBuffer: Buffer.alloc(0),
          panelCount: 2,
          plan: makeSamplePlan(),
        });
      },
      /empty image buffer/i
    );
  });
});

describe("Comic Text Layer: Safety Policy Tests (S1-S4)", () => {
  it("S1: raw unsafe terms are omitted from strict fallback prompt whitelist", () => {
    const plan = makeSamplePlan([
      [
        {
          speaker: "persona",
          text: "성관계를 맺었다.",
          provenance: "source",
        },
      ],
      [],
    ]);

    const approved = filterDialogueForTextOverlay(plan.panels[0]!.dialogue, {
      isSafetyFallback: true,
    });
    assert.equal(approved.length, 0, "Risky adult line must be omitted in fallback");
  });

  it("S2: strict fallback overlay text policy → risky explicit dialogue not blindly overlaid", () => {
    const riskyDialogue: SceneDialogue[] = [
      { speaker: "persona", text: "우리의 성관계가 시작되었다.", provenance: "source" },
      { speaker: "character", text: "안전한 대사는 허용된다.", provenance: "source" },
    ];

    const approved = filterDialogueForTextOverlay(riskyDialogue, {
      isSafetyFallback: true,
    });

    assert.equal(approved.length, 1);
    assert.equal(approved[0]!.text, "안전한 대사는 허용된다.");
  });

  it("S3: ordinary safe flirt / everyday romance → overlay allowed", () => {
    const flirtDialogue: SceneDialogue[] = [
      { speaker: "persona", text: "내가 좋아?", provenance: "source" },
      { speaker: "character", text: "좋아해, 렌. 좋아해서 미칠 것 같아...", provenance: "source" },
      { speaker: "persona", text: "보고 싶었어.", provenance: "source" },
    ];

    const approved = filterDialogueForTextOverlay(flirtDialogue, {
      isSafetyFallback: false,
    });

    assert.equal(approved.length, 3, "All ordinary romantic dialogue lines should be approved");
  });

  it("S4: non-dialogue labels ('살상 무기', etc.) do not become speech bubbles", () => {
    const mixedDialogue: SceneDialogue[] = [
      { speaker: "persona", text: "살상 무기", provenance: "source" },
      { speaker: "character", text: "접근 금지", provenance: "source" },
      { speaker: "character", text: "덤벼라.", provenance: "source" },
    ];

    const approved = filterDialogueForTextOverlay(mixedDialogue, {
      isSafetyFallback: false,
    });

    assert.equal(approved.length, 1, "Only '덤벼라.' should pass as genuine speech dialogue");
    assert.equal(approved[0]!.text, "덤벼라.");
  });
});

describe("Comic Text Layer: UI & Editor Parity Tests (U1-U3)", () => {
  it("U1: speaker dropdown defaults reflect canonical assigned speaker not arbitrary persona spam", () => {
    const plan = makeSamplePlan();
    const characterLine = plan.panels[1]!.dialogue[0]!;
    assert.equal(characterLine.speaker, "character");

    const optionKey = resolveDialogueSpeakerOptionKey(characterLine, "렌", "라이크");
    assert.equal(optionKey, "character:");

    const options = buildDialogueSpeakerOptions({
      personaName: "렌",
      characterName: "라이크",
      personaVisible: true,
      includeOther: false,
    });
    assert.ok(
      options.some((opt) => opt.value === "character"),
      "Options must contain character speaker"
    );
  });

  it("U2: preview editor and final generation use same text-layer owner", () => {
    const plan = makeSamplePlan();
    const visibility = resolveScenePresentationVisibility({ contentKind: "character" });
    const approvedText = collectApprovedComicText(plan, visibility);

    const overlayBubbles = compileComicTextOverlaySvg({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
      visibility,
    });

    for (const text of approvedText) {
      assert.ok(
        overlayBubbles.includes(text),
        `Approved preview text '${text}' must match final overlay bubble text`
      );
    }
  });

  it("U3: comic result contains proper speech bubbles with valid styling", () => {
    const plan = makeSamplePlan();
    const svg = compileComicTextOverlaySvg({
      width: 1008,
      height: 1408,
      panelCount: 2,
      plan,
    });

    assert.ok(svg.includes("<svg"), "Must output valid SVG root");
    assert.ok(svg.includes("speech-bubble"), "Must render speech bubble elements");
    assert.ok(svg.includes("#shadow"), "Must include drop shadow filter");
    assert.ok(svg.includes("내가 좋아?"), "Must include bubble text");
  });

  it("O5: unified panel layout resolves overlaps within a panel", () => {
    const dialogue: SceneDialogue[] = [
      { speaker: "character", text: "첫 번째 긴 대사입니다.", provenance: "source" },
      { speaker: "persona", text: "두 번째 긴 대사입니다.", provenance: "source" },
      { speaker: "character", text: "세 번째 반응 대사.", provenance: "source" },
    ];
    const subjects = duoVisualSubjectsForCast({ characterName: "라이크", personaName: "렌" });
    const layout = layoutPanelOverlay({
      panel: {
        index: 1,
        sourceEventIds: [],
        situation: "카페",
        dialogue,
      },
      approvedDialogue: dialogue,
      panelX: 0,
      panelY: 0,
      panelWidth: 400,
      panelHeight: 350,
      subjects,
    });
    assert.equal(countPanelOverlayCollisions(layout), 0, "All overlay collisions must be zero");
    assert.equal(countElementsOutsidePanel(layout, 0, 0, 400, 350), 0);
  });

  it("PLACEMENT-1: character left / persona right canonical sides", () => {
    const subjects = duoVisualSubjectsForCast({
      characterName: "라이크",
      personaName: "렌",
    });
    const layout = layoutPanelOverlay({
      panel: {
        index: 1,
        sourceEventIds: [],
        situation: "카페",
        dialogue: [
          { speaker: "character", text: "캐릭터 대사", provenance: "source" },
          { speaker: "persona", text: "페르소나 대사", provenance: "source" },
        ],
      },
      approvedDialogue: [
        { speaker: "character", text: "캐릭터 대사", provenance: "source" },
        { speaker: "persona", text: "페르소나 대사", provenance: "source" },
      ],
      panelX: 0,
      panelY: 0,
      panelWidth: 400,
      panelHeight: 350,
      subjects,
    });
    const characterBubble = layout.bubbles.find((b) => b.speaker === "character");
    const personaBubble = layout.bubbles.find((b) => b.speaker === "persona");
    assert.ok(characterBubble && personaBubble);
    assert.ok(characterBubble.x < personaBubble.x, "Character bubble should be left of persona bubble");
    assert.ok(
      (characterBubble.tailTargetX ?? 0) < (personaBubble.tailTargetX ?? 0),
      "Tail targets follow canonical left/right staging"
    );
    assert.equal(countPanelOverlayCollisions(layout), 0);
    assert.equal(countElementsOutsidePanel(layout, 0, 0, 400, 350), 0);
  });
});

describe("dense overlay layout matrix L1-L8", () => {
  const subjects = duoVisualSubjectsForCast({ characterName: "라이크", personaName: "렌" });
  const panelBox = { panelX: 0, panelY: 0, panelWidth: 400, panelHeight: 350 };

  function assertFinalInvariants(
    layout: ReturnType<typeof layoutPanelOverlay>,
    panelX: number,
    panelY: number,
    panelWidth: number,
    panelHeight: number
  ) {
    assert.equal(countPanelOverlayCollisions(layout), 0);
    assert.equal(countElementsOutsidePanel(layout, panelX, panelY, panelWidth, panelHeight), 0);
  }

  it("L1: four short dialogue lines preserve order with zero collisions", () => {
    const dialogue: SceneDialogue[] = [
      { speaker: "character", text: "하나.", provenance: "source" },
      { speaker: "persona", text: "둘.", provenance: "source" },
      { speaker: "character", text: "셋.", provenance: "source" },
      { speaker: "persona", text: "넷.", provenance: "source" },
    ];
    const layout = layoutPanelOverlay({
      panel: { index: 1, sourceEventIds: [], situation: "카페", dialogue },
      approvedDialogue: dialogue,
      ...panelBox,
      subjects,
    });
    assert.deepEqual(layout.bubbles.map((bubble) => bubble.rawText), ["하나.", "둘.", "셋.", "넷."]);
    assertFinalInvariants(layout, 0, 0, 400, 350);
  });

  it("L2: source / user_edit / source retains original order when all fit", () => {
    const dialogue: SceneDialogue[] = [
      { speaker: "character", text: "A", provenance: "source" },
      { speaker: "persona", text: "B", provenance: "user_edit" },
      { speaker: "character", text: "C", provenance: "source" },
    ];
    const layout = layoutPanelOverlay({
      panel: { index: 1, sourceEventIds: [], situation: "카페", dialogue },
      approvedDialogue: dialogue,
      ...panelBox,
      subjects,
    });
    assert.deepEqual(layout.bubbles.map((bubble) => bubble.rawText), ["A", "B", "C"]);
    assertFinalInvariants(layout, 0, 0, 400, 350);
  });

  it("L3: five lines retain user_edit and restore relative order", () => {
    const dialogue: SceneDialogue[] = [
      { speaker: "character", text: "1", provenance: "source" },
      { speaker: "persona", text: "KEEP", provenance: "user_edit" },
      { speaker: "character", text: "3", provenance: "source" },
      { speaker: "persona", text: "4", provenance: "source" },
      { speaker: "character", text: "5", provenance: "source" },
    ];
    const selected = selectDialogueForPanelLayout(dialogue);
    assert.ok(selected.some((line) => line.text === "KEEP"));
    const layout = layoutPanelOverlay({
      panel: { index: 1, sourceEventIds: [], situation: "카페", dialogue },
      approvedDialogue: dialogue,
      ...panelBox,
      subjects,
    });
    assert.ok(layout.bubbles.some((bubble) => bubble.rawText === "KEEP"));
    const keepIndex = layout.bubbles.findIndex((bubble) => bubble.rawText === "KEEP");
    assert.ok(keepIndex >= 0);
    assert.ok(layout.bubbles[0]!.rawText === "1" || layout.bubbles[0]!.rawText === "KEEP");
    assert.equal(layout.bubbles.length, 4);
    assertFinalInvariants(layout, 0, 0, 400, 350);
  });

  it("L4: dense long dialogue + narration + SFX stay bounded", () => {
    const dialogue: SceneDialogue[] = [
      { speaker: "character", text: "아주 긴 대사 첫 줄입니다 정말 길게 이어집니다.", provenance: "source" },
      { speaker: "persona", text: "두 번째 긴 대사도 충분히 길게 작성합니다.", provenance: "source" },
      { speaker: "character", text: "세 번째 긴 대사 역시 길게 이어집니다.", provenance: "source" },
      { speaker: "persona", text: "네 번째 긴 대사로 마무리합니다.", provenance: "source" },
    ];
    const layout = layoutPanelOverlay({
      panel: {
        index: 1,
        sourceEventIds: [],
        situation: "쾅! 와장창 퍼억",
        dialogue,
      },
      approvedDialogue: dialogue,
      ...panelBox,
      subjects,
    });
    assert.equal(layout.narration, undefined);
    assertFinalInvariants(layout, 0, 0, 400, 350);
  });

  it("L5: dense speech drops narration and reclaims reservedTop", () => {
    const dialogue: SceneDialogue[] = [
      { speaker: "character", text: "1", provenance: "source" },
      { speaker: "persona", text: "2", provenance: "source" },
      { speaker: "character", text: "3", provenance: "source" },
    ];
    const layout = layoutPanelOverlay({
      panel: {
        index: 1,
        sourceEventIds: [],
        situation: "긴 장면 설명 텍스트가 있는 상황 묘사",
        dialogue,
      },
      approvedDialogue: dialogue,
      ...panelBox,
      subjects,
    });
    assert.equal(layout.narration, undefined);
    assert.ok(layout.bubbles[0]!.y < 120, "Bubbles should not reserve removed narration space");
    assertFinalInvariants(layout, 0, 0, 400, 350);
  });

  it("L6: final collision audit passes after clamp near bottom", () => {
    const dialogue: SceneDialogue[] = [
      { speaker: "character", text: "아래쪽에 모일 대사 1", provenance: "source" },
      { speaker: "persona", text: "아래쪽에 모일 대사 2", provenance: "source" },
      { speaker: "character", text: "아래쪽에 모일 대사 3", provenance: "source" },
    ];
    const layout = layoutPanelOverlay({
      panel: { index: 1, sourceEventIds: [], situation: "카페", dialogue },
      approvedDialogue: dialogue,
      panelX: 0,
      panelY: 0,
      panelWidth: 320,
      panelHeight: 220,
      subjects,
    });
    assertFinalInvariants(layout, 0, 0, 320, 220);
  });

  it("L7: extremely long user_edit uses bounded geometry without outside-panel overflow", () => {
    const longText =
      "유저가 직접 입력한 아주 긴 대사입니다 ".repeat(8).trim();
    const dialogue: SceneDialogue[] = [
      { speaker: "persona", text: longText, provenance: "user_edit" },
    ];
    const layout = layoutPanelOverlay({
      panel: { index: 1, sourceEventIds: [], situation: "카페", dialogue },
      approvedDialogue: dialogue,
      ...panelBox,
      subjects,
    });
    assert.equal(layout.bubbles.length, 1);
    assert.ok(layout.bubbles[0]!.fontSize >= 16);
    assertFinalInvariants(layout, 0, 0, 400, 350);
  });

  it("L8: multi-panel page keeps overlay elements inside each panel", () => {
    for (const panelCount of [2, 3, 4] as const) {
      const plan = makeSamplePlan();
      const height = panelCount === 4 ? 1824 : 1408;
      const layouts = compileComicPanelOverlayLayouts({
        width: 1008,
        height,
        panelCount,
        plan,
        subjects,
      });
      assert.equal(layouts.length, panelCount);
      const panelHeight = height / panelCount;
      layouts.forEach((layout, index) => {
        assertFinalInvariants(layout, 0, index * panelHeight, 1008, panelHeight);
      });
    }
  });
});
