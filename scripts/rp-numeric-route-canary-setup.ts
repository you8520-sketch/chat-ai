/**
 * Phase B1-C.1 — prepare private admin user + character for TRUE route canary.
 * Requires local server on :3000 (numeric flags may be OFF).
 *
 * Prints JSON with user_id / character_id for server allowlist restart.
 */
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { serializeStatusWidget } from "../src/lib/statusWidget";

loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://127.0.0.1:3000";
const DB_PATH = process.env.SMOKE_DB_PATH ?? "data/app.db";
const EMAIL =
  process.env.B1C_ROUTE_ADMIN_EMAIL ?? "rp.numeric.b1c.route@example.com";
const PASSWORD =
  process.env.B1C_ROUTE_ADMIN_PASSWORD ?? "rp-numeric-b1c-route-26";
const CHAR_NAME = "B1C Numeric Route Canary";

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

function cookieFromSetCookie(header: string | null): string {
  if (!header) throw new Error("no set-cookie");
  const m = /(?:^|,)\s*session=([^;]+)/i.exec(header);
  if (!m?.[1]) throw new Error(`session cookie missing`);
  return m[1];
}

async function main() {
  let token: string | null = null;
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.ok) {
    token = cookieFromSetCookie(login.headers.get("set-cookie"));
  } else {
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
      throw new Error(`login failed ${retry.status} ${await retry.text()}`);
    }
    token = cookieFromSetCookie(retry.headers.get("set-cookie"));
  }

  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: `session=${token}` },
  });
  const meJson = (await me.json()) as { user?: { id: number }; id?: number };
  const userId = meJson.user?.id ?? meJson.id;
  if (!userId) throw new Error("missing user id");

  const db = new Database(DB_PATH);
  db.prepare(
    `UPDATE users SET is_admin=1, is_adult=1, points=CASE WHEN points < 50000 THEN 50000 ELSE points END WHERE id=?`
  ).run(userId);

  const serialized = serializeStatusWidget(PILOT_WIDGET);
  const existing = db
    .prepare(
      `SELECT id FROM characters WHERE name=? AND creator_id=? AND visibility='private' LIMIT 1`
    )
    .get(CHAR_NAME, userId) as { id: number } | undefined;
  let characterId: number;
  if (existing) {
    db.prepare(
      `UPDATE characters
       SET status_widget_json=?, status_widget_allow_user_override=0,
           greeting=?, system_prompt=?, tagline=?, description=?,
           moderation_status='approved', visibility='private', official=0
       WHERE id=?`
    ).run(
      serialized,
      "테스트 캐릭터가 조용히 고개를 끄덕였다. \"오늘은 무엇을 이야기할까.\"",
      "당신은 관찰용 테스트 NPC다. 짧고 명확한 한국어로 응답한다. 상태 수치 메타 언급 금지.",
      "B1-C route canary 전용 (private)",
      "Admin-only B1-C route canary character. Not a production listing.",
      existing.id
    );
    characterId = existing.id;
  } else {
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
        userId,
        "b1c-route",
        "private",
        "approved",
        serialized,
        0,
        "character"
      );
    characterId = Number(info.lastInsertRowid);
  }
  db.close();

  const out = {
    user_id: userId,
    character_id: characterId,
    email: EMAIL,
    env: {
      RP_NUMERIC_STATE_ENABLED: "1",
      RP_NUMERIC_STATE_KILL_SWITCH: "0",
    },
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
