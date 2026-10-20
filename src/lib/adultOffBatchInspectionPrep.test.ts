import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { getDatabasePath } from "@/lib/dataDir";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
  assertIsolatedTestDatabaseActive,
} from "@/lib/test/isolatedTestDatabase";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  adultOffApprovedTextHash,
  adultOffStoredTextDisposition,
  listAdultOffInspectionTargets,
  presentAdultOffStoredRead,
} from "@/lib/adultOffOutputGuard";
import { normalizeMessageVariants } from "@/lib/messageAlternates";
import {
  commitAdultOffInspectionIfFresh,
  copySqliteDatabaseForRehearsal,
  dedupeAdultOffClassificationTexts,
  fingerprintAdultOffInspectionTarget,
  planAdultOffBatchInspection,
  planAdultOffBatchInspectionSummary,
  runAdultOffBatchInspectionRehearsal,
  sqliteIntegrityCheck,
  surveyAdultOffAuxSurfaces,
  type AdultOffInspectionMessageRow,
} from "@/lib/adultOffBatchInspectionPrep";

const RESTRICTED_MARK = "ZZ_SYNTHETIC_BATCH_RESTRICTED";

function build1347FixtureRows(): AdultOffInspectionMessageRow[] {
  const rows: AdultOffInspectionMessageRow[] = [];
  let id = 1;
  for (let i = 0; i < 576; i += 1) {
    rows.push({
      id: id++,
      role: "assistant",
      content: `합성 본문 ${i}`,
      model: "gemini",
      usage: JSON.stringify({ cost: 1 }),
      alternates: null,
      active_variant: null,
    });
  }
  for (let i = 0; i < 699; i += 1) {
    rows.push({
      id: id++,
      role: "assistant",
      content: `활성 ${i}`,
      model: "gemini",
      usage: JSON.stringify({ cost: 2 }),
      alternates: JSON.stringify([
        { content: `활성 ${i}`, model: "gemini", usage: { cost: 2 }, created_at: "" },
      ]),
      active_variant: 0,
    });
  }
  for (let i = 0; i < 36; i += 1) {
    rows.push({
      id: id++,
      role: "assistant",
      content: `현재 ${i}`,
      model: "gemini",
      usage: JSON.stringify({ cost: 3 }),
      alternates: JSON.stringify([
        { content: `이전 ${i}`, model: "gemini", usage: { cost: 3 }, created_at: "" },
        { content: `현재 ${i}`, model: "gemini", usage: { cost: 4 }, created_at: "" },
      ]),
      active_variant: 1,
    });
  }
  for (let i = 0; i < 25; i += 1) {
    rows.push({
      id: id++,
      role: "assistant",
      content: "   ",
      model: "gemini",
      usage: JSON.stringify({ cost: 0 }),
      alternates: null,
      active_variant: null,
    });
  }
  rows.push({
    id: id++,
    role: "user",
    content: "skip",
    model: "",
    usage: null,
    alternates: null,
    active_variant: null,
  });
  return rows;
}

function assertActiveUsageMirrorsRow(db: import("better-sqlite3").Database, messageId: number): void {
  const row = db
    .prepare("SELECT content, usage, alternates, active_variant FROM messages WHERE id=?")
    .get(messageId) as {
    content: string;
    usage: string | null;
    alternates: string | null;
    active_variant: number | null;
  };
  const { variants, activeVariant } = normalizeMessageVariants({
    content: row.content,
    model: "",
    usage: row.usage,
    alternates: row.alternates,
    active_variant: row.active_variant,
  });
  const activeUsage = variants[activeVariant]?.usage;
  const rowUsage = row.usage ? JSON.parse(row.usage) : null;
  assert.deepEqual(activeUsage ?? null, rowUsage);
}

describe("adult-off batch inspection prep", { concurrency: 1 }, () => {
  let db: import("better-sqlite3").Database;

  before(async () => {
    installIsolatedTestDatabase();
    const dbMod = await import("@/lib/db");
    db = dbMod.getDb();
    assertIsolatedTestDatabaseActive();
    assert.equal(sqliteIntegrityCheck(db), "ok");
  });

  after(() => {
    uninstallIsolatedTestDatabase();
  });

  it("maps 1347 assistant logical variants and dedupes classification texts", () => {
    const rows = build1347FixtureRows();
    const targets = listAdultOffInspectionTargets(rows);
    assert.equal(targets.length, 1347);
    const plan = planAdultOffBatchInspection(rows);
    const summary = planAdultOffBatchInspectionSummary(plan);
    assert.equal(summary.targets, 1347);
    assert.equal(summary.needsClassification, 1347);
    const unique = dedupeAdultOffClassificationTexts(plan);
    assert.equal(unique.length, 1347);
    const twin = rows[0]!;
    const duplicatePlan = planAdultOffBatchInspection([
      { ...twin, id: 100001 },
      { ...twin, id: 100002 },
    ]);
    assert.equal(dedupeAdultOffClassificationTexts(duplicatePlan).length, 1);
  });

  it("records inspection on active variant and mirrors messages.usage", () => {
    const text = "그는 창가에 기대어 속삭였다.";
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (1, 'assistant', ?, 'gemini', ?, '[]', 0, 'completed')`
      )
      .run(text, JSON.stringify({ cost: 19, model: "gemini" }));
    const messageId = Number(insert.lastInsertRowid);
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const fingerprint = fingerprintAdultOffInspectionTarget(row, 0, text);
    const result = commitAdultOffInspectionIfFresh(db, {
      fingerprint,
      expectedText: text,
      outcome: "approved",
    });
    assert.equal(result, "written");
    assertActiveUsageMirrorsRow(db, messageId);
    const stored = db.prepare("SELECT content, usage FROM messages WHERE id=?").get(messageId) as {
      content: string;
      usage: string;
    };
    assert.equal(stored.content, text);
    const usage = JSON.parse(stored.usage) as { cost: number; adultOffGuard?: unknown };
    assert.equal(usage.cost, 19);
    assert.equal(
      adultOffStoredTextDisposition(usage, text),
      "approved"
    );
    const again = commitAdultOffInspectionIfFresh(db, {
      fingerprint,
      expectedText: text,
      outcome: "approved",
    });
    assert.equal(again, "skipped_noop");
  });

  it("updates inactive variant usage without touching row.usage mirror", () => {
    const approved = "승인된 활성 본문";
    const sibling = "비활성 variant 본문";
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (1, 'assistant', ?, 'gemini', ?, ?, 0, 'completed')`
      )
      .run(
        approved,
        JSON.stringify({ cost: 5 }),
        JSON.stringify([
          { content: approved, model: "gemini", usage: { cost: 5 }, created_at: "" },
          { content: sibling, model: "gemini", usage: { cost: 6 }, created_at: "" },
        ])
      );
    const messageId = Number(insert.lastInsertRowid);
    const rowBefore = db.prepare("SELECT usage FROM messages WHERE id=?").get(messageId) as {
      usage: string;
    };
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const fingerprint = fingerprintAdultOffInspectionTarget(row, 1, sibling);
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: sibling,
        outcome: "restricted",
      }),
      "written"
    );
    const after = db.prepare("SELECT usage, alternates FROM messages WHERE id=?").get(messageId) as {
      usage: string;
      alternates: string;
    };
    assert.equal(after.usage, rowBefore.usage);
    const { variants } = normalizeMessageVariants({
      content: approved,
      model: "",
      usage: after.usage,
      alternates: after.alternates,
      active_variant: 0,
    });
    assert.equal(adultOffStoredTextDisposition(variants[1]?.usage, sibling), "restricted");
    assertActiveUsageMirrorsRow(db, messageId);
  });

  it("skips stale targets after variant switch or content change", () => {
    const text = "경합 검사 본문";
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (1, 'assistant', ?, 'gemini', ?, '[]', 0, 'completed')`
      )
      .run(text, JSON.stringify({ cost: 2 }));
    const messageId = Number(insert.lastInsertRowid);
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const fingerprint = fingerprintAdultOffInspectionTarget(row, 0, text);
    db.prepare("UPDATE messages SET content=? WHERE id=?").run(`${text} (재생성)`, messageId);
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: text,
        outcome: "approved",
      }),
      "skipped_stale"
    );
  });

  it("does not forge unresolved into approval and preserves guard read paths", () => {
    const text = "미확정 본문";
    const restricted = `제한 ${RESTRICTED_MARK}`;
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (1, 'assistant', ?, 'gemini', ?, '[]', 0, 'completed')`
      )
      .run(text, JSON.stringify({ cost: 11 }));
    const messageId = Number(insert.lastInsertRowid);
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const fingerprint = fingerprintAdultOffInspectionTarget(row, 0, text);
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: text,
        outcome: "unresolved",
      }),
      "skipped_unresolved"
    );
    const restrictedRow = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const restrictedFp = fingerprintAdultOffInspectionTarget(restrictedRow, 0, restricted);
    db.prepare("UPDATE messages SET content=? WHERE id=?").run(restricted, messageId);
    commitAdultOffInspectionIfFresh(db, {
      fingerprint: restrictedFp,
      expectedText: restricted,
      outcome: "restricted",
    });
    const storedRow = db
      .prepare("SELECT content, usage FROM messages WHERE id=?")
      .get(messageId) as { content: string; usage: string };
    const usage = JSON.parse(storedRow.usage);
    const guardOn = presentAdultOffStoredRead({
      applyGuard: true,
      rowContent: storedRow.content,
      variants: [{ content: storedRow.content, usage }],
      activeVariant: 0,
    });
    assert.equal(guardOn.content, "");
    const guardOff = presentAdultOffStoredRead({
      applyGuard: false,
      rowContent: storedRow.content,
      variants: [{ content: storedRow.content, usage }],
      activeVariant: 0,
    });
    assert.equal(guardOff.content, restricted);
  });

  it("blocks v1 hash reuse under policy v2 batch planning", () => {
    const text = "구 정책 승인";
    const legacyUsage = {
      cost: 3,
      adultOffGuard: {
        policyVersion: 1,
        approvedTextHashes: [adultOffApprovedTextHash(text)],
        restrictedTextHashes: [],
      },
    };
    const row: AdultOffInspectionMessageRow = {
      id: 42,
      role: "assistant",
      content: text,
      model: "gemini",
      usage: JSON.stringify(legacyUsage),
      alternates: null,
      active_variant: 0,
    };
    const plan = planAdultOffBatchInspection([row]);
    assert.equal(plan[0]?.kind, "needs_classification");
  });

  it("resumes safely after partial rehearsal writes", () => {
    const chatId = 9001;
    db.prepare("INSERT INTO chats (id, user_id, character_id) VALUES (?,?,?)").run(chatId, 1, 1);
    for (let i = 0; i < 12; i += 1) {
      db.prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (?, 'assistant', ?, 'gemini', ?, '[]', 0, 'completed')`
      ).run(chatId, `리허설 ${i}`, JSON.stringify({ cost: i + 1 }));
    }
    const classify = (body: string) =>
      body.includes(RESTRICTED_MARK) ? ("restricted" as const) : ("approved" as const);
    const first = runAdultOffBatchInspectionRehearsal(db, classify, { chatId: chatId });
    assert.equal(first.written, 12);
    const second = runAdultOffBatchInspectionRehearsal(db, classify, { chatId: chatId });
    assert.equal(second.written, 0);
    assert.equal(second.reuseApproved, 12);
    assert.equal(sqliteIntegrityCheck(db), "ok");
  });

  it("surveys aux surfaces without v2 proof counts", () => {
    const survey = surveyAdultOffAuxSurfaces([
      {
        id: 1,
        role: "assistant",
        content: "본문",
        model: "gemini",
        usage: JSON.stringify({ cost: 1 }),
        alternates: null,
        active_variant: 0,
        status_meta: JSON.stringify({
          meta: { location: "교실", sceneSummary: "점심시간" },
          extractedAt: "",
          source: "background-deepseek",
        }),
        suggested_replies_json: JSON.stringify({
          replies: [{ kind: "natural", text: "안녕?" }],
          extractedAt: "",
          source: "post-turn-shared",
        }),
        status_widget_values_json: null,
      },
    ]);
    assert.equal(survey.displayStatusMetaMessages, 1);
    assert.equal(survey.suggestedReplyMessages, 1);
    assert.equal(survey.auxItemsMissingV2Proof, 2);
    assert.equal(survey.auxItemsWithUnapprovedVisibleText, 2);
  });

  it("copies sqlite consistently for isolated rehearsal", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adult-off-copy-"));
    const sourcePath = path.join(dir, "source.db");
    const destPath = path.join(dir, "dest.db");
    fs.copyFileSync(getDatabasePath(), sourcePath);
    copySqliteDatabaseForRehearsal(sourcePath, destPath);
    const copied = new Database(destPath);
    try {
      assert.equal(sqliteIntegrityCheck(copied), "ok");
      const count = (
        copied.prepare("SELECT COUNT(*) AS c FROM messages").get() as { c: number }
      ).c;
      assert.ok(count >= 0);
    } finally {
      copied.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
