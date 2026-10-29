import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { CHARACTER_GENRES } from "@/lib/characterGenres";
import { getDb } from "@/lib/db";
import {
  assessAdminAuthorManuscript,
  clearAdminAuthorPreviewsForTests,
  holdAdminAuthorManuscriptForTests,
  officialVoiceFieldsForQaCodes,
  parseAdminAuthorSelection,
  previewAdminOfficialCharacter,
  repairHeldAdminAuthorPreview,
  saveHeldAdminAuthorPreview,
  type AdminAuthorSelection,
} from "@/lib/officialSupply/adminAuthorDraft";
import type { OfficialAuthorTransport } from "@/lib/officialSupply/author";
import type { PortfolioBriefInput } from "@/lib/officialSupply/authorPrompts";
import type { OfficialCharacterBible, OfficialWorldBible } from "@/lib/officialSupply/bible";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import {
  OFFICIAL_MODERN_DAILY_GENRE,
  OFFICIAL_ROFAN_GENRE,
  ROFAN_PARITY_PLAN,
  recommendOfficialAuthoringDirection,
  resolveAdminAuthoringDirection,
  resolveOfficialAuthoringPlan,
} from "@/lib/officialSupply/genreProfile";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";
import { assertIsolatedTestDatabaseActive, installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

const ADMIN = { id: 97401, nickname: "G5-2 관리자", email: "g52-admin@test.local", is_adult: 1, is_admin: 1 };
const OTHER = { id: 97402, nickname: "G5-2 다른 관리자", email: "g52-other@test.local", is_adult: 1, is_admin: 1 };
const USER = { id: 97403, nickname: "G5-2 일반", email: "g52-user@test.local", is_adult: 1, is_admin: 0 };
const ROOT = path.join(process.cwd(), "docs/official-supply/reviews/g5-1-2026-10-28/candidates");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function candidate(key: string) {
  const dir = path.join(ROOT, key);
  return {
    draft: readJson<OfficialCharacterDraft>(path.join(dir, "draft.compiled.json")),
    bible: readJson<OfficialCharacterBible>(path.join(dir, "bible.assembled.json")),
    world: readJson<OfficialWorldBible>(path.join(dir, "world-bible.json")),
    brief: readJson<PortfolioBriefInput>(path.join(dir, "brief.json")),
  };
}

const autoModern: AdminAuthorSelection = {
  genre: "현대/일상",
  tone: "auto",
  humor: "auto",
  pacing: "auto",
  nameWordplay: "auto",
  gender: "female",
  castIntent: "",
};

before(() => {
  installIsolatedTestDatabase();
  assertIsolatedTestDatabaseActive();
  const db = getDb();
  for (const user of [ADMIN, OTHER, USER]) {
    db.prepare("INSERT INTO users (id,email,nickname,pw_hash,is_adult,is_admin) VALUES (?,?,?,?,?,?)").run(
      user.id,
      user.email,
      user.nickname,
      "fixture",
      1,
      user.is_admin
    );
  }
});

after(() => {
  clearAdminAuthorPreviewsForTests();
  uninstallIsolatedTestDatabase();
});

describe("G5-2 admin authoring defaults", () => {
  it("recommends every site genre and keeps absent-rofan plans free of tone", () => {
    assert.equal(ROFAN_PARITY_PLAN.tone, undefined);
    assert.equal(resolveOfficialAuthoringPlan({ genre: OFFICIAL_ROFAN_GENRE }).tone, undefined);
    for (const genre of CHARACTER_GENRES) {
      const recommended = recommendOfficialAuthoringDirection(genre);
      const plan = resolveOfficialAuthoringPlan(recommended);
      assert.equal(plan.genre, genre);
      assert.ok(plan.tone && plan.humor && plan.pacing && plan.nameWordplay);
      assert.equal(plan.profile.worldScale, genre === OFFICIAL_MODERN_DAILY_GENRE ? "scene" : "full");
    }
    const modern = resolveAdminAuthoringDirection({ genre: "현대/일상", tone: "dry" });
    assert.equal(modern.tone, "dry");
    assert.equal(modern.humor, "central");
    assert.equal(parseAdminAuthorSelection({ ...autoModern, genre: "없는장르" }).ok, false);
    const parsed = parseAdminAuthorSelection(autoModern);
    assert.equal(parsed.ok, true);
  });

  it("maps selective voice repair onto the existing voice fields only", () => {
    assert.deepEqual(officialVoiceFieldsForQaCodes(["bible_greeting_short", "sfw_public_text_has_adult_terms"]), ["greeting"]);
    assert.deepEqual(officialVoiceFieldsForQaCodes(["sfw_public_text_has_adult_terms"]), []);
    const routes = ["preview", "repair", "save"].map((name) =>
      fs.readFileSync(path.join(process.cwd(), `src/app/api/admin/official-author/${name}/route.ts`), "utf8")
    );
    for (const source of routes) assert.match(source, /requireAdminUser\(\)/);
  });
});

describe("G5-2 admin private draft save", () => {
  it("saves a QA-passing manuscript once, as a private imageless admin draft", async () => {
    clearAdminAuthorPreviewsForTests();
    const pack = candidate("g5-modern-comedy");
    const plan = resolveOfficialAuthoringPlan(recommendOfficialAuthoringDirection("현대/일상"));
    const preview = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: pack.bible,
    });
    assert.equal(preview.qaOk, true, preview.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    assert.equal(preview.textLock, computeTextLockHash(pack.draft));
    const saved = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const again = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(again.ok && again.characterId, saved.characterId);
    assert.equal(again.ok && again.alreadySaved, true);
    const db = getDb();
    const row = db.prepare("SELECT * FROM characters WHERE id=?").get(saved.characterId) as Record<string, unknown>;
    assert.equal(row.creator_id, ADMIN.id);
    assert.equal(row.visibility, "private");
    assert.equal(row.official, 0);
    assert.equal(row.assets, "[]");
    assert.equal(row.greeting, pack.draft.greeting);
    assert.equal(row.description, pack.draft.description);
    assert.equal(row.name, pack.draft.name);
    const owned = db.prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=?").get(ADMIN.id) as { n: number };
    assert.equal(owned.n, 1);
    assert.equal((await saveHeldAdminAuthorPreview(USER, preview.previewId)).ok, false);
    assert.equal((await saveHeldAdminAuthorPreview(OTHER, preview.previewId)).ok, false);
  });

  it("does not save a manuscript that fails the existing adult-term check", async () => {
    clearAdminAuthorPreviewsForTests();
    const pack = candidate("g5-modern-comedy-e");
    const plan = resolveOfficialAuthoringPlan(recommendOfficialAuthoringDirection("현대/일상"));
    const preview = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: pack.bible,
    });
    assert.equal(preview.qaOk, false);
    assert.ok(preview.issues.some((issue) => issue.code === "sfw_public_text_has_adult_terms"));
    const saved = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(saved.ok, false);
    if (!saved.ok) assert.equal(saved.status, 409);
    const repair = await repairHeldAdminAuthorPreview({
      adminUserId: ADMIN.id,
      previewId: preview.previewId,
      transport: {
        label: "must-not-call",
        async completeJson() {
          throw new Error("repair transport called");
        },
      },
    });
    assert.equal(repair.ok, false);
    const db = getDb();
    const named = db.prepare("SELECT COUNT(*) AS n FROM characters WHERE name=?").get(pack.draft.name) as { n: number };
    assert.equal(named.n, 0);
  });

  it("refuses a passing sheet once an adult stem is introduced", async () => {
    const pack = candidate("g5-modern-comedy");
    const bible = { ...pack.bible, greeting: `${pack.bible.greeting}\n사정을` };
    const issues = assessAdminAuthorManuscript({ draft: { ...pack.draft, greeting: bible.greeting }, bible, world: pack.world, brief: pack.brief });
    assert.ok(issues.some((issue) => issue.code === "sfw_public_text_has_adult_terms"));
  });

  it("does not insert a character when generation fails before a manuscript exists", async () => {
    const beforeCount = (getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n;
    const transport: OfficialAuthorTransport = {
      label: "invalid-json",
      async completeJson() {
        return { text: "not-json", model: "fixture", inputTokens: 1, outputTokens: 1, costUsd: 0, providerRequestId: null };
      },
    };
    const preview = await previewAdminOfficialCharacter({ adminUserId: ADMIN.id, selection: autoModern, transport });
    assert.equal(preview.ok, false);
    const afterCount = (getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n;
    assert.equal(afterCount, beforeCount);
  });
});
