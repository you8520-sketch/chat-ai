import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { resolveOwnerPersonaEditorAccess } from "@/lib/personaOwnerEditorAccess";
import { savePersonaWithSecretCompilation } from "@/lib/personaSaveWithSecrets";

const ENV_KEYS = ["PERSONA_SECRET_BOUNDARY_ENABLED", "PERSONA_SECRET_DISCOVERY_ENABLED"] as const;
const initialEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = initialEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(restoreEnv);

function uniqueUserId(): number {
  return 881_000_000 + Math.floor(Math.random() * 10_000_000);
}

describe("owner persona editor access", () => {
  it("rejects unauthenticated access with 401", () => {
    const result = resolveOwnerPersonaEditorAccess({ user: null, personaId: 1 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 401);
  });

  it("rejects Boundary OFF with 403 SECRET_SETTINGS_DISABLED", () => {
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "0";
    const result = resolveOwnerPersonaEditorAccess({
      user: { id: uniqueUserId() },
      personaId: 1,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 403);
    assert.equal(result.code, "SECRET_SETTINGS_DISABLED");
  });

  it("returns 404 without secret source for another user's persona", () => {
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    process.env.PERSONA_SECRET_DISCOVERY_ENABLED = "0";
    const ownerId = uniqueUserId();
    const otherId = uniqueUserId();
    const needle = "OWNER_DETAIL_FOREIGN_SECRET_NEEDLE";
    const created = savePersonaWithSecretCompilation({
      userId: ownerId,
      fields: {
        name: "소유자",
        memo: "",
        gender: "other",
        description: "공개",
        secret_description: needle,
        secretInput: { supplied: true, value: needle },
        image_url: "",
        image_focus_x: 0.5,
        image_focus_y: 0.5,
      },
      db: getDb(),
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = resolveOwnerPersonaEditorAccess({
      user: { id: otherId },
      personaId: created.personaId,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(needle));
  });

  it("owner editor route wires the shared access resolver", () => {
    const routeSource = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/personas/[id]/editor/route.ts"),
      "utf8"
    );
    assert.match(routeSource, /getSessionUser\(\)/);
    assert.match(routeSource, /resolveOwnerPersonaEditorAccess/);
    assert.match(routeSource, /Cache-Control": "no-store"/);
  });
});
