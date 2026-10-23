/**
 * B35 B2 — real Main RP recall through the canonical POST /api/chat path.
 *
 * Isolated temp SQLite only. Credentials are read from the environment and never written:
 *   RP_QUALITY_PAID_OPENROUTER_KEY      -> OPENROUTER_API_KEY (Main RP, Gemini 3.8 Flash)
 *   CHEAPER_INFERENCE_BENCHMARK_API_KEY -> CHEAPER_INFERENCE_API_KEY (background Luna)
 *
 * Turn 1 replays the real B32/B34 Ren/Wolfgang SAFE assistant text (the Main RP completion for
 * that single call is answered locally); the background Luna episodic call for it is live.
 * Turns 2..N and the recall question use the real Main RP model.
 *
 * Usage:
 *   node --conditions=react-server --import tsx docs/pr-evidence/pr-b35-memory-recall/run-main-rp-recall.mts
 */
import Module from "node:module";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const OUT_DIR =
  process.env.B35_OUT_DIR ?? path.join(process.cwd(), "docs/pr-evidence/pr-b35-memory-recall");
const COST_CAP_USD = Number(process.env.B35_COST_CAP_USD ?? "0.25");
const FILLER_TURNS = Math.max(4, Number(process.env.B35_FILLER_TURNS ?? "5"));

const orKey = process.env.RP_QUALITY_PAID_OPENROUTER_KEY?.trim();
const ciKey = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY?.trim();
if (!orKey || !ciKey) throw new Error("experiment keys missing");
if (ciKey === (process.env.CHEAPER_INFERENCE_API_KEY?.trim() ?? "")) {
  throw new Error("benchmark key must differ from production key");
}
process.env.OPENROUTER_API_KEY = orKey;
process.env.CHEAPER_INFERENCE_API_KEY = ciKey;
delete process.env.MOCK_MODE;
delete process.env.NODE_TEST_CONTEXT;
process.env.MEMORY_FEATURE_ENABLED = "1";
process.env.SESSION_SECRET ??= "b35-local-session-secret-0123456789abcdef";

const dataDir = mkdtempSync(path.join(tmpdir(), "b35-main-rp-"));
process.env.DATA_DIR = dataDir;
mkdirSync(OUT_DIR, { recursive: true });

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
const { resolveMainRpPrimaryWireModelId } = await import("@/lib/openRouterConfig");
const { getEpisodicMemoryForPrompt } = await import("@/lib/episodicMemoryFacts");
const { REN_WOLFGANG_USER_TEXT, REN_WOLFGANG_ASSISTANT_TEXT } = await import(
  "@/lib/test/renWolfgangSafeFixture"
);

const USER_ID = 7001;
const CHARACTER_ID = 7002;
const MAIN_WIRE_MODEL = resolveMainRpPrimaryWireModelId(GEMINI_38_FLASH_MODEL);

function db() {
  return getDb();
}

function resetDbSingleton() {
  const g = globalThis as unknown as { __db?: { close: () => void } };
  if (g.__db) {
    try {
      g.__db.close();
    } catch {
      /* ignore */
    }
    g.__db = undefined;
  }
}

const FILLER_USER_MESSAGES = [
  "*렌은 식어 가는 찻잔을 내려놓고 천막 밖의 장작 소리에 귀를 기울였다.* 오늘 밤 야영지 보급은 어떻게 돌아가고 있어요?",
  "*렌은 외투를 여미며 천막 구석의 화로 쪽으로 자리를 옮겼다.* 이 근처 길은 밤에도 말이 다닐 만한가요?",
  "*렌은 책상 위의 지도에 시선을 던졌다.* 서쪽 능선 너머에는 무엇이 있습니까?",
  "*렌은 잠시 눈을 감았다 떴다.* 이 야영지에서 가장 오래 지낸 병사는 누구예요?",
  "*렌은 물을 한 모금 마시고 천막 틈새로 별을 올려다보았다.* 이곳의 겨울은 많이 혹독합니까?",
  "*렌은 가죽 끈 매듭을 만지작거렸다.* 새벽 초소 교대는 몇 시에 합니까?",
];

const RECALL_QUESTION =
  "*렌은 펜을 내려놓고 볼프강을 똑바로 바라보았다.* 아까 내 진술을 감찰관에게 전달하는 문제 말입니다. 내가 그때 뭐라고 했고, 당신은 병사에게 뭐라고 지시했었는지 정확히 말해 주세요. 기억나지 않으면 모른다고 해도 됩니다.";

type WireRecord = {
  label: string;
  model: string;
  bytes: number;
  usage: unknown;
  bodyPath: string | null;
};
const wires: WireRecord[] = [];
let phase = "setup";
let stubT1MainRp = false;
let wireSerial = 0;

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

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/embedding/i.test(url)) throw new Error(`embedding call blocked: ${url.slice(0, 60)}`);
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  const bodyText = typeof init?.body === "string" ? init.body : "";
  let model = "";
  try {
    model = String((JSON.parse(bodyText) as { model?: unknown }).model ?? "");
  } catch {
    model = "";
  }
  const isMain = model === MAIN_WIRE_MODEL;
  wireSerial += 1;
  const bodyPath = isMain
    ? path.join(OUT_DIR, "wires", `${String(wireSerial).padStart(2, "0")}-${phase}.json`)
    : null;
  if (bodyPath) {
    mkdirSync(path.dirname(bodyPath), { recursive: true });
    writeFileSync(bodyPath, bodyText);
  }
  wires.push({ label: phase, model, bytes: bodyText.length, usage: null, bodyPath });
  if (isMain && stubT1MainRp) {
    stubT1MainRp = false;
    return sseText(REN_WOLFGANG_ASSISTANT_TEXT);
  }
  if (spentUsd() > COST_CAP_USD) throw new Error(`cost cap exceeded: $${spentUsd().toFixed(4)}`);
  return realFetch(input, init);
}) as typeof fetch;

function spentUsd(): number {
  try {
    const row = db()
      .prepare("SELECT COALESCE(SUM(actual_cost_usd),0) AS usd FROM api_cost_ledger")
      .get() as { usd: number };
    return row.usd;
  } catch {
    return 0;
  }
}

async function postTurn(chatId: number, message: string, label: string) {
  phase = label;
  const before = Date.now();
  const response = await POST(
    new Request("http://127.0.0.1/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: CHARACTER_ID,
        chatId,
        message,
        clientRequestId: `b35-${label}-${Date.now()}`,
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
      /* ignore non-JSON */
    }
  }
  const error = events.find((event) => event.type === "error");
  const text = events
    .map((event) => (event.type === "chunk" || event.type === "text" ? String(event.text ?? event.content ?? "") : ""))
    .join("");
  return { status: response.status, events, error, text, ms: Date.now() - before };
}

async function settle(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEpisodicRows(chatId: number, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = db()
      .prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?")
      .get(chatId) as { n: number };
    if (row.n > 0) return row.n;
    await settle(2000);
  }
  return 0;
}

function lastAssistant(chatId: number) {
  return db()
    .prepare(
      `SELECT id, content, generation_status FROM messages
       WHERE chat_id=? AND role='assistant' AND IFNULL(model,'')!='greeting' ORDER BY id DESC LIMIT 1`
    )
    .get(chatId) as { id: number; content: string; generation_status: string | null } | undefined;
}

function dbSnapshot(chatId: number) {
  const d = db();
  return {
    episodicFacts: d
      .prepare(
        `SELECT id, source_turn, category, subject, attribute, value, importance, fact_text, metadata
         FROM episodic_memory_facts WHERE chat_id=? ORDER BY id`
      )
      .all(chatId),
    turnSummaries: d
      .prepare(`SELECT turn_number, summary FROM chat_turn_summaries WHERE chat_id=? ORDER BY turn_number`)
      .all(chatId),
    chatMemory: d
      .prepare(
        `SELECT recent_summary, archive_summary, summarized_turn_count, global_projection_kind FROM chat_memories WHERE chat_id=?`
      )
      .get(chatId),
    relationshipMeta: d.prepare(`SELECT memory_meta FROM chats WHERE id=?`).get(chatId),
    ledger: d
      .prepare(
        `SELECT request_kind, model, actual_cost_usd, input_tokens, output_tokens, event_status
         FROM api_cost_ledger ORDER BY id`
      )
      .all(),
  };
}

function extractSystemAndHistory(bodyPath: string) {
  const body = JSON.parse(readFileSync(bodyPath, "utf8")) as {
    messages?: Array<{ role: string; content: unknown }>;
  };
  const messages = body.messages ?? [];
  const flatten = (content: unknown) =>
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "")).join("")
        : "";
  return messages.map((message) => ({ role: message.role, text: flatten(message.content) }));
}

const { POST } = await import("@/app/api/chat/route");

const d = db();
d.prepare("INSERT INTO users (id, email, nickname, pw_hash, is_adult) VALUES (?,?,?,?,1)").run(
  USER_ID,
  "b35-recall@example.com",
  "관리자",
  "x"
);
d.prepare(
  `INSERT INTO characters (id, name, greeting, nsfw, visibility, moderation_status, official, description, system_prompt)
   VALUES (?,?,?,?,?,?,?,?,?)`
).run(
  CHARACTER_ID,
  "볼프강",
  "볼프강은 책상 위의 기록철에서 시선을 들어 올렸다.",
  0,
  "public",
  "approved",
  0,
  "볼프강: 국경 야영지를 지휘하는 중년의 대장. 과묵하고 규정에 충실하다.",
  "한국어로 장면을 이어 쓴다. 볼프강은 과묵하고 규정에 충실하며 병사들에게 짧고 단호하게 지시한다."
);
const persona = d
  .prepare("INSERT INTO user_personas (user_id, name, description) VALUES (?,?,?)")
  .run(USER_ID, "렌", "국경 야영지에서 진술을 마친 증인. 신중하고 자신의 판단으로 움직인다.");
creditPoints(USER_ID, 50000, "FREE", "b35 fixture free");
creditPoints(USER_ID, 50000, "PAID", "b35 fixture paid");
setUserSelectedAI(d, USER_ID, GEMINI_38_FLASH_MODEL);
sessionToken = createSession(USER_ID);
const chatId = createChatSession({
  userId: USER_ID,
  characterId: CHARACTER_ID,
  greeting: "볼프강은 책상 위의 기록철에서 시선을 들어 올렸다.",
  selectedPersonaId: Number(persona.lastInsertRowid),
  __testOnGreetingSchedule: () => {},
});

const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  mainRpModel: GEMINI_38_FLASH_MODEL,
  mainRpWireModel: MAIN_WIRE_MODEL,
  chatId,
  turns: [] as unknown[],
};

stubT1MainRp = true;
const t1 = await postTurn(chatId, REN_WOLFGANG_USER_TEXT, "T01-fixture-main-rp");
(report.turns as unknown[]).push({ turn: 1, kind: "fixture_main_rp_stub_live_luna", status: t1.status, error: t1.error ?? null });
const t1Rows = await waitForEpisodicRows(chatId, 90_000);
report.afterT1 = { episodicRowsStored: t1Rows, snapshot: dbSnapshot(chatId) };
await settle(5000);

for (let i = 0; i < FILLER_TURNS; i += 1) {
  const message = FILLER_USER_MESSAGES[i % FILLER_USER_MESSAGES.length]!;
  const label = `T${String(i + 2).padStart(2, "0")}-filler`;
  const result = await postTurn(chatId, message, label);
  const assistant = lastAssistant(chatId);
  (report.turns as unknown[]).push({
    turn: i + 2,
    kind: "real_main_rp",
    status: result.status,
    error: result.error ?? null,
    ms: result.ms,
    userMessage: message,
    assistantMessageId: assistant?.id ?? null,
    assistantText: assistant?.content ?? null,
    spentUsd: spentUsd(),
  });
  if (result.error) throw new Error(`turn ${i + 2} failed: ${JSON.stringify(result.error)}`);
  await settle(8000);
}
await settle(20_000);

const recallTurn = FILLER_TURNS + 2;
report.beforeRecall = { snapshot: dbSnapshot(chatId), spentUsd: spentUsd() };
const probe = getEpisodicMemoryForPrompt(db(), {
  chatId,
  characterId: CHARACTER_ID,
  userId: USER_ID,
  currentTurn: recallTurn,
  currentUserMessage: RECALL_QUESTION,
});
report.episodicRetrievalProbe = {
  note: "same canonical getEpisodicMemoryForPrompt; recent/long-term dedupe text omitted (route supplies it), so duplicate_* reasons may differ from the live request",
  debug: probe.debug,
  injectedFacts: probe.facts.map((fact) => ({ id: fact.id, fact_text: fact.fact_text })),
  promptBlock: probe.promptBlock,
};

db().pragma("wal_checkpoint(TRUNCATE)");
const snapshotPath = path.join(dataDir, "pre-recall.db");
copyFileSync(path.join(dataDir, "app.db"), snapshotPath);

const recallOn = await postTurn(chatId, RECALL_QUESTION, "RECALL-memory-ON");
const onAssistant = lastAssistant(chatId);
await settle(8000);
report.recallOn = {
  status: recallOn.status,
  error: recallOn.error ?? null,
  assistantText: onAssistant?.content ?? null,
  spentUsd: spentUsd(),
};

const onWire = wires.filter((wire) => wire.label === "RECALL-memory-ON" && wire.bodyPath);
const mainOn = onWire.at(-1);
if (mainOn?.bodyPath) {
  const parts = extractSystemAndHistory(mainOn.bodyPath);
  writeFileSync(path.join(OUT_DIR, "final-wire-recall-ON.json"), JSON.stringify(parts, null, 2));
}

if (process.env.B35_SKIP_OFF !== "1") {
  const costBeforeOff = spentUsd();
  db().pragma("wal_checkpoint(TRUNCATE)");
  resetDbSingleton();
  copyFileSync(snapshotPath, path.join(dataDir, "app.db"));
  for (const suffix of ["-wal", "-shm"]) {
    try {
      copyFileSync(path.join(dataDir, `app.db${suffix}`), path.join(dataDir, `app.db${suffix}.bak`));
    } catch {
      /* no sidecar */
    }
  }
  process.env.MEMORY_FEATURE_ENABLED = "0";
  const recallOff = await postTurn(chatId, RECALL_QUESTION, "RECALL-memory-OFF");
  const offAssistant = lastAssistant(chatId);
  report.recallOff = {
    status: recallOff.status,
    error: recallOff.error ?? null,
    assistantText: offAssistant?.content ?? null,
    spentUsdIncrement: spentUsd() - costBeforeOff,
  };
  process.env.MEMORY_FEATURE_ENABLED = "1";
  const offWire = wires.filter((wire) => wire.label === "RECALL-memory-OFF" && wire.bodyPath).at(-1);
  if (offWire?.bodyPath) {
    writeFileSync(
      path.join(OUT_DIR, "final-wire-recall-OFF.json"),
      JSON.stringify(extractSystemAndHistory(offWire.bodyPath), null, 2)
    );
  }
}

report.finishedAt = new Date().toISOString();
report.totalLedgerUsd = spentUsd();
report.providerCompletionCalls = wires.map(({ label, model, bytes }) => ({ label, model, bytes }));
writeFileSync(path.join(OUT_DIR, "main-rp-recall-report.json"), JSON.stringify(report, null, 2));
appendFileSync(path.join(OUT_DIR, "run.log"), `done total_usd=${spentUsd()}\n`);
console.log(JSON.stringify({ ok: true, totalLedgerUsd: spentUsd(), out: OUT_DIR }));
process.exit(0);
