/**
 * Phase B1-D2 — PATCH /api/chat/message/variant route canary (LLM=0).
 *
 * Seeds A/B/C/D numeric variants on latest frontier assistant, then:
 *   PATCH B → A → C → B
 *   DELETE turn
 *
 * Usage (server must already be running with ENABLED=1):
 *   RP_NUMERIC_STATE_ENABLED=1 RP_NUMERIC_STATE_KILL_SWITCH=0 npm run dev
 *   node --conditions=react-server --import tsx scripts/rp-numeric-variant-switch-route-canary.ts
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
import {
  ensureStatusWidgetTriggerTables,
  evaluateStatusWidgetTriggers,
  insertStatusWidgetTriggerForTest,
} from "../src/lib/statusWidgetTriggers";
import {
  bootstrapNumericStateCurrentCore,
  commitNumericStateProposalCore,
  commitNumericStateReplacementCore,
  ensureRpNumericStateTables,
  getNumericStateCurrent,
  getNumericStateEventById,
} from "../src/lib/rpNumericState";
import { parseStoredStatusWidgetValuesJson } from "../src/lib/statusWidget/parseValues";
import type { MessageVariant } from "../src/lib/messageAlternates";

loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const DB_PATH = process.env.SMOKE_DB_PATH ?? "data/app.db";
const OUT =
  process.env.OUT_DIR ?? "docs/audits/rp-numeric-state-variant-b1d2";
const EMAIL =
  process.env.B1D2_ROUTE_VARIANT_EMAIL ?? "rp.numeric.b1d2.variant@example.com";
const PASSWORD =
  process.env.B1D2_ROUTE_VARIANT_PASSWORD ?? "rp-numeric-b1d2-variant-26";
const CHAR_NAME = "B1D2 Variant Switch Route Canary";

const def: ServerMeterNumericStateDefinitionV1 = {
  version: 1,
  mode: "server_meter",
  min: 0,
  max: 100,
  initial: 20,
  integer: true,
  maxIncreasePerTurn: 50,
  maxDecreasePerTurn: 50,
};

const PILOT_WIDGET = {
  version: 1 as const,
  name: "B1-D2 Variant Canary Widget",
  placement: "bottom" as const,
  htmlTemplate: `<div>호감도: {{호감도}}</div>`,
  fields: [
    {
      id: "affection",
      label: "호감도",
      instruction: "현재 호감도를 0~100 정수로만 출력.",
      initialValue: "20",
      numericState: { ...def, initial: 20 },
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
      nickname: "b1d2-variant",
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
       VALUES (?, 'b1d2', 'variant canary', '안녕', 'canary', ?,
               'private', 'approved', 0, ?, 0)`
    )
    .run(CHAR_NAME, userId, serialized);
  return Number(row.lastInsertRowid);
}

function makeVariants(opts?: { rawBAffection?: string }): MessageVariant[] {
  const specs = [
    { content: "A prose", affection: 35, seq: 0, req: "req-a", loc: "골목" },
    { content: "B prose", affection: 38, seq: 1, req: "req-b", loc: "창고" },
    { content: "C prose", affection: 32, seq: 2, req: "req-c", loc: "지붕" },
    { content: "D prose", affection: 41, seq: 3, req: "req-d", loc: "골목" },
  ];
  return specs.map((s) => ({
    content: s.content,
    model: "test-no-llm",
    usage: null,
    created_at: new Date().toISOString(),
    statusWidgetValues: {
      character: {
        // Raw snapshot may intentionally mismatch canonical numeric after.
        호감도:
          s.seq === 1 && opts?.rawBAffection != null
            ? opts.rawBAffection
            : String(s.affection),
        location: s.loc,
      },
      user: null,
    },
    statusWidgetTurnActive: true,
    generationSequence: s.seq,
    requestId: s.req,
  }));
}

function seedAbcdChat(
  db: Database.Database,
  opts: { userId: number; characterId: number; label: string }
): {
  chatId: number;
  assistantMessageId: number;
  variants: MessageVariant[];
  pointsBefore: number;
} {
  ensureRpNumericStateTables(db);
  ensureStatusWidgetTriggerTables(db);
  ensureEpisodicMemoryFactsTable(db);

  const chat = db
    .prepare(
      `INSERT INTO chats (user_id, character_id, mode)
       VALUES (?, ?, 'safe')`
    )
    .run(opts.userId, opts.characterId);
  const chatId = Number(chat.lastInsertRowid);

  bootstrapNumericStateCurrentCore(db, {
    chatId,
    characterId: opts.characterId,
    stateKey: "affection",
    definition: def,
    baselineValue: 30,
    mutationId: `bootstrap:${chatId}:affection:definition_initial`,
    sourceKind: "definition_initial",
  });

  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, generation_status)
     VALUES (?, 'user', ?, '', 'completed')`
  ).run(chatId, `${opts.label}-u-prev`);
  db.prepare(
    `INSERT INTO messages
     (chat_id, role, content, model, status_widget_values_json, generation_status)
     VALUES (?, 'assistant', ?, 'test-no-llm', ?, 'completed')`
  ).run(chatId, `${opts.label}-a-prev`, JSON.stringify({ character: { 호감도: "30" } }));

  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, generation_status)
     VALUES (?, 'user', ?, '', 'completed')`
  ).run(chatId, `${opts.label}-u-latest`);

  // B raw status snapshot intentionally "80" while numeric extractor after=38.
  const variants = makeVariants({ rawBAffection: "80" });
  const ins = db
    .prepare(
      `INSERT INTO messages
       (chat_id, role, content, model, status_widget_values_json, alternates,
        active_variant, generation_status)
       VALUES (?, 'assistant', ?, 'test-no-llm', ?, ?, 3, 'completed')`
    )
    .run(
      chatId,
      "D prose",
      JSON.stringify(variants[3]!.statusWidgetValues),
      JSON.stringify(variants)
    );
  const assistantMessageId = Number(ins.lastInsertRowid);

  const proposals = [
    { seq: 0, v: 35, req: "req-a" },
    { seq: 1, v: 38, req: "req-b" },
    { seq: 2, v: 32, req: "req-c" },
    { seq: 3, v: 41, req: "req-d" },
  ];
  for (const p of proposals) {
    if (p.seq === 0) {
      commitNumericStateProposalCore(db, {
        chatId,
        characterId: opts.characterId,
        stateKey: "affection",
        definition: def,
        proposal: p.v,
        mutationId: `gen:${assistantMessageId}:${p.seq}:${p.req}`,
        sourceKind: "extractor",
        assistantMessageId,
        generationSequence: p.seq,
        requestId: p.req,
        sourceTurn: 2,
      });
    } else {
      commitNumericStateReplacementCore(db, {
        chatId,
        characterId: opts.characterId,
        stateKey: "affection",
        definition: def,
        proposal: p.v,
        mutationId: `gen:${assistantMessageId}:${p.seq}:${p.req}`,
        sourceKind: "extractor",
        assistantMessageId,
        generationSequence: p.seq,
        requestId: p.req,
        sourceTurn: 2,
      });
    }
  }

  db.prepare(
    `INSERT INTO episodic_memory_facts
     (chat_id, character_id, user_id, source_turn, category, subject, attribute, value, importance, fact_text, metadata)
     VALUES (?, ?, ?, 2, 'relationship', 'user', 'scene_d', 'alley', 'important',
             '사용자는 골목에서 분노를 드러냈다.', ?)`
  ).run(
    chatId,
    opts.characterId,
    opts.userId,
    JSON.stringify({
      assistant_message_id: assistantMessageId,
      request_id: "req-d",
    })
  );

  insertStatusWidgetTriggerForTest(db, {
    character_id: opts.characterId,
    trigger_id: `aff40_${chatId}`,
    status_key: "호감도",
    operator: ">=",
    value: 40,
    fire_once: true,
    event_key: "aff_high",
    effect_text: "호감 임계",
  });
  evaluateStatusWidgetTriggers(db, {
    chatId,
    characterId: opts.characterId,
    sourceTurn: 2,
    statusValues: variants[3]!.statusWidgetValues!,
    sourceMessageId: assistantMessageId,
    requestId: "req-d",
    generationSequence: 3,
  });

  const pointsBefore = (
    db.prepare(`SELECT points AS p FROM users WHERE id=?`).get(opts.userId) as {
      p: number;
    }
  ).p;

  return { chatId, assistantMessageId, variants, pointsBefore };
}

async function patchVariant(
  token: string,
  messageId: number,
  variantIndex: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/chat/message/variant`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ messageId, variantIndex }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

function assertParity(
  db: Database.Database,
  opts: {
    chatId: number;
    messageId: number;
    variantIndex: number;
    expectedContent: string;
    expectedAffection: number;
    expectedLocation: string;
    expectedBaseline: number;
    revFloor: number;
  }
): { revision: number; selectionEventId: number } {
  const msg = db
    .prepare(
      `SELECT content, active_variant, status_widget_values_json AS v FROM messages WHERE id=?`
    )
    .get(opts.messageId) as {
    content: string;
    active_variant: number;
    v: string;
  };
  if (msg.content !== opts.expectedContent) {
    throw new Error(`content ${msg.content} != ${opts.expectedContent}`);
  }
  if (msg.active_variant !== opts.variantIndex) {
    throw new Error(`active_variant ${msg.active_variant} != ${opts.variantIndex}`);
  }
  const status = parseStoredStatusWidgetValuesJson(msg.v);
  if (status?.character?.호감도 !== String(opts.expectedAffection)) {
    throw new Error(
      `status affection ${status?.character?.호감도} != ${opts.expectedAffection}`
    );
  }
  if (status?.character?.location !== opts.expectedLocation) {
    throw new Error(
      `status location ${status?.character?.location} != ${opts.expectedLocation}`
    );
  }
  const cur = getNumericStateCurrent(db, opts.chatId, "affection");
  if (!cur || cur.numericValue !== opts.expectedAffection) {
    throw new Error(`numeric current ${cur?.numericValue} != ${opts.expectedAffection}`);
  }
  if (cur.revision <= opts.revFloor) {
    throw new Error(`revision not monotonic: ${cur.revision} <= ${opts.revFloor}`);
  }
  const tip = getNumericStateEventById(db, cur.lastEventId!);
  if (!tip || tip.sourceKind !== "variant_switch") {
    throw new Error(`tip sourceKind ${tip?.sourceKind} != variant_switch`);
  }
  if (tip.beforeValue !== opts.expectedBaseline || tip.afterValue !== opts.expectedAffection) {
    throw new Error(
      `selection before/after ${tip.beforeValue}/${tip.afterValue} != ${opts.expectedBaseline}/${opts.expectedAffection}`
    );
  }
  const genCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM rp_numeric_state_events
         WHERE chat_id=? AND assistant_message_id=? AND source_kind='extractor'`
      )
      .get(opts.chatId, opts.messageId) as { c: number }
  ).c;
  if (genCount !== 4) {
    throw new Error(`expected 4 preserved generation events, got ${genCount}`);
  }
  return { revision: cur.revision, selectionEventId: tip.id };
}

async function main() {
  const health = await fetch(`${BASE}/api/auth/me`).catch(() => null);
  if (!health) throw new Error(`server not reachable at ${BASE}`);

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

  const seeded = seedAbcdChat(db, {
    userId,
    characterId,
    label: `v-${Date.now()}`,
  });
  const tipBefore = getNumericStateCurrent(db, seeded.chatId, "affection")!;
  if (tipBefore.numericValue !== 41) {
    throw new Error(`pre-switch tip expected 41 got ${tipBefore.numericValue}`);
  }

  const sequence = [
    { idx: 1, content: "B prose", aff: 38, loc: "창고" },
    { idx: 0, content: "A prose", aff: 35, loc: "골목" },
    { idx: 2, content: "C prose", aff: 32, loc: "지붕" },
    { idx: 1, content: "B prose", aff: 38, loc: "창고" },
  ];

  const patchResults: Array<Record<string, unknown>> = [];
  let revFloor = tipBefore.revision;
  let routeResponseCanonicalParity = "PASS";
  for (const step of sequence) {
    const res = await patchVariant(token, seeded.assistantMessageId, step.idx);
    if (res.status !== 200) {
      throw new Error(
        `PATCH ${step.idx} expected 200 got ${res.status}: ${JSON.stringify(res.body)}`
      );
    }
    const bodyVariants = res.body.variants as
      | Array<{
          statusWidgetValues?: { character?: Record<string, string> };
          content?: string;
        }>
      | undefined;
    const bodyActive = Number(res.body.activeVariant);
    const httpAff =
      bodyVariants?.[step.idx]?.statusWidgetValues?.character?.호감도 ?? null;
    if (bodyActive !== step.idx) {
      routeResponseCanonicalParity = "FAIL";
      throw new Error(
        `HTTP activeVariant ${bodyActive} != ${step.idx} (ROUTE_RESPONSE_CANONICAL_PARITY)`
      );
    }
    if (httpAff !== String(step.aff)) {
      routeResponseCanonicalParity = "FAIL";
      throw new Error(
        `HTTP variants[${step.idx}].statusWidgetValues.character.호감도=${httpAff} != ${step.aff} (must not leak raw snapshot 80)`
      );
    }
    if (bodyVariants?.[step.idx]?.content !== step.content) {
      routeResponseCanonicalParity = "FAIL";
      throw new Error(
        `HTTP content mismatch for variant ${step.idx}: ${bodyVariants?.[step.idx]?.content}`
      );
    }
    const parity = assertParity(db, {
      chatId: seeded.chatId,
      messageId: seeded.assistantMessageId,
      variantIndex: step.idx,
      expectedContent: step.content,
      expectedAffection: step.aff,
      expectedLocation: step.loc,
      expectedBaseline: 30,
      revFloor,
    });
    revFloor = parity.revision;
    patchResults.push({
      variantIndex: step.idx,
      http: res.status,
      revision: parity.revision,
      selectionEventId: parity.selectionEventId,
      content: step.content,
      affection: step.aff,
      httpAffection: httpAff,
    });
  }

  // Race fixture: A/B/C/D → append E as active → select B; E must survive.
  const raceSeed = seedAbcdChat(db, {
    userId,
    characterId,
    label: `race-e-${Date.now()}`,
  });
  const raceRow = db
    .prepare(`SELECT alternates AS a FROM messages WHERE id=?`)
    .get(raceSeed.assistantMessageId) as { a: string };
  const raceVariants = JSON.parse(raceRow.a) as MessageVariant[];
  const eVariant: MessageVariant = {
    content: "E prose",
    model: "test-no-llm",
    usage: null,
    created_at: new Date().toISOString(),
    statusWidgetValues: {
      character: { 호감도: "36", location: "정원" },
      user: null,
    },
    statusWidgetTurnActive: true,
    generationSequence: 4,
    requestId: "req-e",
  };
  const withE = [...raceVariants, eVariant];
  db.prepare(
    `UPDATE messages SET content=?, alternates=?, active_variant=?, status_widget_values_json=? WHERE id=?`
  ).run(
    eVariant.content,
    JSON.stringify(withE),
    4,
    JSON.stringify(eVariant.statusWidgetValues),
    raceSeed.assistantMessageId
  );
  commitNumericStateReplacementCore(db, {
    chatId: raceSeed.chatId,
    characterId,
    stateKey: "affection",
    definition: def,
    proposal: 36,
    mutationId: `gen:${raceSeed.assistantMessageId}:4:req-e`,
    sourceKind: "extractor",
    assistantMessageId: raceSeed.assistantMessageId,
    generationSequence: 4,
    requestId: "req-e",
    sourceTurn: 2,
  });
  const racePatch = await patchVariant(token, raceSeed.assistantMessageId, 1);
  if (racePatch.status !== 200) {
    throw new Error(
      `race E→B PATCH expected 200 got ${racePatch.status}: ${JSON.stringify(racePatch.body)}`
    );
  }
  const raceStored = JSON.parse(
    (
      db
        .prepare(`SELECT alternates AS a, active_variant AS av FROM messages WHERE id=?`)
        .get(raceSeed.assistantMessageId) as { a: string; av: number }
    ).a
  ) as MessageVariant[];
  const raceActive = (
    db
      .prepare(`SELECT active_variant AS av FROM messages WHERE id=?`)
      .get(raceSeed.assistantMessageId) as { av: number }
  ).av;
  if (raceStored.length !== 5 || raceActive !== 1) {
    throw new Error(
      `race fixture failed: variants=${raceStored.length} active=${raceActive}`
    );
  }
  if (getNumericStateCurrent(db, raceSeed.chatId, "affection")?.numericValue !== 38) {
    throw new Error("race fixture numeric current != 38 after B select");
  }

  // Active D triggers should be superseded; B (38) should not leave active >=40 event.
  const activeTriggers = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM status_trigger_events
         WHERE chat_id=? AND is_superseded=0`
      )
      .get(seeded.chatId) as { c: number }
  ).c;

  const pointsAfter = (
    db.prepare(`SELECT points AS p FROM users WHERE id=?`).get(userId) as {
      p: number;
    }
  ).p;
  if (pointsAfter !== seeded.pointsBefore) {
    throw new Error(
      `points mutated ${seeded.pointsBefore} → ${pointsAfter} on variant selection`
    );
  }

  // Frontier moved: insert later user then PATCH must 409
  const frontierSeed = seedAbcdChat(db, {
    userId,
    characterId,
    label: `frontier-${Date.now()}`,
  });
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, generation_status)
     VALUES (?, 'user', 'next', '', 'completed')`
  ).run(frontierSeed.chatId);
  const frontierRes = await patchVariant(token, frontierSeed.assistantMessageId, 1);
  if (
    frontierRes.status !== 409 ||
    frontierRes.body.code !== "variant_switch_frontier_moved"
  ) {
    throw new Error(
      `frontier expected 409 variant_switch_frontier_moved got ${frontierRes.status} ${JSON.stringify(frontierRes.body)}`
    );
  }
  const frontierCur = getNumericStateCurrent(db, frontierSeed.chatId, "affection");
  if (frontierCur?.numericValue !== 41) {
    throw new Error("frontier path mutated numeric current");
  }

  // DELETE after final B selection
  const delRes = await fetch(`${BASE}/api/chat/turn`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      chatId: seeded.chatId,
      expectedAssistantMessageId: seeded.assistantMessageId,
    }),
  });
  const delText = await delRes.text();
  if (delRes.status !== 200) {
    throw new Error(`DELETE expected 200 got ${delRes.status}: ${delText}`);
  }
  const afterDelete = getNumericStateCurrent(db, seeded.chatId, "affection");
  if (afterDelete?.numericValue !== 30) {
    throw new Error(
      `after delete expected baseline 30 got ${afterDelete?.numericValue}`
    );
  }
  const leftoverEvents = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM rp_numeric_state_events
         WHERE chat_id=? AND assistant_message_id=?`
      )
      .get(seeded.chatId, seeded.assistantMessageId) as { c: number }
  ).c;
  if (leftoverEvents !== 0) {
    throw new Error(`leftover numeric events after delete: ${leftoverEvents}`);
  }

  const report = {
    route_PATCH_variant_canary: "PASS",
    ROUTE_RESPONSE_CANONICAL_PARITY: routeResponseCanonicalParity,
    raw_snapshot_80_canonical_38: {
      db: 38,
      http: (patchResults[0] as { httpAffection?: string } | undefined)
        ?.httpAffection,
    },
    race_regen_E_then_select_B: {
      variantCount: raceStored.length,
      active: raceActive,
      ePreserved: raceStored[4]?.content === "E prose",
      numericCurrent: getNumericStateCurrent(db, raceSeed.chatId, "affection")
        ?.numericValue,
    },
    route_LLM_calls: 0,
    point_mutations: pointsAfter - seeded.pointsBefore,
    patchSequence: patchResults,
    activeTriggersAfterFinalB: activeTriggers,
    frontierMoved: {
      http: frontierRes.status,
      code: frontierRes.body.code ?? null,
      numericUnchanged: frontierCur?.numericValue === 41,
    },
    selectThenDelete: {
      http: delRes.status,
      numericCurrent: afterDelete?.numericValue ?? null,
      leftoverEvents,
    },
    characterId,
    chatId: seeded.chatId,
  };
  save("ROUTE_VARIANT_CANARY.json", report);
  console.log(JSON.stringify(report, null, 2));
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
