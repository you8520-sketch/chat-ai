/**
 * Issue 2 — C1 isolation: terminal dialogue budget line 2 only.
 * Frozen Phase-1 B2 request; original accepted handoff owner unchanged.
 * Does NOT modify production scenePacingController.ts.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUDIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(AUDIT, "../../..");

const FROZEN_REF =
  "origin/cursor/gemini31-deepseek-refusal-handoff-p1-9eb2:docs/audits/gemini31-deepseek-refusal-handoff-p1/requests/B-DEEPSEEK-input.json";

const TERMINAL_LINE_1 =
  "AI 측 직접 발화는 필요한 만큼 사용하되 최대 4개 블록으로 구성한다.";

const TERMINAL_LINE_2_OLD =
  "유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고, [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다.";

const TERMINAL_LINE_2_C1 = `현재 입력이 행동·의사와 진행 방향을 이미 확정했다면
그 범위를 재확인 없이 직접 진행하고,
현재 입력 밖의 [B] 새 직접 발화·정본을 바꾸는 중대한 선택만
유저에게 남긴다.`;

const ACCEPTED_HANDOFF_MARKER =
  "현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다. 직전 assistant의 말투·유머·호칭·문장 호흡·대사/서술 균형";

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
  const motion = /허리|왕복|찈러|박아/.test(text);
  const destination = /사정|절정|오르가슴|정점.*터|쏟아/.test(text);
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

function turnEndingUserCheckpointCandidate(text) {
  const paras = paragraphs(text);
  if (paras.length === 0) return false;
  const ending = paras.slice(-2).join("\n\n");
  const questionDialogue =
    /[""「『][^""」』\n]{0,160}\?[\s""」』]*$/.test(ending.trim()) ||
    /[""「『][^""」』\n]{0,160}(?:해도\s*돼|괜찮|갈\s*거지|끝까지|더\s*세게|원해|어때|할\s*거야)\??[\s""」』]*$/i.test(
      ending.trim()
    );
  const waitsForUser =
    /(?:대답|반응|허락).{0,24}(?:기다|물었|확인)|(?:기다리(?:며|고)|물었(?:다|으며))/.test(
      ending
    );
  return questionDialogue || (questionDialogue && waitsForUser) || waitsForUser;
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
const userMsg = frozenJson.messages.find((m) => m.role === "user");
const systemMsg = frozenJson.messages.find((m) => m.role === "system");
if (!userMsg?.content || !systemMsg?.content) {
  throw new Error("frozen B2 request missing system/user messages");
}
if (!systemMsg.content.includes(ACCEPTED_HANDOFF_MARKER)) {
  throw new Error("frozen B2 request missing accepted production handoff owner");
}
if (!userMsg.content.includes(TERMINAL_LINE_1)) {
  throw new Error("frozen B2 request missing terminal line 1");
}
if (!userMsg.content.includes(TERMINAL_LINE_2_OLD)) {
  throw new Error("frozen B2 request missing terminal line 2 (OLD)");
}
if (userMsg.content.includes(TERMINAL_LINE_2_C1.replace(/\n/g, " "))) {
  throw new Error("frozen B2 request already contains C1 line 2");
}

const beforeUser = userMsg.content;
userMsg.content = userMsg.content.replace(TERMINAL_LINE_2_OLD, TERMINAL_LINE_2_C1);
if (userMsg.content === beforeUser) {
  throw new Error("terminal line 2 patch did not apply");
}
if (!userMsg.content.includes(TERMINAL_LINE_1)) {
  throw new Error("terminal line 1 missing after patch");
}
if (userMsg.content.includes(TERMINAL_LINE_2_OLD)) {
  throw new Error("terminal line 2 OLD still present after patch");
}
if (!userMsg.content.includes("재확인 없이 직접 진행")) {
  throw new Error("C1 line 2 missing after patch");
}

const bodyText = JSON.stringify(frozenJson);
mkdirSync(join(AUDIT, "requests"), { recursive: true });
writeFileSync(join(AUDIT, "requests/B-DEEPSEEK-input-c1.json"), bodyText, "utf8");

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
  experiment: "issue2-c1-terminal-dialogue-line2-only",
  owner_changed: "terminal_dialogue_budget_line_2 (harness patch only)",
  production_code_changed: false,
  handoff_owner_changed: false,
  terminal_line_1_unchanged: true,
  shared_3200_owner_changed: false,
  frozen_base_request_sha: sha256(frozenRaw),
  experimental_request_sha: sha256(bodyText),
  raw_sha: sha256(content),
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
  turn_ending_user_checkpoint_candidate: turnEndingUserCheckpointCandidate(content),
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
writeFileSync(join(AUDIT, "raw/B-DEEPSEEK-C1-RAW.txt"), content, "utf8");
writeFileSync(join(AUDIT, "raw/B-DEEPSEEK-C1-WIRE.txt"), wire, "utf8");
writeFileSync(
  join(AUDIT, "ISSUE2-C1-EXPERIMENT-REPORT.json"),
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

const md = `# Issue 2 — C1 terminal dialogue budget experiment report

**STOP for human/ChatGPT review.**

## Single change (frozen harness only)

Replaced terminal dialogue budget **line 2** only. Production \`renderTerminalDialogueBudgetOwner()\` unchanged.
Original accepted handoff owner unchanged.

## Metrics

| Metric | C1 experiment |
|---|---:|
| visible_chars | ${report.visible_chars} |
| paragraph_count | ${report.paragraph_count} |
| dialogue_blocks | ${report.dialogue_blocks} |
| dialogue_ratio | ${report.dialogue_ratio} |
| finish_reason | ${report.finish_reason} |
| requested_progression_completed | ${report.requested_progression_completed} |
| redundant_confirmation_candidate | ${report.redundant_confirmation_candidate} |
| turn_ending_user_checkpoint_candidate | ${report.turn_ending_user_checkpoint_candidate} |
| user_preemption_candidate | ${report.user_preemption_candidate} |
| user_agency_consistency_candidate | ${report.user_agency_consistency_candidate} |
| repetition_candidate | ${report.repetition_candidate} |
| canon_contradiction_candidate | ${report.canon_contradiction_candidate} |

## SHAs

- frozen_base_request_sha: \`${report.frozen_base_request_sha}\`
- experimental_request_sha: \`${report.experimental_request_sha}\`
- raw_sha: \`${report.raw_sha}\`

## Baseline comparison (Phase-1 B2, original terminal line 2)

| Metric | Run 1 | Run 2 | #609 handoff exp | C1 |
|---|---:|---:|---:|---:|
| visible_chars | 1701 | 2346 | 2569 | ${report.visible_chars} |
| dialogue_blocks | 8 | 10 | 14 | ${report.dialogue_blocks} |
| requested_progression | no | yes | no | ${report.requested_progression_completed ? "yes" : "no"} |
| redundant_confirmation | — | — | yes | ${report.redundant_confirmation_candidate ? "yes" : "no"} |
| turn_ending_checkpoint | — | — | — | ${report.turn_ending_user_checkpoint_candidate ? "yes" : "no"} |
`;

writeFileSync(join(AUDIT, "ISSUE2-C1-EXPERIMENT-REPORT.md"), md, "utf8");
writeFileSync(
  join(AUDIT, "meta/B-DEEPSEEK-C1-provider.json"),
  JSON.stringify(
    {
      requestSha: sha256(bodyText),
      rawSha: sha256(content),
      finishReason,
      visibleChars: content.length,
      capturedAt: new Date().toISOString(),
      url: "https://api.cheaperinference.com/v1/chat/completions",
      method: "POST",
      status: res.status,
      ...report,
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
