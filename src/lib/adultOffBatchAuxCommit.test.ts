import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  assertIsolatedTestDatabaseActive,
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  adultOffApprovedTextHash,
  adultOffStoredTextDisposition,
} from "@/lib/adultOffOutputGuard";
import {
  commitAdultOffAuxSurveyItemIfFresh,
  fingerprintAdultOffAuxSurveyItem,
  surveyAdultOffAuxSurfaces,
  type AdultOffAuxTextItem,
  type AdultOffInspectionMessageRow,
} from "@/lib/adultOffBatchInspectionPrep";

const ROW_COLUMNS = `id, role, content, model, usage, alternates, active_variant, status_meta,
  suggested_replies_json, status_widget_values_json`;

const REPLIES = [
  { kind: "natural", text: "첫 번째 추천 답장입니다. 지금 장면의 분위기를 유지하면서 자연스럽게 이어갑니다." },
  { kind: "twist", text: "두 번째 추천 답장입니다. 예상 밖의 각도로 반응하되 개연성은 지킵니다." },
  { kind: "banter", text: "세 번째 추천 답장입니다. 페르소나 말투로 가볍게 장난치는 반응입니다." },
];

describe("adult-off batch aux commit regressions", { concurrency: 1 }, () => {
  let db: DatabaseType;

  before(async () => {
    installIsolatedTestDatabase();
    const dbMod = await import("@/lib/db");
    db = dbMod.getDb();
    assertIsolatedTestDatabaseActive();
  });

  after(() => {
    uninstallIsolatedTestDatabase();
  });

  function insertAssistant(input: {
    content?: string;
    usage?: unknown;
    alternates?: unknown;
    activeVariant?: number | null;
    statusMeta?: string | null;
    replies?: string | null;
    widgetJson?: string | null;
    requestId?: string;
    generationStatus?: string;
  }): number {
    const result = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, usage, alternates, active_variant,
           generation_status, request_id, status_meta, suggested_replies_json, status_widget_values_json)
         VALUES (1, 'assistant', ?, 'gemini', ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.content ?? "본문",
        JSON.stringify(input.usage ?? { cost: 3 }),
        input.alternates === undefined ? "[]" : JSON.stringify(input.alternates),
        input.activeVariant ?? 0,
        input.generationStatus ?? "completed",
        input.requestId ?? "req-aux",
        input.statusMeta ?? null,
        input.replies ?? null,
        input.widgetJson ?? ""
      );
    return Number(result.lastInsertRowid);
  }

  function readRow(id: number): AdultOffInspectionMessageRow {
    return db
      .prepare(`SELECT ${ROW_COLUMNS} FROM messages WHERE id=?`)
      .get(id) as AdultOffInspectionMessageRow;
  }

  function surveyItem(id: number, surface: AdultOffAuxTextItem["surface"], variantIndex?: number) {
    const item = surveyAdultOffAuxSurfaces([readRow(id)]).items.find(
      (entry) =>
        entry.surface === surface && (variantIndex == null || entry.variantIndex === variantIndex)
    );
    assert.ok(item, `survey item ${surface}`);
    return item!;
  }

  function commit(id: number, item: AdultOffAuxTextItem, outcomes?: Array<"approved" | "unresolved">) {
    const fingerprint = fingerprintAdultOffAuxSurveyItem(readRow(id), item, db);
    assert.ok(fingerprint, "fingerprint");
    return {
      fingerprint: fingerprint!,
      run: () =>
        commitAdultOffAuxSurveyItemIfFresh(db, {
          fingerprint: fingerprint!,
          expectedTexts: item.texts,
          outcomes: outcomes ?? item.texts.map(() => "approved" as const),
        }),
    };
  }

  const proofOf = (texts: string[], policyVersion = ADULT_OFF_GUARD_POLICY_VERSION) => ({
    policyVersion,
    approvedTextHashes: texts.map((text) => adultOffApprovedTextHash(text)),
  });

  describe("raw JSON preservation", () => {
    it("adds only the policy-v2 proof to suggested replies and keeps unknown fields", () => {
      const raw = {
        extractedAt: "2026-01-01T00:00:00.000Z",
        source: "post-turn-shared",
        generationSequence: 0,
        generationRequestId: "req-aux",
        items: REPLIES.map((reply) => ({ ...reply, futureField: { nested: [1, 2, 3] } })),
        futureTopLevel: { keep: "me", n: 7 },
        telemetry: ["a", "b"],
      };
      const id = insertAssistant({ replies: JSON.stringify(raw) });
      const item = surveyItem(id, "suggested_replies");
      assert.equal(commit(id, item).run(), "written");
      const stored = JSON.parse(readRow(id).suggested_replies_json!) as Record<string, unknown>;
      const { adultOffGuard, ...rest } = stored;
      assert.deepEqual(rest, raw);
      assert.deepEqual(adultOffGuard, proofOf(item.texts));
      assert.equal(Object.keys(stored).at(-1), "adultOffGuard");
    });

    it("adds only the policy-v2 proof to status meta and keeps unknown fields and inner guard keys", () => {
      const location = "비 오는 골목";
      const raw = {
        meta: { location, futureMetaField: "keep-meta" },
        extractedAt: "2026-01-01T00:00:00.000Z",
        source: "background-deepseek",
        pending: false,
        formatSpec: "spec-1",
        generationSequence: 0,
        generationRequestId: "req-aux",
        diagnostics: { latencyMs: 12, tags: ["x"] },
        adultOffGuard: {
          policyVersion: 1,
          approvedTextHashes: ["stale-v1-hash"],
          restrictedTextHashes: ["stale-v1-restricted"],
          auditNote: "keep-note",
        },
      };
      const id = insertAssistant({ statusMeta: JSON.stringify(raw) });
      const item = surveyItem(id, "status_meta");
      assert.deepEqual(item.texts, [location]);
      assert.equal(commit(id, item).run(), "written");
      const stored = JSON.parse(readRow(id).status_meta!) as typeof raw & {
        adultOffGuard: Record<string, unknown>;
      };
      assert.deepEqual(stored.meta, raw.meta);
      assert.deepEqual(stored.diagnostics, raw.diagnostics);
      assert.equal(stored.formatSpec, "spec-1");
      assert.equal(stored.generationRequestId, "req-aux");
      assert.equal(stored.adultOffGuard.auditNote, "keep-note");
      assert.equal(stored.adultOffGuard.policyVersion, ADULT_OFF_GUARD_POLICY_VERSION);
      assert.deepEqual(stored.adultOffGuard.approvedTextHashes, [adultOffApprovedTextHash(location)]);
      assert.equal("restrictedTextHashes" in stored.adultOffGuard, false);
      assert.equal(
        adultOffStoredTextDisposition({ adultOffGuard: stored.adultOffGuard }, "stale-v1-restricted"),
        "unreviewed"
      );
    });

    it("keeps already approved hashes of the same policy when adding a new string", () => {
      const location = "새 장소";
      const priorHash = adultOffApprovedTextHash("이전에 승인된 다른 문장");
      const raw = {
        meta: { location },
        extractedAt: "",
        source: "background-deepseek",
        generationSequence: 0,
        generationRequestId: "req-aux",
        adultOffGuard: {
          policyVersion: ADULT_OFF_GUARD_POLICY_VERSION,
          approvedTextHashes: [priorHash],
        },
      };
      const id = insertAssistant({ statusMeta: JSON.stringify(raw) });
      assert.equal(commit(id, surveyItem(id, "status_meta")).run(), "written");
      const guard = (JSON.parse(readRow(id).status_meta!) as { adultOffGuard: { approvedTextHashes: string[] } })
        .adultOffGuard;
      assert.deepEqual(guard.approvedTextHashes, [priorHash, adultOffApprovedTextHash(location)]);
    });

    it("skips pending, failed and in-flight aux records without writing", () => {
      const base = {
        meta: { location: "장소" },
        extractedAt: "",
        source: "background-deepseek",
        generationSequence: 0,
        generationRequestId: "req-aux",
      };
      const staleCases: Array<{ name: string; raw: object; status?: string }> = [
        { name: "pending", raw: { ...base, pending: true } },
        { name: "failed", raw: { ...base, failed: true } },
      ];
      for (const entry of staleCases) {
        const id = insertAssistant({ statusMeta: JSON.stringify(base) });
        const fingerprint = fingerprintAdultOffAuxSurveyItem(readRow(id), surveyItem(id, "status_meta"), db);
        assert.ok(fingerprint);
        db.prepare("UPDATE messages SET status_meta=? WHERE id=?").run(JSON.stringify(entry.raw), id);
        const before = readRow(id).status_meta;
        const result = commitAdultOffAuxSurveyItemIfFresh(db, {
          fingerprint: fingerprint!,
          expectedTexts: ["장소"],
          outcomes: ["approved"],
        });
        assert.equal(result, "skipped_stale", entry.name);
        assert.equal(readRow(id).status_meta, before, entry.name);
      }
      const inFlight = insertAssistant({
        statusMeta: JSON.stringify(base),
        generationStatus: "generating",
      });
      assert.equal(
        fingerprintAdultOffAuxSurveyItem(readRow(inFlight), surveyItem(inFlight, "status_meta"), db),
        null
      );
      const drift = insertAssistant({ statusMeta: JSON.stringify(base) });
      const driftFingerprint = fingerprintAdultOffAuxSurveyItem(
        readRow(drift),
        surveyItem(drift, "status_meta"),
        db
      );
      db.prepare("UPDATE messages SET generation_status='generating' WHERE id=?").run(drift);
      assert.equal(
        commitAdultOffAuxSurveyItemIfFresh(db, {
          fingerprint: driftFingerprint!,
          expectedTexts: ["장소"],
          outcomes: ["approved"],
        }),
        "skipped_stale"
      );
    });

    it("requires exact per-string approval and refuses a changed string", () => {
      const raw = {
        extractedAt: "",
        source: "post-turn-shared",
        generationSequence: 0,
        generationRequestId: "req-aux",
        items: REPLIES,
      };
      const id = insertAssistant({ replies: JSON.stringify(raw) });
      const item = surveyItem(id, "suggested_replies");
      const prepared = commit(id, item, ["approved", "unresolved", "approved"]);
      const before = readRow(id).suggested_replies_json;
      assert.equal(prepared.run(), "skipped_unresolved");
      assert.equal(readRow(id).suggested_replies_json, before);

      const changed = { ...raw, items: [{ ...REPLIES[0]!, text: `${REPLIES[0]!.text} 변경` }, ...REPLIES.slice(1)] };
      db.prepare("UPDATE messages SET suggested_replies_json=? WHERE id=?").run(JSON.stringify(changed), id);
      const afterChange = readRow(id).suggested_replies_json;
      assert.equal(
        commitAdultOffAuxSurveyItemIfFresh(db, {
          fingerprint: prepared.fingerprint,
          expectedTexts: item.texts,
          outcomes: item.texts.map(() => "approved" as const),
        }),
        "skipped_stale"
      );
      assert.equal(readRow(id).suggested_replies_json, afterChange);
    });
  });

  describe("status widget variants and legacy row fallback", () => {
    const LINE = "교실 복도";
    const rowWidget = JSON.stringify({ character: { location: LINE }, user: null });

    it("stamps a legacy row-fallback widget on the active variant without touching widget values", () => {
      const id = insertAssistant({ widgetJson: rowWidget });
      const item = surveyItem(id, "status_widget");
      assert.equal(item.widgetSource, "row_fallback");
      const before = readRow(id);
      assert.equal(commit(id, item).run(), "written");
      const after = readRow(id);
      assert.equal(after.status_widget_values_json, rowWidget);
      assert.equal(after.alternates, "[]");
      assert.equal(after.content, before.content);
      const usage = JSON.parse(after.usage!) as { cost: number; adultOffGuard: unknown };
      assert.equal(usage.cost, 3);
      assert.equal(adultOffStoredTextDisposition(usage, LINE), "approved");
      assert.equal(surveyAdultOffAuxSurfaces([after]).auxUnreviewedVisibleTextCount, 0);
    });

    it("marks a row-fallback widget stale when the row JSON changes or a variant snapshot appears", () => {
      const jsonChanged = insertAssistant({ widgetJson: rowWidget });
      const first = commit(jsonChanged, surveyItem(jsonChanged, "status_widget"));
      db.prepare("UPDATE messages SET status_widget_values_json=? WHERE id=?").run(
        JSON.stringify({ character: { location: "다른 복도" }, user: null }),
        jsonChanged
      );
      const usageBefore = readRow(jsonChanged).usage;
      assert.equal(first.run(), "skipped_stale");
      assert.equal(readRow(jsonChanged).usage, usageBefore);

      const regenerated = insertAssistant({ widgetJson: rowWidget });
      const second = commit(regenerated, surveyItem(regenerated, "status_widget"));
      db.prepare("UPDATE messages SET alternates=?, active_variant=0 WHERE id=?").run(
        JSON.stringify([
          {
            content: "본문",
            model: "gemini",
            usage: { cost: 3 },
            created_at: "",
            statusWidgetValues: { character: { location: LINE }, user: null },
          },
        ]),
        regenerated
      );
      assert.equal(second.run(), "skipped_stale");
      assert.equal(adultOffStoredTextDisposition(JSON.parse(readRow(regenerated).usage!), LINE), "unreviewed");
    });

    it("stamps only the active variant and mirrors row usage for a persisted-alternates row fallback", () => {
      const id = insertAssistant({
        content: "현재 본문",
        usage: { cost: 4 },
        alternates: [
          { content: "이전 본문", model: "gemini", usage: { cost: 3 }, created_at: "" },
          { content: "현재 본문", model: "gemini", usage: { cost: 4 }, created_at: "" },
        ],
        activeVariant: 1,
        widgetJson: rowWidget,
      });
      const item = surveyItem(id, "status_widget");
      assert.equal(item.widgetSource, "row_fallback");
      assert.equal(item.variantIndex, 1);
      assert.equal(commit(id, item).run(), "written");
      const after = readRow(id);
      const variants = JSON.parse(after.alternates!) as Array<{ usage: Record<string, unknown> }>;
      assert.equal(adultOffStoredTextDisposition(variants[1]!.usage, LINE), "approved");
      assert.equal(adultOffStoredTextDisposition(variants[0]!.usage, LINE), "unreviewed");
      assert.equal(adultOffStoredTextDisposition(JSON.parse(after.usage!), LINE), "approved");
      assert.equal(variants[1]!.usage.cost, 4);
      assert.equal(JSON.parse(after.usage!).cost, 4);
    });

    it("stamps an inactive variant widget without touching row usage and refuses after an active switch", () => {
      const inactiveLine = "비활성 장소";
      const alternates = [
        {
          content: "이전 본문",
          model: "gemini",
          usage: { cost: 3 },
          created_at: "",
          statusWidgetValues: { character: { location: inactiveLine }, user: null },
        },
        { content: "현재 본문", model: "gemini", usage: { cost: 4 }, created_at: "", statusWidgetValues: null },
      ];
      const id = insertAssistant({
        content: "현재 본문",
        usage: { cost: 4 },
        alternates,
        activeVariant: 1,
      });
      const item = surveyItem(id, "status_widget_inactive", 0);
      const rowUsageBefore = readRow(id).usage;
      assert.equal(commit(id, item).run(), "written");
      const after = readRow(id);
      assert.equal(after.usage, rowUsageBefore);
      const variants = JSON.parse(after.alternates!) as Array<Record<string, unknown>>;
      assert.equal(adultOffStoredTextDisposition(variants[0]!.usage, inactiveLine), "approved");
      assert.deepEqual(variants[0]!.statusWidgetValues, alternates[0]!.statusWidgetValues);
      assert.deepEqual(variants[1], alternates[1]);

      const switched = insertAssistant({
        content: "현재 본문",
        usage: { cost: 4 },
        alternates,
        activeVariant: 1,
      });
      const prepared = commit(switched, surveyItem(switched, "status_widget_inactive", 0));
      db.prepare("UPDATE messages SET active_variant=0, content='이전 본문', usage=? WHERE id=?").run(
        JSON.stringify({ cost: 3 }),
        switched
      );
      const frozen = readRow(switched).alternates;
      assert.equal(prepared.run(), "skipped_stale");
      assert.equal(readRow(switched).alternates, frozen);
    });

    it("does not stamp the wrong variant when the displayed variant changes", () => {
      const lineB = "다른 변종 장소";
      const alternates = [
        {
          content: "A 본문",
          model: "gemini",
          usage: { cost: 3 },
          created_at: "",
          statusWidgetValues: { character: { location: LINE }, user: null },
        },
        {
          content: "B 본문",
          model: "gemini",
          usage: { cost: 4 },
          created_at: "",
          statusWidgetValues: { character: { location: lineB }, user: null },
        },
      ];
      const id = insertAssistant({ content: "B 본문", usage: { cost: 4 }, alternates, activeVariant: 1 });
      const prepared = commit(id, surveyItem(id, "status_widget"));
      assert.equal(prepared.fingerprint.variantIndex, 1);
      db.prepare("UPDATE messages SET active_variant=0, content='A 본문', usage=? WHERE id=?").run(
        JSON.stringify({ cost: 3 }),
        id
      );
      const frozen = readRow(id);
      assert.equal(prepared.run(), "skipped_stale");
      const after = readRow(id);
      assert.equal(after.alternates, frozen.alternates);
      assert.equal(after.usage, frozen.usage);
    });

    it("keeps row usage, variant settlement and widget values intact when a variant snapshot is stamped", () => {
      const alternates = [
        {
          content: "본문",
          model: "gemini",
          usage: { cost: 3, billingContractDispatch: undefined },
          created_at: "",
          statusWidgetValues: { character: { location: LINE }, user: { mood: "차분함" } },
          futureVariantField: { keep: true },
        },
      ];
      const id = insertAssistant({ alternates, activeVariant: 0 });
      const item = surveyItem(id, "status_widget");
      assert.equal(item.widgetSource, "variant_snapshot");
      assert.equal(item.texts.length, 2);
      assert.equal(commit(id, item).run(), "written");
      const after = readRow(id);
      const variants = JSON.parse(after.alternates!) as Array<Record<string, unknown>>;
      assert.deepEqual(variants[0]!.statusWidgetValues, alternates[0]!.statusWidgetValues);
      assert.deepEqual(variants[0]!.futureVariantField, { keep: true });
      assert.equal((variants[0]!.usage as { cost: number }).cost, 3);
      assert.equal(JSON.parse(after.usage!).cost, 3);
      for (const text of item.texts) {
        assert.equal(adultOffStoredTextDisposition(JSON.parse(after.usage!), text), "approved");
      }
    });

    it("reuses an existing body approval hash for the same widget string and writes nothing", () => {
      const usage = { cost: 3, adultOffGuard: { ...proofOf([LINE]), restrictedTextHashes: [] } };
      const id = insertAssistant({ usage, widgetJson: rowWidget });
      const item = surveyItem(id, "status_widget");
      assert.equal(item.allTextsApprovedByProof, true);
      const before = readRow(id);
      assert.equal(commit(id, item).run(), "skipped_noop");
      assert.deepEqual(readRow(id), before);
    });

    it("still counts and skips a row-fallback widget under an in-flight generation", () => {
      const id = insertAssistant({ widgetJson: rowWidget, generationStatus: "generating" });
      const item = surveyItem(id, "status_widget");
      assert.equal(fingerprintAdultOffAuxSurveyItem(readRow(id), item, db), null);
    });
  });
});
