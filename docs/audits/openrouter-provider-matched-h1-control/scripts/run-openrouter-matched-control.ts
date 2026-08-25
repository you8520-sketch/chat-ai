#!/usr/bin/env npx tsx
/**
 * OpenRouter provider-matched A control — style reminder ON vs H1 reminder OFF (#626).
 * ONE OpenRouter pinned 0813 call only. No CI, no failover, no H1 rerun.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";
import { DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY } from "../../../../src/lib/deepseekPromptStructure";
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
const OUT = join(ROOT, "docs/audits/openrouter-provider-matched-h1-control");
const FROZEN = join(OUT, "source-frozen");
const A_REQUEST_SHA =
  "d155d08328ba7903846799feb6a05f3d239631b4593d72a607d60d6f0ecf26d2";

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

function stripStyleReminderPrefix(userContent: string): string {
  const body = userContent.trimStart();
  if (body.startsWith(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY)) {
    return body.slice(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.length).replace(/^\n+/, "");
  }
  return body;
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

function runMatchedDiffGate(
  aOpenRouter: Record<string, unknown>,
  h1OpenRouter: Record<string, unknown>
) {
  const aMsgs =
    (aOpenRouter.messages as Array<{ role: string; content: unknown }>) ?? [];
  const h1Msgs =
    (h1OpenRouter.messages as Array<{ role: string; content: unknown }>) ?? [];

  const bodyKeys = [
    "model",
    "temperature",
    "top_p",
    "max_tokens",
    "stream",
    "stream_options",
    "reasoning",
    "include_reasoning",
  ] as const;
  const bodyEqual = bodyKeys.every(
    (k) => JSON.stringify(aOpenRouter[k]) === JSON.stringify(h1OpenRouter[k])
  );

  const messageCountEqual = aMsgs.length === h1Msgs.length;
  let roleOrderEqual = true;
  let messages0to4Equal = true;
  let systemEqual = true;
  let t1T2ExemplarsEqual = true;

  const t1Visible = readFileSync(
    join(FROZEN, "T1-ASSISTANT_PERSISTED_VISIBLE.txt"),
    "utf8"
  );
  const t2Visible = readFileSync(
    join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"),
    "utf8"
  );

  for (let i = 0; i < Math.min(aMsgs.length, h1Msgs.length); i++) {
    if (aMsgs[i]?.role !== h1Msgs[i]?.role) roleOrderEqual = false;
    const aContent = flatten(aMsgs[i]?.content);
    const h1Content = flatten(h1Msgs[i]?.content);
    if (i <= 4 && aContent !== h1Content) messages0to4Equal = false;
    if (i === 0 && aContent !== h1Content) systemEqual = false;
    if (aContent === t1Visible || aContent === t2Visible) {
      if (aContent !== h1Content) t1T2ExemplarsEqual = false;
    }
  }

  const aLast = flatten(aMsgs.at(-1)?.content);
  const h1Last = flatten(h1Msgs.at(-1)?.content);
  const aLastStripped = stripStyleReminderPrefix(aLast);
  const onlyReminderDelta =
    bodyEqual &&
    messageCountEqual &&
    roleOrderEqual &&
    messages0to4Equal &&
    systemEqual &&
    t1T2ExemplarsEqual &&
    aLast.startsWith(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY) &&
    !h1Last.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)) &&
    h1Last === aLastStripped;

  return {
    OPENROUTER_MATCHED_CONTROL_ONLY_DELTA_IS_REMINDER: onlyReminderDelta,
    A_OPENROUTER_REQUEST_SHA: sha256Object(aOpenRouter),
    H1_OPENROUTER_REQUEST_SHA: sha256Object(h1OpenRouter),
    body_keys_equal: bodyEqual,
    message_count_equal: messageCountEqual,
    role_order_equal: roleOrderEqual,
    messages_0_to_4_byte_identical: messages0to4Equal,
    system_byte_identical: systemEqual,
    t1_t2_exemplars_byte_identical: t1T2ExemplarsEqual,
    a_has_style_reminder: aLast.startsWith(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY),
    h1_lacks_style_reminder: !h1Last.includes(
      DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY.slice(0, 40)
    ),
    last_user_equal_after_reminder_strip: h1Last === aLastStripped,
    REMINDER_CHARS_DELTA: aLast.length - aLastStripped.length,
    model: aOpenRouter.model,
    temperature: aOpenRouter.temperature,
    top_p: aOpenRouter.top_p,
    stream: aOpenRouter.stream,
    reasoning: aOpenRouter.reasoning,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const aBeforeAdapt = JSON.parse(
    readFileSync(join(OUT, "requests/A-TRUE-ROUTE-before-adapt.json"), "utf8")
  ) as Record<string, unknown>;
  const aInput = JSON.parse(
    readFileSync(join(OUT, "requests/A-TRUE-ROUTE-input.json"), "utf8")
  ) as Record<string, unknown>;
  const aInputSha = sha256Object(aInput);
  if (aInputSha !== A_REQUEST_SHA) {
    console.log(
      JSON.stringify(
        { STOP: "A_REQUEST_SHA_MISMATCH", observed: aInputSha, expected: A_REQUEST_SHA },
        null,
        2
      )
    );
    process.exit(2);
  }

  const h1OpenRouter = JSON.parse(
    readFileSync(join(FROZEN, "H1-OPENROUTER_BACKUP-input.json"), "utf8")
  ) as Record<string, unknown>;

  const {
    adaptOpenRouterDeepSeekBackupBody,
    resolveDeepSeekBackupModelId,
  } = await import("../../../../src/lib/deepseekProviderFailover");
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
  const { stripFlashOwnedArtifactsOnly } = await import(
    "../../../../src/lib/streamFirstSave"
  );
  const { visibleAssistantDisplayCharCount } = await import(
    "../../../../src/lib/chatDisplayLength"
  );

  const backupModel = resolveDeepSeekBackupModelId("pro");
  const aOpenRouter = adaptOpenRouterDeepSeekBackupBody(aBeforeAdapt, backupModel);
  save("requests/A-OPENROUTER_BACKUP-input.json", aOpenRouter);

  const diffGate = runMatchedDiffGate(aOpenRouter, h1OpenRouter);
  save("meta/openrouter-matched-diff-gate.json", diffGate);
  console.log(JSON.stringify(diffGate, null, 2));

  if (!diffGate.OPENROUTER_MATCHED_CONTROL_ONLY_DELTA_IS_REMINDER) {
    console.log(JSON.stringify({ STOP: "MATCHED_DIFF_GATE_FAIL" }, null, 2));
    process.exit(2);
  }

  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) {
    console.log(JSON.stringify({ STOP: "OPENROUTER_API_KEY_MISSING" }, null, 2));
    process.exit(2);
  }

  const started = Date.now();
  const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildOpenRouterHeaders(apiKey),
    body: JSON.stringify(aOpenRouter),
  });
  const consumed = await consumeProductionStream(res);
  const sanitized = sanitizeStreamArtifacts(consumed.rawText);
  const afterMeta = stripRpMetaLeakage(sanitized);
  const trailing = trimTrailingVisibleSelfCritique(afterMeta);
  if (trailing.status === "UNSAFE_TO_TRIM") {
    save("meta/STOP.json", { STOP_REASON: "META_LEAKAGE_ABORT" });
    process.exit(2);
  }
  const afterCritique = trailing.status === "TRIMMED" ? trailing.text : afterMeta;
  const persistedEquivalent = stripFlashOwnedArtifactsOnly(afterCritique);
  const wouldDeliver = persistedEquivalent.trim().length > 0;

  const t1Visible = readFileSync(
    join(FROZEN, "T1-ASSISTANT_PERSISTED_VISIBLE.txt"),
    "utf8"
  );
  const t2Visible = readFileSync(
    join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"),
    "utf8"
  );
  const t2User = readFileSync(join(FROZEN, "T2-USER_RAW.txt"), "utf8");
  const t3Gold = readFileSync(
    join(FROZEN, "T3-ASSISTANT_PERSISTED_VISIBLE.txt"),
    "utf8"
  );
  const t3User = readFileSync(join(FROZEN, "T3-USER_RAW.txt"), "utf8");
  const a625Text = readFileSync(
    join(FROZEN, "T3-DEEPSEEK-A-625-PERSISTED.txt"),
    "utf8"
  );
  const h1Text = readFileSync(join(FROZEN, "H1-OPENROUTER-PERSISTED.txt"), "utf8");

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
  const aOpenRouterMetrics = objectiveMetrics(persistedEquivalent);
  const h1Metrics = objectiveMetrics(h1Text);
  const a625Metrics = objectiveMetrics(a625Text);

  const providerReport = {
    TOTAL_PROVIDER_CALLS: 1,
    DELIVERED_PROVIDER: "openrouter",
    OPENROUTER_MODEL: backupModel,
    CI_ATTEMPTED: false,
    OPENROUTER_HTTP_STATUS: consumed.httpStatus,
    A_REQUEST_SHA,
    A_OPENROUTER_REQUEST_SHA: diffGate.A_OPENROUTER_REQUEST_SHA,
    A_OPENROUTER_RAW_SHA: sha256Text(consumed.rawText),
    OPENROUTER_MATCHED_CONTROL_ONLY_DELTA_IS_REMINDER: true,
    DELIVERED_FINISH_REASON: consumed.finishReason,
    DELIVERED_USAGE_PRESENT: consumed.usage != null,
    DELIVERED_ENDS_COMPLETE_SENTENCE: endsAtCompleteSentence(persistedEquivalent),
    PRODUCTION_WOULD_DELIVER_RESPONSE: wouldDeliver,
    A_OPENROUTER_VISIBLE_CHARS: visibleAssistantDisplayCharCount(persistedEquivalent),
    A_OPENROUTER_VS_PRIMARY_LENGTH_RATIO: Number(
      (aOpenRouterMetrics.VISIBLE_CHARS / PRIMARY_MEDIAN_VISIBLE_CHARS).toFixed(4)
    ),
    A_OPENROUTER_VS_GEMINI_GOLD_LENGTH_RATIO: Number(
      (aOpenRouterMetrics.VISIBLE_CHARS / T3_GEMINI_GOLD_VISIBLE_CHARS).toFixed(4)
    ),
    SOURCE_USER_QUOTED_DIALOGUE_COUNT: dialogueAudit.SOURCE_USER_QUOTED_DIALOGUE_COUNT,
    T2_REPLAY_CANDIDATE: t2Replay.T2_REPLAY_CANDIDATE,
    T2_REPLAY_TOPIC_IDS: t2Replay.replay_topic_ids,
    USER_AGENCY_OWNER_ACTUALLY_ACTIVE: flatten(
      (aOpenRouter.messages as Array<{ content?: unknown }>)?.[0]?.content
    ).includes("[USER AUTHORING"),
    OWNER_SCANNER_FALSE_NEGATIVE: true,
    CONTACT_ACTOR_EXTRACTION_BUG: true,
    elapsed_ms: Date.now() - started,
  };

  save("responses/A-OPENROUTER-RAW.txt", consumed.rawText);
  save("responses/A-OPENROUTER-PERSISTED-EQUIVALENT.txt", persistedEquivalent);
  save("meta/a-openrouter-provider-accounting.json", providerReport);
  save("meta/a-openrouter-usage.json", consumed.usage ?? null);
  save("meta/a-openrouter-alarms.json", alarmCandidates(persistedEquivalent, consumed.finishReason));
  save("meta/a-openrouter-dialogue-attribution.json", dialogueAudit);
  save("meta/a-openrouter-t2-replay.json", t2Replay);

  const comparison = {
    T1_GEMINI: objectiveMetrics(t1Visible),
    T2_GEMINI: objectiveMetrics(t2Visible),
    T3_GEMINI_GOLD: objectiveMetrics(t3Gold),
    T3_DEEPSEEK_A_625_CI: a625Metrics,
    T3_DEEPSEEK_A_OPENROUTER: aOpenRouterMetrics,
    T3_DEEPSEEK_H1_OPENROUTER: h1Metrics,
    dialogue_attribution: {
      A_OPENROUTER: {
        SOURCE_USER_QUOTED_DIALOGUE_COUNT:
          dialogueAudit.SOURCE_USER_QUOTED_DIALOGUE_COUNT,
      },
      H1_OPENROUTER: attributeDialogueInResponse({
        responseText: h1Text,
        userRaw: t3User,
        personaName: "렌",
        characterNames: ["라이크", "태형"],
      }).SOURCE_USER_QUOTED_DIALOGUE_COUNT,
    },
    t2_replay: {
      A_OPENROUTER: t2Replay,
      H1_OPENROUTER: detectT2ReplayCandidate({
        responseText: h1Text,
        t2AssistantVisible: t2Visible,
        t2UserRaw: t2User,
      }),
    },
  };
  save("meta/comparison-objective-metrics.json", comparison);

  const finalReport = {
    ...providerReport,
    ...diffGate,
    comparison,
    H1_CAUSAL_PRIOR: "INCONCLUSIVE_PROVIDER_CONFOUND",
    STOP_FOR_HUMAN_REVIEW: true,
  };
  save("meta/FINAL_REPORT.json", finalReport);

  console.log(JSON.stringify(providerReport, null, 2));
  if (!wouldDeliver) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
