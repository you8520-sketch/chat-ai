import assert from "node:assert/strict";
import test from "node:test";

import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "@/lib/chatModels";
import { compareLayoutAbPayloadParity } from "@/lib/gemini31LayoutAbParity";
import { computeLayoutAbParagraphMetrics } from "@/lib/gemini31LayoutAbMetrics";
import { buildContext } from "@/services/contextBuilder";

const FIXTURE_INPUT = {
  charName: "조태형",
  systemPrompt: "너는 조태형이다.",
  world: "에이지스 본부.",
  exampleDialog: "유저: …\n조태형: …",
  chunks: [
    {
      id: "t-id",
      characterId: "t",
      content: "너는 조태형이다.",
      category: "identity" as const,
      importance: "CRITICAL" as const,
      tokenCount: 20,
      keywords: ["조태형"],
    },
  ],
  userNickname: "렌",
  personaDisplayName: "렌",
  userPersona: "렌",
  userPersonaGender: "male" as const,
  gender: "male" as const,
  shortTermHistory: [],
  currentUserMessage: "일단 네 옆에서 걸어갈게.",
  nsfw: false,
  provider: "openrouter" as const,
  modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  targetResponseChars: 3200,
  chatId: 724002,
};

test("layout A/B payload parity — non-layout sections equal", () => {
  const prev = process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  const builtA = buildContext(FIXTURE_INPUT);
  process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = "1";
  const builtB = buildContext(FIXTURE_INPUT);
  if (prev === undefined) delete process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY;
  else process.env.GEMINI31_TERMINAL_LAYOUT_OWNER_ONLY = prev;

  const parity = compareLayoutAbPayloadParity({
    sectionsA: builtA.meta.trackedSections ?? [],
    sectionsB: builtB.meta.trackedSections ?? [],
    userTurnA: builtA.history.at(-1)?.content ?? "",
    userTurnB: builtB.history.at(-1)?.content ?? "",
  });

  assert.equal(parity.allNonLayoutSectionHashesEqual, true);
  assert.equal(parity.nonLayoutHashMismatches.length, 0);
  assert.ok(parity.aSystemLayoutHash);
  assert.equal(parity.bSystemLayoutHash, null);
  assert.equal(parity.aUserTailHash, parity.bUserTailHash);
});

test("layout metrics — detects mixed dialogue/narration paragraph", () => {
  const text = `그는 고개를 들었다. "대사."\n\n"독립 대사."\n\n지문만 있는 문단.`;
  const m = computeLayoutAbParagraphMetrics(text);
  assert.ok(m.totalParagraphs >= 2);
  assert.ok(m.mixedDialogueNarrationParagraphs >= 0);
});
