/**
 * BUGFIX investigation — Gemini 3.1 Pro serving-path parity (Phase 1).
 *
 * Same frozen production-equivalent quiet_intimacy prompt across:
 *   A — CheaperInference gemini-3.1-pro-preview
 *   B — OpenRouter google/gemini-3.1-pro-preview  (pin google-ai-studio, no fallback)
 *   C — OpenRouter google/gemini-3.1-pro-preview-20260219 (pin google-ai-studio, no fallback)
 *
 * Invariants: exactly ONE provider call per sample; no continuation/retry/fallback;
 * temperature=0.95; reasoning effort semantic=low; max_tokens omitted.
 * Production code unchanged.
 *
 *   PHASE1_RUNS=3 node --conditions=react-server --import tsx \
 *     scripts/gemini31-serving-path-parity.ts
 *
 *   PHASE1_DRY_RUN=1 …  # freeze prompt hash only
 */
import "./lib/server-only-mock";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  exitIfBenchmarkCheaperInferenceApiKeyMissing,
  sanitizeBenchmarkCredentialText,
} from "./lib/benchmarkCheaperInferenceCredential";
import {
  PROSE_DIET_CHAR_NAME,
  PROSE_DIET_CHARACTER_SYSTEM_PROMPT,
  PROSE_DIET_EXAMPLE_DIALOG,
  PROSE_DIET_FIXTURES,
  PROSE_DIET_PERSONA_NAME,
  PROSE_DIET_WORLD,
} from "./lib/proseDietFixtures";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type ArmId = "A" | "B" | "C";

const OUT_ROOT =
  process.env.PHASE1_OUT_DIR?.trim() ||
  "/opt/cursor/artifacts/gemini31-serving-path-parity";
const DOCS_MIRROR = path.join(
  process.cwd(),
  "docs/audits/gemini31-serving-path-parity",
);
const RUNS = Math.max(1, Math.min(5, Number(process.env.PHASE1_RUNS ?? "3") || 3));
const DRY_RUN = process.env.PHASE1_DRY_RUN === "1";
const ARM_FILTER = (process.env.PHASE1_ARMS ?? "A,B,C")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean) as ArmId[];

const OR_AI_STUDIO_PROVIDER = {
  order: ["google-ai-studio"],
  only: ["google-ai-studio"],
  allow_fallbacks: false,
} as const;

const OR_ROLLING = "google/gemini-3.1-pro-preview";
const OR_DATED = "google/gemini-3.1-pro-preview-20260219";

function write(rel: string, content: string | object) {
  for (const root of [OUT_ROOT, DOCS_MIRROR]) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(
      p,
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
      "utf8",
    );
  }
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sanitizeSecrets(text: string): string {
  return sanitizeBenchmarkCredentialText(text)
    .replace(/OPENROUTER_API_KEY=\S+/gi, "OPENROUTER_API_KEY=[REDACTED]")
    .replace(
      /OPENROUTER_JEV_BENCHMARK_API_KEY=\S+/gi,
      "OPENROUTER_JEV_BENCHMARK_API_KEY=[REDACTED]",
    )
    .replace(
      /OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY=\S+/gi,
      "OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY=[REDACTED]",
    )
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [REDACTED]")
    .replace(/sk-or-v1-[A-Za-z0-9]+/g, "[REDACTED_OR_KEY]")
    .replace(/sk-[A-Za-z0-9]{20,}/g, "[REDACTED_KEY]");
}

function flatContent(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) =>
        p && typeof p === "object" && "text" in p
          ? String((p as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

/** Canonical prompt hash — roles + content only (no model/transport). */
function promptContentHash(
  messages: Array<{ role: string; content: unknown }>,
): string {
  const canonical = messages.map((m) => ({
    role: m.role,
    content: flatContent(m.content),
  }));
  return sha256(JSON.stringify(canonical));
}

function extractReasoningState(usage: Record<string, unknown> | null): {
  reasoning_reporting_state: "REPORTED" | "UNREPORTED";
  reasoning_tokens: number | null;
} {
  if (!usage) {
    return { reasoning_reporting_state: "UNREPORTED", reasoning_tokens: null };
  }
  const details = usage.completion_tokens_details;
  if (!details || typeof details !== "object") {
    return { reasoning_reporting_state: "UNREPORTED", reasoning_tokens: null };
  }
  const rt = (details as { reasoning_tokens?: unknown }).reasoning_tokens;
  if (typeof rt === "number" && Number.isFinite(rt)) {
    return { reasoning_reporting_state: "REPORTED", reasoning_tokens: rt };
  }
  // Field present as null/undefined → still treat as UNREPORTED (not zero)
  if ("reasoning_tokens" in (details as object)) {
    return { reasoning_reporting_state: "UNREPORTED", reasoning_tokens: null };
  }
  return { reasoning_reporting_state: "UNREPORTED", reasoning_tokens: null };
}

function scrubResponseMeta(raw: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(raw);
  // Drop any accidental credential-shaped strings
  const json = sanitizeSecrets(JSON.stringify(copy));
  return JSON.parse(json) as Record<string, unknown>;
}

function qualityOccurrences(text: string) {
  return {
    visible_under_length: text.length < 2700 ? 1 : 0,
    scene_early_closure: /편하게 계십시오|여기 있어도 됩니다|대답을 기다렸/.test(
      text.slice(-400),
    )
      ? 1
      : 0,
    repetition:
      (text.match(/(네온|사이렌|장갑|창틀|3년 전)/g) ?? []).length >= 8 ? 1 : 0,
    filler: (text.match(/미세하게|아주 조금|살짝/g) ?? []).length,
    agency_violation_heuristic: (
      text.match(/렌(?:은|이|가)\s*(?:말했|"|'|대답했|고개를 끄덕)/g) ?? []
    ).length,
    apparent_lower_capability: text.length < 900 ? 1 : 0,
    malformed_layout: !/\n\n/.test(text) ? 1 : 0,
  };
}

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<{
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  responseMeta: Record<string, unknown>;
  error: string | null;
  status: number;
  ttftMs: number | null;
  latencyMs: number;
  providerCalls: 1;
}> {
  const started = Date.now();
  let ttftMs: number | null = null;
  const out = {
    text: "",
    finish: null as string | null,
    usage: null as Record<string, unknown> | null,
    responseMeta: {} as Record<string, unknown>,
    error: null as string | null,
    status: 0,
    ttftMs: null as number | null,
    latencyMs: 0,
    providerCalls: 1 as const,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    out.status = res.status;
    const headerMeta: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (lk === "authorization" || lk.includes("key") || lk.includes("secret")) {
        return;
      }
      if (
        lk.includes("request-id") ||
        lk.includes("generation") ||
        lk.includes("provider") ||
        lk === "x-openrouter-provider" ||
        lk.startsWith("x-") ||
        lk === "server"
      ) {
        headerMeta[k] = v;
      }
    });
    out.responseMeta.headers = headerMeta;

    if (!res.ok || !res.body) {
      out.error = sanitizeSecrets((await res.text()).slice(0, 2000));
      out.latencyMs = Date.now() - started;
      return out;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let lastEvt: Record<string, unknown> | null = null;
    const handle = (line: string) => {
      const t = line.trim();
      if (!t.startsWith("data:")) return;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const ev = JSON.parse(data) as Record<string, unknown>;
        lastEvt = ev;
        const choice = (
          ev.choices as Array<Record<string, unknown>> | undefined
        )?.[0];
        const delta = (choice?.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === "string" && delta.content) {
          if (ttftMs == null) ttftMs = Date.now() - started;
          out.text += delta.content;
        }
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          out.finish = choice.finish_reason;
        }
        if (ev.usage && typeof ev.usage === "object") {
          out.usage = ev.usage as Record<string, unknown>;
        }
      } catch {
        /* partial */
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    }
    buf += dec.decode();
    if (buf.trim()) handle(buf);

    if (lastEvt) {
      const safe = scrubResponseMeta({
        id: lastEvt.id,
        model: lastEvt.model,
        provider: lastEvt.provider,
        object: lastEvt.object,
        created: lastEvt.created,
        // capture any non-secret top-level version-ish fields
        modelVersion: lastEvt.modelVersion,
        model_version: lastEvt.model_version,
        system_fingerprint: lastEvt.system_fingerprint,
        metadata: lastEvt.metadata,
      });
      out.responseMeta.final_chunk = safe;
    }
    out.ttftMs = ttftMs;
  } catch (e) {
    out.error = sanitizeSecrets(String(e)).slice(0, 2000);
  }
  out.latencyMs = Date.now() - started;
  return out;
}

async function main() {
  const { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    adaptCheaperInferenceChatBody,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const {
    OPENROUTER_CHAT_COMPLETIONS_URL,
    buildOpenRouterHeaders,
  } = await import("../src/lib/openRouterConfig");
  const {
    buildOpenRouterRequestBody,
    OPENROUTER_RP_REASONING_GEMINI_3_PRO,
    GEMINI_PRO_GENERATION_PARAMS,
  } = await import("../src/lib/openRouterClient");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } = await import(
    "../src/lib/sceneDirective"
  );
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import(
    "../src/lib/userPersonas"
  );
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import(
    "../src/lib/chatMemory"
  );
  const { visibleAssistantDisplayCharCount } = await import(
    "../src/lib/chatDisplayLength"
  );
  const { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } = await import(
    "../src/lib/currentTurnUserAuthoringDelegation"
  );
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import(
    "../src/lib/responseLength"
  );
  const { COMMON_PROSE_BLOCK } = await import(
    "../src/lib/advancedProseNsfwGuidelines"
  );
  const { NARRATIVE_DENSITY_BLOCK } = await import(
    "../src/lib/sceneExpansionPolicy"
  );

  const fx = PROSE_DIET_FIXTURES.find((f) => f.id === "quiet_intimacy");
  if (!fx) throw new Error("quiet_intimacy fixture missing");

  const longTermMemory =
    "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.";

  // Freeze production-equivalent prompt once (CI Main RP assembly path).
  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: PROSE_DIET_CHAR_NAME,
  });
  const directive = buildSceneDirective({
    mode: "interactive",
    recentMessages: fx.shortTermHistory,
    currentUserMessage: fx.currentUserMessage,
    memoryText: longTermMemory,
    relationshipMemoryText: "",
    lorebookText: "",
    triggeredEventText: "",
    chatId: 920031,
    currentTurn: 3,
    progressionHistory: [],
    contentKind: "character",
    primaryCharacterName: PROSE_DIET_CHAR_NAME,
  });
  const built = buildContext({
    charName: PROSE_DIET_CHAR_NAME,
    personaDisplayName: PROSE_DIET_PERSONA_NAME,
    userNickname: PROSE_DIET_PERSONA_NAME,
    chunks: parseCharacterSetting({
      characterId: "serving-parity-1",
      characterName: PROSE_DIET_CHAR_NAME,
      gender: "male",
      systemPrompt: PROSE_DIET_CHARACTER_SYSTEM_PROMPT,
      world: PROSE_DIET_WORLD,
      exampleDialog: PROSE_DIET_EXAMPLE_DIALOG,
      statusWindowPrompt: "",
    }),
    userPersona: formatSelectedPersonaForPrompt(
      PROSE_DIET_PERSONA_NAME,
      "other",
      "20대 대학원생. 호기심 많고 직설적이지만 상대를 존중한다.",
    ),
    userNote: formatUserNoteForPrompt(
      "렌과 오래 알고 지낸 친구. 3년 전 실종 사건 이후 더 자주 연락한다.",
    ),
    longTermMemory,
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(
        JSON.stringify({
          affection: 65,
          trust: 58,
          relationshipLabel: "오래된 지인",
        }),
      ),
    ),
    shortTermHistory: fx.shortTermHistory,
    currentUserMessage: fx.currentUserMessage,
    nsfw: false,
    gender: "male",
    userPersonaGender: "other",
    currentTurnAuthoringDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
    novelModeEnabled: false,
    targetResponseChars: 3200,
    completedTurns: 3,
    genres: ["현대/일상"],
    provider: "openrouter",
    modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    contentKind: "character",
    narrativePov,
    sceneDirectiveBlock: renderSceneDirectiveForPrompt(directive),
    scenePacingPromptOwner: "legacy_v1",
  });

  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history,
    modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: PROSE_DIET_CHAR_NAME,
      personaName: PROSE_DIET_PERSONA_NAME,
      sceneServerControls: {
        mode: "interactive",
        contentKind: "character",
        party: false,
        primaryCharacterName: PROSE_DIET_CHAR_NAME,
        currentUserMessage: fx.currentUserMessage,
        recentMessages: fx.shortTermHistory,
        memoryText: longTermMemory,
        adultModeEnabled: false,
        chatId: 920031,
        currentTurn: 3,
        progressionHistory: [],
        canonicalSceneDirective: directive,
        skipMotionCue: false,
      },
    },
  });

  const frozenMessages = structuredClone(
    (wire.requestBody as { messages: Array<{ role: string; content: unknown }> })
      .messages,
  );
  const frozenHash = promptContentHash(frozenMessages);
  const lastUser = flatContent(
    [...frozenMessages].reverse().find((m) => m.role === "user")?.content,
  );
  const systemFlat = flatContent(
    frozenMessages.find((m) => m.role === "system")?.content,
  );

  const ownerMap = {
    EXACT_MAIN_GPT_CONFIRMED: "63ffa76e21a6f8cb88e31cc43c6378e87d3e8059",
    LOCAL_HEAD: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
    main_rp_gemini_registry: {
      ci_preview: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      or_rolling: OR_ROLLING,
      or_dated_requested: OR_DATED,
      note: "OR dated slug not listed as separate catalog id; endpoints API aliases to rolling id while endpoint names show …-20260219",
    },
    cheaper_inference_adapter: "src/lib/cheaperInferenceConfig.ts adaptCheaperInferenceChatBody → reasoning_effort=low",
    openrouter_direct_transport: "src/lib/openRouterClient.ts + openRouterConfig.ts",
    gemini_reasoning_owner: "OPENROUTER_RP_REASONING_GEMINI_3_PRO effort=low; CI strips reasoning object and sets reasoning_effort=low",
    temperature_owner: "GEMINI_PRO_GENERATION_PARAMS.temperature=0.95",
    prompt_assembly_owner: "contextBuilder + assemblePrimaryRpRequest (frozen once for all arms)",
    response_model_capture: "final stream chunk .model / .provider / headers (non-secret)",
    usage_reasoning_parser: "completion_tokens_details.reasoning_tokens → REPORTED|UNREPORTED (never coerce missing→0)",
    narrative_density_live: systemFlat.includes("[NARRATIVE DENSITY]"),
    user_tail_present: lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
    common_prose_present: systemFlat.includes(COMMON_PROSE_BLOCK.slice(0, 40)),
    density_constant_exists_but: NARRATIVE_DENSITY_BLOCK.slice(0, 60),
  };
  write("OWNER_MAP.json", ownerMap);
  write("FROZEN_PROMPT_META.json", {
    frozen_prompt_hash: frozenHash,
    message_count: frozenMessages.length,
    last_user_has_current_user_tail: lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
    system_has_common_prose: systemFlat.includes(COMMON_PROSE_BLOCK.slice(0, 40)),
    system_has_narrative_density: systemFlat.includes("[NARRATIVE DENSITY]"),
    user_tail_owner_count: lastUser.split(USER_TAIL_LENGTH_OWNER_SENTENCE).length - 1,
  });
  write("frozen/wire-last-user.txt", lastUser);
  write("frozen/wire-system.txt", systemFlat);

  console.log(`[freeze] prompt_hash=${frozenHash}`);
  console.log(
    `[freeze] user_tail=1 common_prose=${systemFlat.includes(COMMON_PROSE_BLOCK.slice(0, 40))} density_live=${systemFlat.includes("[NARRATIVE DENSITY]")}`,
  );

  if (DRY_RUN) {
    console.log("PHASE1_DRY_RUN=1 — provider calls=0");
    console.log("provider calls=0");
    return;
  }

  const ciKey = exitIfBenchmarkCheaperInferenceApiKeyMissing(
    "SERVING_PARITY_NOT_RUN",
  );
  // Prefer dedicated OR benchmark keys — production OPENROUTER_API_KEY may be
  // present but chat-disabled ("User not found"). Never log key material.
  const orKey =
    process.env.OPENROUTER_JEV_BENCHMARK_API_KEY?.trim() ||
    process.env.OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    null;
  if (!orKey) {
    console.log(
      "SERVING_PARITY_NOT_RUN — missing OPENROUTER_JEV_BENCHMARK_API_KEY (or EMBEDDINGS / OPENROUTER_API_KEY)",
    );
    console.log("provider calls=0");
    process.exit(0);
  }
  const orKeySource =
    process.env.OPENROUTER_JEV_BENCHMARK_API_KEY?.trim() === orKey
      ? "OPENROUTER_JEV_BENCHMARK_API_KEY"
      : process.env.OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY?.trim() === orKey
        ? "OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY"
        : "OPENROUTER_API_KEY";
  console.log(`[cred] openrouter_key_source=${orKeySource}`);

  const armDefs: Record<
    ArmId,
    { label: string; route: "ci" | "or"; requestedModel: string }
  > = {
    A: {
      label: "CI gemini-3.1-pro-preview",
      route: "ci",
      requestedModel: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
    },
    B: {
      label: "OR rolling + AI Studio pin",
      route: "or",
      requestedModel: OR_ROLLING,
    },
    C: {
      label: "OR dated-20260219 + AI Studio pin",
      route: "or",
      requestedModel: OR_DATED,
    },
  };

  function buildArmBody(arm: ArmId): {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    const def = armDefs[arm];
    if (def.route === "ci") {
      const body = adaptCheaperInferenceChatBody({
        model: def.requestedModel,
        messages: structuredClone(frozenMessages),
        stream: true,
        stream_options: { include_usage: true },
        temperature: GEMINI_PRO_GENERATION_PARAMS.temperature,
      });
      delete body.max_tokens;
      // Ensure production CI Gemini effort invariant
      body.reasoning_effort = "low";
      delete body.reasoning;
      delete body.thinking;
      return {
        url: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers: buildCheaperInferenceHeaders(ciKey),
        body,
      };
    }

    // OpenRouter — same messages; pin AI Studio; no fallbacks.
    // buildOpenRouterRequestBody deletes provider during Gemini policy; re-apply after.
    const body = buildOpenRouterRequestBody(
      def.requestedModel,
      structuredClone(frozenMessages) as never,
      true,
      3200,
    ) as Record<string, unknown>;
    delete body.max_tokens;
    body.temperature = GEMINI_PRO_GENERATION_PARAMS.temperature;
    body.reasoning = { ...OPENROUTER_RP_REASONING_GEMINI_3_PRO };
    body.include_reasoning = false;
    body.provider = { ...OR_AI_STUDIO_PROVIDER };
    body.stream = true;
    body.stream_options = { include_usage: true };
    return {
      url: OPENROUTER_CHAT_COMPLETIONS_URL,
      headers: buildOpenRouterHeaders(orKey),
      body,
    };
  }

  // Preflight invariant checks (no calls)
  for (const arm of ARM_FILTER) {
    const { body } = buildArmBody(arm);
    const msgHash = promptContentHash(
      body.messages as Array<{ role: string; content: unknown }>,
    );
    if (msgHash !== frozenHash) {
      throw new Error(`${arm}: prompt hash drift ${msgHash} != ${frozenHash}`);
    }
    if (body.temperature !== 0.95) {
      throw new Error(`${arm}: temperature=${String(body.temperature)}`);
    }
    if (body.max_tokens != null) {
      throw new Error(`${arm}: max_tokens present`);
    }
    if (arm === "A") {
      if (body.reasoning_effort !== "low") {
        throw new Error(`A: reasoning_effort=${String(body.reasoning_effort)}`);
      }
    } else {
      const r = body.reasoning as { effort?: string } | undefined;
      if (r?.effort !== "low") {
        throw new Error(`${arm}: reasoning.effort=${String(r?.effort)}`);
      }
      const p = body.provider as typeof OR_AI_STUDIO_PROVIDER;
      if (
        !p ||
        p.allow_fallbacks !== false ||
        p.only?.[0] !== "google-ai-studio"
      ) {
        throw new Error(`${arm}: provider pin invalid ${JSON.stringify(p)}`);
      }
    }
    console.log(
      `[preflight] ${arm} model=${String(body.model)} temp=${body.temperature} hash_ok`,
    );
  }

  const results: Record<string, unknown>[] = [];
  let providerCalls = 0;

  for (const arm of ARM_FILTER) {
    for (let run = 1; run <= RUNS; run++) {
      const builtArm = buildArmBody(arm);
      // Save request body WITHOUT secrets (no headers)
      const reqSafe = scrubResponseMeta({
        url_host: new URL(builtArm.url).host,
        model: builtArm.body.model,
        temperature: builtArm.body.temperature,
        max_tokens: builtArm.body.max_tokens ?? null,
        reasoning: builtArm.body.reasoning ?? null,
        reasoning_effort: builtArm.body.reasoning_effort ?? null,
        provider: builtArm.body.provider ?? null,
        stream: builtArm.body.stream,
        message_count: Array.isArray(builtArm.body.messages)
          ? builtArm.body.messages.length
          : 0,
        frozen_prompt_hash: frozenHash,
      });
      write(`${arm}/run${run}/request-meta.json`, reqSafe);

      console.log(`[live] ${arm}/run${run} ${armDefs[arm].label} …`);
      const cap = await streamOnce(
        builtArm.url,
        builtArm.headers,
        builtArm.body,
      );
      providerCalls += 1; // exactly one — no retry

      const reasoning = extractReasoningState(cap.usage);
      const promptTokens =
        typeof cap.usage?.prompt_tokens === "number"
          ? cap.usage.prompt_tokens
          : null;
      const completionTokens =
        typeof cap.usage?.completion_tokens === "number"
          ? cap.usage.completion_tokens
          : null;
      const visibleChars = visibleAssistantDisplayCharCount(cap.text);
      const finalChunk = (cap.responseMeta.final_chunk ?? {}) as Record<
        string,
        unknown
      >;
      const returnedModel =
        typeof finalChunk.model === "string" ? finalChunk.model : null;
      const returnedProvider =
        finalChunk.provider ??
        (cap.responseMeta.headers as Record<string, string> | undefined)?.[
          "x-openrouter-provider"
        ] ??
        null;
      const generationId =
        typeof finalChunk.id === "string" ? finalChunk.id : null;

      const upstreamCost =
        typeof cap.usage?.cost === "number"
          ? cap.usage.cost
          : typeof (cap.usage as { total_cost?: unknown } | null)?.total_cost ===
              "number"
            ? (cap.usage as { total_cost: number }).total_cost
            : null;

      const row = {
        arm,
        label: armDefs[arm].label,
        run,
        frozen_prompt_hash: frozenHash,
        requested_model: armDefs[arm].requestedModel,
        returned_model: returnedModel,
        returned_provider: returnedProvider,
        generation_id: generationId,
        response_meta: scrubResponseMeta(cap.responseMeta),
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        reasoning_reporting_state: reasoning.reasoning_reporting_state,
        reasoning_tokens: reasoning.reasoning_tokens,
        visible_chars: visibleChars,
        raw_chars: cap.text.length,
        finish_reason: cap.finish,
        ttft_ms: cap.ttftMs,
        latency_ms: cap.latencyMs,
        upstream_cost: upstreamCost,
        provider_calls: 1,
        status: cap.status,
        error: cap.error,
        occurrences: qualityOccurrences(cap.text),
        temperature: builtArm.body.temperature,
        max_tokens: builtArm.body.max_tokens ?? null,
      };

      write(`${arm}/run${run}/raw.txt`, cap.text);
      write(`${arm}/run${run}/meta.json`, { ...row, usage: cap.usage });
      results.push(row);
      console.log(
        `  visible=${visibleChars} finish=${cap.finish} prompt=${promptTokens} completion=${completionTokens} reason_state=${reasoning.reasoning_reporting_state} reason=${reasoning.reasoning_tokens} returned_model=${returnedModel} provider=${JSON.stringify(returnedProvider)} err=${cap.error ? "YES" : "no"}`,
      );
    }
  }

  write("RESULTS.json", results);
  write("SUMMARY_PROVIDER_CALLS.json", {
    provider_calls_total: providerCalls,
    per_sample: 1,
    note: "No continuation / retry / recovery / fallback calls",
  });

  const dist: Record<string, unknown> = {};
  for (const arm of ARM_FILTER) {
    const vals = results
      .filter((r) => r.arm === arm)
      .map((r) => Number(r.visible_chars));
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = vals.reduce((s, x) => s + x, 0) / (vals.length || 1);
    dist[arm] = {
      n: vals.length,
      values: vals,
      min: sorted[0] ?? null,
      median:
        sorted.length === 0
          ? null
          : sorted.length % 2
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2,
      mean: Math.round(mean),
      max: sorted[sorted.length - 1] ?? null,
      ge_2700: vals.filter((v) => v >= 2700).length,
      ge_3200: vals.filter((v) => v >= 3200).length,
    };
  }
  write("DISTRIBUTION.json", dist);
  console.log("DISTRIBUTION", JSON.stringify(dist, null, 2));
  console.log(`provider calls=${providerCalls}`);
  console.log(`wrote ${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(sanitizeSecrets(String(e)));
  process.exit(1);
});
