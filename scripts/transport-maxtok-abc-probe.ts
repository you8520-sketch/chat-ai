/**
 * Main RP transport output budget A/B/C — same production wire, vary max_tokens only.
 *
 * Arms per model: omitted | 4096 | 8192
 * reasoning_effort / DeepSeek thinking policy unchanged (production adapt path).
 * No retry, no continuation.
 *
 *   FIXTURE=quiet_intimacy REPS=3 npx tsx scripts/transport-maxtok-abc-probe.ts
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
} from "./lib/proseDietFixtures";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "../src/lib/chatModels";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const LABEL = process.env.LABEL?.trim() || "transport-maxtok-abc";
const OUT_ROOT = path.join("/opt/cursor/artifacts", LABEL);
const REPS = Math.max(1, Math.min(5, Number(process.env.REPS ?? 3) || 3));
const FIXTURE_ID = process.env.FIXTURE?.trim() || "quiet_intimacy";
const MODELS = (process.env.MODELS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const DEFAULT_MODELS = [
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
];

type ArmId = "omitted" | "4096" | "8192";

const ARMS: { id: ArmId; max_tokens: number | undefined }[] = [
  { id: "omitted", max_tokens: undefined },
  { id: "4096", max_tokens: 4096 },
  { id: "8192", max_tokens: 8192 },
];

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function stableBodyForCompare(body: Record<string, unknown>): string {
  const clone = { ...body };
  delete clone.max_tokens;
  delete clone.max_completion_tokens;
  return JSON.stringify(clone);
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

function usageNumbers(usage: Record<string, unknown> | null) {
  if (!usage) {
    return {
      prompt_tokens: null,
      completion_tokens: null,
      reasoning_tokens: null,
      total_tokens: null,
    };
  }
  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens ?? NaN);
  const completion = Number(usage.completion_tokens ?? usage.output_tokens ?? NaN);
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
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

async function streamOnce(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  error: string | null;
  status: number;
  latencyMs: number;
}> {
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
        // partial SSE frame
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

async function main() {
  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing("TRANSPORT_ABC_NOT_RUN");
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

  const fx = PROSE_DIET_FIXTURES.find((f) => f.id === FIXTURE_ID);
  if (!fx) throw new Error(`unknown fixture ${FIXTURE_ID}`);

  const variant = resolveBeardVariant("A");
  const characterSystemPrompt = PROSE_DIET_CHARACTER_SYSTEM_PROMPT.replace(
    /# 외형\n.*/,
    `# 외형\n${variant.appearance}`,
  );
  const longTermMemory =
    "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.";

  const models = MODELS.length ? MODELS : DEFAULT_MODELS;
  const index: Record<string, unknown>[] = [];
  const ownerMap = {
    visibleLengthTarget: "responseLength.ts — targetResponseChars + USER_TAIL_LENGTH_OWNER_SENTENCE",
    transportMaxTokens: "openRouterClient.resolveOpenRouterMaxTokens → buildOpenRouterRequestBody",
    cheaperInferenceAdapt: "cheaperInferenceConfig.adaptCheaperInferenceChatBody",
    gemini31Reasoning: "applyCheaperInferenceModelReasoningPolicy → reasoning_effort=low",
    deepSeekThinking: "applyCheaperInferenceDeepSeekTrueOffPolicy → thinking disabled + reasoning_effort none",
    streamLengthCap: "route.ts post-stream sanitize + needsVisibleLengthContinuation (no transport)",
    finalClamp: "responseLength billableOutputChars / isCatastrophicallyShortResponse",
  };
  write("owner-map.json", ownerMap);

  for (const modelId of models) {
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
        characterId: "transport-abc",
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
          JSON.stringify({ affection: 65, trust: 58, relationshipLabel: "오래된 지인" }),
        ),
      ),
      shortTermHistory: fx.shortTermHistory,
      currentUserMessage: fx.currentUserMessage,
      nsfw: false,
      gender: variant.gender,
      userPersonaGender: variant.personaGender,
      currentTurnAuthoringDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
      novelModeEnabled: false,
      targetResponseChars: 3200,
      completedTurns: 3,
      genres: ["현대/일상"],
      provider: "openrouter",
      modelId,
      contentKind: "character",
      narrativePov,
      sceneDirectiveBlock: renderSceneDirectiveForPrompt(directive),
      scenePacingPromptOwner: "legacy_v1",
    });

    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt ?? "",
      history: built.history,
      modelId,
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
          chatId: 1,
          currentTurn: 3,
          progressionHistory: [],
          canonicalSceneDirective: directive,
          skipMotionCue: false,
        },
      },
    });

    const baseBody = {
      ...(wire.requestBody as Record<string, unknown>),
      stream: true,
      stream_options: { include_usage: true },
    };
    const promptEquivalenceHash = sha256(stableBodyForCompare(baseBody));
    write(`${modelId}/prompt-equivalence-hash.txt`, promptEquivalenceHash);

    const headers = buildCheaperInferenceHeaders(apiKey);

    for (const arm of ARMS) {
      for (let rep = 1; rep <= REPS; rep++) {
        const body: Record<string, unknown> = { ...baseBody };
        delete body.max_completion_tokens;
        if (arm.max_tokens == null) {
          delete body.max_tokens;
        } else {
          body.max_tokens = arm.max_tokens;
        }

        const dir = `${modelId}/${arm.id}/r${rep}`;
        write(`${dir}/provider-request-body.json`, body);

        const result = await streamOnce(
          CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
          headers,
          body,
        );
        const visibleChars = visibleAssistantDisplayCharCount(result.text);
        const usage = usageNumbers(result.usage);
        const derivedVisibleTokens =
          usage.completion_tokens != null && usage.reasoning_tokens != null
            ? usage.completion_tokens - usage.reasoning_tokens
            : null;
        const upstream =
          result.usage &&
          (Number((result.usage as { upstream_cost_usd?: unknown }).upstream_cost_usd) ||
            Number((result.usage as { upstreamCostUsd?: unknown }).upstreamCostUsd));
        const costUsd =
          Number.isFinite(upstream) && upstream > 0
            ? upstream
            : usage.prompt_tokens != null && usage.completion_tokens != null
              ? openRouterUsdCostFromRates({
                  rates: resolveOpenRouterModelRates(modelId),
                  promptTokens: usage.prompt_tokens,
                  completionTokens: usage.completion_tokens,
                })
              : null;

        write(`${dir}/raw.txt`, result.text);
        const row = {
          modelId,
          fixture: FIXTURE_ID,
          arm: arm.id,
          max_tokens_sent: body.max_tokens ?? null,
          reasoning_effort: body.reasoning_effort ?? null,
          thinking: body.thinking ?? null,
          prompt_equivalence_hash: promptEquivalenceHash,
          visible_chars: visibleChars,
          stream_visible_chars: visibleChars,
          finish_reason: result.finish,
          latency_ms: result.latencyMs,
          http_status: result.status,
          error: result.error,
          ...usage,
          derived_visible_content_tokens: derivedVisibleTokens,
          cost_usd_est: costUsd,
        };
        write(`${dir}/meta.json`, row);
        index.push(row);
        console.log(
          `[${LABEL}] ${modelId} ${arm.id} r${rep} visible=${visibleChars} finish=${result.finish} completion=${usage.completion_tokens} reasoning=${usage.reasoning_tokens}`,
        );
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  write("INDEX.json", index);
  console.log(`wrote ${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
