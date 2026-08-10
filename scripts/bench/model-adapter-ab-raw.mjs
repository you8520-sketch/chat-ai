#!/usr/bin/env node
/**
 * RAW A/B bench runner — Opus5 / Terra / DeepSeek × A/B
 * Fact collection only. No style/quality verdicts.
 *
 * Usage:
 *   node scripts/bench/model-adapter-ab-raw.mjs seed
 *   node scripts/bench/model-adapter-ab-raw.mjs run --phase A
 *   node scripts/bench/model-adapter-ab-raw.mjs run --phase B
 *   node scripts/bench/model-adapter-ab-raw.mjs assemble
 */
import { randomBytes, scryptSync } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const BENCH_DIR = join(ROOT, "bench");
const FIXTURE = "/tmp/g11c5-wip/rp-historical-sequence-g11c5/fixtures/c18_persona61_fixture.json";
const BASE = process.env.BENCH_BASE_URL || "http://127.0.0.1:3000";
const DATE_TAG = "20260810";

const SEEDS = [
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
  "같이 갈래? *두리번*",
  "*가방 끈을 꼭 쥐고* 음… 조금만. 나 길 잘 모르거든.",
  "*나란히 걷다 멈춰 서서* 여기… 자주 오는 곳이야?",
  "*물병을 꺼내 내민다* …목마르면 마셔. 나 괜찮으니까.",
  "*벽에 기대 숨을 고른다* 잠깐만… 여기 좀 쉬자.",
];
const TURN7 = "*가방을 고쳐 메며* 아까 말한 거… 아직 기억나?";

const MODELS = {
  opus5: { id: "claude-opus-5", label: "Opus5" },
  terra: { id: "gpt-5.6-terra", label: "Terra" },
  deepseek: { id: "deepseek-v4-pro", label: "DeepSeek" },
};

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function loadFixture() {
  const p = existsSync(FIXTURE) ? FIXTURE : "/tmp/c18_fixture.json";
  return JSON.parse(readFileSync(p, "utf8"));
}

function openDb() {
  const dbPath = join(ROOT, "data", "app.db");
  return new Database(dbPath);
}

function hashPasswordCompat(pw) {
  // Match src/lib/auth.ts
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

async function seed() {
  const fixture = loadFixture();
  const db = openDb();
  const email = process.env.BENCH_ADMIN_EMAIL || "bench-admin@local.test";
  const password = process.env.BENCH_ADMIN_PASSWORD || randomBytes(12).toString("hex");
  // Persist password only to gitignored local file for runner reuse — never print.
  const credPath = join(BENCH_DIR, ".local_bench_creds.json");
  ensureDir(BENCH_DIR);

  let user = db.prepare("SELECT id FROM users WHERE email=?").get(email);
  if (!user) {
    const info = db
      .prepare(
        `INSERT INTO users (email, nickname, pw_hash, pref, is_adult, nsfw_on, points, is_admin, real_name)
         VALUES (?,?,?,?,1,1,?,?,1,?)`
      )
      .run(email, "벤치관리자", hashPasswordCompat(password), "male", 50_000_000, "벤치관리자");
    user = { id: Number(info.lastInsertRowid) };
    writeFileSync(
      credPath,
      JSON.stringify({ email, password, userId: user.id, note: "local bench only — do not commit" }, null, 2),
      "utf8"
    );
  } else {
    db.prepare("UPDATE users SET is_admin=1, is_adult=1, nsfw_on=1, points=50000000 WHERE id=?").run(user.id);
    if (!existsSync(credPath)) {
      // password unknown — recreate hash with new password
      const newPw = randomBytes(12).toString("hex");
      db.prepare("UPDATE users SET pw_hash=? WHERE id=?").run(hashPasswordCompat(newPw), user.id);
      writeFileSync(
        credPath,
        JSON.stringify({ email, password: newPw, userId: user.id, note: "local bench only — do not commit" }, null, 2),
        "utf8"
      );
    }
  }

  const ch = fixture.character;
  let character = db.prepare("SELECT id FROM characters WHERE name=? AND creator_id=?").get(ch.name, user.id);
  if (!character) {
    // Prefer id=18 if free for familiarity; otherwise auto id
    const id18 = db.prepare("SELECT id FROM characters WHERE id=18").get();
    if (!id18) {
      db.prepare(
        `INSERT INTO characters (
          id, name, tagline, description, greeting, system_prompt, world, example_dialog,
          nsfw, official, creator_id, creator_name, visibility, moderation_status, content_kind, gender
        ) VALUES (18,?,?,?,?,?,?,?, ?,1,?,?, 'public','approved','character',?)`
      ).run(
        ch.name,
        "에이지스 컨트롤 · 라이크",
        ch.system_prompt,
        ch.greeting,
        ch.system_prompt,
        ch.world,
        ch.example_dialog,
        ch.nsfw ? 1 : 0,
        user.id,
        "벤치관리자",
        ch.gender || "male"
      );
      character = { id: 18 };
    } else {
      const info = db
        .prepare(
          `INSERT INTO characters (
            name, tagline, description, greeting, system_prompt, world, example_dialog,
            nsfw, official, creator_id, creator_name, visibility, moderation_status, content_kind, gender
          ) VALUES (?,?,?,?,?,?,?, ?,1,?,?, 'public','approved','character',?)`
        )
        .run(
          ch.name,
          "에이지스 컨트롤 · 라이크",
          ch.system_prompt,
          ch.greeting,
          ch.system_prompt,
          ch.world,
          ch.example_dialog,
          ch.nsfw ? 1 : 0,
          user.id,
          "벤치관리자",
          ch.gender || "male"
        );
      character = { id: Number(info.lastInsertRowid) };
    }
  }

  const personaName = fixture.persona.name;
  const personaDesc = fixture.persona.description;
  let persona = db
    .prepare("SELECT id FROM user_personas WHERE user_id=? AND name=?")
    .get(user.id, personaName);
  if (!persona) {
    const info = db
      .prepare(
        `INSERT INTO user_personas (user_id, name, description, gender) VALUES (?,?,?,?)`
      )
      .run(user.id, personaName, personaDesc, fixture.persona.gender || "other");
    persona = { id: Number(info.lastInsertRowid) };
  }

  const meta = {
    userId: user.id,
    characterId: character.id,
    characterName: ch.name,
    personaId: persona.id,
    personaName,
    sitePath: `${BASE}/character/${character.id}`,
    apiPath: `${BASE}/api/chat`,
    seeds: SEEDS,
    turn7: TURN7,
    fixtureProvenance: fixture.provenance || null,
    authMethod: "local email/password via /api/auth/login (creds in bench/.local_bench_creds.json, gitignored)",
    note: "Production admin session unavailable; used local production chat path + C18 fixture character/persona.",
  };
  writeFileSync(join(BENCH_DIR, "env_meta.json"), JSON.stringify(meta, null, 2), "utf8");
  db.close();
  console.log(
    JSON.stringify({
      ok: true,
      userId: user.id,
      characterId: character.id,
      personaId: persona.id,
      credsFile: "bench/.local_bench_creds.json",
    })
  );
}

function loadMeta() {
  return JSON.parse(readFileSync(join(BENCH_DIR, "env_meta.json"), "utf8"));
}

function loadCreds() {
  return JSON.parse(readFileSync(join(BENCH_DIR, ".local_bench_creds.json"), "utf8"));
}

async function login() {
  const creds = loadCreds();
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  if (!res.ok) {
    throw new Error(`login failed status=${res.status} body=${(await res.text()).slice(0, 200)}`);
  }
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) {
    // fallback single set-cookie
    const sc = res.headers.get("set-cookie");
    if (!sc) throw new Error("login ok but no set-cookie");
    return sc.split(",")[0].split(";")[0];
  }
  return cookie;
}

async function setModel(cookie, modelId) {
  const res = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ selectedAI: modelId }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`setModel ${modelId} failed ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

function countStats(text) {
  const chars_with_spaces = [...text].length;
  const chars_without_spaces = [...text.replace(/\s+/g, "")].length;
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const quoted_dialogue_count = (text.match(/[“"][^”"]+[”"]/g) || []).length;
  return {
    chars_with_spaces,
    chars_without_spaces,
    paragraph_count: paragraphs.length,
    quoted_dialogue_count,
  };
}

async function postChatTurn({ cookie, characterId, chatId, personaId, message, userNote }) {
  const started = Date.now();
  const body = {
    characterId,
    message,
    selectedPersonaId: personaId,
  };
  if (chatId) body.chatId = chatId;
  if (userNote) body.userNote = userNote;

  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const httpStatus = res.status;
  const raw = await res.text();
  const latency_ms = Date.now() - started;

  let assistant = "";
  let done = null;
  let err = null;
  for (const line of raw.split(/\n/)) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      if (obj.type === "token" || obj.type === "delta") {
        assistant += obj.text || obj.delta || obj.content || "";
      } else if (obj.type === "done") {
        done = obj;
        if (obj.finalContent) assistant = obj.finalContent;
      } else if (obj.type === "error") {
        err = obj;
      }
    } catch {
      /* ignore partial */
    }
  }
  if (!assistant && done?.finalContent) assistant = done.finalContent;

  return {
    httpStatus,
    latency_ms,
    chatId: done?.chatId ?? chatId ?? null,
    messageId: done?.messageId ?? null,
    finish_reason: done?.finishReason ?? done?.usage?.finishReason ?? null,
    usage: done?.usage ?? null,
    assistant,
    error: err,
    raw_sse_chars: raw.length,
  };
}

function promptVariantState(modelKey, phase) {
  if (phase === "A") {
    if (modelKey === "opus5") return "Arm E PRESENT (production)";
    if (modelKey === "terra") return "Terra completion contract PRESENT (production)";
    return "style-only reminder PRESENT + future boundary PRESENT + USER_TAIL length PRESENT";
  }
  if (modelKey === "opus5") return "Arm E REMOVED → generic USER_TAIL";
  if (modelKey === "terra") return "Terra contract REMOVED → generic USER_TAIL";
  return "future boundary REMOVED; style-only reminder KEPT; USER_TAIL length KEPT";
}

function appendTurnMd(path, block) {
  ensureDir(dirname(path));
  writeFileSync(path, (existsSync(path) ? readFileSync(path, "utf8") : "") + block, "utf8");
}

async function waitForSummary(chatId, { timeoutMs = 180_000, pollMs = 2000 } = {}) {
  const db = openDb();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = db
      .prepare(
        `SELECT id, chat_id, turn_number, summary, summary_kind, created_at, inactive,
                source_start_user_message_id, source_end_user_message_id, scope_payload
         FROM chat_turn_summaries WHERE chat_id=? AND IFNULL(inactive,0)=0 ORDER BY id ASC`
      )
      .all(chatId);
    if (rows.length > 0) {
      db.close();
      return rows;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  db.close();
  return [];
}

function latestCaptureForChat(chatId, phase) {
  const dir = join(BENCH_DIR, "summary_capture");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(`chat_${chatId}_${phase}_`))
    .sort();
  if (!files.length) return null;
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), "utf8"));
}

function extractInjectionEvidence(promptDumpText, summaryText) {
  if (!promptDumpText || !summaryText) {
    return { injection_count: 0, found: false };
  }
  const needle = summaryText.trim().slice(0, 80);
  if (!needle) return { injection_count: 0, found: false };
  let count = 0;
  let idx = 0;
  while (true) {
    const at = promptDumpText.indexOf(needle, idx);
    if (at < 0) break;
    count += 1;
    idx = at + needle.length;
  }
  const memIdx = promptDumpText.indexOf("[Memory]");
  return {
    found: count > 0,
    injection_count: count,
    injection_position_hint:
      memIdx >= 0 && promptDumpText.indexOf(needle) > memIdx ? "after_[Memory]_marker" : "unknown",
    summary_snippet_used: needle,
  };
}

async function runPhase(phase) {
  const meta = loadMeta();
  const cookie = await login();
  ensureDir(BENCH_DIR);
  const resultsPath = join(BENCH_DIR, `phase_${phase}_results.json`);
  const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, "utf8")) : { phase, chats: {} };

  for (const [modelKey, model] of Object.entries(MODELS)) {
    const benchId = `BENCH_${model.label.toUpperCase()}_${phase}_${DATE_TAG}`;
    const mdPath = join(BENCH_DIR, `${modelKey}_${phase}_raw.md`);
    if (existsSync(mdPath) && results.chats[`${modelKey}_${phase}`]?.completed6) {
      console.log(`skip existing ${modelKey}_${phase}`);
      continue;
    }
    writeFileSync(
      mdPath,
      `# RAW ${model.label} ${phase}\n\nBENCH_ID: ${benchId}\nMODEL_ID: ${model.id}\nPROMPT_VARIANT: ${promptVariantState(modelKey, phase)}\n\n`,
      "utf8"
    );

    console.log(`[${phase}] set model ${model.id}`);
    await setModel(cookie, model.id);

    let chatId = null;
    const turns = [];

    for (let t = 1; t <= 6; t++) {
      const userInput = SEEDS[t - 1];
      console.log(`[${phase}] ${modelKey} turn ${t} start`);
      const out = await postChatTurn({
        cookie,
        characterId: meta.characterId,
        chatId,
        personaId: meta.personaId,
        message: userInput,
        userNote: t === 1 ? benchId : undefined,
      });
      chatId = out.chatId || chatId;
      if (t === 1 && chatId) {
        const db = openDb();
        db.prepare("UPDATE chats SET title=? WHERE id=?").run(benchId, chatId);
        db.close();
      }
      const stats = countStats(out.assistant || "");
      const turnRec = {
        model: model.id,
        variant: phase,
        chat_id: chatId,
        turn: t,
        user_input: userInput,
        assistant_output: out.assistant,
        http_status: out.httpStatus,
        latency_ms: out.latency_ms,
        finish_reason: out.finish_reason,
        usage: out.usage,
        stats,
        error: out.error,
        prompt_variant: promptVariantState(modelKey, phase),
      };
      turns.push(turnRec);
      appendTurnMd(
        mdPath,
        [
          `MODEL: ${model.id}`,
          `VARIANT: ${phase}`,
          `CHAT_ID: ${chatId}`,
          `TURN: ${t}`,
          ``,
          `USER_INPUT:`,
          userInput,
          ``,
          `ASSISTANT_OUTPUT:`,
          out.assistant || "",
          ``,
          `USAGE:`,
          `- input_tokens: ${out.usage?.inputTokens ?? out.usage?.prompt_tokens ?? ""}`,
          `- cached_input_tokens: ${out.usage?.cachedContentTokens ?? out.usage?.cacheReadTokens ?? ""}`,
          `- output_tokens: ${out.usage?.outputTokens ?? out.usage?.completion_tokens ?? ""}`,
          `- reasoning_tokens: ${out.usage?.reasoningOutputTokens ?? out.usage?.thoughtsTokens ?? ""}`,
          `- total_tokens: ${out.usage?.totalTokens ?? ""}`,
          `- provider_cost: ${out.usage?.upstreamCostUsd ?? out.usage?.cost ?? ""}`,
          `- latency_ms: ${out.latency_ms}`,
          `- finish_reason: ${out.finish_reason ?? ""}`,
          `- HTTP/status: ${out.httpStatus}`,
          ``,
          `PROMPT_VARIANT:`,
          `- ${promptVariantState(modelKey, phase)}`,
          ``,
          `RAW_COUNTS:`,
          `- chars_with_spaces: ${stats.chars_with_spaces}`,
          `- chars_without_spaces: ${stats.chars_without_spaces}`,
          `- paragraph_count: ${stats.paragraph_count}`,
          `- quoted_dialogue_count: ${stats.quoted_dialogue_count}`,
          ``,
          `---`,
          ``,
        ].join("\n")
      );
      writeFileSync(
        join(BENCH_DIR, `${modelKey}_${phase}_turn${t}.json`),
        JSON.stringify(turnRec, null, 2),
        "utf8"
      );
      if (!out.assistant || out.httpStatus >= 400 || out.error) {
        console.error(`[${phase}] ${modelKey} turn ${t} FAILED`, out.httpStatus, out.error);
        break;
      }
    }

    // Summary wait + capture
    let summaryRows = [];
    let pre = null;
    let post = null;
    if (chatId && turns.length === 6) {
      console.log(`[${phase}] ${modelKey} waiting summary chat=${chatId}`);
      summaryRows = await waitForSummary(chatId);
      pre = latestCaptureForChat(chatId, "pre_llm");
      post = latestCaptureForChat(chatId, "post_llm");
    }

    // Turn 7 injection check
    let turn7 = null;
    let injection = null;
    if (chatId && turns.length === 6) {
      console.log(`[${phase}] ${modelKey} turn 7`);
      const out7 = await postChatTurn({
        cookie,
        characterId: meta.characterId,
        chatId,
        personaId: meta.personaId,
        message: TURN7,
      });
      turn7 = {
        model: model.id,
        variant: phase,
        chat_id: chatId,
        turn: 7,
        user_input: TURN7,
        assistant_output: out7.assistant,
        http_status: out7.httpStatus,
        latency_ms: out7.latency_ms,
        finish_reason: out7.finish_reason,
        usage: out7.usage,
        stats: countStats(out7.assistant || ""),
        prompt_variant: promptVariantState(modelKey, phase),
      };
      appendTurnMd(
        mdPath,
        [
          `MODEL: ${model.id}`,
          `VARIANT: ${phase}`,
          `CHAT_ID: ${chatId}`,
          `TURN: 7 (summary injection check)`,
          ``,
          `USER_INPUT:`,
          TURN7,
          ``,
          `ASSISTANT_OUTPUT:`,
          out7.assistant || "",
          ``,
          `USAGE:`,
          `- input_tokens: ${out7.usage?.inputTokens ?? ""}`,
          `- output_tokens: ${out7.usage?.outputTokens ?? ""}`,
          `- latency_ms: ${out7.latency_ms}`,
          `- finish_reason: ${out7.finish_reason ?? ""}`,
          `- HTTP/status: ${out7.httpStatus}`,
          ``,
          `---`,
          ``,
        ].join("\n")
      );
      const dumpPath = join(ROOT, "debug", "prompt_dump.txt");
      if (existsSync(dumpPath)) {
        const dumpCopy = join(BENCH_DIR, `${modelKey}_${phase}_turn7_prompt_dump.txt`);
        copyFileSync(dumpPath, dumpCopy);
        const dumpText = readFileSync(dumpCopy, "utf8");
        const summaryText = summaryRows[0]?.summary || post?.summaryText || "";
        injection = extractInjectionEvidence(dumpText, summaryText);
        injection.prompt_dump_path = dumpCopy;
        injection.summary_id = summaryRows[0]?.id ?? null;
        injection.chat_id = chatId;
        // Do not store full dump in json result — path only + counts
      }
    }

    results.chats[`${modelKey}_${phase}`] = {
      benchId,
      modelId: model.id,
      chatId,
      completed6: turns.length === 6 && turns.every((t) => !!t.assistant_output),
      turns: turns.map((t) => ({
        turn: t.turn,
        http_status: t.http_status,
        latency_ms: t.latency_ms,
        finish_reason: t.finish_reason,
        chars_with_spaces: t.stats.chars_with_spaces,
        output_tokens: t.usage?.outputTokens ?? null,
        input_tokens: t.usage?.inputTokens ?? null,
      })),
      summary: {
        rows: summaryRows.map((r) => ({
          id: r.id,
          turn_number: r.turn_number,
          summary_kind: r.summary_kind,
          created_at: r.created_at,
          summary_chars: [...(r.summary || "")].length,
          summary: r.summary,
          source_start_user_message_id: r.source_start_user_message_id,
          source_end_user_message_id: r.source_end_user_message_id,
        })),
        pre_llm: pre
          ? {
              observedSourceTurnIndexes: pre.observedSourceTurnIndexes,
              observedSourceTurnCount: pre.observedSourceTurnCount,
              summaryStartTurn: pre.summaryStartTurn,
              summaryEndTurn: pre.summaryEndTurn,
              dialoguePreviewChars: pre.dialoguePreviewChars,
              capture_file_hint: `chat_${chatId}_pre_llm_*`,
            }
          : null,
        post_llm: post
          ? {
              summaryChars: post.summaryChars,
              usage: post.usage,
              latencyMs: post.latencyMs,
              summaryText: post.summaryText,
            }
          : null,
      },
      turn7: turn7
        ? {
            http_status: turn7.http_status,
            latency_ms: turn7.latency_ms,
            chars_with_spaces: turn7.stats.chars_with_spaces,
          }
        : null,
      turn7_injection: injection,
    };
    writeFileSync(resultsPath, JSON.stringify(results, null, 2), "utf8");
    writeFileSync(
      join(BENCH_DIR, `${modelKey}_${phase}_bundle.json`),
      JSON.stringify({ turns, turn7, summaryRows, pre, post, injection }, null, 2),
      "utf8"
    );
  }
  console.log(JSON.stringify({ ok: true, phase, resultsPath }, null, 2));
}

function assemble() {
  ensureDir(BENCH_DIR);
  const meta = loadMeta();
  const a = existsSync(join(BENCH_DIR, "phase_A_results.json"))
    ? JSON.parse(readFileSync(join(BENCH_DIR, "phase_A_results.json"), "utf8"))
    : { chats: {} };
  const b = existsSync(join(BENCH_DIR, "phase_B_results.json"))
    ? JSON.parse(readFileSync(join(BENCH_DIR, "phase_B_results.json"), "utf8"))
    : { chats: {} };
  const all = { ...a.chats, ...b.chats };

  const summaryMd = [];
  summaryMd.push("# summaries_raw\n");
  summaryMd.push("Fact-only. No quality verdicts.\n");

  for (const [key, chat] of Object.entries(all)) {
    summaryMd.push(`\n## ${key}\n`);
    summaryMd.push(`CHAT_ID: ${chat.chatId}`);
    summaryMd.push(`BENCH_ID: ${chat.benchId}`);
    const preFiles = existsSync(join(BENCH_DIR, "summary_capture"))
      ? readdirSync(join(BENCH_DIR, "summary_capture")).filter((f) =>
          f.startsWith(`chat_${chat.chatId}_pre_llm_`)
        )
      : [];
    const pre = preFiles.length
      ? JSON.parse(readFileSync(join(BENCH_DIR, "summary_capture", preFiles.sort().at(-1)), "utf8"))
      : null;
    if (pre) {
      summaryMd.push(`\nSUMMARY_TRIGGER:`);
      summaryMd.push(`chat_id=${chat.chatId}`);
      summaryMd.push(`source_turn_start=${pre.summaryStartTurn}`);
      summaryMd.push(`source_turn_end=${pre.summaryEndTurn}`);
      summaryMd.push(`observed_indexes=${JSON.stringify(pre.observedSourceTurnIndexes)}`);
      summaryMd.push(`\nSUMMARY_SOURCE_MESSAGES\n`);
      for (const t of pre.sourceTurns || []) {
        summaryMd.push(`Turn ${t.turnIndex} USER:`);
        summaryMd.push(t.user);
        summaryMd.push("");
        summaryMd.push(`Turn ${t.turnIndex} ASSISTANT:`);
        summaryMd.push(t.assistant);
        summaryMd.push("");
      }
    } else {
      summaryMd.push("\nSUMMARY_TRIGGER: NOT_CAPTURED");
    }
    const row = chat.summary?.rows?.[0];
    if (row) {
      summaryMd.push(`\nSUMMARY_DB_RECORD`);
      summaryMd.push(`chat_id: ${chat.chatId}`);
      summaryMd.push(`summary_id: ${row.id}`);
      summaryMd.push(`created_at: ${row.created_at}`);
      summaryMd.push(`turn_number: ${row.turn_number}`);
      summaryMd.push(`summary_chars: ${row.summary_chars}`);
      summaryMd.push(`\nSUMMARY_TEXT:`);
      summaryMd.push(row.summary || "");
    } else {
      summaryMd.push("\nSUMMARY_DB_RECORD: NONE");
    }
    if (chat.summary?.post_llm) {
      summaryMd.push(`\nSUMMARY_CALL_USAGE:`);
      summaryMd.push(JSON.stringify(chat.summary.post_llm.usage || {}, null, 2));
      summaryMd.push(`latency: ${chat.summary.post_llm.latencyMs}`);
      summaryMd.push(`\nSUMMARY_MODEL_OUTPUT:`);
      summaryMd.push(chat.summary.post_llm.summaryText || "");
    }
    if (chat.turn7_injection) {
      summaryMd.push(`\nTURN7_SUMMARY_INJECTION`);
      summaryMd.push(JSON.stringify(chat.turn7_injection, null, 2));
    }
    summaryMd.push("\n---\n");
  }
  writeFileSync(join(BENCH_DIR, "summaries_raw.md"), summaryMd.join("\n"), "utf8");

  const benchRaw = {
    meta,
    seeds: SEEDS,
    turn7: TURN7,
    phaseA: a,
    phaseB: b,
    investigation: {
      opus5: {
        block: "OPUS_ARM_E_TERMINAL (~1293 chars)",
        file: "src/lib/opusTerminalLengthOwner.ts",
        resolver: "resolveOpusArmETerminal / shouldUseOpusArmETerminal",
        assembly: "appendCompactTerminalLengthToUserTurn (responseLength.ts) when Opus+interactive+character",
        relation_to_307: "Arm E includes ownership/future-boundary + length; #307 is common collaborative owner",
        B: "BENCH_AB_OPUS_DROP_ARM_E=1 → Arm E omitted → USER_TAIL_LENGTH_OWNER_SENTENCE",
      },
      terra: {
        block: "TERRA_TERMINAL_LENGTH_OWNER_CONTRACT",
        file: "src/lib/terraTerminalLengthOwner.ts",
        resolver: "shouldUseTerraTerminalLengthOwner → appendTerraTerminalLengthOwnerToUserTurn",
        assembly: "contextBuilder terraTerminalLengthOwner branch",
        B: "BENCH_AB_TERRA_DROP_CONTRACT=1 → generic USER_TAIL path",
      },
      deepseek: {
        style_only: {
          const: "DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY",
          file: "src/lib/deepseekPromptStructure.ts",
          assembly: "prependDeepSeekStyleOnlyReminder in contextBuilder",
          overlap_307: "NOT clear ownership overlap (register/style formatting) — KEPT in B",
        },
        future_boundary: {
          const: "DEEPSEEK_COMPACT_FUTURE_INSTRUCTION_BOUNDARY",
          file: "src/lib/deepseekFutureInstructionBoundary.ts",
          assembly: "appendCompactTerminalLengthToUserTurn mid-block before USER_TAIL",
          overlap_307: "Clear ownership overlap with COLLABORATIVE_INTERACTIVE_OWNER_BLOCK (#307)",
        },
        B: "BENCH_AB_DEEPSEEK_DROP_FUTURE_BOUNDARY=1 only; length + style-only + XML/LTM unchanged",
      },
    },
  };
  writeFileSync(join(BENCH_DIR, "bench_raw.json"), JSON.stringify(benchRaw, null, 2), "utf8");

  // execution table
  const lines = ["# Execution facts\n", "| model | variant | 1~6 완료 | summary trigger | DB 저장 | Turn7 injection |", "| ----- | ------- | ------ | --------------- | ----- | --------------- |"];
  for (const modelKey of Object.keys(MODELS)) {
    for (const phase of ["A", "B"]) {
      const chat = all[`${modelKey}_${phase}`];
      if (!chat) {
        lines.push(`| ${modelKey} | ${phase} | no | no | no | no |`);
        continue;
      }
      const preOk = !!chat.summary?.pre_llm;
      const dbOk = (chat.summary?.rows?.length || 0) > 0;
      const inj = chat.turn7_injection?.found ? `yes(count=${chat.turn7_injection.injection_count})` : "no/unknown";
      lines.push(
        `| ${modelKey} | ${phase} | ${chat.completed6 ? "yes" : "no"} | ${preOk ? `yes(${chat.summary.pre_llm.observedSourceTurnIndexes})` : "no"} | ${dbOk ? "yes" : "no"} | ${inj} |`
      );
    }
  }
  writeFileSync(join(BENCH_DIR, "execution_facts.md"), lines.join("\n") + "\n", "utf8");
  console.log(JSON.stringify({ ok: true, assembled: ["summaries_raw.md", "bench_raw.json", "execution_facts.md"] }));
}

const cmd = process.argv[2];
const phaseArg = process.argv.includes("--phase")
  ? process.argv[process.argv.indexOf("--phase") + 1]
  : null;

if (cmd === "seed") await seed();
else if (cmd === "run") await runPhase(phaseArg || "A");
else if (cmd === "assemble") assemble();
else {
  console.error("Usage: seed | run --phase A|B | assemble");
  process.exit(1);
}
