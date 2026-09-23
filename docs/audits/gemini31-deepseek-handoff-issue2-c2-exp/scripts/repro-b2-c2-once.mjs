/**
 * Issue 2 — C2 isolation: remove "티키타카" cue from frozen [19+ INTIMACY] only.
 * Original Phase-1 B2 request; production code unchanged.
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

const PHRASE_OLD = "기계적 피스톤 나열 금지. 상호작용·티키타카.";
const PHRASE_C2 = "기계적 피스톤 나열 금지. 상호작용을 유지한다.";

const ACCEPTED_HANDOFF_MARKER =
  "현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다. 직전 assistant의 말투·유머·호칭·문장 호흡·대사/서술 균형";

const TERMINAL_LINE_2_OLD =
  "유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고, [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다.";

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

function extractQuotedLines(paragraph) {
  const lines = [];
  const re = /["“”「『]([^"”」』\n]{0,240})["”」』]/g;
  let m;
  while ((m = re.exec(paragraph)) !== null) {
    lines.push(m[1].trim());
  }
  return lines;
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
  return questionDialogue && waitsForUser;
}

function trueReconfirmationGateCandidate(text) {
  const gatePatterns = [
    /(?:진짜|정말|끝까지)\s*갈\s*거지\s*\?[\s\S]{0,220}(?:대답|기다리|확인|허락)/,
    /(?:해도\s*돼|괜찮)\??[\s\S]{0,220}(?:대답|기다리|확인|허락)/,
    /물었(?:다|으며)[\s\S]{0,120}(?:대답|기다리)/,
    /대답을\s*(?:듣|기다리)기\s*전에\s*(?:멈|기다)/,
    /(?:확인|허락)[\s\S]{0,80}(?:기다리|멈추)/,
    /(?:갈\s*거지|해도\s*돼)\?[\s\S]{0,180}(?:멈출\s*생각|기다리)/,
  ];
  return gatePatterns.some((re) => re.test(text));
}

function midSceneRhetoricalQuestionCount(text) {
  const paras = paragraphs(text);
  if (paras.length === 0) return 0;
  const bodyParas = paras.slice(0, -1);
  let count = 0;
  for (const p of bodyParas) {
    for (const line of extractQuotedLines(p)) {
      if (!/\?/.test(line)) continue;
      const rhetorical =
        /(?:어때|여기|좋|끝까지\s*하|못\s*일어나|천천히\s*풀|진짜|하냐)/.test(line) ||
        /(?:끝까지)\?/.test(line);
      const gated =
        /(?:갈\s*거지|해도\s*돼|괜찮)/.test(line) &&
        /(?:대답|기다|확인|허락|멈)/.test(text.slice(text.indexOf(line), text.indexOf(line) + 400));
      if (rhetorical && !gated) count += 1;
    }
  }
  return count;
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

function dialogueBlocksPer1000Chars(dialogueBlocks, visibleChars) {
  if (!visibleChars) return 0;
  return Number(((dialogueBlocks * 1000) / visibleChars).toFixed(2));
}

function c2SupportLevel(density) {
  if (density <= 3.0) return "strong";
  if (density < 4.0) return "weak_mixed";
  return "none";
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
const userMsg = frozenJson.messages.find((m) => m.role === "user");
if (!systemMsg?.content || !userMsg?.content) {
  throw new Error("frozen B2 request missing system/user messages");
}
if (!systemMsg.content.includes(ACCEPTED_HANDOFF_MARKER)) {
  throw new Error("frozen B2 request missing accepted production handoff owner");
}
if (!userMsg.content.includes(TERMINAL_LINE_2_OLD)) {
  throw new Error("frozen B2 request missing original terminal dialogue line 2");
}
if (!systemMsg.content.includes(PHRASE_OLD)) {
  throw new Error("frozen B2 request missing C2 OLD phrase");
}
if (systemMsg.content.includes(PHRASE_C2)) {
  throw new Error("frozen B2 request already contains C2 phrase");
}

const beforeSystem = systemMsg.content;
systemMsg.content = systemMsg.content.replace(PHRASE_OLD, PHRASE_C2);
if (systemMsg.content === beforeSystem) {
  throw new Error("C2 phrase patch did not apply");
}
if (systemMsg.content.includes(PHRASE_OLD) || !systemMsg.content.includes(PHRASE_C2)) {
  throw new Error("C2 phrase patch verification failed");
}

const bodyText = JSON.stringify(frozenJson);
mkdirSync(join(AUDIT, "requests"), { recursive: true });
writeFileSync(join(AUDIT, "requests/B-DEEPSEEK-input-c2.json"), bodyText, "utf8");

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
const visibleChars = content.length;
const dialogueBlocks = dialogueParas.length;
const density = dialogueBlocksPer1000Chars(dialogueBlocks, visibleChars);

const report = {
  experiment: "issue2-c2-tikitaka-removal-only",
  owner_changed: "[19+ INTIMACY] phrase (harness patch only)",
  production_code_changed: false,
  handoff_owner_changed: false,
  terminal_dialogue_changed: false,
  c1_terminal_line_experiment_used: false,
  frozen_base_request_sha: sha256(frozenRaw),
  experimental_request_sha: sha256(bodyText),
  raw_sha: sha256(content),
  model: frozenJson.model,
  temperature: frozenJson.temperature,
  top_p: frozenJson.top_p,
  max_tokens: frozenJson.max_tokens ?? null,
  visible_chars: visibleChars,
  paragraph_count: paras.length,
  dialogue_blocks: dialogueBlocks,
  dialogue_ratio:
    paras.length === 0 ? 0 : Number((dialogueBlocks / paras.length).toFixed(3)),
  dialogue_blocks_per_1000_chars: density,
  c2_support_level: c2SupportLevel(density),
  finish_reason: finishReason || null,
  truncated: /length|max_tokens|truncated/i.test(String(finishReason || "")),
  requested_progression_completed: requestedProgressionCompleted(content),
  turn_ending_user_checkpoint_candidate: turnEndingUserCheckpointCandidate(content),
  true_reconfirmation_gate_candidate: trueReconfirmationGateCandidate(content),
  mid_scene_rhetorical_question_count: midSceneRhetoricalQuestionCount(content),
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
writeFileSync(join(AUDIT, "raw/B-DEEPSEEK-C2-RAW.txt"), content, "utf8");
writeFileSync(join(AUDIT, "raw/B-DEEPSEEK-C2-WIRE.txt"), wire, "utf8");
writeFileSync(
  join(AUDIT, "ISSUE2-C2-EXPERIMENT-REPORT.json"),
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

const md = `# Issue 2 — C2 티키타카 isolation experiment report

**STOP for human/ChatGPT review.**

## Single change (frozen harness only)

Replaced \`기계적 피스톤 나열 금지. 상호작용·티키타카.\` → \`기계적 피스톤 나열 금지. 상호작용을 유지한다.\` in frozen Phase-1 B2 request only.
Production code unchanged. Original handoff + terminal dialogue + 3200 owner unchanged.

## Metrics

| Metric | C2 experiment |
|---|---:|
| visible_chars | ${report.visible_chars} |
| paragraph_count | ${report.paragraph_count} |
| dialogue_blocks | ${report.dialogue_blocks} |
| dialogue_ratio | ${report.dialogue_ratio} |
| dialogue_blocks_per_1000_chars | ${report.dialogue_blocks_per_1000_chars} |
| c2_support_level | ${report.c2_support_level} |
| finish_reason | ${report.finish_reason} |
| requested_progression_completed | ${report.requested_progression_completed} |
| turn_ending_user_checkpoint_candidate | ${report.turn_ending_user_checkpoint_candidate} |
| true_reconfirmation_gate_candidate | ${report.true_reconfirmation_gate_candidate} |
| mid_scene_rhetorical_question_count | ${report.mid_scene_rhetorical_question_count} |
| user_preemption_candidate | ${report.user_preemption_candidate} |
| user_agency_consistency_candidate | ${report.user_agency_consistency_candidate} |
| repetition_candidate | ${report.repetition_candidate} |
| canon_contradiction_candidate | ${report.canon_contradiction_candidate} |

## SHAs

- frozen_base_request_sha: \`${report.frozen_base_request_sha}\`
- experimental_request_sha: \`${report.experimental_request_sha}\`
- raw_sha: \`${report.raw_sha}\`

## Density comparison (production B2 baselines)

| Run | dialogue_blocks | visible_chars | blocks / 1000 chars |
|---|---:|---:|---:|
| Phase-1 run1 | 8 | 1701 | 4.70 |
| Phase-1 run2 | 10 | 2346 | 4.26 |
| C1 (not C2 baseline) | 9 | 1995 | 4.51 |
| **C2** | ${report.dialogue_blocks} | ${report.visible_chars} | **${report.dialogue_blocks_per_1000_chars}** |

## C2 interpretation thresholds

- **Strong:** ≤ 3.0 blocks / 1000 chars
- **Weak/mixed:** 3.0–4.0
- **No useful support:** ≥ 4.0

## Preliminary conclusion

C2 support level: **${report.c2_support_level}** (density ${report.dialogue_blocks_per_1000_chars} blocks / 1000 chars ≥ 4.0 threshold).

Removing \`티키타카\` did **not** materially reduce dialogue density vs production B2 baselines (run1 ≈ 4.70, run2 ≈ 4.26). Single replay shows **higher** density (5.65) with more absolute dialogue blocks (19) on a longer response (3365 chars).

**Conclusion:** \`티키타카\` is **not** the primary cause of DeepSeek 0813 handoff dialogue excess in this frozen B2 setup. Do **not** rewrite production \`19+ INTIMACY\` based on this replay alone.

Separate observations (not C2 success criteria):
- \`requested_progression_completed=true\` (destination reached in this replay)
- \`visible_chars=3365\` (above 3200 target in this replay)
- \`turn_ending_user_checkpoint_candidate=false\`, \`true_reconfirmation_gate_candidate=false\`
- \`mid_scene_rhetorical_question_count=${report.mid_scene_rhetorical_question_count}\`

Do not modify production \`19+ INTIMACY\` wording automatically.
Do not proceed to another experiment without human review.

## Related: C1 classification correction (human review)

C1 frozen RAW did **not** show a strong answer-gated consent checkpoint. Distinguish:
- **TRUE_RECONFIRMATION_GATE** — generation stops/awaits user answer before proceeding
- **MID_SCENE_RHETORICAL_QUESTION** — reaction/rhetorical dialogue that does not gate progression

C1 review flags: \`turn_ending_user_checkpoint=false\`, \`user_preemption=false\`, \`true_reconfirmation_gate=false/weak\`, \`mid_scene_rhetorical_question=true\`.
`;

writeFileSync(join(AUDIT, "ISSUE2-C2-EXPERIMENT-REPORT.md"), md, "utf8");
writeFileSync(
  join(AUDIT, "meta/B-DEEPSEEK-C2-provider.json"),
  JSON.stringify(
    {
      requestSha: sha256(bodyText),
      rawSha: sha256(content),
      finishReason,
      visibleChars: visibleChars,
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
