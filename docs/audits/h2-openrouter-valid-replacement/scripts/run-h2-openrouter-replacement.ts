#!/usr/bin/env npx tsx
/**
 * H2 OpenRouter valid replacement — one direct OpenRouter call using frozen #630 backup body.
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
  detectT2ReplayCandidate,
  objectiveMetrics,
} from "./lib/audit-metrics";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = join(ROOT, "docs/audits/h2-openrouter-valid-replacement");
const FROZEN = join(OUT, "source-frozen");

const PARAGRAPH_CONSOLIDATION_CLAUSE =
  "지문은 이어지는 행동·감각·의도를 같은 의미 단락 안에서 자연스럽게 연결하며, 짧은 문장마다 새 문단을 만들거나 한두 단어짜리 파편문을 습관적으로 반복하지 않는다.";

const H2_FROZEN_PATH = join(FROZEN, "H2-OPENROUTER_BACKUP-input.FROZEN-630.json");
const A_FROZEN_PATH = join(FROZEN, "A-OPENROUTER_BACKUP-input.FROZEN-629.json");

function sha256Object(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj), "utf8").digest("hex");
}

function sha256Buffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
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

function stripParagraphClause(userContent: string): string {
  return userContent.replace(` ${PARAGRAPH_CONSOLIDATION_CLAUSE}`, "");
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
      httpStatus: res.status,
    };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawText = "";
  let finishReason: string | null = null;
  let usage: unknown = null;
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
        if (payload === "[DONE]") continue;
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
  return { rawText, finishReason, usage, httpStatus: res.status };
}

function runDiffGate(h2: Record<string, unknown>, a: Record<string, unknown>) {
  const h2Msgs = (h2.messages as Array<{ role: string; content: unknown }>) ?? [];
  const aMsgs = (a.messages as Array<{ role: string; content: unknown }>) ?? [];
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
    (k) => JSON.stringify(h2[k]) === JSON.stringify(a[k])
  );
  let messagesPriorEqual = true;
  let roleOrderEqual = true;
  for (let i = 0; i < Math.min(h2Msgs.length, aMsgs.length); i++) {
    if (h2Msgs[i]?.role !== aMsgs[i]?.role) roleOrderEqual = false;
    if (i < h2Msgs.length - 1) {
      if (flatten(h2Msgs[i]?.content) !== flatten(aMsgs[i]?.content)) {
        messagesPriorEqual = false;
      }
    }
  }
  const aLast = flatten(aMsgs.at(-1)?.content);
  const h2Last = flatten(h2Msgs.at(-1)?.content);
  const onlyClauseDelta =
    bodyEqual &&
    h2Msgs.length === aMsgs.length &&
    roleOrderEqual &&
    messagesPriorEqual &&
    flatten(h2Msgs[0]?.content) === flatten(aMsgs[0]?.content) &&
    aLast.includes(PARAGRAPH_CONSOLIDATION_CLAUSE) &&
    !h2Last.includes(PARAGRAPH_CONSOLIDATION_CLAUSE) &&
    h2Last === stripParagraphClause(aLast);

  return {
    H2_OR_ONLY_DELTA_IS_PARAGRAPH_CLAUSE_REMOVAL: onlyClauseDelta,
    H2_OPENROUTER_REQUEST_SHA: sha256Object(h2),
    A_OPENROUTER_REQUEST_SHA: sha256Object(a),
    H2_FROZEN_FILE_SHA256: sha256Buffer(h2FrozenBytes),
    REMOVED_CHARS: aLast.length - h2Last.length,
    body_keys_equal: bodyEqual,
    message_count: h2Msgs.length,
    model: h2.model,
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const h2FrozenBytes = readFileSync(H2_FROZEN_PATH);
  const h2Request = JSON.parse(h2FrozenBytes.toString("utf8")) as Record<
    string,
    unknown
  >;
  const aRequest = JSON.parse(readFileSync(A_FROZEN_PATH, "utf8")) as Record<
    string,
    unknown
  >;

  writeFileSync(
    join(OUT, "requests/H2-OPENROUTER_BACKUP-input.FROZEN-630.json"),
    h2FrozenBytes
  );

  const diffGate = runDiffGate(h2Request, aRequest);
  save("meta/h2-or-diff-gate.json", diffGate);
  console.log(JSON.stringify(diffGate, null, 2));

  if (!diffGate.H2_OR_ONLY_DELTA_IS_PARAGRAPH_CLAUSE_REMOVAL) {
    console.log(JSON.stringify({ STOP: "DIFF_GATE_FAIL" }, null, 2));
    process.exit(2);
  }

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
    console.log(JSON.stringify({ STOP: "OPENROUTER_API_KEY_MISSING" }, null, 2));
    process.exit(2);
  }

  const started = Date.now();
  const res = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildOpenRouterHeaders(apiKey),
    body: h2FrozenBytes,
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

  const t3User = readFileSync(join(FROZEN, "T3-USER_RAW.txt"), "utf8");
  const t1Visible = readFileSync(join(FROZEN, "T1-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t2Visible = readFileSync(join(FROZEN, "T2-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const t2User = readFileSync(join(FROZEN, "T2-USER_RAW.txt"), "utf8");
  const t3Gold = readFileSync(join(FROZEN, "T3-ASSISTANT_PERSISTED_VISIBLE.txt"), "utf8");
  const a629 = readFileSync(join(FROZEN, "T3-A-629-OPENROUTER-PERSISTED.txt"), "utf8");
  const h1 = readFileSync(join(FROZEN, "T3-H1-626-OPENROUTER-PERSISTED.txt"), "utf8");

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
  const alarms = alarmCandidates(persistedEquivalent, consumed.finishReason);
  const h2Metrics = objectiveMetrics(persistedEquivalent);

  const validity = {
    HTTP_STATUS: consumed.httpStatus,
    FINISH_REASON: consumed.finishReason,
    USAGE_PRESENT: consumed.usage != null,
    VISIBLE_CHARS: visibleAssistantDisplayCharCount(persistedEquivalent),
    ENDS_COMPLETE_SENTENCE: endsAtCompleteSentence(persistedEquivalent),
    RAW_SHA: sha256Text(consumed.rawText),
    NON_EMPTY: persistedEquivalent.trim().length > 0,
    H2_REPLACEMENT_VALID:
      consumed.httpStatus === 200 &&
      consumed.finishReason === "stop" &&
      endsAtCompleteSentence(persistedEquivalent) &&
      persistedEquivalent.trim().length > 0,
  };

  save("responses/H2-OPENROUTER-REPLACEMENT-RAW.txt", consumed.rawText);
  save("responses/H2-OPENROUTER-REPLACEMENT-PERSISTED-EQUIVALENT.txt", persistedEquivalent);
  save("meta/h2-replacement-validity.json", validity);
  save("meta/h2-replacement-provider-accounting.json", {
    TOTAL_PROVIDER_CALLS: 1,
    CI_ATTEMPTED: false,
    DELIVERED_PROVIDER: "openrouter",
    ...validity,
    elapsed_ms: Date.now() - started,
  });
  save("meta/h2-replacement-usage.json", consumed.usage ?? null);
  save("meta/h2-replacement-alarms.json", alarms);
  save("meta/h2-replacement-dialogue-attribution.json", dialogueAudit);
  save("meta/h2-replacement-t2-replay.json", t2Replay);

  console.log(JSON.stringify(validity, null, 2));

  if (!validity.H2_REPLACEMENT_VALID) {
    save("meta/FINAL_REPORT.json", {
      H2_REPLACEMENT_VALID: false,
      diffGate,
      validity,
      STOP_FOR_HUMAN_REVIEW: true,
    });
    process.exit(2);
  }

  const comparison = {
    T1_GEMINI: objectiveMetrics(t1Visible),
    T2_GEMINI: objectiveMetrics(t2Visible),
    T3_GEMINI_GOLD: objectiveMetrics(t3Gold),
    A_629_OPENROUTER: objectiveMetrics(a629),
    H1_626_OPENROUTER: objectiveMetrics(h1),
    H2_REPLACEMENT_OPENROUTER: h2Metrics,
    dialogue: {
      H2_REPLACEMENT: {
        SOURCE_USER_QUOTED_DIALOGUE_COUNT:
          dialogueAudit.SOURCE_USER_QUOTED_DIALOGUE_COUNT,
        NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT:
          dialogueAudit.NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT,
      },
    },
    t2_replay: {
      H2_REPLACEMENT: t2Replay,
    },
    REQUESTED_PROGRESSION_COMPLETED: alarms.REQUESTED_PROGRESSION_COMPLETED,
  };
  save("meta/h2-replacement-objective-metrics.json", comparison);
  save("meta/FINAL_REPORT.json", {
    H2_REPLACEMENT_VALID: true,
    diffGate,
    validity,
    comparison,
    STOP_FOR_HUMAN_REVIEW: true,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
