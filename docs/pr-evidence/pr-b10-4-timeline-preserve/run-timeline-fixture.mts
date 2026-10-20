/**
 * B10-4: OLD vs NEW [21~25] summary → Global → stubbed T50 wire (no paid provider).
 * Usage: node --conditions=react-server --import tsx docs/pr-evidence/pr-b10-4-timeline-preserve/run-timeline-fixture.mts
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import Module from "node:module";
import Database from "better-sqlite3";

const SNAP_DIR = process.env.B10_SNAP50_DIR ?? "/tmp/b9-preserved/db/snap-50";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "local-b9-memory-recheck-secret-0123456789abcdef";
process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS?.trim() || "you7410@gmail.com";
const OUT_JSON =
  process.argv[2] ??
  path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "fixture-results.json"
  );

const OLD_TAIL =
  "렌이 자신의 탓이라며 주저앉자 태형은 아무것도 묻지 않고 곁을 지키며 귤을 건네고, “네 탓 아니야”라고 위로함.";
const NEW_TAIL =
  "렌이 자신의 탓이라며 비상계단에 먼저 주저앉자, 태형이 말없이 내려와 옆에 앉았다. 태형은 아무것도 묻지 않고 귤을 건네며 “네 탓 아니야”라고 위로했다.";

export type Semantics = {
  renFirstOrSelfBlame: boolean;
  taehyungArrivalOrSitBeside: boolean;
  orderedRenThenTaehyung: boolean;
  deathOrJihwan: boolean;
  tangerineComfort: boolean;
  noInventedLastWords: boolean;
  noFabricatedNonWitness: boolean;
};

export function evaluateSemantics(text: string): Semantics {
  const renFirstOrSelfBlame = /렌.*(먼저|탓|주저앉)/.test(text);
  const taehyungArrivalOrSitBeside = /태형.*(내려와|옆에 앉|곁을)/.test(text);
  const orderedRenThenTaehyung =
    /(먼저.*렌|렌.*먼저).*(내려와|태형)/s.test(text) ||
    (/렌.*주저앉/.test(text) && /내려와/.test(text));
  return {
    renFirstOrSelfBlame,
    taehyungArrivalOrSitBeside,
    orderedRenThenTaehyung,
    deathOrJihwan: /(사망|오지환|지환)/.test(text),
    tangerineComfort: /(귤|네 탓 아니)/.test(text),
    noInventedLastWords: !/가이드님.*감사|죄송해요.*도망/.test(text),
    noFabricatedNonWitness: !/목격하지 못|직접 목격하지/.test(text),
  };
}

function readGlobalLen(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare("SELECT recent_summary FROM chat_memories WHERE chat_id=1")
      .get() as { recent_summary: string } | undefined;
    return row?.recent_summary?.length ?? 0;
  } finally {
    db.close();
  }
}

function readTurn21Summary(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db
      .prepare("SELECT summary FROM chat_turn_summaries WHERE chat_id=1 AND turn_number=21")
      .get() as { summary: string } | undefined;
    if (!row?.summary) throw new Error("missing turn 21 summary");
    return row.summary;
  } finally {
    db.close();
  }
}

function copySnapWritable(destDir: string) {
  cpSync(SNAP_DIR, destDir, { recursive: true });
  for (const name of ["app.db", "app.db-shm", "app.db-wal"]) {
    const p = path.join(destDir, name);
    if (existsSync(p)) chmodSync(p, 0o644);
  }
}

function resetDbSingleton() {
  if (global.__db) {
    try {
      global.__db.close();
    } catch {
      /* ignore */
    }
    global.__db = undefined;
  }
}

async function captureWire(dataDir: string): Promise<{
  sha256: string;
  bytes: number;
  globalBlock: string | null;
  semanticsGlobal: Semantics;
  phrasePresent: Record<string, boolean>;
}> {
  resetDbSingleton();
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

  process.env.DATA_DIR = dataDir;
  process.env.NODE_ENV = "production";
  process.env.PLAYWRIGHT_PROD_SERVER = "1";
  process.env.EPISODIC_MEMORY_RECALL_ENABLED = "1";
  process.env.MEMORY_5PLUS4_ENABLED = "true";
  process.env.CANON_INJECTION_ENABLED = "1";
  process.env.CANON_INJECTION_ROLLOUT_STAGE = "D2";
  process.env.EPISODIC_SEMANTIC_MODEL = "bge_m3";
  process.env.BACKGROUND_MEMORY_MODEL = "gpt-6-luna";
  delete process.env.EPISODIC_SEMANTIC_DISCOVERY_ENABLED;
  delete process.env.MOCK_MODE;
  delete process.env.PROMPT_DEBUG;

  const { resolveMainRpPrimaryWireModelId } = await import("@/lib/openRouterConfig");
  const { getDb } = await import("@/lib/db");
  const { createSession } = await import("@/lib/auth");
  const db = getDb();
  db.prepare("UPDATE users SET selected_ai=? WHERE id=1").run("gemini-3.8-flash");
  db.prepare("UPDATE chats SET gemini_model=? WHERE id=1").run("gemini-3.8-flash");
  sessionToken = createSession(1);
  const expectedWire = resolveMainRpPrimaryWireModelId("gemini-3.8-flash");

  let mainBody = "";
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (/embedding|embeddings/i.test(url)) {
      throw new Error(`blocked embedding: ${url.slice(0, 80)}`);
    }
    if (/openrouter\.ai/i.test(url) && !url.includes("/chat/completions")) {
      throw new Error(`blocked openrouter non-main: ${url.slice(0, 100)}`);
    }
    if (!url.includes("/chat/completions")) {
      return originalFetch(input, init);
    }
    let bodyText = "";
    let wireModel = "";
    if (typeof init?.body === "string") {
      bodyText = init.body;
    } else if (init?.body instanceof Uint8Array) {
      bodyText = Buffer.from(init.body).toString("utf8");
    }
    if (bodyText) {
      try {
        wireModel = String((JSON.parse(bodyText) as { model?: unknown }).model ?? "");
      } catch {
        wireModel = "";
      }
    }
    const isMain = wireModel === expectedWire;
    if (isMain) {
      mainBody = bodyText;
      const chunk = JSON.stringify({
        choices: [{ delta: { content: "stub" }, finish_reason: null }],
      });
      const done = JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, cost: 0 },
      });
      return new Response(`data: ${chunk}\n\ndata: ${done}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(
      `data: ${JSON.stringify({
        choices: [{ delta: { content: "" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
      })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  };

  const { POST } = await import("@/app/api/chat/route");
  await POST(
    new Request("http://127.0.0.1/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterId: 18,
        chatId: 1,
        message: "지환이가 마지막에 나한테 뭐라고 했었지… 너 기억나?",
      }),
    })
  ).then((r) => r.text());

  if (!mainBody) {
    throw new Error(`wire body not captured (expectedWire=${expectedWire})`);
  }
  const sha256 = createHash("sha256").update(mainBody).digest("hex");
  const joined = mainBody;
  const idx = joined.indexOf("[21~25턴]");
  const globalBlock =
    idx >= 0
      ? joined
          .slice(idx, idx + 900)
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"')
      : null;
  const phrases = [
    "내려와",
    "먼저",
    "곁을 지키",
    "주저앉",
    "네 탓 아니",
    "돌아오지 못했다",
  ];
  const phrasePresent = Object.fromEntries(phrases.map((p) => [p, joined.includes(p)]));
  return {
    sha256,
    bytes: mainBody.length,
    globalBlock,
    semanticsGlobal: evaluateSemantics(globalBlock ?? joined),
    phrasePresent,
  };
}

async function patchNewSummary(dataDir: string) {
  resetDbSingleton();
  process.env.DATA_DIR = dataDir;
  const { getDb } = await import("@/lib/db");
  const { rebuildLorebookFromRecords } = await import("@/lib/memory/memory-turn-summary");
  const db = getDb();
  const row = db
    .prepare("SELECT summary FROM chat_turn_summaries WHERE chat_id=1 AND turn_number=21")
    .get() as { summary: string };
  if (!row.summary.includes(OLD_TAIL.slice(0, 40))) {
    throw new Error("unexpected turn-21 summary shape");
  }
  const patched = row.summary.replace(OLD_TAIL, NEW_TAIL);
  db.prepare(
    "UPDATE chat_turn_summaries SET summary=?, updated_at=datetime('now') WHERE chat_id=1 AND turn_number=21"
  ).run(patched);
  const recent = rebuildLorebookFromRecords(1);
  db.prepare(
    "UPDATE chat_memories SET recent_summary=?, updated_at=datetime('now') WHERE chat_id=1"
  ).run(recent);
  return {
    turn21Len: patched.length,
    globalLen: recent.length,
    global21Excerpt: recent.includes("[21~25턴]")
      ? recent.slice(recent.indexOf("[21~25턴]"), recent.indexOf("[21~25턴]") + 420)
      : null,
    semanticsSummary: evaluateSemantics(patched),
    semanticsGlobal: evaluateSemantics(recent),
  };
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function spawnWireCapture(dataDir: string, patchNew: boolean) {
  const args = [
    "--conditions=react-server",
    "--import",
    "tsx",
    SCRIPT_PATH,
    "--wire-only",
    dataDir,
  ];
  if (patchNew) args.push("--patch-new");
  const run = spawnSync(process.execPath, args, {
    encoding: "utf8",
    cwd: path.resolve(SCRIPT_PATH, "..", "..", "..", ".."),
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(
      `wire subprocess failed (patchNew=${patchNew}): ${run.stderr?.slice(-4000) ?? run.stdout}`
    );
  }
  const line = run.stdout.trim().split("\n").pop() ?? "";
  return JSON.parse(line) as {
    wire: Awaited<ReturnType<typeof captureWire>>;
    patchMeta?: Awaited<ReturnType<typeof patchNewSummary>>;
  };
}

async function main() {
  if (process.argv.includes("--wire-only")) {
    const dataDir = process.argv[process.argv.indexOf("--wire-only") + 1];
    if (!dataDir) throw new Error("--wire-only requires dataDir");
    const patchNew = process.argv.includes("--patch-new");
    const patchMeta = patchNew ? await patchNewSummary(dataDir) : undefined;
    const wire = await captureWire(dataDir);
    console.log(JSON.stringify({ wire, patchMeta }));
    return;
  }

  if (!existsSync(path.join(SNAP_DIR, "app.db"))) {
    throw new Error(`missing snap: ${SNAP_DIR}`);
  }
  const root = mkdtempSync(path.join(tmpdir(), "b10-4-"));
  const oldDir = path.join(root, "old");
  const newDir = path.join(root, "new");
  copySnapWritable(oldDir);
  copySnapWritable(newDir);

  const sourceTurn21 = readTurn21Summary(path.join(SNAP_DIR, "app.db"));

  const oldDbPath = path.join(oldDir, "app.db");
  const oldTurn21 = readTurn21Summary(oldDbPath);
  const oldGlobalLen = readGlobalLen(oldDbPath);
  const oldPayload = spawnWireCapture(oldDir, false);
  const oldWire = oldPayload.wire;

  const newPayload = spawnWireCapture(newDir, true);
  const newWire = newPayload.wire;
  const newMeta = newPayload.patchMeta;
  if (!newMeta) throw new Error("missing patchMeta from new wire subprocess");

  const report = {
    mainSha: "ad0c5e9b1f4c8c63a6527a03b59670b456d545eb",
    snapSource: SNAP_DIR,
    sourceTurn21Len: sourceTurn21.length,
    old: {
      turn21Len: oldTurn21.length,
      turn21Semantics: evaluateSemantics(oldTurn21),
      wire: oldWire,
    },
    new: {
      meta: newMeta,
      wire: newWire,
    },
    lengthDelta: {
      turn21Chars: newMeta.turn21Len - oldTurn21.length,
      globalChars: newMeta.globalLen - oldGlobalLen,
      wireBytes: newWire.bytes - oldWire.bytes,
    },
    b10_2_a_wire_sha256: "49475a3df82469187890340b873319cd008cf5eac7bec4a11eab119091fd0458",
    oldMatchesB10_2A: oldWire.sha256 === "49475a3df82469187890340b873319cd008cf5eac7bec4a11eab119091fd0458",
  };

  mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* subprocess may still hold WAL handles briefly */
  }
  console.log(
    JSON.stringify({
      ok: true,
      out: OUT_JSON,
      oldSha: oldWire.sha256.slice(0, 16),
      newSha: newWire.sha256.slice(0, 16),
      oldMatchesB10_2A: report.oldMatchesB10_2A,
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
