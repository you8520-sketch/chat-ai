import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCastCandidatePool,
  detectCurrentSceneCastNames,
  draftCastIntentFromCandidatePool,
  mergeCastIntentDraft,
  normalizeCastMatchName,
} from "./chatImageCast";
import {
  applyUserIllustrationEdits,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  reflowScenePlanPanels,
} from "./chatImageScenePlan";
import {
  assertChatImageScenePlanRateLimit,
  releaseChatImageScenePlanRateLimit,
  resetChatImageScenePlanRateLimitForTests,
} from "./chatImageScenePlanRateLimit";
import { planChatImageScene } from "./chatImageScenePlanner";

const CONFIGURED = ["태형", "이현", "렌"];

describe("chatImageSceneManualFirst cast pool", () => {
  it("shows configured set, marks current scene, excludes unknown nouns", () => {
    const events = [{ text: "태형이 문을 열었다." }];
    const pool = buildCastCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: CONFIGURED,
      events,
    });
    const names = pool.map((row) => row.name);
    assert.deepEqual(names.sort(), ["렌", "이현", "태형"].sort());
    const taehyung = pool.find((row) => row.name === "태형");
    assert.ok(taehyung?.sources.includes("current_scene"));
    const leehyun = pool.find((row) => row.name === "이현");
    assert.ok(leehyun?.sources.includes("character_set"));
    assert.equal(detectCurrentSceneCastNames(["후드", "소매"], events).length, 0);
  });

  it("dedupes configured and AI mentions", () => {
    const pool = buildCastCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: ["이현"],
      castMentions: [{ name: "이현", sourceEventIds: ["E1"] }],
      events: [{ text: "이현이 고개를 끄덕였다." }],
    });
    assert.equal(pool.length, 1);
    assert.equal(pool[0]?.name, "이현");
    assert.ok(pool[0]?.sources.includes("current_scene"));
    assert.ok(pool[0]?.sources.includes("ai_suggestion"));
  });

  it("adds AI-only candidates without removing configured ones", () => {
    const base = buildCastCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: CONFIGURED,
      events: [{ text: "태형이 문을 열었다." }],
    });
    const withAi = buildCastCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: CONFIGURED,
      events: [{ text: "태형이 문을 열었다." }],
      castMentions: [{ name: "민준", sourceEventIds: ["E2"] }],
    });
    assert.ok(withAi.some((row) => row.name === "민준"));
    for (const name of CONFIGURED) {
      assert.ok(withAi.some((row) => row.name === name));
    }
    assert.equal(base.length, 3);
    assert.equal(withAi.length, 4);
  });

  it("defaults current-scene supporting included and configured-only unchecked", () => {
    const manifest = draftCastIntentFromCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: CONFIGURED,
      events: [{ text: "태형이 문을 열었다." }],
    });
    const taehyung = manifest.subjects.find((row) => row.name === "태형");
    const leehyun = manifest.subjects.find((row) => row.name === "이현");
    assert.equal(taehyung?.included, true);
    assert.equal(leehyun?.included, false);
  });

  it("preserves manual include state across draft refresh", () => {
    const first = draftCastIntentFromCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: CONFIGURED,
      events: [{ text: "태형이 문을 열었다." }],
    });
    const edited = {
      ...first,
      subjects: first.subjects.map((subject) =>
        subject.name === "렌" ? { ...subject, included: true } : subject
      ),
    };
    const refreshed = draftCastIntentFromCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: CONFIGURED,
      events: [{ text: "태형이 문을 열었다." }],
    });
    const merged = mergeCastIntentDraft(edited, refreshed);
    assert.equal(merged.subjects.find((row) => row.name === "렌")?.included, true);
  });

  it("uses exact normalized name matching only", () => {
    assert.equal(normalizeCastMatchName("태형"), "태형");
    assert.deepEqual(detectCurrentSceneCastNames(["태형"], [{ text: "태형이 문을 연다." }]), [
      "태형",
    ]);
    assert.deepEqual(detectCurrentSceneCastNames(["태형"], [{ text: "후드가 흔들렸다." }]), []);
  });
});

describe("chatImageSceneManualFirst illustration edits", () => {
  const messages = buildSceneSourceMessages([
    { id: 1, role: "user", content: '"안녕"' },
    { id: 2, role: "assistant", content: "캐릭터가 손을 흔든다." },
  ]);
  const base = buildDeterministicScenePlan(messages);

  it("persists hero/background/atmosphere edits and canonical heroEventIds subset", () => {
    const canonicalIds = base.events.map((event) => event.id);
    const edited = applyUserIllustrationEdits(base, {
      heroScene: "edited hero",
      sceneBackground: "edited bg",
      atmosphere: "edited mood",
      heroEventIds: [...canonicalIds, "E999"],
    });
    assert.equal(edited.heroScene, "edited hero");
    assert.equal(edited.sceneBackground, "edited bg");
    assert.equal(edited.atmosphere, "edited mood");
    assert.deepEqual(edited.heroEventIds, canonicalIds.slice(0, canonicalIds.length));
    assert.deepEqual(edited.events, base.events);
  });
});

describe("chatImageSceneManualFirst provider call semantics", () => {
  it("deterministic open path uses zero provider calls", () => {
    const messages = buildSceneSourceMessages([
      { id: 11, role: "user", content: '"같이 갈래?"' },
      { id: 12, role: "assistant", content: "태형이 고개를 끄덕였다." },
    ]);
    let providerCalls = 0;
    const plan = buildDeterministicScenePlan(messages);
    assert.ok(plan.events.length > 0);
    const reflowed = reflowScenePlanPanels(plan, 3);
    assert.equal(reflowed.panels.length, 3);
    assert.equal(providerCalls, 0);
  });

  it("explicit AI click maps to one provider attempt path", async () => {
    const messages = buildSceneSourceMessages([
      { id: 11, role: "user", content: '"같이 갈래?"' },
      { id: 12, role: "assistant", content: "태형이 고개를 끄덕였다." },
    ]);
    let calls = 0;
    const result = await planChatImageScene({
      characterName: "태형",
      personaName: "렌",
      messages,
      complete: async () => {
        calls += 1;
        return JSON.stringify(buildDeterministicScenePlan(messages, 2));
      },
    });
    assert.equal(calls, 1);
    assert.ok(result.plan.panels.length > 0);
  });

  it("panel count reflow after deterministic plan stays provider-free", () => {
    const messages = buildSceneSourceMessages([
      { id: 11, role: "user", content: '"같이 갈래?"' },
      { id: 12, role: "assistant", content: "태형이 고개를 끄덕였다." },
    ]);
    const plan = buildDeterministicScenePlan(messages);
    const two = reflowScenePlanPanels(plan, 2);
    const four = reflowScenePlanPanels(plan, 4);
    assert.equal(two.panels.length, 2);
    assert.equal(four.panels.length, 4);
  });
});

describe("chatImageScenePlanRateLimit", () => {
  it("blocks concurrent in-flight scene-plan requests per user", () => {
    resetChatImageScenePlanRateLimitForTests();
    assertChatImageScenePlanRateLimit(42);
    assert.throws(() => assertChatImageScenePlanRateLimit(42));
    releaseChatImageScenePlanRateLimit(42);
    assert.doesNotThrow(() => assertChatImageScenePlanRateLimit(43));
    releaseChatImageScenePlanRateLimit(43);
  });

  it("enforces short cooldown between scene-plan requests", () => {
    resetChatImageScenePlanRateLimitForTests();
    assertChatImageScenePlanRateLimit(7);
    releaseChatImageScenePlanRateLimit(7);
    assert.throws(() => assertChatImageScenePlanRateLimit(7));
  });
});
