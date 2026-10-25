#!/usr/bin/env npx tsx
/**
 * Phase C — one logical DeepSeek adult-handoff turn via production
 * executeDeepSeekWithProviderFailover. Audit evidence only.
 * No chat row, billing, memory, route state, regeneration, or H1.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = join(ROOT, "docs/audits/production-equivalent-deepseek-handoff-baseline");
const FROZEN = join(OUT, "source-frozen");
const PRIMARY_MEDIAN_VISIBLE_CHARS = 3323;
const T3_GEMINI_GOLD_VISIBLE_CHARS = 2651;
const REQUEST_621_SHA =
  "85ae4e16ba3e002dc1dcd84911f3263c68679904e5d3316a0f365fd084003731";

function sha256(text: string): string {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
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

function flatten(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text?: unknown }).text ?? "")
          : ""
      )
      .join("");
  }
  return "";
}

function paragraphs(text: string) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p: string) {
  return /["“”「」『』]/.test(p) || /^(?:[“"]|[가-힣A-Za-z].{0,12}[:：])/.test(p);
}

function median(nums: number[]) {
  const a = [...nums].filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function maxConsecutiveDialogue(paras: string[]) {
  let max = 0;
  let cur = 0;
  for (const p of paras) {
    if (isDialogueParagraph(p)) {
      cur += 1;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

function objectiveMetrics(text: string) {
  const paras = paragraphs(text);
  const dialogueParas = paras.filter(isDialogueParagraph);
  const narrationParas = paras.filter((p) => !isDialogueParagraph(p));
  const chars = String(text || "").length;
  const dialogueBlocks = dialogueParas.length;
  return {
    VISIBLE_CHARS: chars,
    PARAGRAPH_COUNT: paras.length,
    DIALOGUE_BLOCKS: dialogueBlocks,
    DIALOGUE_BLOCKS_PER_1000_CHARS:
      chars === 0 ? 0 : Number(((dialogueBlocks / chars) * 1000).toFixed(3)),
    DIALOGUE_PARAGRAPH_RATIO:
      paras.length === 0 ? 0 : Number((dialogueBlocks / paras.length).toFixed(3)),
    MAX_CONSECUTIVE_DIALOGUE: maxConsecutiveDialogue(paras),
    MEDIAN_PARAGRAPH_CHARS: median(paras.map((p) => p.length)),
    MEDIAN_NARRATION_PARAGRAPH_CHARS: median(narrationParas.map((p) => p.length)),
    MEDIAN_DIALOGUE_PARAGRAPH_CHARS: median(dialogueParas.map((p) => p.length)),
  };
}

function alarmCandidates(text: string, finishReason?: string | null) {
  const t = String(text || "");
  return {
    META_LEAK: /(?:SYSTEM|SceneMode|routeTrigger|INTERNAL|OOC:)/i.test(t),
    EMPTY_OUTPUT: !t.trim(),
    NEW_USER_DIALOGUE_CANDIDATE: /(?:렌이\s*(?:말했|대답했|속삭였)|렌의\s*입에서)/.test(t),
    NEW_USER_ACTION_CANDIDATE: /(?:렌이\s*(?:일어섰|달려|문을\s*열|옷을\s*벗었))/.test(t),
    CANON_CONTRADICTION_CANDIDATE: /(?:미성년|고등학생|17살|18살 미만)/.test(t),
    REPETITION_CANDIDATE: (() => {
      const paras = paragraphs(t);
      const uniq = new Set(paras.map((p) => p.slice(0, 80)));
      return paras.length >= 6 && uniq.size <= Math.ceil(paras.length * 0.5);
    })(),
    TURN_ENDING_USER_CHECKPOINT_CANDIDATE: /(?:눈을\s*마주|이대로\s*조금만|잠깐만)/.test(
      t.slice(-400)
    ),
    REQUESTED_PROGRESSION_COMPLETED:
      /(?:삽입|성교|오르가슴|절정|사정|끝까지)/.test(t) && t.length > 200,
    FINISH_REASON_OBSERVED: finishReason ?? null,
  };
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
  delta?: {
    content?: string | unknown[] | null;
    text?: string | null;
  };
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
          /* incomplete JSON — same as production */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { rawText, finishReason, usage, sawDone, httpStatus: res.status };
}

async function main() {
  const phaseA = JSON.parse(
    readFileSync(join(OUT, "meta/phase-a-outbound-equivalence.json"), "utf8")
  ) as {
    MESSAGES_BYTE_IDENTICAL?: boolean;
    T1_PRIMARY_STYLE_EXEMPLAR_PRESENT?: boolean;
    T2_PRIMARY_STYLE_EXEMPLAR_PRESENT?: boolean;
    T3_GEMINI_GOLD_PRESENT?: boolean;
    TRUE_PRODUCTION_HANDOFF_REQUEST_SHA?: string;
    REQUEST_621_SHA?: string;
    unexpected_message_diff?: boolean;
    owners?: Record<string, boolean>;
  };
  if (
    phaseA.unexpected_message_diff ||
    !phaseA.MESSAGES_BYTE_IDENTICAL ||
    !phaseA.T1_PRIMARY_STYLE_EXEMPLAR_PRESENT ||
    !phaseA.T2_PRIMARY_STYLE_EXEMPLAR_PRESENT ||
    phaseA.T3_GEMINI_GOLD_PRESENT
  ) {
    save("meta/PHASE_C_STOP.json", {
      reason: "PHASE_A_DID_NOT_PASS",
      phaseA,
    });
    console.log(JSON.stringify({ PHASE_C_STOP: "PHASE_A_DID_NOT_PASS", phaseA }, null, 2));
    process.exit(2);
  }

  const requestBody = JSON.parse(
    readFileSync(join(OUT, "requests/TRUE_PRODUCTION_HANDOFF-input.json"), "utf8")
  ) as Record<string, unknown>;
  const requestBodyBeforeAdapt = JSON.parse(
    readFileSync(join(OUT, "requests/TRUE_PRODUCTION_HANDOFF-before-adapt.json"), "utf8")
  ) as Record<string, unknown>;
  const shaProd = sha256(JSON.stringify(requestBody));
  if (shaProd !== phaseA.TRUE_PRODUCTION_HANDOFF_REQUEST_SHA) {
    throw new Error("Phase A body SHA mismatch vs frozen report");
  }
  if (phaseA.REQUEST_621_SHA !== REQUEST_621_SHA) {
    throw new Error("Frozen #621 SHA mismatch");
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

  const routeKind = resolveDeepSeekFailoverRouteKind({
    modelId: "deepseek-v4-pro-0813",
    adultHandoff: true,
  });
  if (routeKind !== "adult_handoff") {
    throw new Error(`expected adult_handoff routeKind, got ${routeKind}`);
  }

  const backupModel = resolveDeepSeekBackupModelId("pro");
  const backupBody = adaptOpenRouterDeepSeekBackupBody(requestBodyBeforeAdapt, backupModel);

  save("requests/OPENROUTER_BACKUP-input.json", backupBody);

  let telemetry: Record<string, unknown> | null = null;
  const started = Date.now();
  let failoverResult: {
    response: Response;
    telemetry: Record<string, unknown>;
    usedProvider: string;
  };
  try {
    failoverResult = (await executeDeepSeekWithProviderFailover({
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
    })) as unknown as {
      response: Response;
      telemetry: Record<string, unknown>;
      usedProvider: string;
    };
  } catch (error) {
    const err = error as {
      name?: string;
      message?: string;
      telemetry?: Record<string, unknown>;
      httpStatus?: number;
      primaryHttpStatus?: number;
      failureClass?: string;
      primaryFailureClass?: string;
    };
    const failReport = {
      LOGICAL_DEEPSEEK_TURNS: 1,
      PRODUCTION_WOULD_DELIVER_RESPONSE: false,
      STOP_REASON: "PROVIDER_FAILOVER_THREW",
      error_name: err.name ?? null,
      error_message: err.message ?? String(error),
      telemetry: err.telemetry ?? telemetry,
      elapsed_ms: Date.now() - started,
    };
    save("meta/phase-c-provider-accounting.json", failReport);
    save("meta/PHASE_C_STOP.json", failReport);
    console.log(JSON.stringify(failReport, null, 2));
    process.exit(2);
  }

  const tel = (failoverResult.telemetry ?? telemetry ?? {}) as {
    primary_http_status?: number | null;
    primary_first_visible_ms?: number | null;
    primary_failure_class?: string | null;
    failover_trigger?: string | null;
    backup_success?: boolean;
    provider_attempt_count?: number;
    logical_model?: string;
    route_kind?: string;
  };

  const consumed = await consumeProductionStream(failoverResult.response);
  const sanitized = sanitizeStreamArtifacts(consumed.rawText);
  const afterMeta = stripRpMetaLeakage(sanitized);
  const trailing = trimTrailingVisibleSelfCritique(afterMeta);
  if (trailing.status === "UNSAFE_TO_TRIM") {
    const blocked = {
      LOGICAL_DEEPSEEK_TURNS: 1,
      PRODUCTION_WOULD_DELIVER_RESPONSE: false,
      STOP_REASON: "META_LEAKAGE_ABORT",
      telemetry: tel,
      DELIVERED_PROVIDER: failoverResult.usedProvider,
    };
    save("meta/PHASE_C_STOP.json", blocked);
    console.log(JSON.stringify(blocked, null, 2));
    process.exit(2);
  }
  const afterCritique = trailing.status === "TRIMMED" ? trailing.text : afterMeta;
  const persistedEquivalent = stripFlashOwnedArtifactsOnly(afterCritique);

  const wouldDeliver = persistedEquivalent.trim().length > 0;
  const t1Visible = readFileSync(join(FROZEN, "T1-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t2Visible = readFileSync(join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t3Gold = readFileSync(join(FROZEN, "T3-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");

  const deliveredMetrics = objectiveMetrics(persistedEquivalent);
  const report = {
    LOGICAL_DEEPSEEK_TURNS: 1,
    CI_ATTEMPTED: true,
    CI_HTTP_STATUS: tel.primary_http_status ?? consumed.httpStatus,
    CI_FIRST_VISIBLE_MS: tel.primary_first_visible_ms ?? null,
    CI_FAILURE_CLASS: tel.primary_failure_class ?? null,
    FAILOVER_TRIGGER: tel.failover_trigger ?? null,
    OPENROUTER_BACKUP_ATTEMPTED: (tel.provider_attempt_count ?? 1) > 1,
    OPENROUTER_BACKUP_MODEL: backupModel,
    OPENROUTER_BACKUP_SUCCESS: tel.backup_success === true,
    TOTAL_PROVIDER_ATTEMPTS: tel.provider_attempt_count ?? 1,
    DELIVERED_PROVIDER: failoverResult.usedProvider,
    PRODUCTION_WOULD_DELIVER_RESPONSE: wouldDeliver,
    DELIVERED_RAW_CHARS: consumed.rawText.length,
    DELIVERED_FINISH_REASON: consumed.finishReason,
    DELIVERED_USAGE_PRESENT: consumed.usage != null,
    DELIVERED_ENDS_COMPLETE_SENTENCE: endsAtCompleteSentence(persistedEquivalent),
    DELIVERED_SAW_DONE: consumed.sawDone,
    DELIVERED_VISIBLE_CHARS: visibleAssistantDisplayCharCount(persistedEquivalent),
    PRIMARY_MEDIAN_VISIBLE_CHARS,
    T3_GEMINI_GOLD_VISIBLE_CHARS,
    RATIO_VS_PRIMARY_MEDIAN:
      deliveredMetrics.VISIBLE_CHARS === 0
        ? 0
        : Number((deliveredMetrics.VISIBLE_CHARS / PRIMARY_MEDIAN_VISIBLE_CHARS).toFixed(4)),
    RATIO_VS_T3_GEMINI_GOLD:
      deliveredMetrics.VISIBLE_CHARS === 0
        ? 0
        : Number((deliveredMetrics.VISIBLE_CHARS / T3_GEMINI_GOLD_VISIBLE_CHARS).toFixed(4)),
    TRUE_PRODUCTION_HANDOFF_REQUEST_SHA: shaProd,
    REQUEST_621_SHA,
    route_kind: tel.route_kind ?? routeKind,
    logical_model: tel.logical_model ?? "deepseek-v4-pro-0813",
    telemetry: tel,
    elapsed_ms: Date.now() - started,
    owners: phaseA.owners,
    CONTACT_ACTOR_EXTRACTION_BUG: true,
    H1_EXECUTED: false,
  };

  save("responses/T3-DEEPSEEK-TRUE-PRODUCTION-HANDOFF-RAW.txt", consumed.rawText);
  save("responses/T3-DEEPSEEK-TRUE-PRODUCTION-HANDOFF-PERSISTED-EQUIVALENT.txt", persistedEquivalent);
  save("meta/phase-c-provider-accounting.json", report);
  save("meta/phase-c-objective-metrics.json", {
    T1_GEMINI: objectiveMetrics(t1Visible),
    T2_GEMINI: objectiveMetrics(t2Visible),
    T3_GEMINI_GOLD: objectiveMetrics(t3Gold),
    T3_DEEPSEEK_TRUE_PRODUCTION: deliveredMetrics,
  });
  save("meta/phase-c-alarms.json", alarmCandidates(persistedEquivalent, consumed.finishReason));
  save("meta/phase-c-usage.json", consumed.usage ?? null);

  console.log(JSON.stringify({ ...report, wouldDeliver }, null, 2));
  if (!wouldDeliver) {
    save("meta/PHASE_C_STOP.json", {
      reason: "PRODUCTION_WOULD_NOT_DELIVER",
      report,
    });
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
