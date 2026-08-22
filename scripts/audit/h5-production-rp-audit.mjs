/**
 * Evidence-only H5 production RP sampler.
 * Creates 3 fresh private production chats and one user turn each.
 * No retries. No prompt tuning. Not imported by production runtime.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE = "https://chat-ai-production-3e84.up.railway.app";
const EVIDENCE = path.join(process.cwd(), "data/h5-production-rp-audit");
const EMAIL = `h5-audit-${Date.now()}@canary.invalid`;
const PASSWORD = "h5-audit-prod-raw";
const NICK = `h5a${String(Date.now()).slice(-8)}`;
const PERSONA = {
  name: "도윤",
  gender: "male",
  description: "만 29세 성인 남성. 허구 창작 페르소나. 낮고 짧은 말투. 서두르지 않고 상대 호흡을 살핀다.",
};

const INPUTS = JSON.parse(readFileSync(path.join(EVIDENCE, "user-inputs.json"), "utf8"));
const SAMPLES = [
  { key: "A_QUIET", rawName: "A-quiet.txt", ...INPUTS.A_QUIET },
  { key: "B_WORLD_ACTION", rawName: "B-world-action.txt", ...INPUTS.B_WORLD_ACTION },
  { key: "C_ADULT", rawName: "C-adult.txt", ...INPUTS.C_ADULT },
];

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function countHangul(text) {
  return (text.match(/[\uAC00-\uD7A3]/g) ?? []).length;
}
function countParagraphs(text) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).length;
}
function countDialogue(text) {
  return (text.match(/[「“"][^」”"]+[」”"]/g) ?? []).length;
}
function cookieFromSetCookie(header) {
  if (!header) throw new Error("no set-cookie");
  const m = /(?:^|,)\s*session=([^;]+)/i.exec(header);
  if (!m?.[1]) throw new Error(`session cookie missing: ${header.slice(0, 200)}`);
  return m[1];
}

async function postJson(urlPath, body, token) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  return { status: res.status, json, setCookie: res.headers.get("set-cookie") };
}

async function postChat({ token, personaId, sample }) {
  const started = Date.now();
  const body = {
    characterId: sample.character_id,
    selectedPersonaId: personaId,
    message: sample.text,
    isAdultMode: sample.is_adult_mode === true,
    isNsfwMode: sample.is_adult_mode === true,
    adultHandoffEnabled: sample.adult_handoff_enabled === true,
    clientRequestId: `h5_${sample.key}_${Date.now().toString(36)}`,
  };
  if (sample.adult_consent_mode) body.adultConsentMode = sample.adult_consent_mode;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const http_status = res.status;
  if (!res.ok) {
    return {
      http_status,
      latency_ms: Date.now() - started,
      error: (await res.text()).slice(0, 2000),
      done: null,
      events: [],
      text: "",
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  let provider_raw = "";
  let final_text = "";
  let done = null;
  const events = [];
  let error = null;
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data || data === "[DONE]") continue;
      let ev;
      try {
        ev = JSON.parse(data);
      } catch {
        continue;
      }
      events.push(ev.type);
      if (ev.type === "delta" && typeof ev.text === "string") provider_raw += ev.text;
      if (ev.type === "replace" && typeof ev.text === "string") final_text = ev.text;
      if (ev.type === "done") {
        done = ev;
        if (typeof ev.finalContent === "string" && ev.finalContent.length > 0) {
          final_text = ev.finalContent;
        } else if (typeof ev.text === "string" && ev.text.length > 0) {
          final_text = ev.text;
        }
      }
      if (ev.type === "error") error = String(ev.message ?? JSON.stringify(ev));
    }
  }
  if (!final_text) final_text = provider_raw;
  return {
    http_status,
    latency_ms: Date.now() - started,
    error,
    done,
    events,
    text: final_text,
    chatId: done?.chatId ?? null,
    messageId: done?.messageId ?? null,
    cost: done?.totalPointsCost ?? done?.cost ?? null,
    usage: done?.usage ?? null,
  };
}

function inspectChat(chatId, userId) {
  const js = `
const Database = require("better-sqlite3");
const db = new Database("/data/app.db", { readonly: true, fileMustExist: true });
db.pragma("query_only = ON");
function u(v){if(v&&typeof v==="object"&&!Array.isArray(v)&&Object.prototype.hasOwnProperty.call(v,"value"))return u(v.value);return v}
function unwrap(row){if(!row||typeof row!=="object")return row;const out={};for(const [k,v] of Object.entries(row)){if(k==="_metadata")continue;out[k]=u(v)}return out}
const chatId=${Number(chatId)};
const userId=${Number(userId)};
const chat=unwrap(db.prepare("SELECT id,user_id,character_id,mode,adult_handoff_enabled,gemini_model,selected_persona_id,model_route_state_json FROM chats WHERE id=?").get(chatId));
const messages=db.prepare("SELECT id,role,model,length(content) AS content_len,generation_status FROM messages WHERE chat_id=? ORDER BY id").all(chatId).map(unwrap);
const assistants=messages.filter(m=>m.role==="assistant"&&m.model!=="greeting");
const deductions=db.prepare("SELECT id,delta,reason,message_id FROM point_logs WHERE chat_id=? AND delta<0").all(chatId).map(unwrap);
let routeState=null; try{routeState=JSON.parse(chat?.model_route_state_json||"null")}catch{routeState=null}
console.log(JSON.stringify({chat,routeState,messageCounts:{total:messages.length,assistants:assistants.length,users:messages.filter(m=>m.role==="user").length,greetings:messages.filter(m=>m.model==="greeting").length},assistants,deductions}));
db.close();
`;
  writeFileSync("/tmp/h5-inspect.js", js);
  const result = spawnSync("node", ["/tmp/run-prod-sqlite.mjs", "/tmp/h5-inspect.js"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { error: result.stderr || result.stdout };
  }
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  return JSON.parse(lines.at(-1));
}

mkdirSync(path.join(EVIDENCE, "raw"), { recursive: true });
mkdirSync(path.join(EVIDENCE, "assembled"), { recursive: true });

const signup = await postJson("/api/auth/signup", {
  email: EMAIL,
  nickname: NICK,
  password: PASSWORD,
  pref: "all",
});
if (signup.status !== 200) {
  console.log(JSON.stringify({ step: "signup", signup }, null, 2));
  process.exit(1);
}
const token = cookieFromSetCookie(signup.setCookie);
const meRes = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: `session=${token}` } });
const meJson = await meRes.json();
const userId = meJson.user?.id ?? meJson.id ?? null;

const persona = await postJson("/api/personas", PERSONA, token);
if (persona.status !== 200 && persona.status !== 201) {
  console.log(JSON.stringify({ step: "persona", persona }, null, 2));
  process.exit(1);
}
const personaId = persona.json?.persona?.id ?? persona.json?.id ?? null;

const run = {
  QUALITY_SCORE_ASSIGNED: false,
  HUMAN_RAW_REVIEW_REQUIRED: true,
  SOURCE_PRODUCTION_FILES_CHANGED: 0,
  email: EMAIL,
  userId,
  personaId,
  persona: PERSONA,
  samples: [],
};

for (const sample of SAMPLES) {
  const turn = await postChat({ token, personaId, sample });
  writeFileSync(path.join(EVIDENCE, "raw", sample.rawName), turn.text, "utf8");
  let dbInspect = null;
  if (turn.chatId && userId) {
    try {
      dbInspect = inspectChat(turn.chatId, userId);
    } catch (err) {
      dbInspect = { error: String(err.message || err) };
    }
  }
  const usage = turn.usage || {};
  const record = {
    KEY: sample.key,
    CHARACTER_ID: sample.character_id,
    CHAT_ID: turn.chatId,
    HTTP_STATUS: turn.http_status,
    LATENCY_MS: turn.latency_ms,
    ERROR: turn.error ?? null,
    MODEL_SELECTED: usage.selectedAI ?? usage.model ?? dbInspect?.chat?.gemini_model ?? null,
    USAGE_MODEL: usage.model ?? null,
    PRIMARY_PROVIDER: usage.selectedProvider ?? "cheaperinference",
    FALLBACK_ATTEMPTED: usage.fallbackAttempted ?? null,
    INPUT_TOKENS: usage.promptTokens ?? usage.inputTokens ?? null,
    OUTPUT_TOKENS: usage.completionTokens ?? usage.outputTokens ?? null,
    REASONING_TOKENS: usage.reasoningTokens ?? null,
    CACHE_READ_TOKENS: usage.cacheReadTokens ?? null,
    CACHE_WRITE_TOKENS: usage.cacheWriteTokens ?? null,
    PROVIDER_COST: usage.cost ?? turn.cost ?? null,
    FINISH_REASON: turn.done?.finishReason ?? usage.finishReason ?? null,
    VISIBLE_CHARS_WITH_SPACES: turn.text.length,
    VISIBLE_CHARS_NO_SPACES: turn.text.replace(/\s+/g, "").length,
    KOREAN_CHARS: countHangul(turn.text),
    PARAGRAPH_COUNT: countParagraphs(turn.text),
    DIALOGUE_LINE_COUNT: countDialogue(turn.text),
    RAW_SHA256: sha256(turn.text),
    USER_INPUT: sample.text,
    eventTypes: turn.events,
    dbInspect,
  };
  writeFileSync(
    path.join(EVIDENCE, "assembled", `${sample.key}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
  run.samples.push(record);
  writeFileSync(path.join(EVIDENCE, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    key: sample.key,
    http: turn.http_status,
    chatId: turn.chatId,
    chars: turn.text.length,
    finish: record.FINISH_REASON,
  }));
}
console.log(JSON.stringify({ done: true, chats: run.samples.map((s) => s.CHAT_ID) }));
