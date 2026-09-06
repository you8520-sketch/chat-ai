/**
 * Issue 2 — one additional DeepSeek reproduction.
 * Sends the exact frozen B-DEEPSEEK-input.json with no prompt/context/
 * temperature/model/provider/max-token changes.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AUDIT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(AUDIT, "../../..");

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

function sha256(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
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

function alarmCandidates(text, finishReason) {
  const alarms = [];
  if (!String(text || "").trim()) alarms.push("EMPTY_OUTPUT");
  if (/content[_ -]?filter|length|max_tokens|truncated/i.test(String(finishReason || ""))) {
    alarms.push("TRUNCATION");
  }
  if (/(?:SYSTEM|SceneMode|routeTrigger|INTERNAL|OOC:|handoff)/i.test(text)) {
    alarms.push("META_LEAK");
  }
  if (/(?:렌이\s*(?:말했|대답했|속삭였)|렌의\s*입에서)/.test(text)) {
    alarms.push("NEW_USER_DIALOGUE_CANDIDATE");
  }
  if (/(?:렌이\s*(?:일어섰|달려|문을\s*열|옷을\s*벗었))/.test(text)) {
    alarms.push("NEW_USER_ACTION_CANDIDATE");
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

function requestedSceneCompletion(text) {
  const insertion = /삽입|밀어 넣|뿌리까지/.test(text);
  const intercourse = /허리|왕복|찔러|박아/.test(text);
  const destination = /사정|절정|오르가슴/.test(text);
  return {
    insertion_present: insertion,
    intercourse_motion_present: intercourse,
    orgasm_or_ejaculation_present: destination,
    requested_scene_completed: insertion && intercourse && destination,
    requested_destination: "오르가슴까지 이 침대에서",
  };
}

function metrics(text, finishReason, extra = {}) {
  const paras = paragraphs(text);
  const dialogueParas = paras.filter(isDialogueParagraph);
  return {
    visible_chars: text.length,
    paragraph_count: paras.length,
    dialogue_paragraph_count: dialogueParas.length,
    dialogue_paragraph_ratio:
      paras.length === 0 ? 0 : Number((dialogueParas.length / paras.length).toFixed(3)),
    finish_reason: finishReason || null,
    truncated: /length|max_tokens|truncated/i.test(String(finishReason || "")),
    ...requestedSceneCompletion(text),
    alarm_candidates: alarmCandidates(text, finishReason),
    ...extra,
  };
}

function ownerCheck(bodyJson) {
  const lastUser =
    [...bodyJson.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const all = JSON.stringify(bodyJson);
  const LENGTH_OWNER =
    "이번 응답은 한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다";
  const DIALOGUE_OWNER = "AI 측 직접 발화는 필요한 만큼 사용하되 최대 4개 블록으로 구성한다";
  const CONTINUATION = "현재 사용자 턴이 확정한 장면 다음부터 이어 쓴다";
  return {
    HANDOFF_LENGTH_OWNER_PRESENT: lastUser.includes(LENGTH_OWNER),
    HANDOFF_DIALOGUE_OWNER_PRESENT: lastUser.includes(DIALOGUE_OWNER),
    HANDOFF_CONTINUATION_PRESENT: all.includes(CONTINUATION),
    length_owner_count: (all.match(/3,200자 이상을 기본 목표로/g) || []).length,
    dialogue_owner_count: (all.match(/최대 4개 블록/g) || []).length,
    model: bodyJson.model,
    temperature: bodyJson.temperature,
    top_p: bodyJson.top_p,
    max_tokens: bodyJson.max_tokens ?? null,
    thinking: bodyJson.thinking ?? null,
    reasoning_effort: bodyJson.reasoning_effort ?? null,
  };
}

loadEnvLocal();
const apiKey = process.env.CHEAPER_INFERENCE_API_KEY?.trim();
if (!apiKey) {
  throw new Error("CHEAPER_INFERENCE_API_KEY missing");
}

const rawBody = readFileSync(join(AUDIT, "requests/B-DEEPSEEK-input.json"));
const bodyText = rawBody.toString("utf8");
const bodyJson = JSON.parse(bodyText);
const firstRaw = readFileSync(join(AUDIT, "raw/B-DEEPSEEK-RAW.txt"), "utf8");
const firstMeta = JSON.parse(readFileSync(join(AUDIT, "meta/B-DEEPSEEK-provider.json"), "utf8"));

const owners = ownerCheck(bodyJson);
if (bodyJson.model !== "deepseek-v4-pro-0813") {
  throw new Error(`refusing to send unexpected model ${bodyJson.model}`);
}

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

const latencyMs = Date.now() - started;
let content = "";
let finishReason = "";
let usage = null;
let model = "";
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
  if (typeof json.model === "string" && json.model) model = json.model;
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const delta = choice?.delta ?? choice?.message ?? {};
  if (typeof delta.content === "string") content += delta.content;
  if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
    finishReason = choice.finish_reason;
  }
  if (json.usage && typeof json.usage === "object") usage = json.usage;
}

const first = metrics(firstRaw, firstMeta.finishReason, {
  source: "B2-first",
  raw_sha: firstMeta.rawSha,
});
const second = metrics(content, finishReason, {
  source: "B2-second",
  raw_sha: sha256(content),
  request_sha: sha256(bodyText),
  frozen_request_sha: sha256(bodyText),
  http_status: res.status,
  model: model || bodyJson.model,
  usage,
  ttft_ms: ttftMs,
  latency_ms: latencyMs,
});

const sameClassRepeats =
  second.visible_chars < 3200 &&
  second.dialogue_paragraph_count > 4 &&
  second.requested_scene_completed === false;

const comparison = {
  owners,
  first,
  second,
  deltas: {
    visible_chars: second.visible_chars - first.visible_chars,
    dialogue_paragraph_count:
      second.dialogue_paragraph_count - first.dialogue_paragraph_count,
    paragraph_count: second.paragraph_count - first.paragraph_count,
    finish_reason_same: first.finish_reason === second.finish_reason,
    requested_scene_completed_first: first.requested_scene_completed,
    requested_scene_completed_second: second.requested_scene_completed,
  },
  same_class_repeats: sameClassRepeats,
  stop_for_human_review: sameClassRepeats,
  notes: [
    "No prose similarity or quality score.",
    "No prompt/context/temperature/model/provider/max-token change.",
    "Same-class repeat = materially under 3200 AND >4 dialogue blocks AND requested scene incomplete.",
  ],
};

mkdirSync(join(AUDIT, "raw"), { recursive: true });
mkdirSync(join(AUDIT, "meta"), { recursive: true });
writeFileSync(join(AUDIT, "raw/B-DEEPSEEK-RAW-2.txt"), content, "utf8");
writeFileSync(join(AUDIT, "raw/B-DEEPSEEK-WIRE-2.txt"), wire, "utf8");
writeFileSync(
  join(AUDIT, "meta/B-DEEPSEEK-2-provider.json"),
  JSON.stringify(
    {
      id: "B2-repro-2",
      url: "https://api.cheaperinference.com/v1/chat/completions",
      method: "POST",
      status: res.status,
      model: model || bodyJson.model,
      requestSha: sha256(bodyText),
      frozenRequestSha: sha256(bodyText),
      rawSha: sha256(content),
      ttftMs,
      latencyMs,
      finishReason,
      usage,
      visibleChars: content.length,
      capturedAt: new Date().toISOString(),
    },
    null,
    2
  ) + "\n",
  "utf8"
);
writeFileSync(
  join(AUDIT, "ISSUE2-B2-HANDOFF-REPRO.json"),
  JSON.stringify(comparison, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  owners,
  first: {
    visible_chars: first.visible_chars,
    dialogue_paragraph_count: first.dialogue_paragraph_count,
    paragraph_count: first.paragraph_count,
    finish_reason: first.finish_reason,
    requested_scene_completed: first.requested_scene_completed,
  },
  second: {
    visible_chars: second.visible_chars,
    dialogue_paragraph_count: second.dialogue_paragraph_count,
    paragraph_count: second.paragraph_count,
    finish_reason: second.finish_reason,
    requested_scene_completed: second.requested_scene_completed,
    alarm_candidates: second.alarm_candidates,
    http_status: res.status,
    latency_ms: latencyMs,
  },
  same_class_repeats: sameClassRepeats,
}, null, 2));
