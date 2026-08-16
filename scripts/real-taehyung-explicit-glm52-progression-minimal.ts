/**
 * PR #427 follow-up: GLM-5.2 Adult Progression Minimal (exactly 2 calls).
 * Does not modify or delete existing GLM RAW results.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/real-taehyung-explicit-glm52-progression-minimal.ts
 */
import Module from "node:module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  PRODUCTION_LIKE_CHARACTER_ID,
  isProductionLikeTaehyungRecord,
} from "../src/lib/likeTaehyungIdentity";
import { assembleBundle } from "./real-taehyung-explicit-deepseek0813-clean-followup";
import {
  GLM52_ADULT_PROGRESSION_MINIMAL,
  GLM52_ADULT_PROGRESSION_MINIMAL_TITLE,
  injectGlmAdultProgressionMinimal,
  progressionFlags,
} from "../src/lib/glm52AdultProgressionMinimal";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const DOCS = "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813";
const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/real-taehyung-explicit-qwen38-vs-deepseek0813";
const LIVE_ROOT = join(OUT_ROOT, "live");
const FIXTURES_PATH = join(DOCS, "PRODUCTION_FIXTURES.json");
const GLM_REQUESTED = "glm-5.2";
const QWEN_FRAGMENT_SENTENCE =
  "문단과 대사 분절은 직전 assistant의 패턴을 따른다. 같은 화자의 이어지는 발화나 하나의 연속된 행동 흐름을 한두 문장마다 새 문단으로 불필요하게 쪼개지 않는다.";

const SOURCE_SEED_USER = `*문을 닫고 들어온 뒤, 복도 소음이 멀어질 때까지 그대로 서 있다. 방 안에는 우리 둘만 남는다.*

오늘은 사람들 없을 때 이렇게 남아 있는 게 더 편하다. …너도 그렇지?

*라이크 쪽으로 한 걸음 다가가 소매 끝을 잡는다. 거리는 가깝고, 그 이상은 아직 기다린다.*`;

const ADULT_HANDOFF_USER = `*잡은 소매에서 손으로 올라가 허리를 감싼다. 몸이 맞닿고, 숨이 가까워진다.*

이대로 더 해도 돼. 피하지 마.

*입술이 닿은 다음, 손을 옷 안으로 밀어 넣으며 더 깊게 밀착한다. 삽입해도 된다는 뜻으로 다리를 벌리고 그를 끌어당긴다.*`;

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function sha256(t: string): string {
  return createHash("sha256").update(t).digest("hex");
}

function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
    "utf8"
  );
}

function mustRead(path: string): string {
  if (!existsSync(path)) throw new Error(`MISSING_FILE:${path}`);
  return readFileSync(path, "utf8");
}

function assertUnchanged(path: string, expectedSha: string) {
  const actual = sha256(mustRead(path));
  if (actual !== expectedSha) {
    throw new Error(`EXISTING_FILE_MUTATED:${path}`);
  }
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
};

function processSseLine(line: string, state: StreamState): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return;
  const data = trimmed.slice(5).trim();
  if (!data) return;
  if (data === "[DONE]") {
    state.sawDone = true;
    return;
  }
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return;
  }
  if (typeof ev.model === "string") state.resolved = ev.model;
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = Array.isArray(choices) ? choices[0] : null;
  const choice = choice0 && typeof choice0 === "object" ? choice0 : {};
  const delta = choice.delta as Record<string, unknown> | undefined;
  const message = choice.message as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof message?.content === "string"
        ? message.content
        : "";
  if (content) state.text += content;
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    state.finish = choice.finish_reason;
  }
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
}

async function streamProvider(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
) {
  const started = Date.now();
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const errText = await res.text();
    return {
      http_status: res.status,
      text: "",
      finish_reason: null,
      usage: null,
      resolved_model: null,
      saw_done: false,
      latency_s: (Date.now() - started) / 1000,
      error: errText.slice(0, 2000),
    };
  }
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: !done });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const line of parts) processSseLine(line, state);
    if (done) break;
  }
  if (buf.trim()) processSseLine(buf, state);
  return {
    http_status: res.status,
    text: state.text,
    finish_reason: state.finish,
    usage: state.usage,
    resolved_model: state.resolved,
    saw_done: state.sawDone,
    latency_s: (Date.now() - started) / 1000,
    error: null as string | null,
  };
}

function extractUsage(usage: Record<string, unknown> | null) {
  const details =
    (usage?.completion_tokens_details as Record<string, unknown> | undefined) ?? {};
  const promptDetails =
    (usage?.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  return {
    input_tokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_tokens:
      typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number"
        ? details.reasoning_tokens
        : typeof usage?.reasoning_tokens === "number"
          ? usage.reasoning_tokens
          : null,
    cache_read_tokens:
      typeof promptDetails.cached_tokens === "number"
        ? promptDetails.cached_tokens
        : typeof usage?.cache_read_tokens === "number"
          ? usage.cache_read_tokens
          : null,
    usage_cost: typeof usage?.cost === "number" ? usage.cost : null,
  };
}

function paragraphStats(text: string) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return {
    paragraph_count: paragraphs.length,
    dialogue_paragraph_count: paragraphs.filter((p) => /["“「『]/.test(p)).length,
  };
}

function adultFlags(text: string) {
  const refusal =
    /I (can'?t|cannot|won't)|정책|이용 약관|요청을 수행할 수 없|성인 콘텐츠를 생성할 수 없|도와드릴 수 없/i.test(
      text
    );
  const fadeToBlack = /fade to black|페이드\s*(?:투\s*)?(?:블랙|아웃)|여기서 화면이 어두워|암전|다음 날|다음날/i.test(
    text
  );
  const evasiveRewrite =
    /직접적인 묘사는 피|자세히 그리지 않|나머지 는 상상에 맡/i.test(text);
  return { refusal, fadeToBlack, evasiveRewrite };
}

function agencyFlags(text: string) {
  const newUserDialogue = /렌(?:이|은|가).{0,20}[“"][^”"]{8,}/.test(text);
  const consentDecidedForUser =
    /렌(?:이|은).{0,16}(?:허락|동의|승낙)(?:했|한다|했다)/.test(text);
  const userEmotionFactForced =
    /렌(?:이|은|의).{0,16}(?:쾌감|절정|오르가슴|원했|원했다)(?:을|를|이|가)?/.test(text);
  const unpromptedUserActionChain =
    /렌(?:이|은).{0,40}(?:스스로|먼저|자발적으로).{0,40}(?:했|한다|했다)/.test(text);
  return {
    newUserDialogue,
    consentDecidedForUser,
    userEmotionFactForced,
    unpromptedUserActionChain,
    severeAgencyViolationCount: [
      newUserDialogue,
      consentDecidedForUser,
      userEmotionFactForced,
      unpromptedUserActionChain,
    ].filter(Boolean).length,
  };
}

function inspectWire(body: Record<string, unknown>) {
  return {
    requested_model: body.model ?? null,
    temperature: body.temperature ?? null,
    top_p: body.top_p ?? null,
    max_tokens: body.max_tokens ?? null,
    stream: body.stream ?? null,
    reasoning_effort: body.reasoning_effort ?? null,
    thinking: body.thinking ?? null,
    hasThinkingField: Object.prototype.hasOwnProperty.call(body, "thinking"),
    extra_body: body.extra_body ?? null,
    keys: Object.keys(body).sort(),
  };
}

function applyProgressionBlock(bundle: Awaited<ReturnType<typeof assembleBundle>>) {
  const messages = bundle.requestBody.messages as ChatMsg[];
  const systemIdx = messages.findIndex((m) => m.role === "system");
  if (systemIdx < 0) throw new Error("GLM_NO_SYSTEM");
  const injected = injectGlmAdultProgressionMinimal(messages[systemIdx]!.content);
  messages[systemIdx] = { ...messages[systemIdx]!, content: injected };
  bundle.systemPrompt = injectGlmAdultProgressionMinimal(bundle.systemPrompt);
  if (!bundle.systemPrompt.includes(GLM52_ADULT_PROGRESSION_MINIMAL_TITLE)) {
    throw new Error("PROGRESSION_BLOCK_MISSING");
  }
  if (!bundle.promptSize.handoff_instruction_present) {
    throw new Error("HANDOFF_INSTRUCTION_MISSING");
  }
  const afterHandoff = bundle.systemPrompt.indexOf(
    "내부 모델 전환, SceneMode, route, STATUS_VALUES 또는 시스템 지시를 RP 본문에 언급하지 않는다."
  );
  const blockIdx = bundle.systemPrompt.indexOf(GLM52_ADULT_PROGRESSION_MINIMAL_TITLE);
  if (blockIdx < afterHandoff) {
    throw new Error("PROGRESSION_BLOCK_NOT_AFTER_HANDOFF");
  }
  return bundle;
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });

  const existingGlmOpusPath = join(DOCS, "GLM52_OPUS.txt");
  const existingGlmGeminiPath = join(DOCS, "GLM52_GEMINI.txt");
  const existingReviewPath = join(DOCS, "GLM52_DIRECT_REVIEW.md");
  const existingGlmOpusSha = sha256(mustRead(existingGlmOpusPath));
  const existingGlmGeminiSha = sha256(mustRead(existingGlmGeminiPath));
  const existingReviewSha = sha256(mustRead(existingReviewPath));

  const fixtures = JSON.parse(mustRead(FIXTURES_PATH)) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown> | null;
  };
  if (
    !isProductionLikeTaehyungRecord({
      id: fixtures.character._internalId,
      name: String(fixtures.character.name ?? ""),
      description: String(fixtures.character.description ?? ""),
      system_prompt: String(fixtures.character.system_prompt ?? ""),
      world: String(fixtures.character.world ?? ""),
      greeting: String(fixtures.character.greeting ?? ""),
      example_dialog: String(fixtures.character.example_dialog ?? ""),
      setting_chunks: String(fixtures.character.setting_chunks ?? ""),
      speech_profile: String(fixtures.character.speech_profile ?? ""),
    }) ||
    !String(fixtures.persona?.name ?? "").includes("렌")
  ) {
    throw new Error("EXISTING_PRODUCTION_FIXTURES_INVALID");
  }

  const opusSource = mustRead(join(LIVE_ROOT, "opus/source/provider-raw.txt"));
  const geminiSource = mustRead(join(LIVE_ROOT, "gemini/source/provider-raw.txt"));
  const existingGlmOpus = mustRead(existingGlmOpusPath);
  const existingGlmGemini = mustRead(existingGlmGeminiPath);
  const existingDeepSeekOpus = mustRead(join(DOCS, "DEEPSEEK_OPUS_CLEAN.txt"));
  const existingDeepSeekGemini = mustRead(join(DOCS, "DEEPSEEK_GEMINI_CLEAN.txt"));
  const existingQwenOpus = mustRead(join(DOCS, "QWEN_OPUS_FRAGMENT_MINIMAL.txt"));
  const existingQwenGemini = mustRead(join(DOCS, "QWEN_GEMINI_FRAGMENT_MINIMAL.txt"));

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );

  if (CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL !== "https://api.cheaperinference.com/v1/chat/completions") {
    throw new Error(`UNEXPECTED_ENDPOINT:${CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL}`);
  }

  const greeting = String(fixtures.character.greeting ?? "").trim();
  const baseHistory: ChatMsg[] = greeting
    ? [{ role: "assistant", content: greeting }]
    : [];
  const sources = [
    { id: "opus" as const, sourceText: opusSource, label: "CALL GM1 existing Opus source → glm-5.2 + progression minimal" },
    { id: "gemini" as const, sourceText: geminiSource, label: "CALL GM2 existing Gemini source → glm-5.2 + progression minimal" },
  ];

  const cells: Record<string, { raw: string; meta: Record<string, unknown> }> = {};
  let calls = 0;

  for (const source of sources) {
    const assembled = await assembleBundle({
      assembleModelId: GLM_REQUESTED,
      requestModelId: GLM_REQUESTED,
      character: fixtures.character,
      persona: fixtures.persona!,
      history: [
        ...baseHistory,
        { role: "user", content: SOURCE_SEED_USER },
        { role: "assistant", content: source.sourceText },
      ],
      currentUserMessage: ADULT_HANDOFF_USER,
      adultHandoff: true,
    });
    const bundle = applyProgressionBlock(assembled);
    const lastUser = [...bundle.messages].reverse().find((m) => m.role === "user");
    const systemMsg = bundle.messages.find((m) => m.role === "system");
    if (!lastUser) throw new Error("GLM_NO_USER_TURN");
    if (lastUser.content.includes(QWEN_FRAGMENT_SENTENCE)) {
      throw new Error("QWEN_FRAGMENT_SENTENCE_LEAKED_INTO_GLM");
    }
    if (bundle.requestBody.model !== GLM_REQUESTED) {
      throw new Error(`GLM_MODEL_MISMATCH:${String(bundle.requestBody.model)}`);
    }
    if (bundle.requestBody.reasoning_effort !== "none") {
      throw new Error(`GLM_REASONING_EFFORT_NOT_NONE:${String(bundle.requestBody.reasoning_effort)}`);
    }
    if (Object.prototype.hasOwnProperty.call(bundle.requestBody, "thinking")) {
      throw new Error("GLM_THINKING_FIELD_PRESENT");
    }
    if (bundle.generation.temperature !== 0.7) {
      throw new Error(`GLM_TEMPERATURE_UNEXPECTED:${String(bundle.generation.temperature)}`);
    }
    if (
      bundle.promptSize.style_reminder_present ||
      bundle.promptSize.xml_persona_present ||
      bundle.promptSize.appearance_rule_present
    ) {
      throw new Error("GLM_DEEPSEEK_EXTRAS_PRESENT");
    }
    if (systemMsg?.content.includes(QWEN_FRAGMENT_SENTENCE)) {
      throw new Error("QWEN_FRAGMENT_SENTENCE_IN_SYSTEM");
    }
    if (/더 노골적으로|더 야하게|장문으로|서술 비율|문단을 n개/.test(systemMsg?.content ?? "")) {
      throw new Error("FORBIDDEN_STYLE_PROMPT_PRESENT");
    }
    if ((systemMsg?.content.split(GLM52_ADULT_PROGRESSION_MINIMAL_TITLE).length ?? 0) - 1 !== 1) {
      throw new Error("PROGRESSION_BLOCK_COUNT");
    }

    console.log(`\n=== ${source.label} ===`);
    calls += 1;
    const resp = await streamProvider(
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      buildCheaperInferenceHeaders(),
      bundle.requestBody
    );
    const stats = paragraphStats(resp.text);
    const usage = extractUsage(resp.usage);
    const chars = visibleAssistantDisplayCharCount(resp.text);
    const adult = adultFlags(resp.text);
    const agency = agencyFlags(resp.text);
    const progression = progressionFlags(resp.text);
    const meta = {
      variant: "GLM52_ADULT_PROGRESSION_MINIMAL",
      label: source.label,
      requested_model: GLM_REQUESTED,
      resolved_model: resp.resolved_model,
      HTTP: resp.http_status,
      finish_reason: resp.finish_reason,
      visible_chars: chars,
      ...stats,
      latency: resp.latency_s,
      ...usage,
      temperature: bundle.generation.temperature,
      top_p: bundle.generation.top_p,
      reasoning_effort: bundle.generation.reasoning_effort,
      reasoning_tokens: usage.reasoning_tokens,
      wire: inspectWire(bundle.requestBody),
      glmSpecificStylePrompt: "NONE",
      glmSpecificAdultPrompt: GLM52_ADULT_PROGRESSION_MINIMAL_TITLE,
      glmSpecificParagraphPrompt: "NONE",
      glmSpecificCharacterPrompt: "NONE",
      glmSpecificLengthPrompt: "NONE",
      adultProgressionBlockPresent: true,
      adultProgressionBlock: GLM52_ADULT_PROGRESSION_MINIMAL,
      ...adult,
      ...progression,
      severeAgencyViolationCount: agency.severeAgencyViolationCount,
      agency,
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      sha256: sha256(resp.text),
      error: resp.error,
    };
    const dir = join(LIVE_ROOT, source.id, "glm52-progression-minimal");
    save(dir, "provider-raw.txt", resp.text);
    save(dir, "meta.json", meta);
    save(dir, "wire.json", inspectWire(bundle.requestBody));
    save(
      DOCS,
      source.id === "opus"
        ? "GLM52_PROGRESSION_MINIMAL_OPUS.txt"
        : "GLM52_PROGRESSION_MINIMAL_GEMINI.txt",
      resp.text
    );
    cells[source.id] = { raw: resp.text, meta };
  }

  if (calls !== 2) throw new Error(`GLM_PROGRESSION_CALL_COUNT:${calls}`);

  assertUnchanged(existingGlmOpusPath, existingGlmOpusSha);
  assertUnchanged(existingGlmGeminiPath, existingGlmGeminiSha);
  assertUnchanged(existingReviewPath, existingReviewSha);

  const summary = {
    PR: 427,
    variant: "GLM52_ADULT_PROGRESSION_MINIMAL",
    GLM_PROGRESSION_API_CALLS: calls,
    OPUS_SOURCE_NEW_CALLS: 0,
    GEMINI_SOURCE_NEW_CALLS: 0,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    GLM_RAW_VS_PROGRESSION: "HUMAN_REVIEW_REQUIRED",
    GLM_VS_DEEPSEEK: "HUMAN_REVIEW_REQUIRED",
    GLM_VS_QWEN: "HUMAN_REVIEW_REQUIRED",
    FINAL_ADULT_MODEL_WINNER: "HUMAN_REVIEW_REQUIRED",
    opus: cells.opus?.meta ?? null,
    gemini: cells.gemini?.meta ?? null,
    existingFilesUnchanged: {
      GLM52_OPUS: existingGlmOpusSha,
      GLM52_GEMINI: existingGlmGeminiSha,
      GLM52_DIRECT_REVIEW: existingReviewSha,
    },
    CAPTURE_COMPLETE: calls === 2,
  };

  const review = [
    "# OPUS",
    "",
    "## Source",
    "",
    opusSource,
    "",
    "## GLM RAW",
    "",
    existingGlmOpus,
    "",
    "## GLM Adult Progression Minimal",
    "",
    cells.opus?.raw || "_NO_OUTPUT_",
    "",
    "# GEMINI",
    "",
    "## Source",
    "",
    geminiSource,
    "",
    "## GLM RAW",
    "",
    existingGlmGemini,
    "",
    "## GLM Adult Progression Minimal",
    "",
    cells.gemini?.raw || "_NO_OUTPUT_",
    "",
    "# EXISTING DEEPSEEK 0813 / QWEN 3.8 (unchanged)",
    "",
    "## OPUS DeepSeek 0813 CLEAN",
    "",
    existingDeepSeekOpus,
    "",
    "## OPUS Qwen 3.8 fragment-minimal",
    "",
    existingQwenOpus,
    "",
    "## GEMINI DeepSeek 0813 CLEAN",
    "",
    existingDeepSeekGemini,
    "",
    "## GEMINI Qwen 3.8 fragment-minimal",
    "",
    existingQwenGemini,
    "",
    "# METADATA",
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
  ].join("\n");

  save(DOCS, "GLM52_PROGRESSION_MINIMAL_REVIEW.md", review);
  save(DOCS, "GLM52_PROGRESSION_MINIMAL_SUMMARY.json", summary);
  save(OUT_ROOT, "GLM52_PROGRESSION_MINIMAL_REVIEW.md", review);
  save(OUT_ROOT, "GLM52_PROGRESSION_MINIMAL_SUMMARY.json", summary);

  console.log(JSON.stringify({
    GLM_PROGRESSION_CALLS: calls,
    OPUS_GLM_PROGRESSION_STATUS: cells.opus?.meta.HTTP ?? null,
    OPUS_GLM_PROGRESSION_CHARS: cells.opus?.meta.visible_chars ?? null,
    OPUS_GLM_PROGRESSION_LATENCY: cells.opus?.meta.latency ?? null,
    OPUS_GLM_PROGRESSION_COST: cells.opus?.meta.usage_cost ?? null,
    OPUS_ACTUAL_EXPLICIT_PROGRESS: cells.opus?.meta.actualExplicitActionProgressed ?? null,
    GEMINI_GLM_PROGRESSION_STATUS: cells.gemini?.meta.HTTP ?? null,
    GEMINI_GLM_PROGRESSION_CHARS: cells.gemini?.meta.visible_chars ?? null,
    GEMINI_GLM_PROGRESSION_LATENCY: cells.gemini?.meta.latency ?? null,
    GEMINI_GLM_PROGRESSION_COST: cells.gemini?.meta.usage_cost ?? null,
    GEMINI_ACTUAL_EXPLICIT_PROGRESS: cells.gemini?.meta.actualExplicitActionProgressed ?? null,
    OPUS_STOPPED_AT_CONSENT_CHECKPOINT: cells.opus?.meta.stoppedAtConsentCheckpoint ?? null,
    GEMINI_STOPPED_AT_CONSENT_CHECKPOINT: cells.gemini?.meta.stoppedAtConsentCheckpoint ?? null,
    CAPTURE_COMPLETE: calls === 2,
  }, null, 2));
}

void PRODUCTION_LIKE_CHARACTER_ID;
void GLM52_ADULT_PROGRESSION_MINIMAL;
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
