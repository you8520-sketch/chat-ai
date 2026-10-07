import Module from "module";

let sessionToken = "";
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  if (request === "next/headers") {
    return {
      cookies: async () => ({
        get: (name: string) =>
          name === "session" && sessionToken ? { value: sessionToken } : undefined,
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

const NORMAL_USER_ID = 94101;
const ADMIN_USER_ID = 94102;
const SECRET_CANARIES = [
  "sk-or-v1-runtime-route-canary-0001",
  "ci-runtime-route-canary-0002",
  "admin-export-runtime-route-canary-0003",
];
let createSession: (userId: number) => string;
let getDb: typeof import("@/lib/db").getDb;
let GET: typeof import("./route").GET;
const envSnapshot = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  CHEAPER_INFERENCE_API_KEY: process.env.CHEAPER_INFERENCE_API_KEY,
  ADMIN_EXPORT_SECRET: process.env.ADMIN_EXPORT_SECRET,
};

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

describe("admin runtime-settings GET", () => {
  before(() => {
    process.env.OPENROUTER_API_KEY = SECRET_CANARIES[0];
    process.env.CHEAPER_INFERENCE_API_KEY = SECRET_CANARIES[1];
    process.env.ADMIN_EXPORT_SECRET = SECRET_CANARIES[2];
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
      insertUser(NORMAL_USER_ID, "normal-runtime-settings@example.com", 0);
      insertUser(ADMIN_USER_ID, "admin-runtime-settings@example.com", 1);
    });
  });

  beforeEach(() => {
    sessionToken = "";
  });

  after(() => {
    if (envSnapshot.OPENROUTER_API_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = envSnapshot.OPENROUTER_API_KEY;
    if (envSnapshot.CHEAPER_INFERENCE_API_KEY === undefined) {
      delete process.env.CHEAPER_INFERENCE_API_KEY;
    } else {
      process.env.CHEAPER_INFERENCE_API_KEY = envSnapshot.CHEAPER_INFERENCE_API_KEY;
    }
    if (envSnapshot.ADMIN_EXPORT_SECRET === undefined) delete process.env.ADMIN_EXPORT_SECRET;
    else process.env.ADMIN_EXPORT_SECRET = envSnapshot.ADMIN_EXPORT_SECRET;
    global.__db?.close();
    global.__db = undefined;
    uninstallIsolatedTestDatabase();
    Module._load = originalLoad;
  });

  it("forbids unauthenticated callers", async () => {
    const response = await GET();
    assert.equal(response.status, 403);
  });

  it("forbids non-admin users", async () => {
    sessionToken = createSession(NORMAL_USER_ID);
    const response = await GET();
    assert.equal(response.status, 403);
  });

  it("returns a no-store projection for admins without leaking secret canaries", async () => {
    sessionToken = createSession(ADMIN_USER_ID);
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = (await response.json()) as {
      mutationSupported: boolean;
      mainRp: { models: unknown[] };
      credentials: {
        openRouterApiKeyConfigured: boolean;
        cheaperInferenceApiKeyConfigured: boolean;
      };
    };
    assert.equal(body.mutationSupported, false);
    assert.equal(body.mainRp.models.length, 4);
    assert.equal(body.credentials.openRouterApiKeyConfigured, true);
    assert.equal(body.credentials.cheaperInferenceApiKeyConfigured, true);
    const raw = JSON.stringify(body);
    for (const canary of SECRET_CANARIES) {
      assert.equal(raw.includes(canary), false, canary);
    }
  });
});
