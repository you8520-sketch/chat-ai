import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { CHARACTER_GENRES } from "@/lib/characterGenres";
import { createCharacterFromForm } from "@/lib/characterFormSave";
import { getDb } from "@/lib/db";
import {
  assessAdminAuthorManuscript,
  clearAdminAuthorPreviewsForTests,
  countAdminAuthorSavedHoldsForTests,
  holdAdminAuthorManuscriptForTests,
  markAdminAuthorPreviewSavedForTests,
  officialVoiceFieldsForQaCodes,
  parseAdminAuthorSelection,
  previewAdminOfficialCharacter,
  repairHeldAdminAuthorPreview,
  saveHeldAdminAuthorPreview,
  setAdminAuthorNextSaveThrowsForTests,
  setAdminAuthorPrivateManuscriptLookupFailOnCallForTests,
  setAdminAuthorSaveDelayForTests,
  type AdminAuthorSelection,
} from "@/lib/officialSupply/adminAuthorDraft";
import type { OfficialAuthorTransport } from "@/lib/officialSupply/author";
import type { PortfolioBriefInput } from "@/lib/officialSupply/authorPrompts";
import type { OfficialCharacterBible, OfficialWorldBible } from "@/lib/officialSupply/bible";
import { buildOfficialCharacterFormBody, computeTextLockHash } from "@/lib/officialSupply/characterText";
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
const PROVIDER = path.join(process.cwd(), "docs/official-supply/reviews/g5-1-2026-10-28/provider-responses");

function providerFixtureTransport(providerFiles: readonly string[]): { transport: OfficialAuthorTransport; getCalls: () => number } {
  const queue = providerFiles.map((file) => readJson<{ text: string }>(path.join(PROVIDER, file)).text);
  let calls = 0;
  return {
    getCalls: () => calls,
    transport: {
      label: "g5-1-provider-fixture",
      async completeJson() {
        calls += 1;
        const text = queue.shift();
        if (!text) throw new Error("fixture transport exhausted");
        return {
          text,
          model: "fixture",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          providerRequestId: null,
        };
      },
    },
  };
}

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

const autoHorrorDry: AdminAuthorSelection = {
  genre: "공포/추리",
  tone: "auto",
  humor: "auto",
  pacing: "auto",
  nameWordplay: "auto",
  gender: "male",
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

  it("keeps a 21st preview when 20 saved holds already occupy memory", () => {
    clearAdminAuthorPreviewsForTests();
    const pack = candidate("g5-modern-comedy");
    const plan = resolveOfficialAuthoringPlan(recommendOfficialAuthoringDirection("현대/일상"));
    for (let i = 0; i < 20; i += 1) {
      const saved = holdAdminAuthorManuscriptForTests({
        adminUserId: ADMIN.id,
        plan,
        world: pack.world,
        brief: pack.brief,
        bible: pack.bible,
      });
      markAdminAuthorPreviewSavedForTests(saved.previewId, 880_000 + i);
    }
    const twentyFirst = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: pack.bible,
    });
    assert.ok(twentyFirst.previewId);
    assert.equal(twentyFirst.qaOk, true);
  });

  it("creates exactly one DB row when duplicate saves race on the same previewId", async () => {
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
    const db = getDb();
    const beforeOwned = (db.prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=?").get(ADMIN.id) as { n: number }).n;
    const [first, second] = await Promise.all([
      saveHeldAdminAuthorPreview(ADMIN, preview.previewId),
      saveHeldAdminAuthorPreview(ADMIN, preview.previewId),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.characterId, second.characterId);
    const afterOwned = (db.prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=?").get(ADMIN.id) as { n: number }).n;
    assert.equal(afterOwned - beforeOwned, 1);
  });

  it("calls paid transport at most once when duplicate repairs race", async () => {
    clearAdminAuthorPreviewsForTests();
    const pack = candidate("g5-modern-comedy");
    const plan = resolveOfficialAuthoringPlan(recommendOfficialAuthoringDirection("현대/일상"));
    const brokenGreeting = `"당신, 여기 왜 서 있어?"`;
    const bible = { ...pack.bible, greeting: brokenGreeting };
    const preview = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible,
    });
    assert.equal(preview.qaOk, false);
    assert.ok(preview.repairable);
    const voiceFixture = readJson<{ text: string }>(
      path.join(PROVIDER, "11-g5-modern-comedy-character_bible_voice.json")
    ).text;
    let transportCalls = 0;
    const transport: OfficialAuthorTransport = {
      label: "repair-once",
      async completeJson(input) {
        transportCalls += 1;
        assert.equal(input.task, "character_bible_voice");
        return {
          text: voiceFixture,
          model: "fixture",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          providerRequestId: null,
        };
      },
    };
    const [first, second] = await Promise.all([
      repairHeldAdminAuthorPreview({ adminUserId: ADMIN.id, previewId: preview.previewId, transport }),
      repairHeldAdminAuthorPreview({ adminUserId: ADMIN.id, previewId: preview.previewId, transport }),
    ]);
    assert.equal(transportCalls, 1);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.previewId, second.previewId);
    assert.ok(first.qaOk);
  });

  it("shows a voice gender-QA rejection without Bonds, a hold, or a saved row", async () => {
    clearAdminAuthorPreviewsForTests();
    const db = getDb();
    const before = db.prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number };
    const files = [
      "14-g5-horror-dry-world_bible.json",
      "15-g5-horror-dry-world_bible.json",
      "16-g5-horror-dry-world_bible.json",
      "17-g5-horror-dry-world_bible.json",
      "18-g5-horror-dry-character_bible_1.json",
      "19-g5-horror-dry-character_bible_voice.json",
    ];
    const queue = files.map((file) => readJson<{ text: string }>(path.join(PROVIDER, file)).text);
    const voice = JSON.parse(queue[5] ?? "{}") as { greeting?: string; publicProfile?: { detailedDescription?: string; creatorComment?: string } };
    const lock = "당신은 그 남자 플레이어로 시작한다.";
    voice.publicProfile = { ...voice.publicProfile, detailedDescription: `${voice.publicProfile?.detailedDescription ?? ""}\n${lock}` };
    queue[5] = JSON.stringify(voice);
    let bondsCalls = 0;
    let calls = 0;
    const transport: OfficialAuthorTransport = {
      label: "gender-lock-fixture",
      async completeJson(input) {
        calls += 1;
        if (input.task === "character_bible_bonds") bondsCalls += 1;
        const text = queue.shift();
        if (!text) throw new Error("fixture transport exhausted");
        return { text, model: "fixture", inputTokens: 0, outputTokens: 0, costUsd: 0, providerRequestId: null };
      },
    };
    const preview = await previewAdminOfficialCharacter({
      adminUserId: ADMIN.id,
      selection: autoHorrorDry,
      transport,
    });
    assert.equal(bondsCalls, 0);
    assert.equal(calls, 6);
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal("previewId" in preview, false);
    assert.match(preview.error, /official_player_gender_locked/);
    assert.ok(preview.issues?.some((issue) => issue.code === "official_player_gender_locked" && issue.message.includes("남자 플레이어")));
    assert.match(preview.rejectedManuscript?.description ?? "", /남자 플레이어/);
    assert.equal(preview.rejectedManuscript?.greeting, voice.greeting ?? "");
    assert.equal(preview.rejectedManuscript?.comment, voice.publicProfile?.creatorComment ?? "");
    const wire = JSON.stringify(preview);
    assert.equal(wire.includes("OPENROUTER"), false);
    assert.equal(wire.includes("너는 롤플레잉"), false);
    assert.equal(wire.includes("system"), false);
    const saved = await saveHeldAdminAuthorPreview(ADMIN, "rejected-has-no-hold");
    assert.equal(saved.ok, false);
    if (!saved.ok) assert.equal(saved.status, 404);
    const after = db.prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number };
    assert.equal(after.n, before.n);
  });

  it("runs the production preview path with G5-1 provider fixtures and saves privately", async () => {
    clearAdminAuthorPreviewsForTests();
    const pack = candidate("g5-horror-dry");
    const fixture = providerFixtureTransport([
      "14-g5-horror-dry-world_bible.json",
      "15-g5-horror-dry-world_bible.json",
      "16-g5-horror-dry-world_bible.json",
      "17-g5-horror-dry-world_bible.json",
      "18-g5-horror-dry-character_bible_1.json",
      "19-g5-horror-dry-character_bible_voice.json",
      "20-g5-horror-dry-character_bible_bonds.json",
    ]);
    const preview = await previewAdminOfficialCharacter({
      adminUserId: ADMIN.id,
      selection: autoHorrorDry,
      transport: fixture.transport,
    });
    assert.equal(preview.ok, true, preview.ok === false ? preview.error : JSON.stringify(preview));
    assert.equal(fixture.getCalls(), 7, `transport calls=${fixture.getCalls()}`);
    if (!preview.ok) return;
    assert.equal(preview.manuscript.name, pack.draft.name);
    assert.equal(preview.manuscript.greeting, pack.draft.greeting);
    if (!preview.qaOk) {
      const blocked = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.status, 409);
      return;
    }
    assert.equal(preview.textLock, computeTextLockHash(pack.draft));
    const saved = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const row = getDb().prepare("SELECT * FROM characters WHERE id=?").get(saved.characterId) as Record<string, unknown>;
    assert.equal(row.creator_id, ADMIN.id);
    assert.equal(row.visibility, "private");
    assert.equal(row.official, 0);
    assert.equal(row.assets, "[]");
    assert.equal(row.greeting, pack.draft.greeting);
    assert.equal(row.description, pack.draft.description);
  });

  it("does not let another admin join an in-flight save or repair", async () => {
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
    setAdminAuthorSaveDelayForTests(80);
    const ownerSave = saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    const otherSave = await saveHeldAdminAuthorPreview(OTHER, preview.previewId);
    assert.equal(otherSave.ok, false);
    if (!otherSave.ok) assert.equal(otherSave.status, 404);
    const ownerResult = await ownerSave;
    assert.equal(ownerResult.ok, true);
    const otherOwned = getDb().prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=?").get(OTHER.id) as { n: number };
    assert.equal(otherOwned.n, 0);

    const brokenGreeting = `"당신, 여기 왜 서 있어?"`;
    const broken = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: { ...pack.bible, greeting: brokenGreeting },
    });
    const slowTransport: OfficialAuthorTransport = {
      label: "slow-repair",
      async completeJson() {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          text: readJson<{ text: string }>(path.join(PROVIDER, "11-g5-modern-comedy-character_bible_voice.json")).text,
          model: "fixture",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          providerRequestId: null,
        };
      },
    };
    const ownerRepair = repairHeldAdminAuthorPreview({
      adminUserId: ADMIN.id,
      previewId: broken.previewId,
      transport: slowTransport,
    });
    const otherRepair = await repairHeldAdminAuthorPreview({
      adminUserId: OTHER.id,
      previewId: broken.previewId,
      transport: slowTransport,
    });
    assert.equal(otherRepair.ok, false);
    if (!otherRepair.ok) assert.equal(otherRepair.error, "미리보기를 찾을 수 없습니다.");
    await ownerRepair;
  });

  it("resolves save promises when the async save throws before insert", async () => {
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
    setAdminAuthorNextSaveThrowsForTests(new Error("db boom"));
    const failed = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(failed.ok, false);
    if (!failed.ok) {
      assert.equal(failed.status, 500);
      assert.match(failed.error, /db boom/);
    }
    const db = getDb();
    const beforeRetry = (db.prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=?").get(ADMIN.id) as { n: number }).n;
    const saved = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(saved.ok, true);
    const afterRetry = (db.prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=?").get(ADMIN.id) as { n: number }).n;
    assert.equal(afterRetry - beforeRetry, 1);
  });

  it("caps saved holds for idempotency and excludes save/repair on the same QA state", async () => {
    clearAdminAuthorPreviewsForTests();
    const pack = candidate("g5-modern-comedy");
    const plan = resolveOfficialAuthoringPlan(recommendOfficialAuthoringDirection("현대/일상"));
    for (let i = 0; i < 101; i += 1) {
      const saved = holdAdminAuthorManuscriptForTests({
        adminUserId: ADMIN.id,
        plan,
        world: pack.world,
        brief: pack.brief,
        bible: pack.bible,
      });
      markAdminAuthorPreviewSavedForTests(saved.previewId, 870_000 + i);
    }
    assert.ok(countAdminAuthorSavedHoldsForTests() > 100);
    const live = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: pack.bible,
    });
    const stored = await saveHeldAdminAuthorPreview(ADMIN, live.previewId);
    assert.equal(stored.ok, true);
    assert.ok(countAdminAuthorSavedHoldsForTests() <= 100);

    const qaFail = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: { ...pack.bible, greeting: `"당신?"` },
    });
    assert.equal(qaFail.qaOk, false);
    const blockedSave = await saveHeldAdminAuthorPreview(ADMIN, qaFail.previewId);
    assert.equal(blockedSave.ok, false);
    if (!blockedSave.ok) assert.equal(blockedSave.status, 409);

    const qaPass = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: pack.bible,
    });
    assert.equal(qaPass.qaOk, true);
    const blockedRepair = await repairHeldAdminAuthorPreview({
      adminUserId: ADMIN.id,
      previewId: qaPass.previewId,
      transport: {
        label: "must-not-call",
        async completeJson() {
          throw new Error("repair transport called");
        },
      },
    });
    assert.equal(blockedRepair.ok, false);
    if (!blockedRepair.ok) assert.equal(blockedRepair.error, "고칠 검수 오류가 없습니다.");
  });

  it("does not insert a second row when a post-INSERT save step throws and the same preview is retried", async () => {
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
    const db = getDb();
    const original = db.prepare.bind(db);
    let armed = true;
    db.prepare = ((sql: string) => {
      if (armed && sql.includes("adult_dialogue_profile")) {
        armed = false;
        throw new Error("post-insert adult profile update failed");
      }
      return original(sql);
    }) as typeof db.prepare;
    const countNamed = () =>
      (db.prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=? AND name=?").get(ADMIN.id, pack.draft.name) as { n: number }).n;
    const before = countNamed();
    let first: Awaited<ReturnType<typeof saveHeldAdminAuthorPreview>>;
    try {
      first = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    } finally {
      db.prepare = original as typeof db.prepare;
    }
    assert.equal(first.ok, false);
    if (!first.ok) {
      assert.equal(first.status, 409);
      assert.equal(first.partialSave, true);
      assert.equal(typeof first.characterId, "number");
    }
    assert.equal(countNamed() - before, 1);
    const retry = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(countNamed() - before, 1);
    assert.equal(retry.ok, false);
    if (!retry.ok && !first.ok) {
      assert.equal(retry.partialSave, true);
      assert.equal(retry.characterId, first.characterId);
    }
  });

  it("blocks re-INSERT and settles when post-INSERT throw overlaps recovery lookup failure", async () => {
    clearAdminAuthorPreviewsForTests();
    setAdminAuthorPrivateManuscriptLookupFailOnCallForTests(2);
    const pack = candidate("g5-modern-comedy");
    const plan = resolveOfficialAuthoringPlan(recommendOfficialAuthoringDirection("현대/일상"));
    const preview = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: pack.bible,
    });
    const db = getDb();
    const original = db.prepare.bind(db);
    let armed = true;
    db.prepare = ((sql: string) => {
      if (armed && sql.includes("adult_dialogue_profile")) {
        armed = false;
        throw new Error("post-insert adult profile update failed");
      }
      return original(sql);
    }) as typeof db.prepare;
    const countNamed = () =>
      (db.prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=? AND name=?").get(ADMIN.id, pack.draft.name) as { n: number }).n;
    const before = countNamed();
    let first: Awaited<ReturnType<typeof saveHeldAdminAuthorPreview>>;
    try {
      first = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    } finally {
      db.prepare = original as typeof db.prepare;
    }
    assert.equal(first.ok, false);
    if (!first.ok) {
      assert.equal(first.status, 409);
      assert.equal(first.characterId, undefined);
    }
    assert.equal(countNamed() - before, 1);
    const retry = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(retry.ok, false);
    if (!retry.ok) assert.equal(retry.status, 409);
    assert.equal(countNamed() - before, 1);
  });

  it("leaves a G2 create retry able to insert again after a post-INSERT throw", async () => {
    const pack = candidate("g5-modern-comedy");
    const draft = { ...pack.draft, name: `${pack.draft.name} G2` };
    const body = buildOfficialCharacterFormBody({ draft, appearanceBlock: "", assets: [] });
    const db = getDb();
    const original = db.prepare.bind(db);
    let armed = true;
    db.prepare = ((sql: string) => {
      if (armed && sql.includes("adult_dialogue_profile")) {
        armed = false;
        throw new Error("post-insert adult profile update failed");
      }
      return original(sql);
    }) as typeof db.prepare;
    const countNamed = () =>
      (db.prepare("SELECT COUNT(*) AS n FROM characters WHERE creator_id=? AND name=?").get(ADMIN.id, draft.name) as { n: number }).n;
    let threw = false;
    try {
      await createCharacterFromForm(ADMIN, body);
    } catch (error) {
      threw = error instanceof Error && /post-insert adult profile update failed/.test(error.message);
    } finally {
      db.prepare = original as typeof db.prepare;
    }
    assert.equal(threw, true);
    assert.equal(countNamed(), 1);
    const again = await createCharacterFromForm(ADMIN, body);
    assert.equal(again.ok, true);
    assert.equal(countNamed(), 2);
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
