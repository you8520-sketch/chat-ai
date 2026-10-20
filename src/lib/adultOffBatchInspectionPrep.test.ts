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
  activeVariantMirrorsCanonicalRow,
  assessActiveVariantCanonicalMirror,
  assistantRowHasCanonicalContentWithoutInspectableVariant,
  commitAdultOffInspectionIfFresh,
  copySqliteDatabaseForRehearsal,
  dedupeAdultOffClassificationTexts,
  fingerprintAdultOffInspectionTarget,
  listActiveRowMirrorInconsistentMessageIds,
  planAdultOffBatchInspection,
  planAdultOffBatchInspectionSummary,
  resolveDisplayedStatusWidgetTexts,
  runAdultOffBatchInspectionRehearsal,
  sqliteIntegrityCheck,
  surveyAdultOffAuxSurfaces,
  usageRecordsSemanticallyEqual,
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

    const mirrorIds = listActiveRowMirrorInconsistentMessageIds(rows);
    const emptyAssistantIds = rows
      .filter((row) => row.role === "assistant" && !row.content.trim())
      .map((row) => row.id);
    assert.equal(emptyAssistantIds.length, 25);
    for (const id of emptyAssistantIds) {
      assert.equal(mirrorIds.includes(id), false);
    }
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

  it("refuses unsafe copy paths and keeps WAL without checkpointing the source", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adult-off-wal-"));
    const sourcePath = path.join(dir, "live.db");
    const destPath = path.join(dir, "rehearsal.db");
    const walPath = `${sourcePath}-wal`;

    const live = new Database(sourcePath);
    live.pragma("journal_mode = WAL");
    live.pragma("wal_autocheckpoint = 0");
    live.exec("CREATE TABLE wal_probe (id INTEGER PRIMARY KEY, v TEXT NOT NULL)");
    live.prepare("INSERT INTO wal_probe (v) VALUES (?)").run("snap_before_copy");
    const walSizeBefore = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    assert.ok(walSizeBefore > 0);

    copySqliteDatabaseForRehearsal(sourcePath, destPath);

    const walSizeAfter = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    assert.ok(walSizeAfter >= walSizeBefore);

    const copyDb = new Database(destPath, { readonly: true });
    assert.equal(
      (copyDb.prepare("SELECT v FROM wal_probe WHERE id=1").get() as { v: string }).v,
      "snap_before_copy"
    );
    copyDb.close();

    live.prepare("INSERT INTO wal_probe (v) VALUES (?)").run("after_copy");
    assert.equal(
      (live.prepare("SELECT COUNT(*) AS c FROM wal_probe").get() as { c: number }).c,
      2
    );
    live.close();

    assert.throws(() => copySqliteDatabaseForRehearsal(sourcePath, destPath));
    assert.throws(() => copySqliteDatabaseForRehearsal(sourcePath, sourcePath));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("skips stale commit when row canonical fields desync from alternates", () => {
    const oldBody = "alternates에만 남은 이전 본문";
    const newBody = "messages.content에만 반영된 새 본문";
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (1, 'assistant', ?, 'gemini', ?, ?, 0, 'completed')`
      )
      .run(
        newBody,
        JSON.stringify({ cost: 99, model: "gemini" }),
        JSON.stringify([
          { content: oldBody, model: "gemini", usage: { cost: 12 }, created_at: "" },
          { content: newBody, model: "gemini", usage: { cost: 99 }, created_at: "" },
        ])
      );
    const messageId = Number(insert.lastInsertRowid);
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const { variants, activeVariant } = normalizeMessageVariants({
      content: row.content,
      model: row.model ?? "",
      usage: row.usage ?? null,
      alternates: row.alternates ?? null,
      active_variant: row.active_variant ?? null,
    });
    assert.equal(activeVariantMirrorsCanonicalRow(row, variants, activeVariant), false);
    const mirror = assessActiveVariantCanonicalMirror(row, variants, activeVariant);
    assert.equal(mirror.contentMatches, false);
    assert.equal(mirror.settlementMatches, false);

    const fingerprint = fingerprintAdultOffInspectionTarget(row, 0, oldBody);
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: oldBody,
        outcome: "approved",
      }),
      "skipped_stale"
    );

    const after = db
      .prepare("SELECT content, usage, alternates FROM messages WHERE id=?")
      .get(messageId) as { content: string; usage: string; alternates: string };
    assert.equal(after.content, newBody);
    assert.equal(JSON.parse(after.usage).cost, 99);
    assert.equal(JSON.parse(after.alternates)[0]?.content, oldBody);
    assert.equal(JSON.parse(after.alternates)[0]?.usage?.adultOffGuard, undefined);
  });

  it("preserves empty alternates legacy shape when recording proof", () => {
    const text = "레거시 단일 본문";
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (1, 'assistant', ?, 'gemini', ?, '[]', 0, 'completed')`
      )
      .run(text, JSON.stringify({ cost: 7 }));
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
        outcome: "approved",
      }),
      "written"
    );
    const after = db
      .prepare("SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=?")
      .get(messageId) as {
      content: string;
      model: string;
      usage: string;
      alternates: string | null;
      active_variant: number | null;
    };
    assert.equal(after.content, text);
    assert.equal(after.model, "gemini");
    assert.equal(after.alternates, "[]");
    assert.equal(after.active_variant, 0);
    assert.equal(JSON.parse(after.usage).cost, 7);
    assert.equal(adultOffStoredTextDisposition(JSON.parse(after.usage), text), "approved");
  });

  it("uses row-level widget fallback only when the active variant omits statusWidgetValues", () => {
    const widgetLine = "교실 복도";
    const hash = adultOffApprovedTextHash(widgetLine);
    const sharedUsage = {
      cost: 3,
      adultOffGuard: {
        policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
        approvedTextHashes: [hash],
        restrictedTextHashes: [],
      },
    };
    const row: AdultOffInspectionMessageRow = {
      id: 501,
      role: "assistant",
      content: "본문",
      model: "gemini",
      usage: JSON.stringify(sharedUsage),
      alternates: JSON.stringify([
        {
          content: "본문",
          model: "gemini",
          usage: sharedUsage,
          created_at: "",
        },
      ]),
      active_variant: 0,
      status_widget_values_json: JSON.stringify({
        character: { location: widgetLine },
        user: null,
      }),
    };
    const { variants, activeVariant } = normalizeMessageVariants({
      content: row.content,
      model: row.model ?? "",
      usage: row.usage,
      alternates: row.alternates,
      active_variant: row.active_variant,
    });
    const displayed = resolveDisplayedStatusWidgetTexts(row, variants, activeVariant);
    assert.deepEqual(displayed.texts, [widgetLine]);

    const survey = surveyAdultOffAuxSurfaces([row]);
    assert.equal(survey.displayWidgetMessages, 1);
    const widgetItem = survey.items.find((item) => item.surface === "status_widget");
    assert.equal(widgetItem?.hasV2ApprovalProof, true);
    assert.equal(widgetItem?.allTextsApprovedByProof, true);
    assert.equal(survey.auxUnreviewedVisibleTextCount, 0);
  });

  it("does not row-fallback when active variant explicitly stores null statusWidgetValues", () => {
    const widgetLine = "row json only";
    const row: AdultOffInspectionMessageRow = {
      id: 502,
      role: "assistant",
      content: "본문",
      model: "gemini",
      usage: JSON.stringify({ cost: 1 }),
      alternates: JSON.stringify([
        {
          content: "본문",
          model: "gemini",
          usage: { cost: 1 },
          created_at: "",
          statusWidgetValues: null,
        },
      ]),
      active_variant: 0,
      status_widget_values_json: JSON.stringify({
        character: { location: widgetLine },
        user: null,
      }),
    };
    const { variants, activeVariant } = normalizeMessageVariants({
      content: row.content,
      model: row.model ?? "",
      usage: row.usage,
      alternates: row.alternates,
      active_variant: row.active_variant,
    });
    const displayed = resolveDisplayedStatusWidgetTexts(row, variants, activeVariant);
    assert.deepEqual(displayed.texts, []);
    assert.equal(surveyAdultOffAuxSurfaces([row]).displayWidgetMessages, 0);
  });

  it("counts inactive variant widgets separately from the displayed widget", () => {
    const row: AdultOffInspectionMessageRow = {
      id: 503,
      role: "assistant",
      content: "활성",
      model: "gemini",
      usage: JSON.stringify({ cost: 1 }),
      alternates: JSON.stringify([
        {
          content: "활성",
          model: "gemini",
          usage: { cost: 1 },
          created_at: "",
          statusWidgetValues: { character: { mood: "활성 위젯" }, user: null },
        },
        {
          content: "비활성",
          model: "gemini",
          usage: { cost: 2 },
          created_at: "",
          statusWidgetValues: { character: { mood: "비활성 위젯" }, user: null },
        },
      ]),
      active_variant: 0,
      status_widget_values_json: null,
    };
    const survey = surveyAdultOffAuxSurfaces([row]);
    assert.equal(survey.displayWidgetMessages, 1);
    assert.equal(survey.inactiveVariantWidgetMessages, 1);
    assert.ok(survey.items.some((item) => item.surface === "status_widget_inactive"));
  });

  it("treats usage key order as equal but blocks settlement field drift", () => {
    assert.equal(
      usageRecordsSemanticallyEqual({ cost: 3, model: "gemini" }, { model: "gemini", cost: 3 }),
      true
    );
    assert.equal(usageRecordsSemanticallyEqual({ cost: 3 }, { cost: 4 }), false);
    const row: AdultOffInspectionMessageRow = {
      id: 504,
      role: "assistant",
      content: "본문",
      model: "gemini",
      usage: JSON.stringify({ model: "gemini", cost: 9 }),
      alternates: null,
      active_variant: 0,
    };
    const { variants, activeVariant } = normalizeMessageVariants({
      content: row.content,
      model: row.model ?? "",
      usage: row.usage,
      alternates: row.alternates,
      active_variant: row.active_variant,
    });
    variants[0] = {
      ...variants[0]!,
      usage: { cost: 9, model: "gemini" },
    };
    assert.equal(activeVariantMirrorsCanonicalRow(row, variants, activeVariant), true);

    variants[0] = {
      ...variants[0]!,
      usage: { cost: 10, model: "gemini" },
    };
    assert.equal(activeVariantMirrorsCanonicalRow(row, variants, activeVariant), false);
  });

  it("flags canonical content without inspectable variants as mirror conflict", () => {
    const row: AdultOffInspectionMessageRow = {
      id: 505,
      role: "assistant",
      content: "row에만 남은 본문",
      model: "gemini",
      usage: JSON.stringify({ cost: 1 }),
      alternates: JSON.stringify([
        { content: "   ", model: "gemini", usage: { cost: 1 }, created_at: "" },
      ]),
      active_variant: 0,
    };
    assert.equal(assistantRowHasCanonicalContentWithoutInspectableVariant(row), true);
    assert.deepEqual(listActiveRowMirrorInconsistentMessageIds([row]), [505]);
  });

  it("keeps adultRouting on the variant and billingContractDispatch on the row", () => {
    const text = "창가의 대화";
    const adultRouting = { actualModel: "deepseek-v4-pro", fallbackAttempted: false };
    const billingContractDispatch = {
      billingContract: "published_phase2",
      settledDeductedPoints: 33,
      publishedFinalPoints: 33,
    };
    const rowUsage = { cost: 33, model: "deepseek-v4-pro", billingContractDispatch };
    const variantUsage = { cost: 33, model: "deepseek-v4-pro", adultRouting };
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status, request_id)
         VALUES (1, 'assistant', ?, 'deepseek-v4-pro', ?, ?, 0, 'completed', 'req-row')`
      )
      .run(
        text,
        JSON.stringify(rowUsage),
        JSON.stringify([
          {
            content: text,
            model: "deepseek-v4-pro",
            usage: variantUsage,
            created_at: "",
            requestId: "req-variant",
            generationSequence: 0,
          },
        ])
      );
    const messageId = Number(insert.lastInsertRowid);
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const { variants, activeVariant } = normalizeMessageVariants({
      content: row.content,
      model: row.model ?? "",
      usage: row.usage,
      alternates: row.alternates,
      active_variant: row.active_variant,
    });
    const assessment = assessActiveVariantCanonicalMirror(row, variants, activeVariant);
    assert.equal(assessment.mirrors, true);
    assert.equal(assessment.structuralMetadataOnly, true);
    assert.deepEqual(assessment.variantOnlyKeys, ["adultRouting"]);
    assert.deepEqual(assessment.rowOnlyKeys, ["billingContractDispatch"]);
    assert.deepEqual(listActiveRowMirrorInconsistentMessageIds([row]), []);

    const fingerprint = fingerprintAdultOffInspectionTarget(row, 0, text);
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: text,
        outcome: "approved",
      }),
      "written"
    );
    const after = db
      .prepare("SELECT content, model, usage, alternates, request_id FROM messages WHERE id=?")
      .get(messageId) as {
      content: string;
      model: string;
      usage: string;
      alternates: string;
      request_id: string;
    };
    const storedRow = JSON.parse(after.usage) as {
      cost: number;
      adultRouting?: unknown;
      billingContractDispatch?: { settledDeductedPoints: number };
      adultOffGuard?: { policyVersion: number; approvedTextHashes: string[] };
    };
    const storedVariant = JSON.parse(after.alternates)[0].usage as {
      cost: number;
      adultRouting?: { actualModel: string };
      billingContractDispatch?: unknown;
      adultOffGuard?: { policyVersion: number };
    };
    assert.equal(after.content, text);
    assert.equal(after.model, "deepseek-v4-pro");
    assert.equal(after.request_id, "req-row");
    assert.equal(storedRow.cost, 33);
    assert.equal(storedRow.billingContractDispatch?.settledDeductedPoints, 33);
    assert.equal(storedRow.adultRouting, undefined);
    assert.equal(storedRow.adultOffGuard?.policyVersion, ADULT_OFF_GUARD_POLICY_VERSION);
    assert.equal(storedVariant.cost, 33);
    assert.equal(storedVariant.adultRouting?.actualModel, "deepseek-v4-pro");
    assert.equal(storedVariant.billingContractDispatch, undefined);
    assert.equal(adultOffStoredTextDisposition(storedVariant, text), "approved");
    assert.equal(adultOffStoredTextDisposition(storedRow, text), "approved");
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: text,
        outcome: "approved",
      }),
      "skipped_noop"
    );
  });

  it("blocks an active cost drift without rewriting either usage", () => {
    const text = "정산이 어긋난 본문";
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (1, 'assistant', ?, 'gemini', ?, ?, 0, 'completed')`
      )
      .run(
        text,
        JSON.stringify({ cost: 33, model: "gemini" }),
        JSON.stringify([
          { content: text, model: "gemini", usage: { cost: 20, model: "gemini" }, created_at: "" },
        ])
      );
    const messageId = Number(insert.lastInsertRowid);
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    assert.deepEqual(listActiveRowMirrorInconsistentMessageIds([row]), [messageId]);
    const fingerprint = fingerprintAdultOffInspectionTarget(row, 0, text);
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: text,
        outcome: "approved",
      }),
      "skipped_stale"
    );
    const after = db.prepare("SELECT usage, alternates FROM messages WHERE id=?").get(messageId) as {
      usage: string;
      alternates: string;
    };
    assert.equal(JSON.parse(after.usage).cost, 33);
    assert.equal(JSON.parse(after.usage).adultOffGuard, undefined);
    assert.equal(JSON.parse(after.alternates)[0].usage.cost, 20);
    assert.equal(JSON.parse(after.alternates)[0].usage.adultOffGuard, undefined);
  });

  it("stamps only the displayed variant when canonical content differs and settlement matches", () => {
    const displayed = "가".repeat(1757);
    const canonical = "나".repeat(1751);
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status, request_id)
         VALUES (1, 'assistant', ?, 'gemini', ?, ?, 0, 'completed', 'req-row')`
      )
      .run(
        canonical,
        JSON.stringify({ cost: 8, model: "gemini" }),
        JSON.stringify([
          {
            content: displayed,
            model: "gemini",
            usage: { cost: 8, model: "gemini" },
            created_at: "",
            requestId: "req-other",
          },
        ])
      );
    const messageId = Number(insert.lastInsertRowid);
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const beforeGuard = presentAdultOffStoredRead({
      applyGuard: false,
      rowContent: row.content,
      variants: normalizeMessageVariants({
        content: row.content,
        model: row.model ?? "",
        usage: row.usage,
        alternates: row.alternates,
        active_variant: row.active_variant,
      }).variants,
      activeVariant: 0,
    });
    assert.equal(beforeGuard.content.length, 1757);
    assert.equal(beforeGuard.content, displayed);
    const fingerprint = fingerprintAdultOffInspectionTarget(row, 0, displayed);
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: displayed,
        outcome: "approved",
      }),
      "written_variant_isolated"
    );
    const after = db
      .prepare("SELECT content, usage, alternates, request_id FROM messages WHERE id=?")
      .get(messageId) as {
      content: string;
      usage: string;
      alternates: string;
      request_id: string;
    };
    assert.equal(after.content, canonical);
    assert.equal(after.content.length, 1751);
    assert.equal(after.request_id, "req-row");
    assert.equal(JSON.parse(after.usage).adultOffGuard, undefined);
    assert.equal(JSON.parse(after.usage).cost, 8);
    const storedVariants = JSON.parse(after.alternates);
    assert.equal(storedVariants[0].content, displayed);
    assert.equal(adultOffStoredTextDisposition(storedVariants[0].usage, displayed), "approved");
    const guarded = presentAdultOffStoredRead({
      applyGuard: true,
      rowContent: after.content,
      variants: storedVariants,
      activeVariant: 0,
    });
    assert.equal(guarded.content, displayed);
    assert.equal(guarded.withheld, false);
  });

  it("still approves an inactive variant when the active row charge has drifted", () => {
    const active = "활성 본문";
    const inactive = "비활성 본문";
    const insert = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant, generation_status)
         VALUES (1, 'assistant', ?, 'gemini', ?, ?, 0, 'completed')`
      )
      .run(
        active,
        JSON.stringify({ cost: 40 }),
        JSON.stringify([
          { content: active, model: "gemini", usage: { cost: 10 }, created_at: "", requestId: "a" },
          { content: inactive, model: "gemini", usage: { cost: 6 }, created_at: "", requestId: "b" },
        ])
      );
    const messageId = Number(insert.lastInsertRowid);
    const row = db
      .prepare(
        "SELECT id, role, content, model, usage, alternates, active_variant FROM messages WHERE id=?"
      )
      .get(messageId) as AdultOffInspectionMessageRow;
    const fingerprint = fingerprintAdultOffInspectionTarget(row, 1, inactive);
    assert.equal(
      commitAdultOffInspectionIfFresh(db, {
        fingerprint,
        expectedText: inactive,
        outcome: "approved",
      }),
      "written"
    );
    const after = db.prepare("SELECT usage, alternates FROM messages WHERE id=?").get(messageId) as {
      usage: string;
      alternates: string;
    };
    assert.equal(JSON.parse(after.usage).cost, 40);
    assert.equal(JSON.parse(after.usage).adultOffGuard, undefined);
    const variants = JSON.parse(after.alternates);
    assert.equal(variants[0].usage.cost, 10);
    assert.equal(variants[0].usage.adultOffGuard, undefined);
    assert.equal(adultOffStoredTextDisposition(variants[1].usage, inactive), "approved");
  });

  it("shows legacy unguarded prose when the guard is off", () => {
    const text = "구버전 로맨스 본문";
    const shown = presentAdultOffStoredRead({
      applyGuard: false,
      rowContent: text,
      variants: [
        {
          content: text,
          model: "gemini",
          usage: { input: 1, output: 1, model: "gemini", route: "safe", cost: 1, breakdown: [] },
          created_at: "",
        },
      ],
      activeVariant: 0,
    });
    assert.equal(shown.content, text);
    assert.equal(shown.withheld, false);
  });
});

describe("sqlite 3.45.1 REAL NOT NULL DEFAULT integrity false positive", () => {
  it("reproduces image_focus NULL reports without treating messages as corrupt", () => {
    const db = new Database(":memory:");
    const version = (db.prepare("SELECT sqlite_version() AS v").get() as { v: string }).v;
    assert.equal(version, "3.45.1");
    db.exec(`
      CREATE TABLE user_personas (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO user_personas (name) VALUES ('persona');
      ALTER TABLE user_personas ADD COLUMN image_focus_x REAL NOT NULL DEFAULT 0.5;
      ALTER TABLE user_personas ADD COLUMN image_focus_y REAL NOT NULL DEFAULT 0.28;
      CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT NOT NULL);
      INSERT INTO messages (content) VALUES ('synthetic');
    `);
    const full = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const messages = db.pragma("integrity_check(messages)") as Array<{ integrity_check: string }>;
    assert.ok(full.some((row) => row.integrity_check.includes("user_personas.image_focus_x")));
    assert.ok(full.some((row) => row.integrity_check.includes("user_personas.image_focus_y")));
    assert.deepEqual(
      messages.map((row) => row.integrity_check),
      ["ok"]
    );
    db.close();
  });
});
