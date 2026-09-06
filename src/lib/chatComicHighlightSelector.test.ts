import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildComicHighlightPrompt,
  buildDeterministicScenePlan,
  buildScenePlanPrompt,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  resolveComicHighlightSelectionSource,
  validateComicHighlightSelection,
  visualEvents,
  type SceneSourceMessage,
  type SceneSpeakerContext,
} from "./chatImageScenePlan";
import { planChatImageScene, type ScenePlanCompleter } from "./chatImageScenePlanner";

const SPEAKER_CONTEXT: SceneSpeakerContext = {
  personaName: "렌",
  characterName: "태형",
};

function longGoldenTurn(): { messages: SceneSourceMessage[] } {
  const userText = `"이번 계약은 이걸로 끝이야." *소파에서 일어난다*
"이거, 오늘 낮에 시장에서 사온 건데. 뇌물이야." *작은 녹색 보석 피어싱을 흔든다*`;
  const assistantText = `"계약은 끝났어." *작게 웃는다*
"그래도 마지막 밤이잖아. 씻고 자자."
*욕실로 안내한다*
"저기 큰 욕조가 있어. 따뜻한 물 받아놨으니 천천히 들어와."
*수건과 새 잠옷을 건네준다*
"푹신한 침대 좋아한다며. 엄청 큰 침대야."
*이불을 펴서 보여준다*
*머리를 말려준다*
"긴 머리는 이렇게 말려야 하지."
*조용히 등을 감싼다*
*아까 그 녹색 보석 피어싱을 다시 꺼내 든다*
"렌. 아까 낮에 네가 나한테 뇌물이라고 준 거 말이야."
"평생 나만 보고 살겠다는 도장으로 알고 있을 테니까."
"딴생각할 생각 꿈도 꾸지 마."
*귓가에 낮게 속삭인다*
*렌의 눈을 똑바로 바라본다*
"형 안고 잘 거야, 혼자 잘 거야?"`;
  const messages = [
    { id: 1, role: "user", text: userText },
    { id: 2, role: "assistant", text: assistantText },
  ].map((row) => ({ id: row.id, role: row.role as "user" | "assistant", text: row.text }));
  return { messages };
}

function longGoldenEvents() {
  const { messages } = longGoldenTurn();
  const events = extractDeterministicEvents(messages, SPEAKER_CONTEXT);
  return { messages, events, visual: visualEvents(events) };
}

describe("true comic highlight selector — prompt inventory", () => {
  it("comic prompt is highlight-selector-only (no generic ScenePlan schema)", () => {
    const { messages } = longGoldenTurn();
    const prompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.match(prompt, /CANONICAL EVENTS are immutable source truth/);
    assert.match(prompt, /anchorEventId/);
    assert.match(prompt, /focusEventIds/);
    assert.match(prompt, /Compare all plausible local moments/);
    assert.match(prompt, /Return JSON only, no markdown fences/);
    assert.doesNotMatch(prompt, /panels/, "no panel schema");
    assert.doesNotMatch(prompt, /heroEventIds/, "no hero schema");
    assert.doesNotMatch(prompt, /recommendedPanelCount/, "no panel-count output");
    assert.doesNotMatch(prompt, /castMentions/, "no cast schema");
    assert.doesNotMatch(prompt, /sceneBackground/, "no background output schema");
    assert.doesNotMatch(prompt, /Every visual canonical event must appear exactly once/, "no generic panel coverage rule");
    assert.doesNotMatch(prompt, /personaAction/, "no per-panel action wording");
    assert.doesNotMatch(prompt, /COMIC HIGHLIGHT SELECTION MODE/, "no appended generic branch");
  });

  it("PROMPT-ID-1/2/3 no hardcoded or unknown example event IDs in the prompt", () => {
    const { messages, events } = longGoldenEvents();
    const short = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"안녕."' },
      { id: 2, role: "assistant", content: '"그래." *웃는다*' },
    ]);
    const shortEvents = extractDeterministicEvents(short, SPEAKER_CONTEXT);
    const shortPrompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages: short,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.doesNotMatch(shortPrompt, /E24|E25|E26|E27|E28|E29/, "PROMPT-ID-1 no fake E24..E29 on E1..E6 fixture");
    assert.doesNotMatch(shortPrompt, /"E27"|"E24"/, "PROMPT-ID-2 no example quote IDs");
    // PROMPT-ID-3 — every literal E\d+ in the prompt must be a real canonical event id.
    const longPrompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    const known = new Set(events.map((event) => event.id));
    const candidateIds = longPrompt.match(/E\d+/g) ?? [];
    for (const id of candidateIds) {
      assert.equal(known.has(id), true, `hardcoded event id ${id} must be a real canonical id`);
    }
    assert.match(shortPrompt, /Every returned ID MUST exist in the supplied canonical timeline/);
    assert.match(shortPrompt, /Never copy example or placeholder IDs/);
    assert.match(shortPrompt, /anchorEventId MUST appear in focusEventIds/);
  });

  it("SUBSET-1/2/3 immutable truth vs subset selection — no 'never omit' contradiction", () => {
    const { messages } = longGoldenTurn();
    const prompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.match(prompt, /Do not add, delete, rewrite, reorder, or reclassify them/, "SUBSET-1 immutable truth");
    assert.match(prompt, /MAY and SHOULD choose only the small contiguous subset/, "SUBSET-2 subset explicitly allowed");
    assert.doesNotMatch(prompt, /never add, omit, reorder/, "SUBSET-3 no whole-turn 'omit' ban");
    assert.doesNotMatch(prompt, /never omit/i, "SUBSET-3 no 'never omit' wording");
  });

  it("SUBSET-4 a late subset (E8..E10 style) passes validation from a long timeline", () => {
    const { messages, events, visual } = longGoldenEvents();
    const mid = visual[Math.floor(visual.length / 2)]!;
    const idx = visual.findIndex((event) => event.id === mid.id);
    const focus = visual.slice(Math.max(0, idx - 1), Math.min(visual.length, idx + 2)).map((event) => event.id);
    const validated = validateComicHighlightSelection({ anchorEventId: mid.id, focusEventIds: focus }, events);
    assert.equal(validated.ok, true, "late subset valid");
    assert.ok(focus.length <= 8);
    assert.ok(focus.includes(mid.id), "anchor in focus");
  });

  it("FALLBACK-1/2 unknown AI id rejected; valid AI subset stays scene_planner", async () => {
    const { messages, events } = longGoldenEvents();
    assert.equal(validateComicHighlightSelection({ anchorEventId: "E9999", focusEventIds: ["E9999"] }, events).ok, false, "FALLBACK-1 unknown id rejected");
    const anchor = visualEvents(events)[0]!;
    const validated = validateComicHighlightSelection({ anchorEventId: anchor.id, focusEventIds: [anchor.id] }, events);
    assert.equal(validated.ok, true, "FALLBACK-2 valid subset accepted");
    assert.equal(resolveComicHighlightSelectionSource({ ...buildDeterministicScenePlan(messages, undefined, SPEAKER_CONTEXT), comicHighlightSelection: validated.selection }), "scene_planner");
  });

  it("story rubric ranks narrative over visual novelty; no keyword hacks", () => {
    const { messages } = longGoldenTurn();
    const prompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.match(prompt, /CALLBACK \/ PAYOFF/);
    assert.match(prompt, /RELATIONSHIP \/ EMOTIONAL STATE CHANGE/);
    assert.match(prompt, /DECISION \/ COMMITMENT \/ CHOICE/);
    assert.match(prompt, /Visual novelty is NOT narrative importance/);
    assert.match(prompt, /Do NOT pick by first scene, last scene/);
    assert.match(prompt, /fully selectable/);
    const taskSection = prompt.slice(prompt.indexOf("TASK"));
    assert.doesNotMatch(taskSection, /평생|뇌물|도장|피어싱/u, "no keyword hack forces the golden case in instructions");
  });

  it("GENERAL_SCENEPLAN_REGRESSION=0 generic prompt unchanged", () => {
    const { messages } = longGoldenTurn();
    const prompt = buildScenePlanPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.match(prompt, /panels/, "generic schema retained");
    assert.match(prompt, /heroEventIds/, "generic hero rule retained");
    assert.match(prompt, /Every visual canonical event must appear exactly once across panels/, "generic coverage rule retained");
    assert.match(prompt, /castMentions/, "generic cast rule retained");
  });

  it("TRPG_SCENEPLAN_REGRESSION=0 trpg prompt unchanged", () => {
    const { messages } = longGoldenTurn();
    const prompt = buildScenePlanPrompt({
      scenePlanIntent: "trpg_illustration",
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.match(prompt, /TRPG ILLUSTRATION MODE/);
    assert.match(prompt, /heroEventIds MUST contain/);
  });

  it("prompt char inventory freezes before/after sizes", () => {
    const { messages } = longGoldenTurn();
    const comicPrompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    const genericPrompt = buildScenePlanPrompt({
      scenePlanIntent: "comic",
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.ok(comicPrompt.length > 0);
    assert.ok(comicPrompt.length < genericPrompt.length, "comic prompt is substantially smaller by architecture");
  });
});

describe("true comic highlight selector — planner branch", () => {
  it("comic planner sends highlight-selector-only system + compact prompt; mock selection attaches to deterministic base", async () => {
    const { messages, events, visual } = longGoldenEvents();
    const lateAnchor = visual.find((event) => event.text.includes("평생 나만 보고"))!;
    const anchorIndex = visual.findIndex((event) => event.id === lateAnchor.id);
    const focus = visual
      .slice(Math.max(0, anchorIndex - 2), Math.min(visual.length, anchorIndex + 3))
      .map((event) => event.id);
    const selection = { anchorEventId: lateAnchor.id, focusEventIds: focus };
    const validated = validateComicHighlightSelection(selection, events);
    assert.equal(validated.ok, true, "late callback anchor valid");

    let capturedSystem = "";
    let capturedPrompt = "";
    const completer: ScenePlanCompleter = async (opts) => {
      capturedSystem = opts.system;
      capturedPrompt = opts.prompt;
      return JSON.stringify(selection);
    };
    const result = await planChatImageScene({
      scenePlanIntent: "comic",
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
      complete: completer,
    });
    assert.match(capturedSystem, /comic scene selector/, "system role = highlight selector only");
    assert.doesNotMatch(capturedSystem, /scene planner/, "no generic planner system for comic");
    assert.doesNotMatch(capturedPrompt, /panels/, "mock receives no generic schema");
    assert.equal(result.usedFallback, false);
    assert.equal(result.plan.comicHighlightSelection?.anchorEventId, lateAnchor.id, "selection attached");
    // Server owns the deterministic base plan — AI panels never exist.
    const base = buildDeterministicScenePlan(messages, undefined, SPEAKER_CONTEXT);
    assert.deepEqual(result.plan.panels, base.panels, "panels are server-deterministic, not AI-authored");
    assert.deepEqual(result.plan.events, base.events, "canonical events immutable");
    assert.equal(resolveComicHighlightSelectionSource(result.plan), "scene_planner");
  });

  it("invalid comic selection falls back to deterministic plan (recovery only)", async () => {
    const { messages, events } = longGoldenEvents();
    const anchor = events[0]!;
    const completer: ScenePlanCompleter = async () =>
      JSON.stringify({ anchorEventId: anchor.id, focusEventIds: ["E9999"] });
    const result = await planChatImageScene({
      scenePlanIntent: "comic",
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
      complete: completer,
    });
    assert.equal(result.model, "deterministic-fallback");
    assert.equal(result.usedFallback, true);
    assert.equal(result.plan.comicHighlightSelection, undefined);
    assert.equal(resolveComicHighlightSelectionSource(result.plan), "deterministic_fallback");
  });

  it("whole-turn comparison contract: late-middle event fully present in planner input (no truncation)", () => {
    const { messages, events, visual } = longGoldenEvents();
    const fullSourceCharCount = messages.reduce((sum, message) => sum + message.text.length, 0);
    const prompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    const target = visual.find((event) => event.text.includes("평생 나만 보고"))!;
    const targetIndex = visual.findIndex((event) => event.id === target.id);
    const totalVisual = visual.length;
    const position = (targetIndex + 1) / totalVisual;
    assert.ok(targetIndex >= Math.floor(totalVisual * 0.5), `target late (${Math.round(position * 100)}% position)`);
    assert.match(prompt, /평생 나만 보고 살겠다는 도장으로 알고 있을 테니까/u, "target late dialogue visible to planner");
    assert.match(prompt, /딴생각할 생각 꿈도 꾸지 마/u, "target late cluster visible");
    assert.equal(events.find((event) => event.id === target.id)?.kind, "dialogue", "target canonical classification = dialogue");
    assert.ok(events.length >= 15, "fixture is a long multi-beat turn");
    assert.equal(fullSourceCharCount > 300, true, "fixture source is substantial");
  });
});

describe("true comic highlight selector — semantic fixtures", () => {
  it("HIGHLIGHT-1 visual novelty vs relationship payoff: rubric ranks payoff; golden callback scene valid", () => {
    const { messages, events, visual } = longGoldenEvents();
    const callbackAnchor = visual.find((event) => event.text.includes("아까 낮에 네가 나한테 뇌물"))!;
    const idx = visual.findIndex((event) => event.id === callbackAnchor.id);
    const focus = visual.slice(Math.max(0, idx - 1), Math.min(visual.length, idx + 3)).map((event) => event.id);
    const validated = validateComicHighlightSelection({ anchorEventId: callbackAnchor.id, focusEventIds: focus }, events);
    assert.equal(validated.ok, true);
    const prompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.match(prompt, /must not outrank a relationship-defining callback/, "visual novelty < narrative importance");
  });

  it("HIGHLIGHT-2 early logistics vs late reveal: no early-position preference in prompt", () => {
    const { messages } = longGoldenTurn();
    const prompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.doesNotMatch(prompt, /beginning|start of the turn|first half/iu, "no early-position preference");
    assert.match(prompt, /middle or later part of a long turn is fully selectable/);
  });

  it("HIGHLIGHT-3 long prose vs short critical line: short decision line can be anchor", () => {
    const { messages, events, visual } = longGoldenEvents();
    const shortCritical = visual.find((event) => event.text.includes("형 안고 잘 거야"))!;
    const idx = visual.findIndex((event) => event.id === shortCritical.id);
    const focus = visual.slice(Math.max(0, idx - 1), Math.min(visual.length, idx + 1)).map((event) => event.id);
    const validated = validateComicHighlightSelection({ anchorEventId: shortCritical.id, focusEventIds: focus }, events);
    assert.equal(validated.ok, true, "short decision/question line is a valid anchor");
  });

  it("HIGHLIGHT-5 no meaningful dialogue → action/reaction anchor valid", () => {
    const { messages } = longGoldenTurn();
    const silent = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*문을 조용히 연다*" },
      { id: 2, role: "assistant", content: "*렌의 어깨를 감싼다* *머리를 살짝 눌러 안아준다*" },
    ]);
    const events = extractDeterministicEvents(silent, SPEAKER_CONTEXT);
    const visual = visualEvents(events);
    const actionAnchor = visual.find((event) => event.kind === "reaction" || event.kind === "action")!;
    const idx = visual.findIndex((event) => event.id === actionAnchor.id);
    const focus = visual.slice(Math.max(0, idx - 1), Math.min(visual.length, idx + 1)).map((event) => event.id);
    const validated = validateComicHighlightSelection({ anchorEventId: actionAnchor.id, focusEventIds: focus }, events);
    assert.equal(validated.ok, true, "action/reaction anchor valid without dialogue");
  });

  it("HIGHLIGHT-6/7 middle-of-turn event is selectable; no first/last bias contract", () => {
    const { messages, events, visual } = longGoldenEvents();
    const middle = visual[Math.floor(visual.length / 2)]!;
    const idx = visual.findIndex((event) => event.id === middle.id);
    const focus = visual.slice(Math.max(0, idx - 1), Math.min(visual.length, idx + 2)).map((event) => event.id);
    const validated = validateComicHighlightSelection({ anchorEventId: middle.id, focusEventIds: focus }, events);
    assert.equal(validated.ok, true, "middle event selectable");
    const prompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.doesNotMatch(prompt, /pick the first|pick the last|prefer the first/iu, "no endpoint preference");
  });

  it("HIGHLIGHT-8 same drawability: rubric favors relationship/payoff scene", () => {
    const prompt = buildComicHighlightPrompt({
      characterName: "태형",
      personaName: "렌",
      messages: longGoldenTurn().messages,
      speakerContext: SPEAKER_CONTEXT,
    });
    assert.match(prompt, /THEN visual drawability as a tie-breaker/, "drawability is secondary");
  });
});