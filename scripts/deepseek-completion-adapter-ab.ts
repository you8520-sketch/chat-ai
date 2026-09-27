/**
 * DeepSeek V4 Pro — thin completion adapter A/B (quiet gate first).
 *
 * Control A: production wire (SNPV2_DEEPSEEK_LENGTH_ARM unset → no adapter)
 * Candidate B: SNPV2_DEEPSEEK_LENGTH_ARM=B → [DEEPSEEK COMPLETION]
 *
 * Transport: max_tokens omitted, thinking TRUE-OFF (production adapt).
 * Gemini out of scope.
 *
 *   FIXTURE=quiet_intimacy REPS=5 npx tsx scripts/deepseek-completion-adapter-ab.ts
 *   FIXTURE=casual_banter REPS=3 ...
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
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "../src/lib/chatModels";
import {
  SNPV2_DEEPSEEK_LENGTH_ARM_ENV,
  buildDeepSeekCompletionAdapterBlock,
} from "../src/lib/sharedNovelProseModelAdapters";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const LABEL = process.env.LABEL?.trim() || "deepseek-completion-ab";
const OUT_ROOT = path.join("/opt/cursor/artifacts", LABEL);
const REPS = Math.max(1, Math.min(8, Number(process.env.REPS ?? 5) || 5));
const FIXTURE_ID = process.env.FIXTURE?.trim() || "quiet_intimacy";
const MODEL = process.env.MODEL?.trim() || CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;
const ARMS = (process.env.ARMS ?? "A,B")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter((a): a is "A" | "B" => a === "A" || a === "B");

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

/** Lightweight occurrence annotations (no quality score). */
function annotate(text: string) {
  const lower = text;
  return {
    chars: [...text].length,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim()).length,
    dialogue_blocks: (text.match(/"[^"]+"/g) ?? []).length,
    // Heuristic flags for review — counts only.
    npc_intro_hits: (lower.match(/(?:낯선|모르는|옆(?:자리|테이블)|웨이터|손님|형사|경찰)/g) ?? [])
      .length,
    emotion_explain_hits: (lower.match(/(?:라는 뜻|의미였|느꼈기 때문|때문이었다)/g) ?? [])
      .length,
    micro_action_hits: (lower.match(/(?:손가락을|입꼬리|눈동자|숨을\s*(?:고르|삼키))/g) ?? [])
      .length,
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

async function main() {
  const apiKey = exitIfBenchmarkCheaperInferenceApiKeyMissing("DS_COMPLETION_AB_NOT_RUN");
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
  const { USER_TAIL_LENGTH_OWNER_SENTENCE } = await import("../src/lib/responseLength");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const fx = PROSE_DIET_FIXTURES.find((f) => f.id === FIXTURE_ID);
  if (!fx) throw new Error(`unknown fixture ${FIXTURE_ID}`);

  const variant = resolveBeardVariant("A");
  const characterSystemPrompt = PROSE_DIET_CHARACTER_SYSTEM_PROMPT.replace(
    /# 외형\n.*/,
    `# 외형\n${variant.appearance}`,
  );
  const longTermMemory =
    "3년 전 실종 사건 이후 서로를 더 자주 확인한다. 최근 도심 골목에서 이상한 그림자를 목격했다.";
  const candidateBlock = buildDeepSeekCompletionAdapterBlock();
  const candidateTok = estimateTokens(candidateBlock);

  write("owner-map.json", {
    visibleLengthTarget: "responseLength.ts USER_TAIL_LENGTH_OWNER_SENTENCE",
    deepSeekCompletionCandidate:
      "sharedNovelProseModelAdapters.buildDeepSeekCompletionAdapterBlock via SNPV2_DEEPSEEK_LENGTH_ARM=B",
    injectionSlot: "contextBuilder rule-deepseek-length-adapter (existing experiment slot)",
    transport: "resolveOpenRouterMaxTokens → omitted",
    thinking: "applyCheaperInferenceDeepSeekTrueOffPolicy",
    commonProse: "unchanged",
    candidate_token_est: candidateTok,
  });
  write("candidate-b.txt", candidateBlock);

  const index: Record<string, unknown>[] = [];
  const headers = buildCheaperInferenceHeaders(apiKey);

  for (const arm of ARMS) {
    if (arm === "A") delete process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV];
    else process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV] = "B";

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
        characterId: "ds-completion-ab",
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

    const body: Record<string, unknown> = {
      ...(wire.requestBody as Record<string, unknown>),
      stream: true,
      stream_options: { include_usage: true },
    };
    delete body.max_tokens;
    delete body.max_completion_tokens;

    const system = flatContent(
      (body.messages as Array<{ role: string; content: unknown }>).find(
        (m) => m.role === "system",
      )?.content,
    );
    const lastUser = flatContent(
      [...(body.messages as Array<{ role: string; content: unknown }>)]
        .reverse()
        .find((m) => m.role === "user")?.content,
    );
    const adapterCount = (system.match(/\[DEEPSEEK COMPLETION\]/g) ?? []).length;
    const userTailCount = (lastUser.match(
      new RegExp(
        USER_TAIL_LENGTH_OWNER_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "g",
      ),
    ) ?? []).length;
    const promptHash = sha256(JSON.stringify(body.messages));

    write(`${FIXTURE_ID}/${arm}/prompt-hash.txt`, promptHash);
    write(`${FIXTURE_ID}/${arm}/system-snippet-adapter.txt`, system.includes("[DEEPSEEK COMPLETION]")
      ? system.slice(
          system.indexOf("[DEEPSEEK COMPLETION]"),
          system.indexOf("[DEEPSEEK COMPLETION]") + candidateBlock.length + 40,
        )
      : "(absent)");

    for (let rep = 1; rep <= REPS; rep++) {
      const dir = `${FIXTURE_ID}/${arm}/r${rep}`;
      write(`${dir}/provider-request-body.json`, {
        ...body,
        messages: "[omitted — see prompt-hash; messages identical within arm]",
        max_tokens: body.max_tokens ?? null,
        reasoning_effort: body.reasoning_effort ?? null,
        thinking: body.thinking ?? null,
      });
      write(`${dir}/messages-hash.txt`, promptHash);

      const result = await streamOnce(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        headers,
        body,
      );
      const visibleChars = visibleAssistantDisplayCharCount(result.text);
      const usage = usageNumbers(result.usage);
      const upstream =
        result.usage &&
        (Number((result.usage as { upstream_cost_usd?: unknown }).upstream_cost_usd) ||
          Number((result.usage as { upstreamCostUsd?: unknown }).upstreamCostUsd));
      const costUsd =
        Number.isFinite(upstream) && upstream! > 0
          ? upstream
          : usage.prompt_tokens != null && usage.completion_tokens != null
            ? openRouterUsdCostFromRates({
                rates: resolveOpenRouterModelRates(MODEL),
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
              })
            : null;

      write(`${dir}/raw.txt`, result.text);
      const row = {
        modelId: MODEL,
        fixture: FIXTURE_ID,
        arm,
        adapter_present: adapterCount > 0,
        adapter_count: adapterCount,
        user_tail_owner_count: userTailCount,
        prompt_hash: promptHash,
        max_tokens_sent: body.max_tokens ?? null,
        reasoning_effort: body.reasoning_effort ?? null,
        thinking: body.thinking ?? null,
        visible_chars: visibleChars,
        finish_reason: result.finish,
        latency_ms: result.latencyMs,
        http_status: result.status,
        error: result.error,
        cost_usd_est: costUsd,
        candidate_token_delta_est: arm === "B" ? candidateTok : 0,
        annotations: annotate(result.text),
        ...usage,
      };
      write(`${dir}/meta.json`, row);
      index.push(row);
      console.log(
        `[${LABEL}] ${arm} r${rep} visible=${visibleChars} finish=${result.finish} completion=${usage.completion_tokens} adapter=${adapterCount}`,
      );
      await new Promise((r) => setTimeout(r, 3500));
    }
  }

  write("INDEX.json", index);
  console.log(`wrote ${OUT_ROOT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
