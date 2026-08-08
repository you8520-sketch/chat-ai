/**
 * Phase B1-D1 final hardening — DELETE /api/chat/turn route canary.
 *
 * Seeds predecessor + latest numeric turn in local SQLite (no LLM).
 * Verifies HTTP 200 delete + 409 expectedAssistantMessageId mismatch.
 *
 * Usage (server must already be running with ENABLED=1):
 *   RP_NUMERIC_STATE_ENABLED=1 RP_NUMERIC_STATE_KILL_SWITCH=0 npm run dev
 *   node --conditions=react-server --import tsx scripts/rp-numeric-turn-delete-route-canary.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import {
  parseStatusWidgetJson,
  serializeStatusWidget,
} from "../src/lib/statusWidget";
import type { ServerMeterNumericStateDefinitionV1 } from "../src/lib/statusWidget/types";
import { ensureEpisodicMemoryFactsTable } from "../src/lib/episodicMemoryFacts";
import { ensureStatusWidgetTriggerTables } from "../src/lib/statusWidgetTriggers";
import {
  bootstrapNumericStateCurrentCore,
  commitNumericStateProposalCore,
  ensureRpNumericStateTables,
  getNumericStateCurrent,
} from "../src/lib/rpNumericState";
import { parseStoredStatusWidgetValuesJson } from "../src/lib/statusWidget/parseValues";

loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const DB_PATH = process.env.SMOKE_DB_PATH ?? "data/app.db";
const OUT =
  process.env.OUT_DIR ?? "docs/audits/rp-numeric-state-turn-delete-b1d1";
const EMAIL =
  process.env.B1D1_ROUTE_DELETE_EMAIL ?? "rp.numeric.b1d1.delete@example.com";
const PASSWORD =
  process.env.B1D1_ROUTE_DELETE_PASSWORD ?? "rp-numeric-b1d1-delete-26";
const CHAR_NAME = "B1D1 Turn Delete Route Canary";

const def: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 20,
  integer: true,
  maxIncreasePerTurn: 20,
  maxDecreasePerTurn: 20,
};

const PILOT_WIDGET = {
  version: 1 as const,
  name: "B1-D1 Delete Canary Widget",
  placement: "bottom" as const,
  htmlTemplate: `<div class="sw-pilot">
<div>호감도: {{호감도}}</div>
<div>신뢰: {{신뢰}}</div>
<div>오염도: {{오염도}}</div>
</div>`,
  fields: [
    {
      id: "affection",
      label: "호감도",
      instruction: "현재 호감도를 0~100 정수로만 출력.",
      initialValue: "20",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 20,
        integer: true,
        maxIncreasePerTurn: 20,
        maxDecreasePerTurn: 20,
      },
    },
    {
      id: "trust",
      label: "신뢰",
      instruction: "현재 신뢰를 0~100 정수로만 출력.",
      initialValue: "30",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 30,
        integer: true,
        maxIncreasePerTurn: 20,
        maxDecreasePerTurn: 20,
      },
    },
    {
      id: "corruption",
      label: "오염도",
      instruction: "현재 오염도를 0~100 정수로만 출력.",
      initialValue: "0",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 0,
        integer: true,
        maxIncreasePerTurn: 20,
        maxDecreasePerTurn: 20,
      },
    },
  ],
};

function save(name: string, content: string | object) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    join(OUT, name),
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8"
  );
}

function cookieFromSetCookie(header: string | null): string {
  if (!header) throw new Error("no set-cookie");
  const m = /(?:^|,)\s*session=([^;]+)/i.exec(header);
  if (!m?.[1]) throw new Error(`session cookie missing: ${header.slice(0, 200)}`);
  return m[1];
}

async function ensureAuth(): Promise<{ token: string; userId: number }> {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (loginRes.ok) {
    const token = cookieFromSetCookie(loginRes.headers.get("set-cookie"));
    const me = await fetch(`${BASE}/api/auth/me`, {
      headers: { Cookie: `session=${token}` },
    });
    const meJson = (await me.json()) as { user?: { id: number }; id?: number };
    const userId = meJson.user?.id ?? meJson.id;
    if (!userId) throw new Error(`me missing id: ${JSON.stringify(meJson)}`);
    return { token, userId };
  }

  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: EMAIL,
      nickname: "b1d1-delete",
      password: PASSWORD,
      pref: null,
    }),
  });
  if (!signup.ok && signup.status !== 409) {
    throw new Error(`signup failed ${signup.status} ${await signup.text()}`);
  }
  const retry = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!retry.ok) {
    throw new Error(`login after signup failed ${retry.status} ${await retry.text()}`);
  }
  const token = cookieFromSetCookie(retry.headers.get("set-cookie"));
  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: `session=${token}` },
  });
  const meJson = (await me.json()) as { user?: { id: number }; id?: number };
  const userId = meJson.user?.id ?? meJson.id;
  if (!userId) throw new Error(`me missing id after signup`);
  return { token, userId };
}

function ensureCharacter(db: Database.Database, userId: number): number {
  const serialized = serializeStatusWidget(PILOT_WIDGET);
  const existing = db
    .prepare(
      `SELECT id FROM characters WHERE name=? AND creator_id=? AND visibility='private' LIMIT 1`
    )
    .get(CHAR_NAME, userId) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE characters
       SET status_widget_json=?, status_widget_allow_user_override=0,
           moderation_status='approved', visibility='private', official=0
       WHERE id=?`
    ).run(serialized, existing.id);
    return existing.id;
  }
  const row = db
    .prepare(
      `INSERT INTO characters
       (name, tagline, description, greeting, system_prompt, creator_id,
        visibility, moderation_status, official, status_widget_json,
        status_widget_allow_user_override)
       VALUES (?, 'b1d1', 'turn delete canary', '안녕', 'canary', ?,
               'private', 'approved', 0, ?, 0)`
    )
    .run(CHAR_NAME, userId, serialized);
  return Number(row.lastInsertRowid);
}

function insertMsg(
  db: Database.Database,
  chatId: number,
  role: "user" | "assistant",
  content: string,
  statusJson = ""
): number {
  const row = db
    .prepare(
      `INSERT INTO messages
       (chat_id, role, content, model, status_widget_values_json, alternates, active_variant, generation_status)
       VALUES (?, ?, ?, 'test-no-llm', ?, '[]', 0, 'completed')`
    )
    .run(chatId, role, content, statusJson);
  return Number(row.lastInsertRowid);
}

function seedNumericChat(
  db: Database.Database,
  opts: { userId: number; characterId: number; label: string }
): {
  chatId: number;
  predAssistantId: number;
  latestUserId: number;
  latestAssistantId: number;
  predecessorAffection: number;
  latestAffection: number;
} {
  ensureRpNumericStateTables(db);
  ensureStatusWidgetTriggerTables(db);
  ensureEpisodicMemoryFactsTable(db);

  const chat = db
    .prepare(
      `INSERT INTO chats (user_id, character_id, mode, memory)
       VALUES (?, ?, 'safe', ?)`
    )
    .run(opts.userId, opts.characterId, `b1d1-delete-canary:${opts.label}`);
  const chatId = Number(chat.lastInsertRowid);

  bootstrapNumericStateCurrentCore(db, {
    chatId,
    characterId: opts.characterId,
    stateKey: "affection",
    definition: def,
    baselineValue: 20,
    mutationId: `bootstrap:${chatId}:affection:definition_initial`,
    sourceKind: "definition_initial",
  });

  insertMsg(db, chatId, "user", `${opts.label}-u1`);
  const predAssistantId = insertMsg(
    db,
    chatId,
    "assistant",
    `${opts.label}-a1`,
    JSON.stringify({ character: { affection: "35" } })
  );
  commitNumericStateProposalCore(db, {
    chatId,
    characterId: opts.characterId,
    stateKey: "affection",
    definition: def,
    proposal: 35,
    mutationId: `gen:${predAssistantId}:0:${opts.label}-t1`,
    sourceKind: "extractor",
    assistantMessageId: predAssistantId,
    generationSequence: 0,
    requestId: `${opts.label}-t1`,
    sourceTurn: 1,
  });

  const latestUserId = insertMsg(db, chatId, "user", `${opts.label}-u2`);
  const latestAssistantId = insertMsg(
    db,
    chatId,
    "assistant",
    `${opts.label}-a2`,
    JSON.stringify({ character: { affection: "40" } })
  );
  commitNumericStateProposalCore(db, {
    chatId,
    characterId: opts.characterId,
    stateKey: "affection",
    definition: def,
    proposal: 40,
    mutationId: `gen:${latestAssistantId}:0:${opts.label}-t2`,
    sourceKind: "extractor",
    assistantMessageId: latestAssistantId,
    generationSequence: 0,
    requestId: `${opts.label}-t2`,
    sourceTurn: 2,
  });

  db.prepare(
    `INSERT INTO episodic_memory_facts
     (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (?, ?, ?, 2, 'preference', 'user', 'x', 'y', 'important', 'latest fact', ?)`
  ).run(
    chatId,
    opts.characterId,
    opts.userId,
    JSON.stringify({ assistant_message_id: latestAssistantId })
  );
  db.prepare(
    `INSERT INTO status_trigger_events
     (chat_id, character_id, trigger_id, source_message_id, source_turn, event_key, effect_text, is_consumed)
     VALUES (?, ?, 'trig-latest', ?, 2, 'ek', 'fx', 0)`
  ).run(chatId, opts.characterId, latestAssistantId);

  return {
    chatId,
    predAssistantId,
    latestUserId,
    latestAssistantId,
    predecessorAffection: 35,
    latestAffection: 40,
  };
}

async function main() {
  const health = await fetch(`${BASE}/api/auth/me`).catch(() => null);
  if (!health) {
    throw new Error(`server not reachable at ${BASE}`);
  }

  const { token, userId } = await ensureAuth();
  const db = new Database(DB_PATH);
  db.pragma("busy_timeout = 5000");
  db.prepare(
    `UPDATE users SET is_admin=1, is_adult=1, points=CASE WHEN points < 50000 THEN 50000 ELSE points END WHERE id=?`
  ).run(userId);
  const characterId = ensureCharacter(db, userId);

  const widget = parseStatusWidgetJson(
    (
      db
        .prepare(`SELECT status_widget_json AS j FROM characters WHERE id=?`)
        .get(characterId) as { j: string }
    ).j
  );
  if (!widget?.fields?.some((f) => f.numericState)) {
    throw new Error("character missing numericState pilot fields");
  }

  // --- happy path DELETE (LLM calls = 0) ---
  const seeded = seedNumericChat(db, {
    userId,
    characterId,
    label: `ok-${Date.now()}`,
  });
  const beforeCurrent = getNumericStateCurrent(db, seeded.chatId, "affection");
  if (beforeCurrent?.numericValue !== 40) {
    throw new Error(`pre-delete tip expected 40 got ${beforeCurrent?.numericValue}`);
  }

  const delRes = await fetch(`${BASE}/api/chat/turn`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      chatId: seeded.chatId,
      expectedAssistantMessageId: seeded.latestAssistantId,
    }),
  });
  const delBody = await delRes.text();
  if (delRes.status !== 200) {
    throw new Error(`DELETE expected 200 got ${delRes.status}: ${delBody}`);
  }

  const afterCurrent = getNumericStateCurrent(db, seeded.chatId, "affection");
  const remainingMsgs = db
    .prepare(`SELECT id, role FROM messages WHERE chat_id=? ORDER BY id`)
    .all(seeded.chatId) as Array<{ id: number; role: string }>;
  const targetEvents = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM rp_numeric_state_events
         WHERE chat_id=? AND assistant_message_id=?`
      )
      .get(seeded.chatId, seeded.latestAssistantId) as { c: number }
  ).c;
  const episodic = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM episodic_memory_facts
         WHERE chat_id=?
           AND json_extract(metadata, '$.assistant_message_id') = ?`
      )
      .get(seeded.chatId, seeded.latestAssistantId) as { c: number }
  ).c;
  const triggers = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM status_trigger_events
         WHERE chat_id=? AND source_message_id=?`
      )
      .get(seeded.chatId, seeded.latestAssistantId) as { c: number }
  ).c;
  const latestStatus = parseStoredStatusWidgetValuesJson(
    (
      db
        .prepare(
          `SELECT status_widget_values_json AS v FROM messages WHERE id=?`
        )
        .get(seeded.predAssistantId) as { v: string }
    ).v
  );

  const happy = {
    http: delRes.status,
    deletedIds: JSON.parse(delBody) as { ok: boolean; deletedIds: number[] },
    remainingMessageIds: remainingMsgs.map((m) => m.id),
    numericCurrent: afterCurrent?.numericValue ?? null,
    predecessorExpected: seeded.predecessorAffection,
    targetAssistantEvents: targetEvents,
    episodicFacts: episodic,
    triggerEvents: triggers,
    remainingLatestStatusAffection: latestStatus?.character?.affection ?? null,
    llmCalls: 0,
  };

  if (afterCurrent?.numericValue !== seeded.predecessorAffection) {
    throw new Error(
      `numeric current ${afterCurrent?.numericValue} != predecessor ${seeded.predecessorAffection}`
    );
  }
  if (
    remainingMsgs.some((m) => m.id === seeded.latestUserId) ||
    remainingMsgs.some((m) => m.id === seeded.latestAssistantId)
  ) {
    throw new Error("latest messages still present after delete");
  }
  if (targetEvents !== 0 || episodic !== 0 || triggers !== 0) {
    throw new Error(
      `cleanup incomplete events=${targetEvents} episodic=${episodic} triggers=${triggers}`
    );
  }
  if (String(afterCurrent?.numericValue) !== latestStatus?.character?.affection) {
    throw new Error("remaining latest status != numeric current");
  }

  // --- mismatch → 409 ---
  const seeded2 = seedNumericChat(db, {
    userId,
    characterId,
    label: `mismatch-${Date.now()}`,
  });
  const mismatchRes = await fetch(`${BASE}/api/chat/turn`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      chatId: seeded2.chatId,
      expectedAssistantMessageId: seeded2.latestAssistantId + 99999,
    }),
  });
  const mismatchBody = await mismatchRes.text();
  let mismatchCode: string | null = null;
  try {
    mismatchCode = (JSON.parse(mismatchBody) as { code?: string }).code ?? null;
  } catch {
    mismatchCode = null;
  }
  if (mismatchRes.status !== 409 || mismatchCode !== "turn_delete_target_changed") {
    throw new Error(
      `mismatch expected 409 turn_delete_target_changed got ${mismatchRes.status} ${mismatchBody}`
    );
  }
  const mismatchStillThere = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM messages WHERE chat_id=?`)
      .get(seeded2.chatId) as { c: number }
  ).c;
  if (mismatchStillThere !== 4) {
    throw new Error(`mismatch path mutated messages count=${mismatchStillThere}`);
  }

  const report = {
    route_DELETE_canary: "PASS",
    route_delete_LLM_calls: 0,
    expectedAssistantMessageId_mismatch: "409 PASS",
    happy,
    mismatch: {
      http: mismatchRes.status,
      code: mismatchCode,
      messagesUnchanged: mismatchStillThere === 4,
    },
    characterId,
    userId,
    RP_NUMERIC_STATE_ENABLED: process.env.RP_NUMERIC_STATE_ENABLED ?? "(unset in canary process)",
  };
  save("ROUTE_DELETE_CANARY.json", report);
  console.log(JSON.stringify(report, null, 2));
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
