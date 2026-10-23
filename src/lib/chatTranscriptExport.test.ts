import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  adultOffApprovedTextHash,
} from "./adultOffOutputGuard";
import {
  TRANSCRIPT_EMPTY_ASSISTANT_PLACEHOLDER,
  buildAttachmentDisposition,
  buildTranscriptFilename,
  formatTranscriptHeader,
  generateTranscriptChunks,
  type TranscriptHeader,
} from "./chatTranscriptExport";

const HEADER: TranscriptHeader = {
  characterName: "라이크",
  chatTitle: "비 오는 밤",
  personaName: "렌",
};

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      usage TEXT,
      alternates TEXT,
      active_variant INTEGER,
      generation_status TEXT
    );
  `);
  return db;
}

type Row = {
  chatId: number;
  role: "user" | "assistant";
  content: string;
  model?: string;
  usage?: unknown;
  alternates?: unknown;
  activeVariant?: number | null;
  status?: string | null;
};

function insert(db: Database.Database, row: Row) {
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(
    row.chatId,
    row.role,
    row.content,
    row.model ?? (row.role === "assistant" ? "gemini" : ""),
    row.usage ? JSON.stringify(row.usage) : null,
    row.alternates ? JSON.stringify(row.alternates) : null,
    row.activeVariant ?? null,
    row.status ?? "completed"
  );
}

function exportAll(
  db: Database.Database,
  chatId: number,
  opts: { guard?: boolean; batchRows?: number } = {}
): string {
  return [
    ...generateTranscriptChunks({
      db,
      chatId,
      header: HEADER,
      applyAdultOffReadGuard: opts.guard ?? false,
      batchRows: opts.batchRows,
    }),
  ].join("");
}

describe("chat transcript export", () => {
  it("writes the header only for an empty chat", () => {
    const db = makeDb();
    assert.equal(
      exportAll(db, 1),
      "캐릭터: 라이크\n채팅방 이름: 비 오는 밤\n페르소나 이름: 렌\n\n"
    );
  });

  it("exports one turn in the documented layout", () => {
    const db = makeDb();
    insert(db, { chatId: 1, role: "user", content: "안녕." });
    insert(db, { chatId: 1, role: "assistant", content: "*고개를 끄덕였다.* \"왔어?\"" });
    assert.equal(
      exportAll(db, 1),
      `${formatTranscriptHeader(HEADER)}[턴 1]\n안녕.\n---\n*고개를 끄덕였다.* "왔어?"\n\n`
    );
  });

  it("keeps order, Unicode, markdown and HTML text for 100 and 1000 turns across batches", () => {
    for (const turns of [100, 1000]) {
      const db = makeDb();
      for (let i = 1; i <= turns; i++) {
        insert(db, { chatId: 1, role: "user", content: `유저 ${i} 😀 <b>굵게</b> **md**` });
        insert(db, {
          chatId: 1,
          role: "assistant",
          content: `응답 ${i}\n\n<div class="status">HP ${i}</div> "대사" ⋯`,
        });
      }
      insert(db, { chatId: 2, role: "user", content: "다른 방 유저" });
      insert(db, { chatId: 2, role: "assistant", content: "다른 방 응답" });
      const out = exportAll(db, 1, { batchRows: 37 });
      assert.equal(out, exportAll(db, 1));
      assert.ok(!out.includes("다른 방"));
      const heads = [...out.matchAll(/^\[턴 (\d+)\]$/gm)].map((m) => Number(m[1]));
      assert.equal(heads.length, turns);
      assert.deepEqual(heads, Array.from({ length: turns }, (_, i) => i + 1));
      assert.ok(out.includes(`유저 ${turns} 😀 <b>굵게</b> **md**\n---\n응답 ${turns}`));
      assert.ok(out.includes('<div class="status">HP 1</div> "대사" ⋯'));
      assert.ok(out.indexOf("유저 1 ") < out.indexOf("응답 1\n"));
      assert.ok(out.indexOf("응답 1\n") < out.indexOf("유저 2 "));
    }
  });

  it("exports only the active variant, never other regeneration candidates", () => {
    const db = makeDb();
    insert(db, { chatId: 1, role: "user", content: "질문" });
    insert(db, {
      chatId: 1,
      role: "assistant",
      content: "두 번째 후보",
      alternates: [
        { content: "첫 번째 후보", model: "m", usage: null, created_at: "" },
        { content: "두 번째 후보", model: "m", usage: null, created_at: "" },
        { content: "세 번째 후보", model: "m", usage: null, created_at: "" },
      ],
      activeVariant: 1,
    });
    const out = exportAll(db, 1);
    assert.ok(out.includes("질문\n---\n두 번째 후보\n"));
    assert.ok(!out.includes("첫 번째 후보"));
    assert.ok(!out.includes("세 번째 후보"));
  });

  it("handles greeting, orphan user rows and failed empty responses", () => {
    const db = makeDb();
    insert(db, { chatId: 1, role: "assistant", content: "어서 와.", model: "greeting" });
    insert(db, { chatId: 1, role: "user", content: "고아 유저(응답 실패 잔여)" });
    insert(db, { chatId: 1, role: "user", content: "첫 질문" });
    insert(db, { chatId: 1, role: "assistant", content: "", status: "failed" });
    insert(db, { chatId: 1, role: "user", content: "둘째 질문" });
    insert(db, { chatId: 1, role: "assistant", content: "부분 응답", status: "failed_partial" });
    insert(db, { chatId: 1, role: "user", content: "마지막(응답 대기)" });
    const out = exportAll(db, 1);
    assert.ok(out.includes("[인사말]\n어서 와.\n"));
    assert.ok(!out.includes("고아 유저"));
    assert.ok(!out.includes("마지막(응답 대기)"));
    assert.ok(out.includes(`[턴 1]\n첫 질문\n---\n${TRANSCRIPT_EMPTY_ASSISTANT_PLACEHOLDER}\n`));
    assert.ok(out.includes("[턴 2]\n둘째 질문\n---\n부분 응답\n"));
  });

  it("applies the adult-off read guard exactly like the chat screen", () => {
    const approved = "그는 가볍게 입을 맞추고 그녀를 안았다.";
    const unreviewed = "검수되지 않은 본문 SECRET";
    const db = makeDb();
    insert(db, { chatId: 1, role: "user", content: "q1" });
    insert(db, {
      chatId: 1,
      role: "assistant",
      content: approved,
      alternates: [{ content: approved, model: "m", created_at: "", usage: {
        cost: 1,
        adultOffGuard: {
          policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
          approvedTextHashes: [adultOffApprovedTextHash(approved)],
          restrictedTextHashes: [],
        },
      } }],
      activeVariant: 0,
    });
    insert(db, { chatId: 1, role: "user", content: "q2" });
    insert(db, { chatId: 1, role: "assistant", content: unreviewed });
    const guarded = exportAll(db, 1, { guard: true });
    assert.ok(guarded.includes(approved));
    assert.ok(!guarded.includes("SECRET"));
    assert.ok(guarded.includes(`[턴 2]\nq2\n---\n${TRANSCRIPT_EMPTY_ASSISTANT_PLACEHOLDER}`));
    assert.ok(exportAll(db, 1, { guard: false }).includes("SECRET"));
  });

  it("falls back safely when variant JSON is corrupt", () => {
    const db = makeDb();
    insert(db, { chatId: 1, role: "user", content: "q" });
    db.prepare(
      "INSERT INTO messages (chat_id, role, content, model, alternates) VALUES (1,'assistant','본문','m','{broken')"
    ).run();
    assert.ok(exportAll(db, 1).includes("q\n---\n본문\n"));
    assert.ok(!exportAll(db, 1, { guard: true }).includes("본문"));
  });

  it("never writes to the database while exporting", () => {
    const db = makeDb();
    insert(db, { chatId: 1, role: "user", content: "고아" });
    insert(db, { chatId: 1, role: "user", content: "q" });
    insert(db, { chatId: 1, role: "assistant", content: "a" });
    db.exec(`
      CREATE TRIGGER no_insert BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'write'); END;
      CREATE TRIGGER no_update BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT, 'write'); END;
      CREATE TRIGGER no_delete BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT, 'write'); END;
    `);
    const before = db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    assert.doesNotThrow(() => exportAll(db, 1));
    const after = db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    assert.equal(after.n, before.n);
  });

  it("builds a safe UTF-8 filename and attachment header", () => {
    const name = buildTranscriptFilename(
      { characterName: "라이크", chatTitle: "비 오는/밤:*?", personaName: "렌" },
      new Date("2026-10-23T16:00:00Z")
    );
    assert.equal(name, "라이크_비_오는밤_2026-10-24.txt");
    assert.equal(
      buildTranscriptFilename({ characterName: "", chatTitle: "", personaName: "" }, new Date("2026-10-24T00:00:00Z")),
      "캐릭터_제목_없음_2026-10-24.txt"
    );
    const disposition = buildAttachmentDisposition(name);
    assert.match(disposition, /^attachment; filename="chat-transcript\.txt"; filename\*=UTF-8''/);
    assert.equal(
      decodeURIComponent(disposition.split("filename*=UTF-8''")[1]!),
      name
    );
  });
});

describe("/api/chat/export route contract", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/app/api/chat/export/route.ts"),
    "utf8"
  );
  const lib = fs.readFileSync(path.join(process.cwd(), "src/lib/chatTranscriptExport.ts"), "utf8");

  it("requires login and owner-scoped chat lookup", () => {
    assert.match(source, /getSessionUser\(\)/);
    assert.match(source, /status: 401/);
    assert.match(source, /WHERE c\.id=\? AND c\.user_id=\?/);
    assert.match(source, /status: 404/);
    assert.match(source, /adultOffReadGuardAppliesForChat/);
  });

  it("is read-only and does not persist the file", () => {
    for (const text of [source, lib]) {
      assert.doesNotMatch(text, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i);
      assert.doesNotMatch(text, /purgeOrphanUserMessages|recoverStale|writeFile|createWriteStream/);
    }
    assert.match(source, /no-store/);
    assert.match(source, /ReadableStream/);
  });
});
