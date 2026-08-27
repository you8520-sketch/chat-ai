import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCastCandidatePool,
  containsKnownCastMention,
  detectCurrentSceneCastNames,
  draftCastIntentFromCandidatePool,
  filterConfiguredCastNamesForViewer,
  isManuallyPinnedCastSubject,
  mergeCastIntentDraft,
  normalizeCastMatchName,
  type ChatImageCastIntentManifest,
} from "./chatImageCast";
import {
  applyApprovedAiScenePlan,
  applyUserIllustrationEdits,
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  reflowScenePlanPanels,
  type ScenePlan,
} from "./chatImageScenePlan";
import {
  assertChatImageScenePlanRateLimit,
  ChatImageScenePlanRateLimitError,
  releaseChatImageScenePlanRateLimit,
  resetChatImageScenePlanRateLimitForTests,
  scenePlanRateLimitRowCountForTests,
  SCENE_PLAN_COOLDOWN_MS,
  SCENE_PLAN_MAX_IN_WINDOW,
  SCENE_PLAN_WINDOW_MS,
  setChatImageScenePlanRateLimitNowForTests,
} from "./chatImageScenePlanRateLimit";
import { planChatImageScene } from "./chatImageScenePlanner";

const CONFIGURED = ["태형", "이현", "렌"];

function actualCastDraftFromScenePlan(opts: {
  scenePlan: ScenePlan;
  configuredCastNames: readonly string[];
  current: ChatImageCastIntentManifest | null;
}): ChatImageCastIntentManifest {
  const draft = draftCastIntentFromCandidatePool({
    personaName: "유저",
    mainCharacterName: "메인",
    configuredCharacterSetNames: opts.configuredCastNames,
    castMentions: opts.scenePlan.castMentions,
    events: opts.scenePlan.events,
  });
  return mergeCastIntentDraft(opts.current, draft);
}

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

  it("dedupes configured and AI mentions on apply-only draft", () => {
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

  it("adds AI-only candidates without removing configured ones when applied", () => {
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
});

describe("chatImageSceneManualFirst known-name boundaries", () => {
  it("matches Korean particles and rejects substring extensions", () => {
    assert.equal(containsKnownCastMention("렌이 문을 연다", "렌"), true);
    assert.equal(containsKnownCastMention("렌즈가 깨졌다", "렌"), false);
    assert.equal(containsKnownCastMention("이현에게 말했다", "이현"), true);
  });

  it("matches Latin word boundaries only", () => {
    assert.equal(containsKnownCastMention("Ash waved.", "Ash"), true);
    assert.equal(containsKnownCastMention("Ashley waved.", "Ash"), false);
  });

  it("uses boundary-aware current scene detection", () => {
    assert.deepEqual(detectCurrentSceneCastNames(["태형"], [{ text: "태형이 문을 연다." }]), [
      "태형",
    ]);
    assert.deepEqual(detectCurrentSceneCastNames(["렌"], [{ text: "렌즈가 깨졌다" }]), []);
    assert.equal(normalizeCastMatchName("태형"), "태형");
  });
});

describe("chatImageSceneManualFirst configuredCastNames privacy", () => {
  const configured = ["이현", "민준"];
  const sourceTexts = ["이현이 문을 열었다."];

  it("returns only source-mentioned names for non-creators", () => {
    const safe = filterConfiguredCastNamesForViewer({
      configuredNames: configured,
      sourceTexts,
      isCreator: false,
    });
    assert.deepEqual(safe, ["이현"]);
    assert.equal(safe.includes("민준"), false);
  });

  it("returns full configured roster for creators", () => {
    const creator = filterConfiguredCastNamesForViewer({
      configuredNames: configured,
      sourceTexts,
      isCreator: true,
    });
    assert.deepEqual(creator.sort(), ["민준", "이현"].sort());
  });
});

describe("chatImageSceneManualFirst AI cast non-destructive", () => {
  const messages = buildSceneSourceMessages([
    { id: 1, role: "user", content: '"안녕"' },
    { id: 2, role: "assistant", content: "렌이 손을 흔든다." },
  ]);
  const scenePlan = buildDeterministicScenePlan(messages);
  const configuredCastNames = ["렌"];

  it("does not mutate actual cast before apply or after cancel", () => {
    const initial = draftCastIntentFromCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: configuredCastNames,
      events: scenePlan.events,
    });
    const manual = {
      ...initial,
      subjects: initial.subjects.map((subject) =>
        subject.name === "렌"
          ? { ...subject, included: true, requestedReferenceAssetUrl: "asset-r" }
          : subject
      ),
    };

    const aiSuggestedPlan: ScenePlan = {
      ...scenePlan,
      castMentions: [{ name: "민준", sourceEventIds: [scenePlan.events[0]?.id ?? "E1"] }],
    };

    const beforeApply = actualCastDraftFromScenePlan({
      scenePlan,
      configuredCastNames,
      current: manual,
    });
    assert.equal(beforeApply.subjects.some((row) => row.name === "민준"), false);
    assert.equal(
      beforeApply.subjects.find((row) => row.name === "렌")?.requestedReferenceAssetUrl,
      "asset-r"
    );
    assert.equal(beforeApply.subjects.find((row) => row.name === "렌")?.included, true);

    const afterCancel = actualCastDraftFromScenePlan({
      scenePlan,
      configuredCastNames,
      current: manual,
    });
    assert.deepEqual(afterCancel, beforeApply);

    const appliedPlan = applyApprovedAiScenePlan(aiSuggestedPlan, "ai");
    const afterApply = mergeCastIntentDraft(
      manual,
      draftCastIntentFromCandidatePool({
        personaName: "유저",
        mainCharacterName: "메인",
        configuredCharacterSetNames: configuredCastNames,
        castMentions: appliedPlan.castMentions,
        events: appliedPlan.events,
      })
    );
    assert.ok(afterApply.subjects.some((row) => row.name === "민준"));
    assert.equal(
      afterApply.subjects.find((row) => row.name === "렌")?.requestedReferenceAssetUrl,
      "asset-r"
    );
    assert.equal(afterApply.subjects.find((row) => row.name === "렌")?.included, true);
  });
});

describe("chatImageSceneManualFirst explicit panel count", () => {
  const messages = buildSceneSourceMessages([
    { id: 11, role: "user", content: '"같이 갈래?"' },
    { id: 12, role: "assistant", content: "태형이 고개를 끄덕였다." },
  ]);
  const aiTwo = buildDeterministicScenePlan(messages, 2);
  const aiFour = buildDeterministicScenePlan(messages, 4);

  it("keeps user-selected 4 panels when AI suggests 2", () => {
    const applied = applyApprovedAiScenePlan(aiTwo, 4);
    assert.equal(applied.panels.length, 4);
  });

  it("keeps user-selected 3 panels when AI suggests 4", () => {
    const applied = applyApprovedAiScenePlan(aiFour, 3);
    assert.equal(applied.panels.length, 3);
  });

  it("keeps auto mode at AI recommended count", () => {
    const applied = applyApprovedAiScenePlan(aiTwo, "ai");
    assert.equal(applied.panels.length, 2);
  });
});

describe("chatImageSceneManualFirst manual pin merge", () => {
  const baseDraft = draftCastIntentFromCandidatePool({
    personaName: "유저",
    mainCharacterName: "메인",
    configuredCharacterSetNames: ["민준"],
    events: [{ text: "민준이 고개를 끄덕였다." }],
  });

  it("preserves included supporting subjects missing from next draft", () => {
    const current = {
      ...baseDraft,
      subjects: baseDraft.subjects.map((subject) =>
        subject.name === "민준" ? { ...subject, included: true } : subject
      ),
    };
    const next = draftCastIntentFromCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: ["태형"],
      events: [{ text: "태형이 문을 열었다." }],
    });
    const merged = mergeCastIntentDraft(current, next);
    const minjun = merged.subjects.find((subject) => subject.name === "민준");
    assert.equal(minjun?.included, true);
  });

  it("preserves asset-pinned supporting subjects even when unchecked", () => {
    const current = {
      ...baseDraft,
      subjects: baseDraft.subjects.map((subject) =>
        subject.name === "민준"
          ? { ...subject, included: false, requestedReferenceAssetUrl: "asset-m" }
          : subject
      ),
    };
    const next = draftCastIntentFromCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: [],
      events: [{ text: "태형이 문을 열었다." }],
    });
    const merged = mergeCastIntentDraft(current, next);
    const minjun = merged.subjects.find((subject) => subject.name === "민준");
    assert.equal(minjun?.requestedReferenceAssetUrl, "asset-m");
    assert.equal(minjun?.included, false);
  });

  it("drops unpinned supporting subjects missing from next draft", () => {
    const current = {
      ...baseDraft,
      subjects: baseDraft.subjects.map((subject) =>
        subject.name === "민준"
          ? { ...subject, included: false, requestedReferenceAssetUrl: undefined }
          : subject
      ),
    };
    const next = draftCastIntentFromCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: ["태형"],
      events: [{ text: "태형이 문을 열었다." }],
    });
    const merged = mergeCastIntentDraft(current, next);
    assert.equal(merged.subjects.some((subject) => subject.name === "민준"), false);
  });

  it("identifies manual pin by include or asset only for supporting roles", () => {
    const persona = baseDraft.subjects.find((subject) => subject.role === "persona")!;
    assert.equal(isManuallyPinnedCastSubject(persona), false);
    assert.equal(
      isManuallyPinnedCastSubject({
        ...baseDraft.subjects.find((subject) => subject.name === "민준")!,
        included: true,
      }),
      true
    );
  });
});

type SceneSourceEpochGate = {
  begin: () => number;
  isCurrent: (epoch: number) => boolean;
  applyIfCurrent: (epoch: number, apply: () => void) => boolean;
};

function createSceneSourceEpochGate(): SceneSourceEpochGate {
  let current = 0;
  return {
    begin() {
      current += 1;
      return current;
    },
    isCurrent(epoch) {
      return current === epoch;
    },
    applyIfCurrent(epoch, apply) {
      if (current !== epoch) return false;
      apply();
      return true;
    },
  };
}

async function deferred<T>(value: T, delayMs = 0): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  return value;
}

describe("chatImageSceneManualFirst async source ownership", () => {
  it("SCENE_BRIEF_OUT_OF_ORDER: later source wins", async () => {
    const gate = createSceneSourceEpochGate();
    const epochA = gate.begin();
    const epochB = gate.begin();
    let summary = "";
    let castNames: string[] = ["stale"];

    const applyBrief = (epoch: number, nextSummary: string, nextCast: string[]) => {
      gate.applyIfCurrent(epoch, () => {
        summary = nextSummary;
        castNames = nextCast;
      });
    };

    const responseB = deferred({ summary: "B summary", cast: ["B"] });
    const responseA = deferred({ summary: "A summary", cast: ["A"] }, 5);
    applyBrief(epochB, (await responseB).summary, (await responseB).cast);
    applyBrief(epochA, (await responseA).summary, (await responseA).cast);

    assert.equal(summary, "B summary");
    assert.deepEqual(castNames, ["B"]);
  });

  it("AI_RESULT_AFTER_SOURCE_SWITCH: stale preview is discarded", async () => {
    const gate = createSceneSourceEpochGate();
    const epochA = gate.begin();
    gate.begin();
    let preview: ScenePlan | null = null;

    const applyPreview = (epoch: number, plan: ScenePlan) => {
      gate.applyIfCurrent(epoch, () => {
        preview = plan;
      });
    };

    const aiA = deferred(buildDeterministicScenePlan(buildSceneSourceMessages([
      { id: 1, role: "user", content: "A" },
    ])));
    applyPreview(epochA, await aiA);
    assert.equal(preview, null);
  });

  it("OLD_FINALLY_AFTER_NEW_REQUEST: stale finally does not clear new loading", async () => {
    const gate = createSceneSourceEpochGate();
    const epochA = gate.begin();
    let loading = true;
    const epochB = gate.begin();
    loading = true;

    const finish = (epoch: number) => {
      if (gate.isCurrent(epoch)) loading = false;
    };

    finish(epochA);
    assert.equal(loading, true);
    finish(epochB);
    assert.equal(loading, false);
  });

  it("SOURCE_RESET_ONCE: one begin increments epoch exactly once", () => {
    const gate = createSceneSourceEpochGate();
    assert.equal(gate.begin(), 1);
    assert.equal(gate.begin(), 2);
    assert.equal(gate.isCurrent(1), false);
    assert.equal(gate.isCurrent(2), true);
  });

  it("CROSS_SOURCE_PIN: new source begin clears previous cast owner", () => {
    const gate = createSceneSourceEpochGate();
    gate.begin();
    let castIntent: ChatImageCastIntentManifest | null = draftCastIntentFromCandidatePool({
      personaName: "유저",
      mainCharacterName: "메인",
      configuredCharacterSetNames: ["민준"],
      events: [{ text: "민준이 고개를 끄덕였다." }],
    });
    const epochB = gate.begin();
    if (gate.isCurrent(epochB)) castIntent = null;
    assert.equal(castIntent, null);
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
    assert.throws(
      () => assertChatImageScenePlanRateLimit(42),
      ChatImageScenePlanRateLimitError
    );
    releaseChatImageScenePlanRateLimit(42);
    assert.doesNotThrow(() => assertChatImageScenePlanRateLimit(43));
    releaseChatImageScenePlanRateLimit(43);
  });

  it("enforces short cooldown between scene-plan requests", () => {
    resetChatImageScenePlanRateLimitForTests();
    assertChatImageScenePlanRateLimit(7);
    releaseChatImageScenePlanRateLimit(7);
    assert.throws(
      () => assertChatImageScenePlanRateLimit(7),
      ChatImageScenePlanRateLimitError
    );
  });

  it("returns HTTP 429 semantics via typed limiter error", () => {
    resetChatImageScenePlanRateLimitForTests();
    try {
      assertChatImageScenePlanRateLimit(99);
      assertChatImageScenePlanRateLimit(99);
      assert.fail("expected in-flight block");
    } catch (error) {
      assert.ok(error instanceof ChatImageScenePlanRateLimitError);
      assert.equal((error as ChatImageScenePlanRateLimitError).statusCode, 429);
    } finally {
      releaseChatImageScenePlanRateLimit(99);
    }
  });

  it("allows six requests per rolling window then blocks the seventh", () => {
    resetChatImageScenePlanRateLimitForTests();
    let now = 1_000_000;
    setChatImageScenePlanRateLimitNowForTests(() => now);
    for (let index = 0; index < SCENE_PLAN_MAX_IN_WINDOW; index += 1) {
      assertChatImageScenePlanRateLimit(5);
      releaseChatImageScenePlanRateLimit(5);
      now += SCENE_PLAN_COOLDOWN_MS + 1;
    }
    assert.throws(
      () => assertChatImageScenePlanRateLimit(5),
      ChatImageScenePlanRateLimitError
    );
    now += SCENE_PLAN_WINDOW_MS + 1;
    assert.doesNotThrow(() => assertChatImageScenePlanRateLimit(5));
    releaseChatImageScenePlanRateLimit(5);
  });

  it("clears in-flight lock after failed release once backoff elapses", () => {
    resetChatImageScenePlanRateLimitForTests();
    let now = 1_000;
    setChatImageScenePlanRateLimitNowForTests(() => now);
    assertChatImageScenePlanRateLimit(8);
    releaseChatImageScenePlanRateLimit(8, true);
    now += 1_600;
    assert.doesNotThrow(() => assertChatImageScenePlanRateLimit(8));
    releaseChatImageScenePlanRateLimit(8);
  });

  it("prunes stale rows opportunistically", () => {
    resetChatImageScenePlanRateLimitForTests();
    let now = 5_000;
    setChatImageScenePlanRateLimitNowForTests(() => now);
    assertChatImageScenePlanRateLimit(1);
    releaseChatImageScenePlanRateLimit(1);
    assert.equal(scenePlanRateLimitRowCountForTests(), 1);
    now += SCENE_PLAN_WINDOW_MS + SCENE_PLAN_COOLDOWN_MS + 1;
    assertChatImageScenePlanRateLimit(2);
    releaseChatImageScenePlanRateLimit(2);
    assert.equal(scenePlanRateLimitRowCountForTests(), 1);
  });
});
