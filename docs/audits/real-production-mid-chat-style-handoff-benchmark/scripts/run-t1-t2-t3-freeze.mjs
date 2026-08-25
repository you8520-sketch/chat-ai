#!/usr/bin/env node
/**
 * Issue 2 — real production mid-chat style handoff benchmark (T1→T2→T3).
 * Evidence only. No production code or prompt changes.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const AUDIT = join(ROOT, "docs/audits/real-production-mid-chat-style-handoff-benchmark");
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL ?? "handoff-benchmark-capsule@local.invalid";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "benchmark-capsule-login-26";
const MODEL = "gemini-3.1-pro-preview";
const DEEPSEEK = "deepseek-v4-pro-0813";
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, "data/handoff-benchmark-import");

const turns = JSON.parse(
  readFileSync(join(AUDIT, "fixtures/user-turns-t1-t2-t3.json"), "utf8")
);
const CHARACTER_ID = Number(process.env.CHARACTER_ID ?? turns.characterId ?? 10);

function sha256(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
}

function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function save(rel, content) {
  const dest = join(AUDIT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(
    dest,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function dbPath() {
  return join(DATA_DIR, "app.db");
}

function openDb() {
  const db = new DatabaseSync(dbPath());
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

function cookieFromSetCookie(header) {
  if (!header) throw new Error("no set-cookie");
  const m = /(?:^|,)\s*session=([^;]+)/i.exec(header);
  if (!m?.[1]) throw new Error(`session cookie missing: ${header.slice(0, 200)}`);
  return m[1];
}

async function waitReady() {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok || res.status === 307 || res.status === 404) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("dev server not ready");
}

function setupBenchmarkUser() {
  const db = openDb();
  const user = db.prepare("SELECT id FROM users WHERE email=?").get(EMAIL);
  if (!user) throw new Error(`benchmark user missing: ${EMAIL}`);
  db.prepare(
    "UPDATE users SET pw_hash=?, is_adult=1, nsfw_on=1, nickname=?, points=CASE WHEN points<20000 THEN 20000 ELSE points END WHERE id=?"
  ).run(hashPassword(PASSWORD), "공식계정", user.id);
  const persona = db
    .prepare("SELECT id FROM user_personas WHERE user_id=? AND name=?")
    .get(user.id, turns.personaName);
  if (!persona) throw new Error("imported persona 렌 missing");
  db.close();
  return { userId: user.id, personaId: persona.id };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status} ${await res.text()}`);
  return cookieFromSetCookie(res.headers.get("set-cookie"));
}

async function selectGemini(token) {
  const res = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: MODEL }),
  });
  if (!res.ok) throw new Error(`selected-ai ${res.status} ${await res.text()}`);
  return res.json();
}

function snapshotCaptureIds() {
  const dir = process.env.CI_CAPTURE_DIR || join(ROOT, "debug/ci-capture");
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith("-meta.json"))
      .map((f) => f.replace(/-meta\.json$/, ""))
  );
}

function collectNewCaptures(before) {
  const dir = process.env.CI_CAPTURE_DIR || join(ROOT, "debug/ci-capture");
  if (!existsSync(dir)) return [];
  const ids = readdirSync(dir)
    .filter((f) => f.endsWith("-meta.json"))
    .map((f) => f.replace(/-meta\.json$/, ""))
    .filter((id) => !before.has(id))
    .sort();
  return ids.map((id) => {
    const meta = JSON.parse(readFileSync(join(dir, `${id}-meta.json`), "utf8"));
    const request = existsSync(join(dir, `${id}-request.json`))
      ? readFileSync(join(dir, `${id}-request.json`), "utf8")
      : "";
    const response = existsSync(join(dir, `${id}-response.txt`))
      ? readFileSync(join(dir, `${id}-response.txt`), "utf8")
      : "";
    const extracted = existsSync(join(dir, `${id}-extracted.txt`))
      ? readFileSync(join(dir, `${id}-extracted.txt`), "utf8")
      : "";
    const reasoning = existsSync(join(dir, `${id}-reasoning.txt`))
      ? readFileSync(join(dir, `${id}-reasoning.txt`), "utf8")
      : "";
    return { id, meta, request, response, extracted, reasoning };
  });
}

async function copyPromptDump(prefix) {
  const srcTxt = join(ROOT, "debug/prompt_dump.txt");
  const srcJson = join(ROOT, "debug/token_breakdown.json");
  const destDir = join(AUDIT, "requests");
  mkdirSync(destDir, { recursive: true });
  const dest = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    if (existsSync(srcTxt) || existsSync(srcJson)) break;
    await sleep(500);
  }
  if (existsSync(srcTxt)) {
    const rel = `requests/${prefix}-prompt_dump.txt`;
    copyFileSync(srcTxt, join(AUDIT, rel));
    dest.push(rel);
  }
  if (existsSync(srcJson)) {
    const rel = `requests/${prefix}-token_breakdown.json`;
    copyFileSync(srcJson, join(AUDIT, rel));
    dest.push(rel);
  }
  return dest;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function isNarrationParagraph(p) {
  return !isDialogueParagraph(p);
}

function maxConsecutiveDialogue(paras) {
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

function median(nums) {
  const a = [...nums].filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function objectiveMetrics(text) {
  const paras = paragraphs(text);
  const dialogueParas = paras.filter(isDialogueParagraph);
  const narrationParas = paras.filter(isNarrationParagraph);
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

function alarmCandidates(text, finishReason) {
  const alarms = {};
  const t = String(text || "");
  alarms.META_LEAK = /(?:SYSTEM|SceneMode|routeTrigger|INTERNAL|OOC:)/i.test(t);
  alarms.EMPTY_OUTPUT = !t.trim();
  alarms.TRUNCATION = /content[_ -]?filter|length|max_tokens|truncated/i.test(
    String(finishReason || "")
  );
  alarms.NEW_USER_DIALOGUE_CANDIDATE = /(?:렌이\s*(?:말했|대답했|속삭였)|렌의\s*입에서)/.test(t);
  alarms.NEW_USER_ACTION_CANDIDATE = /(?:렌이\s*(?:일어섰|달려|문을\s*열|옷을\s*벗었))/.test(t);
  alarms.CANON_CONTRADICTION_CANDIDATE = /(?:미성년|고등학생|17살|18살 미만)/.test(t);
  const paras = paragraphs(t);
  const uniq = new Set(paras.map((p) => p.slice(0, 80)));
  alarms.REPETITION_CANDIDATE =
    paras.length >= 6 && uniq.size <= Math.ceil(paras.length * 0.5);
  alarms.TURN_ENDING_USER_CHECKPOINT_CANDIDATE =
    /(?:눈을\s*마주|이대로\s*조금만|잠깐만)/.test(t.slice(-400));
  alarms.REQUESTED_PROGRESSION_COMPLETED =
    /(?:삽입|성교|오르가슴|절정|사정|끝까지)/.test(t) && t.length > 200;
  return alarms;
}

function isGeminiRefusalText(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  return /작성할\s*수\s*없|생성할\s*수\s*없|안전\s*가이드|검열|노골적인\s*성인|explicit/i.test(t);
}

function primaryTurnStats(captures) {
  const primary = captures.filter((c) =>
    /gemini-3\.1-pro-preview/i.test(c.meta.model || "")
  );
  const handoff = captures.filter((c) => /deepseek-v4-pro-0813/i.test(c.meta.model || ""));
  const background = captures.filter(
    (c) =>
      !/gemini-3\.1-pro-preview/i.test(c.meta.model || "") &&
      !/deepseek-v4-pro-0813/i.test(c.meta.model || "")
  );
  return {
    geminiPrimaryCalls: primary.length,
    deepseekHandoffCalls: handoff.length,
    backgroundCalls: background.length,
    backgroundModels: background.map((c) => c.meta.model || ""),
    primaryModels: primary.map((c) => c.meta.model || ""),
    handoffModels: handoff.map((c) => c.meta.model || ""),
  };
}

function providerCallStats(captures) {
  const models = captures.map((c) => c.meta.model || "");
  const turn = primaryTurnStats(captures);
  return {
    providerCallCount: captures.length,
    geminiCalls: turn.geminiPrimaryCalls,
    deepseekCalls: turn.deepseekHandoffCalls,
    backgroundCalls: turn.backgroundCalls,
    backgroundModels: turn.backgroundModels,
    models,
  };
}

async function postChat({ token, personaId, chatId, message, stage }) {
  const before = snapshotCaptureIds();
  const started = Date.now();
  const body = {
    characterId: CHARACTER_ID,
    message,
    selectedPersonaId: personaId,
    selectedAI: MODEL,
    isAdultMode: true,
    isNsfwMode: true,
    adultHandoffEnabled: true,
    clientRequestId: `real_midchat_${stage}_${Date.now().toString(36)}`,
  };
  if (chatId) body.chatId = chatId;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      stage,
      httpStatus: res.status,
      error: await res.text(),
      latencyMs: Date.now() - started,
      captures: collectNewCaptures(before),
      events: [],
      done: null,
      finalText: "",
    };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finalText = "";
  let done = null;
  const events = [];
  let resolvedChatId = chatId;
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        events.push(obj);
        if (obj.type === "delta" && typeof obj.text === "string") finalText += obj.text;
        if (obj.type === "replace" && typeof obj.text === "string") finalText = obj.text;
        if (obj.type === "done") {
          done = obj;
          if (typeof obj.chatId === "number") resolvedChatId = obj.chatId;
          if (typeof obj.text === "string" && obj.text.trim()) finalText = obj.text;
          if (typeof obj.finalText === "string" && obj.finalText.trim()) finalText = obj.finalText;
        }
        if (typeof obj.chatId === "number") resolvedChatId = obj.chatId;
      } catch {
        /* ignore */
      }
    }
  }
  const dumpFiles = await copyPromptDump(stage);
  return {
    stage,
    httpStatus: res.status,
    chatId: resolvedChatId,
    latencyMs: Date.now() - started,
    finalText,
    done,
    events: events.map((e) => e.type),
    eventCount: events.length,
    captures: collectNewCaptures(before),
    dumpFiles,
    usage: done?.usage ?? null,
  };
}

function getPersistedAssistant(chatId, afterId = 0) {
  const db = openDb();
  const rows = db
    .prepare(
      "SELECT id, content, model FROM messages WHERE chat_id=? AND role='assistant' AND id>? ORDER BY id"
    )
    .all(chatId, afterId);
  db.close();
  return rows;
}

function getOpeningGreeting(chatId) {
  const db = openDb();
  const row = db
    .prepare(
      "SELECT content FROM messages WHERE chat_id=? AND role='assistant' AND model='greeting' ORDER BY id LIMIT 1"
    )
    .get(chatId);
  db.close();
  return row?.content ?? "";
}

function normalizeWs(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function findExemplarInMessages(messages, sourceText, label) {
  const src = String(sourceText || "");
  const srcNorm = normalizeWs(src);
  if (!srcNorm) {
    return {
      present: false,
      ROLE: null,
      WIRE_POSITION: null,
      SOURCE_CHARS: 0,
      TRANSPORTED_CHARS: 0,
      BYTE_IDENTICAL: false,
      WHITESPACE_NORMALIZED_EQUIVALENT: false,
      TRUNCATED: false,
      TRANSFORMED: false,
    };
  }
  let best = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const content =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((b) => b.text ?? "").join("")
          : "";
    if (!content) continue;
    const role = m.role || "unknown";
    if (content.includes(src.slice(0, 80)) || normalizeWs(content).includes(srcNorm.slice(0, 80))) {
      best = { index: i, role, content };
      break;
    }
    if (srcNorm.length > 100 && normalizeWs(content).includes(srcNorm.slice(0, Math.min(200, srcNorm.length)))) {
      best = { index: i, role, content };
      break;
    }
  }
  if (!best) {
    // fallback: longest assistant match by prefix
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== "assistant") continue;
      const content = typeof m.content === "string" ? m.content : "";
      if (content.length > 100 && src.startsWith(content.slice(0, 50))) {
        best = { index: i, role: m.role, content };
        break;
      }
    }
  }
  if (!best) {
    return {
      present: false,
      ROLE: null,
      WIRE_POSITION: null,
      SOURCE_CHARS: src.length,
      TRANSPORTED_CHARS: 0,
      BYTE_IDENTICAL: false,
      WHITESPACE_NORMALIZED_EQUIVALENT: false,
      TRUNCATED: false,
      TRANSFORMED: false,
    };
  }
  const transported = best.content;
  const byteIdentical = transported === src;
  const wsEq = normalizeWs(transported) === srcNorm;
  const truncated = transported.length < src.length && src.startsWith(transported);
  return {
    present: true,
    ROLE: best.role,
    WIRE_POSITION: best.index,
    SOURCE_CHARS: src.length,
    TRANSPORTED_CHARS: transported.length,
    BYTE_IDENTICAL: byteIdentical,
    WHITESPACE_NORMALIZED_EQUIVALENT: wsEq,
    TRUNCATED: truncated,
    TRANSFORMED: !byteIdentical && !wsEq,
  };
}

function parseRequestMessages(requestJson) {
  try {
    const body = JSON.parse(requestJson);
    if (Array.isArray(body.messages)) return body.messages;
    if (Array.isArray(body.contents)) {
      return body.contents.map((c) => ({
        role: c.role === "model" ? "assistant" : c.role,
        content: c.parts?.[0]?.text ?? "",
      }));
    }
  } catch {
    /* */
  }
  return [];
}

function refusalInMessages(messages, refusalRaw) {
  const refusal = String(refusalRaw || "").trim();
  if (!refusal) return false;
  const snippet = refusal.slice(0, 60);
  for (const m of messages) {
    const c = typeof m.content === "string" ? m.content : "";
    if (c.includes(snippet)) return true;
  }
  return false;
}

function buildRoleOrderMap(messages) {
  return messages.map((m, index) => {
    const content = typeof m.content === "string" ? m.content : "";
    const preview = content.slice(0, 40).replace(/\s+/g, " ");
    let semantic = "unknown";
    if (m.role === "system") semantic = "system";
    else if (m.role === "assistant" && index === 1) semantic = "opening_or_early_assistant";
    else if (m.role === "user") semantic = "user_turn";
    else if (m.role === "assistant") semantic = "assistant_turn";
    return { index, role: m.role, semantic_source: semantic, preview_chars: preview.length };
  });
}

function activeOwnersFromTokenBreakdown(path) {
  if (!existsSync(path)) return { active: [], inactive_note: "token_breakdown missing" };
  const payload = JSON.parse(readFileSync(path, "utf8"));
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  const active = sections
    .filter((s) => !s.hidden && String(s.text || "").trim())
    .map((s, i) => ({
      OWNER: s.label || s.id,
      SOURCE: "promptDebugDump",
      ROLE: s.role,
      POSITION: i,
      CATEGORY:
        /length|3200|USER_TAIL/i.test(s.label || "")
          ? "LENGTH"
          : /dialogue|speech|말투/i.test(s.label || "")
            ? "DIALOGUE"
            : /agency|user control/i.test(s.label || "")
              ? "AGENCY"
              : /scene|continuity|SCP/i.test(s.label || "")
                ? "SCENE_STATE"
                : /layout|지문/i.test(s.label || "")
                  ? "LAYOUT"
                  : /adult|nsfw|intimacy/i.test(s.label || "")
                    ? "ADULT_PROSE"
                    : /style|prose|novel/i.test(s.label || "")
                      ? "STYLE"
                      : "OTHER",
    }));
  return { active, section_count: sections.length };
}

function nextTurnRouting(chatId, userId) {
  const db = openDb();
  const user = db.prepare("SELECT selected_ai FROM users WHERE id=?").get(userId);
  const chat = db
    .prepare("SELECT model_route_state_json, adult_handoff_enabled FROM chats WHERE id=?")
    .get(chatId);
  db.close();
  let sticky = false;
  if (chat?.model_route_state_json) {
    try {
      const state = JSON.parse(chat.model_route_state_json);
      sticky = Boolean(
        state?.adultModelSticky ||
          state?.stickyAdult ||
          state?.requiresAdultCapableModel ||
          state?.adultDeliverySticky
      );
    } catch {
      /* */
    }
  }
  return {
    NEXT_TURN_PRIMARY_EXPECTED: user?.selected_ai || MODEL,
    ADULT_MODEL_STICKINESS: sticky,
    model_route_state_json_present: Boolean(chat?.model_route_state_json),
  };
}

function freezeTurn(label, userRaw, result, persistedVisible) {
  const visible = persistedVisible || result.finalText || "";
  const usage = result.usage ?? {};
  const captures = result.captures ?? [];
  const stats = providerCallStats(captures);
  const finishReason =
    result.done?.finishReason ?? usage.finishReason ?? captures.at(-1)?.meta.finishReason ?? null;

  save(`raw/${label}-USER_RAW.txt`, userRaw);
  save(`raw/${label}-ASSISTANT_PERSISTED_VISIBLE.txt`, visible);
  save(`raw/${label}-SSE_VISIBLE.txt`, result.finalText || "");

  captures.forEach((cap, idx) => {
    const role = /deepseek/i.test(cap.meta.model || "")
      ? "DEEPSEEK"
      : /gemini/i.test(cap.meta.model || "")
        ? "GEMINI"
        : `PROVIDER_${idx + 1}`;
    save(`requests/${label}-${role}-input.json`, cap.request);
    save(`raw/${label}-${role}-PROVIDER_RAW.txt`, cap.extracted || cap.response);
    save(`raw/${label}-${role}-WIRE.txt`, cap.response);
    if (cap.reasoning) save(`raw/${label}-${role}-REASONING.txt`, cap.reasoning);
    save(`meta/${label}-${role}-provider.json`, cap.meta);
  });

  const gemini = captures.find((c) => /gemini/i.test(c.meta.model || ""));
  const deepseek = captures.find((c) => /deepseek/i.test(c.meta.model || ""));

  const meta = {
    label,
    visible_chars: visible.length,
    sse_visible_chars: (result.finalText || "").length,
    metrics: objectiveMetrics(visible),
    alarms: alarmCandidates(visible, finishReason),
    provider_call_count: stats.providerCallCount,
    gemini_call_count: stats.geminiCalls,
    deepseek_call_count: stats.deepseekCalls,
    delivered_model: usage.model ?? result.done?.model ?? null,
    request_sha: gemini?.meta.requestSha ?? captures[0]?.meta.requestSha ?? null,
    provider_raw_sha: (deepseek ?? gemini)?.meta.rawSha ?? sha256(visible),
    persisted_visible_sha: sha256(visible),
    chat_id: result.chatId ?? null,
    http_status: result.httpStatus,
    usage,
    capture_ids: captures.map((c) => c.id),
    dump_files: result.dumpFiles ?? [],
  };
  save(`meta/${label}.json`, meta);
  return { meta, gemini, deepseek, visible, stats };
}

async function main() {
  await waitReady();
  const { userId, personaId } = setupBenchmarkUser();
  const token = await login();
  const selected = await selectGemini(token);
  save("meta/SETUP.json", {
    userId,
    personaId,
    characterId: CHARACTER_ID,
    email: EMAIL,
    selected,
    model: MODEL,
    fallback: DEEPSEEK,
    dataDir: DATA_DIR,
  });

  // T1
  const t1 = await postChat({
    token,
    personaId,
    message: turns.T1_USER_RAW,
    stage: "T1",
  });
  if (!t1.chatId) throw new Error("T1 missing chatId");
  const opening = getOpeningGreeting(t1.chatId);
  save("raw/OPENING_ASSISTANT_VISIBLE.txt", opening);
  const t1Persisted = getPersistedAssistant(t1.chatId).filter((r) => r.model !== "greeting").at(-1)?.content ?? t1.finalText;
  const frozenT1 = freezeTurn("T1", turns.T1_USER_RAW, t1, t1Persisted);
  if (frozenT1.stats.geminiCalls !== 1 || frozenT1.stats.deepseekCalls !== 0) {
    save("meta/STOP.json", { reason: "T1 unexpected provider calls", stats: frozenT1.stats });
    throw new Error(`T1 provider mismatch: ${JSON.stringify(frozenT1.stats)}`);
  }
  if (isGeminiRefusalText(t1Persisted)) {
    save("meta/STOP.json", { reason: "T1_GEMINI_REFUSAL" });
    throw new Error("T1 Gemini refused — STOP");
  }

  // T2
  const t2 = await postChat({
    token,
    personaId,
    chatId: t1.chatId,
    message: turns.T2_USER_RAW,
    stage: "T2",
  });
  const t2Persisted = getPersistedAssistant(t1.chatId).filter((r) => r.model !== "greeting").at(-1)?.content ?? t2.finalText;
  const frozenT2 = freezeTurn("T2", turns.T2_USER_RAW, t2, t2Persisted);
  if (frozenT2.stats.geminiCalls !== 1 || frozenT2.stats.deepseekCalls !== 0) {
    save("meta/STOP.json", { reason: "T2 unexpected provider calls", stats: frozenT2.stats });
    throw new Error(`T2 provider mismatch: ${JSON.stringify(frozenT2.stats)}`);
  }
  if (isGeminiRefusalText(t2Persisted)) {
    save("meta/STOP.json", { reason: "T2_GEMINI_REFUSAL" });
    throw new Error("T2 Gemini refused — STOP");
  }

  // T3
  const t3 = await postChat({
    token,
    personaId,
    chatId: t1.chatId,
    message: turns.T3_USER_RAW,
    stage: "T3",
  });
  const t3Persisted = getPersistedAssistant(t1.chatId).filter((r) => r.model !== "greeting").at(-1)?.content ?? t3.finalText;
  const frozenT3 = freezeTurn("T3", turns.T3_USER_RAW, t3, t3Persisted);

  const t3Gemini = frozenT3.gemini;
  const t3Deepseek = frozenT3.deepseek;
  const geminiRefusalRaw = t3Gemini?.extracted || "";
  const qualifyingRefusal = isGeminiRefusalText(geminiRefusalRaw);
  const deepseekReplacementCount = frozenT3.stats.deepseekCalls;
  const visibleT3Count = getPersistedAssistant(t1.chatId).filter(
    (r) => r.model !== "greeting"
  ).length;

  if (!qualifyingRefusal) {
    save("meta/STOP.json", {
      reason: "T3_QUALIFYING_REFUSAL=false",
      gemini_raw: geminiRefusalRaw.slice(0, 500),
      stats: frozenT3.stats,
    });
    save("COMPACT_REPORT.json", { T3_QUALIFYING_REFUSAL: false });
    console.log(JSON.stringify({ T3_QUALIFYING_REFUSAL: false }, null, 2));
    process.exit(2);
  }

  if (frozenT3.stats.geminiCalls !== 1 || frozenT3.stats.deepseekCalls !== 1) {
    save("meta/STOP.json", { reason: "T3 provider mismatch", stats: frozenT3.stats });
    throw new Error(`T3 provider mismatch: ${JSON.stringify(frozenT3.stats)}`);
  }

  const t1Visible = frozenT1.visible;
  const t2Visible = frozenT2.visible;
  const deepseekMessages = parseRequestMessages(t3Deepseek?.request || "{}");
  const t1Exemplar = findExemplarInMessages(deepseekMessages, t1Visible, "T1");
  const t2Exemplar = findExemplarInMessages(deepseekMessages, t2Visible, "T2");
  const refusalInContext = refusalInMessages(deepseekMessages, geminiRefusalRaw);

  const recentPrimary = deepseekMessages.filter((m) => m.role === "assistant");
  const recentChars = recentPrimary.reduce(
    (n, m) => n + (typeof m.content === "string" ? m.content.length : 0),
    0
  );

  save("meta/T3-transport-trace.json", {
    T1_PRIMARY_STYLE_EXEMPLAR_PRESENT: t1Exemplar.present,
    T1: t1Exemplar,
    T2_PRIMARY_STYLE_EXEMPLAR_PRESENT: t2Exemplar.present,
    T2: t2Exemplar,
    GEMINI_REFUSAL_PRESENT_IN_FALLBACK_CONTEXT: refusalInContext,
    RECENT_PRIMARY_ASSISTANT_MESSAGES_IN_FALLBACK: recentPrimary.length,
    RECENT_PRIMARY_ASSISTANT_CHARS_IN_FALLBACK: recentChars,
    role_order_map: buildRoleOrderMap(deepseekMessages),
  });

  const owners = activeOwnersFromTokenBreakdown(
    join(AUDIT, "requests/T3-token_breakdown.json")
  );
  save("meta/T3-active-owners.json", owners);

  const routing = nextTurnRouting(t1.chatId, userId);

  const t1Metrics = objectiveMetrics(t1Visible);
  const t2Metrics = objectiveMetrics(t2Visible);
  const t3Metrics = objectiveMetrics(t3Persisted);
  const primaryMedian = median([t1Metrics.VISIBLE_CHARS, t2Metrics.VISIBLE_CHARS]);
  const handoffRatio =
    primaryMedian > 0 ? Number((t3Metrics.VISIBLE_CHARS / primaryMedian).toFixed(3)) : null;

  const totalCaptures = [
    ...t1.captures,
    ...t2.captures,
    ...t3.captures,
  ];
  const totalProviderCalls = totalCaptures.length;

  const compact = {
    T1_PRIMARY_NORMAL: !isGeminiRefusalText(t1Visible),
    T2_PRIMARY_NORMAL: !isGeminiRefusalText(t2Visible),
    T3_QUALIFYING_REFUSAL: qualifyingRefusal,
    T3_DEEPSEEK_REPLACEMENT_COUNT: deepseekReplacementCount,
    VISIBLE_ASSISTANT_RESPONSES_T3: visibleT3Count,
    T1_PRIMARY_STYLE_EXEMPLAR_PRESENT: t1Exemplar.present,
    T2_PRIMARY_STYLE_EXEMPLAR_PRESENT: t2Exemplar.present,
    GEMINI_REFUSAL_PRESENT_IN_FALLBACK_CONTEXT: refusalInContext,
    PRIMARY_MEDIAN_VISIBLE_CHARS: primaryMedian,
    T3_DEEPSEEK_VISIBLE_CHARS: t3Metrics.VISIBLE_CHARS,
    HANDOFF_LENGTH_RATIO: handoffRatio,
    metrics: { T1: t1Metrics, T2: t2Metrics, T3: t3Metrics },
    alarms: {
      T1: frozenT1.meta.alarms,
      T2: frozenT2.meta.alarms,
      T3: frozenT3.meta.alarms,
    },
    NEXT_TURN_PRIMARY_EXPECTED: routing.NEXT_TURN_PRIMARY_EXPECTED,
    ADULT_MODEL_STICKINESS: routing.ADULT_MODEL_STICKINESS,
    TOTAL_PROVIDER_CALLS: totalProviderCalls,
    chat_id: t1.chatId,
  };
  save("COMPACT_REPORT.json", compact);
  save("INDEX.json", {
    audit: "real-production-mid-chat-style-handoff-benchmark",
    production_code_changed: false,
    chat_id: t1.chatId,
    provider_calls: {
      T1: frozenT1.stats,
      T2: frozenT2.stats,
      T3: frozenT3.stats,
      total: totalProviderCalls,
    },
    compact,
  });
  console.log(JSON.stringify(compact, null, 2));
}

main().catch((err) => {
  console.error(err);
  save("meta/RUN_ERROR.json", { error: String(err?.stack || err) });
  process.exit(1);
});
