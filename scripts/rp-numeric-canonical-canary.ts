/**
 * Phase B1-C CORE_CANONICAL_HARNESS — deterministic state consistency (no LLM).
 *
 * Runs 4 normal + 2 regen turns through executeAtomicNumericAssistantFinalize
 * against an in-memory fixture DB, verifying:
 *   NUMERIC CURRENT == MESSAGE STATUS == ACTIVE VARIANT STATUS
 * and regen replacement baselines.
 *
 * This is NOT TRUE_ROUTE_CANARY / LIVE_ROUTE_CANARY.
 * True HTTP `/api/chat` canary lives in scripts/rp-numeric-route-canary.ts.
 *
 * Does NOT enable Railway general rollout. Leaves production flags OFF.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { ServerMeterNumericStateDefinitionV1, StatusWidget } from "../src/lib/statusWidget/types";
import {
  ensureRpNumericStateTables,
  executeAtomicNumericAssistantFinalize,
  getNumericStateCurrent,
  getNumericStateEventById,
} from "../src/lib/rpNumericState";
import { parseStoredStatusWidgetValuesJson } from "../src/lib/statusWidget/parseValues";

const def: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 40,
  integer: true,
  maxIncreasePerTurn: 5,
  maxDecreasePerTurn: 5,
};

const widget: StatusWidget = {
  version: 1,
  name: "b1c-canary",
  htmlTemplate: "{{affection}} {{trust}} {{corruption}}",
  placement: "bottom",
  fields: (["affection", "trust", "corruption"] as const).map((id) => ({
    id,
    label: id,
    instruction: id,
    numericState: { ...def },
  })),
};

type TurnRecord = {
  turn: number;
  kind: "normal" | "regen";
  proposals: Record<string, string>;
  current: Record<string, number>;
  message: Record<string, string>;
  activeVariant: Record<string, string>;
  events: Array<{
    stateKey: string;
    before: number | null;
    proposed: number | null;
    applied: number | null;
    after: number | null;
    replaces: number | null;
  }>;
  parityOk: boolean;
};

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      usage TEXT,
      alternates TEXT,
      active_variant INTEGER DEFAULT 0,
      status_widget_values_json TEXT DEFAULT '',
      status_widget_turn_active INTEGER DEFAULT 0,
      generation_status TEXT DEFAULT 'generating',
      status TEXT DEFAULT 'ok',
      is_refunded INTEGER DEFAULT 0,
      status_meta TEXT,
      deduction_slices TEXT,
      updated_at TEXT
    );
  `);
  ensureRpNumericStateTables(db);
  return db;
}

function readParity(
  db: Database.Database,
  messageId: number
): {
  current: Record<string, number>;
  message: Record<string, string>;
  activeVariant: Record<string, string>;
  ok: boolean;
} {
  const current: Record<string, number> = {};
  for (const key of ["affection", "trust", "corruption"]) {
    current[key] = getNumericStateCurrent(db, 1, key)!.numericValue;
  }
  const stored = parseStoredStatusWidgetValuesJson(
    (
      db.prepare(`SELECT status_widget_values_json AS v FROM messages WHERE id=?`).get(
        messageId
      ) as { v: string }
    ).v
  );
  const message = stored.character ?? {};
  const row = db
    .prepare(`SELECT alternates, active_variant FROM messages WHERE id=?`)
    .get(messageId) as { alternates: string; active_variant: number };
  const variants = JSON.parse(row.alternates || "[]") as Array<{
    statusWidgetValues?: { character?: Record<string, string> };
  }>;
  const activeVariant = variants[row.active_variant]?.statusWidgetValues?.character ?? {};
  let ok = true;
  for (const key of ["affection", "trust", "corruption"]) {
    if (String(current[key]) !== String(message[key])) ok = false;
    if (String(current[key]) !== String(activeVariant[key])) ok = false;
  }
  return { current, message, activeVariant, ok };
}

function main(): void {
  const db = makeDb();
  const records: TurnRecord[] = [];
  let previous: Record<string, string> = {
    affection: "40",
    trust: "40",
    corruption: "40",
  };
  let messageId = 0;
  let parityFailures = 0;

  const normals: Array<Record<string, string>> = [
    { affection: "43", trust: "42", corruption: "41" },
    { affection: "48", trust: "44", corruption: "43" },
    { affection: "80", trust: "46", corruption: "44" }, // clamp affection
    { affection: "52", trust: "48", corruption: "46" },
  ];

  for (let i = 0; i < normals.length; i++) {
    messageId = i + 1;
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, generation_status, alternates)
       VALUES (?, 1, 'assistant', ?, 'canary', 'generating', '[]')`
    ).run(messageId, `normal-${i + 1}`);
    const proposals = normals[i];
    const result = executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: messageId,
      chatId: 1,
      characterId: 19,
      content: `normal-${i + 1}`,
      model: "canary",
      usageJson: "{}",
      variants: [
        {
          content: `normal-${i + 1}`,
          model: "canary",
          usage: null,
          created_at: "",
          statusWidgetValues: { character: { ...proposals } },
        },
      ],
      activeVariant: 0,
      statusWidgetValues: { character: { ...proposals } },
      characterWidget: widget,
      previousCanonicalStatus: { character: { ...previous } },
      generationSequence: 0,
      isRegeneration: false,
      requestId: `n${i + 1}`,
      sourceTurn: i + 1,
    });
    const parity = readParity(db, messageId);
    if (!parity.ok) parityFailures++;
    const events = ["affection", "trust", "corruption"].map((stateKey) => {
      const cur = getNumericStateCurrent(db, 1, stateKey)!;
      const ev = getNumericStateEventById(db, cur.lastEventId!)!;
      return {
        stateKey,
        before: ev.beforeValue,
        proposed: ev.proposedValue,
        applied: ev.appliedDelta,
        after: ev.afterValue,
        replaces: ev.replacesEventId,
      };
    });
    records.push({
      turn: i + 1,
      kind: "normal",
      proposals,
      current: parity.current,
      message: parity.message,
      activeVariant: parity.activeVariant,
      events,
      parityOk: parity.ok,
    });
    previous = { ...parity.message };
    void result;
  }

  // Regen on latest message (turn 4): two replacements.
  const regenProposals = [
    { affection: "54", trust: "49", corruption: "47" },
    { affection: "90", trust: "50", corruption: "48" }, // clamp affection from pre-turn baseline
  ];
  const latestId = messageId;
  // Pre-turn baseline for turn 4 (after turn 3).
  const preTurn4Baseline = { ...records[2].message };

  for (let r = 0; r < regenProposals.length; r++) {
    db.prepare(
      `UPDATE messages SET generation_status='generating', status_widget_values_json='' WHERE id=?`
    ).run(latestId);
    const proposals = regenProposals[r];
    const seq = r + 1;
    const existing = db
      .prepare(`SELECT alternates FROM messages WHERE id=?`)
      .get(latestId) as { alternates: string };
    const prevVariants = JSON.parse(existing.alternates || "[]");
    const variants = [
      ...prevVariants,
      {
        content: `regen-${seq}`,
        model: "canary",
        usage: null,
        created_at: "",
        statusWidgetValues: { character: { ...proposals } },
      },
    ];
    executeAtomicNumericAssistantFinalize(db, {
      assistantMessageId: latestId,
      chatId: 1,
      characterId: 19,
      content: `regen-${seq}`,
      model: "canary",
      usageJson: "{}",
      variants,
      activeVariant: variants.length - 1,
      statusWidgetValues: { character: { ...proposals } },
      characterWidget: widget,
      previousCanonicalStatus: { character: { ...preTurn4Baseline } },
      generationSequence: seq,
      isRegeneration: true,
      requestId: `regen${seq}`,
      sourceTurn: 4,
    });
    const parity = readParity(db, latestId);
    if (!parity.ok) parityFailures++;
    const events = ["affection", "trust", "corruption"].map((stateKey) => {
      const cur = getNumericStateCurrent(db, 1, stateKey)!;
      const ev = getNumericStateEventById(db, cur.lastEventId!)!;
      return {
        stateKey,
        before: ev.beforeValue,
        proposed: ev.proposedValue,
        applied: ev.appliedDelta,
        after: ev.afterValue,
        replaces: ev.replacesEventId,
      };
    });
    // Regen baseline must equal pre-turn (turn3 after), not rejected variant.
    for (const ev of events) {
      const baseline = Number(preTurn4Baseline[ev.stateKey]);
      if (ev.before !== baseline) {
        parityFailures++;
        console.error("REGEN_BASELINE_MISMATCH", ev.stateKey, ev.before, baseline);
      }
    }
    records.push({
      turn: 4,
      kind: "regen",
      proposals,
      current: parity.current,
      message: parity.message,
      activeVariant: parity.activeVariant,
      events,
      parityOk: parity.ok,
    });
  }

  const outDir = join(
    process.cwd(),
    "docs/audits/rp-numeric-state-canonical-b1c"
  );
  mkdirSync(outDir, { recursive: true });
  const corePass = parityFailures === 0;
  const summary = {
    CORE_CANONICAL_HARNESS: corePass ? "PASS" : "FAIL",
    B1_C_CORE_INTEGRATION_PASS: corePass,
    PHASE_B1C_LOCAL_CANARY: corePass ? "PASS" : "FAIL",
    normal_turns: 4,
    regen_turns: 2,
    parity_failures: parityFailures,
    canonical_feature_default: "OFF",
    railway_general_rollout: "NOT_RUN",
    method: "executeAtomicNumericAssistantFinalize_in_memory",
    not_live_route_canary: true,
    records,
  };
  writeFileSync(join(outDir, "CANARY_TURNS.json"), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(outDir, "FINAL_CANARY_VERDICT.md"),
    [
      "# Phase B1-C — CORE_CANONICAL_HARNESS",
      "",
      `- Status: **${summary.CORE_CANONICAL_HARNESS}**`,
      `- Verdict name: B1_C_CORE_INTEGRATION_PASS`,
      `- Normal turns: ${summary.normal_turns}`,
      `- Regen turns: ${summary.regen_turns}`,
      `- Parity failures: ${summary.parity_failures}`,
      `- Canonical feature default: OFF`,
      `- Railway general rollout: NOT_RUN`,
      "",
      "Method: deterministic in-memory harness via `executeAtomicNumericAssistantFinalize`",
      "(state consistency only; no LLM / no production flag enablement).",
      "",
      "**Not** `TRUE_ROUTE_CANARY` / `LIVE_ROUTE_CANARY`.",
      "See `ROUTE_CANARY_VERDICT.md` for the real `/api/chat` canary.",
      "",
    ].join("\n")
  );

  console.log(JSON.stringify({
    ok: parityFailures === 0,
    normal_turns: 4,
    regen_turns: 2,
    parity_failures: parityFailures,
  }));
  if (parityFailures > 0) process.exit(1);
}

main();
