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

const NORMAL_USER_ID = 92001;
const ADMIN_USER_ID = 92002;
let createSession: (userId: number) => string;
let getDb: typeof import("@/lib/db").getDb;
let GET: typeof import("./route").GET;

function insertUser(id: number, email: string, isAdmin: number) {
  const db = getDb();
  db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)").run(
    id,
    email,
    `user-${id}`,
    "test"
  );
  db.prepare("UPDATE users SET is_admin=? WHERE id=?").run(isAdmin, id);
}

describe("admin billing receipt route authorization", () => {
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
        GET = route.GET;
      }),
    ]).then(() => {
      insertUser(NORMAL_USER_ID, "normal@example.com", 0);
      insertUser(ADMIN_USER_ID, "admin@example.com", 1);
    });
  });

  beforeEach(() => {
    sessionToken = "";
  });

  after(() => {
    global.__db?.close();
    global.__db = undefined;
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
  });

  it("denies a normal authenticated user before parsing or loading the receipt", async () => {
    sessionToken = createSession(NORMAL_USER_ID);
    const response = await GET(new Request("http://localhost/api/chat/admin-billing-receipt?messageId=1"));
    assert.equal(response.status, 403);
  });

  it("preserves the admin route past the permission gate", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET(new Request("http://localhost/api/chat/admin-billing-receipt"));
    assert.equal(response.status, 400);
  });
});
