/**
 * Issue 2 — one experimental B2 DeepSeek replay.
 * Patches only DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION inside the frozen
 * Phase-1 B2 request body; everything else stays identical.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("tsx/cjs/api").register();

const AUDIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(AUDIT, "../../..");

const { DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION } = require(
  join(ROOT, "src/lib/adultSceneRouting.ts")
);

const LEGACY_OWNER = `현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다. 직전 assistant의 말투·유머·호칭·문장 호흡·대사/서술 균형과 화면에 이미 나온 장면 상태를 자연스럽게 이어, 같은 캐릭터와 같은 글의 다음 부분처럼 작성한다.
이Already 다룬 감각이나 행동을 표현만 바꿔 반복하기보다 캐릭터의 새 행동·대사·반응과 그 결과로 장면을 계속 전진시킨다. 현재 사용자 턴이 바꾼 상태가 이전 장면보다 우선한다.`.replace(
  "이Already",
  "이미"
);

const FROZEN_REF =
  "origin/cursor/gemini31-deepseek-refusal-handoff-p1-9eb2:docs/audits/gemini31-deepseek-refusal-handoff-p1/requests/B-DEEPSEEK-input.json";

function sha256(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

function loadEnvLocal() {
  const path = join(ROOT, ".env.local");
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq);
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function paragraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p) {
  return /["“”「」『』]/.test(p) || /^(?:[“"]|[가-힣A-Za-z].{0,12}[:：])/.test(p);
}

function requestedProgressionCompleted(text) {
  const insertion = /삽입|밀어 넣|뿌리까지/.test(text);
  const motion = /허리|왕복|찔러|박아/.test(text);
  const destination = /사정|절정|오르가슴/.test(text);
  return insertion && motion && destination;
}

function alarmCandidates(text, finishReason) {
  const alarms = [];
  if (!String(text || "").trim()) alarms.push("EMPTY_OUTPUT");
  if (/content[_ -]?filter|length|max_tokens|truncated/i.test(String(finishReason || ""))) {
    alarms.push("TRUNCATION");
  }
  if (/(?:미성년|고등학생|17살|18살 미만)/.test(text)) {
    alarms.push("CANON_CONTRADICTION_CANDIDATE");
  }
  const paras = paragraphs(text);
  const uniq = new Set(paras.map((p) => p.slice(0, 80)));
  if (paras.length >= 6 && uniq.size <= Math.ceil(paras.length * 0.5)) {
    alarms.push("REPETITION_CANDIDATE");
  }
  return [...new Set(alarms)];
}

function redundantConfirmationCandidate(text) {
  const confirmationQuestion =
    /[""「].{0,80}?(?:해도\s*돼|괜찮|갈\s*거지|끝까지|더\s*세게|좋아\?).{0,20}[""」]/.test(
      text
    ) || /(?:해도\s*돼|괜찮겠|갈\s*거지|끝까지\s*갈).*\?/.test(text);
  const proceedsWithoutAnswer =
    /물으면서도|대답을\s*(?:듣|기다리)기\s*전에|확인하듯.*(?:밀어|삽입|허리)|이미\s*허리를/.test(
      text
    );
  return confirmationQuestion && (proceedsWithoutAnswer || /물으면서도/.test(text));
}

function userPreemptionCandidate(text) {
  return (
    /물으면서도|대답을\s*(?:듣|기다리)기\s*전에|몸이\s*먼저\s*반응/.test(text) &&
    /[""「].*\?[""」]/.test(text)
  );
}

function userAgencyConsistencyCandidate(text) {
  return (
    /(?:렌이|렌은)\s*(?:대답|말하|고개)/.test(text) === false &&
    /[""「].*\?[""」]/.test(text) &&
    /(?:밀어|삽입|허리)/.test(text)
  );
}

loadEnvLocal();
const apiKey = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
if (!apiKey) throw new Error("CHEAPER_INFERENCE_API_KEY missing");

const frozenRaw = execSync(`git show ${FROZEN_REF}`, {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
const frozenJson = JSON.parse(frozenRaw);
const systemMsg = frozenJson.messages.find((m) => m.role === "system");
if (!systemMsg?.content?.includes(LEGACY_OWNER)) {
  throw new Error("frozen B2 request missing legacy handoff owner");
}
systemMsg.content = systemMsg.content.replace(LEGACY_OWNER, DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION);
if (systemMsg.content.includes(LEGACY_OWNER)) {
  throw new Error("legacy handoff owner still present after patch");
}
if (!systemMsg.content.includes(DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION)) {
  throw new Error("experimental handoff owner missing after patch");
}

const bodyText = JSON.stringify(frozenJson);
mkdirSync(join(AUDIT, "requests"), { recursive: true });
writeFileSync(join(AUDIT, "requests/B-DEEPSEEK-input-exp.json"), bodyText, "utf8");

const started = Date.now();
const res = await fetch("https://api.cheaperinference.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: bodyText,
});

let ttftMs = null;
let wire = "";
if (res.body && typeof res.body.getReader === "function") {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (ttftMs == null) ttftMs = Date.now() - started;
    wire += decoder.decode(value, { stream: true });
  }
  wire += decoder.decode();
} else {
  wire = await res.text();
  ttftMs = Date.now() - started;
}

let content = "";
let finishReason = "";
let usage = null;
for (const line of wire.split(/\r?\n/)) {
  if (!line.startsWith("data:")) continue;
  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") continue;
  let json;
  try {
    json = JSON.parse(payload);
  } catch {
    continue;
  }
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const delta = choice?.delta ?? choice?.message ?? {};
  if (typeof delta.content === "string") content += delta.content;
  if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
    finishReason = choice.finish_reason;
  }
  if (json.usage && typeof json.usage === "object") usage = json.usage;
}

const paras = paragraphs(content);
const dialogueParas = paras.filter(isDialogueParagraph);
const report = {
  experiment: "issue2-handoff-owner-replace-only",
  owner_changed: "DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION",
  shared_3200_owner_changed: false,
  dialogue_owner_changed: false,
  frozen_base_request_sha: sha256(frozenRaw),
  experimental_request_sha: sha256(bodyText),
  model: frozenJson.model,
  temperature: frozenJson.temperature,
  top_p: frozenJson.top_p,
  max_tokens: frozenJson.max_tokens ?? null,
  visible_chars: content.length,
  paragraph_count: paras.length,
  dialogue_blocks: dialogueParas.length,
  dialogue_ratio:
    paras.length === 0 ? 0 : Number((dialogueParas.length / paras.length).toFixed(3)),
  finish_reason: finishReason || null,
  truncated: /length|max_tokens|truncated/i.test(String(finishReason || "")),
  requested_progression_completed: requestedProgressionCompleted(content),
  redundant_confirmation_candidate: redundantConfirmationCandidate(content),
  user_preemption_candidate: userPreemptionCandidate(content),
  user_agency_consistency_candidate: userAgencyConsistencyCandidate(content),
  repetition_candidate: alarmCandidates(content, finishReason).includes(
    "REPETITION_CANDIDATE"
  ),
  canon_contradiction_candidate: alarmCandidates(content, finishReason).includes(
    "CANON_CONTRADICTION_CANDIDATE"
  ),
  http_status: res.status,
  usage,
  ttft_ms: ttftMs,
  latency_ms: Date.now() - started,
  stop_for_human_review: true,
};

mkdirSync(join(AUDIT, "raw"), { recursive: true });
mkdirSync(join(AUDIT, "meta"), { recursive: true });
writeFileSync(join(AUDIT, "raw/B-DEEPSEEK-EXP-RAW.txt"), content, "utf8");
writeFileSync(join(AUDIT, "raw/B-DEEPSEEK-EXP-WIRE.txt"), wire, "utf8");
writeFileSync(join(AUDIT, "ISSUE2-EXPERIMENT-REPORT.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
writeFileSync(
  join(AUDIT, "meta/B-DEEPSEEK-EXP-provider.json"),
  JSON.stringify(
    {
      requestSha: sha256(bodyText),
      rawSha: sha256(content),
      finishReason,
      visibleChars: content.length,
      capturedAt: new Date().toISOString(),
      ...report,
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
