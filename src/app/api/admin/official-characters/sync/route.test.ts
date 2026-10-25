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
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

const ADMIN_ID = 95101;

describe("admin official-characters sync POST recompile", () => {
  let createSession: (userId: number) => string;
  let getDb: typeof import("@/lib/db").getDb;
  let POST: typeof import("./route").POST;
  let seed51: () => void;

  before(async () => {
    process.env.NODE_TEST_CONTEXT = "1";
    installIsolatedTestDatabase();
    const seedMod = await import("@/lib/officialSupply/officialSupplyCompileRefreshHttpSeed");
    seed51 = seedMod.seedWolfgang51ForHttpTest;
    ({ createSession } = await import("@/lib/auth"));
    ({ getDb } = await import("@/lib/db"));
    ({ POST } = await import("./route"));
    getDb()
      .prepare(
        "INSERT INTO users (id,email,nickname,pw_hash,is_adult,is_admin) VALUES (?,?,?,?,1,1)"
      )
      .run(ADMIN_ID, "p2-http-admin@test.local", "HTTP Admin", "x");
  });

  beforeEach(() => {
    sessionToken = createSession(ADMIN_ID);
    seed51();
  });

  after(() => {
    sessionToken = "";
    global.__db?.close();
    global.__db = undefined;
    uninstallIsolatedTestDatabase();
    delete process.env.NODE_TEST_CONTEXT;
    Module._load = originalLoad;
  });

  it("returns 200 preview JSON for operation=recompile mode=dry_run (#51)", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const res = await POST(
        new Request("http://localhost/api/admin/official-characters/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: 51, mode: "dry_run", operation: "recompile" }),
        })
      );
      const raw = await res.text();
      assert.equal(res.status, 200, raw);
      const body = JSON.parse(raw) as {
        ok?: boolean;
        operation?: string;
        characterId?: number;
        changedFields?: string[];
        beforeJsonHash?: string;
        afterJsonHash?: string;
      };
      assert.equal(body.ok, true);
      assert.equal(body.operation, "recompile");
      assert.equal(body.characterId, 51);
      assert.ok(body.changedFields?.includes("creator_compiled_description_json"));
      assert.notEqual(body.beforeJsonHash, body.afterJsonHash);
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
