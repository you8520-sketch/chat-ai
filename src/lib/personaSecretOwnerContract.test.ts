import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  buildExplicitSecretSavePayload,
  buildPublicPersonaUpdatePayload,
} from "@/lib/personaEditorPayload";
import { toPublicPersonaClientRow } from "@/lib/personaSecretSerialization";
import { savePersonaWithSecretCompilation } from "@/lib/personaSaveWithSecrets";
import { ensureDefaultPublicPersona, getPersonaById } from "@/lib/userPersonas";

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
  return 880_000_000 + Math.floor(Math.random() * 10_000_000);
}

function fields(overrides: Record<string, unknown> = {}) {
  return {
    name: "계약 테스트",
    memo: "",
    gender: "other" as const,
    description: "공개 설정",
    secret_description: "",
    image_url: "",
    image_focus_x: 0.5,
    image_focus_y: 0.5,
    ...overrides,
  };
}

describe("persona secret owner contracts", () => {
  it("Boundary OFF rejects changed secret before creating a persona", () => {
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "0";
    const db = getDb();
    const userId = uniqueUserId();
    const before = (
      db.prepare("SELECT COUNT(*) AS c FROM user_personas WHERE user_id=?").get(userId) as { c: number }
    ).c;

    const result = savePersonaWithSecretCompilation({
      userId,
      fields: {
        ...fields({ secret_description: "절대 노출되면 안 되는 비밀" }),
        secretInput: { supplied: true, value: "절대 노출되면 안 되는 비밀" },
      },
      db,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 403);
    assert.equal(result.code, "SECRET_SETTINGS_DISABLED");
    const after = (
      db.prepare("SELECT COUNT(*) AS c FROM user_personas WHERE user_id=?").get(userId) as { c: number }
    ).c;
    assert.equal(after, before);
  });

  it("Boundary OFF permits an empty explicit secret on create", () => {
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "0";
    const db = getDb();
    const userId = uniqueUserId();
    const result = savePersonaWithSecretCompilation({
      userId,
      fields: {
        ...fields(),
        secretInput: { supplied: true, value: "" },
      },
      db,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(getPersonaById(userId, result.personaId)?.secret_description, "");
  });

  it("omitted normal update preserves an existing secret without recompiling it", () => {
    const db = getDb();
    const userId = uniqueUserId();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    const created = savePersonaWithSecretCompilation({
      userId,
      fields: {
        ...fields({ secret_description: "왼손의 흉터를 숨긴다." }),
        secretInput: { supplied: true, value: "왼손의 흉터를 숨긴다." },
      },
      db,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const runsBefore = (
      db
        .prepare("SELECT COUNT(*) AS c FROM persona_secret_compilation_runs WHERE persona_id=?")
        .get(created.personaId) as { c: number }
    ).c;
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "0";
    const updated = savePersonaWithSecretCompilation({
      userId,
      personaId: created.personaId,
      fields: {
        ...fields({ description: "공개 설정 수정" }),
        secretInput: { supplied: false },
      },
      db,
    });
    assert.equal(updated.ok, true);
    const row = getPersonaById(userId, created.personaId);
    assert.equal(row?.description, "공개 설정 수정");
    assert.equal(row?.secret_description, "왼손의 흉터를 숨긴다.");
    const runsAfter = (
      db
        .prepare("SELECT COUNT(*) AS c FROM persona_secret_compilation_runs WHERE persona_id=?")
        .get(created.personaId) as { c: number }
    ).c;
    assert.equal(runsAfter, runsBefore);
  });

  it("Boundary OFF rejects a changed secret without writing normal fields", () => {
    const db = getDb();
    const userId = uniqueUserId();
    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "1";
    const created = savePersonaWithSecretCompilation({
      userId,
      fields: {
        ...fields({ description: "저장 전 공개 설정", secret_description: "기존 비밀" }),
        secretInput: { supplied: true, value: "기존 비밀" },
      },
      db,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    process.env.PERSONA_SECRET_BOUNDARY_ENABLED = "0";
    const rejected = savePersonaWithSecretCompilation({
      userId,
      personaId: created.personaId,
      fields: {
        ...fields({ description: "저장되면 안 되는 공개 설정", secret_description: "변경 비밀" }),
        secretInput: { supplied: true, value: "변경 비밀" },
      },
      db,
    });
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.equal(rejected.status, 403);
    assert.equal(rejected.code, "SECRET_SETTINGS_DISABLED");
    const row = getPersonaById(userId, created.personaId);
    assert.equal(row?.description, "저장 전 공개 설정");
    assert.equal(row?.secret_description, "기존 비밀");
  });

  it("public DTO and normal auto-save payload contain zero secret bytes", () => {
    const needle = "HYDRATION_SECRET_NEEDLE_91";
    const publicRow = toPublicPersonaClientRow({
      id: 1,
      user_id: 2,
      name: "렌",
      memo: "",
      gender: "other",
      description: "공개 설명",
      secret_description: needle,
      speech_examples: "",
      image_url: "",
      image_focus_x: 0.5,
      image_focus_y: 0.5,
      created_at: "2026-01-01",
    });
    const normalPayload = buildPublicPersonaUpdatePayload({
      name: "렌",
      memo: "",
      gender: "other",
      description: "공개 설명 수정",
      image_url: "",
      image_focus_x: 0.5,
      image_focus_y: 0.5,
    });
    assert.equal("secret_description" in publicRow, false);
    assert.doesNotMatch(JSON.stringify(publicRow), new RegExp(needle));
    assert.equal("secret_description" in normalPayload, false);
    assert.deepEqual(buildExplicitSecretSavePayload(needle), { secret_description: needle });
  });

  it("chat hydration source returns public rows with zero secret bytes", () => {
    const db = getDb();
    const userId = uniqueUserId();
    const needle = "CHAT_HYDRATION_SECRET_NEEDLE_47";
    db.prepare(
      `INSERT INTO user_personas
       (user_id, name, memo, gender, description, secret_description, speech_examples, image_url, image_focus_x, image_focus_y)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, "채팅 페르소나", "", "other", "공개 설명", needle, "", "", 0.5, 0.5);

    const personas = ensureDefaultPublicPersona(userId, "채팅 페르소나");
    const serialized = JSON.stringify(personas);
    assert.equal(personas.length, 1);
    assert.equal("secret_description" in personas[0]!, false);
    assert.doesNotMatch(serialized, new RegExp(needle));
  });
});
