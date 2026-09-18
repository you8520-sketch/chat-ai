import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
  applyCanonicalComicClothingCoverage,
  matchesCanonicalName,
  type ApplyCanonicalComicClothingCoverageContext,
} from "./chatComicClothingWriter";
import {
  buildTier2StrictFallbackPrompt,
  panelLine,
  tier2MultiDialogueScenePlan,
  tier2ShirtlessRomanceScenePlan,
  TIER2_CLOTHING_TEST_SUBJECTS,
} from "./chatComicClothingCoverage.fixtures";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  reflowScenePlanPanels,
  validateScenePlan,
  type SceneEvent,
  type SceneEventActor,
  type SceneEventKind,
  type ScenePlan,
} from "./chatImageScenePlan";

const CTX: ApplyCanonicalComicClothingCoverageContext = {
  characterName: "라이크",
  personaName: "렌",
  knownSpeakerNames: ["라이크", "렌", "로코"],
};

function event(
  order: number,
  text: string,
  opts?: { actor?: SceneEventActor; kind?: SceneEventKind }
): SceneEvent {
  return {
    id: `evt_${order}`,
    order,
    sourceMessageId: 1,
    sourceRole: "assistant",
    kind: opts?.kind ?? "action",
    actor: opts?.actor ?? "character",
    text,
    segmentKind: "action",
  };
}

function planFromEvents(
  events: SceneEvent[],
  panelGroups: readonly (readonly string[])[],
  background = "침실"
): ScenePlan {
  return {
    sceneBackground: background,
    events,
    heroEventIds: events.slice(0, 1).map((entry) => entry.id),
    heroScene: background,
    recommendedPanelCount: 4,
    panels: panelGroups.map((sourceEventIds, index) => ({
      index: index + 1,
      sourceEventIds: [...sourceEventIds],
      situation: "scene",
      dialogue: [],
    })),
  };
}

function coverageAt(result: ReturnType<typeof applyCanonicalComicClothingCoverage>, panel: number) {
  return result.plan.panels.find((entry) => entry.index === panel)?.clothingCoverage;
}

function applyFromEvents(
  events: SceneEvent[],
  panelGroups: readonly (readonly string[])[],
  ctx: ApplyCanonicalComicClothingCoverageContext = CTX
) {
  return applyCanonicalComicClothingCoverage(planFromEvents(events, panelGroups), ctx);
}

function applyFromSource(
  lines: Array<{ role: "user" | "assistant"; content: string }>,
  ctx: ApplyCanonicalComicClothingCoverageContext = CTX
) {
  const messages = buildSceneSourceMessages(
    lines.map((line, index) => ({ id: index + 1, role: line.role, content: line.content }))
  );
  const base = reflowScenePlanPanels(buildDeterministicScenePlan(messages, 4, ctx), 4);
  return applyCanonicalComicClothingCoverage(base, ctx);
}

function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

describe("matchesCanonicalName boundary semantics", () => {
  it("C21 rejects substring collision for 렌 vs 렌즈", () => {
    assert.equal(matchesCanonicalName("렌즈를 닦았다.", "렌"), false);
    assert.equal(matchesCanonicalName("렌이 고개를 돌렸다.", "렌"), true);
  });
});

describe("chatComicClothingWriter adversarial matrix", () => {
  it("C01 character self-removes upper garment completely → shirtless", () => {
    const events = [event(1, "라이크는 셔츠를 완전히 벗어 맨가슴을 드러냈다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });

  it("C02 character current shirtless state → shirtless", () => {
    const events = [event(1, "라이크는 이미 맨가슴을 드러낸 채 침대에 앉아 있다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });

  it("C03 persona removes character shirt with explicit character target → shirtless", () => {
    const events = [event(1, "렌이 라이크의 셔츠를 벗겼다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });

  it("C04 explicit shirtless current-state wording → shirtless", () => {
    const events = [event(1, "라이크는 상의를 벗은 상태로 렌을 바라본다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });

  it("C05 shirtless then shirt put back on → modest reset", () => {
    const events = [
      event(1, "라이크는 셔츠를 벗어 맨가슴을 드러냈다."),
      event(2, "라이크는 셔츠를 다시 입었다."),
    ];
    const result = applyFromEvents(events, [["evt_1"], ["evt_2"], [], []]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 2), undefined);
  });

  it("C06 negation command 벗지 마 → no transition", () => {
    const events = [event(1, "셔츠 벗지 마.", { kind: "dialogue" })];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C07 negation past 벗지 않았다 → no transition", () => {
    const events = [event(1, "라이크는 셔츠를 벗지 않았다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C08 hypothetical 벗을까 → no transition", () => {
    const events = [event(1, "셔츠를 벗을까?")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C09 dialogue request only 옷 벗어 → no transition", () => {
    const events = [event(1, "옷 벗어.", { kind: "dialogue", actor: "persona" })];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C10 historical-only past undress → no transition", () => {
    const events = [event(1, "어제 셔츠를 벗었었다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C11 persona removes own shirt → character stays modest", () => {
    const events = [event(1, "렌은 셔츠를 벗어 의자에 걸었다.", { actor: "character" })];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C12 supporting cast removes shirt → character stays modest", () => {
    const events = [event(1, "로코는 셔츠를 벗어 창가에 걸었다.", { actor: "character" })];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C13 jacket only removed, shirt retained → modest", () => {
    const events = [event(1, "라이크는 재킷만 벗어 의자에 걸었다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C14 unbutton / loosen collar → modest", () => {
    const events = [event(1, "라이크는 셔츠 단추를 몇 개 풀었다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C15 shirtless then empty later panels carry forward", () => {
    const events = [event(1, "라이크는 셔츠를 벗어 맨가슴을 드러냈다.")];
    const result = applyFromEvents(events, [["evt_1"], [], [], []]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 2), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 3), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 4), "adult_male_character_shirtless_upper_torso");
  });

  it("C16 same event undress + re-dress → conservative modest", () => {
    const events = [event(1, "라이크는 셔츠를 벗어 맨가슴을 드러냈다. 곧바로 셔츠를 다시 입었다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
    const audit = result.audit.find((entry) => entry.panelIndex === 1);
    assert.equal(audit?.reasonCategory, "conflict_same_event");
  });

  it("C17 shirtless + explicit scene/time boundary → reset", () => {
    const events = [
      event(1, "라이크는 셔츠를 벗어 맨가슴을 드러냈다."),
      event(2, "다음날 아침, 라이크는 창가에 서 있다."),
    ];
    const result = applyFromEvents(events, [["evt_1"], ["evt_2"], [], []]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 2), undefined);
  });

  it("C18 undress + immediate redress across panels → modest", () => {
    const events = [
      event(1, "라이크는 셔츠를 벗어 맨가슴을 드러냈다."),
      event(2, "라이크는 곧바로 셔츠를 입었다."),
    ];
    const result = applyFromEvents(events, [["evt_1", "evt_2"], [], [], []]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C19 implicit character self-action without explicit characterName → shirtless", () => {
    const events = [event(1, "셔츠를 벗어 맨가슴을 드러냈다.", { actor: "character" })];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });

  it("C20 explicit wrong named target overrides actor → modest", () => {
    const events = [event(1, "렌은 자신의 셔츠를 벗어 의자에 걸었다.", { actor: "character" })];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C22 attempted undress only → modest", () => {
    const events = [event(1, "셔츠를 벗으려 했다.", { actor: "character" })];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C23 shirtless then shirt put on in later panel → later panel modest", () => {
    const events = [
      event(1, "라이크는 셔츠를 벗어 맨가슴을 드러냈다."),
      event(2, "라이크는 셔츠를 입었다."),
    ];
    const result = applyFromEvents(events, [["evt_1"], ["evt_2"], [], []]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 2), undefined);
    assert.equal(coverageAt(result, 3), undefined);
  });

  it("C24 inverse garment ownership — character acts on persona garment → modest", () => {
    const events = [event(1, "라이크가 렌의 셔츠를 벗겼다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C25 character acts on supporting garment → modest", () => {
    const events = [event(1, "라이크가 로코의 셔츠를 벗겼다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C26 persona acts on character garment → shirtless (C03 preserved)", () => {
    const events = [event(1, "렌이 라이크의 셔츠를 벗겼다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });

  it("C27 character owns 자신의 셔츠 removal → shirtless", () => {
    const events = [event(1, "라이크는 렌을 바라보며 자신의 셔츠를 벗었다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });

  it("C28 persona owns 자신의 셔츠 removal → character modest", () => {
    const events = [event(1, "렌은 라이크를 바라보며 자신의 셔츠를 벗었다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C29 same event boundary then shirtless → final shirtless", () => {
    const events = [event(1, "다음날 아침. 라이크는 셔츠를 벗어 맨가슴을 드러냈다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });

  it("C30 same event shirtless then boundary → final modest", () => {
    const events = [
      event(1, "라이크는 셔츠를 벗어 맨가슴을 드러냈다. 다음날 아침 창가에 서 있었다."),
    ];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), undefined);
  });

  it("C31 incoming shirtless + boundary only → modest", () => {
    const events = [event(1, "다음날 아침 창가에 서 있었다.")];
    const prior = applyFromEvents([event(0, "라이크는 셔츠를 벗어 맨가슴을 드러냈다.")], [["evt_0"]]);
    assert.equal(coverageAt(prior, 1), "adult_male_character_shirtless_upper_torso");
    const result = applyFromEvents(
      [
        event(0, "라이크는 셔츠를 벗어 맨가슴을 드러냈다."),
        ...events,
      ],
      [["evt_0"], ["evt_1"], [], []]
    );
    assert.equal(coverageAt(result, 2), undefined);
  });

  it("C32 incoming shirtless + boundary then re-clothing → modest", () => {
    const events = [event(1, "다음날 아침. 라이크는 셔츠를 입었다.")];
    const result = applyFromEvents(
      [event(0, "라이크는 셔츠를 벗어 맨가슴을 드러냈다."), ...events],
      [["evt_0"], ["evt_1"], [], []]
    );
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 2), undefined);
  });

  it("C33 dual garment mention — self garment action wins → shirtless", () => {
    const events = [event(1, "라이크는 렌의 셔츠를 바라보며 자신의 셔츠를 벗었다.")];
    const result = applyFromEvents(events, [["evt_1"]]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
  });
});

function assertModestPrompt(prompt: string, panel = 1): void {
  assert.match(panelLine(prompt, panel), /modest covered clothing/iu);
  assert.doesNotMatch(panelLine(prompt, panel), /confirmed adult male chat character is shirtless/iu);
}

function assertShirtlessPrompt(prompt: string, panel = 1): void {
  assert.match(panelLine(prompt, panel), /confirmed adult male chat character is shirtless/iu);
}

describe("chatComicClothingWriter production integration", () => {
  it("client-injected clothingCoverage is ignored before server writer runs", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*침실 침대 옆에 앉는다*" },
      { id: 2, role: "assistant", content: "라이크가 옆에 앉아 고개를 돌린다." },
    ]);
    const forged = {
      ...buildDeterministicScenePlan(messages, 4, CTX),
      panels: buildDeterministicScenePlan(messages, 4, CTX).panels.map((panel) =>
        panel.index === 1
          ? { ...panel, clothingCoverage: "adult_male_character_shirtless_upper_torso" as const }
          : panel
      ),
    };
    const validated = validateScenePlan(forged, messages, {
      allowUserEdits: true,
      personaName: CTX.personaName,
      characterName: CTX.characterName,
    });
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const reflowed = reflowScenePlanPanels(validated.plan, 4);
    const written = applyCanonicalComicClothingCoverage(reflowed, CTX);
    for (const panel of written.plan.panels) {
      assert.equal(panel.clothingCoverage, undefined);
    }
  });

  it("source → events → reflow → writer → Tier-2 prompt honors shirtless panel contract", () => {
    const result = applyFromSource([
      { role: "user", content: "*침실 침대 옆에 앉는다*" },
      {
        role: "assistant",
        content:
          '*라이크는 셔츠를 벗어 맨가슴을 드러냈다.* "좋아해." *뺨에 짧게 키스한다.* "…고마워."',
      },
      { role: "user", content: '"나도."' },
    ]);
    const prompt = buildTier2StrictFallbackPrompt({
      plan: result.plan,
      adultGrounded: true,
      characterGender: "male",
      subjects: TIER2_CLOTHING_TEST_SUBJECTS,
    });
    const p1 = panelLine(prompt, 1);
    assert.match(p1, /confirmed adult male chat character is shirtless/iu);
    assert.match(panelLine(prompt, 2), /confirmed adult male chat character is shirtless/iu);
  });

  it("N2B-style carry-forward keeps P2-P4 shirtless after P1 transition", () => {
    const result = applyFromSource([
      { role: "user", content: "*침실 침대 옆에 앉는다*" },
      {
        role: "assistant",
        content:
          '*라이크는 셔츠를 벗어 맨가슴을 드러냈다.* "좋아해." *뺨에 짧게 키스한다.* "…고마워."',
      },
      { role: "user", content: '"나도."' },
    ]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 2), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 3), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 4), "adult_male_character_shirtless_upper_torso");

    const writerPrompt = buildTier2StrictFallbackPrompt({
      plan: result.plan,
      adultGrounded: true,
      characterGender: "male",
    });
    for (const panel of [2, 3, 4]) {
      assert.match(
        panelLine(writerPrompt, panel),
        /confirmed adult male chat character is shirtless/iu
      );
    }
  });

  it("N2A P1 shirtless contract: writer-produced P1 matches manual N2A shirtless semantics", () => {
    const manualN2a = buildTier2StrictFallbackPrompt({
      plan: tier2ShirtlessRomanceScenePlan(),
      adultGrounded: true,
      characterGender: "male",
    });
    const writerResult = applyFromSource([
      { role: "user", content: "*침실 침대 옆에 앉는다*" },
      {
        role: "assistant",
        content:
          '*라이크는 셔츠를 벗어 맨가슴을 드러냈다.* "좋아해." *뺨에 짧게 키스한다.* "…고마워."',
      },
      { role: "user", content: '"나도."' },
    ]);
    const writerPrompt = buildTier2StrictFallbackPrompt({
      plan: writerResult.plan,
      adultGrounded: true,
      characterGender: "male",
    });

    const manualP1 = panelLine(manualN2a, 1);
    const writerP1 = panelLine(writerPrompt, 1);
    assert.match(writerP1, /confirmed adult male chat character is shirtless/iu);
    assert.match(writerP1, /bare shoulders, chest, and upper torso clearly visible/iu);
    assert.match(writerP1, /persona remains clothed/iu);
    assert.match(manualP1, /confirmed adult male chat character is shirtless/iu);

    const n1c2 = buildTier2StrictFallbackPrompt({
      plan: tier2MultiDialogueScenePlan(),
      adultGrounded: true,
      characterGender: "male",
    });
    assert.notEqual(promptHash(writerPrompt), promptHash(n1c2));
  });

  it("N2A-only source keeps P2-P4 modest when shirtless evidence is isolated to P1 panel events", () => {
    const events = [
      event(1, "라이크는 셔츠를 벗어 맨가슴을 드러냈다."),
      event(2, "뺨에 짧게 키스한다."),
      event(3, '"좋아해."', { kind: "dialogue" }),
      event(4, '"나도."', { kind: "dialogue", actor: "persona" }),
    ];
    const result = applyFromEvents(events, [["evt_1"], ["evt_2", "evt_3"], ["evt_4"], []]);
    assert.equal(coverageAt(result, 1), "adult_male_character_shirtless_upper_torso");
    assert.equal(coverageAt(result, 2), "adult_male_character_shirtless_upper_torso");
    const n2aManual = buildTier2StrictFallbackPrompt({
      plan: tier2ShirtlessRomanceScenePlan(),
      adultGrounded: true,
      characterGender: "male",
    });
    const writerPrompt = buildTier2StrictFallbackPrompt({
      plan: result.plan,
      adultGrounded: true,
      characterGender: "male",
    });
    assert.match(panelLine(writerPrompt, 1), /confirmed adult male chat character is shirtless/iu);
    assert.match(panelLine(n2aManual, 1), /confirmed adult male chat character is shirtless/iu);
    assert.match(panelLine(n2aManual, 2), /modest covered clothing/iu);
    assert.match(panelLine(writerPrompt, 2), /confirmed adult male chat character is shirtless/iu);
  });

  it("integration A — persona removes character shirt → shirtless Tier-2 contract", () => {
    const result = applyFromSource([
      { role: "assistant", content: "*렌이 라이크의 셔츠를 벗겼다.*" },
    ]);
    const prompt = buildTier2StrictFallbackPrompt({
      plan: result.plan,
      adultGrounded: true,
      characterGender: "male",
    });
    assertShirtlessPrompt(prompt);
  });

  it("integration B — character removes persona shirt → modest Tier-2 contract", () => {
    const result = applyFromSource([
      { role: "assistant", content: "*라이크가 렌의 셔츠를 벗겼다.*" },
    ]);
    const prompt = buildTier2StrictFallbackPrompt({
      plan: result.plan,
      adultGrounded: true,
      characterGender: "male",
    });
    assertModestPrompt(prompt);
  });

  it("integration C — boundary then shirtless in same source → shirtless contract", () => {
    const result = applyFromSource([
      {
        role: "assistant",
        content: "*다음날 아침. 라이크는 셔츠를 벗어 맨가슴을 드러냈다.*",
      },
    ]);
    const prompt = buildTier2StrictFallbackPrompt({
      plan: result.plan,
      adultGrounded: true,
      characterGender: "male",
    });
    assertShirtlessPrompt(prompt);
  });

  it("integration D — shirtless then boundary in same source → modest contract", () => {
    const result = applyFromSource([
      {
        role: "assistant",
        content:
          "*라이크는 셔츠를 벗어 맨가슴을 드러냈다. 다음날 아침 창가에 섰다.*",
      },
    ]);
    const prompt = buildTier2StrictFallbackPrompt({
      plan: result.plan,
      adultGrounded: true,
      characterGender: "male",
    });
    assertModestPrompt(prompt);
  });
});
