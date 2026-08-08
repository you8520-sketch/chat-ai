/**
 * Phase D6-B1 — Gemini opening greeting ROLE REMAP.
 *
 * PROMPT RULE CHANGE = 0
 * CANON CHANGE = 0
 * RUNTIME CHANGE = 0
 * DIALOGUE RULE CHANGE = 0
 * PRODUCTION WIRE = 0
 *
 * Sole variable: creator greeting message role / packaging
 *   A = assistant history (production)
 *   B = current-turn context prefix (minimal header + verbatim greeting)
 *
 *   node --conditions=react-server --import tsx scripts/rp-quality-d6b1-gemini-opening-role-remap.ts
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  computeRpQualityVectorV2,
  extractDialogueSpans,
  type SettingSource,
} from "../src/lib/rpQualityVector";
import type { ChatMsg } from "../src/lib/ai";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_ROOT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/rp-quality-d6b1-opening-role-remap";
const DOCS =
  process.env.DOCS_DIR ?? "docs/audits/rp-gemini-opening-role-remap-d6b1";
const RAW_DOCS = join(DOCS, "raw");
const FIXTURE_PATH =
  "docs/audits/rp-quality-v2-gemini/fixtures/c10_fixture.json";
const DRAWS = 3;
const USER_INPUT = "누구세요? …방금 그 소리는 뭐였죠?";

/** Minimal role-remap header — NOT buildDeepSeekOpeningSceneContextBlock. */
const OPENING_CONTEXT_HEADER =
  "[OPENING SCENE CONTEXT — ALREADY OCCURRED]";

function sha256(t: string) {
  return createHash("sha256").update(t).digest("hex");
}
function save(dir: string, name: string, content: string | object) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}
function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  generationId: string | null;
  provider: string | null;
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
  if (typeof ev.id === "string" && !state.generationId) state.generationId = ev.id;
  if (typeof ev.model === "string") state.resolved = ev.model;
  if (ev.provider && typeof ev.provider === "object") {
    const p = ev.provider as Record<string, unknown>;
    if (typeof p.name === "string") state.provider = p.name;
  }
  if (typeof ev.provider === "string") state.provider = ev.provider;
  if (ev.usage && typeof ev.usage === "object") {
    state.usage = ev.usage as Record<string, unknown>;
  }
  const choices = ev.choices as Array<Record<string, unknown>> | undefined;
  const choice0 = choices?.[0];
  if (choice0 && typeof choice0.finish_reason === "string") {
    state.finish = choice0.finish_reason;
  }
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  if (typeof delta?.content === "string") state.text += delta.content;
  if (typeof choice0?.text === "string") state.text += choice0.text;
}

function isTransportAbort(error: string | null, httpStatus: number) {
  if (httpStatus === 0 || httpStatus >= 500) return true;
  if (!error) return false;
  return /abort|ECONNRESET|socket|fetch failed|network/i.test(error);
}

async function streamOpenRouter(body: Record<string, unknown>) {
  const { OPENROUTER_CHAT_COMPLETIONS_URL, buildOpenRouterHeaders } =
    await import("../src/lib/openRouterConfig");
  const t0 = Date.now();
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    generationId: null,
    provider: null,
    sawDone: false,
  };
  const responseHeaders: Record<string, string> = {};
  try {
    const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(body),
    });
    for (const [k, v] of res.headers.entries()) {
      if (
        /provider|generation|request|ratelimit|model|openrouter/i.test(k) ||
        k.startsWith("x-")
      ) {
        responseHeaders[k] = v;
      }
    }
    if (!res.ok) {
      const errText = await res.text();
      return {
        http_status: res.status,
        error: errText.slice(0, 800),
        text: "",
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        generation_id: null as string | null,
        provider: null as string | null,
        response_headers: responseHeaders,
        saw_done: false,
        latency_s: (Date.now() - t0) / 1000,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const combined = buf + decoder.decode(value, { stream: true });
      const lines = combined.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) processSseLine(line, state);
    }
    if (buf.trim()) processSseLine(buf, state);
    return {
      http_status: res.status,
      error: null as string | null,
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      generation_id: state.generationId,
      provider: state.provider,
      response_headers: responseHeaders,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  } catch (e) {
    return {
      http_status: 0,
      error: e instanceof Error ? e.message : String(e),
      text: state.text,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      generation_id: state.generationId,
      provider: state.provider,
      response_headers: responseHeaders,
      saw_done: state.sawDone,
      latency_s: (Date.now() - t0) / 1000,
    };
  }
}

function usageTokens(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      input_tokens: null as number | null,
      output_tokens: null as number | null,
      reasoning_tokens: null as number | null,
    };
  }
  const details =
    (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
    {};
  return {
    input_tokens:
      typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    output_tokens:
      typeof usage.completion_tokens === "number"
        ? usage.completion_tokens
        : null,
    reasoning_tokens:
      typeof details.reasoning_tokens === "number"
        ? details.reasoning_tokens
        : typeof usage.reasoning_tokens === "number"
          ? usage.reasoning_tokens
          : null,
  };
}

function scoreResponseAnchorCount(text: string) {
  const dialogue = extractDialogueSpans(text)
    .map((s) => s.content.trim())
    .filter(Boolean);
  let count = 0;
  for (const d of dialogue) {
    if (/[?？]|까요|래요|세요|어때|어떡|가자|가요|해줘|같이|멈춰|말해/.test(d)) {
      count += 1;
    }
  }
  return {
    response_anchor_count: count,
    band:
      count <= 1 ? "IDEAL" : count === 2 ? "ACCEPTABLE" : "RESPONSE_OVERLOAD",
  };
}

function scoreDialogueFunctionLoad(text: string) {
  const joined = extractDialogueSpans(text)
    .map((s) => s.content)
    .join("\n");
  const checks: Array<[string, RegExp]> = [
    ["question", /[?？]|까요|래요|세요|어때|어떡/],
    ["explanation", /왜냐하면|이유는|뜻은|의미|설명|이니까|거든/],
    ["warning", /위험|죽어|죽|경고|안 돼|안돼|하지 마|하지마|총성|죽음/],
    ["proposal", /하자|할까요|같이|가자|가요|제안|차라리/],
    ["directive", /해|가|와|들어|멈춰|치워|버려|따라|숨/],
  ];
  const functions: string[] = [];
  for (const [name, re] of checks) {
    if (re.test(joined)) functions.push(name);
  }
  return { dialogue_function_load: functions.length, functions };
}

/**
 * Build minimal B prefix — header + verbatim greeting only.
 * Explicitly excludes DeepSeek length-exemplar / anti-imitate sentences.
 */
function buildMinimalOpeningContextPrefix(greeting: string): string {
  return `${OPENING_CONTEXT_HEADER}\n${greeting.trim()}`;
}

async function assembleProductionBase() {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    character: Record<string, unknown>;
    persona: Record<string, unknown>;
    user: Record<string, unknown>;
  };
  const { loadCharacterChunksForPromptReadOnly } = await import(
    "../src/lib/characterChunks"
  );
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { OPENROUTER_GEMINI_31_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const { resolveCanonInjectionPolicy } = await import(
    "../src/lib/canonInjectionPolicy"
  );

  const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
  const ch = fixture.character;
  const persona = fixture.persona;
  const personaName = String(persona.name ?? "렌");
  const greeting = String(ch.greeting ?? "");

  const { chunks } = loadCharacterChunksForPromptReadOnly(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaName,
    String(fixture.user.nickname ?? personaName)
  );

  const userPersona = formatSelectedPersonaForPrompt(
    personaName,
    (persona.gender as "male" | "female" | "other") ?? "other",
    String(persona.description ?? "")
  );
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: String(ch.name),
  });

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(fixture.user.nickname ?? personaName),
    userPersona,
    userNote: "",
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: OPENING_TURN_USER },
      { role: "assistant", content: greeting },
    ],
    currentUserMessage: USER_INPUT,
    nsfw: !!ch.nsfw,
    gender: (ch.gender as "male" | "female" | "other") ?? "other",
    memoryMeta: "",
    modelId,
    userImpersonation: false,
    novelModeEnabled: false,
    isContinue: false,
    personaDisplayName: personaName,
    targetResponseChars: 3200,
    completedTurns: 0,
    provider: "openrouter",
    contentKind: "character",
    exampleDialog: String(ch.example_dialog ?? ""),
    userId: Number(fixture.user.id ?? 4),
    narrativePov,
    // Explicit production Gemini canon policy (FULL_LEGACY)
    canonInjectionPolicy: resolveCanonInjectionPolicy(modelId),
    canonPlan: null,
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "openrouter",
      charName: String(ch.name),
      personaName,
    },
  });

  const baseBody = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const messages =
    (baseBody.messages as Array<{ role: string; content: string }>) ?? [];
  const systemMsg = messages.find((m) => m.role === "system");
  const systemText = String(systemMsg?.content ?? built.systemPrompt);

  const settingSources: SettingSource[] = [
    {
      bucket: "CHARACTER_CANON",
      text: [
        String(ch.system_prompt ?? ""),
        String(ch.speech_profile ?? ""),
        String(ch.example_dialog ?? ""),
      ].join("\n"),
    },
    {
      bucket: "WORLD_CANON",
      text: [String(ch.world ?? ""), String(ch.setting_chunks ?? "")].join("\n"),
    },
    {
      bucket: "USER_PERSONA",
      text: String(persona.description ?? ""),
    },
    { bucket: "CURRENT_USER_INPUT", text: USER_INPUT },
    { bucket: "MEMORY", text: "" },
  ];

  return {
    modelId,
    greeting,
    greetingSha: sha256(greeting.trim()),
    systemSha: sha256(systemText),
    systemText,
    baseBody,
    messagesA: messages,
    settingSources,
    generationConfig: {
      model: baseBody.model ?? modelId,
      temperature: baseBody.temperature ?? null,
      max_tokens: baseBody.max_tokens ?? null,
      reasoning: baseBody.reasoning ?? null,
      include_reasoning: baseBody.include_reasoning ?? null,
      provider: baseBody.provider ?? null,
    },
  };
}

function extractCurrentUserBody(userContent: string): string {
  const idx = userContent.indexOf("[CURRENT USER INPUT]");
  if (idx < 0) return userContent;
  return userContent.slice(idx);
}

async function main() {
  mkdirSync(OUT_ROOT, { recursive: true });
  mkdirSync(RAW_DOCS, { recursive: true });
  mkdirSync(join(DOCS, "g5"), { recursive: true });

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    throw new Error("OPENROUTER_API_KEY required for D6-B1");
  }

  const { peelCreatorOpeningGreetingFromHistory } = await import(
    "../src/lib/deepseekOpeningSceneContext"
  );
  const { OPENING_TURN_USER } = await import("../src/lib/chatGreetingContext");

  const base = await assembleProductionBase();

  // Reuse peel detection on RAW shortTermHistory (pre-formatUserMessageForPrompt).
  // Assembled OpenRouter messages rewrite "[채팅 시작]" into action-label form, so
  // peel cannot run on wire messages — greeting body match removes the pair instead.
  const rawPeel = peelCreatorOpeningGreetingFromHistory([
    { role: "user", content: OPENING_TURN_USER },
    { role: "assistant", content: base.greeting },
  ] as ChatMsg[]);
  if (!rawPeel.peeledSyntheticOpeningTurn || !rawPeel.openingGreeting) {
    throw new Error("Arm B raw peel failed — synthetic opening pair not detected");
  }
  if (rawPeel.openingGreeting.trim() !== base.greeting.trim()) {
    throw new Error("Greeting content not preserved under peel");
  }

  // Build Arm B messages from production wire: drop greeting assistant + its
  // preceding user turn (identified by greeting body), prefix last user turn.
  const { messages: messagesB, header_chars } = (() => {
    const msgs = base.messagesA.map((m) => ({ ...m }));
    let removed = false;
    for (let i = 0; i < msgs.length - 1; i++) {
      const a = msgs[i]!;
      const b = msgs[i + 1]!;
      if (
        a.role === "user" &&
        b.role === "assistant" &&
        b.content.trim() === base.greeting.trim()
      ) {
        msgs.splice(i, 2);
        removed = true;
        break;
      }
    }
    if (!removed) {
      throw new Error(
        "Arm B wire remap failed — could not locate assistant greeting message"
      );
    }
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i]!.role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) throw new Error("No user turn after wire peel");
    const prefix = buildMinimalOpeningContextPrefix(base.greeting);
    msgs[lastUserIdx] = {
      ...msgs[lastUserIdx]!,
      content: `${prefix}\n\n${msgs[lastUserIdx]!.content}`,
    };
    return {
      messages: msgs,
      header_chars: OPENING_CONTEXT_HEADER.length,
    };
  })();

  // Invariants
  const systemA = base.messagesA.find((m) => m.role === "system")!.content;
  const systemB = messagesB.find((m) => m.role === "system")!.content;
  if (sha256(systemA) !== sha256(systemB)) {
    throw new Error("SYSTEM SHA A != B — abort");
  }
  const lastUserA = [...base.messagesA].reverse().find((m) => m.role === "user")!;
  const lastUserB = [...messagesB].reverse().find((m) => m.role === "user")!;
  const bodyA = extractCurrentUserBody(lastUserA.content);
  const bodyB = extractCurrentUserBody(lastUserB.content);
  if (sha256(bodyA) !== sha256(bodyB)) {
    throw new Error("CURRENT USER INPUT body A != B — abort");
  }
  // B must not contain DeepSeek anti-length exemplar sentence
  if (
    lastUserB.content.includes("길이나 문장 수를") ||
    lastUserB.content.includes("다음 답변 길이의 예시")
  ) {
    throw new Error("DeepSeek opening block wording leaked into Arm B");
  }
  if (!lastUserB.content.startsWith(OPENING_CONTEXT_HEADER)) {
    throw new Error("Arm B last user turn missing opening context header");
  }

  const assistantCountA = base.messagesA.filter((m) => m.role === "assistant").length;
  const assistantCountB = messagesB.filter((m) => m.role === "assistant").length;

  const preaudit = {
    phase: "D6-B1-PREAUDIT",
    system_sha_equal: true,
    system_sha256: base.systemSha,
    greeting_sha256: base.greetingSha,
    greeting_chars: base.greeting.length,
    current_user_body_sha_equal: true,
    current_user_body_sha256: sha256(bodyA),
    arm_A: {
      greeting_role: "assistant_history",
      message_count: base.messagesA.length,
      assistant_messages: assistantCountA,
      total_message_chars: base.messagesA.reduce((a, m) => a + m.content.length, 0),
    },
    arm_B: {
      greeting_role: "current_turn_context_prefix",
      message_count: messagesB.length,
      assistant_messages: assistantCountB,
      header_chars,
      header_only_extra: true,
      deepseek_length_exemplar_sentence: false,
      total_message_chars: messagesB.reduce((a, m) => a + m.content.length, 0),
    },
    message_char_delta:
      messagesB.reduce((a, m) => a + m.content.length, 0) -
      base.messagesA.reduce((a, m) => a + m.content.length, 0),
    generation_config: base.generationConfig,
  };
  save(join(DOCS), "00_PREAUDIT.json", preaudit);

  const { sanitizeStreamArtifacts } = await import("../src/lib/responseLength");
  const {
    normalizeAiNovelProsePreDisplay,
    applyDisplayParagraphGrouping,
  } = await import("../src/lib/novelParagraphs");
  const { visibleAssistantDisplayText } = await import(
    "../src/lib/chatDisplayLength"
  );

  let apiCalls = 0;
  const rows: Array<Record<string, unknown>> = [];

  for (const arm of ["A", "B"] as const) {
    const messages = arm === "A" ? base.messagesA : messagesB;
    const body = { ...base.baseBody, messages };
    const messagesSha = sha256(JSON.stringify(messages));
    const lastUser = [...messages].reverse().find((m) => m.role === "user")!;

    for (let draw = 1; draw <= DRAWS; draw++) {
      const cellId = `Gemini_G5_${arm}_D${draw}`;
      const dir = join(OUT_ROOT, "live", cellId);
      let providerRaw: string;
      let meta: Record<string, unknown>;

      if (
        existsSync(join(dir, "meta.json")) &&
        existsSync(join(dir, "provider_raw.txt"))
      ) {
        console.log(`skip existing ${cellId}`);
        providerRaw = readFileSync(join(dir, "provider_raw.txt"), "utf8");
        meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
      } else {
        console.log(
          `\n=== ${cellId} role=${arm === "A" ? "assistant" : "context-prefix"} messagesSha=${messagesSha.slice(0, 12)} ===`
        );
        let resp = await streamOpenRouter(body);
        let reissued = 0;
        if (
          (resp.http_status !== 200 || resp.error || !resp.text.trim()) &&
          isTransportAbort(resp.error, resp.http_status)
        ) {
          reissued = 1;
          resp = await streamOpenRouter(body);
        }
        if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
          save(dir, "FAIL.json", resp);
          throw new Error(`OR fail ${cellId}: ${resp.error ?? resp.http_status}`);
        }
        apiCalls += 1;
        providerRaw = resp.text;
        const finalDisplay = visibleAssistantDisplayText(
          applyDisplayParagraphGrouping(
            normalizeAiNovelProsePreDisplay(
              sanitizeStreamArtifacts(providerRaw)
            )
          )
        );
        meta = {
          cell_id: cellId,
          phase: "D6-B1",
          fixture: "G5",
          arm,
          draw,
          sole_variable: "OPENING_GREETING_ROLE",
          greeting_role:
            arm === "A" ? "assistant_history" : "current_turn_context_prefix",
          prompt_rule_change: 0,
          new_instruction: 0,
          runtime_change: 0,
          system_sha256: base.systemSha,
          messages_sha256: messagesSha,
          user_tail_sha256: sha256(lastUser.content),
          greeting_sha256: base.greetingSha,
          current_user_body_sha256: sha256(extractCurrentUserBody(lastUser.content)),
          model_identifier: base.modelId,
          resolved_model: resp.resolved_model,
          provider: resp.provider,
          provider_generation_id: resp.generation_id,
          finish_reason: resp.finish_reason,
          saw_done: resp.saw_done,
          latency_s: resp.latency_s,
          transport_reissue: reissued,
          generation_config: base.generationConfig,
          usage_raw: resp.usage,
          ...usageTokens(resp.usage),
          incomplete:
            !!resp.finish_reason &&
            resp.finish_reason !== "stop" &&
            resp.finish_reason !== "end_turn",
          visible_chars_no_ws: providerRaw.replace(/\s+/g, "").length,
        };
        save(dir, "provider_raw.txt", providerRaw);
        save(dir, "final_display.txt", finalDisplay);
        save(dir, "meta.json", meta);
        save(dir, "last_user_turn.txt", lastUser.content);
        save(dir, "request_fingerprint.json", {
          system_sha256: base.systemSha,
          messages_sha256: messagesSha,
          greeting_sha256: base.greetingSha,
          greeting_role: meta.greeting_role,
          generation_config: base.generationConfig,
        });
      }

      const vector = computeRpQualityVectorV2({
        text: providerRaw,
        providerRaw,
        finishReason: (meta.finish_reason as string) ?? null,
        sawDone: (meta.saw_done as boolean) ?? null,
        incomplete: (meta.incomplete as boolean) ?? null,
        currentUserInput: USER_INPUT,
        priorAssistantText: base.greeting,
        greetingOrIntroText: base.greeting,
        settingSources: base.settingSources,
      });

      save(
        RAW_DOCS,
        `${cellId}.md`,
        [
          `# ${cellId}`,
          "",
          `- greeting_role: ${meta.greeting_role}`,
          `- visible_chars: ${meta.visible_chars_no_ws}`,
          `- finish: ${meta.finish_reason}`,
          `- system_sha: ${base.systemSha.slice(0, 16)}`,
          "",
          "## output",
          "",
          "```text",
          providerRaw,
          "```",
          "",
        ].join("\n")
      );

      rows.push({
        cell_id: cellId,
        arm,
        draw,
        visible_chars: vector.length.visible_chars_no_whitespace,
        finish_reason: meta.finish_reason,
        provider: meta.provider,
        reasoning_tokens: meta.reasoning_tokens,
        input_tokens: meta.input_tokens,
        latency_s: meta.latency_s,
        dialogue_char_share: vector.composition.dialogue_char_share,
        response_anchor: scoreResponseAnchorCount(providerRaw),
        dialogue_function_load: scoreDialogueFunctionLoad(providerRaw),
        continuity: vector.continuity,
        setting_exact_overlap: vector.setting_exact_overlap,
        hard_alarms: vector.hard_alarms,
        intro_overlap_alarm: vector.continuity.intro_overlap_alarm,
        intro_lcs_chars: vector.continuity.intro_lcs_chars,
        recent_assistant_lcs_chars: vector.continuity.recent_assistant_lcs_chars,
        system_sha256: meta.system_sha256,
        messages_sha256: meta.messages_sha256,
        greeting_sha256: meta.greeting_sha256,
        human_pending: {
          OPENING_REPLAY_SCORE: "PENDING_AGENT_REVIEW",
          SCENE_ADVANCEMENT: "PENDING_AGENT_REVIEW",
          NEW_SCENE_VALUE: "PENDING_AGENT_REVIEW",
          CHARACTER_FIDELITY: "PENDING_AGENT_REVIEW",
          ACTIVE_CANON_USE: "PENDING_AGENT_REVIEW",
          SETTING_RECITAL: "PENDING_AGENT_REVIEW",
          CURRENT_INPUT_REPLAY: "PENDING_AGENT_REVIEW",
          REPLACEMENT_CONTENT: "PENDING_AGENT_REVIEW",
        },
      });
    }
  }

  const byArm = (arm: "A" | "B") => {
    const rs = rows.filter((r) => r.arm === arm);
    const chars = rs.map((r) => Number(r.visible_chars));
    return {
      chars,
      chars_median: median(chars),
      chars_mean: mean(chars),
      collapse_lt_1800: chars.filter((c) => c < 1800).length,
      input_tokens: rs.map((r) => r.input_tokens),
      intro_lcs: rs.map((r) => r.intro_lcs_chars),
      rows: rs,
    };
  };

  const summary = {
    phase: "D6-B1-G5",
    sole_variable: "OPENING_GREETING_ROLE",
    production_diff: 0,
    system_prompt_diff: 0,
    runtime_diff: 0,
    system_sha_equal: true,
    greeting_content_sha_equal: true,
    greeting_sha256: base.greetingSha,
    system_sha256: base.systemSha,
    preaudit,
    api_calls_this_run: apiCalls,
    arm_A: byArm("A"),
    arm_B: byArm("B"),
    input_token_delta_median: (() => {
      const a = byArm("A").input_tokens.filter(
        (x): x is number => typeof x === "number"
      );
      const b = byArm("B").input_tokens.filter(
        (x): x is number => typeof x === "number"
      );
      if (!a.length || !b.length) return null;
      return median(b) - median(a);
    })(),
    human_review: "PENDING",
    g3: "NOT_IN_SCOPE",
    production_wire: "NOT_RUN",
    merge: "NOT_RUN",
  };

  save(join(DOCS, "g5"), "01_G5_LIVE.json", summary);
  save(
    join(DOCS, "g5"),
    "01_G5_LIVE.md",
    [
      "# D6-B1 G5 Live — Opening Greeting Role Remap",
      "",
      "```json",
      JSON.stringify(
        {
          system_sha_equal: true,
          greeting_content_sha_equal: true,
          input_token_delta_median: summary.input_token_delta_median,
          A_chars: summary.arm_A.chars,
          B_chars: summary.arm_B.chars,
          A_collapse: summary.arm_A.collapse_lt_1800,
          B_collapse: summary.arm_B.collapse_lt_1800,
          A_intro_lcs: summary.arm_A.intro_lcs,
          B_intro_lcs: summary.arm_B.intro_lcs,
          api_calls: apiCalls,
        },
        null,
        2
      ),
      "```",
      "",
      "Human opening-replay scores: see `02_G5_HUMAN_OPENING_REPLAY.md` after review.",
      "",
    ].join("\n")
  );

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
