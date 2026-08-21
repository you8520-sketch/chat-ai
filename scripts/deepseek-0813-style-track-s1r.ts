/**
 * Style Track S1R — true-off clean replication of S1.
 * Same Gemini 3.7 fixture and generic Source Mirror.
 * Experiment overlay only: thinking.disabled + reasoning_effort=none.
 * Production adaptCheaperInferenceChatBody is not changed.
 *
 *   node --conditions=react-server --import tsx scripts/deepseek-0813-style-track-s1r.ts
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { createHash, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  STYLE_TRACK_S1_GEMINI37_SOURCE_MODEL,
  STYLE_TRACK_S1_T1_RAW_PATH,
  STYLE_TRACK_S1_T2_USER,
} from "../src/lib/deepseekStyleTrackS1Fixture";
import {
  applyDeepSeek0813TrueOffExperimentOverlay,
  isDeepSeek0813TrueOffOutbound,
} from "../src/lib/deepseekStyleTrackS1rTransport";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT =
  process.env.OUT_ROOT ??
  "/opt/cursor/artifacts/deepseek-0813-style-track-s1r";
const DOC_OUT = "docs/audits/deepseek-0813-style-track-s1r";
const TARGET = "deepseek-v4-pro-0813";
const SAMPLES_PER_ARM = 2;
const S1_SOURCE_RAW_SHA =
  "4b6adc16eee5f577484bcb556ba5b9efc6157567907b2fd58ff596607735e124";

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

function saveBoth(name: string, content: string | object) {
  save(OUT, name, content);
  save(DOC_OUT, name, content);
}

function countParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p: string): boolean {
  return /["“”『』「」]/.test(p) || /^(?:[가-힣A-Za-z].{0,12})?[「『“"]/.test(p);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！?]|다\.|요\.|까\.|죠\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}

function styleMetrics(text: string) {
  const visible = text.replace(/\r/g, "");
  const chars = [...visible].length;
  const paragraphs = countParagraphs(visible);
  const paragraphLens = paragraphs.map((p) => [...p].length).sort((a, b) => a - b);
  const sentences = splitSentences(visible);
  const sentenceLens = sentences.map((s) => [...s].length).sort((a, b) => a - b);
  const dialogueParagraphs = paragraphs.filter(isDialogueParagraph);
  const oneSentenceParagraphs = paragraphs.filter((p) => splitSentences(p).length <= 1);
  const dialogueBlocks = (visible.match(/[「『“"][^」』”"]+[」』”"]/g) ?? []).length;
  return {
    visible_chars: chars,
    sentence_median: percentile(sentenceLens, 50),
    sentence_p75: percentile(sentenceLens, 75),
    paragraph_median: percentile(paragraphLens, 50),
    paragraph_p75: percentile(paragraphLens, 75),
    paragraphs_per_1000_chars: chars > 0 ? Math.round((paragraphs.length / chars) * 1000 * 1000) / 1000 : 0,
    one_sentence_paragraph_share:
      paragraphs.length > 0
        ? Math.round((oneSentenceParagraphs.length / paragraphs.length) * 1000) / 1000
        : 0,
    dialogue_share:
      paragraphs.length > 0
        ? Math.round((dialogueParagraphs.length / paragraphs.length) * 1000) / 1000
        : 0,
    dialogue_blocks_per_1000_chars:
      chars > 0 ? Math.round((dialogueBlocks / chars) * 1000 * 1000) / 1000 : 0,
    paragraph_count: paragraphs.length,
    sentence_count: sentences.length,
  };
}

function lateQuarter(text: string): string {
  const chars = [...text];
  if (chars.length === 0) return "";
  return chars.slice(Math.floor(chars.length * 0.75)).join("");
}

function koreanCharCount(text: string): number {
  return (text.match(/[\uac00-\ud7a3]/g) ?? []).length;
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
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
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

async function assembleArm(input: {
  lastAssistantRaw: string;
  arm: "baseline" | "challenger";
}) {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { assemblePrimaryRpRequest } = await import("../src/lib/openRouterAdult");
  const {
    styleTrackS1BuildInput,
    STYLE_TRACK_S1_CHAR_NAME,
    STYLE_TRACK_S1_PERSONA_NAME,
    STYLE_TRACK_S1_TARGET_MODEL,
  } = await import("../src/lib/deepseekStyleTrackS1Fixture");
  const { DEFAULT_TARGET_RESPONSE_CHARS } = await import(
    "../src/lib/responseLengthConstants"
  );

  const built = buildContext(
    styleTrackS1BuildInput({
      lastAssistantRaw: input.lastAssistantRaw,
      arm: input.arm,
    })
  );
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId: STYLE_TRACK_S1_TARGET_MODEL,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    messageOpts: {
      transportProvider: "cheaperinference",
      charName: STYLE_TRACK_S1_CHAR_NAME,
      personaName: STYLE_TRACK_S1_PERSONA_NAME,
    },
  });
  const productionBody = {
    ...(wire.requestBody as Record<string, unknown>),
    stream: true,
    stream_options: { include_usage: true },
  };
  const requestBody = applyDeepSeek0813TrueOffExperimentOverlay(productionBody);
  return {
    requestBody,
    productionBody,
    systemPrompt: built.systemPrompt,
    history: built.history,
    wire,
  };
}

function serializeHistory(history: ChatMsg[]): string {
  return JSON.stringify(history.map((m) => ({ role: m.role, content: m.content })));
}

function fullPrompt(system: string, history: ChatMsg[]): string {
  return `${system}\n${serializeHistory(history)}`;
}

function pickRevealLetters(): { cIsBaseline: boolean } {
  return { cIsBaseline: randomInt(2) === 0 };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync(DOC_OUT, { recursive: true });
  if (!existsSync(STYLE_TRACK_S1_T1_RAW_PATH)) {
    throw new Error("GEMINI37_FIXTURE_UNAVAILABLE");
  }
  const lastAssistant = readFileSync(STYLE_TRACK_S1_T1_RAW_PATH, "utf8");
  const sourceRawSha = sha256(lastAssistant);
  if (sourceRawSha !== S1_SOURCE_RAW_SHA) {
    throw new Error(`FIXTURE_SHA_DRIFT expected ${S1_SOURCE_RAW_SHA} got ${sourceRawSha}`);
  }

  saveBoth("FIXTURE_NOTES.json", {
    source_id: "gemini37",
    source_model: STYLE_TRACK_S1_GEMINI37_SOURCE_MODEL,
    last_assistant_path: STYLE_TRACK_S1_T1_RAW_PATH,
    last_assistant_sha256: sourceRawSha,
    current_user_semantic: STYLE_TRACK_S1_T2_USER,
    opus_calls: 0,
    gemini31_calls: 0,
    gemini37_source_model_calls: 0,
    old_s1_preserved: true,
    OLD_S1_TRANSPORT_CONTAMINATED_BY_REASONING: true,
    production_transport_changed: false,
  });

  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
    adaptCheaperInferenceChatBody,
  } = await import("../src/lib/cheaperInferenceConfig");
  const {
    DEEPSEEK_HANDOFF_SCENE_COMPLETION,
    HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR,
    countPromptOccurrences,
    stripDeepSeekAdultHandoffUserBlocks,
  } = await import("../src/lib/deepseekAdultHandoff");

  const productionStillDeletesEffort = adaptCheaperInferenceChatBody({
    model: TARGET,
    messages: [{ role: "user", content: "x" }],
    reasoning_effort: "none",
  });
  if (productionStillDeletesEffort.reasoning_effort != null) {
    throw new Error("PRODUCTION_ADAPTER_CHANGED");
  }

  const baselineAsm = await assembleArm({
    lastAssistantRaw: lastAssistant,
    arm: "baseline",
  });
  const challengerAsm = await assembleArm({
    lastAssistantRaw: lastAssistant,
    arm: "challenger",
  });
  const baselineHistory = (baselineAsm.history ?? []) as ChatMsg[];
  const challengerHistory = (challengerAsm.history ?? []) as ChatMsg[];
  const baselineUser = baselineHistory.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const challengerUser =
    challengerHistory.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const priorBaseline = serializeHistory(baselineHistory.slice(0, -1));
  const priorChallenger = serializeHistory(challengerHistory.slice(0, -1));

  const hashes = {
    SOURCE_ASSISTANT_RAW: sourceRawSha,
    SYSTEM_BASELINE: sha256(baselineAsm.systemPrompt),
    SYSTEM_CHALLENGER: sha256(challengerAsm.systemPrompt),
    HISTORY_BASELINE: sha256(priorBaseline),
    HISTORY_CHALLENGER: sha256(priorChallenger),
    CURRENT_USER_BASELINE: sha256(baselineUser),
    CURRENT_USER_CHALLENGER: sha256(challengerUser),
    FULL_PROMPT_BASELINE: sha256(fullPrompt(baselineAsm.systemPrompt, baselineHistory)),
    FULL_PROMPT_CHALLENGER: sha256(
      fullPrompt(challengerAsm.systemPrompt, challengerHistory)
    ),
  };
  const promptHaystack = `${baselineAsm.systemPrompt}\n${challengerAsm.systemPrompt}\n${baselineUser}\n${challengerUser}`;
  const promptAudit = {
    baseline: {
      style_mirror: countPromptOccurrences(
        baselineUser,
        HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR
      ),
      scene_completion: countPromptOccurrences(
        baselineUser,
        DEEPSEEK_HANDOFF_SCENE_COMPLETION
      ),
      system_style_mirror: countPromptOccurrences(
        baselineAsm.systemPrompt,
        HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR
      ),
      system_scene_completion: countPromptOccurrences(
        baselineAsm.systemPrompt,
        DEEPSEEK_HANDOFF_SCENE_COMPLETION
      ),
    },
    challenger: {
      style_mirror: countPromptOccurrences(
        challengerUser,
        HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR
      ),
      scene_completion: countPromptOccurrences(
        challengerUser,
        DEEPSEEK_HANDOFF_SCENE_COMPLETION
      ),
      system_style_mirror: countPromptOccurrences(
        challengerAsm.systemPrompt,
        HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR
      ),
      system_scene_completion: countPromptOccurrences(
        challengerAsm.systemPrompt,
        DEEPSEEK_HANDOFF_SCENE_COMPLETION
      ),
    },
    current_stage_boundary: countPromptOccurrences(promptHaystack, "CURRENT-STAGE BOUNDARY") +
      countPromptOccurrences(promptHaystack, "Current-Stage Boundary"),
    fingerprint: countPromptOccurrences(promptHaystack, "FINGERPRINT"),
  };
  if (
    hashes.SYSTEM_BASELINE !== hashes.SYSTEM_CHALLENGER ||
    hashes.HISTORY_BASELINE !== hashes.HISTORY_CHALLENGER ||
    stripDeepSeekAdultHandoffUserBlocks(challengerUser) !==
      stripDeepSeekAdultHandoffUserBlocks(baselineUser) ||
    hashes.CURRENT_USER_BASELINE === hashes.CURRENT_USER_CHALLENGER
  ) {
    throw new Error(`SHA_PARITY_FAIL: ${JSON.stringify({ hashes, promptAudit })}`);
  }
  if (
    promptAudit.baseline.style_mirror !== 0 ||
    promptAudit.baseline.scene_completion !== 0 ||
    promptAudit.challenger.style_mirror !== 1 ||
    promptAudit.challenger.scene_completion !== 0 ||
    promptAudit.baseline.system_style_mirror !== 0 ||
    promptAudit.challenger.system_style_mirror !== 0 ||
    promptAudit.current_stage_boundary !== 0 ||
    promptAudit.fingerprint !== 0
  ) {
    throw new Error(`PROMPT_AUDIT_FAIL: ${JSON.stringify(promptAudit)}`);
  }
  if (
    !isDeepSeek0813TrueOffOutbound(baselineAsm.requestBody) ||
    !isDeepSeek0813TrueOffOutbound(challengerAsm.requestBody)
  ) {
    throw new Error("TRUE_OFF_OVERLAY_FAIL");
  }
  const transportKey = (body: Record<string, unknown>) =>
    JSON.stringify({
      model: body.model,
      thinking: body.thinking ?? null,
      reasoning_effort: body.reasoning_effort ?? null,
      reasoning: body.reasoning ?? null,
      include_reasoning: body.include_reasoning ?? null,
      enable_thinking: body.enable_thinking ?? null,
      temperature: body.temperature ?? null,
      max_tokens: body.max_tokens ?? null,
    });
  if (transportKey(baselineAsm.requestBody) !== transportKey(challengerAsm.requestBody)) {
    throw new Error("TRANSPORT_PARITY_FAIL");
  }

  saveBoth("SHA_PARITY.json", {
    hashes,
    prompt_audit: promptAudit,
    speech_lock_in_system: /Speech Lock|말투 잠금/i.test(baselineAsm.systemPrompt),
    current_user_semantic: STYLE_TRACK_S1_T2_USER,
    true_off_outbound: {
      model: baselineAsm.requestBody.model,
      thinking: baselineAsm.requestBody.thinking,
      reasoning_effort: baselineAsm.requestBody.reasoning_effort,
      reasoning: baselineAsm.requestBody.reasoning ?? null,
      include_reasoning: baselineAsm.requestBody.include_reasoning ?? null,
      enable_thinking: baselineAsm.requestBody.enable_thinking ?? null,
      temperature: baselineAsm.requestBody.temperature ?? null,
    },
    production_body_still_omits_effort:
      baselineAsm.productionBody.reasoning_effort == null,
  });

  const { cIsBaseline } = pickRevealLetters();
  const labelFor = (arm: "baseline" | "challenger", n: number) => {
    const letter = arm === "baseline" ? (cIsBaseline ? "C" : "D") : cIsBaseline ? "D" : "C";
    return `SOURCE_G37_SAMPLE_${letter}${n}`;
  };
  const reveal = {
    note: "Separate from the blind packet. Do not read before scoring.",
    c_is_baseline: cIsBaseline,
    labels: {
      [labelFor("baseline", 1)]: { arm: "BASELINE", run: 1 },
      [labelFor("baseline", 2)]: { arm: "BASELINE", run: 2 },
      [labelFor("challenger", 1)]: { arm: "CHALLENGER", run: 1 },
      [labelFor("challenger", 2)]: { arm: "CHALLENGER", run: 2 },
    },
  };

  const calls: Record<string, unknown>[] = [];
  const styleTelemetry: Record<string, unknown>[] = [];
  const blindSections: string[] = [];
  let baselineCalls = 0;
  let mirrorCalls = 0;
  let trueOffQualityParity = true;

  blindSections.push("## Source: Gemini 3.7 Flash source\n");
  blindSections.push("### SOURCE_ASSISTANT_RAW\n");
  blindSections.push("```text\n" + lastAssistant.trimEnd() + "\n```\n");
  blindSections.push("### CURRENT_USER (semantic only)\n");
  blindSections.push("```text\n" + STYLE_TRACK_S1_T2_USER + "\n```\n");

  const arms: Array<"baseline" | "challenger"> = ["baseline", "challenger"];
  for (const arm of arms) {
    const assembled = arm === "baseline" ? baselineAsm : challengerAsm;
    for (let n = 1; n <= SAMPLES_PER_ARM; n += 1) {
      const dir = join(OUT, "live", "gemini37", arm, `run${n}`);
      const rawPath = join(dir, "provider-raw.txt");
      const blindLabel = labelFor(arm, n);
      if (existsSync(rawPath)) {
        throw new Error(`REFUSE_REUSE ${rawPath} — S1R must make new calls`);
      }
      console.log(`=== gemini37 ${arm} ${n}/${SAMPLES_PER_ARM} ===`);
      const resp = await streamProvider(
        CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
        buildCheaperInferenceHeaders(),
        assembled.requestBody
      );
      if (arm === "baseline") baselineCalls += 1;
      else mirrorCalls += 1;
      const usage = resp.usage ?? {};
      const details =
        (usage.completion_tokens_details as Record<string, unknown> | undefined) ?? {};
      const reasoningTokens =
        typeof details.reasoning_tokens === "number" ? details.reasoning_tokens : 0;
      const reasoningZero = resp.reasoning_events === 0 && resp.reasoning_chars === 0;
      if (!reasoningZero) trueOffQualityParity = false;
      const meta = {
        source_id: "gemini37",
        selected_source_model: STYLE_TRACK_S1_GEMINI37_SOURCE_MODEL,
        resolved_target: TARGET,
        response_model: resp.resolved_model,
        provider: "cheaperinference",
        arm,
        run: n,
        blind_label: blindLabel,
        http_status: resp.http_status,
        finish_reason: resp.finish_reason,
        stream_done: resp.saw_done,
        incomplete: resp.finish_reason != null && resp.finish_reason !== "stop",
        visible_chars: [...resp.text].length,
        korean_chars: koreanCharCount(resp.text),
        ttft_ms: resp.ttft_ms,
        latency_ms: resp.latency_ms,
        input_tokens:
          typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
        completion_tokens:
          typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
        reasoning_stream_events: resp.reasoning_events,
        reasoning_chars: resp.reasoning_chars,
        reasoning_tokens: reasoningTokens,
        usage_cost: typeof usage.cost === "number" ? usage.cost : null,
        terminal_usage: usage,
        TRUE_OFF_REQUESTED: true,
        TRUE_OFF_QUALITY_PARITY_SAMPLE: reasoningZero,
        request_wire: {
          model: assembled.requestBody.model,
          thinking: assembled.requestBody.thinking ?? null,
          reasoning_effort: assembled.requestBody.reasoning_effort ?? null,
          reasoning: assembled.requestBody.reasoning ?? null,
          include_reasoning: assembled.requestBody.include_reasoning ?? null,
          enable_thinking: assembled.requestBody.enable_thinking ?? null,
          temperature: assembled.requestBody.temperature ?? null,
        },
        prompt_audit: promptAudit[arm],
        last_assistant_sha256: hashes.SOURCE_ASSISTANT_RAW,
        raw_sha256: sha256(resp.text),
        error: resp.error,
      };
      save(dir, "provider-raw.txt", resp.text);
      save(dir, "meta.json", meta);
      save(dir, "request-body.json", {
        model: assembled.requestBody.model,
        thinking: assembled.requestBody.thinking,
        reasoning_effort: assembled.requestBody.reasoning_effort,
        reasoning: assembled.requestBody.reasoning ?? null,
        include_reasoning: assembled.requestBody.include_reasoning ?? null,
        enable_thinking: assembled.requestBody.enable_thinking ?? null,
        last_user: arm === "baseline" ? baselineUser : challengerUser,
      });
      save(DOC_OUT, `gemini37-${arm}-run${n}-raw.txt`, resp.text);
      calls.push(meta);
      styleTelemetry.push({
        source_id: "gemini37",
        arm,
        run: n,
        blind_label: blindLabel,
        ...styleMetrics(resp.text),
      });
      if (resp.http_status !== 200 || resp.error || !resp.text.trim()) {
        trueOffQualityParity = false;
      }
    }
  }

  const orderedLabels = [
    labelFor("baseline", 1),
    labelFor("baseline", 2),
    labelFor("challenger", 1),
    labelFor("challenger", 2),
  ].sort();
  for (const label of orderedLabels) {
    const mapping = reveal.labels[label];
    const raw = readFileSync(
      join(
        OUT,
        "live",
        "gemini37",
        mapping.arm === "BASELINE" ? "baseline" : "challenger",
        `run${mapping.run}`,
        "provider-raw.txt"
      ),
      "utf8"
    );
    blindSections.push(`### ${label}\n`);
    blindSections.push("```text\n" + raw.trimEnd() + "\n```\n");
    blindSections.push(`### ${label} LATE ~25%\n`);
    blindSections.push("```text\n" + lateQuarter(raw).trimEnd() + "\n```\n");
  }

  const packet = `# Style Track S1R — Blind Review Packet

Cursor must not score. ChatGPT only.
Old S1 A/B letters are not reused.

Score each labeled sample /5:

- PURE_PROSE_QUALITY
- SOURCE_STYLE_FIDELITY
- CHARACTER_IDENTITY
- SCENE_CONTINUITY
- PARAGRAPH_RHYTHM
- PROGRESSION
- LATE_SCENE_CHARACTER_VOICE

Record defects when present:

- SOURCE_STYLE_LOSS
- GENERIC_DEEPSEEK_RP_VOICE
- LATE_VOICE_DRIFT
- CHARACTER_PERSONALITY_INVENTION
- SPEECH_LOCK_DRIFT
- PARAGRAPH_FRAGMENTATION
- DIALOGUE_DENSITY_DRIFT
- CANON_INVENTION
- USER_AGENCY
- FOREIGN_SCRIPT_CONTAMINATION

Also inspect LATE ~25% of each candidate for LATE_VOICE_DRIFT.

Do not read REVEAL_MAP until scoring is finished.

${blindSections.join("\n")}
`;

  saveBoth("BLIND_REVIEW_PACKET.md", packet);
  save(OUT, "REVEAL_MAP.json", reveal);
  save(DOC_OUT, "REVEAL_MAP.json", reveal);
  saveBoth("STYLE_METRICS.json", {
    note: "QA telemetry only. Never injected into the model prompt. Contains arm labels — do not read before scoring.",
    samples: styleTelemetry,
  });

  const reasoningEvents = calls.map((c) => c.reasoning_stream_events);
  const reasoningChars = calls.map((c) => c.reasoning_chars);
  const summary = {
    status: "DEEPSEEK0813_STYLE_TRACK_S1R_TRUE_OFF_CAPTURE_COMPLETE",
    target: TARGET,
    provider: "cheaperinference",
    TRUE_OFF_CONFIG: 'thinking={type:"disabled"} + reasoning_effort="none"',
    OLD_S1_TRANSPORT_CONTAMINATED_BY_REASONING: true,
    completion_owner: false,
    current_stage_boundary: false,
    source_mirror_baseline: false,
    source_mirror_challenger: true,
    source_mirror_production: false,
    production_transport_changed: false,
    baseline_calls: baselineCalls,
    mirror_calls: mirrorCalls,
    total_new_calls: baselineCalls + mirrorCalls,
    opus_calls: 0,
    gemini31_calls: 0,
    gemini37_source_model_calls: 0,
    other_model_calls: 0,
    REASONING_EVENTS: reasoningEvents,
    REASONING_CHARS: reasoningChars,
    TRUE_OFF_QUALITY_PARITY: trueOffQualityParity,
    quality_scoring_by_cursor: false,
    calls,
  };
  saveBoth("SUMMARY.json", summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!trueOffQualityParity) {
    console.error("TRUE_OFF_QUALITY_PARITY=false — hidden reasoning appeared. Samples preserved. STOP.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
