import Module from "module";

let sessionToken = "";
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (name: string) => (name === "session" && sessionToken ? { value: sessionToken } : undefined),
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const USER_ID = 77201;
const CHARACTER_ID = 77202;

let createSession: (userId: number) => string;
let getDb: typeof import("@/lib/db").getDb;
let POST: typeof import("./route").POST;

function seed(): void {
  const db = getDb();
  db.prepare("DELETE FROM messages").run();
  db.prepare("DELETE FROM chats").run();
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM user_personas WHERE user_id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHARACTER_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare(
    "INSERT INTO users (id, email, nickname, pw_hash, points) VALUES (?,?,?,?,2000)"
  ).run(USER_ID, "session-create@test.local", "tester", "x");
  db.prepare(
    `INSERT INTO characters (id, name, greeting, nsfw, visibility, moderation_status, official)
     VALUES (?,?,?,?,?,?,?)`
  ).run(CHARACTER_ID, "유나", "창가에서 천천히 고개를 돌렸다.", 0, "public", "approved", 1);
}

describe("POST /api/chat/session explicit create", () => {
  before(() => {
    installIsolatedTestDatabase();
    return Promise.all([
      import("@/lib/auth").then((auth) => {
        createSession = auth.createSession;
      }),
      import("@/lib/db").then((db) => {
        getDb = db.getDb;
      }),
      import("./route").then((route) => {
        POST = route.POST;
      }),
    ]);
  });

  after(() => {
    global.__db?.close();
    global.__db = undefined;
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
  });

  beforeEach(() => {
    sessionToken = "";
    seed();
  });

  it("rejects anonymous create", async () => {
    const response = await POST(
      new Request("http://localhost/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: CHARACTER_ID }),
      })
    );
    assert.equal(response.status, 401);
  });

  it("creates exactly one room for the first !fresh POST and reuses it", async () => {
    sessionToken = createSession(USER_ID);
    const first = await POST(
      new Request("http://localhost/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: CHARACTER_ID }),
      })
    );
    const firstBody = (await first.json()) as { chatId: number; created: boolean };
    assert.equal(first.status, 200);
    assert.equal(firstBody.created, true);

    const second = await POST(
      new Request("http://localhost/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: CHARACTER_ID }),
      })
    );
    const secondBody = (await second.json()) as { chatId: number; created: boolean };
    assert.equal(second.status, 200);
    assert.equal(secondBody.created, false);
    assert.equal(secondBody.chatId, firstBody.chatId);

    const chats = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM chats WHERE user_id=? AND character_id=?")
        .get(USER_ID, CHARACTER_ID) as { n: number }
    ).n;
    assert.equal(chats, 1);
  });

  it("fresh=true creates a second room", async () => {
    sessionToken = createSession(USER_ID);
    const first = await POST(
      new Request("http://localhost/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: CHARACTER_ID }),
      })
    );
    const firstBody = (await first.json()) as { chatId: number };
    const second = await POST(
      new Request("http://localhost/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: CHARACTER_ID, fresh: true }),
      })
    );
    const secondBody = (await second.json()) as { chatId: number; created: boolean };
    assert.equal(second.status, 200);
    assert.equal(secondBody.created, true);
    assert.notEqual(secondBody.chatId, firstBody.chatId);
  });
});
