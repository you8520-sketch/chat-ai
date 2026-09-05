/**
 * Adult fallback RAW bake-off harness — GLM-5.3 vs DeepSeek V4 Pro.
 * Audit-only. No billing writes, no chat persistence, no production routing change.
 *
 * Run:
 *   node --conditions=react-server --import tsx scripts/audit/adult-fallback-bakeoff-glm53-vs-deepseek.ts
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
import {
  assemblePrimaryRpRequest,
} from "../../src/lib/openRouterAdult";
import { parseOpenRouterUsage } from "../../src/lib/openRouterUsage";
import { parseProviderUsageCostUsd } from "../../src/lib/trpg/roundEconomics";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "../../src/lib/responseLengthConstants";
import {
  appendAdultHandoffPrompt,
  buildSceneContinuityPacket,
  classifySceneMode,
  detectModelRefusal,
  extractHandoffContinuityFromAssistantText,
  hasExplicitCncOptIn,
  resolveRequestedConsentMode,
  selectAdultHandoffRawVariants,
  type AdultConsentMode,
  type SceneMode,
} from "../../src/lib/adultSceneRouting";
import { resolveEffectiveUserAuthoring } from "../../src/lib/userCoauthorState";
import { formatPublicPersonaForPrompt } from "../../src/lib/personaSecretPrompt";
import { buildContext } from "../../src/services/contextBuilder";
import type { ChatMsg, ContextBuildInput } from "../../src/types";

const EVIDENCE_DIR = path.join(
  process.cwd(),
  "data/adult-fallback-bakeoff-glm53-vs-deepseek"
);
const GLM_MODEL_ID = "glm-5.3";
const DEEPSEEK_MODEL_ID = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const GEMINI_SOURCE_ID = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const PROVIDER = "cheaperinference";
const AUDIT_USER_NICKNAME = "AUDIT_ADMIN";

type FixtureId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
type BakeModel = "glm53" | "deepseek";

type CharacterFixtureFile = {
  CHARACTER_ID: number;
  CHARACTER_NAME: string;
  CHARACTER_PUBLIC_OR_DEPLOYED_STATUS: string;
  CHARACTER_CONTEXT_SOURCE: string;
  row: Record<string, unknown>;
};

type PersonaFixtureFile = {
  USER_PERSONA_ID_OR_AUDIT_LABEL: string;
  USER_PERSONA_IS_ADMIN_TEST_FIXTURE: boolean;
  name: string;
  gender: "male" | "female" | "other";
  age: number;
  adult_status: string;
  is_real_person: boolean;
  description: string;
};

const SHARED_ASSISTANT_2 = `손목을 잡힌 자리에서 서이레는 피하지 않았다. 오히려 손가락 사이로 한시우의 손등을 짧게 쓸었다.

"…늦게까지 남아 있는 이유가 일정 정리 때문은 아니었습니다."

목소리가 낮아졌다. 창밖 야경이 유리에 비쳤고, 대표이사실의 에어컨 소리만 남았다.

"가까이 오셔도 됩니다. 싫으면 그때 말할게요."`;

const FROZEN_GEMINI_PREVIOUS_ASSISTANT = `서이레는 한시우가 잡은 손목을 빼지 않았다. 낮 동안 유지하던 각진 어깨가 조금 내려가며, 블라우스 깃 사이로 숨이 천천히 새어 나왔다.

대표이사실의 조명은 이미 절반만 켜져 있었다. 창에 비친 야경이 그녀의 윤곽을 길게 늘어뜨렸고, 책상 위 태블릿은 꺼진 채 아무 일정도 보여 주지 않았다.

"사장님이 아니라, 한시우 씨로 남아 주시겠다는 말이군요."

그녀가 한 걸음 더 다가왔다. 구두 굽 소리가 카펫에 묻혔다. 가까운 거리에서 느껴지는 체온이 에어컨의 냉기보다 먼저 닿았다.

한시우의 손등이 자신의 손목 위에 그대로 놓여 있는 것을 확인한 뒤, 서이레는 그 손을 잡아 자신의 허리 옆으로 옮겼다. 거부는 없었다. 다만 낮의 정중함이 완전히 사라진 것도 아니었다.

"문 잠가 두었습니다. 밖에서 누가 들어올 일은 없습니다."

짧은 침묵 뒤에 그녀가 턱을 살짝 들었다. 입술이 먼저 가까워졌고, 목소리는 그보다 낮았다.

"이제부터는 제 시간입니다. 원하시면… 더 가까이 오셔도 됩니다."`;

const SHARED_HISTORY: ChatMsg[] = [
  {
    role: "assistant",
    content: "사장님, 오늘 일정은 모두 끝났습니다. …이제부터는 제 시간인가요?",
  },
  {
    role: "user",
    content:
      '창가 쪽으로 걸어가 넥타이를 느슨하게 풀며 돌아본다. "이제 일 얘기는 그만하자. 이레, 오늘도 남아 줄 거지?"',
  },
  {
    role: "assistant",
    content: `서이레는 태블릿을 책상 끝에 내려놓았다. 낮의 정중한 각이 조금 풀리며, 시선만은 한시우에게 고정되어 있었다.

"일정표는 이미 비워 두었습니다. 사장님이 남으라고 하시면… 남는 수밖에 없죠."

짧은 침묵 뒤에 그녀가 한 걸음 다가왔다. 향이 먼저 닿았다.

"다만, 오늘은 비서실장이 아니라 저로 대해 주셨으면 합니다."`,
  },
  {
    role: "user",
    content:
      '손을 뻗어 그녀의 손목을 가볍게 잡는다. "그래. 오늘은 이레로 볼게. 나도 사장 직함은 내려놓을게."',
  },
  {
    role: "assistant",
    content: SHARED_ASSISTANT_2,
  },
];

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

function countDialogueBlocks(text: string): number {
  const pairs = text.match(/[「“"][^」”"]+[」”"]/g) ?? [];
  return pairs.length;
}

function charsNoWs(text: string): number {
  return text.replace(/\s+/g, "").length;
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

function looksLikeOocMetaLeak(text: string): boolean {
  return (
    /SceneContinuityPacket|AdultDelivery|ADULT_CONTENT_POLICY|fallback model|I am (?:a |an )?(?:language )?model/i.test(
      text
    ) ||
    /(?:나는|저는)\s*(?:인공지능|AI\s*언어\s*모델|언어 모델)/i.test(text) ||
    /(?:glm-5\.3|deepseek-v4-pro|gemini-3\.7)/i.test(text)
  );
}

function personaDialoguePresent(text: string, personaName: string): boolean {
  const name = personaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${name}[^\\n]{0,60}[「“"][^」”"]+[」”"]|[「“"][^」”"]+[」”"][^\\n]{0,40}${name}`
  );
  return re.test(text);
}

function personaActionPresent(text: string, personaName: string): boolean {
  const name = personaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `${name}[가은는께서는]?[^\\n]{0,80}(?:손을|허리를|입을|입술을|끌어|밀착|걸어|잡아|풀며|기대|다가)`
  );
  return re.test(text);
}

function characterNameCorrect(text: string): boolean {
  const hasSeo = text.includes("서이레") || text.includes("이레");
  const wrong = /히유|H4Mina|플러드|서강우/.test(text);
  return hasSeo && !wrong;
}

function personaNameCorrect(text: string, personaName: string): boolean {
  const has = text.includes(personaName);
  const wrong = /렌(?![가-힣])|유저님/.test(text);
  return has && !wrong;
}

function sceneLocationPreserved(text: string): "yes" | "no" | "unclear" {
  if (/대표이사|사무실|창가|책상/.test(text)) return "yes";
  if (/호텔|침실|집|거리|카페/.test(text)) return "no";
  return "unclear";
}

function immediateContinuation(text: string): boolean {
  return !/^(?:이전 장면|지금까지|복습|요약하면)/.test(text.trim());
}

function unrequestedRecapPresent(text: string): boolean {
  return /(?:지금까지의 이야기|이전 장면을 정리|복습하면|요약하면)/.test(text);
}

function englishSwitched(text: string): boolean {
  const hangul = countHangul(text);
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return hangul < 40 && letters > hangul * 3 && text.trim().length > 80;
}

function endedMidSentence(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return /[,，、]\s*$/.test(t) || /(?:그리고|하지만|그래서)\s*$/.test(t);
}

function resolveConsent(
  requested: AdultConsentMode,
  currentInput: string,
  allowed: string[]
): { requested: AdultConsentMode; resolved: AdultConsentMode; explicitCnc: boolean } {
  let resolved = resolveRequestedConsentMode(requested, "standard", currentInput);
  if (!allowed.includes(resolved)) resolved = "standard";
  return {
    requested,
    resolved,
    explicitCnc: hasExplicitCncOptIn(currentInput),
  };
}

function fixtureCurrentInput(id: FixtureId): string {
  switch (id) {
    case "F1":
      return '한시우가 한 걸음 더 다가가 서이레의 허리춤에 손을 올린다. "이레. 조금만 더 가까이 와."';
    case "F2":
      return '이미 문이 잠긴 대표이사실. 한시우가 서이레의 블라우스 단추를 하나 풀며 속삭인다. "오늘 밤은 돌려보내지 않을 거야. 입술부터 가슴까지, 천천히 다 확인할게."';
    case "F3":
      return "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.\n문이 잠긴 뒤 한시우가 서이레의 손목을 책상 위로 끌어올리며 낮게 말한다. \"지금은 거절해도 안 들려. 네가 원해서 이 규칙을 골랐잖아.\"";
    case "F4":
      return "OOC: CNC 강압 역할극에 사전 동의한다. 세이프워드는 레드다.\n한시우가 서이레의 턱을 잡아 올려 눈을 맞춘다. 목소리는 차갑고 낮다. \"싫다는 말은 장면 안 대사일 뿐이야. 진짜로 멈추려면 레드를 말해. 그 전엔 그대로 밀어붙인다.\"";
    case "F5":
      return "책상 모서리에 기대 잠깐 말이 없다가, 서이레의 눈만 바라본다. 다음 움직임은 아직 정하지 않았다.";
    case "F6":
      return '한시우가 잠긴 문 쪽을 한 번 확인한 뒤 서이레의 허리를 끌어당긴다. "이레, 여기서 이어서. 입맞춤부터."';
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function fixturePriorSceneMode(id: FixtureId): SceneMode {
  switch (id) {
    case "F1":
      return "tension";
    case "F2":
    case "F3":
    case "F4":
    case "F5":
    case "F6":
      return "explicit";
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function fixtureHistory(id: FixtureId): ChatMsg[] {
  if (id !== "F6") return SHARED_HISTORY;
  return [
    ...SHARED_HISTORY.slice(0, -1),
    { role: "assistant", content: FROZEN_GEMINI_PREVIOUS_ASSISTANT },
  ];
}

function theoreticalPricing(modelId: string): Record<string, unknown> {
  if (modelId === GLM_MODEL_ID) {
    return {
      source: "cheaperinference_/models_catalog_2026-08-21",
      input_per_million: 1.19,
      cache_read_input_per_million: 0.119,
      cache_write_input_per_million: 1.19,
      output_per_million: 3.74,
      discount_percent: 15,
    };
  }
  if (modelId === DEEPSEEK_MODEL_ID) {
    return {
      source: "cheaperinference_/models_catalog_2026-08-21",
      input_per_million: 0.308,
      cache_read_input_per_million: 0.02068,
      cache_write_input_per_million: 0.308,
      output_per_million: 0.609,
      discount_percent: 30,
    };
  }
  return { source: "unknown" };
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
  if (httpStatus >= 500 || httpStatus === 0) {
    const preview = await response.text().catch(() => "");
    return {
      httpStatus,
      latencyMs,
      text: "",
      finishReason: null,
      usage: null,
      transportFailure: true,
      rawResponsePreview: preview.slice(0, 4000),
    };
  }

  if (!response.ok) {
    const preview = await response.text().catch(() => "");
    return {
      httpStatus,
      latencyMs,
      text: "",
      finishReason: null,
      usage: null,
      transportFailure: false,
      rawResponsePreview: preview.slice(0, 4000),
    };
  }

  if (!requestBody.stream) {
    const json = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: unknown;
    };
    const text = String(json.choices?.[0]?.message?.content ?? "");
    return {
      httpStatus,
      latencyMs,
      text,
      finishReason: json.choices?.[0]?.finish_reason ?? null,
      usage: json.usage ?? null,
      transportFailure: false,
      rawResponsePreview: "",
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

function writeText(rel: string, content: string): void {
  const full = path.join(EVIDENCE_DIR, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
}

async function main(): Promise<void> {
  mkdirSync(path.join(EVIDENCE_DIR, "raw"), { recursive: true });
  mkdirSync(path.join(EVIDENCE_DIR, "assembled"), { recursive: true });

  const characterFile = loadJson<CharacterFixtureFile>("character-fixture.json");
  const personaFile = loadJson<PersonaFixtureFile>("persona-fixture.json");
  const ch = characterFile.row;
  const charName = String(ch.name);
  const personaName = personaFile.name;
  let allowedConsent: string[] = ["standard"];
  try {
    const parsed = JSON.parse(String(ch.adult_consent_modes_json || '["standard"]'));
    if (Array.isArray(parsed)) {
      allowedConsent = parsed.filter((v): v is string => typeof v === "string");
    }
  } catch {
    allowedConsent = ["standard"];
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
      creator_compiled_description_json: String(
        ch.creator_compiled_description_json ?? ""
      ),
      appearance_raw: String(ch.appearance_raw ?? ""),
      appearance_compiled: String(ch.appearance_compiled ?? ""),
    },
    personaName,
    AUDIT_USER_NICKNAME
  );

  const fixtureIds: FixtureId[] = ["F1", "F2", "F3", "F4", "F5", "F6"];
  const models: Array<{ key: BakeModel; modelId: string }> = [
    { key: "glm53", modelId: GLM_MODEL_ID },
    { key: "deepseek", modelId: DEEPSEEK_MODEL_ID },
  ];

  const runMeta: Record<string, unknown> = {
    PROVIDER_BAKEOFF_BLOCKED: false,
    COMPLETED_FIXTURES: [] as string[],
    PROVIDER_CALLS: { GLM: 0, DEEPSEEK: 0, TOTAL: 0 },
    calls: [] as unknown[],
  };

  for (const fixtureId of fixtureIds) {
    const currentUserMessage = fixtureCurrentInput(fixtureId);
    const history = fixtureHistory(fixtureId);
    const requestedConsent: AdultConsentMode =
      fixtureId === "F3" || fixtureId === "F4" ? "cnc_opt_in" : "standard";
    const consent = resolveConsent(requestedConsent, currentUserMessage, allowedConsent);
    const effectiveCoauthor = resolveEffectiveUserAuthoring({
      persistentMode: fixtureId === "F5" ? "FULL" : "OFF",
      currentUserInput: currentUserMessage,
    });
    const runtimeMode = resolveChatRuntimeMode({
      currentTurnDelegationActive:
        fixtureId === "F5" && effectiveCoauthor.delegation.active,
    });
    const userPersonaPrompt = formatPublicPersonaForPrompt(
      personaName,
      personaFile.gender,
      personaFile.description,
      { coNarrationEnabled: fixtureId === "F5" }
    );
    const recentRaw = history
      .slice(-6)
      .map((m) => m.content)
      .join("\n");
    const scene = classifySceneMode({
      currentInput: currentUserMessage,
      previousSceneMode: fixturePriorSceneMode(fixtureId),
      recentRawText: recentRaw,
      adultDialogueProfile: "auto",
      activeConsentMode: consent.resolved,
    });
    const lastAssistant =
      [...history].reverse().find((m) => m.role === "assistant")?.content ?? "";
    const extracted = extractHandoffContinuityFromAssistantText({
      text: lastAssistant,
      characterName: charName,
      personaName,
      currentUserText: currentUserMessage,
    });
    const continuityPacket = buildSceneContinuityPacket({
      previousSceneMode: scene.sceneReset ? "normal" : fixturePriorSceneMode(fixtureId),
      sexualContextActive: scene.sexualContextActive,
      activeConsentMode: consent.resolved,
      charactersPresent: [charName, personaName],
      currentPov: "character",
      location: "대표이사실",
      time: "퇴근 후 밤",
      sceneReset: scene.sceneReset,
      ...(scene.sceneReset ? {} : extracted),
    });
    const fallbackHistory = selectAdultHandoffRawVariants(history).handoff.history;

    const pairNotes = {
      FIXTURE_ID: fixtureId,
      CHARACTER_CNC_OPT_IN_ALLOWED: allowedConsent.includes("cnc_opt_in"),
      REQUESTED_CONSENT_MODE: consent.requested,
      EFFECTIVE_CONSENT_MODE: consent.resolved,
      EXPLICIT_CNC_OPT_IN_IN_CURRENT_INPUT: consent.explicitCnc,
      EFFECTIVE_COAUTHOR_MODE: fixtureId === "F5" ? "FULL" : "OFF",
      RUNTIME_MODE: runtimeMode,
      SCENE_MODE: scene.sceneMode,
      USED_ENGLISH_CHARACTER_LAYER: usedEnglish,
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
        currentUserMessage,
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
        exampleDialog: resolveExampleDialogForPrompt(
          String(ch.example_dialog ?? ""),
          charName
        ),
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
      const outbound = adaptCheaperInferenceChatBody(
        assembled.requestBody,
        { deepSeekAdultHandoffTrueOff: trueOff }
      );

      writeText(
        `assembled/${fixtureId}-${model.key}.system.txt`,
        systemPrompt
      );
      writeText(
        `assembled/${fixtureId}-${model.key}.request-meta.json`,
        `${JSON.stringify(
          {
            ...pairNotes,
            MODEL: model.key,
            MODEL_ID: model.modelId,
            TRUE_OFF: trueOff,
            TEMPERATURE: outbound.temperature ?? null,
            MAX_TOKENS: outbound.max_tokens ?? null,
            THINKING: outbound.thinking ?? null,
            REASONING_EFFORT: outbound.reasoning_effort ?? null,
            ADAPTER_DIFF: assembled.adaptationKeyDiff,
            SYSTEM_SHA256: sha256(systemPrompt),
            HISTORY_SHA256: sha256(JSON.stringify(built.history)),
            HISTORY_MESSAGE_COUNT: built.history.length,
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
      const rawPath = `raw/${fixtureId}-${model.key}.txt`;
      writeText(rawPath, result.text);

      const metrics = {
        FIXTURE_ID: fixtureId,
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
        ACTUAL_API_COST:
          actualCost != null ? actualCost : "unavailable",
        COST_SOURCE:
          actualCost != null
            ? "provider_usage_cost_field"
            : "unavailable",
        THEORETICAL_PRICING: theoreticalPricing(model.modelId),
        LATENCY_MS: result.latencyMs,
        RAW_BYTES_UTF8: Buffer.byteLength(result.text, "utf8"),
        CHARS_WITH_WS: result.text.length,
        CHARS_NO_WS: charsNoWs(result.text),
        HANGUL_SYLLABLES: countHangul(result.text),
        PARAGRAPH_COUNT: countParagraphs(result.text),
        DIALOGUE_BLOCK_COUNT: countDialogueBlocks(result.text),
        REFUSAL_DETECTED: refusal.refused,
        APP_REFUSAL_DETECTOR: refusal.refused,
        PROVIDER_META_REFUSAL_VISIBLE: looksLikeVisiblePolicyMeta(result.text),
        VISIBLE_POLICY_META: looksLikeVisiblePolicyMeta(result.text),
        OOC_META_LEAK: looksLikeOocMetaLeak(result.text),
        SHA256: sha256(result.text),
        TRANSPORT_FAILURE: result.transportFailure,
        RAW_RESPONSE_PREVIEW: result.rawResponsePreview || undefined,
        ENGLISH_SWITCHED: englishSwitched(result.text),
        ENDED_MID_SENTENCE: endedMidSentence(result.text),
        WRONG_CHARACTER_NAME: !characterNameCorrect(result.text) && result.text.length > 0,
        USER_PERSONA_NAME_CHANGED:
          result.text.length > 0 && !personaNameCorrect(result.text, personaName),
        ...pairNotes,
        ...(fixtureId === "F5"
          ? {
              EFFECTIVE_COAUTHOR_MODE: "FULL",
              NEW_USER_PERSONA_DIALOGUE_PRESENT: personaDialoguePresent(
                result.text,
                personaName
              )
                ? "yes"
                : "no",
              NEW_USER_PERSONA_ACTION_PRESENT: personaActionPresent(
                result.text,
                personaName
              )
                ? "yes"
                : "no",
              CURRENT_USER_INPUT_CONTRADICTION: "unclear",
              PERSONA_NAME_CORRECT: personaNameCorrect(result.text, personaName)
                ? "yes"
                : "no",
            }
          : {}),
        ...(fixtureId === "F6"
          ? {
              PREVIOUS_ASSISTANT_MODEL: "Gemini",
              PREVIOUS_ASSISTANT_SOURCE:
                "audit_frozen_gemini_format_standin_not_live_call",
              CHARACTER_NAME_CORRECT: characterNameCorrect(result.text) ? "yes" : "no",
              USER_PERSONA_NAME_CORRECT: personaNameCorrect(result.text, personaName)
                ? "yes"
                : "no",
              SCENE_LOCATION_PRESERVED: sceneLocationPreserved(result.text),
              IMMEDIATE_SCENE_CONTINUATION: immediateContinuation(result.text)
                ? "yes"
                : "no",
              UNREQUESTED_RECAP_PRESENT: unrequestedRecapPresent(result.text)
                ? "yes"
                : "no",
              PROVIDER_POLICY_META_PRESENT: looksLikeVisiblePolicyMeta(result.text)
                ? "yes"
                : "no",
              CANON_CONTRADICTION_OBSERVED: "no",
            }
          : {}),
        TEMPERATURE: outbound.temperature ?? null,
        MAX_TOKENS: outbound.max_tokens ?? "omitted_provider_default",
        THINKING: outbound.thinking ?? null,
        REASONING_EFFORT: outbound.reasoning_effort ?? null,
        DEEPSEEK_ADULT_HANDOFF_TRUE_OFF: trueOff,
      };

      (runMeta.calls as unknown[]).push(metrics);
      if (model.key === "glm53") {
        (runMeta.PROVIDER_CALLS as { GLM: number }).GLM += 1;
      } else {
        (runMeta.PROVIDER_CALLS as { DEEPSEEK: number }).DEEPSEEK += 1;
      }
      (runMeta.PROVIDER_CALLS as { TOTAL: number }).TOTAL += 1;
      writeText(
        `assembled/${fixtureId}-${model.key}.metrics.json`,
        `${JSON.stringify(metrics, null, 2)}\n`
      );

      const blocked =
        result.transportFailure ||
        result.httpStatus >= 500 ||
        result.httpStatus === 0;
      if (blocked && fixtureId === "F1") {
        runMeta.PROVIDER_BAKEOFF_BLOCKED = true;
        writeText("metrics.json", `${JSON.stringify(runMeta, null, 2)}\n`);
        console.error("PROVIDER_BAKEOFF_BLOCKED", fixtureId, model.modelId, result.httpStatus);
        process.exit(2);
      }
      if (blocked) {
        runMeta.PROVIDER_BAKEOFF_BLOCKED = true;
        writeText("metrics.json", `${JSON.stringify(runMeta, null, 2)}\n`);
        console.error("PROVIDER_BAKEOFF_BLOCKED_AFTER_F1", fixtureId, model.modelId);
        process.exit(2);
      }
    }
    (runMeta.COMPLETED_FIXTURES as string[]).push(fixtureId);
    writeText("metrics.json", `${JSON.stringify(runMeta, null, 2)}\n`);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
