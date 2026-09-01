#!/usr/bin/env npx tsx
/**
 * H1 — one logical DeepSeek adult-handoff turn (style reminder suppressed).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";
import {
  alarmCandidates,
  attributeDialogueInResponse,
  objectiveMetrics,
  PRIMARY_MEDIAN_VISIBLE_CHARS,
  T3_GEMINI_GOLD_VISIBLE_CHARS,
} from "./lib/audit-metrics";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = join(ROOT, "docs/audits/h1-handoff-skip-deepseek-style-reminder");
const FROZEN = join(OUT, "source-frozen");
const A_REQUEST_SHA =
  "d155d08328ba7903846799feb6a05f3d239631b4593d72a607d60d6f0ecf26d2";

function sha256Object(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj), "utf8").digest("hex");
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

async function consumeProductionStream(res: Response) {
  if (!res.body) {
    return {
      rawText: "",
      finishReason: null as string | null,
      usage: null as unknown,
      sawDone: false,
      httpStatus: res.status,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let finishReason: string | null = null;
  let usage: unknown = null;
  let sawDone = false;
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
          if (delta) rawText += delta;
          if (json.usage) usage = json.usage;
        } catch {
          /* incomplete JSON */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { rawText, finishReason, usage, sawDone, httpStatus: res.status };
}

async function main() {
  const gate = JSON.parse(
    readFileSync(join(OUT, "meta/ab-diff-gate.json"), "utf8")
  ) as { H1_ONLY_DELTA_IS_DEEPSEEK_STYLE_REMINDER_REMOVAL?: boolean };
  if (!gate.H1_ONLY_DELTA_IS_DEEPSEEK_STYLE_REMINDER_REMOVAL) {
    console.log(JSON.stringify({ STOP: "AB_DIFF_GATE_FAIL", gate }, null, 2));
    process.exit(2);
  }

  const requestBody = JSON.parse(
    readFileSync(join(OUT, "requests/H1-DEEPSEEK-input.json"), "utf8")
  ) as Record<string, unknown>;
  const requestBodyBeforeAdapt = JSON.parse(
    readFileSync(join(OUT, "requests/H1-DEEPSEEK-before-adapt.json"), "utf8")
  ) as Record<string, unknown>;
  const h1Sha = sha256Object(requestBody);

  const t3User = readFileSync(join(FROZEN, "T3-USER_RAW.txt"), "utf8");
  const t1Visible = readFileSync(join(FROZEN, "T1-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t2Visible = readFileSync(join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t3Gold = readFileSync(join(FROZEN, "T3-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");

  let aResponseText = "";
  const aFrozenPath = join(
    OUT,
    "source-frozen/T3-DEEPSEEK-A-625-PERSISTED.txt"
  );
  try {
    aResponseText = readFileSync(aFrozenPath, "utf8");
  } catch {
    /* optional reference copy for metrics table */
  }

  const {
    executeDeepSeekWithProviderFailover,
    adaptOpenRouterDeepSeekBackupBody,
    resolveDeepSeekBackupModelId,
    resolveDeepSeekFailoverRouteKind,
  } = await import("../../../../src/lib/deepseekProviderFailover");
  const {
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders,
    resolveCheaperInferenceApiKey,
  } = await import("../../../../src/lib/cheaperInferenceConfig");
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

  const backupModel = resolveDeepSeekBackupModelId("pro");
  const backupBody = adaptOpenRouterDeepSeekBackupBody(requestBodyBeforeAdapt, backupModel);
  save("requests/OPENROUTER_BACKUP-input.json", backupBody);

  let telemetry: Record<string, unknown> | null = null;
  const started = Date.now();
  const failoverResult = await executeDeepSeekWithProviderFailover({
    routeKind: "adult_handoff",
    logicalModel: "pro",
    primary: {
      endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
      headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
      body: requestBody,
    },
    backupBody,
    stream: true,
    hooks: {
      onTelemetry: (t) => {
        telemetry = t as unknown as Record<string, unknown>;
      },
    },
  });

  const tel = (failoverResult.telemetry ?? telemetry ?? {}) as {
    primary_http_status?: number | null;
    primary_first_visible_ms?: number | null;
    primary_failure_class?: string | null;
    failover_trigger?: string | null;
    backup_success?: boolean;
    provider_attempt_count?: number;
  };

  const consumed = await consumeProductionStream(failoverResult.response);
  const sanitized = sanitizeStreamArtifacts(consumed.rawText);
  const afterMeta = stripRpMetaLeakage(sanitized);
  const trailing = trimTrailingVisibleSelfCritique(afterMeta);
  if (trailing.status === "UNSAFE_TO_TRIM") {
    save("meta/PHASE_C_STOP.json", { STOP_REASON: "META_LEAKAGE_ABORT" });
    process.exit(2);
  }
  const afterCritique = trailing.status === "TRIMMED" ? trailing.text : afterMeta;
  const persistedEquivalent = stripFlashOwnedArtifactsOnly(afterCritique);
  const wouldDeliver = persistedEquivalent.trim().length > 0;

  const dialogueAudit = attributeDialogueInResponse({
    responseText: persistedEquivalent,
    userRaw: t3User,
    personaName: "렌",
    characterNames: ["라이크", "태형"],
  });

  const h1Metrics = objectiveMetrics(persistedEquivalent);
  const report = {
    H1_ONLY_DELTA_IS_DEEPSEEK_STYLE_REMINDER_REMOVAL: true,
    NATIVE_DEEPSEEK_STYLE_REMINDER_ACTIVE: gate.NATIVE_DEEPSEEK_STYLE_REMINDER_ACTIVE ?? true,
    ADULT_HANDOFF_DEEPSEEK_STYLE_REMINDER_ACTIVE: false,
    A_REQUEST_SHA,
    H1_REQUEST_SHA: h1Sha,
    H1_RAW_SHA: createHash("sha256").update(consumed.rawText, "utf8").digest("hex"),
    LOGICAL_DEEPSEEK_TURNS: 1,
    CI_ATTEMPTED: true,
    CI_HTTP_STATUS: tel.primary_http_status ?? consumed.httpStatus,
    CI_FIRST_VISIBLE_MS: tel.primary_first_visible_ms ?? null,
    CI_FAILURE_CLASS: tel.primary_failure_class ?? null,
    FAILOVER_TRIGGER: tel.failover_trigger ?? null,
    OPENROUTER_BACKUP_ATTEMPTED: (tel.provider_attempt_count ?? 1) > 1,
    OPENROUTER_BACKUP_SUCCESS: tel.backup_success === true,
    TOTAL_PROVIDER_ATTEMPTS: tel.provider_attempt_count ?? 1,
    DELIVERED_PROVIDER: failoverResult.usedProvider,
    PRODUCTION_WOULD_DELIVER_RESPONSE: wouldDeliver,
    DELIVERED_FINISH_REASON: consumed.finishReason,
    DELIVERED_USAGE_PRESENT: consumed.usage != null,
    DELIVERED_ENDS_COMPLETE_SENTENCE: endsAtCompleteSentence(persistedEquivalent),
    H1_VISIBLE_CHARS: visibleAssistantDisplayCharCount(persistedEquivalent),
    H1_VS_PRIMARY_LENGTH_RATIO: Number(
      (h1Metrics.VISIBLE_CHARS / PRIMARY_MEDIAN_VISIBLE_CHARS).toFixed(4)
    ),
    H1_VS_GEMINI_GOLD_LENGTH_RATIO: Number(
      (h1Metrics.VISIBLE_CHARS / T3_GEMINI_GOLD_VISIBLE_CHARS).toFixed(4)
    ),
    NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT:
      dialogueAudit.NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT,
    NEW_USER_DIALOGUE_HUMAN_REVIEW_REQUIRED:
      dialogueAudit.NEW_USER_DIALOGUE_HUMAN_REVIEW_REQUIRED,
    CONTACT_ACTOR_EXTRACTION_BUG: true,
    elapsed_ms: Date.now() - started,
  };

  save("responses/H1-DEEPSEEK-RAW.txt", consumed.rawText);
  save("responses/H1-DEEPSEEK-PERSISTED-EQUIVALENT.txt", persistedEquivalent);
  save("meta/h1-provider-accounting.json", report);
  save("meta/h1-objective-metrics.json", {
    T1_GEMINI: objectiveMetrics(t1Visible),
    T2_GEMINI: objectiveMetrics(t2Visible),
    T3_GEMINI_GOLD: objectiveMetrics(t3Gold),
    T3_DEEPSEEK_A_625: aResponseText ? objectiveMetrics(aResponseText) : null,
    T3_DEEPSEEK_H1: h1Metrics,
  });
  save("meta/h1-alarms.json", alarmCandidates(persistedEquivalent, consumed.finishReason));
  save("meta/h1-dialogue-attribution.json", dialogueAudit);
  save("meta/h1-usage.json", consumed.usage ?? null);

  console.log(JSON.stringify(report, null, 2));
  if (!wouldDeliver) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
