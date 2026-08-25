#!/usr/bin/env npx tsx
/**
 * GLM-5.3 pure handoff candidate — ONE OpenRouter call after assembly gate.
 * Evidence-only benchmark. No production routing changes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";
import { detectModelRefusal } from "../../../../src/lib/adultSceneRouting";
import { parseOpenRouterUsage } from "../../../../src/lib/openRouterUsage";
import {
  alarmCandidates,
  attributeDialogueInResponse,
  detectT2ReplayCandidate,
  objectiveMetrics,
  PRIMARY_MEDIAN_VISIBLE_CHARS,
  T3_GEMINI_GOLD_VISIBLE_CHARS,
} from "./lib/audit-metrics";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = join(ROOT, "docs/audits/glm53-pure-handoff-candidate");
const FROZEN = join(OUT, "source-frozen");
const REF = join(FROZEN, "reference");
const GLM_MODEL = "z-ai/glm-5.3";

function sha256Object(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj), "utf8").digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function save(rel: string, content: string | object) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function streamContentToText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(streamContentToText).join("");
  if (typeof content === "object") {
    const o = content as { text?: unknown; content?: unknown };
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
    if (o.content != null) return streamContentToText(o.content);
  }
  return "";
}

function extractOpenRouterStreamDelta(choice: {
  delta?: { content?: string | unknown[] | null; text?: string | null };
  message?: { content?: string | unknown[] | null };
  text?: string | null;
}): string {
  const delta = choice.delta;
  if (delta?.content != null) {
    const fromContent = streamContentToText(delta.content);
    if (fromContent) return fromContent;
  }
  if (delta?.text) return delta.text;
  if (choice.message?.content != null) {
    const fromMessage = streamContentToText(choice.message.content);
    if (fromMessage) return fromMessage;
  }
  if (choice.text) return choice.text;
  return "";
}

async function consumeProductionStream(res: Response, startedMs: number) {
  if (!res.body) {
    return {
      rawText: "",
      finishReason: null as string | null,
      usage: null as unknown,
      sawDone: false,
      httpStatus: res.status,
      ttftMs: null as number | null,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let finishReason: string | null = null;
  let usage: unknown = null;
  let sawDone = false;
  let ttftMs: number | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          sawDone = true;
          continue;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: {
              delta?: { content?: string | null; text?: string | null };
              message?: { content?: string | null };
              text?: string | null;
              finish_reason?: string | null;
            }[];
            usage?: unknown;
          };
          const choice = json.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = choice ? extractOpenRouterStreamDelta(choice) : "";
          if (delta) {
            if (ttftMs == null) ttftMs = Date.now() - startedMs;
            rawText += delta;
          }
          if (json.usage) usage = json.usage;
        } catch {
          /* incomplete JSON */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { rawText, finishReason, usage, sawDone, httpStatus: res.status, ttftMs };
}

function readUsageSummary(path: string) {
  try {
    const u = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return {
      input_tokens: u.prompt_tokens ?? u.input_tokens ?? null,
      output_tokens: u.completion_tokens ?? u.output_tokens ?? null,
      reasoning_tokens:
        (u.completion_tokens_details as { reasoning_tokens?: number } | undefined)
          ?.reasoning_tokens ?? u.reasoning_tokens ?? null,
      cost: u.cost ?? null,
      upstream_cost:
        (u.cost_details as { upstream_inference_cost?: number } | undefined)
          ?.upstream_inference_cost ?? null,
    };
  } catch {
    return {
      input_tokens: null,
      output_tokens: null,
      reasoning_tokens: null,
      cost: null,
      upstream_cost: null,
    };
  }
}

function buildComparisonRow(
  label: string,
  text: string,
  extras?: Record<string, unknown> & { skipT2Replay?: boolean }
) {
  const m = objectiveMetrics(text);
  const t3User = readFileSync(join(FROZEN, "T3-USER_RAW.txt"), "utf8");
  const dialogue = attributeDialogueInResponse({
    responseText: text,
    userRaw: t3User,
    personaName: "렌",
    characterNames: ["라이크", "태형"],
  });
  let t2ReplayTopicIds: string[] | null = null;
  if (!extras?.skipT2Replay) {
    const t2Visible = readFileSync(join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
    const t2User = readFileSync(join(FROZEN, "T2-USER_RAW.txt"), "utf8");
    const t2Replay = detectT2ReplayCandidate({
      responseText: text,
      t2AssistantVisible: t2Visible,
      t2UserRaw: t2User,
    });
    t2ReplayTopicIds = t2Replay.replay_topic_ids;
  }
  const { skipT2Replay: _skip, ...restExtras } = extras ?? {};
  return {
    label,
    ...m,
    SOURCE_USER_QUOTED_DIALOGUE_COUNT: dialogue.SOURCE_USER_QUOTED_DIALOGUE_COUNT,
    T2_REPLAY_TOPIC_IDS: t2ReplayTopicIds,
    ...restExtras,
  };
}

function buildReport(input: {
  assembly: Record<string, unknown>;
  validity: Record<string, unknown>;
  metrics: Record<string, unknown>;
  refusal: Record<string, unknown>;
  comparison: Record<string, unknown>[];
  requestSha: string;
  rawSha: string;
}) {
  const { assembly, validity, refusal } = input;
  const lines: string[] = [
    "# Issue 2 — GLM-5.3 pure handoff candidate benchmark",
    "",
    "Evidence-only. **No production code changes.** No production routing. No GLM style adapter.",
    "",
    "## Assembly audit (pre-call gate)",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| MODEL | \`${input.assembly.MODEL}\` |`,
    `| PROVIDER | ${input.assembly.PROVIDER} |`,
    `| MESSAGE_COUNT | ${input.assembly.MESSAGE_COUNT} |`,
    `| REQUEST_SHA | \`${input.requestSha}\` |`,
    `| T1_ASSISTANT_BYTE_IDENTICAL | ${input.assembly.T1_ASSISTANT_BYTE_IDENTICAL} |`,
    `| T2_ASSISTANT_BYTE_IDENTICAL | ${input.assembly.T2_ASSISTANT_BYTE_IDENTICAL} |`,
    `| GEMINI_GOLD_PRESENT | ${input.assembly.GEMINI_GOLD_PRESENT} |`,
    `| GEMINI_REFUSAL_PRESENT | ${input.assembly.GEMINI_REFUSAL_PRESENT} |`,
    `| DEEPSEEK_STYLE_REMINDER_PRESENT | ${input.assembly.DEEPSEEK_STYLE_REMINDER_PRESENT} |`,
    `| DEEPSEEK_XML_PRESENT | ${input.assembly.DEEPSEEK_XML_PRESENT} |`,
    `| DEEPSEEK_OPENING_REMAP_PRESENT | ${input.assembly.DEEPSEEK_OPENING_REMAP_PRESENT} |`,
    `| GLM_SPECIFIC_STYLE_ADAPTER_PRESENT | ${input.assembly.GLM_SPECIFIC_STYLE_ADAPTER_PRESENT} |`,
    `| HANDOFF_CONTINUATION_INSTRUCTION_COUNT | ${input.assembly.HANDOFF_CONTINUATION_INSTRUCTION_COUNT} |`,
    `| USER_TAIL_3200_OWNER_COUNT | ${input.assembly.USER_TAIL_3200_OWNER_COUNT} |`,
    `| TERMINAL_DIALOGUE_OWNER_ACTIVE | ${input.assembly.TERMINAL_DIALOGUE_OWNER_ACTIVE} |`,
    `| USER_AGENCY_OWNER_ACTIVE | ${input.assembly.USER_AGENCY_OWNER_ACTIVE} |`,
    `| ACTIVE_CONSENT_MODE | ${input.assembly.ACTIVE_CONSENT_MODE} |`,
    `| CNC_PERMISSION_ON_WIRE | ${input.assembly.CNC_PERMISSION_ON_WIRE} |`,
    "",
    "Corpus: frozen #620/#625 (라이크 / 렌). T1/T2 Gemini assistant exemplars byte-identical. Gemini T3 Gold absent from input.",
    "",
    "## Provider call (exactly one)",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| TOTAL_PROVIDER_CALLS | ${validity.TOTAL_PROVIDER_CALLS ?? 1} |`,
    `| HTTP_STATUS | ${validity.HTTP_STATUS} |`,
    `| FINISH_REASON | ${validity.FINISH_REASON} |`,
    `| USAGE_PRESENT | ${validity.USAGE_PRESENT} |`,
    `| VISIBLE_CHARS | ${validity.VISIBLE_CHARS} |`,
    `| ENDS_COMPLETE_SENTENCE | ${validity.ENDS_COMPLETE_SENTENCE} |`,
    `| REASONING_TOKENS | ${validity.REASONING_TOKENS} |`,
    `| OUTPUT_TOKENS | ${validity.OUTPUT_TOKENS} |`,
    `| INPUT_TOKENS | ${validity.INPUT_TOKENS} |`,
    `| TTFT_MS | ${validity.TTFT_MS} |`,
    `| TOTAL_LATENCY_MS | ${validity.TOTAL_LATENCY_MS} |`,
    `| COST | ${validity.COST} |`,
    `| UPSTREAM_COST | ${validity.UPSTREAM_COST} |`,
    `| RAW_SHA | \`${input.rawSha}\` |`,
    "",
    "## Refusal / capability gate",
    "",
    `| Field | Value |`,
    `| --- | --- |`,
    `| COMPLIED | ${refusal.COMPLIED} |`,
    `| REFUSED | ${refusal.REFUSED} |`,
    `| SAFETY_EMPTY | ${refusal.SAFETY_EMPTY} |`,
    `| GLM53_HANDOFF_CAPABILITY | ${refusal.GLM53_HANDOFF_CAPABILITY} |`,
    "",
    "## Objective metrics (GLM candidate)",
    "",
    "Descriptive only — no automated subjective prose score.",
    "",
    "## Comparison table",
    "",
    "Production-candidate comparison (not strict one-variable A/B vs #625 DeepSeek-specific wire).",
    "",
    "| Arm | Chars | Para | Dialogue | Dial/1k | Dial ratio | Med narr | User quoted | T2 replay | In tok | Out tok | Reas tok | Latency ms | Cost |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const row of input.comparison) {
    lines.push(
      `| ${row.label} | ${row.VISIBLE_CHARS} | ${row.PARAGRAPH_COUNT} | ${row.DIALOGUE_BLOCKS} | ${row.DIALOGUE_BLOCKS_PER_1000_CHARS} | ${row.DIALOGUE_PARAGRAPH_RATIO} | ${row.MEDIAN_NARRATION_PARAGRAPH_CHARS} | ${row.SOURCE_USER_QUOTED_DIALOGUE_COUNT ?? "—"} | ${row.T2_REPLAY_TOPIC_IDS == null ? "—" : (row.T2_REPLAY_TOPIC_IDS as string[]).join(", ") || "—"} | ${row.input_tokens ?? "—"} | ${row.output_tokens ?? "—"} | ${row.reasoning_tokens ?? "—"} | ${row.latency_ms ?? "—"} | ${row.cost ?? "—"} |`
    );
  }

  lines.push(
    "",
    `PRIMARY_MEDIAN_VISIBLE_CHARS=${PRIMARY_MEDIAN_VISIBLE_CHARS}, T3_GEMINI_GOLD_VISIBLE_CHARS=${T3_GEMINI_GOLD_VISIBLE_CHARS}.`,
    "",
    "## Human review questions (Cursor does NOT answer)",
    "",
    "1. Does it feel more like the same Gemini 3.1 writer?",
    "2. Does 라이크 retain playful / casual / humorous character voice?",
    "3. Does it begin from the CURRENT T3 state rather than replay T2?",
    "4. Is narration/dialogue balance closer to Gemini T1/T2?",
    "5. Is paragraph/sentence rhythm closer to Gemini?",
    "6. Does it preserve canon?",
    "7. Does it avoid inventing new user dialogue?",
    "8. Does it complete requested progression?",
    "9. Does mandatory reasoning create over-analysis or strange prose?",
    "10. Is the quality improvement large enough to justify replacing DeepSeek as Gemini refusal fallback?",
    "",
    "Artifacts:",
    "- `requests/GLM53-HANDOFF-input.json`",
    "- `responses/T3-GLM53-CANDIDATE-RAW.txt`",
    "- `responses/T3-GLM53-CANDIDATE-PERSISTED-EQUIVALENT.txt`",
    "- `meta/phase-c-objective-metrics.json`",
    "",
    "**STOP for Human/ChatGPT RAW review.**"
  );

  return lines.join("\n");
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const phaseAPath = join(OUT, "meta/phase-a-assembly.json");
  if (!readFileSync(phaseAPath, "utf8")) {
    throw new Error("Run assemble-glm53-handoff.ts first");
  }
  const assembly = JSON.parse(readFileSync(phaseAPath, "utf8")) as Record<string, unknown>;
  if (assembly.ASSEMBLY_GATE_PASS !== true) {
    save("meta/STOP.json", { STOP_REASON: "ASSEMBLY_GATE_FAIL", assembly });
    console.log(JSON.stringify({ STOP: "ASSEMBLY_GATE_FAIL" }, null, 2));
    process.exit(2);
  }

  const requestPath = join(OUT, "requests/GLM53-HANDOFF-input.json");
  const requestBody = JSON.parse(readFileSync(requestPath, "utf8")) as Record<string, unknown>;
  const requestSha = sha256Object(requestBody);

  const {
    OPENROUTER_CHAT_COMPLETIONS_URL,
    buildOpenRouterHeaders,
    resolveOpenRouterApiKey,
  } = await import("../../../../src/lib/openRouterConfig");
  const { sanitizeStreamArtifacts, endsAtCompleteSentence } = await import(
    "../../../../src/lib/responseLength"
  );
  const { stripRpMetaLeakage, trimTrailingVisibleSelfCritique } = await import(
    "../../../../src/lib/narrativeRules"
  );
  const { stripFlashOwnedArtifactsOnly } = await import("../../../../src/lib/streamFirstSave");
  const { visibleAssistantDisplayCharCount } = await import(
    "../../../../src/lib/chatDisplayLength"
  );

  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) {
    save("meta/STOP.json", { STOP_REASON: "OPENROUTER_API_KEY_MISSING" });
    console.log(JSON.stringify({ STOP: "OPENROUTER_API_KEY_MISSING" }, null, 2));
    process.exit(2);
  }

  const started = Date.now();
  const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildOpenRouterHeaders(apiKey),
    body: JSON.stringify(requestBody),
  });
  const consumed = await consumeProductionStream(res, started);
  const totalLatencyMs = Date.now() - started;

  save("responses/T3-GLM53-CANDIDATE-RAW.txt", consumed.rawText);

  const parsedUsage = parseOpenRouterUsage(consumed.usage);
  const sanitized = sanitizeStreamArtifacts(consumed.rawText);
  const afterMeta = stripRpMetaLeakage(sanitized);
  const trailing = trimTrailingVisibleSelfCritique(afterMeta);
  if (trailing.status === "UNSAFE_TO_TRIM") {
    save("meta/STOP.json", {
      STOP_REASON: "META_LEAKAGE_ABORT",
      HTTP_STATUS: consumed.httpStatus,
      FINISH_REASON: consumed.finishReason,
    });
    console.log(JSON.stringify({ STOP: "META_LEAKAGE_ABORT" }, null, 2));
    process.exit(2);
  }
  const afterCritique = trailing.status === "TRIMMED" ? trailing.text : afterMeta;
  const persistedEquivalent = stripFlashOwnedArtifactsOnly(afterCritique);
  save("responses/T3-GLM53-CANDIDATE-PERSISTED-EQUIVALENT.txt", persistedEquivalent);

  const visibleChars = visibleAssistantDisplayCharCount(persistedEquivalent);
  const endsComplete = endsAtCompleteSentence(persistedEquivalent);
  const finishReason = consumed.finishReason;
  const httpStatus = consumed.httpStatus;

  const validSample =
    httpStatus === 200 &&
    finishReason === "stop" &&
    visibleChars > 0 &&
    endsComplete;

  const refusalResult = detectModelRefusal({
    text: persistedEquivalent,
    finishReason,
  });
  const emptySafety =
    !persistedEquivalent.trim() &&
    (finishReason === "content_filter" ||
      finishReason === "safety" ||
      refusalResult.reason === "empty_safety_response");

  const complied = validSample && !refusalResult.refused && !emptySafety;
  const refused = refusalResult.refused;
  const capability = complied ? "PASS" : "FAIL";

  const refusalReport = {
    COMPLIED: complied,
    REFUSED: refused,
    SAFETY_EMPTY: emptySafety,
    REFUSAL_REASON: refusalResult.reason,
    GLM53_HANDOFF_CAPABILITY: capability,
  };

  const t3User = readFileSync(join(FROZEN, "T3-USER_RAW.txt"), "utf8");
  const t2Visible = readFileSync(join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t2User = readFileSync(join(FROZEN, "T2-USER_RAW.txt"), "utf8");
  const t1Visible = readFileSync(join(FROZEN, "T1-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t2Assist = readFileSync(join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t3Gold = readFileSync(join(FROZEN, "T3-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");

  const glmMetrics = objectiveMetrics(persistedEquivalent);
  const alarms = alarmCandidates(persistedEquivalent, finishReason);
  const dialogueAudit = attributeDialogueInResponse({
    responseText: persistedEquivalent,
    userRaw: t3User,
    personaName: "렌",
    characterNames: ["라이크", "태형"],
  });
  const t2Replay = detectT2ReplayCandidate({
    responseText: persistedEquivalent,
    t2AssistantVisible: t2Visible,
    t2UserRaw: t2User,
  });

  const validityReport = {
    TOTAL_PROVIDER_CALLS: 1,
    DELIVERED_PROVIDER: "openrouter",
    OPENROUTER_MODEL: GLM_MODEL,
    HTTP_STATUS: httpStatus,
    FINISH_REASON: finishReason,
    USAGE_PRESENT: consumed.usage != null,
    VISIBLE_CHARS: visibleChars,
    ENDS_COMPLETE_SENTENCE: endsComplete,
    VALID_PROSE_SAMPLE: validSample,
    REASONING_TOKENS: parsedUsage.reasoningTokens,
    OUTPUT_TOKENS: parsedUsage.completionTokens,
    INPUT_TOKENS: parsedUsage.promptTokens,
    TTFT_MS: consumed.ttftMs,
    TOTAL_LATENCY_MS: totalLatencyMs,
    COST: parsedUsage.upstreamCostUsd ?? null,
    UPSTREAM_COST: parsedUsage.upstreamCostUsd ?? null,
    REQUEST_SHA: requestSha,
    RAW_SHA: sha256Text(consumed.rawText),
    PROVIDER_METADATA: consumed.usage,
  };

  const objectiveReport = {
    ...glmMetrics,
    ...alarms,
    SOURCE_USER_QUOTED_DIALOGUE_COUNT: dialogueAudit.SOURCE_USER_QUOTED_DIALOGUE_COUNT,
    NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT:
      dialogueAudit.NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT,
    T2_REPLAY_CANDIDATE: t2Replay.T2_REPLAY_CANDIDATE,
    T2_REPLAY_TOPIC_IDS: t2Replay.replay_topic_ids,
    REQUESTED_PROGRESSION_COMPLETED: alarms.REQUESTED_PROGRESSION_COMPLETED,
    META_LEAK: alarms.META_LEAK,
    EMPTY_OUTPUT: alarms.EMPTY_OUTPUT,
    TRUNCATION: alarms.TRUNCATION,
    CANON_CONTRADICTION_CANDIDATE: alarms.CANON_CONTRADICTION_CANDIDATE,
    REPETITION_CANDIDATE: alarms.REPETITION_CANDIDATE,
  };

  const u625 = readUsageSummary(join(REF, "baseline-625-usage.json"));
  const u629 = readUsageSummary(join(REF, "baseline-629-usage.json"));
  const u626 = readUsageSummary(join(REF, "baseline-626-usage.json"));

  const comparison = [
    buildComparisonRow("Gemini T1", t1Visible, { skipT2Replay: true }),
    buildComparisonRow("Gemini T2", t2Assist, { skipT2Replay: true }),
    buildComparisonRow("Gemini T3 GOLD", t3Gold, { skipT2Replay: true }),
    buildComparisonRow(
      "DeepSeek #625 CI A",
      readFileSync(join(REF, "T3-DEEPSEEK-625-PERSISTED.txt"), "utf8"),
      { ...u625, latency_ms: 2332 }
    ),
    buildComparisonRow(
      "DeepSeek #629 OR A",
      readFileSync(join(REF, "T3-DEEPSEEK-629-OR-PERSISTED.txt"), "utf8"),
      u629
    ),
    buildComparisonRow(
      "DeepSeek H1 #626 OR",
      readFileSync(join(REF, "T3-DEEPSEEK-626-H1-PERSISTED.txt"), "utf8"),
      u626
    ),
    buildComparisonRow("GLM-5.3 candidate", persistedEquivalent, {
      input_tokens: parsedUsage.promptTokens,
      output_tokens: parsedUsage.completionTokens,
      reasoning_tokens: parsedUsage.reasoningTokens,
      cost: parsedUsage.upstreamCostUsd ?? null,
      latency_ms: totalLatencyMs,
    }),
  ];

  save("meta/phase-c-validity.json", validityReport);
  save("meta/phase-c-usage.json", consumed.usage ?? {});
  save("meta/phase-c-objective-metrics.json", objectiveReport);
  save("meta/phase-c-dialogue-attribution.json", dialogueAudit);
  save("meta/phase-c-t2-replay.json", t2Replay);
  save("meta/phase-c-refusal.json", refusalReport);
  save("meta/comparison-table.json", comparison);

  const reportMd = buildReport({
    assembly,
    validity: validityReport,
    metrics: objectiveReport,
    refusal: refusalReport,
    comparison,
    requestSha,
    rawSha: sha256Text(consumed.rawText),
  });
  save("REPORT.md", reportMd);

  save("meta/FINAL_REPORT.json", {
    assembly,
    validity: validityReport,
    objective: objectiveReport,
    refusal: refusalReport,
    comparison,
  });

  console.log(JSON.stringify({ validityReport, refusalReport, objectiveReport }, null, 2));

  if (!validSample) {
    console.log(JSON.stringify({ STOP: "INVALID_PROSE_SAMPLE" }, null, 2));
    process.exit(0);
  }
  if (capability === "FAIL") {
    console.log(JSON.stringify({ STOP: "GLM53_HANDOFF_CAPABILITY_FAIL" }, null, 2));
    process.exit(0);
  }
}

if (process.argv[1]?.endsWith("run-glm53-handoff-benchmark.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
