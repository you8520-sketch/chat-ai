/**
 * Gemini 3.1 Pro — under-tier continuation viability benchmark (AUDIT ONLY).
 *
 * Production invariants unchanged:
 *   TURN_LENGTH_SUPPLEMENT_API_ENABLED=false
 *   MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1
 *
 * Does NOT call continueNarrativeIfUnderMinimum (flag-gated / TurnApiBudget).
 * Reuses dormant builders + merge helpers with a benchmark-only second fetch.
 *
 * Shared primary call → Control A final = primary.
 * Candidate B: if needsVisibleLengthContinuation(primary) AND finish=stop →
 *   one continuation call via existing recovery builders/merge; else B=A.
 *
 *   REPS=4 FIXTURES=quiet_intimacy,casual_banter,tension_action \
 *     npx tsx scripts/gemini31-continuation-benchmark.ts
 */
import "./lib/server-only-mock";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
  resolveBeardVariant,
  type ProseDietFixtureId,
} from "./lib/proseDietFixtures";
import { CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL } from "../src/lib/chatModels";
import {
  TURN_LENGTH_SUPPLEMENT_API_ENABLED,
  MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
  buildRecoveryContinuationRequest,
  buildRecoveryContinuationSystemPrompt,
} from "../src/lib/turnApiBudget";
import {
  needsVisibleLengthContinuation,
  buildVisibleLengthContinuationUserMessage,
} from "../src/lib/narrativeLengthContinuation";
import {
  capRecoveryContinuation,
  finalizeRecoveryMerge,
  meetsTierLengthRequirements,
} from "../src/lib/responseLength";
import { preserveStreamFirstContinuationMerge } from "../src/lib/streamFirstSave";
import { extractProseWithoutHtml } from "../src/lib/htmlVisualCardRecovery";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

if (TURN_LENGTH_SUPPLEMENT_API_ENABLED !== false) {
  throw new Error("benchmark expects TURN_LENGTH_SUPPLEMENT_API_ENABLED=false");
}
if (MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN !== 1) {
  throw new Error("benchmark expects MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN=1");
}

const LABEL = process.env.LABEL?.trim() || "gemini31-continuation";
const OUT_ROOT = path.join("/opt/cursor/artifacts", LABEL);
const REPS = Math.max(1, Math.min(6, Number(process.env.REPS ?? 4) || 4));
const TARGET_CHARS = 3200;
const MODEL =
  process.env.MODEL?.trim() || CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL;
const FIXTURE_IDS = (process.env.FIXTURES ??
  "quiet_intimacy,casual_banter,tension_action")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean) as ProseDietFixtureId[];

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function write(rel: string, content: string | object) {
  const p = path.join(OUT_ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8",
  );
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

function usageNumbers(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      prompt_tokens: null as number | null,
      completion_tokens: null as number | null,
      reasoning_tokens: null as number | null,
      total_tokens: null as number | null,
    };
  }
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? NaN);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? NaN);
  const details = usage.completion_tokens_details as
    | Record<string, unknown>
    | undefined;
  const reasoningRaw =
    details?.reasoning_tokens ??
    usage.reasoning_tokens ??
    (usage as { reasoning?: { tokens?: number } }).reasoning?.tokens;
  const reasoning = reasoningRaw != null ? Number(reasoningRaw) : null;
  const total = Number(usage.total_tokens ?? NaN);
  return {
    prompt_tokens: Number.isFinite(prompt) ? prompt : null,
    completion_tokens: Number.isFinite(completion) ? completion : null,
    reasoning_tokens: Number.isFinite(reasoning!) ? reasoning : null,
    total_tokens: Number.isFinite(total) ? total : null,
  };
}

function estimateCostUsd(
  modelId: string,
  usage: ReturnType<typeof usageNumbers>,
  rawUsage: Record<string, unknown> | null,
  openRouterUsdCostFromRates: (opts: {
    rates: unknown;
    promptTokens: number;
    completionTokens: number;
  }) => number,
  resolveOpenRouterModelRates: (id: string) => unknown,
): number | null {
  const upstream =
    rawUsage &&
    (Number((rawUsage as { upstream_cost_usd?: unknown }).upstream_cost_usd) ||
      Number((rawUsage as { upstreamCostUsd?: unknown }).upstreamCostUsd));
  if (Number.isFinite(upstream) && upstream! > 0) return upstream!;
  if (usage.prompt_tokens != null && usage.completion_tokens != null) {
    return openRouterUsdCostFromRates({
      rates: resolveOpenRouterModelRates(modelId),
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
    });
  }
  return null;
}

/** Occurrence annotations only — no scores. */
function annotate(text: string, prior?: string) {
  const sentences = text.split(/(?<=[.!?…“”"])\s+/).filter((s) => s.trim().length > 20);
  let exactEcho = 0;
  if (prior) {
    const priorLines = prior
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 25);
    for (const line of priorLines.slice(-8)) {
      if (text.includes(line)) exactEcho += 1;
    }
  }
  return {
    exact_sentence_echo_hits: exactEcho,
    dialogue_blocks: (text.match(/"[^"]{2,}"/g) ?? []).length,
    npc_intro_hits: (text.match(/(?:낯선|모르는|옆(?:자리|테이블)|웨이터|손님|형사)/g) ?? [])
      .length,
    emotion_explain_hits: (text.match(/(?:라는 뜻|의미였|느꼈기 때문|때문이었다)/g) ?? [])
      .length,
    micro_action_hits: (text.match(/(?:손가락을|입꼬리|눈동자|숨을\s*(?:고르|삼키))/g) ?? [])
      .length,
    summary_hits: (text.match(/(?:요약하면|정리하면|다시 말하면|결국)/g) ?? []).length,
    sentence_count_est: sentences.length,
  };
}

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) {
  const started = Date.now();
  const out = {
    text: "",
    finish: null as string | null,
    usage: null as Record<string, unknown> | null,
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
    if (!res.ok || !res.body) {
      out.error = sanitizeBenchmarkCredentialText((await res.text()).slice(0, 2000));
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
        const choice = (ev.choices as Array<Record<string, unknown>> | undefined)?.[0];
        const delta = (choice?.delta ?? {}) as Record<string, unknown>;
        if (typeof delta.content === "string") out.text += delta.content;
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          out.finish = choice.finish_reason;
        }
        if (ev.usage && typeof ev.usage === "object") {
          out.usage = ev.usage as Record<string, unknown>;
        }
      } catch {
        // partial
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
    out.error = sanitizeBenchmarkCredentialText(String(e)).slice(0, 2000);
  }
  out.latencyMs = Date.now() - started;
  return out;
}

function mergeContinuation(prior: string, contRaw: string): string {
  const priorTrim = prior.trim();
  const tail = capRecoveryContinuation(priorTrim, contRaw, TARGET_CHARS, {
    claudeRecovery: false,
  });
  const merged = finalizeRecoveryMerge(priorTrim, priorTrim + tail, {
    claudeRecovery: false,
  });
  const clean = extractProseWithoutHtml(merged) || merged.trim();
  return preserveStreamFirstContinuationMerge(priorTrim, clean, TARGET_CHARS);
}

async function main() {
  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing(
    "GEMINI31_CONTINUATION_BENCH_NOT_RUN",
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const { buildSceneDirective, renderSceneDirectiveForPrompt } =
    await import("../src/lib/sceneDirective");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } =
    await import("../src/lib/chatMemory");
  const { visibleAssistantDisplayCharCount } =
    await import("../src/lib/chatDisplayLength");
  const { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } = await import(
    "../src/lib/currentTurnUserAuthoringDelegation"
  );
  const { openRouterUsdCostFromRates, resolveOpenRouterModelRates } = await import(
    "../src/lib/openRouterModelPricing"
  );

  write("owner-map.json", {
    production_flags: {
      TURN_LENGTH_SUPPLEMENT_API_ENABLED,
      MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
      NARRATIVE_LENGTH_CONTINUATION_ENABLED: false,
    },
    reused_builders: [
      "needsVisibleLengthContinuation",
      "buildVisibleLengthContinuationUserMessage",
      "buildRecoveryContinuationSystemPrompt",
      "buildRecoveryContinuationRequest",
      "capRecoveryContinuation",
      "finalizeRecoveryMerge",
      "preserveStreamFirstContinuationMerge",
      "extractProseWithoutHtml",
    ],
    NOT_used: [
      "continueNarrativeIfUnderMinimum (flag-gated)",
      "TurnApiBudget.beforeFetch for continuation",
      "route.ts production path",
    ],
    model: MODEL,
    target_chars: TARGET_CHARS,
    tier_floor_note: "needsVisibleLengthContinuation uses resolveTierMinimumRequired (2700 for default 3200 target)",
  });

  const variant = resolveBeardVariant("A");
  const characterSystemPrompt = PROSE_DIET_CHARACTER_SYSTEM_PROMPT.replace(
    /# 외형\n.*/,
    `# 외형\n${variant.appearance}`,
  );
  const longTermMemory =
    "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.";
  const headers = buildCheaperInferenceHeaders(apiKey);
  const index: Record<string, unknown>[] = [];

  for (const fixtureId of FIXTURE_IDS) {
    const fx = PROSE_DIET_FIXTURES.find((f) => f.id === fixtureId);
    if (!fx) throw new Error(`unknown fixture ${fixtureId}`);

    for (let rep = 1; rep <= REPS; rep++) {
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
        chatId: 1,
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
          characterId: "g31-cont-bench",
          characterName: PROSE_DIET_CHAR_NAME,
          gender: variant.gender,
          systemPrompt: characterSystemPrompt,
          world: PROSE_DIET_WORLD,
          exampleDialog: PROSE_DIET_EXAMPLE_DIALOG,
          statusWindowPrompt: "",
        }),
        userPersona: formatSelectedPersonaForPrompt(
          PROSE_DIET_PERSONA_NAME,
          variant.personaGender,
          variant.personaDescription,
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
        gender: variant.gender,
        userPersonaGender: variant.personaGender,
        currentTurnAuthoringDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
        novelModeEnabled: false,
        targetResponseChars: TARGET_CHARS,
        completedTurns: 3,
        genres: ["현대/일상"],
        provider: "openrouter",
        modelId: MODEL,
        contentKind: "character",
        narrativePov,
        sceneDirectiveBlock: renderSceneDirectiveForPrompt(directive),
        scenePacingPromptOwner: "legacy_v1",
      });

      const wire = assemblePrimaryRpRequest({
        system: built.systemPrompt ?? "",
        history: built.history,
        modelId: MODEL,
        targetResponseChars: TARGET_CHARS,
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
            chatId: 1,
            currentTurn: 3,
            progressionHistory: [],
            canonicalSceneDirective: directive,
            skipMotionCue: false,
          },
        },
      });

      const primaryBody: Record<string, unknown> = {
        ...(wire.requestBody as Record<string, unknown>),
        stream: true,
        stream_options: { include_usage: true },
      };
      delete primaryBody.max_tokens;
      delete primaryBody.max_completion_tokens;

      const primarySystem = flatContent(
        (primaryBody.messages as Array<{ role: string; content: unknown }>).find(
          (m) => m.role === "system",
        )?.content,
      );
      const promptHash = sha256(JSON.stringify(primaryBody.messages));
      const dir = `${fixtureId}/r${rep}`;

      write(`${dir}/primary-request-meta.json`, {
        max_tokens: primaryBody.max_tokens ?? null,
        reasoning_effort: primaryBody.reasoning_effort ?? null,
        prompt_hash: promptHash,
        temperature: primaryBody.temperature ?? null,
      });

      const primary = await streamOnce(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers,
        primaryBody,
      );
      const primaryVisible = visibleAssistantDisplayCharCount(primary.text);
      const primaryUsage = usageNumbers(primary.usage);
      const primaryCost = estimateCostUsd(
        MODEL,
        primaryUsage,
        primary.usage,
        openRouterUsdCostFromRates as never,
        resolveOpenRouterModelRates as never,
      );
      const tierCheck = meetsTierLengthRequirements(primary.text, TARGET_CHARS);
      const underFloor = needsVisibleLengthContinuation(primary.text, TARGET_CHARS);
      const cleanStop = primary.finish === "stop";

      write(`${dir}/primary-raw.txt`, primary.text);

      let contTriggered = false;
      let contRaw = "";
      let contFinish: string | null = null;
      let contUsage = usageNumbers(null);
      let contCost: number | null = null;
      let contLatency = 0;
      let contError: string | null = null;
      let mergedText = primary.text.trim();
      let calls = 1;

      if (underFloor && cleanStop && !primary.error) {
        contTriggered = true;
        calls = 2;
        const lengthCheck = meetsTierLengthRequirements(primary.text, TARGET_CHARS);
        const userMsg = buildVisibleLengthContinuationUserMessage(
          lengthCheck.charCount,
          TARGET_CHARS,
          lengthCheck.wordCount,
        );
        const contSystem = `${primarySystem}\n\n${buildRecoveryContinuationSystemPrompt()}`;
        const { history } = buildRecoveryContinuationRequest(
          primary.text.trim(),
          userMsg,
          MODEL,
        );
        const contMessages = [
          { role: "system", content: contSystem },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ];
        const contBody: Record<string, unknown> = {
          model: MODEL,
          messages: contMessages,
          stream: true,
          stream_options: { include_usage: true },
          temperature: primaryBody.temperature,
          reasoning_effort: primaryBody.reasoning_effort ?? "low",
        };
        write(`${dir}/continuation-user-msg.txt`, userMsg);
        write(`${dir}/continuation-request-meta.json`, {
          max_tokens: null,
          reasoning_effort: contBody.reasoning_effort,
          history_roles: history.map((m) => m.role),
          recovery_system_appended: true,
        });

        const cont = await streamOnce(
          CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
          headers,
          contBody,
        );
        contRaw = cont.text;
        contFinish = cont.finish;
        contUsage = usageNumbers(cont.usage);
        contCost = estimateCostUsd(
          MODEL,
          contUsage,
          cont.usage,
          openRouterUsdCostFromRates as never,
          resolveOpenRouterModelRates as never,
        );
        contLatency = cont.latencyMs;
        contError = cont.error;
        write(`${dir}/continuation-raw.txt`, contRaw);
        if (!cont.error) {
          mergedText = mergeContinuation(primary.text, contRaw);
        }
      } else {
        write(`${dir}/continuation-skipped.txt`, {
          underFloor,
          cleanStop,
          primary_error: primary.error,
          primary_visible: primaryVisible,
          tier_min_chars: tierCheck.minChars,
        });
      }

      write(`${dir}/merged-final.txt`, mergedText);
      write(`${dir}/control-a-final.txt`, primary.text.trim());

      const aVisible = primaryVisible;
      const bVisible = visibleAssistantDisplayCharCount(mergedText);
      const aAnnot = annotate(primary.text.trim());
      const bAnnot = annotate(mergedText, primary.text.trim());

      const row = {
        fixture: fixtureId,
        rep,
        modelId: MODEL,
        prompt_hash: promptHash,
        production_diff: 0,
        primary: {
          visible_chars: aVisible,
          finish_reason: primary.finish,
          latency_ms: primary.latencyMs,
          cost_usd_est: primaryCost,
          error: primary.error,
          ...primaryUsage,
          under_tier_floor: underFloor,
          tier_min_chars: tierCheck.minChars,
          annotations: aAnnot,
        },
        continuation: contTriggered
          ? {
              triggered: true,
              visible_chars_added: Math.max(0, bVisible - aVisible),
              finish_reason: contFinish,
              latency_ms: contLatency,
              cost_usd_est: contCost,
              error: contError,
              ...contUsage,
            }
          : { triggered: false },
        control_a: {
          final_visible_chars: aVisible,
          total_calls: 1,
          total_cost_usd_est: primaryCost,
          total_latency_ms: primary.latencyMs,
          meets_floor: aVisible >= tierCheck.minChars,
        },
        candidate_b: {
          final_visible_chars: bVisible,
          total_calls: calls,
          total_cost_usd_est:
            primaryCost != null || contCost != null
              ? (primaryCost ?? 0) + (contCost ?? 0)
              : null,
          total_latency_ms: primary.latencyMs + contLatency,
          meets_floor: bVisible >= tierCheck.minChars,
          annotations: bAnnot,
        },
      };
      write(`${dir}/meta.json`, row);
      index.push(row);
      console.log(
        `[${LABEL}] ${fixtureId} r${rep} primary=${aVisible} under=${underFloor} cont=${contTriggered} finalB=${bVisible} finish=${primary.finish}`,
      );
      await new Promise((r) => setTimeout(r, 3500));
    }
  }

  // Aggregate
  const primaries = index.map((r) => r as typeof index[0] & {
    primary: { under_tier_floor: boolean; visible_chars: number };
    continuation: { triggered: boolean };
    control_a: { final_visible_chars: number; meets_floor: boolean; total_cost_usd_est: number | null; total_latency_ms: number };
    candidate_b: { final_visible_chars: number; meets_floor: boolean; total_cost_usd_est: number | null; total_latency_ms: number; total_calls: number };
  });
  const n = primaries.length;
  const triggers = primaries.filter((r) => r.continuation.triggered);
  const aFloor = primaries.filter((r) => r.control_a.meets_floor).length;
  const bFloor = primaries.filter((r) => r.candidate_b.meets_floor).length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const aCosts = primaries.map((r) => r.control_a.total_cost_usd_est).filter((x): x is number => x != null);
  const bCosts = primaries.map((r) => r.candidate_b.total_cost_usd_est).filter((x): x is number => x != null);
  const triggerCostsA = triggers.map((r) => r.control_a.total_cost_usd_est).filter((x): x is number => x != null);
  const triggerCostsB = triggers.map((r) => r.candidate_b.total_cost_usd_est).filter((x): x is number => x != null);

  const summary = {
    n_primary: n,
    continuation_trigger_rate: n ? triggers.length / n : 0,
    control_a_meets_floor_rate: n ? aFloor / n : 0,
    candidate_b_meets_floor_rate: n ? bFloor / n : 0,
    primary_visible_avg: avg(primaries.map((r) => r.primary.visible_chars)),
    control_a_final_avg: avg(primaries.map((r) => r.control_a.final_visible_chars)),
    candidate_b_final_avg: avg(primaries.map((r) => r.candidate_b.final_visible_chars)),
    all_turn_cost_avg_a: avg(aCosts),
    all_turn_cost_avg_b: avg(bCosts),
    all_turn_cost_multiplier: avg(aCosts) > 0 ? avg(bCosts) / avg(aCosts) : null,
    triggered_turn_cost_avg_a: avg(triggerCostsA),
    triggered_turn_cost_avg_b: avg(triggerCostsB),
    triggered_turn_cost_multiplier:
      avg(triggerCostsA) > 0 ? avg(triggerCostsB) / avg(triggerCostsA) : null,
    latency_avg_a: avg(primaries.map((r) => r.control_a.total_latency_ms)),
    latency_avg_b: avg(primaries.map((r) => r.candidate_b.total_latency_ms)),
    production_diff: 0,
    flags_unchanged: {
      TURN_LENGTH_SUPPLEMENT_API_ENABLED,
      MAX_MAIN_RP_PROVIDER_CALLS_PER_TURN,
    },
  };
  write("SUMMARY.json", summary);
  write("INDEX.json", index);
  console.log(`[${LABEL}] SUMMARY`, summary);
  console.log(`wrote ${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
