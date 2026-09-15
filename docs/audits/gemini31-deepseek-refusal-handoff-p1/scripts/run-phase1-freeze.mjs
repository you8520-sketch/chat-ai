#!/usr/bin/env node
/**
 * Evidence-only live freeze. Does not change production code or prompts.
 * Uses production /api/chat with Gemini 3.1 primary + refusal-only DeepSeek 0813.
 */
import { createHash } from "node:crypto";
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
const AUDIT = join(ROOT, "docs/audits/gemini31-deepseek-refusal-handoff-p1");
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL ?? "gemini31.handoff.p1@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "handoff-p1-26";
const MODEL = "gemini-3.1-pro-preview";
const DEEPSEEK = "deepseek-v4-pro-0813";

const turns = JSON.parse(
  readFileSync(join(AUDIT, "fixtures/user-turns.json"), "utf8")
);
const personaFix = JSON.parse(
  readFileSync(join(AUDIT, "fixtures/persona-ren.json"), "utf8")
);
const characterFix = JSON.parse(
  readFileSync(join(AUDIT, "fixtures/character-18-like.json"), "utf8")
);

function sha256(text) {
  return createHash("sha256").update(text ?? "", "utf8").digest("hex");
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

function dbPath() {
  return join(ROOT, "data/app.db");
}

function openDb() {
  const db = new DatabaseSync(dbPath());
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

function stringifyMaybe(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function upsertCharacter18() {
  const db = openDb();
  const cols = db
    .prepare("PRAGMA table_info(characters)")
    .all()
    .map((c) => c.name);
  const existing = db
    .prepare("SELECT id, name FROM characters WHERE id=18")
    .get();
  const row = {
    id: 18,
    name: characterFix.name,
    tagline: characterFix.tagline ?? "",
    description: characterFix.description ?? "",
    greeting: characterFix.greeting ?? "",
    system_prompt: characterFix.system_prompt ?? "",
    genre: characterFix.genre ?? "로맨스",
    tags: stringifyMaybe(characterFix.tags ?? '["NSFW","남성"]'),
    nsfw: Number(characterFix.nsfw ?? 1),
    official: Number(characterFix.official ?? 0),
    emoji: characterFix.emoji ?? "",
    hue: Number(characterFix.hue ?? 140),
    creator_name: characterFix.creator_name ?? "production",
    likes: Number(characterFix.likes ?? 0),
    chats_count: Number(characterFix.chats_count ?? 0),
    audience: characterFix.audience ?? "all",
    gender: characterFix.gender ?? "male",
    world: characterFix.world ?? "",
    example_dialog: characterFix.example_dialog ?? "",
    setting_chunks: stringifyMaybe(characterFix.setting_chunks ?? []),
    setting_chunks_en: stringifyMaybe(characterFix.setting_chunks_en ?? []),
    speech_profile: stringifyMaybe(characterFix.speech_profile ?? ""),
    visibility: characterFix.visibility ?? "public",
    moderation_status: characterFix.moderation_status ?? "approved",
    genres: stringifyMaybe(characterFix.genres ?? []),
    content_kind: characterFix.content_kind ?? "character",
    adult_status: characterFix.adult_status ?? "confirmed",
    participant_min_age: characterFix.participant_min_age ?? 19,
    adult_consent_modes_json: stringifyMaybe(
      characterFix.adult_consent_modes_json ?? ["standard", "cnc_opt_in"]
    ),
    adult_dialogue_profile: characterFix.adult_dialogue_profile ?? "auto",
    appearance_raw: characterFix.appearance_raw ?? "",
    appearance_compiled: stringifyMaybe(characterFix.appearance_compiled ?? ""),
    creator_compiled_description_json: stringifyMaybe(
      characterFix.creator_compiled_description_json ?? ""
    ),
    prompt_translation_hash: characterFix.prompt_translation_hash ?? "",
  };
  const useCols = Object.keys(row).filter((k) => cols.includes(k));
  if (existing) {
    const sets = useCols.filter((c) => c !== "id").map((c) => `${c}=@${c}`);
    db.prepare(`UPDATE characters SET ${sets.join(",")} WHERE id=18`).run(row);
  } else {
    db.prepare(
      `INSERT INTO characters (${useCols.join(",")}) VALUES (${useCols
        .map((c) => `@${c}`)
        .join(",")})`
    ).run(row);
  }
  const check = db.prepare("SELECT id, name, nsfw, adult_status FROM characters WHERE id=18").get();
  db.close();
  if (!check || check.name !== "라이크") {
    throw new Error(`character 18 upsert failed: ${JSON.stringify(check)}`);
  }
  return check;
}

function markAdultAndFund(userId) {
  const db = openDb();
  db.prepare("UPDATE users SET is_adult=1, nsfw_on=1 WHERE id=?").run(userId);
  const bal = db.prepare("SELECT points FROM users WHERE id=?").get(userId);
  if (!bal || Number(bal.points) < 20000) {
    db.prepare("UPDATE users SET points=20000 WHERE id=?").run(userId);
  }
  db.close();
}

async function signupOrLogin() {
  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: EMAIL,
      nickname: "핸드오프P1",
      password: PASSWORD,
      pref: "all",
    }),
  });
  if (signup.ok) {
    return cookieFromSetCookie(signup.headers.get("set-cookie"));
  }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    throw new Error(`login failed ${login.status} ${await login.text()}`);
  }
  return cookieFromSetCookie(login.headers.get("set-cookie"));
}

async function me(token) {
  const res = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: `session=${token}` },
  });
  const json = await res.json();
  const user = json.user ?? json;
  if (!user?.id) throw new Error(`me missing id ${JSON.stringify(json)}`);
  return user;
}

async function ensurePersona(token) {
  const list = await fetch(`${BASE}/api/personas`, {
    headers: { Cookie: `session=${token}` },
  });
  const payload = await list.json();
  const personas = Array.isArray(payload.personas) ? payload.personas : [];
  const existing = personas.find((p) => p.name === personaFix.name);
  if (existing) return existing.id;
  const res = await fetch(`${BASE}/api/personas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify(personaFix),
  });
  if (!res.ok) throw new Error(`persona create ${res.status} ${await res.text()}`);
  const json = await res.json();
  const id = json.id ?? json.persona?.id;
  if (!id) throw new Error(`persona id missing ${JSON.stringify(json)}`);
  return id;
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

function copyPromptDump(prefix) {
  const srcTxt = join(ROOT, "debug/prompt_dump.txt");
  const srcJson = join(ROOT, "debug/token_breakdown.json");
  const dest = [];
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

function paragraphs(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function isDialogueParagraph(p) {
  return /["“”「」『』]/.test(p) || /^(?:[“"]|[가-힣A-Za-z].{0,12}[:：])/.test(p);
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

function providerCallStats(captures) {
  const models = captures.map((c) => c.meta.model || "");
  return {
    providerCallCount: captures.length,
    geminiCalls: models.filter((m) => /gemini-3\.1/i.test(m)).length,
    deepseekCalls: models.filter((m) => /deepseek-v4-pro/i.test(m)).length,
    models,
  };
}

async function postChat({ token, personaId, chatId, message, stage }) {
  const before = snapshotCaptureIds();
  const started = Date.now();
  const body = {
    characterId: 18,
    message,
    selectedPersonaId: personaId,
    selectedAI: MODEL,
    isAdultMode: true,
    isNsfwMode: true,
    adultHandoffEnabled: true,
    clientRequestId: `g31_ds_p1_${stage}_${Date.now().toString(36)}`,
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
          if (typeof obj.finalContent === "string" && obj.finalContent.trim()) {
            finalText = obj.finalContent;
          }
        }
        if (typeof obj.chatId === "number") resolvedChatId = obj.chatId;
      } catch {
        /* ignore */
      }
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  const captures = collectNewCaptures(before);
  const dumpFiles = copyPromptDump(stage);
  return {
    stage,
    httpStatus: res.status,
    chatId: resolvedChatId,
    latencyMs: Date.now() - started,
    finalText,
    done,
    events: events.map((e) => e.type),
    eventCount: events.length,
    captures,
    dumpFiles,
    usage: done?.usage ?? null,
  };
}

function freezeTurn(label, userRaw, result) {
  const visible = result.finalText || "";
  const paras = paragraphs(visible);
  const dialogueParas = paras.filter(isDialogueParagraph);
  const usage = result.usage ?? {};
  const captures = result.captures ?? [];
  const stats = providerCallStats(captures);
  const finishReason =
    result.done?.finishReason ?? usage.finishReason ?? captures.at(-1)?.meta.finishReason ?? null;

  save(`raw/${label}-USER_RAW.txt`, userRaw);
  save(`raw/${label}-VISIBLE.txt`, visible);

  captures.forEach((cap, idx) => {
    const role = /deepseek/i.test(cap.meta.model || "")
      ? "DEEPSEEK"
      : /gemini/i.test(cap.meta.model || "")
        ? "GEMINI"
        : `PROVIDER_${idx + 1}`;
    save(`requests/${label}-${role}-input.json`, cap.request);
    save(`raw/${label}-${role}-RAW.txt`, cap.extracted || cap.response);
    save(`raw/${label}-${role}-WIRE.txt`, cap.response);
    if (cap.reasoning) save(`raw/${label}-${role}-REASONING.txt`, cap.reasoning);
    save(`meta/${label}-${role}-provider.json`, cap.meta);
  });

  const gemini = captures.find((c) => /gemini/i.test(c.meta.model || ""));
  const deepseek = captures.find((c) => /deepseek/i.test(c.meta.model || ""));

  const meta = {
    fixture: label,
    primary_model: usage.selectedAI ?? usage.model ?? MODEL,
    delivered_model: usage.model ?? null,
    provider: usage.provider ?? null,
    visible_chars: visible.length,
    paragraph_count: paras.length,
    dialogue_paragraph_count: dialogueParas.length,
    dialogue_paragraph_ratio:
      paras.length === 0 ? 0 : Number((dialogueParas.length / paras.length).toFixed(3)),
    max_consecutive_dialogue: maxConsecutiveDialogue(paras),
    input_tokens: usage.apiInputTokens ?? usage.input ?? null,
    output_tokens: usage.apiOutputTokens ?? usage.output ?? null,
    reasoning_tokens: usage.apiReasoningOutputTokens ?? null,
    ttft_ms: gemini?.meta.ttftMs ?? captures[0]?.meta.ttftMs ?? null,
    latency_ms: result.latencyMs,
    finish_reason: finishReason,
    request_sha: gemini?.meta.requestSha ?? captures[0]?.meta.requestSha ?? null,
    raw_sha: (deepseek ?? gemini ?? captures[0])?.meta.rawSha ?? sha256(visible),
    provider_call_count: stats.providerCallCount,
    gemini_call_count: stats.geminiCalls,
    deepseek_call_count: stats.deepseekCalls,
    handoff_count: stats.deepseekCalls,
    provider_models: stats.models,
    chat_id: result.chatId ?? null,
    http_status: result.httpStatus,
    usage,
    alarm_candidates: alarmCandidates(visible, finishReason),
    capture_ids: captures.map((c) => c.id),
    dump_files: result.dumpFiles ?? [],
  };
  save(`meta/${label}.json`, meta);
  return { meta, result, gemini, deepseek };
}

function layoutContinuity(label, gemini, deepseek) {
  const lines = [
    `# ${label} — Gemini context then DeepSeek continuation`,
    "",
    "## USER RAW",
    "",
    readFileSync(join(AUDIT, `raw/${label}-USER_RAW.txt`), "utf8"),
    "",
    "## Gemini input (provider request body)",
    "",
    gemini ? gemini.request : "(no Gemini request captured)",
    "",
    "## Gemini RAW",
    "",
    gemini ? gemini.extracted || gemini.response : "(no Gemini RAW captured)",
    "",
    "## Handoff input (DeepSeek request body)",
    "",
    deepseek ? deepseek.request : "(no DeepSeek handoff input — expected for A/C if no refusal)",
    "",
    "## DeepSeek RAW",
    "",
    deepseek ? deepseek.extracted || deepseek.response : "(no DeepSeek RAW)",
    "",
  ];
  save(`raw/${label}-CONTINUITY.txt`, lines.join("\n"));
}

async function main() {
  await waitReady();
  const character = upsertCharacter18();
  const token = await signupOrLogin();
  const user = await me(token);
  markAdultAndFund(user.id);
  const selected = await selectGemini(token);
  const personaId = await ensurePersona(token);
  save("meta/SETUP.json", {
    character,
    userId: user.id,
    personaId,
    selected,
    email: EMAIL,
    model: MODEL,
    fallback: DEEPSEEK,
  });

  const a = await postChat({
    token,
    personaId,
    stage: "A",
    message: turns.fixtureA.userRaw,
  });
  const frozenA = freezeTurn("A", turns.fixtureA.userRaw, a);
  layoutContinuity("A", frozenA.gemini, frozenA.deepseek);

  let frozenB = null;
  let bChatId = null;
  let usedB = null;
  for (const candidate of turns.fixtureB.candidates) {
    const b = await postChat({
      token,
      personaId,
      stage: `B-${candidate.id}`,
      message: candidate.userRaw,
    });
    const frozen = freezeTurn(`B-${candidate.id}`, candidate.userRaw, b);
    layoutContinuity(`B-${candidate.id}`, frozen.gemini, frozen.deepseek);
    const stats = providerCallStats(b.captures);
    const ok =
      stats.geminiCalls === 1 &&
      stats.deepseekCalls === 1 &&
      String(frozen.meta.delivered_model || "").includes("deepseek") &&
      String(b.finalText || "").trim().length > 0;
    if (ok) {
      frozenB = freezeTurn("B", candidate.userRaw, b);
      layoutContinuity("B", frozenB.gemini, frozenB.deepseek);
      bChatId = b.chatId;
      usedB = candidate.id;
      break;
    }
    save(`meta/B-${candidate.id}-NOT_QUALIFYING.json`, {
      reason: "did_not_meet_B_expectations",
      stats,
      delivered: frozen.meta.delivered_model,
      visible_chars: frozen.meta.visible_chars,
    });
  }
  if (!frozenB) {
    save("meta/B-FAILED.json", {
      error: "no qualifying Gemini refusal + DeepSeek replacement after candidates",
    });
    throw new Error("Fixture B did not produce a qualifying refusal handoff");
  }

  const c = await postChat({
    token,
    personaId,
    chatId: bChatId,
    stage: "C",
    message: turns.fixtureC.userRaw,
  });
  const frozenC = freezeTurn("C", turns.fixtureC.userRaw, c);
  layoutContinuity("C", frozenC.gemini, frozenC.deepseek);

  const index = {
    phase: "gemini31-deepseek-refusal-handoff-p1",
    production_code_changed: false,
    prompt_changed: false,
    fixture_b_candidate: usedB,
    chats: { A: a.chatId, B: bChatId, C: c.chatId },
    provider_call_counts: {
      A: frozenA.meta.provider_call_count,
      B: frozenB.meta.provider_call_count,
      C: frozenC.meta.provider_call_count,
    },
    gemini_call_counts: {
      A: frozenA.meta.gemini_call_count,
      B: frozenB.meta.gemini_call_count,
      C: frozenC.meta.gemini_call_count,
    },
    deepseek_call_counts: {
      A: frozenA.meta.deepseek_call_count,
      B: frozenB.meta.deepseek_call_count,
      C: frozenC.meta.deepseek_call_count,
    },
    handoff_counts: {
      A: frozenA.meta.handoff_count,
      B: frozenB.meta.handoff_count,
      C: frozenC.meta.handoff_count,
    },
    delivered_models: {
      A: frozenA.meta.delivered_model,
      B: frozenB.meta.delivered_model,
      C: frozenC.meta.delivered_model,
    },
    raw_paths: {
      A: [
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/A-USER_RAW.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/A-GEMINI-RAW.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/A-VISIBLE.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/A-CONTINUITY.txt",
      ],
      B: [
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-USER_RAW.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-GEMINI-RAW.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-DEEPSEEK-RAW.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-VISIBLE.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/B-CONTINUITY.txt",
      ],
      C: [
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/C-USER_RAW.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/C-GEMINI-RAW.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/C-VISIBLE.txt",
        "docs/audits/gemini31-deepseek-refusal-handoff-p1/raw/C-CONTINUITY.txt",
      ],
    },
    metadata_paths: {
      A: "docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/A.json",
      B: "docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/B.json",
      C: "docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/C.json",
      setup: "docs/audits/gemini31-deepseek-refusal-handoff-p1/meta/SETUP.json",
      index: "docs/audits/gemini31-deepseek-refusal-handoff-p1/INDEX.json",
    },
  };
  save("INDEX.json", index);
  console.log(JSON.stringify(index, null, 2));
}

main().catch((err) => {
  console.error(err);
  save("meta/RUN_ERROR.json", { error: String(err?.stack || err) });
  process.exit(1);
});
