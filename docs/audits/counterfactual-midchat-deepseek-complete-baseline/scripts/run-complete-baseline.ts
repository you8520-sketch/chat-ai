#!/usr/bin/env npx tsx
/**
 * Complete-baseline replay of the #621 counterfactual DeepSeek request.
 * Evidence only. No production code changes. One DeepSeek V4 Pro 0813 call
 * only if the frozen #621 request SHA matches.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../../../../scripts/lib/server-only-mock";
import { loadEnvLocal } from "../../../../scripts/load-env-local";
import {
  collectProductionAlignedSse,
  evaluateStreamComplete,
} from "./collect-production-aligned-sse.ts";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const OUT = join(ROOT, "docs/audits/counterfactual-midchat-deepseek-complete-baseline");
const SOURCE621 = join(OUT, "source-621");
const PREVIOUS_REQUEST_SHA =
  "85ae4e16ba3e002dc1dcd84911f3263c68679904e5d3316a0f365fd084003731";
const PRIMARY_MEDIAN_VISIBLE_CHARS = 3323;
const T3_GEMINI_GOLD_VISIBLE_CHARS = 2651;
const AUDIT_ONLY = process.argv.includes("--audit-only");

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

function flattenMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "object" && b && "text" in b ? String((b as { text?: unknown }).text) : ""))
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
    TRUNCATION: /content[_ -]?filter|length|max_tokens|truncated/i.test(
      String(finishReason || "")
    ),
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
  };
}

function scanOwners(wire: string, lastUser: string) {
  return {
    DEEPSEEK_STYLE_REMINDER_ACTIVE: wire.includes("[System Reminder: 지문은 -다/-했다체"),
    HANDOFF_CONTINUATION_OWNER_ACTIVE: wire.includes(
      "현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다"
    ),
    INTIMACY_OWNER_ACTIVE: wire.includes("[19+ INTIMACY]"),
    USER_TAIL_3200_ACTIVE: lastUser.includes("한국어 3,200자 이상을 기본 목표"),
    TERMINAL_DIALOGUE_OWNER_ACTIVE: wire.includes("[이번 응답 대화]"),
    CREATOR_OPENING_AS_ASSISTANT_STYLE_EXEMPLAR: false,
    CREATOR_OPENING_REMAP_PRESENT: wire.includes(
      "[OPENING SCENE CONTEXT — ALREADY OCCURRED]"
    ),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const requestBody = JSON.parse(
    readFileSync(join(SOURCE621, "COUNTERFACTUAL_DEEPSEEK-input.json"), "utf8")
  ) as Record<string, unknown>;
  const requestSha = sha256(JSON.stringify(requestBody));
  const shaMatch = requestSha === PREVIOUS_REQUEST_SHA;

  const messages = (requestBody.messages as Array<{ role?: string; content?: unknown }>) ?? [];
  const wire = messages.map((m) => flattenMessageContent(m.content)).join("\n");
  const lastUser = flattenMessageContent(messages.at(-1)?.content);
  const owners = scanOwners(wire, lastUser);
  save("meta/request-sha-gate.json", {
    PREVIOUS_REQUEST_SHA,
    CURRENT_REQUEST_SHA: requestSha,
    REQUEST_SHA_MATCH: shaMatch,
    model: requestBody.model,
    temperature: requestBody.temperature ?? null,
    max_tokens: requestBody.max_tokens ?? null,
    stream: requestBody.stream === true,
  });

  if (!shaMatch) {
    save("meta/STOP.json", {
      reason: "REQUEST_SHA_MISMATCH",
      PREVIOUS_REQUEST_SHA,
      CURRENT_REQUEST_SHA: requestSha,
    });
    console.log(JSON.stringify({ REQUEST_SHA_MATCH: false, STOP: true }, null, 2));
    process.exit(2);
  }

  if (AUDIT_ONLY) {
    console.log(JSON.stringify({ REQUEST_SHA_MATCH: true, AUDIT_ONLY: true, owners }, null, 2));
    return;
  }

  const { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, buildCheaperInferenceHeaders } =
    await import("../../../../src/lib/cheaperInferenceConfig");
  const { endsAtCompleteSentence, sanitizeStreamArtifacts } = await import(
    "../../../../src/lib/responseLength"
  );
  const { stripRpMetaLeakage, stripInternalTagLeakage } = await import(
    "../../../../src/lib/narrativeRules"
  );
  const { visibleAssistantDisplayCharCount } = await import(
    "../../../../src/lib/chatDisplayLength"
  );

  console.log("REQUEST_SHA_MATCH=true — one DeepSeek V4 Pro 0813 call");
  const collected = await collectProductionAlignedSse(
    CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
    buildCheaperInferenceHeaders(),
    requestBody,
    240_000
  );

  const endsComplete = endsAtCompleteSentence(collected.text.trim());
  const baselineValid = evaluateStreamComplete({
    httpStatus: collected.HTTP_STATUS,
    sawDone: collected.SSE_DONE_OBSERVED,
    finishReason: collected.FINISH_REASON,
    usage: collected.usage,
    text: collected.text,
    collectorError: collected.COLLECTOR_ERROR,
  });

  const collectionFreeze = {
    HTTP_STATUS: collected.HTTP_STATUS,
    SSE_DONE_OBSERVED: collected.SSE_DONE_OBSERVED,
    FINISH_REASON: collected.FINISH_REASON,
    USAGE_PRESENT: collected.USAGE_PRESENT,
    RAW_CHARS: collected.RAW_CHARS,
    ENDS_AT_COMPLETE_SENTENCE: endsComplete,
    COLLECTOR_ERROR: collected.COLLECTOR_ERROR,
    leftover_flushed: collected.leftover_flushed,
    BASELINE_STREAM_VALID: baselineValid,
    TOTAL_PROVIDER_CALLS_THIS_EXPERIMENT: 1,
  };
  save("meta/collection.json", {
    ...collectionFreeze,
    usage: collected.usage,
    request_sha: requestSha,
    provider_raw_sha: sha256(collected.text),
  });

  save("raw/COMPLETE_BASELINE_DEEPSEEK_PROVIDER_RAW.txt", collected.text);

  if (!baselineValid) {
    save("meta/STOP.json", {
      reason: "BASELINE_STREAM_VALID=false",
      collection: collectionFreeze,
    });
    save("COMPACT_REPORT.json", {
      BASELINE_STREAM_VALID: false,
      ...collectionFreeze,
      owners,
      DEEPSEEK_PROVIDER_CALLS: 1,
      note: "Incomplete provider stream — no style experiment",
    });
    console.log(JSON.stringify({ BASELINE_STREAM_VALID: false, ...collectionFreeze }, null, 2));
    process.exit(2);
  }

  let merged = sanitizeStreamArtifacts(collected.text);
  merged = stripRpMetaLeakage(merged);
  merged = stripInternalTagLeakage(merged);
  const persisted = merged.trim();
  save("raw/COMPLETE_BASELINE_DEEPSEEK_PERSISTED_EQUIVALENT.txt", persisted);

  const dsMetrics = objectiveMetrics(persisted);
  const compact = {
    BASELINE_STREAM_VALID: true,
    TRANSPORT_GATE_PASS: true,
    REQUEST_SHA_MATCH: true,
    PREVIOUS_REQUEST_SHA,
    ...owners,
    DEEPSEEK_PROVIDER_CALLS: 1,
    TOTAL_PROVIDER_CALLS_THIS_EXPERIMENT: 1,
    PRIMARY_MEDIAN_VISIBLE_CHARS,
    T3_GEMINI_GOLD_VISIBLE_CHARS,
    T3_DEEPSEEK_VISIBLE_CHARS: dsMetrics.VISIBLE_CHARS,
    DEEPSEEK_VS_PRIMARY_LENGTH_RATIO: Number(
      (dsMetrics.VISIBLE_CHARS / PRIMARY_MEDIAN_VISIBLE_CHARS).toFixed(4)
    ),
    DEEPSEEK_VS_GEMINI_GOLD_LENGTH_RATIO: Number(
      (dsMetrics.VISIBLE_CHARS / T3_GEMINI_GOLD_VISIBLE_CHARS).toFixed(4)
    ),
    collection: collectionFreeze,
    persisted_equivalent_chars: visibleAssistantDisplayCharCount(persisted),
    metrics: {
      T3_DEEPSEEK_COMPLETE_BASELINE: dsMetrics,
    },
    alarms: {
      T3_DEEPSEEK_COMPLETE_BASELINE: alarmCandidates(persisted, collected.FINISH_REASON),
    },
    production_code_changed: false,
    source_pr: 621,
  };
  save("COMPACT_REPORT.json", compact);
  save("INDEX.json", {
    audit: "counterfactual-midchat-deepseek-complete-baseline",
    source_pr: 621,
    compact: "COMPACT_REPORT.json",
  });
  console.log(JSON.stringify(compact, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
