import assert from "node:assert/strict";
import test from "node:test";

import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "@/lib/chatModels";
import {
  compareLayoutOwners,
  isGemini31IntentionalLayoutMultiInjection,
  isGemini31TerminalLayoutOwnerOnly,
  shouldInjectSystemLayoutRecency,
} from "@/lib/gemini31LayoutOwnerPolicy";
import {
  auditTokenAccounting,
  formatTokenAccountingAudit,
} from "@/lib/promptTokenAccounting";
import {
  buildSectionFingerprints,
  diffSectionFingerprints,
  hashSectionText,
  logPromptSectionFingerprints,
} from "@/lib/promptSectionFingerprint";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { resolveResponseLengthTarget } from "@/lib/responseLengthConstants";
import { buildContext } from "@/services/contextBuilder";
import type { TrackedPromptSection } from "@/services/promptAudit";

const FIXTURE_CARD = `너는 조태형이다. S급 센티넬.`;
const FIXTURE_WORLD = `에이지스 본부.`;

function buildFixtureContext(overrides: Record<string, unknown> = {}) {
  return buildContext({
    charName: "조태형",
    systemPrompt: FIXTURE_CARD,
    world: FIXTURE_WORLD,
    exampleDialog: "유저: …\n조태형: …",
    chunks: [
      {
        id: "test-identity",
        characterId: "test",
        content: FIXTURE_CARD,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 80,
        keywords: ["조태형"],
      },
      {
        id: "test-world",
        characterId: "test",
        content: FIXTURE_WORLD,
        category: "world",
        importance: "CONTEXTUAL",
        tokenCount: 20,
        keywords: ["에이지스"],
      },
    ],
    userNickname: "렌",
    personaDisplayName: "렌",
    userPersona: "이름/호칭: 렌\n성별: 남성",
    userPersonaGender: "male",
    gender: "male",
    shortTermHistory: [],
    currentUserMessage: "일단 네 옆에서 걸어갈게.",
    nsfw: false,
    provider: "openrouter",
    modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    targetResponseChars: 3200,
    chatId: 9001,
    ...overrides,
  });
}

test("layout owners — semantic overlap, not exact duplication", () => {
  const cmp = compareLayoutOwners();
  assert.equal(cmp.exactDuplication, false);
  assert.equal(cmp.semanticDuplication, true);
  assert.ok(cmp.systemOnlyRules.length > 0);
  assert.ok(cmp.userTailOnlyRules.length > 0);
});

test("terminal layout owner only — default OFF, env gate works", () => {
  const prev = process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  assert.equal(isGemini31TerminalLayoutOwnerOnly(), false);
  assert.equal(
    shouldInjectSystemLayoutRecency({
      isOpenRouter: true,
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    }),
    true
  );
  process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = "1";
  assert.equal(isGemini31TerminalLayoutOwnerOnly(), true);
  assert.equal(
    shouldInjectSystemLayoutRecency({
      isOpenRouter: true,
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    }),
    false
  );
  if (prev === undefined) delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  else process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = prev;
});

test("layout owner appears exactly once per channel when terminal-only mode", () => {
  const prev = process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = "1";
  const built = buildFixtureContext();
  const sectionIds = (built.meta.trackedSections ?? []).map((s) => s.id);
  assert.equal(sectionIds.includes("rule-output-layout-recency"), false);
  const userTurn = built.history.at(-1)?.content ?? "";
  assert.match(userTurn, /레이아웃:/);
  assert.match(userTurn, /3,200/);
  if (prev === undefined) delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  else process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = prev;
});

test("layout owner — default mode has system + user tail (dual injection)", () => {
  const prev = process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  const built = buildFixtureContext();
  const sectionIds = (built.meta.trackedSections ?? []).map((s) => s.id);
  assert.equal(sectionIds.includes("rule-output-layout-recency"), true);
  const userTurn = built.history.at(-1)?.content ?? "";
  assert.match(userTurn, /레이아웃:/);
  if (prev === undefined) delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  else process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = prev;
});

test("length canonical policy consumed consistently", () => {
  const target = resolveResponseLengthTarget(3200);
  assert.equal(target.aimChars, 3200);
  assert.equal(target.min, 2700);
  const built = buildFixtureContext();
  const userTurn = built.history.at(-1)?.content ?? "";
  assert.ok(userTurn.includes(USER_TAIL_LENGTH_OWNER_SENTENCE.slice(0, 40)));
});

test("CI final wire — reasoning_effort=low, no conflicting thinking/reasoning", () => {
  const adapted = adaptCheaperInferenceChatBody({
    model: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    messages: [{ role: "user", content: "hello" }],
    reasoning: { effort: "high" },
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });
  assert.equal(adapted.reasoning_effort, "low");
  assert.equal(adapted.thinking, undefined);
  assert.equal(adapted.reasoning, undefined);
});

test("stable input produces deterministic section hashes", () => {
  const a = buildFixtureContext();
  const b = buildFixtureContext();
  const fpA = buildSectionFingerprints(a.meta.trackedSections ?? []);
  const fpB = buildSectionFingerprints(b.meta.trackedSections ?? []);
  assert.deepEqual(
    fpA.map((s) => s.sha256),
    fpB.map((s) => s.sha256)
  );
});

test("persona change invalidates persona section hash", () => {
  const base = buildFixtureContext();
  const changed = buildFixtureContext({
    userNickname: "미나",
    personaDisplayName: "미나",
    userPersona: "이름/호칭: 미나\n성별: 여성",
    userPersonaGender: "female",
  });
  const personaA = (base.meta.trackedSections ?? []).find(
    (s) => s.id === "user-persona-reference-owner"
  );
  const personaB = (changed.meta.trackedSections ?? []).find(
    (s) => s.id === "user-persona-reference-owner"
  );
  assert.ok(personaA && personaB);
  assert.notEqual(hashSectionText(personaA.text), hashSectionText(personaB.text));
});

test("unchanged persona does not change persona hash across turns", () => {
  const turn1 = buildFixtureContext();
  const turn2 = buildFixtureContext({
    shortTermHistory: [
      { role: "user", content: "안녕" },
      { role: "assistant", content: "응." },
    ],
    currentUserMessage: "계속 가자.",
  });
  const p1 = (turn1.meta.trackedSections ?? []).find(
    (s) => s.id === "user-persona-reference-owner"
  );
  const p2 = (turn2.meta.trackedSections ?? []).find(
    (s) => s.id === "user-persona-reference-owner"
  );
  assert.ok(p1 && p2);
  assert.equal(hashSectionText(p1.text), hashSectionText(p2.text));
});

test("section fingerprint diff detects first changed section", () => {
  const sections: TrackedPromptSection[] = [
    { id: "a", label: "A", category: "systemRules", text: "same" },
    { id: "b", label: "B", category: "systemRules", text: "old" },
  ];
  const prev = buildSectionFingerprints(sections);
  const next = buildSectionFingerprints([
    { id: "a", label: "A", category: "systemRules", text: "same" },
    { id: "b", label: "B", category: "systemRules", text: "new" },
  ]);
  const diff = diffSectionFingerprints(prev, next);
  assert.equal(diff.firstChangedSection, "b");
  assert.equal(diff.unchangedCount, 1);
});

test("logPromptSectionFingerprints tracks turn-over-turn changes", () => {
  const scope = `test-${Date.now()}`;
  const mk = (text: string): TrackedPromptSection[] => [
    { id: "static-a", label: "A", category: "systemRules", text: "stable" },
    { id: "dynamic-b", label: "B", category: "memory", text },
  ];
  const first = logPromptSectionFingerprints({ scopeKey: scope, sections: mk("v1") });
  assert.equal(first.firstChangedSection, "static-a");
  const second = logPromptSectionFingerprints({ scopeKey: scope, sections: mk("v1") });
  assert.equal(second.firstChangedSection, null);
  assert.equal(second.unchangedCount, 2);
  const third = logPromptSectionFingerprints({ scopeKey: scope, sections: mk("v2") });
  assert.equal(third.firstChangedSection, "dynamic-b");
});

test("intentional multi-injection is default production classification", () => {
  const prev = process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  assert.equal(isGemini31IntentionalLayoutMultiInjection(), true);
  if (prev === undefined) delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  else process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = prev;
});

test("token accounting audit — local over-estimate vs provider, no double count", () => {
  const audit = auditTokenAccounting({
    localEstimatedTotal: 31246,
    localSystemTokens: 6200,
    localHistoryTokens: 25105,
    localUserTurnTokens: 120,
    providerPromptTokens: 21710,
    providerCachedTokens: 13500,
  });
  const formatted = formatTokenAccountingAudit(audit);
  const block = formatted.TOKEN_ACCOUNTING_AUDIT as Record<string, unknown>;
  assert.equal(block.DOUBLE_COUNT_FOUND, "NO");
  assert.equal(block.CANONICAL_TOKEN_OWNER, "provider_reported_prompt_tokens");
  assert.ok(Number(block.DELTA_PERCENT) > 20);
});
