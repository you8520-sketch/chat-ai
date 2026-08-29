/**
 * PR724 review correction — wire parity (telemetry OFF vs ON).
 * node --conditions=react-server --import tsx scripts/gemini31-review-correction-parity.ts
 */
import Module from "module";
import { createHash } from "node:crypto";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { buildContext } from "../src/services/contextBuilder";
import { assemblePrimaryRpRequest } from "../src/lib/openRouterAdult";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import { clearPromptSectionFingerprintCache } from "../src/lib/promptSectionFingerprint";

const FIXTURE = {
  charName: "조태형",
  systemPrompt: "너는 조태형이다. S급 센티넬.",
  world: "에이지스 본부.",
  exampleDialog: "유저: …\n조태형: …",
  chunks: [
    {
      id: "test-identity",
      characterId: "test",
      content: "너는 조태형이다. S급 센티넬.",
      category: "identity" as const,
      importance: "CRITICAL" as const,
      tokenCount: 80,
      keywords: ["조태형"],
    },
  ],
  userNickname: "렌",
  personaDisplayName: "렌",
  userPersona: "이름/호칭: 렌\n성별: 남성",
  userPersonaGender: "male" as const,
  gender: "male" as const,
  shortTermHistory: [{ role: "user" as const, content: "안녕" }, { role: "assistant" as const, content: "응." }],
  currentUserMessage: "일단 네 옆에서 걸어갈게.",
  nsfw: false,
  provider: "openrouter" as const,
  modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  targetResponseChars: 3200,
  chatId: 9001,
};

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function snapshot(env: Record<string, string | undefined>) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  clearPromptSectionFingerprintCache();
  try {
    const built = buildContext(FIXTURE);
    const asm = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history,
      openRouterSystemSplit: built.openRouterSystemSplit,
      modelId: FIXTURE.modelId,
      provider: "cheaperinference",
    });
    const adapted = adaptCheaperInferenceChatBody(asm.requestBody);
    return {
      systemSha: sha(built.systemPrompt),
      historySha: sha(JSON.stringify(built.history)),
      wireSha: sha(JSON.stringify(adapted)),
      reasoning_effort: adapted.reasoning_effort,
    };
  } finally {
    clearPromptSectionFingerprintCache();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const off = snapshot({});
const on = snapshot({
  PROMPT_SECTION_FINGERPRINT: "1",
  GEMINI_TTFT_PHASE_AUDIT: "1",
});

console.log(
  JSON.stringify(
    {
      PROVIDER_BODY_BEHAVIORAL_PARITY:
        off.systemSha === on.systemSha &&
        off.historySha === on.historySha &&
        off.wireSha === on.wireSha
          ? "PASS"
          : "FAIL",
      off,
      on,
    },
    null,
    2
  )
);
