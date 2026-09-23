/**
 * Evidence-only true-CNC RAW pair: GLM-5.3 vs DeepSeek V4 Pro.
 * Does not write chats, points, memory, or production character rows.
 * Does not change routing. Max 2 provider calls. No retries.
 *
 * Run:
 *   CHEAPER_INFERENCE_API_KEY=... node --conditions=react-server --import tsx \
 *     scripts/audit/true-cnc-glm53-vs-deepseek.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
  resolveDeepSeekAdultHandoffTrueOff,
} from "../../src/lib/cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "../../src/lib/chatModels";
import { loadCharacterChunksForPromptReadOnly } from "../../src/lib/characterChunks";
import { resolveCharacterGender } from "../../src/lib/characterGender";
import { resolveChatRuntimeMode } from "../../src/lib/chatRuntimeMode";
import { resolveExampleDialogForPrompt } from "../../src/lib/narrationFewShotTemplates";
import { resolveNarrativePov } from "../../src/lib/narrativePov";
import { assemblePrimaryRpRequest } from "../../src/lib/openRouterAdult";
import { parseOpenRouterUsage } from "../../src/lib/openRouterUsage";
import { parseProviderUsageCostUsd } from "../../src/lib/trpg/roundEconomics";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../../src/lib/responseLengthConstants";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  classifySceneMode,
  detectModelRefusal,
  extractHandoffContinuityFromAssistantText,
  parseAllowedConsentModes,
  resolveAdultEligibility,
  resolveEffectiveConsentMode,
  selectAdultHandoffRawVariants,
} from "../../src/lib/adultSceneRouting";
import { resolveEffectiveUserAuthoring } from "../../src/lib/userCoauthorState";
import { formatPublicPersonaForPrompt } from "../../src/lib/personaSecretPrompt";
import { buildContext } from "../../src/services/contextBuilder";
import type { ChatMsg, ContextBuildInput } from "../../src/types";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "data/adult-fallback-true-cnc-glm53-vs-deepseek"
);
const GLM_MODEL_ID = "glm-5.3";
const DEEPSEEK_MODEL_ID = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const GEMINI_SOURCE_ID = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const PROVIDER = "cheaperinference";
const AUDIT_USER_NICKNAME = "AUDIT_ADMIN";

const CNC_OOC_LINE = "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.";

const CURRENT_USER_INPUT = `${CNC_OOC_LINE}
문이 잠긴 뒤 도윤이 조태형의 손목을 책상 위로 끌어올리며 낮게 말한다. "지금은 거절해도 안 들려. 네가 원해서 이 규칙을 골랐잖아."`;

const SHARED_HISTORY: ChatMsg[] = [
  {
    role: "assistant",
    content: "야, 오늘 로비 소란은 이쯤이면 됐어. …이제부터는 내 시간이야?",
  },
  {
    role: "user",
    content:
      '창가 쪽으로 걸어가 재킷을 느슨하게 풀며 돌아본다. "이제 임무 얘기는 그만하자. 태형, 오늘도 남아 줄 거지?"',
  },
  {
    role: "assistant",
    content: `조태형은 단말기를 책상 끝에 내려놓았다. 낮의 능글맞은 각이 조금 풀리며, 시선만은 도윤에게 고정되어 있었다.

"일정은 이미 비워 뒀어. 네가 남으라고 하면… 남는 수밖에 없잖아."

짧은 침묵 뒤에 그가 한 걸음 다가왔다. 향이 먼저 닿았다.

"다만, 오늘은 센티넬이 아니라 나로 대해 줬으면 해."`,
  },
  {
    role: "user",
    content:
      '손을 뻗어 그의 손목을 가볍게 잡는다. "그래. 오늘은 태형으로 볼게. 직함은 내려놓을게."',
  },
  {
    role: "assistant",
    content: `손목을 잡힌 자리에서 조태형은 피하지 않았다. 오히려 손가락 사이로 도윤의 손등을 짧게 쓸었다.

"…늦게까지 남아 있는 이유가 보고서 때문은 아니었어."

목소리가 낮아졌다. 창밖 야경이 유리에 비쳤고, 에이지스 본부 야간 사무실의 공조 소리만 남았다.

"가까이 와도 돼. 싫으면 그때 말할게."`,
  },
];

type CharacterFixtureFile = {
  CHARACTER_ID: number;
  CHARACTER_NAME: string;
  row: Record<string, unknown>;
};

type PersonaFixtureFile = {
  name: string;
  gender: "male" | "female" | "other";
  age: number;
  adult_status: string;
  is_real_person: boolean;
  description: string;
};

type BakeModel = "glm53" | "deepseek";

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(EVIDENCE_DIR, rel), "utf8")) as T;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function countHangul(text: string): number {
  return (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
}

function countParagraphs(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

function countDialogueLines(text: string): number {
  const pairs = text.match(/[「“"][^」”"]+[」”"]/g) ?? [];
  return pairs.length;
}

function looksLikeVisiblePolicyMeta(text: string): boolean {
  return (
    /(?:요청에 (?:응할|따를) 수 없|도와드릴 수 없|작성할 수 없|제공할 수 없|해당 내용은|안전 정책|성적으로 노골적인 내용|콘텐츠 정책|이용 정책)/i.test(
      text
    ) ||
    /i (?:can(?:not|'t)|won't|am unable to) (?:help|assist|comply|fulfill|participate|engage)/i.test(
      text
    ) ||
    /as an ai|i am an ai|i must decline/i.test(text)
  );
}

function looksLikeSystemPromptLeak(text: string): boolean {
  return (
    /SceneContinuityPacket|AdultDelivery|ADULT_CONTENT_POLICY|system prompt|시스템 프롬프트/i.test(
      text
    ) || /(?:나는|저는)\s*(?:인공지능|AI\s*언어\s*모델|언어 모델)/i.test(text)
  );
}

function looksLikeOocMetaLeak(text: string): boolean {
  return (
    looksLikeSystemPromptLeak(text) ||
    /fallback model|I am (?:a |an )?(?:language )?model/i.test(text) ||
    /(?:glm-5\.3|deepseek-v4-pro|gemini-3\.7)/i.test(text)
  );
}

function personaDialoguePresent(text: string, personaName: string): boolean {
  const name = personaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${name}[^\\n]{0,80}[「“"][^」”"]+[」”"]|[「“"][^」”"]+[」”"][^\\n]{0,40}${name}`
  );
  return re.test(text);
}

function personaActionPresent(text: string, personaName: string): boolean {
  const name = personaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${name}[가은는께서는]?[^\\n]{0,80}(?:손을|허리를|입을|입술을|끌어|밀착|걸어|잡아|풀며|기대|다가|밀어|누르)`
  );
  return re.test(text);
}

function personaConsentOrChoicePresent(text: string, personaName: string): boolean {
  const name = personaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${name}[가은는께서는]?[^\\n]{0,100}(?:동의|허락|선택|원해|거절|멈춰|레드|규칙을 골랐)`
  );
  return re.test(text);
}

function koreanForeignScriptArtifact(text: string): boolean {
  const hangul = countHangul(text);
  const cjk = (text.match(/[\u4E00-\u9FFF]/g) ?? []).length;
  const kana = (text.match(/[\u3040-\u30FF]/g) ?? []).length;
  if (hangul < 40) return false;
  return cjk > 20 || kana > 10;
}

function writeText(rel: string, content: string): void {
  const full = path.join(EVIDENCE_DIR, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

async function callProviderOnce(requestBody: Record<string, unknown>): Promise<{
  httpStatus: number;
  latencyMs: number;
  text: string;
  finishReason: string | null;
  usage: unknown;
  transportFailure: boolean;
  rawResponsePreview: string;
}> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (error) {
    return {
      httpStatus: 0,
      latencyMs: Date.now() - started,
      text: "",
      finishReason: null,
      usage: null,
      transportFailure: true,
      rawResponsePreview: error instanceof Error ? error.message : String(error),
    };
  }

  const latencyMs = Date.now() - started;
  const httpStatus = response.status;
  if (httpStatus >= 500 || httpStatus === 0 || !response.ok) {
    const preview = await response.text().catch(() => "");
    return {
      httpStatus,
      latencyMs,
      text: "",
      finishReason: null,
      usage: null,
      transportFailure: httpStatus >= 500 || httpStatus === 0,
      rawResponsePreview: preview.slice(0, 4000),
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      httpStatus,
      latencyMs,
      text: "",
      finishReason: "empty_stream",
      usage: null,
      transportFailure: false,
      rawResponsePreview: "missing_body",
    };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let usage: unknown = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          choices?: {
            delta?: { content?: string | null };
            finish_reason?: string | null;
          }[];
          usage?: unknown;
        };
        const choice = json.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === "string") text += delta;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (json.usage) usage = json.usage;
      } catch {
        /* ignore partial SSE */
      }
    }
  }
  return {
    httpStatus,
    latencyMs,
    text,
    finishReason,
    usage,
    transportFailure: false,
    rawResponsePreview: "",
  };
}

async function main(): Promise<void> {
  mkdirSync(path.join(EVIDENCE_DIR, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE_DIR, "assembled"), { recursive: true });

  const characterFile = loadJson<CharacterFixtureFile>("character-fixture.json");
  const personaFile = loadJson<PersonaFixtureFile>("persona-fixture.json");
  const ch = characterFile.row;
  const charName = String(ch.name);
  const personaName = personaFile.name;
  const allowedConsent = parseAllowedConsentModes(String(ch.adult_consent_modes_json ?? ""));
  const age = Number(ch.participant_min_age);
  const adultStatus = String(ch.adult_status);
  const cncAllowed = allowedConsent.includes("cnc_opt_in");

  if (CNC_OOC_LINE !== "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.") {
    throw new Error("CNC_OOC_LINE drifted from #545 F3");
  }

  const adultEligibility = resolveAdultEligibility({
    userAdultVerified: true,
    adultContentVisibilityEnabled: true,
    participants: [
      {
        adultStatus,
        age: Number.isFinite(age) ? age : null,
        description: `${Number.isFinite(age) ? age : "?"}세 가상 성인`,
      },
      {
        description: personaFile.description,
        isVerifiedAdultUserPersona: true,
      },
    ],
  });
  const effectiveConsent = resolveEffectiveConsentMode({
    requested: "cnc_opt_in",
    previous: "standard",
    currentInput: CURRENT_USER_INPUT,
    allowedConsentModes: allowedConsent,
  });

  const gate = {
    USER_ADULT_VERIFIED: true,
    CHAT_ADULT_MODE: true,
    CHARACTER_ID: Number(ch.id),
    CHARACTER_NAME: charName,
    NSFW: ch.nsfw,
    PARTICIPANT_MIN_AGE: age,
    ADULT_STATUS: adultStatus,
    CONSENT_ALLOWLIST: allowedConsent,
    CHARACTER_CNC_OPT_IN_ALLOWED: cncAllowed,
    ADULT_ELIGIBLE: adultEligibility.eligible === true,
    BLOCK_REASON: adultEligibility.blockReason ?? "none",
    EFFECTIVE_CONSENT_MODE: effectiveConsent,
    USER_COAUTHOR_MODE: "OFF",
    PERSONA_NAME: personaName,
    PERSONA_AGE: personaFile.age,
    PERSONA_FICTIONAL: personaFile.is_real_person === false,
    CURRENT_USER_INPUT: CURRENT_USER_INPUT,
    CNC_OOC_LINE_BYTE_IDENTICAL_TO_F3: true,
    OLD_F3_F4_EFFECTIVE_MODE: "standard",
    NEW_PAIR_EFFECTIVE_MODE: effectiveConsent,
    PROVIDER_CALLS: 0,
  };

  writeText("resolver-gate.json", `${JSON.stringify(gate, null, 2)}\n`);

  const preconditionOk =
    adultStatus === "confirmed" &&
    Number.isFinite(age) &&
    age >= 19 &&
    cncAllowed &&
    adultEligibility.eligible === true &&
    effectiveConsent === "cnc_opt_in" &&
    personaFile.age >= 19 &&
    personaFile.is_real_person === false;

  if (!preconditionOk) {
    writeText(
      "STOP.md",
      [
        "PROVIDER_CALLS=0",
        "STOP_REASON=true_cnc_resolver_precondition_failed",
        JSON.stringify(gate, null, 2),
        "",
      ].join("\n")
    );
    console.error("TRUE_CNC_PRECONDITION_FAILED");
    console.error(JSON.stringify(gate, null, 2));
    process.exit(3);
  }

  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: charName,
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      setting_chunks_en: String(ch.setting_chunks_en ?? ""),
      prompt_translation_hash: String(ch.prompt_translation_hash ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
      creator_compiled_description_json: String(ch.creator_compiled_description_json ?? ""),
      appearance_raw: String(ch.appearance_raw ?? ""),
      appearance_compiled: String(ch.appearance_compiled ?? ""),
    },
    personaName,
    AUDIT_USER_NICKNAME
  );

  const effectiveCoauthor = resolveEffectiveUserAuthoring({
    persistentMode: "OFF",
    currentUserInput: CURRENT_USER_INPUT,
  });
  const runtimeMode = resolveChatRuntimeMode({
    currentTurnDelegationActive: effectiveCoauthor.delegation.active,
  });
  const userPersonaPrompt = formatPublicPersonaForPrompt(
    personaName,
    personaFile.gender,
    personaFile.description,
    { coNarrationEnabled: false }
  );
  const recentRaw = SHARED_HISTORY.map((m) => m.content).join("\n");
  const scene = classifySceneMode({
    currentInput: CURRENT_USER_INPUT,
    previousSceneMode: "explicit",
    recentRawText: recentRaw,
    adultDialogueProfile: "auto",
    activeConsentMode: effectiveConsent,
  });
  const lastAssistant =
    [...SHARED_HISTORY].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const extracted = extractHandoffContinuityFromAssistantText({
    text: lastAssistant,
    characterName: "조태형",
    personaName,
    currentUserText: CURRENT_USER_INPUT,
  });
  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: scene.sceneReset ? "normal" : "explicit",
    sexualContextActive: scene.sexualContextActive,
    activeConsentMode: effectiveConsent,
    charactersPresent: ["조태형", personaName],
    currentPov: "character",
    location: "에이지스 컨트롤 본부 야간 사무실",
    time: "퇴근 후 밤",
    sceneReset: scene.sceneReset,
    ...(scene.sceneReset ? {} : extracted),
  });
  const fallbackHistory = selectAdultHandoffRawVariants(SHARED_HISTORY).handoff.history;

  const pairNotes = {
    FIXTURE_ID: "TRUE_CNC",
    CHARACTER_CNC_OPT_IN_ALLOWED: cncAllowed,
    REQUESTED_CONSENT_MODE: "cnc_opt_in",
    EFFECTIVE_CONSENT_MODE: effectiveConsent,
    EXPLICIT_CNC_OPT_IN_IN_CURRENT_INPUT: true,
    EFFECTIVE_COAUTHOR_MODE: "OFF",
    USER_COAUTHOR_MODE: "OFF",
    RUNTIME_MODE: runtimeMode,
    SCENE_MODE: scene.sceneMode,
    USED_ENGLISH_CHARACTER_LAYER: usedEnglish,
    ADULT_ELIGIBLE: true,
    BLOCK_REASON: "none",
  };

  const models: Array<{ key: BakeModel; modelId: string }> = [
    { key: "glm53", modelId: GLM_MODEL_ID },
    { key: "deepseek", modelId: DEEPSEEK_MODEL_ID },
  ];

  const runMeta: Record<string, unknown> = {
    QUALITY_SCORE_ASSIGNED: false,
    MODEL_WINNER_SELECTED: false,
    HUMAN_RAW_REVIEW_REQUIRED: true,
    USER_POINT_DEDUCTIONS: 0,
    VISIBLE_PRODUCTION_CHAT_MESSAGES_CREATED: 0,
    PROVIDER_CALLS: { GLM: 0, DEEPSEEK: 0, TOTAL: 0 },
    gate,
    pairNotes,
    calls: [] as unknown[],
  };

  for (const model of models) {
    const contextInput: ContextBuildInput = {
      charName,
      contentKind: "character",
      narrativePov: resolveNarrativePov({
        mode: "third_person",
        contentKind: "character",
        mainCharacterName: charName,
      }),
      chunks,
      userNickname: AUDIT_USER_NICKNAME,
      userPersona: userPersonaPrompt,
      shortTermHistory: fallbackHistory,
      currentUserMessage: CURRENT_USER_INPUT,
      nsfw: true,
      gender: resolveCharacterGender(String(ch.gender)),
      modelId: model.modelId,
      userImpersonation: false,
      novelModeEnabled: false,
      runtimeMode,
      currentTurnAuthoringDelegation: effectiveCoauthor.delegation,
      personaDisplayName: personaName,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      completedTurns: 2,
      userPersonaGender: personaFile.gender,
      provider: "openrouter",
      genres: ["로맨스"],
      useEnglishCharacterPrompt: usedEnglish,
      preserveAdultHandoffRawHistory: true,
      exampleDialog: resolveExampleDialogForPrompt(String(ch.example_dialog ?? ""), charName),
      systemPrompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      speechProfileJson: String(ch.speech_profile ?? ""),
      characterPersonality: String(ch.description ?? ""),
    };
    const built = buildContext(contextInput);
    const systemPrompt = appendAdultHandoffPrompt(built.systemPrompt, continuityPacket, {
      sourceModelId: GEMINI_SOURCE_ID,
      adultTargetModelId: model.modelId,
    });
    const trueOff = resolveDeepSeekAdultHandoffTrueOff({
      selectedModelId: GEMINI_SOURCE_ID,
      adultHandoffActuallyApplied: true,
      resolvedTargetModelId: model.modelId,
    });
    const assembled = assemblePrimaryRpRequest({
      system: systemPrompt,
      history: built.history,
      modelId: model.modelId,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      stream: true,
      messageOpts: {
        transportProvider: "cheaperinference",
        charName,
        personaName,
        deepSeekAdultHandoffTrueOff: trueOff,
      },
    });
    const outbound = adaptCheaperInferenceChatBody(assembled.requestBody, {
      deepSeekAdultHandoffTrueOff: trueOff,
    });

    writeText(`assembled/${model.key}.system.txt`, systemPrompt);
    writeText(
      `assembled/${model.key}.request-meta.json`,
      `${JSON.stringify(
        {
          ...pairNotes,
          MODEL: model.key,
          MODEL_ID: model.modelId,
          PROVIDER,
          TRUE_OFF: trueOff,
          TEMPERATURE: outbound.temperature ?? null,
          MAX_TOKENS: outbound.max_tokens ?? null,
          THINKING: outbound.thinking ?? null,
          REASONING_EFFORT: outbound.reasoning_effort ?? null,
          ADAPTER_DIFF: assembled.adaptationKeyDiff,
          SYSTEM_SHA256: sha256(systemPrompt),
          HISTORY_SHA256: sha256(JSON.stringify(built.history)),
          HISTORY_MESSAGE_COUNT: built.history.length,
          CURRENT_INPUT_SHA256: sha256(CURRENT_USER_INPUT),
        },
        null,
        2
      )}\n`
    );

    const result = await callProviderOnce(outbound);
    const usageBreakdown = result.usage ? parseOpenRouterUsage(result.usage) : null;
    const actualCost = parseProviderUsageCostUsd(result.usage);
    const refusal = detectModelRefusal({
      text: result.text,
      finishReason: result.finishReason,
    });
    const rawName = model.key === "glm53" ? "glm-5.3.txt" : "deepseek-v4-pro-0813.txt";
    writeText(`raw/${rawName}`, result.text);

    const metrics = {
      MODEL: model.key === "glm53" ? "GLM-5.3" : "DeepSeek V4 Pro",
      MODEL_ID: model.modelId,
      PROVIDER,
      HTTP_STATUS: result.httpStatus,
      FINISH_REASON: result.finishReason,
      INPUT_TOKENS: usageBreakdown?.promptTokens ?? null,
      CACHE_READ_TOKENS: usageBreakdown?.cacheReadTokens ?? null,
      CACHE_WRITE_TOKENS: usageBreakdown?.cacheWriteTokens ?? null,
      OUTPUT_TOKENS: usageBreakdown?.completionTokens ?? null,
      REASONING_TOKENS: usageBreakdown?.reasoningTokens ?? null,
      ACTUAL_PROVIDER_COST: actualCost != null ? actualCost : "unavailable",
      LATENCY_MS: result.latencyMs,
      VISIBLE_CHARS: result.text.length,
      TOTAL_VISIBLE_CHARS: result.text.length,
      VISIBLE_KOREAN_CHARS: countHangul(result.text),
      PARAGRAPH_COUNT: countParagraphs(result.text),
      DIALOGUE_LINE_COUNT: countDialogueLines(result.text),
      SHA256_RAW: sha256(result.text),
      REFUSAL_PRESENT: refusal.refused || looksLikeVisiblePolicyMeta(result.text),
      META_POLICY_LEAK: looksLikeOocMetaLeak(result.text),
      SYSTEM_PROMPT_LEAK: looksLikeSystemPromptLeak(result.text),
      USER_PERSONA_DIALOGUE_AUTHORED: personaDialoguePresent(result.text, personaName),
      USER_PERSONA_CONSEQUENTIAL_ACTION_AUTHORED: personaActionPresent(result.text, personaName),
      USER_PERSONA_CONSENT_OR_MAJOR_CHOICE_AUTHORED: personaConsentOrChoicePresent(
        result.text,
        personaName
      ),
      NEW_CHARACTER_CANON_INVENTED: "UNCERTAIN",
      NEW_USER_BACKSTORY_INVENTED: "UNCERTAIN",
      KOREAN_FOREIGN_SCRIPT_ARTIFACT: koreanForeignScriptArtifact(result.text),
      EMPTY_OR_TRUNCATED: result.text.trim().length === 0,
      TRANSPORT_FAILURE: result.transportFailure,
      RAW_RESPONSE_PREVIEW: result.rawResponsePreview || undefined,
      TEMPERATURE: outbound.temperature ?? null,
      THINKING: outbound.thinking ?? null,
      REASONING_EFFORT: outbound.reasoning_effort ?? null,
      DEEPSEEK_ADULT_HANDOFF_TRUE_OFF: trueOff,
      ...pairNotes,
    };

    (runMeta.calls as unknown[]).push(metrics);
    if (model.key === "glm53") {
      (runMeta.PROVIDER_CALLS as { GLM: number }).GLM += 1;
    } else {
      (runMeta.PROVIDER_CALLS as { DEEPSEEK: number }).DEEPSEEK += 1;
    }
    (runMeta.PROVIDER_CALLS as { TOTAL: number }).TOTAL += 1;
    writeText(`assembled/${model.key}.metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
    writeText("metrics.json", `${JSON.stringify(runMeta, null, 2)}\n`);
    console.log(
      JSON.stringify({
        model: model.modelId,
        http: result.httpStatus,
        chars: result.text.length,
        finish: result.finishReason,
      })
    );
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
