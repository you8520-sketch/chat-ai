/**
 * Phase B1-C.1 — TRUE local `/api/chat` route canary (not the in-memory harness).
 *
 * Minimal: 2 normal turns + 1 regen against production route code.
 * Local allowlist only. Does NOT touch Railway. Restores ENABLED=0 in artifacts.
 *
 * Usage (server must already be running with allowlist env):
 *   node --conditions=react-server --import tsx scripts/rp-numeric-route-canary.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import {
  parseStatusWidgetJson,
  serializeStatusWidget,
} from "../src/lib/statusWidget";
import { CLAUDE_OPUS_MODEL } from "../src/lib/chatModels";

loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const DB_PATH = process.env.SMOKE_DB_PATH ?? "data/app.db";
const OUT =
  process.env.OUT_DIR ?? "docs/audits/rp-numeric-state-canonical-b1c";
const EMAIL =
  process.env.B1C_ROUTE_ADMIN_EMAIL ?? "rp.numeric.b1c.route@example.com";
const PASSWORD =
  process.env.B1C_ROUTE_ADMIN_PASSWORD ?? "rp-numeric-b1c-route-26";
/** OpenRouter path (local has OPENROUTER_API_KEY; Gemini 3.6 coerced away; CI key absent). */
const MODEL = process.env.B1C_ROUTE_MODEL ?? CLAUDE_OPUS_MODEL;
const CHAR_NAME = "B1C Numeric Route Canary";

type ParitySnapshot = {
  turn: string;
  kind: "normal" | "regen";
  assistantMessageId: number;
  current: Record<string, number | null>;
  message: Record<string, string>;
  activeVariant: Record<string, string>;
  events: Array<{
    stateKey: string;
    eventId: number;
    before: number | null;
    after: number | null;
    replacesEventId: number | null;
  }>;
  parityOk: boolean;
  parityFailures: string[];
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
      nickname: "b1c-route",
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

const PILOT_WIDGET = {
  version: 1 as const,
  name: "B1-C Route Canary Widget",
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
      instruction:
        "현재 호감도를 0~100 정수로만 출력. 설명/단위/% 금지. 예: 20",
      initialValue: "20",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 20,
        integer: true,
        maxIncreasePerTurn: 5,
        maxDecreasePerTurn: 5,
      },
    },
    {
      id: "trust",
      label: "신뢰",
      instruction:
        "현재 신뢰를 0~100 정수로만 출력. 설명/단위/% 금지. 예: 30",
      initialValue: "30",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 30,
        integer: true,
        maxIncreasePerTurn: 5,
        maxDecreasePerTurn: 5,
      },
    },
    {
      id: "corruption",
      label: "오염도",
      instruction:
        "현재 오염도를 0~100 정수로만 출력. 설명/단위/% 금지. 예: 0",
      initialValue: "0",
      numericState: {
        version: 1 as const,
        mode: "server_meter" as const,
        min: 0,
        max: 100,
        initial: 0,
        integer: true,
        maxIncreasePerTurn: 10,
        maxDecreasePerTurn: 5,
      },
    },
  ],
};

function upsertCharacter(db: Database.Database, creatorId: number): number {
  const serialized = serializeStatusWidget(PILOT_WIDGET);
  const existing = db
    .prepare(
      `SELECT id FROM characters WHERE name=? AND creator_id=? AND visibility='private' LIMIT 1`
    )
    .get(CHAR_NAME, creatorId) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE characters
       SET status_widget_json=?,
           status_widget_allow_user_override=0,
           greeting=?,
           system_prompt=?,
           tagline=?,
           description=?,
           moderation_status='approved',
           visibility='private',
           official=0
       WHERE id=?`
    ).run(
      serialized,
      "테스트 캐릭터가 조용히 고개를 끄덕였다. \"오늘은 무엇을 이야기할까.\"",
      "당신은 관찰용 테스트 NPC다. 짧고 명확한 한국어로 응답한다. 상태 수치 메타 언급 금지.",
      "B1-C route canary 전용 (private)",
      "Admin-only B1-C route canary character. Not a production listing.",
      existing.id
    );
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO characters (
         name, tagline, description, greeting, system_prompt,
         genre, tags, nsfw, official, emoji, hue, creator_id, creator_name,
         visibility, moderation_status, status_widget_json,
         status_widget_allow_user_override, content_kind
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      CHAR_NAME,
      "B1-C route canary 전용 (private)",
      "Admin-only B1-C route canary character. Not a production listing.",
      "테스트 캐릭터가 조용히 고개를 끄덕였다. \"오늘은 무엇을 이야기할까.\"",
      "당신은 관찰용 테스트 NPC다. 짧고 명확한 한국어로 응답한다. 상태 수치 메타 언급 금지.",
      "일상",
      "[]",
      0,
      0,
      "🧪",
      210,
      creatorId,
      "b1c-route",
      "private",
      "approved",
      serialized,
      0,
      "character"
    );
  return Number(info.lastInsertRowid);
}

function promoteAdmin(db: Database.Database, userId: number) {
  db.prepare(
    `UPDATE users SET is_admin=1, is_adult=1, points=CASE WHEN points < 50000 THEN 50000 ELSE points END WHERE id=?`
  ).run(userId);
}

async function selectModel(token: string, userId: number) {
  const res = await fetch(`${BASE}/api/user/selected-ai`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: MODEL }),
  });
  if (!res.ok) {
    throw new Error(
      `selected-ai PATCH failed ${res.status} ${await res.text()} (need OPENROUTER_OPUS_USER_SELECTABLE=1 for ${MODEL})`
    );
  }
  const db = new Database(DB_PATH);
  const row = db
    .prepare(`SELECT selected_ai FROM users WHERE id=?`)
    .get(userId) as { selected_ai: string };
  db.close();
  if (row.selected_ai !== MODEL) {
    throw new Error(
      `selected_ai mismatch after PATCH: got=${row.selected_ai} want=${MODEL}`
    );
  }
}

async function enableStatusWidget(token: string, chatId: number) {
  const res = await fetch(`${BASE}/api/chat/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      chatId,
      statusWidgetDisplayMode: "creator",
      statusWidgetMode: "character_only",
      targetResponseChars: 600,
    }),
  });
  if (!res.ok) {
    throw new Error(`enable status widget failed ${res.status} ${await res.text()}`);
  }
}

async function postChat(opts: {
  token: string;
  characterId: number;
  chatId?: number;
  message?: string;
  regenerate?: boolean;
  regenerateMessageId?: number;
}): Promise<{ ok: boolean; httpStatus: number; body: string }> {
  const body: Record<string, unknown> = {
    characterId: opts.characterId,
    stream: true,
  };
  if (opts.chatId != null) body.chatId = opts.chatId;
  if (opts.regenerate) {
    body.regenerate = true;
    body.regenerateMessageId = opts.regenerateMessageId;
  } else {
    body.message = opts.message;
  }
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${opts.token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, httpStatus: res.status, body: text };
}

function latestAssistant(db: Database.Database, chatId: number): {
  id: number;
  statusJson: string;
  alternates: string;
  activeVariant: number;
} {
  const row = db
    .prepare(
      `SELECT id, status_widget_values_json, alternates, active_variant
       FROM messages WHERE chat_id=? AND role='assistant' ORDER BY id DESC LIMIT 1`
    )
    .get(chatId) as
    | {
        id: number;
        status_widget_values_json: string;
        alternates: string;
        active_variant: number;
      }
    | undefined;
  if (!row) throw new Error("no assistant");
  return {
    id: row.id,
    statusJson: row.status_widget_values_json || "",
    alternates: row.alternates || "[]",
    activeVariant: row.active_variant ?? 0,
  };
}

function parseCharacter(statusJson: string): Record<string, string> {
  if (!statusJson) return {};
  try {
    const parsed = JSON.parse(statusJson) as { character?: Record<string, string> };
    return parsed.character ?? {};
  } catch {
    return {};
  }
}

function readParity(
  db: Database.Database,
  chatId: number,
  keys: string[]
): ParitySnapshot["events"] extends never ? never : Omit<ParitySnapshot, "turn" | "kind"> {
  const asst = latestAssistant(db, chatId);
  const message = parseCharacter(asst.statusJson);
  let activeVariant: Record<string, string> = {};
  try {
    const variants = JSON.parse(asst.alternates || "[]") as Array<{
      statusWidgetValues?: { character?: Record<string, string> };
    }>;
    const v = variants[asst.activeVariant];
    activeVariant = v?.statusWidgetValues?.character ?? {};
  } catch {
    activeVariant = {};
  }

  const current: Record<string, number | null> = {};
  const events: ParitySnapshot["events"] = [];
  const failures: string[] = [];

  for (const stateKey of keys) {
    const cur = db
      .prepare(
        `SELECT numeric_value, last_event_id, last_source_message_id
         FROM rp_numeric_state_current WHERE chat_id=? AND state_key=?`
      )
      .get(chatId, stateKey) as
      | {
          numeric_value: number;
          last_event_id: number | null;
          last_source_message_id: number | null;
        }
      | undefined;
    current[stateKey] = cur?.numeric_value ?? null;
    if (!cur) {
      failures.push(`missing_current:${stateKey}`);
      continue;
    }
    if (cur.last_source_message_id !== asst.id) {
      failures.push(
        `tip_mismatch:${stateKey}:msg=${asst.id}:src=${cur.last_source_message_id}`
      );
    }
    if (cur.last_event_id == null) {
      failures.push(`missing_last_event:${stateKey}`);
      continue;
    }
    const ev = db
      .prepare(
        `SELECT id, before_value, after_value, replaces_event_id
         FROM rp_numeric_state_events WHERE id=?`
      )
      .get(cur.last_event_id) as
      | {
          id: number;
          before_value: number | null;
          after_value: number | null;
          replaces_event_id: number | null;
        }
      | undefined;
    if (!ev) {
      failures.push(`missing_event_row:${stateKey}`);
      continue;
    }
    events.push({
      stateKey,
      eventId: ev.id,
      before: ev.before_value,
      after: ev.after_value,
      replacesEventId: ev.replaces_event_id,
    });
    // Status widget stores by placeholder key (label) when present — also accept stateKey.
    const labelByKey: Record<string, string> = {
      affection: "호감도",
      trust: "신뢰",
      corruption: "오염도",
    };
    const label = labelByKey[stateKey] ?? stateKey;
    const msgResolved = message[stateKey] ?? message[label] ?? null;
    const varResolved =
      activeVariant[stateKey] ?? activeVariant[label] ?? null;
    const curStr = String(Math.trunc(cur.numeric_value));
    if (msgResolved !== curStr) {
      failures.push(
        `message_parity:${stateKey}:msg=${msgResolved}:cur=${curStr}`
      );
    }
    if (varResolved !== curStr) {
      failures.push(
        `variant_parity:${stateKey}:var=${varResolved}:cur=${curStr}`
      );
    }
  }

  return {
    assistantMessageId: asst.id,
    current,
    message,
    activeVariant,
    events,
    parityOk: failures.length === 0,
    parityFailures: failures,
  };
}

async function waitHealthy(timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/auth/me`);
      if (res.status === 200 || res.status === 401) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`server not healthy at ${BASE}`);
}

async function main() {
  await waitHealthy();
  const auth = await ensureAuth();

  const db = new Database(DB_PATH);
  promoteAdmin(db, auth.userId);
  const characterId = upsertCharacter(db, auth.userId);
  const widget = parseStatusWidgetJson(
    (
      db
        .prepare(`SELECT status_widget_json FROM characters WHERE id=?`)
        .get(characterId) as { status_widget_json: string }
    ).status_widget_json
  );
  if (!widget) throw new Error("widget missing after upsert");
  const keys = ["affection", "trust", "corruption"];
  db.close();

  // Caller must start the server with these allowlists. Record expected config.
  const expectedEnv = {
    RP_NUMERIC_STATE_ENABLED: "1",
    RP_NUMERIC_STATE_ALLOWLIST_USERS: String(auth.userId),
    RP_NUMERIC_STATE_ALLOWLIST_CHARACTERS: String(characterId),
    RP_NUMERIC_STATE_KILL_SWITCH: "0",
  };

  await selectModel(auth.token, auth.userId);

  // Create chat + greeting in DB (no LLM). Enable status widget before any route turn.
  const dbSetup = new Database(DB_PATH);
  const chatInsert = dbSetup
    .prepare(
      `INSERT INTO chats (
         user_id, character_id, mode, gemini_model, user_note,
         selected_persona_id, user_impersonation, target_response_chars,
         memory_capacity, status_widget_mode, status_widget_display_mode
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      auth.userId,
      characterId,
      "safe",
      MODEL,
      "",
      null,
      0,
      600,
      10000,
      "character_only",
      "creator"
    );
  const chatId = Number(chatInsert.lastInsertRowid);
  dbSetup
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
    )
    .run(
      chatId,
      "assistant",
      "테스트 캐릭터가 조용히 고개를 끄덕였다. \"오늘은 무엇을 이야기할까.\"",
      "greeting"
    );
  dbSetup.close();

  // Ensure settings endpoint also sees creator mode (idempotent).
  await enableStatusWidget(auth.token, chatId);

  const turns: ParitySnapshot[] = [];
  let parityFailures = 0;

  for (const [label, message] of [
    ["N1", "날씨가 괜찮네. 별일 없으면 잠깐 앉아 있을까."],
    [
      "N2",
      "네가 먼저 따뜻한 차를 건네줘서 고마워. 그 배려가 진심으로 고마웠어.",
    ],
  ] as const) {
    const res = await postChat({
      token: auth.token,
      characterId,
      chatId,
      message,
    });
    if (!res.ok) {
      throw new Error(`${label} failed ${res.httpStatus} ${res.body.slice(0, 500)}`);
    }
    const dbTurn = new Database(DB_PATH);
    const asst = latestAssistant(dbTurn, chatId);
    const gen = dbTurn
      .prepare(`SELECT generation_status, length(content) AS len FROM messages WHERE id=?`)
      .get(asst.id) as { generation_status: string; len: number };
    if (gen.generation_status !== "completed" || gen.len <= 0) {
      dbTurn.close();
      throw new Error(
        `${label} assistant not completed status=${gen.generation_status} len=${gen.len}`
      );
    }
    const snap = readParity(dbTurn, chatId, keys);
    dbTurn.close();
    const record: ParitySnapshot = { turn: label, kind: "normal", ...snap };
    turns.push(record);
    if (!record.parityOk) parityFailures += record.parityFailures.length;
  }

  const preRegenBaseline = { ...turns[turns.length - 1]!.current };
  const preRegenEvents = turns[turns.length - 1]!.events.map((e) => ({
    stateKey: e.stateKey,
    eventId: e.eventId,
    before: e.before,
  }));
  const regenTargetId = turns[turns.length - 1]!.assistantMessageId;

  const regen = await postChat({
    token: auth.token,
    characterId,
    chatId,
    regenerate: true,
    regenerateMessageId: regenTargetId,
  });
  if (!regen.ok) {
    throw new Error(`R1 failed ${regen.httpStatus} ${regen.body.slice(0, 500)}`);
  }

  const dbRegen = new Database(DB_PATH);
  const regenSnap = readParity(dbRegen, chatId, keys);
  dbRegen.close();
  const regenRecord: ParitySnapshot = {
    turn: "R1",
    kind: "regen",
    ...regenSnap,
  };
  turns.push(regenRecord);
  if (!regenRecord.parityOk) parityFailures += regenRecord.parityFailures.length;

  // Regen replacement checks
  const regenChecks: string[] = [];
  for (const ev of regenRecord.events) {
    const prior = preRegenEvents.find((p) => p.stateKey === ev.stateKey);
    const baseline = preRegenBaseline[ev.stateKey];
    if (prior == null || baseline == null) {
      regenChecks.push(`missing_prior:${ev.stateKey}`);
      continue;
    }
    // B.before == original turn pre-turn baseline == A.before (replacement semantics)
    // For APPLIED regen, before must equal replaced event's before_value.
    if (ev.replacesEventId !== prior.eventId) {
      regenChecks.push(
        `replaces_mismatch:${ev.stateKey}:got=${ev.replacesEventId}:want=${prior.eventId}`
      );
    }
    if (ev.before !== prior.before) {
      regenChecks.push(
        `before_mismatch:${ev.stateKey}:got=${ev.before}:want=${prior.before}`
      );
    }
  }
  parityFailures += regenChecks.length;

  const routePass =
    parityFailures === 0 &&
    turns.filter((t) => t.kind === "normal").length >= 2 &&
    turns.some((t) => t.kind === "regen");

  const summary = {
    TRUE_ROUTE_CANARY: routePass ? "PASS" : "FAIL",
    B1_C_ROUTE_CANARY_PASS: routePass,
    model: MODEL,
    normal_turns: turns.filter((t) => t.kind === "normal").length,
    regen_turns: turns.filter((t) => t.kind === "regen").length,
    parity_failures: parityFailures,
    regen_checks: regenChecks,
    user_id: auth.userId,
    character_id: characterId,
    chat_id: chatId,
    expected_server_env: expectedEnv,
    post_canary_restore: {
      RP_NUMERIC_STATE_ENABLED: "0",
      railway: "UNCHANGED",
    },
    turns,
  };

  save("ROUTE_CANARY_TURNS.json", summary);
  save(
    "ROUTE_CANARY_VERDICT.md",
    [
      "# Phase B1-C.1 — True `/api/chat` Route Canary",
      "",
      `- Status: **${summary.TRUE_ROUTE_CANARY}**`,
      `- Model: ${MODEL}`,
      `- Normal turns: ${summary.normal_turns}`,
      `- Regen turns: ${summary.regen_turns}`,
      `- Parity failures: ${summary.parity_failures}`,
      `- User: ${auth.userId}`,
      `- Character: ${characterId} (private)`,
      `- Chat: ${chatId}`,
      "",
      "Method: live HTTP `POST /api/chat` against local app.",
      "In-memory `executeAtomicNumericAssistantFinalize` harness is **not** this canary",
      "(see CORE_CANONICAL_HARNESS / `FINAL_CANARY_VERDICT.md`).",
      "",
      "Post-canary: `RP_NUMERIC_STATE_ENABLED=0` restored for default local config.",
      "Railway: UNCHANGED.",
      "",
    ].join("\n")
  );

  console.log(
    JSON.stringify(
      {
        ok: routePass,
        model: MODEL,
        normal_turns: summary.normal_turns,
        regen_turns: summary.regen_turns,
        parity_failures: parityFailures,
        regen_checks: regenChecks,
        user_id: auth.userId,
        character_id: characterId,
        chat_id: chatId,
      },
      null,
      2
    )
  );
  if (!routePass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
