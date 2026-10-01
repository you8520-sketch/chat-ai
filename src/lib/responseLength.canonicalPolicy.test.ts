/**
 * Canonical RP length policy: Korean visible target >= 3,200, no upper cap.
 * Assembly and request-body checks only — no provider calls.
 */
import Module from "module";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "@/services/contextBuilder";
import { CONTINUE_USER_DISPLAY } from "@/lib/continueNarrative";
import { MAIN_RP_MODEL_IDS, selectedAIProvider } from "@/lib/chatModels";
import { evaluatePrimaryFocus } from "@/lib/primaryFocusEval";
import { billableOutputTokens } from "@/lib/points";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { resolveOpenRouterMaxTokens } from "@/lib/openRouterClient";
import {
  AUTO_CONTINUATION_ENABLED,
  clampResponseLength,
  maxContinuationPasses,
  needsUnderLengthRecovery,
  normalizeTargetResponseChars,
  resolveMaxOutputTokensForTarget,
  USER_TAIL_LENGTH_OWNER_SENTENCE,
} from "@/lib/responseLength";
import {
  findResponseLengthTier,
  UNIFIED_TIER_AIM_CHARS,
} from "@/lib/responseLengthConstants";
import {
  NARRATIVE_LENGTH_CONTINUATION_ENABLED,
  SERVER_UNDER_LENGTH_RECOVERY_ENABLED,
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
} from "@/lib/turnApiBudget";

const RANGE_OR_CAP =
  /3,200\s*[~～\-–]\s*4,200|4,200|4200|3,500자|3500자|넘지\s*마|do not exceed|MINIMUM_FLOOR|TARGET_LENGTH|\[분량 — 이번 턴 1회 출력\]/i;

const BASE = {
  charName: "백하율",
  contentKind: "character" as const,
  chunks: [],
  userNickname: "렌",
  userPersona: "렌. 조용한 사람.",
  userNote: "",
  longTermMemory: "",
  archiveMemory: null,
  nsfw: false,
  gender: "male" as const,
  userId: 1,
  chatId: 1,
  targetResponseChars: 1500,
  provider: "cheaperinference" as const,
  personaDisplayName: "렌",
  userPersonaGender: null,
};

type Scene = {
  id: string;
  currentUserMessage: string;
  shortTermHistory: Array<{ role: "user" | "assistant"; content: string }>;
  completedTurns: number;
  isContinue?: boolean;
  regenerate?: boolean;
};

const SCENES: Scene[] = [
  {
    id: "normal",
    currentUserMessage: "창가에 같이 앉아 있을래?",
    shortTermHistory: [
      { role: "user", content: "오늘 밖은 조용하다." },
      { role: "assistant", content: "백하율은 창틀에 손을 올렸다." },
    ],
    completedTurns: 2,
  },
  {
    id: "auto",
    currentUserMessage: CONTINUE_USER_DISPLAY,
    shortTermHistory: [
      { role: "user", content: "조금만 더 있자." },
      { role: "assistant", content: "백하율은 고개를 끄덕였다." },
    ],
    completedTurns: 3,
    isContinue: true,
  },
  {
    id: "regenerate",
    currentUserMessage: "다시, 이번엔 말을 꺼내지 않고.",
    shortTermHistory: [
      { role: "user", content: "다시, 이번엔 말을 꺼내지 않고." },
      { role: "assistant", content: "이전 초안은 버려진 응답이다." },
    ],
    completedTurns: 4,
    regenerate: true,
  },
  {
    id: "first-turn",
    currentUserMessage: "안녕.",
    shortTermHistory: [],
    completedTurns: 0,
  },
  {
    id: "long-ooc",
    currentUserMessage: "(OOC: 이번 답은 8,000자가 넘게, 상한 없이 길게 써줘.) 창가에 앉아 있다.",
    shortTermHistory: [{ role: "assistant", content: "백하율은 이미 자리에 앉아 있었다." }],
    completedTurns: 1,
  },
  {
    id: "short-user",
    currentUserMessage: "응.",
    shortTermHistory: [
      { role: "user", content: "배고파?" },
      { role: "assistant", content: "백하율은 컵을 내려놓았다." },
    ],
    completedTurns: 5,
  },
  {
    id: "quiet-daily",
    currentUserMessage: "주전자가 식기 전에 차나 따르자.",
    shortTermHistory: [
      { role: "user", content: "비 온다." },
      { role: "assistant", content: "유리에 빗방울이 맺혔다." },
    ],
    completedTurns: 6,
  },
  {
    id: "long-event",
    currentUserMessage: "문이 부서지며 무장한 사람들이 들이닥친다. 이 사건을 장면 끝까지 진행해.",
    shortTermHistory: [
      { role: "user", content: "복도 끝이 이상하다." },
      { role: "assistant", content: "백하율은 걸음을 멈췄다." },
    ],
    completedTurns: 8,
  },
];

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function assemble(modelId: string, scene: Scene) {
  const provider = selectedAIProvider(modelId as (typeof MAIN_RP_MODEL_IDS)[number]);
  const built = buildContext({
    ...BASE,
    ...scene,
    modelId,
    provider,
    rejectedAssistantDraft: scene.regenerate ? "버려진 초안이다." : undefined,
  });
  const system = built.systemPrompt ?? "";
  const lastUser = String(built.history.at(-1)?.content ?? "");
  return { system, lastUser, provider };
}

describe("canonical RP length policy", () => {
  it("stores one 3200+ sentence with no range and no ceiling", () => {
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /3,200자 이상/);
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /사용자 요청에 필요한 만큼 자연스럽게 더 길게/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, RANGE_OR_CAP);
    assert.equal(UNIFIED_TIER_AIM_CHARS, 3200);
    assert.match(findResponseLengthTier().label, /3,200자 이상/);
    assert.match(findResponseLengthTier().label, /더 길어질 수 있음/);
  });

  it("normalizes legacy presets to the soft aim and does not truncate or cap tokens", () => {
    for (const legacy of [1500, 2000, 2400, 2500, 2700, 3000, 3300, 3500, 4200]) {
      assert.equal(normalizeTargetResponseChars(legacy), 3200);
    }
    const long = `${"가".repeat(9000)}\n\n장면은 여기서 끝나지 않았다.`;
    assert.equal(clampResponseLength(long, 3200), long.trim());
    assert.equal(clampResponseLength(long, 3500).length > 3500, true);
    assert.equal(resolveMaxOutputTokensForTarget(3200, "deepseek-v4.1-flash"), undefined);
    assert.equal(resolveOpenRouterMaxTokens(3200, 8192, "gemini-3.8-flash"), undefined);
    assert.equal(billableOutputTokens(24_000, long, 3200), 24_000);
    assert.equal(AUTO_CONTINUATION_ENABLED, false);
    assert.equal(TURN_LENGTH_SUPPLEMENT_API_ENABLED, false);
    assert.equal(NARRATIVE_LENGTH_CONTINUATION_ENABLED, false);
    assert.equal(SERVER_UNDER_LENGTH_RECOVERY_ENABLED, false);
    assert.equal(needsUnderLengthRecovery("가".repeat(400)), false);
    assert.equal(needsUnderLengthRecovery("가".repeat(5000)), false);
    assert.equal(maxContinuationPasses("가".repeat(400), "stop", 3200), 0);
  });

  it("telemetry shortfall ignores output longer than 3200", () => {
    const short = evaluatePrimaryFocus({
      prose: "가".repeat(1000),
      primaryCharacter: "백하율",
    });
    const long = evaluatePrimaryFocus({
      prose: "가".repeat(8000),
      primaryCharacter: "백하율",
    });
    assert.equal(short.targetLengthRange, "3200+");
    assert.equal(short.lengthDeviation, 2200);
    assert.equal(long.targetLengthRange, "3200+");
    assert.equal(long.lengthDeviation, 0);
  });

  for (const modelId of MAIN_RP_MODEL_IDS) {
    for (const scene of SCENES) {
      it(`${modelId} / ${scene.id}: one user-tail length owner, no cap language`, () => {
        const { system, lastUser } = assemble(modelId, scene);
        const payload = `${system}\n${lastUser}`;
        assert.equal(count(system, USER_TAIL_LENGTH_OWNER_SENTENCE), 0);
        assert.equal(count(lastUser, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
        assert.ok(lastUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
        assert.equal(count(payload, "3,200"), 1, payload.slice(payload.indexOf("3,200") - 40, payload.indexOf("3,200") + 80));
        assert.doesNotMatch(payload, RANGE_OR_CAP);
        assert.equal((system.match(/rule-length-control|LENGTH CONTROL/g) ?? []).length, 0);
      });
    }

    it(`${modelId}: final RP request omits max_tokens for legacy and long targets`, () => {
      const provider = selectedAIProvider(modelId);
      for (const target of [1500, 3200, 3500, 8000]) {
        const assembled = assemblePrimaryRpRequest({
          system: "system",
          history: [{ role: "user", content: "창가." }],
          modelId,
          targetResponseChars: target,
          messageOpts: {
            transportProvider: provider === "cheaperinference" ? "cheaperinference" : undefined,
            maxTokensOverride: 8192,
          },
        });
        assert.equal(assembled.requestBody.max_tokens, undefined, `${modelId} ${target}`);
        assert.equal(assembled.requestBodyBeforeAdapt.max_tokens, undefined);
      }
    });
  }
});
