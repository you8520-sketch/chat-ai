/**
 * CLOSED_ADULT_TEST_MODE eligibility/routing smoke (not a model quality bakeoff).
 *
 * Adult visibility ON  → general / adult entry / sticky / exit models as expected
 * Adult visibility OFF → DeepSeek adult handoff NOT USED
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();

const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const OUT =
  process.env.SMOKE_OUT ??
  "/opt/cursor/artifacts/adult-handoff-closed-test-eligibility";
const GENERAL_MODEL = process.env.SMOKE_GENERAL_MODEL ?? "gpt-5.6-terra";
const CHARACTER_ID = Number(process.env.SMOKE_CHARACTER_ID ?? "6");
const EMAIL =
  process.env.SMOKE_EMAIL ??
  `closed.adult.test.${Date.now().toString(36)}@example.com`;
const PASSWORD = process.env.SMOKE_PASSWORD ?? "closed-adult-test-26";
const DB_PATH = process.env.SMOKE_DB_PATH ?? "data/app.db";

mkdirSync(OUT, { recursive: true });

function save(name: string, content: string | object) {
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

async function signupOrLogin(): Promise<{ token: string; userId: number }> {
  let token: string | null = null;
  const signup = await fetch(`${BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      nickname: "closed_adult",
      pref: "male",
    }),
  });
  if (signup.ok) {
    token = cookieFromSetCookie(signup.headers.get("set-cookie"));
  } else if (signup.status !== 409) {
    throw new Error(`signup failed ${signup.status} ${await signup.text()}`);
  }
  if (!token) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login failed ${res.status} ${await res.text()}`);
    token = cookieFromSetCookie(res.headers.get("set-cookie"));
  }
  const me = await fetch(`${BASE}/api/auth/me`, {
    headers: { Cookie: `session=${token}` },
  });
  const meJson = (await me.json()) as {
    id?: number;
    user?: { id: number; nsfw_on?: number; is_adult?: number };
  };
  const userId = meJson.id ?? meJson.user?.id;
  if (!userId) throw new Error(`me missing id: ${JSON.stringify(meJson)}`);
  // Ensure DB adult flags + a non-adult general model for route assertions.
  const db = new Database(DB_PATH);
  db.prepare(
    `UPDATE users
     SET is_adult=1,
         points=CASE WHEN points < 5000 THEN 5000 ELSE points END,
         selected_ai=?
     WHERE id=?`
  ).run(GENERAL_MODEL, userId);
  db.close();
  // Also persist via API when available.
  await fetch(`${BASE}/api/user/selected-ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ selectedAI: GENERAL_MODEL }),
  }).catch(() => undefined);
  return { token, userId };
}

async function setNsfwOn(token: string, on: boolean) {
  const res = await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({ nsfw_on: on }),
  });
  if (!res.ok) {
    throw new Error(`settings nsfw_on=${on} failed ${res.status} ${await res.text()}`);
  }
}

async function ensurePersona(token: string): Promise<number> {
  const list = await fetch(`${BASE}/api/personas`, {
    headers: { Cookie: `session=${token}` },
  });
  const payload = (await list.json()) as {
    personas?: Array<{ id: number; name?: string }>;
  };
  const personas = Array.isArray(payload.personas) ? payload.personas : [];
  const existing = personas.find((p) => p.name === "렌");
  if (existing) return existing.id;
  const res = await fetch(`${BASE}/api/personas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${token}`,
    },
    body: JSON.stringify({
      name: "렌",
      gender: "male",
      description: "성인. 침착하고 짧게 말하는 직장인.",
      memo: "closed adult test",
    }),
  });
  if (!res.ok) throw new Error(`persona create ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id?: number; persona?: { id: number } };
  const id = json.id ?? json.persona?.id;
  if (!id) throw new Error(`persona id missing ${JSON.stringify(json)}`);
  return id;
}

async function postChat(opts: {
  token: string;
  personaId: number;
  chatId?: number;
  message: string;
  stage: string;
}): Promise<{
  stage: string;
  httpStatus: number;
  chatId?: number;
  messageId?: number;
  error?: string;
  usageModel?: string | null;
}> {
  const body: Record<string, unknown> = {
    characterId: CHARACTER_ID,
    message: opts.message,
    selectedPersonaId: opts.personaId,
    selectedAI: GENERAL_MODEL,
    isAdultMode: true,
    isNsfwMode: true,
    clientRequestId: `closed_adult_${opts.stage}_${Date.now().toString(36)}`,
  };
  if (opts.chatId) body.chatId = opts.chatId;
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session=${opts.token}`,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return {
      stage: opts.stage,
      httpStatus: res.status,
      error: (await res.text()).slice(0, 2000),
    };
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const dec = new TextDecoder();
  let buf = "";
  let chatId = opts.chatId;
  let messageId: number | undefined;
  let usageModel: string | null = null;
  while (true) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const obj = JSON.parse(line.slice(6)) as Record<string, unknown>;
        if (typeof obj.chatId === "number") chatId = obj.chatId;
        if (obj.type === "done") {
          if (typeof obj.messageId === "number") messageId = obj.messageId;
          if (typeof obj.chatId === "number") chatId = obj.chatId;
          const usage = obj.usage as { model?: string } | undefined;
          usageModel = usage?.model ?? null;
        }
      } catch {
        // ignore
      }
    }
  }
  return {
    stage: opts.stage,
    httpStatus: res.status,
    chatId,
    messageId,
    usageModel,
  };
}

function readAssistantMeta(chatId: number, messageId?: number) {
  const db = new Database(DB_PATH, { readonly: true });
  const row = messageId
    ? (db
        .prepare(
          `SELECT id, model, adult_route_meta_json, content FROM messages
           WHERE id=? AND chat_id=? AND role='assistant'`
        )
        .get(messageId, chatId) as
        | {
            id: number;
            model: string | null;
            adult_route_meta_json: string | null;
            content: string;
          }
        | undefined)
    : (db
        .prepare(
          `SELECT id, model, adult_route_meta_json, content FROM messages
           WHERE chat_id=? AND role='assistant' ORDER BY id DESC LIMIT 1`
        )
        .get(chatId) as
        | {
            id: number;
            model: string | null;
            adult_route_meta_json: string | null;
            content: string;
          }
        | undefined);
  db.close();
  if (!row) return null;
  let meta: Record<string, unknown> = {};
  try {
    meta = row.adult_route_meta_json
      ? (JSON.parse(row.adult_route_meta_json) as Record<string, unknown>)
      : {};
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    model: row.model,
    activeRoute: meta.activeRoute ?? meta.route ?? null,
    selectedModel: meta.selectedModel ?? row.model,
    meta,
  };
}

function isDeepSeek(model: string | null | undefined): boolean {
  return !!model && /deepseek-v4-pro/i.test(model);
}

async function main() {
  const { token, userId } = await signupOrLogin();
  const personaId = await ensurePersona(token);
  save("auth.json", { userId, personaId, email: EMAIL, base: BASE });

  // ---- ON path ----
  await setNsfwOn(token, true);
  const onTurns: Array<{ stage: string; message: string; expect: "general" | "adult" }> = [
    {
      stage: "ON_T1_GENERAL",
      message:
        "*호텔 스위트 거실, 소파 앞.* 오늘 일정부터 짧게 정리해 줄래?",
      expect: "general",
    },
    {
      stage: "ON_T2_ADULT_ENTRY",
      // Deterministic classifier entry: explicit_dialogue + intimate transition cues.
      message:
        "*침실로 들어가 성인 장면으로 이어간다.* 합의된 노골적인 성적 대사를 이어간다. 옷을 벗기며 더 가까이 몸을 밀착한다.",
      expect: "adult",
    },
    {
      stage: "ON_T3_ADULT_STICKY",
      message:
        "*성인 장면을 유지한다.* 합의된 현재 성인 장면을 같은 위치에서 계속한다.",
      expect: "adult",
    },
    {
      stage: "ON_T4_EXIT",
      message: "OOC: 성인 장면 종료. 다음 날 아침 일반 장면으로 전환한다.",
      expect: "general",
    },
  ];

  let onChatId: number | undefined;
  const onResults: Record<string, unknown>[] = [];
  for (const turn of onTurns) {
    const res = await postChat({
      token,
      personaId,
      chatId: onChatId,
      message: turn.message,
      stage: turn.stage,
    });
    if (!res.chatId) throw new Error(`${turn.stage} missing chatId: ${JSON.stringify(res)}`);
    onChatId = res.chatId;
    const meta = readAssistantMeta(res.chatId, res.messageId);
    const actualModel = String(
      meta?.meta?.actualModel ?? meta?.model ?? res.usageModel ?? ""
    );
    const activeRoute = String(meta?.activeRoute ?? "");
    // Prefer adult_route_meta.actualModel (delivered) over messages.model label.
    const strictPass =
      turn.expect === "adult"
        ? activeRoute === "adult" && isDeepSeek(actualModel)
        : activeRoute === "general" && !isDeepSeek(actualModel);
    onResults.push({
      ...turn,
      httpStatus: res.httpStatus,
      chatId: res.chatId,
      messageId: res.messageId,
      model: actualModel,
      activeRoute,
      strictPass,
      error: res.error,
    });
    if (!strictPass) {
      save("ON_FAIL.json", { turn, res, meta, onResults });
      throw new Error(
        `ON path fail ${turn.stage}: model=${actualModel} route=${activeRoute} expect=${turn.expect}`
      );
    }
    console.log(
      JSON.stringify({
        stage: turn.stage,
        model: actualModel,
        activeRoute,
        expect: turn.expect,
        pass: true,
      })
    );
  }

  // ---- OFF path (new chat) ----
  await setNsfwOn(token, false);
  const offTurns = [
    {
      stage: "OFF_T1_GENERAL",
      message:
        "*호텔 스위트 거실, 소파 앞.* 오늘 일정부터 짧게 정리해 줄래?",
    },
    {
      stage: "OFF_T2_ADULT_PROBE",
      message:
        "*침실로 들어가 성인 장면으로 이어간다.* 합의된 노골적인 성적 대사를 이어간다. 옷을 벗기며 더 가까이 몸을 밀착한다.",
    },
  ];
  let offChatId: number | undefined;
  const offResults: Record<string, unknown>[] = [];
  for (const turn of offTurns) {
    const res = await postChat({
      token,
      personaId,
      chatId: offChatId,
      message: turn.message,
      stage: turn.stage,
    });
    if (res.httpStatus === 400) {
      // Hard block is also acceptable as "handoff not used", but preferred is general model.
      offResults.push({ ...turn, httpStatus: 400, handoffUsed: false, note: "blocked" });
      console.log(JSON.stringify({ stage: turn.stage, httpStatus: 400, handoffUsed: false }));
      continue;
    }
    if (!res.chatId) throw new Error(`${turn.stage} missing chatId: ${JSON.stringify(res)}`);
    offChatId = res.chatId;
    const meta = readAssistantMeta(res.chatId, res.messageId);
    const actualModel = String(
      meta?.meta?.actualModel ?? meta?.model ?? res.usageModel ?? ""
    );
    const activeRoute = String(meta?.activeRoute ?? "");
    const handoffUsed = activeRoute === "adult";
    offResults.push({
      ...turn,
      httpStatus: res.httpStatus,
      chatId: res.chatId,
      messageId: res.messageId,
      model: actualModel,
      activeRoute,
      handoffUsed,
      error: res.error,
    });
    if (handoffUsed) {
      save("OFF_FAIL.json", { turn, res, meta, offResults });
      throw new Error(
        `OFF path used DeepSeek handoff at ${turn.stage}: model=${actualModel} route=${activeRoute}`
      );
    }
    console.log(
      JSON.stringify({
        stage: turn.stage,
        model: actualModel,
        activeRoute,
        handoffUsed: false,
      })
    );
  }

  const summary = {
    status: "CLOSED_ADULT_TEST_ELIGIBILITY_SMOKE_PASS",
    FINAL_ADULT_MODEL: "deepseek-v4-pro-0813",
    ADULT_VISIBILITY_ON_RESULT: "eligible — DeepSeek used on adult entry/sticky",
    ADULT_VISIBILITY_OFF_RESULT: "ineligible — DeepSeek adult handoff NOT USED",
    ON_ROUTE_SMOKE: onResults,
    OFF_ROUTE_SMOKE: offResults,
    userId,
    onChatId,
    offChatId,
  };
  save("SUMMARY.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
