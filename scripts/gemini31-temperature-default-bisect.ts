/**
 * BUGFIX investigation — Gemini 3.1 temperature default vs legacy 0.95 (Phase 1).
 *
 * Same frozen quiet_intimacy prompt; CheaperInference only; exactly one call/sample.
 *
 *   A — gemini-3.1-pro-preview + temperature=0.95 (current control)
 *   B — gemini-3.1-pro-preview + temperature OMITTED (vendor default path)
 *   C — gemini-3.1-pro + temperature OMITTED + reasoning_effort=low
 *
 *   PHASE1_RUNS=5 node --conditions=react-server --import tsx \
 *     scripts/gemini31-temperature-default-bisect.ts
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
  type ProseDietFixtureId,
} from "./lib/proseDietFixtures";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type ArmId = "A" | "B" | "C";

const OUT_ROOT =
  process.env.TEMP_BISECT_OUT?.trim() ||
  "/opt/cursor/artifacts/gemini31-temperature-default-bisect";
const DOCS_MIRROR = path.join(
  process.cwd(),
  "docs/audits/gemini31-temperature-default-bisect",
);
const RUNS = Math.max(1, Math.min(5, Number(process.env.PHASE1_RUNS ?? "5") || 5));
const DRY_RUN = process.env.PHASE1_DRY_RUN === "1";
const ARM_FILTER = (process.env.PHASE1_ARMS ?? "A,B,C")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean) as ArmId[];
const FIXTURE_FILTER = (process.env.PHASE1_FIXTURES ?? "quiet_intimacy")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as ProseDietFixtureId[];

const CI_PREVIEW = "gemini-3.1-pro-preview";
const CI_PRO = "gemini-3.1-pro";

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
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer [REDACTED]")
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

function promptContentHash(
  messages: Array<{ role: string; content: unknown }>,
): string {
  return sha256(
    JSON.stringify(
      messages.map((m) => ({ role: m.role, content: flatContent(m.content) })),
    ),
  );
}

function extractReasoning(usage: Record<string, unknown> | null): {
  reasoning_reporting_state: "REPORTED" | "UNREPORTED";
  reasoning_tokens: number | null;
} {
  if (!usage) return { reasoning_reporting_state: "UNREPORTED", reasoning_tokens: null };
  const details = usage.completion_tokens_details;
  if (!details || typeof details !== "object") {
    return { reasoning_reporting_state: "UNREPORTED", reasoning_tokens: null };
  }
  const rt = (details as { reasoning_tokens?: unknown }).reasoning_tokens;
  if (typeof rt === "number" && Number.isFinite(rt)) {
    return { reasoning_reporting_state: "REPORTED", reasoning_tokens: rt };
  }
  return { reasoning_reporting_state: "UNREPORTED", reasoning_tokens: null };
}

function qualityOccurrences(text: string) {
  return {
    user_dialogue_invented: (
      text.match(/렌(?:은|이|가)\s*(?:말했|대답했|"|')/g) ?? []
    ).length,
    user_major_choice_action: (
      text.match(/렌(?:은|이|가)\s*(?:고개를 끄덕|동의|거절|손을 잡|키스)/g) ?? []
    ).length,
    filler: (text.match(/미세하게|아주 조금|살짝/g) ?? []).length,
    repeated_idea: (text.match(/(네온|사이렌|장갑|창틀)/g) ?? []).length >= 8 ? 1 : 0,
    abstract_emotion_padding: (
      text.match(/설렘|안도감|따뜻함|외로움/g) ?? []
    ).length,
    unnecessary_npc_event: (
      text.match(/(갑자기|그때 마침).{0,24}(?:누군가|사람|직원)/g) ?? []
    ).length,
    premature_scene_closure: /편하게 계십시오|여기 있어도 됩니다/.test(
      text.slice(-350),
    )
      ? 1
      : 0,
    layout_no_blank_line: !/\n\n/.test(text) ? 1 : 0,
    catastrophic_short: text.length > 0 && text.length < 1500 ? 1 : 0,
  };
}

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: unknown,
) {
  const started = Date.now();
  const out = {
    text: "",
    finish: null as string | null,
    usage: null as Record<string, unknown> | null,
    returnedModel: null as string | null,
    generationId: null as string | null,
    responseMeta: {} as Record<string, unknown>,
    error: null as string | null,
    status: 0,
    latencyMs: 0,
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12 * 60 * 1000),
    });
    out.status = res.status;
    const hdr: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (lk === "authorization" || lk.includes("key") || lk.includes("secret")) return;
      if (
        lk.includes("request-id") ||
        lk.startsWith("x-ci-") ||
        lk.startsWith("x-") ||
        lk === "server"
      ) {
        hdr[k] = v;
      }
    });
    out.responseMeta.headers = hdr;
    if (!res.ok || !res.body) {
      out.error = sanitizeSecrets((await res.text()).slice(0, 2000));
      out.latencyMs = Date.now() - started;
      return out;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const handle = (line: string) => {
      const t = line.trim();
      if (!t.startsWith("data:")) return;
      const data = t.slice(5).trim();
      if (!data || data === "[DONE]") return;
      try {
        const ev = JSON.parse(data) as Record<string, unknown>;
        if (typeof ev.model === "string") out.returnedModel = ev.model;
        if (typeof ev.id === "string") out.generationId = ev.id;
        const choice = (ev.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = (choice?.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === "string") out.text += delta.content;
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          out.finish = choice.finish_reason;
        }
        if (ev.usage && typeof ev.usage === "object") {
          out.usage = ev.usage as Record<string, unknown>;
        }
        out.responseMeta.final_chunk = {
          id: ev.id,
          model: ev.model,
          object: ev.object,
          created: ev.created,
          modelVersion: ev.modelVersion,
          model_version: ev.model_version,
        };
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
  const { GEMINI_PRO_GENERATION_PARAMS } = await import(
    "../src/lib/openRouterClient"
  );
  const { isGemini31ProModel, isCheaperInferenceGemini37FlashModel } =
    await import("../src/lib/chatModels");

  const fixtures = PROSE_DIET_FIXTURES.filter((f) => FIXTURE_FILTER.includes(f.id));
  if (!fixtures.length) throw new Error("no fixtures");
  const fx = fixtures[0]!;

  const longTermMemory =
    "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.";

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
    chatId: 930041,
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
      characterId: "temp-bisect-1",
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
        chatId: 930041,
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

  write("OWNER_MAP.json", {
    EXACT_MAIN: "a8c343fc4b9f3bb1180d628707aa87218e77433b",
    LOCAL_HEAD: execSync("git rev-parse HEAD", { encoding: "utf8" }).trim(),
    GEMINI_PRO_GENERATION_PARAMS,
    temperature_0_95_consumers:
      "normalizeOpenRouterGenerationParams → isGeminiProOpenRouterModel/isGemini31ProModel (id includes gemini-3.1-pro)",
    gemini_37_flash:
      "isCheaperInferenceGemini37FlashModel — NOT in Gemini Pro temperature path; own reasoning_effort=low",
    gemini_37_unaffected_by_pro_temp: !isGemini31ProModel(
      "gemini-3.7-flash",
    ),
    ci_preview_is_31_pro_family: isGemini31ProModel(CI_PREVIEW),
    ci_pro_is_31_pro_family: isGemini31ProModel(CI_PRO),
    ci_37_is_37: isCheaperInferenceGemini37FlashModel("gemini-3.7-flash"),
    reasoning_adapt:
      "isCheaperInferenceGemini31ProModel matches PREVIEW only → reasoning_effort=low; bare gemini-3.1-pro falls through to none unless harness sets low",
    billing_pricing: "unchanged — investigation only",
    cache_owner: "CI prompt-cache headers / session affinity (not mutated)",
  });
  write("FROZEN_PROMPT_META.json", {
    frozen_prompt_hash: frozenHash,
    fixture: fx.id,
    user_tail: lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE),
    common_prose: systemFlat.includes(COMMON_PROSE_BLOCK.slice(0, 40)),
    density_live: systemFlat.includes("[NARRATIVE DENSITY]"),
  });
  write("frozen/wire-last-user.txt", lastUser);
  write("frozen/wire-system.txt", systemFlat);
  console.log(`[freeze] hash=${frozenHash} fixture=${fx.id}`);

  function buildArmBody(arm: ArmId): Record<string, unknown> {
    const model = arm === "C" ? CI_PRO : CI_PREVIEW;
    const body = adaptCheaperInferenceChatBody({
      model,
      messages: structuredClone(frozenMessages),
      stream: true,
      stream_options: { include_usage: true },
      // Start from production path value; A keeps it, B/C delete.
      temperature: GEMINI_PRO_GENERATION_PARAMS.temperature,
    });
    delete body.max_tokens;
    body.reasoning_effort = "low";
    delete body.reasoning;
    delete body.thinking;
    if (arm === "A") {
      body.temperature = 0.95;
    } else {
      delete body.temperature;
    }
    return body;
  }

  // Preflight
  for (const arm of ARM_FILTER) {
    const body = buildArmBody(arm);
    const h = promptContentHash(
      body.messages as Array<{ role: string; content: unknown }>,
    );
    if (h !== frozenHash) throw new Error(`${arm}: prompt hash drift`);
    if (body.max_tokens != null) throw new Error(`${arm}: max_tokens present`);
    if (body.reasoning_effort !== "low") {
      throw new Error(`${arm}: reasoning_effort=${String(body.reasoning_effort)}`);
    }
    if (arm === "A") {
      if (body.temperature !== 0.95) throw new Error("A temp != 0.95");
      if (!("temperature" in body)) throw new Error("A missing temperature key");
    } else {
      if ("temperature" in body) {
        throw new Error(`${arm}: temperature should be omitted, got ${String(body.temperature)}`);
      }
    }
    console.log(
      `[preflight] ${arm} model=${String(body.model)} temp=${"temperature" in body ? body.temperature : "OMITTED"} effort=${body.reasoning_effort}`,
    );
  }

  if (DRY_RUN) {
    console.log("PHASE1_DRY_RUN=1 provider calls=0");
    return;
  }

  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing(
    "TEMP_BISECT_NOT_RUN",
  );

  const results: Record<string, unknown>[] = [];
  let providerCalls = 0;
  let armCStopped: string | null = null;

  for (const arm of ARM_FILTER) {
    if (arm === "C" && armCStopped) break;
    for (let run = 1; run <= RUNS; run++) {
      const body = buildArmBody(arm);
      write(`${fx.id}/${arm}/run${run}/request-body-meta.json`, {
        model: body.model,
        temperature_present: "temperature" in body,
        temperature: body.temperature ?? null,
        reasoning_effort: body.reasoning_effort,
        max_tokens: body.max_tokens ?? null,
        frozen_prompt_hash: frozenHash,
        keys: Object.keys(body).sort(),
      });
      console.log(`[live] ${fx.id}/${arm}/run${run} …`);
      const cap = await streamOnce(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        buildCheaperInferenceHeaders(apiKey),
        body,
      );
      providerCalls += 1;

      if (arm === "C" && cap.status >= 400) {
        armCStopped = cap.error ?? `HTTP ${cap.status}`;
        write(`${fx.id}/C/STOP.json`, {
          reason: "model rejected request (likely reasoning_effort=low or model contract)",
          status: cap.status,
          error: cap.error,
          run,
        });
        console.log(`[STOP C] ${armCStopped}`);
        results.push({
          arm,
          run,
          stopped: true,
          error: cap.error,
          status: cap.status,
          provider_calls: 1,
        });
        break;
      }

      const reasoning = extractReasoning(cap.usage);
      const promptTokens =
        typeof cap.usage?.prompt_tokens === "number" ? cap.usage.prompt_tokens : null;
      const completionTokens =
        typeof cap.usage?.completion_tokens === "number"
          ? cap.usage.completion_tokens
          : null;
      const cacheRead = (() => {
        const d = cap.usage?.prompt_tokens_details as
          | { cached_tokens?: unknown }
          | undefined;
        return typeof d?.cached_tokens === "number" ? d.cached_tokens : null;
      })();
      const visible = visibleAssistantDisplayCharCount(cap.text);
      const share =
        completionTokens &&
        completionTokens > 0 &&
        reasoning.reasoning_tokens != null
          ? reasoning.reasoning_tokens / completionTokens
          : null;
      const cost =
        typeof cap.usage?.cost === "number"
          ? cap.usage.cost
          : typeof (cap.usage as { billed_cost_usd?: unknown } | null)
                ?.billed_cost_usd === "number"
            ? (cap.usage as { billed_cost_usd: number }).billed_cost_usd
            : null;

      const row = {
        arm,
        fixtureId: fx.id,
        run,
        frozen_prompt_hash: frozenHash,
        requested_model: body.model,
        returned_model: cap.returnedModel,
        generation_id: cap.generationId,
        temperature_field:
          "temperature" in body ? body.temperature : "OMITTED",
        reasoning_effort: body.reasoning_effort,
        provider_calls: 1,
        visible_chars: visible,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        reasoning_reporting_state: reasoning.reasoning_reporting_state,
        reasoning_tokens: reasoning.reasoning_tokens,
        reasoning_completion_share: share,
        finish_reason: cap.finish,
        latency_ms: cap.latencyMs,
        cost,
        cache_tokens: cacheRead,
        status: cap.status,
        error: cap.error,
        occurrences: qualityOccurrences(cap.text),
        response_meta: cap.responseMeta,
      };
      write(`${fx.id}/${arm}/run${run}/raw.txt`, cap.text);
      write(`${fx.id}/${arm}/run${run}/meta.json`, { ...row, usage: cap.usage });
      results.push(row);
      console.log(
        `  visible=${visible} finish=${cap.finish} comp=${completionTokens} reason_state=${reasoning.reasoning_reporting_state} reason=${reasoning.reasoning_tokens} share=${share?.toFixed(3) ?? "n/a"} returned=${cap.returnedModel} err=${cap.error ? "YES" : "no"}`,
      );
    }
  }

  write("RESULTS.json", results);
  write("SUMMARY_PROVIDER_CALLS.json", {
    provider_calls_total: providerCalls,
    per_sample: 1,
    arm_c_stopped: armCStopped,
  });

  const dist: Record<string, unknown> = {};
  for (const arm of ["A", "B", "C"] as ArmId[]) {
    const vals = results
      .filter((r) => r.arm === arm && typeof r.visible_chars === "number")
      .map((r) => Number(r.visible_chars));
    if (!vals.length) {
      dist[arm] = { n: 0 };
      continue;
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
    dist[arm] = {
      n: vals.length,
      values: vals,
      min: sorted[0],
      median:
        sorted.length % 2
          ? sorted[(sorted.length - 1) / 2]
          : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2,
      mean: Math.round(mean),
      max: sorted[sorted.length - 1],
      low_tail_lt_1500: vals.filter((v) => v < 1500).length,
      ge_2700: vals.filter((v) => v >= 2700).length,
      ge_3200: vals.filter((v) => v >= 3200).length,
    };
  }
  write("DISTRIBUTION.json", dist);
  console.log("DISTRIBUTION", JSON.stringify(dist, null, 2));
  console.log(`provider calls=${providerCalls}`);
}

main().catch((e) => {
  console.error(sanitizeSecrets(String(e)));
  process.exit(1);
});
