/**
 * B37 — external RP (T1..T100, user-supplied, PRIVATE) replayed through the canonical
 * POST /api/chat path in an isolated SQLite DB, then continued (T101+) with real Main RP calls.
 *
 * Nothing private lives in this file. Inputs come from B37_PRIVATE_DIR (outside the repo):
 *   messages.jsonl           {turn, role, content} x200      (external T1..T100)
 *   intro.txt                external scene preamble -> character greeting
 *   persona.txt              USER persona text, injected unchanged every turn
 *   canon.txt                temporary character canon for "8" (traits observable in the data only)
 *   continuation-user.json   scripted USER lines for T101+ (SYNTHETIC continuation)
 *
 * Keys come from the environment and are never written:
 *   RP_QUALITY_PAID_OPENROUTER_KEY      -> OPENROUTER_API_KEY (Main RP: Gemini 3.8 Flash)
 *   CHEAPER_INFERENCE_BENCHMARK_API_KEY -> CHEAPER_INFERENCE_API_KEY (background Luna)
 *
 * Commands (state persists in B37_DB_DIR between invocations):
 *   ingest <toTurn>      external turns; Main RP answered locally with the EXTERNAL assistant text,
 *                        all memory jobs (summary / episodic / relationship / global) run live
 *   gen <toTurn>         real Main RP generation for turns after the external block (paid)
 *   ask <label> <on|off> <question-file>   one real Main RP recall turn on a COPY of the DB
 *   probe <label> <question-file>          provider-free retrieval/injection probe (no Main RP call)
 *   stats                ledger + memory-state summary
 */
import Module from "node:module";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const PRIVATE_DIR = process.env.B37_PRIVATE_DIR ?? "/tmp/b37";
const DB_DIR = process.env.B37_DB_DIR ?? path.join(PRIVATE_DIR, "run-db");
const OUT_DIR = process.env.B37_OUT_DIR ?? path.join(PRIVATE_DIR, "out");
const COST_CAP_USD = Number(process.env.B37_COST_CAP_USD ?? "0.62");
const KRW_PER_USD = Number(process.env.B37_KRW_PER_USD ?? "1351.45");
const CHECKPOINTS = new Set((process.env.B37_CHECKPOINTS ?? "30,50,80,100,150,200,250,300").split(",").map(Number));

const orKey = process.env.RP_QUALITY_PAID_OPENROUTER_KEY?.trim();
const ciKey = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim();
if (!orKey || !ciKey) throw new Error("experiment keys missing");
process.env.OPENROUTER_API_KEY = orKey;
process.env.CHEAPER_INFERENCE_API_KEY = ciKey;
delete process.env.MOCK_MODE;
delete process.env.NODE_TEST_CONTEXT;
process.env.MEMORY_FEATURE_ENABLED = "1";
process.env.SESSION_SECRET ??= "b37-local-session-secret-0123456789abcdef";
process.env.DATA_DIR = DB_DIR;
mkdirSync(DB_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const [cmd = "", ...args] = process.argv.slice(2);

let sessionToken = "";
const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (name: string) =>
          name === "session" && sessionToken ? { value: sessionToken } : undefined,
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const { getDb } = await import("@/lib/db");
const { createSession } = await import("@/lib/auth");
const { creditPoints } = await import("@/lib/points");
const { setUserSelectedAI } = await import("@/lib/userSelectedAI");
const { createChatSession } = await import("@/lib/chatSessionCreate");
const { GEMINI_38_FLASH_MODEL } = await import("@/lib/chatModels");
const { getEpisodicMemoryForPrompt } = await import("@/lib/episodicMemoryFacts");

const USER_ID = 9101;
const CHARACTER_ID = 9102;
const MAIN_WIRE_MODEL = "google/gemini-3.8-flash";

const db = () => getDb();
const read = (name: string) => readFileSync(path.join(PRIVATE_DIR, name), "utf8");

type Msg = { turn: number; role: "user" | "assistant"; content: string };
const external: Msg[] = read("messages.jsonl")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Msg);
const externalUser = (turn: number) => external.find((m) => m.turn === turn && m.role === "user")!.content;
const externalAssistant = (turn: number) =>
  external.find((m) => m.turn === turn && m.role === "assistant")!.content;

// ---------------------------------------------------------------- provider interception
let phase = "setup";
let stubAssistantText: string | null = null;
let wireSerial = 0;
const calls: Array<Record<string, unknown>> = [];

function sseText(text: string): Response {
  const chunk = JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] });
  const done = JSON.stringify({
    choices: [{ delta: {}, finish_reason: "stop", native_finish_reason: "STOP" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 },
  });
  return new Response(`data: ${chunk}\n\ndata: ${done}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function spentUsd(): number {
  try {
    return (
      db().prepare("SELECT COALESCE(SUM(actual_cost_usd),0) AS usd FROM api_cost_ledger").get() as {
        usd: number;
      }
    ).usd;
  } catch {
    return 0;
  }
}
const krw = (usd: number) => Math.round(usd * KRW_PER_USD * 10) / 10;

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/embedding/i.test(url)) throw new Error(`embedding call blocked: ${url.slice(0, 60)}`);
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  const bodyText = typeof init?.body === "string" ? init.body : "";
  let model = "";
  let stream = false;
  try {
    const parsed = JSON.parse(bodyText) as { model?: unknown; stream?: unknown };
    model = String(parsed.model ?? "");
    stream = parsed.stream === true;
  } catch {
    model = "";
  }
  wireSerial += 1;
  const isMainShape = stream || model === MAIN_WIRE_MODEL;
  const stubbed = isMainShape && stubAssistantText !== null;
  calls.push({ n: wireSerial, phase, model, stream, bytes: bodyText.length, stubbed });
  if (isMainShape) {
    const wirePath = path.join(OUT_DIR, "wires", `${String(wireSerial).padStart(4, "0")}-${phase}.json`);
    mkdirSync(path.dirname(wirePath), { recursive: true });
    writeFileSync(wirePath, bodyText);
  }
  if (stubbed) {
    const text = stubAssistantText!;
    stubAssistantText = null;
    return sseText(text);
  }
  if (spentUsd() > COST_CAP_USD) {
    throw new Error(`COST_CAP exceeded: $${spentUsd().toFixed(4)} (~₩${krw(spentUsd())})`);
  }
  return realFetch(input, init);
}) as typeof fetch;

// ---------------------------------------------------------------- helpers
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postTurn(chatId: number, message: string, label: string) {
  phase = label;
  const { POST } = await import("@/app/api/chat/route");
  const started = Date.now();
  const response = await POST(
    new Request("http://127.0.0.1/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: CHARACTER_ID,
        chatId,
        message,
        clientRequestId: `b37-${label}-${Date.now()}`,
      }),
    })
  );
  const raw = await response.text();
  const events: Array<Record<string, unknown>> = [];
  for (const block of raw.split("\n\n")) {
    const line = block.split("\n").find((part) => part.trim().startsWith("data:"));
    if (!line) continue;
    const json = line.trim().slice(5).trim();
    if (!json || json === "[DONE]") continue;
    try {
      events.push(JSON.parse(json) as Record<string, unknown>);
    } catch {
      /* non-JSON stream line */
    }
  }
  const error = events.find((event) => event.type === "error");
  const done = [...events].reverse().find((event) => event.type === "done");
  return { status: response.status, error, done, ms: Date.now() - started, raw: raw.slice(0, 400) };
}

function ledgerCount(): number {
  try {
    return (db().prepare("SELECT COUNT(*) AS n FROM api_cost_ledger").get() as { n: number }).n;
  } catch {
    return 0;
  }
}

/** Background memory jobs are fire-and-forget after SSE done; wait until the ledger is quiet. */
async function waitBackgroundQuiet(minMs = 4000, quietMs = 9000, maxMs = 240_000) {
  const start = Date.now();
  let last = ledgerCount();
  let lastChange = Date.now();
  await sleep(minMs);
  while (Date.now() - start < maxMs) {
    await sleep(1500);
    const now = ledgerCount();
    if (now !== last) {
      last = now;
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) break;
  }
}

function lastAssistant(chatId: number) {
  return db()
    .prepare(
      `SELECT id, content, generation_status FROM messages
       WHERE chat_id=? AND role='assistant' AND IFNULL(model,'')!='greeting' ORDER BY id DESC LIMIT 1`
    )
    .get(chatId) as { id: number; content: string; generation_status: string | null } | undefined;
}

function completedTurns(chatId: number): number {
  return (
    db()
      .prepare(
        `SELECT COUNT(*) AS n FROM messages WHERE chat_id=? AND role='assistant' AND IFNULL(model,'')!='greeting'
         AND generation_status='completed'`
      )
      .get(chatId) as { n: number }
  ).n;
}

function labelExternalRow(messageId: number) {
  const row = db().prepare("SELECT alternates FROM messages WHERE id=?").get(messageId) as {
    alternates: string | null;
  };
  let alternates = row.alternates;
  try {
    const parsed = JSON.parse(alternates ?? "[]") as Array<Record<string, unknown>>;
    for (const variant of parsed) variant.model = "external-import";
    alternates = JSON.stringify(parsed);
  } catch {
    /* keep */
  }
  db().prepare("UPDATE messages SET model='external-import', alternates=? WHERE id=?").run(alternates, messageId);
}

function ensureWorld(): number {
  const d = db();
  const existing = d.prepare("SELECT id FROM chats WHERE user_id=? ORDER BY id LIMIT 1").get(USER_ID) as
    | { id: number }
    | undefined;
  if (existing) {
    sessionToken = createSession(USER_ID);
    return existing.id;
  }
  d.prepare("INSERT INTO users (id, email, nickname, pw_hash, is_adult, is_admin) VALUES (?,?,?,?,1,1)").run(
    USER_ID,
    "b37-external@example.com",
    "제이",
    "x"
  );
  d.prepare(
    `INSERT INTO characters (id, name, greeting, nsfw, visibility, moderation_status, official, description, system_prompt)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    CHARACTER_ID,
    "8",
    read("intro.txt").trim(),
    1,
    "public",
    "approved",
    0,
    read("canon.txt").trim(),
    read("canon.txt").trim()
  );
  const persona = d
    .prepare("INSERT INTO user_personas (user_id, name, description) VALUES (?,?,?)")
    .run(USER_ID, "제이", read("persona.txt").trim());
  creditPoints(USER_ID, 500000, "FREE", "b37 fixture free");
  creditPoints(USER_ID, 500000, "PAID", "b37 fixture paid");
  setUserSelectedAI(d, USER_ID, GEMINI_38_FLASH_MODEL);
  sessionToken = createSession(USER_ID);
  return createChatSession({
    userId: USER_ID,
    characterId: CHARACTER_ID,
    greeting: read("intro.txt").trim(),
    selectedPersonaId: Number(persona.lastInsertRowid),
    __testOnGreetingSchedule: () => {},
  });
}

function dbSnapshot(chatId: number) {
  const d = db();
  return {
    episodicFacts: d
      .prepare(
        `SELECT id, source_turn, category, subject, attribute, importance, fact_text, metadata
         FROM episodic_memory_facts WHERE chat_id=? ORDER BY id`
      )
      .all(chatId),
    turnSummaries: d
      .prepare(`SELECT turn_number, turn_end, summary_kind, summary FROM chat_turn_summaries WHERE chat_id=? ORDER BY turn_number`)
      .all(chatId),
    chatMemory: d
      .prepare(
        `SELECT recent_summary, archive_summary, summarized_turn_count, global_projection_kind FROM chat_memories WHERE chat_id=?`
      )
      .get(chatId),
    relationshipMeta: d.prepare(`SELECT memory_meta FROM chats WHERE id=?`).get(chatId),
  };
}

function checkpoint(chatId: number, turn: number) {
  d_checkpoint(turn);
  writeFileSync(
    path.join(OUT_DIR, `state-T${turn}.json`),
    JSON.stringify({ turn, spentUsd: spentUsd(), ...dbSnapshot(chatId) }, null, 2)
  );
}

function d_checkpoint(turn: number) {
  db().pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(path.join(DB_DIR, "app.db"), path.join(PRIVATE_DIR, `snap-T${turn}.db`));
}

function logLine(line: string) {
  appendFileSync(path.join(OUT_DIR, "run.log"), `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

// ---------------------------------------------------------------- commands
const chatId = ensureWorld();

if (cmd === "ingest") {
  const to = Number(args[0]);
  let turn = completedTurns(chatId);
  while (turn < to) {
    const t = turn + 1;
    const before = spentUsd();
    stubAssistantText = externalAssistant(t);
    const result = await postTurn(chatId, externalUser(t), `ingest-T${t}`);
    if (result.error || result.status !== 200) {
      logLine(`T${t} FAILED status=${result.status} error=${JSON.stringify(result.error ?? null).slice(0, 300)} raw=${result.raw}`);
      process.exit(2);
    }
    const assistant = lastAssistant(chatId);
    if (!assistant || assistant.content !== externalAssistant(t)) {
      logLine(`T${t} stored assistant differs from external source (stored ${assistant?.content?.length ?? 0} chars)`);
    }
    if (assistant) labelExternalRow(assistant.id);
    await waitBackgroundQuiet();
    turn = completedTurns(chatId);
    logLine(`T${t} ok ms=${result.ms} dCost=₩${krw(spentUsd() - before)} total=₩${krw(spentUsd())} calls=${calls.length}`);
    if (CHECKPOINTS.has(t)) checkpoint(chatId, t);
  }
} else if (cmd === "gen") {
  const to = Number(args[0]);
  const script = JSON.parse(read("continuation-user.json")) as Record<string, string>;
  let turn = completedTurns(chatId);
  while (turn < to) {
    const t = turn + 1;
    const message = script[String(t)];
    if (!message) throw new Error(`no scripted USER line for T${t}`);
    const before = spentUsd();
    const result = await postTurn(chatId, message, `gen-T${t}`);
    if (result.error || result.status !== 200) {
      logLine(`T${t} FAILED status=${result.status} error=${JSON.stringify(result.error ?? null).slice(0, 300)}`);
      process.exit(2);
    }
    await waitBackgroundQuiet();
    turn = completedTurns(chatId);
    const assistant = lastAssistant(chatId);
    logLine(
      `T${t} ok ms=${result.ms} outChars=${assistant?.content.length ?? 0} dCost=₩${krw(spentUsd() - before)} total=₩${krw(spentUsd())}`
    );
    if (CHECKPOINTS.has(t)) checkpoint(chatId, t);
    if (spentUsd() > COST_CAP_USD * 0.97) {
      logLine(`STOP: approaching cost cap at T${t}, total=₩${krw(spentUsd())}`);
      break;
    }
  }
} else if (cmd === "probe") {
  const [label, questionFile] = args as [string, string];
  const question = readFileSync(questionFile, "utf8").trim();
  const turn = completedTurns(chatId) + 1;
  const probe = getEpisodicMemoryForPrompt(db(), {
    chatId,
    characterId: CHARACTER_ID,
    userId: USER_ID,
    currentTurn: turn,
    currentUserMessage: question,
  });
  writeFileSync(
    path.join(OUT_DIR, `probe-${label}.json`),
    JSON.stringify(
      {
        label,
        atTurn: turn - 1,
        question,
        debug: probe.debug,
        injected: probe.facts.map((fact) => ({ id: fact.id, fact_text: fact.fact_text })),
        promptBlock: probe.promptBlock,
      },
      null,
      2
    )
  );
  logLine(`probe ${label} injected=${probe.facts.length}`);
} else if (cmd === "ask") {
  const [label, mode, questionFile] = args as [string, "on" | "off", string];
  const question = readFileSync(questionFile, "utf8").trim();
  const before = spentUsd();
  process.env.MEMORY_FEATURE_ENABLED = mode === "off" ? "0" : "1";
  const result = await postTurn(chatId, question, `ask-${label}-${mode}`);
  const assistant = lastAssistant(chatId);
  await waitBackgroundQuiet(2000, 6000, 90_000);
  const usage = (result.done as { usage?: unknown } | undefined)?.usage ?? null;
  writeFileSync(
    path.join(OUT_DIR, `ask-${label}-${mode}.json`),
    JSON.stringify(
      {
        label,
        mode,
        question,
        status: result.status,
        error: result.error ?? null,
        ms: result.ms,
        output: assistant?.content ?? null,
        usage,
        dCostUsd: spentUsd() - before,
      },
      null,
      2
    )
  );
  logLine(`ask ${label} ${mode} ok=${!result.error} chars=${assistant?.content.length ?? 0} dCost=₩${krw(spentUsd() - before)}`);
} else if (cmd === "stats") {
  const rows = db()
    .prepare(
      `SELECT request_kind, model, COUNT(*) AS n, ROUND(SUM(actual_cost_usd),5) AS usd,
              SUM(input_tokens) AS tin, SUM(output_tokens) AS tout
       FROM api_cost_ledger GROUP BY request_kind, model ORDER BY usd DESC`
    )
    .all();
  console.log(JSON.stringify({ chatId, completedTurns: completedTurns(chatId), totalUsd: spentUsd(), totalKrw: krw(spentUsd()), rows }, null, 2));
} else {
  throw new Error(`unknown command: ${cmd}`);
}
writeFileSync(path.join(OUT_DIR, "calls.json"), JSON.stringify(calls, null, 1));
process.exit(0);
