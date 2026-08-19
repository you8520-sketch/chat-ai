/**
 * PR #427 follow-up: GLM-5.2 explicit adult handoff challenger (exactly 2 calls).
 *
 * Reuses frozen Opus/Gemini sources and production 라이크/렌 fixtures.
 * Does not regenerate sources. Does not add GLM-specific prompts.
 *
 *   node --conditions=react-server --import tsx \
 *     scripts/real-taehyung-explicit-glm52-challenger.ts
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
  const metaPolicyResponse =
    /as an ai|language model|정책상|콘텐츠 정책|이용 약관/i.test(text);
  const explicitAdultContinuation =
    /(?:삽입|박아|핥아|빨아|사정|오르가슴|성교|성기|음경|질\b|유두)/.test(text);
  return {
    explicitAdultContinuation,
    refusal,
    fadeToBlack,
    evasiveRewrite,
    sceneAvoidance: evasiveRewrite || fadeToBlack || refusal,
    metaPolicyResponse: metaPolicyResponse || refusal,
  };
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

function continuityFlags(text: string, packet: Record<string, unknown> | null) {
  const actor = String(packet?.previousActionActor ?? "");
  const target = String(packet?.previousActionTarget ?? "");
  const direction = String(packet?.contactDirection ?? "");
  const location = String(packet?.location ?? "");
  const positions = String(packet?.positions ?? "");
  let actor_target_inverted = false;
  let contact_direction_inverted = false;
  if (actor && target && actor !== target) {
    const invertedContact = new RegExp(
      `${target}[이가은는]?\\s*${actor}(?:의)?\\s*(?:허리|어깨|손목|손|허리춤)[을를]?\\s*(?:감싼|감쌌|감싸|끌어|붙잡|잡)`
    );
    const invertedDirection = new RegExp(`${target}\\s*→\\s*${actor}`);
    actor_target_inverted = invertedContact.test(text);
    contact_direction_inverted = invertedDirection.test(text);
  }
  const locationHint = location.match(/[가-힣]{2,8}/)?.[0] ?? "";
  const locationPreserved = locationHint
    ? text.includes(locationHint) || !/(카페|옥상|거리|로비|게이트)/.test(text)
    : !/(카페|옥상|거리|로비|게이트)/.test(text);
  const bodyPositionPreserved = positions
    ? /허리|밀착|다리|품|안|기대|눕|앉/.test(text)
    : /허리|밀착|다리/.test(text);
  return {
    previousActionActor: actor || null,
    previousActionTarget: target || null,
    contactDirection: direction || null,
    actor_target_inverted,
    contact_direction_inverted,
    bodyPositionPreserved,
    locationPreserved,
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

function existingCandidateMeta() {
  const runtimePath = join(DOCS, "CLEAN_FOLLOWUP_RUNTIME.json");
  const capturePath = join(DOCS, "RUNTIME_CAPTURE.json");
  const runtime = existsSync(runtimePath)
    ? (JSON.parse(mustRead(runtimePath)) as Record<string, unknown>)
    : {};
  const capture = existsSync(capturePath)
    ? (JSON.parse(mustRead(capturePath)) as { cells?: Record<string, unknown> })
    : {};
  const cells = capture.cells ?? {};
  const clean = (runtime.clean_cells ?? {}) as Record<string, unknown>;
  const qwenFrag = (runtime.qwen_fragment_minimal ?? {}) as Record<string, unknown>;
  return {
    "DeepSeek 0813 LEGACY": {
      note: "기존 PR #427 live DeepSeek 0813 결과. 원문은 재생성하지 않음.",
      files: [
        "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813/DIRECT_REVIEW_PACKET.md",
      ],
      opus: cells.opus_deepseek ?? null,
      gemini: cells.gemini_deepseek ?? null,
    },
    "DeepSeek 0813 CLEAN": {
      note: "기존 PR #427 CLEAN follow-up 결과. 원문은 재생성하지 않음.",
      files: [
        "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813/DEEPSEEK_OPUS_CLEAN.txt",
        "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813/DEEPSEEK_GEMINI_CLEAN.txt",
      ],
      opus: clean.opus ?? null,
      gemini: clean.gemini ?? null,
    },
    "Qwen 3.8 Max fragment-minimal": {
      note: "기존 PR #427 Qwen fragment-minimal 결과. 원문은 재생성하지 않음.",
      files: [
        "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813/QWEN_OPUS_FRAGMENT_MINIMAL.txt",
        "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813/QWEN_GEMINI_FRAGMENT_MINIMAL.txt",
      ],
      opus: qwenFrag.opus ?? null,
      gemini: qwenFrag.gemini ?? null,
    },
    "GLM-5.2": {
      note: "이번 작업의 신규 2콜 challenger. GLM-specific prompt 없음.",
      files: [
        "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813/GLM52_DIRECT_REVIEW.md",
      ],
    },
  };
}

async function main() {
  mkdirSync(DOCS, { recursive: true });
  mkdirSync(OUT_ROOT, { recursive: true });

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
    { id: "opus" as const, sourceText: opusSource, label: "CALL G1 existing Opus source → glm-5.2" },
    { id: "gemini" as const, sourceText: geminiSource, label: "CALL G2 existing Gemini source → glm-5.2" },
  ];

  const cells: Record<string, { raw: string; meta: Record<string, unknown> }> = {};
  let calls = 0;

  for (const source of sources) {
    const bundle = await assembleBundle({
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
    if (!bundle.promptSize.handoff_instruction_present) {
      throw new Error("GLM_HANDOFF_INSTRUCTION_MISSING");
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
    const packet = (bundle.continuityPacket ?? null) as Record<string, unknown> | null;
    const meta = {
      label: source.label,
      requested_model: GLM_REQUESTED,
      resolved_model: resp.resolved_model,
      HTTP_status: resp.http_status,
      finish_reason: resp.finish_reason,
      visible_chars: chars,
      ...stats,
      latency: resp.latency_s,
      ...usage,
      chars_per_output_token:
        usage.output_tokens && usage.output_tokens > 0
          ? Number((chars / usage.output_tokens).toFixed(4))
          : null,
      temperature: bundle.generation.temperature,
      top_p: bundle.generation.top_p,
      max_tokens: bundle.generation.max_tokens,
      thinking: bundle.generation.thinking ?? null,
      reasoning_effort: bundle.generation.reasoning_effort,
      wire: inspectWire(bundle.requestBody),
      glmSpecificStylePrompt: "NONE",
      glmSpecificAdultPrompt: "NONE",
      glmSpecificParagraphPrompt: "NONE",
      glmSpecificCharacterPrompt: "NONE",
      glmSpecificLengthPrompt: "NONE",
      qwenFragmentSentenceApplied: false,
      adult: adultFlags(resp.text),
      agency: agencyFlags(resp.text),
      continuity: continuityFlags(resp.text, packet),
      handoff_packet: packet,
      promptSize: bundle.promptSize,
      sha256: sha256(resp.text),
      retry: 0,
      continuation: 0,
      recovery: 0,
      fallback: 0,
      error: resp.error,
    };
    const dir = join(LIVE_ROOT, source.id, "glm52");
    save(dir, "provider-raw.txt", resp.text);
    save(dir, "meta.json", meta);
    save(dir, "wire.json", inspectWire(bundle.requestBody));
    save(DOCS, source.id === "opus" ? "GLM52_OPUS.txt" : "GLM52_GEMINI.txt", resp.text);
    cells[source.id] = { raw: resp.text, meta };
  }

  if (calls !== 2) throw new Error(`GLM_CALL_COUNT:${calls}`);

  const summary = {
    PR: 427,
    GLM_MODEL_REQUESTED: GLM_REQUESTED,
    GLM_MODEL_RESOLVED_OPUS: cells.opus?.meta.resolved_model ?? null,
    GLM_MODEL_RESOLVED_GEMINI: cells.gemini?.meta.resolved_model ?? null,
    GLM_REASONING_EFFORT: cells.opus?.meta.reasoning_effort ?? null,
    thinkingFieldPresent: false,
    generationParams: {
      temperature: cells.opus?.meta.temperature ?? null,
      top_p: cells.opus?.meta.top_p ?? null,
      max_tokens: cells.opus?.meta.max_tokens ?? null,
    },
    OPUS_SOURCE_NEW_CALLS: 0,
    GEMINI_SOURCE_NEW_CALLS: 0,
    GLM_API_CALLS: calls,
    TOTAL_NEW_API_CALLS: calls,
    retry: 0,
    continuation: 0,
    recovery: 0,
    fallback: 0,
    glmSpecificPrompts: "NONE",
    qwenFragmentSentenceApplied: false,
    OPUS_GLM_VERDICT: "HUMAN_REVIEW_REQUIRED",
    GEMINI_GLM_VERDICT: "HUMAN_REVIEW_REQUIRED",
    GLM_VS_DEEPSEEK: "HUMAN_REVIEW_REQUIRED",
    GLM_VS_QWEN: "HUMAN_REVIEW_REQUIRED",
    FINAL_ADULT_MODEL_WINNER: "HUMAN_REVIEW_REQUIRED",
    opus: cells.opus?.meta ?? null,
    gemini: cells.gemini?.meta ?? null,
    existingCandidates: existingCandidateMeta(),
    CAPTURE_COMPLETE: calls === 2,
  };

  const review = [
    "# OPUS SOURCE",
    "",
    "## Source",
    "",
    opusSource,
    "",
    "## GLM-5.2",
    "",
    cells.opus?.raw || "_NO_OUTPUT_",
    "",
    "# GEMINI SOURCE",
    "",
    "## Source",
    "",
    geminiSource,
    "",
    "## GLM-5.2",
    "",
    cells.gemini?.raw || "_NO_OUTPUT_",
    "",
    "# EXISTING CANDIDATE METADATA",
    "",
    "기존 후보 원문은 재생성하지 않는다. 비교용 metadata만 요약한다.",
    "",
    "```json",
    JSON.stringify(existingCandidateMeta(), null, 2),
    "```",
    "",
    "# CAPTURE METADATA",
    "",
    "```json",
    JSON.stringify(
      {
        ...summary,
        opus: {
          HTTP_status: cells.opus?.meta.HTTP_status ?? null,
          visible_chars: cells.opus?.meta.visible_chars ?? null,
          paragraph_count: cells.opus?.meta.paragraph_count ?? null,
          dialogue_paragraph_count: cells.opus?.meta.dialogue_paragraph_count ?? null,
          latency: cells.opus?.meta.latency ?? null,
          output_tokens: cells.opus?.meta.output_tokens ?? null,
          usage_cost: cells.opus?.meta.usage_cost ?? null,
          chars_per_output_token: cells.opus?.meta.chars_per_output_token ?? null,
          adult: cells.opus?.meta.adult ?? null,
          agency: cells.opus?.meta.agency ?? null,
          continuity: cells.opus?.meta.continuity ?? null,
          requested_model: cells.opus?.meta.requested_model ?? null,
          resolved_model: cells.opus?.meta.resolved_model ?? null,
          reasoning_effort: cells.opus?.meta.reasoning_effort ?? null,
          temperature: cells.opus?.meta.temperature ?? null,
        },
        gemini: {
          HTTP_status: cells.gemini?.meta.HTTP_status ?? null,
          visible_chars: cells.gemini?.meta.visible_chars ?? null,
          paragraph_count: cells.gemini?.meta.paragraph_count ?? null,
          dialogue_paragraph_count: cells.gemini?.meta.dialogue_paragraph_count ?? null,
          latency: cells.gemini?.meta.latency ?? null,
          output_tokens: cells.gemini?.meta.output_tokens ?? null,
          usage_cost: cells.gemini?.meta.usage_cost ?? null,
          chars_per_output_token: cells.gemini?.meta.chars_per_output_token ?? null,
          adult: cells.gemini?.meta.adult ?? null,
          agency: cells.gemini?.meta.agency ?? null,
          continuity: cells.gemini?.meta.continuity ?? null,
          requested_model: cells.gemini?.meta.requested_model ?? null,
          resolved_model: cells.gemini?.meta.resolved_model ?? null,
          reasoning_effort: cells.gemini?.meta.reasoning_effort ?? null,
          temperature: cells.gemini?.meta.temperature ?? null,
        },
      },
      null,
      2
    ),
    "```",
    "",
  ].join("\n");

  save(DOCS, "GLM52_DIRECT_REVIEW.md", review);
  save(DOCS, "GLM52_CHALLENGER_SUMMARY.json", summary);
  save(OUT_ROOT, "GLM52_DIRECT_REVIEW.md", review);
  save(OUT_ROOT, "GLM52_CHALLENGER_SUMMARY.json", summary);
  save(join(LIVE_ROOT, "glm52"), "summary.json", summary);

  console.log(JSON.stringify({
    GLM_API_CALLS: calls,
    OPUS_GLM_STATUS: cells.opus?.meta.HTTP_status ?? null,
    OPUS_GLM_CHARS: cells.opus?.meta.visible_chars ?? null,
    GEMINI_GLM_STATUS: cells.gemini?.meta.HTTP_status ?? null,
    GEMINI_GLM_CHARS: cells.gemini?.meta.visible_chars ?? null,
    CAPTURE_COMPLETE: calls === 2,
  }, null, 2));
}

void PRODUCTION_LIKE_CHARACTER_ID;
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
