/**
 * Experiment A — DeepSeek 0813 vanilla handoff + SCENE COMPLETION only.
 * SOURCE MIRROR = 0. Does not call source models. Does not invent fixtures.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/deepseek-0813-completion-experiment-a";
const TARGET = "deepseek-v4-pro-0813";
const SAMPLES_PER_SOURCE = 3;

const FROZEN_OPUS_LAST =
  "/opt/cursor/artifacts/opus-instruction-boundary/live/s5_relationship_hand/arm-E/run1/turn2-provider-raw.txt";
const FROZEN_GEMINI_LAST =
  "/opt/cursor/artifacts/gemini31-opus5-minimal-screen/gemini31/relationship/run1/turn2-provider-raw.txt";
const COMMITTED_GEMINI_LAST =
  "docs/audits/gemini-37-flash-word-count-owner-e/S3-A-raw.txt";

const ADULT_ENTRY_USER_TURN =
  "*그의 손이 내 허리를 감싸 안는다. 눈이 마주치고 거리가 사라진다.* \n\n“이대로 있어도 돼?”\n\n*곁에서 숨소리가 가까워진다. 더 가까이 닿아도 좋다는 허락이 눈빛에 묻어 있다.*";

type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

type SourceSpec = {
  id: "opus" | "gemini";
  label: string;
  charName: string;
  lastAssistantPath: string;
  lastAssistantProvenance: string;
  priorUser: string;
  currentUser: string;
};

function sha256(t: string): string {
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

function resolveSources(): { sources: SourceSpec[]; notes: string[] } {
  const notes: string[] = [];
  const sources: SourceSpec[] = [];
  const opusPath = existsSync(FROZEN_OPUS_LAST)
    ? FROZEN_OPUS_LAST
    : null;
  if (opusPath) {
    sources.push({
      id: "opus",
      label: "Claude Opus 5 (frozen Arm E)",
      charName: "카스펜",
      lastAssistantPath: opusPath,
      lastAssistantProvenance: "frozen:opus-instruction-boundary/arm-E/turn2",
      priorUser: "…알겠어요. 그다음에 어떻게 하면 좋을지 말해 주세요.",
      currentUser: ADULT_ENTRY_USER_TURN,
    });
  } else {
    notes.push(
      "OPUS_FROZEN_FIXTURE_MISSING: " +
        FROZEN_OPUS_LAST +
        " — no committed Opus last-assistant RAW; Opus challenger calls skipped (fake fixture forbidden)."
    );
  }

  const geminiPath = existsSync(FROZEN_GEMINI_LAST)
    ? FROZEN_GEMINI_LAST
    : existsSync(COMMITTED_GEMINI_LAST)
      ? COMMITTED_GEMINI_LAST
      : null;
  if (geminiPath) {
    sources.push({
      id: "gemini",
      label:
        geminiPath === FROZEN_GEMINI_LAST
          ? "Gemini 3.1 Pro (frozen relationship)"
          : "Gemini 3.7 Flash (committed S3-A)",
      charName: "조태형",
      lastAssistantPath: geminiPath,
      lastAssistantProvenance:
        geminiPath === FROZEN_GEMINI_LAST
          ? "frozen:gemini31-opus5-minimal-screen/relationship/turn2"
          : "committed:docs/audits/gemini-37-flash-word-count-owner-e/S3-A-raw.txt",
      priorUser: "*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.",
      currentUser: ADULT_ENTRY_USER_TURN,
    });
    if (geminiPath !== FROZEN_GEMINI_LAST) {
      notes.push(
        "GEMINI_FROZEN_HANDOFF_FIXTURE_MISSING: reused committed Gemini 3.7 Flash S3-A RAW as last visible canonical assistant."
      );
    }
  } else {
    notes.push("GEMINI_SOURCE_RAW_MISSING");
  }
  return { sources, notes };
}

type StreamState = {
  text: string;
  finish: string | null;
  usage: Record<string, unknown> | null;
  resolved: string | null;
  sawDone: boolean;
  reasoningChars: number;
  reasoningEvents: number;
  firstVisibleAt: number | null;
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
  const choice0 = choices?.[0];
  const delta = choice0?.delta as Record<string, unknown> | undefined;
  const message = choice0?.message as Record<string, unknown> | undefined;
  const content =
    typeof delta?.content === "string"
      ? delta.content
      : typeof message?.content === "string"
        ? String(message.content)
        : "";
  if (content) {
    if (state.firstVisibleAt == null) state.firstVisibleAt = Date.now();
    state.text += content;
  }
  const reasoning =
    (typeof delta?.reasoning === "string" && delta.reasoning) ||
    (typeof delta?.reasoning_content === "string" && delta.reasoning_content) ||
    "";
  if (reasoning) {
    state.reasoningEvents += 1;
    state.reasoningChars += reasoning.length;
  }
  if (typeof choice0?.finish_reason === "string" && choice0.finish_reason) {
    state.finish = choice0.finish_reason;
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
  const state: StreamState = {
    text: "",
    finish: null,
    usage: null,
    resolved: null,
    sawDone: false,
    reasoningChars: 0,
    reasoningEvents: 0,
    firstVisibleAt: null,
  };
  try {
    const { Agent } = await import("undici");
    const dispatcher = new Agent({
      headersTimeout: 10 * 60_000,
      bodyTimeout: 0,
      connectTimeout: 60_000,
    });
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      // @ts-expect-error Node fetch undici dispatcher
      dispatcher,
    });
    if (!res.ok) {
      return {
        text: "",
        http_status: res.status,
        error: (await res.text()).slice(0, 2000),
        latency_ms: Date.now() - started,
        ttft_ms: null as number | null,
        finish_reason: null as string | null,
        usage: null as Record<string, unknown> | null,
        resolved_model: null as string | null,
        saw_done: false,
        reasoning_events: 0,
        reasoning_chars: 0,
      };
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) processSseLine(line, state);
    }
    if (buf.trim()) processSseLine(buf, state);
    return {
      text: state.text,
      http_status: 200,
      error: null as string | null,
      latency_ms: Date.now() - started,
      ttft_ms:
        state.firstVisibleAt == null ? null : state.firstVisibleAt - started,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      reasoning_events: state.reasoningEvents,
      reasoning_chars: state.reasoningChars,
    };
  } catch (e) {
    return {
      text: state.text,
      http_status: 0,
      error: String(e),
      latency_ms: Date.now() - started,
      ttft_ms:
        state.firstVisibleAt == null ? null : state.firstVisibleAt - started,
      finish_reason: state.finish,
      usage: state.usage,
      resolved_model: state.resolved,
      saw_done: state.sawDone,
      reasoning_events: state.reasoningEvents,
      reasoning_chars: state.reasoningChars,
    };
  }
}

async function assembleChallenger(input: {
  source: SourceSpec;
  lastAssistant: string;
}) {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { appendAdultHandoffPrompt, buildSceneContinuityPacket } = await import(
    "../src/lib/adultSceneRouting"
  );
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const { resolveNarrativePov } = await import("../src/lib/narrativePov");
  const { DEEPSEEK_ADULT_HANDOFF_EXPERIMENT_A } = await import(
    "../src/lib/deepseekAdultHandoff"
  );
  const { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );

  const narrativePov = resolveNarrativePov({
    mode: "third_person",
    contentKind: "character",
    mainCharacterName: input.source.charName,
  });
  const built = buildContext({
    charName: input.source.charName,
    chunks: [
      {
        id: "identity-0",
        characterId: "exp-a",
        content: `[Identity]\n${input.source.charName}`,
        category: "identity",
        importance: "CRITICAL",
        tokenCount: 8,
        keywords: [input.source.charName],
      },
    ],
    userNickname: "렌",
    shortTermHistory: [
      { role: "user", content: input.source.priorUser },
      { role: "assistant", content: input.lastAssistant },
    ],
    currentUserMessage: input.source.currentUser,
    nsfw: true,
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    provider: "cheaperinference",
    personaDisplayName: "렌",
    targetResponseChars: 3200,
    completedTurns: 1,
    contentKind: "character",
    narrativePov,
    preserveAdultHandoffRawHistory: true,
    deepSeekAdultHandoff: { ...DEEPSEEK_ADULT_HANDOFF_EXPERIMENT_A },
  });
  const continuityPacket = buildSceneContinuityPacket({
    previousSceneMode: "romantic",
    sexualContextActive: true,
    activeConsentMode: "standard",
    charactersPresent: [input.source.charName, "렌"],
    currentPov: narrativePov.mode,
  });
  const systemPrompt = appendAdultHandoffPrompt(
    built.systemPrompt,
    continuityPacket,
    {
      sourceModelId:
        input.source.id === "opus" ? "claude-opus-5" : "gemini-3.7-flash",
      adultTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    }
  );
  const wire = assemblePrimaryRpRequest({
    system: systemPrompt,
    history: built.history ?? [],
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    targetResponseChars: 3200,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: input.source.charName,
      personaName: "렌",
    },
  });
  const requestBody = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  return { requestBody, systemPrompt, history: built.history, wire };
}

function koreanCharCount(text: string): number {
  return (text.match(/[\uac00-\ud7a3]/g) ?? []).length;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { sources, notes } = resolveSources();
  save(OUT, "FIXTURE_NOTES.json", { notes, sources: sources.map((s) => ({
    id: s.id,
    lastAssistantPath: s.lastAssistantPath,
    lastAssistantProvenance: s.lastAssistantProvenance,
  })) });

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
  } = await import("../src/lib/cheaperInferenceConfig");
  const {
    DEEPSEEK_HANDOFF_SCENE_COMPLETION,
    HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR,
    countPromptOccurrences,
  } = await import("../src/lib/deepseekAdultHandoff");

  const calls: Record<string, unknown>[] = [];
  let opusNew = 0;
  let geminiNew = 0;

  for (const source of sources) {
    const lastAssistant = readFileSync(source.lastAssistantPath, "utf8");
    const assembled = await assembleChallenger({ source, lastAssistant });
    const lastUser =
      (assembled.history ?? []).filter((m) => m.role === "user").at(-1)
        ?.content ?? "";
    const promptAudit = {
      scene_completion: countPromptOccurrences(
        lastUser,
        DEEPSEEK_HANDOFF_SCENE_COMPLETION
      ),
      style_mirror: countPromptOccurrences(
        lastUser,
        HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR
      ),
      system_scene_completion: countPromptOccurrences(
        assembled.systemPrompt,
        DEEPSEEK_HANDOFF_SCENE_COMPLETION
      ),
      system_style_mirror: countPromptOccurrences(
        assembled.systemPrompt,
        HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR
      ),
    };
    if (promptAudit.scene_completion !== 1 || promptAudit.style_mirror !== 0) {
      throw new Error(`PROMPT_AUDIT_FAIL ${source.id}: ${JSON.stringify(promptAudit)}`);
    }

    const requestWire = assembled.wire.requestBody as Record<string, unknown>;
    const trueOffRequested =
      JSON.stringify(requestWire.thinking) === JSON.stringify({ type: "disabled" }) &&
      requestWire.reasoning_effort == null &&
      requestWire.reasoning == null &&
      requestWire.include_reasoning == null;

    for (let n = 1; n <= SAMPLES_PER_SOURCE; n += 1) {
      const dir = join(OUT, "live", source.id, `run${n}`);
      const rawPath = join(dir, "provider-raw.txt");
      if (existsSync(rawPath)) {
        const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
        calls.push({ ...meta, reused: true });
        continue;
      }
      console.log(`=== ${source.id} challenger ${n}/${SAMPLES_PER_SOURCE} ===`);
      const resp = await streamProvider(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        buildCheaperInferenceHeaders(),
        assembled.requestBody
      );
      if (source.id === "opus") opusNew += 1;
      else geminiNew += 1;

      const usage = resp.usage ?? {};
      const details =
        (usage.completion_tokens_details as Record<string, unknown> | undefined) ??
        {};
      const promptDetails =
        (usage.prompt_tokens_details as Record<string, unknown> | undefined) ??
        {};
      const reasoningTokens =
        typeof details.reasoning_tokens === "number"
          ? details.reasoning_tokens
          : 0;
      const meta = {
        source_id: source.id,
        source_label: source.label,
        selected_source_model:
          source.id === "opus" ? "claude-opus-5" : "gemini-3.7-flash",
        resolved_target: TARGET,
        response_model: resp.resolved_model,
        provider: "cheaperinference",
        http_status: resp.http_status,
        finish_reason: resp.finish_reason,
        stream_done: resp.saw_done,
        incomplete: resp.finish_reason != null && resp.finish_reason !== "stop",
        visible_chars: resp.text.length,
        korean_chars: koreanCharCount(resp.text),
        ttft_ms: resp.ttft_ms,
        latency_ms: resp.latency_ms,
        input_tokens:
          typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
        cache_read:
          typeof promptDetails.cached_tokens === "number"
            ? promptDetails.cached_tokens
            : null,
        completion_tokens:
          typeof usage.completion_tokens === "number"
            ? usage.completion_tokens
            : null,
        reasoning_stream_events: resp.reasoning_events,
        reasoning_chars: resp.reasoning_chars,
        reasoning_tokens: reasoningTokens,
        usage_cost: typeof usage.cost === "number" ? usage.cost : null,
        terminal_usage: usage,
        TRUE_OFF_REQUESTED: trueOffRequested,
        REASONING_ACTUALLY_ZERO:
          resp.reasoning_events === 0 &&
          resp.reasoning_chars === 0 &&
          reasoningTokens === 0,
        request_wire: {
          model: requestWire.model,
          thinking: requestWire.thinking ?? null,
          reasoning_effort: requestWire.reasoning_effort ?? null,
          reasoning: requestWire.reasoning ?? null,
          include_reasoning: requestWire.include_reasoning ?? null,
        },
        prompt_audit: promptAudit,
        last_assistant_sha256: sha256(lastAssistant),
        last_assistant_provenance: source.lastAssistantProvenance,
        raw_sha256: sha256(resp.text),
        error: resp.error,
      };
      save(dir, "provider-raw.txt", resp.text);
      save(dir, "meta.json", meta);
      save(dir, "request-body.json", {
        model: requestWire.model,
        thinking: requestWire.thinking,
        reasoning_effort: requestWire.reasoning_effort ?? null,
        reasoning: requestWire.reasoning ?? null,
        include_reasoning: requestWire.include_reasoning ?? null,
        last_user: lastUser,
      });
      calls.push(meta);
      if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
        throw new Error(
          `CALL_FAIL ${source.id}/run${n}: ${resp.error ?? resp.http_status}`
        );
      }
    }
  }

  const summary = {
    status: "DEEPSEEK0813_COMPLETION_OWNER_CAPTURE_COMPLETE",
    notes,
    opus_new_calls: opusNew,
    gemini_new_calls: geminiNew,
    total_new_calls: opusNew + geminiNew,
    other_model_calls: 0,
    source_mirror: false,
    calls,
  };
  save(OUT, "SUMMARY.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
