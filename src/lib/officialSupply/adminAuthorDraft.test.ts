import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { CHARACTER_GENRES } from "@/lib/characterGenres";
import { canAccessCharacter, listableWhere } from "@/lib/characterVisibility";
import { createCharacterFromForm } from "@/lib/characterFormSave";
import { listCharacterCreatorLorebookAttachmentIds } from "@/lib/creatorLorebook";
import { getDb } from "@/lib/db";
import { resolveOfficialCharacterEditorAccess } from "@/lib/officialAdminAccess";
import { composeExampleDialog, parseSpeechCreatorFromBody } from "@/lib/speechCreatorFields";
import {
  adminAuthorPreviewFailureFromGateErrorForTests,
  assessAdminAuthorManuscript,
  clearAdminAuthorPreviewsForTests,
  comparisonCastForAdminGenre,
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
import {
  evaluateBriefCastFit,
  evaluateCastRoleDiversity,
  selectMarketSignals,
  type OfficialBatchMarketPolicy,
} from "@/lib/officialSupply/marketFit";
import type { ResearchSnapshot } from "@/lib/officialSupply/research";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
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
      async completeJson(input) {
        calls += 1;
        if (input.task === "character_experience") return fixtureExperienceCompletion();
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

const FIXTURE_EXPERIENCE_TEXT = JSON.stringify({
  desire: "무대에 서기 두려워하면서도 남을 웃기는 일을 그만두지 못한다",
  contradiction: "박수를 원하면서 칭찬을 받으면 농담으로 자리를 피한다",
  behavior: "긴장이 오면 먼저 짧은 농담을 던지고 그다음 자기 차례를 미룬다",
  incident: "오늘 밤 즉흥 무대의 순서가 비어 스스로 한 곡을 넣었다",
  tension: "처음 만난 상대가 그 빈 순서를 보았고 그녀는 먼저 말을 건다",
  daily: "낮에는 악보를 정리하고 밤에는 빈 연습실에서 혼자 리허설을 한다",
  cost: "순서를 미룰수록 자기가 설 자리가 다음 주로 밀린다",
  play: "같이 순서를 정하고 그녀의 농담 뒤에서 망설임을 보는 경험",
  voice: "짧은 반말과 과장된 리허설 용어로 겁을 숨긴다",
  firstAction: "마이크를 상대 쪽이 아니라 자기 악보 위에 내려놓는다",
});

function fixtureExperienceCompletion() {
  return {
    text: FIXTURE_EXPERIENCE_TEXT,
    model: "fixture",
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    providerRequestId: null,
  };
}

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
    const ordinary = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible: pack.bible,
    });
    assert.equal(ordinary.qaOk, true);
    assert.equal(ordinary.issues.some((issue) => issue.code === "sfw_public_text_has_adult_terms"), false);
    const bible = { ...pack.bible, greeting: `${pack.bible.greeting}\n사정했다` };
    const preview = holdAdminAuthorManuscriptForTests({
      adminUserId: ADMIN.id,
      plan,
      world: pack.world,
      brief: pack.brief,
      bible,
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
        if (input.task === "character_experience") return fixtureExperienceCompletion();
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
    assert.equal(calls, 7);
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
    assert.equal(fixture.getCalls(), 8, `transport calls=${fixture.getCalls()}`);
    if (!preview.ok) return;
    assert.equal(preview.experience?.desire, "무대에 서기 두려워하면서도 남을 웃기는 일을 그만두지 못한다");
    assert.equal(preview.manuscript.name, pack.draft.name);
    assert.equal(preview.manuscript.greeting, pack.draft.greeting);
    assert.equal(preview.creatorComment, pack.draft.creatorComment);
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

  it("does not start a world when the experience canon is incomplete", async () => {
    const tasks: string[] = [];
    const transport: OfficialAuthorTransport = {
      label: "blank-experience",
      async completeJson(input) {
        tasks.push(input.task);
        return { text: "{}", model: "fixture", inputTokens: 1, outputTokens: 1, costUsd: 0, providerRequestId: null };
      },
    };
    const preview = await previewAdminOfficialCharacter({ adminUserId: ADMIN.id, selection: autoModern, transport });
    assert.deepEqual(tasks, ["character_experience"]);
    assert.equal(preview.ok, false);
  });

  it("does not call character experience for romance fantasy", async () => {
    const tasks: string[] = [];
    const transport: OfficialAuthorTransport = {
      label: "rofan-stops-at-world",
      async completeJson(input) {
        tasks.push(input.task);
        return { text: "not-json", model: "fixture", inputTokens: 1, outputTokens: 1, costUsd: 0, providerRequestId: null };
      },
    };
    const preview = await previewAdminOfficialCharacter({
      adminUserId: ADMIN.id,
      selection: { ...autoModern, genre: "로맨스 판타지" },
      transport,
    });
    assert.deepEqual(tasks, ["world_bible"]);
    assert.equal(preview.ok, false);
  });

  it("returns world_lorebook_hidden from Atlas without a Portfolio call or a character row", async () => {
    const beforeCount = (getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n;
    let calls = 0;
    const transport: OfficialAuthorTransport = {
      label: "hidden-atlas",
      async completeJson(input) {
        calls += 1;
        if (input.task === "character_experience") return fixtureExperienceCompletion();
        if (calls === 2) {
          return {
            text: JSON.stringify({
              name: "테스트",
              centralPremise: "한 문장",
              factions: [{ name: "이웃" }],
            }),
            model: "fixture",
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            providerRequestId: null,
          };
        }
        return {
          text: JSON.stringify({
            lorebook: [
              {
                entryKey: "k1",
                name: "항목",
                keywords: ["a"],
                content: "세라핀의 진짜 정체는 적국의 공주다.",
              },
            ],
          }),
          model: "fixture",
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          providerRequestId: null,
        };
      },
    };
    const preview = await previewAdminOfficialCharacter({ adminUserId: ADMIN.id, selection: autoModern, transport });
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.error, "world bible failed QA");
    assert.equal(preview.stage, "world_atlas_qa");
    assert.equal(preview.issues?.[0]?.code, "world_lorebook_hidden");
    assert.equal(calls, 3);
    const afterCount = (getDb().prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number }).n;
    assert.equal(afterCount, beforeCount);
  });

  it("reopens a QA-pass imageless private draft from the studio query and keeps it off public lists", async () => {
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
    assert.equal(preview.qaOk, true);
    const missing = await saveHeldAdminAuthorPreview(ADMIN, "");
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.status, 404);
    const saved = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const form = buildOfficialCharacterFormBody({ draft: pack.draft, appearanceBlock: "", assets: [] });
    const db = getDb();
    const read = () =>
      db.prepare(
        `SELECT id, creator_id, name, tagline, description, greeting, system_prompt, world, example_dialog,
                creator_comment, visibility, official, assets, moderation_status, share_slug, content_kind
         FROM characters WHERE id=?`
      ).get(saved.characterId) as {
        id: number;
        creator_id: number;
        name: string;
        tagline: string;
        description: string;
        greeting: string;
        system_prompt: string;
        world: string;
        example_dialog: string;
        creator_comment: string;
        visibility: "public" | "link" | "private";
        official: number;
        assets: string;
        moderation_status: "pending" | "approved" | "rejected";
        share_slug: string | null;
        content_kind: string;
      };
    const row = read();
    const reloaded = read();
    assert.deepEqual(reloaded, row);
    assert.equal(row.creator_id, ADMIN.id);
    assert.equal(row.visibility, "private");
    assert.equal(row.official, 0);
    assert.equal(row.assets, "[]");
    assert.equal(row.content_kind, "character");
    assert.equal(row.name, form.name);
    assert.equal(row.tagline, form.tagline);
    assert.equal(row.description, form.description);
    assert.equal(row.greeting, form.greeting);
    assert.equal(row.system_prompt, form.system_prompt);
    assert.equal(row.world, form.world);
    assert.equal(row.creator_comment, form.creator_comment);
    assert.equal(row.example_dialog, composeExampleDialog(parseSpeechCreatorFromBody(form)));
    assert.deepEqual(listCharacterCreatorLorebookAttachmentIds(db, row.id), []);
    const listed = db.prepare(`SELECT id FROM characters WHERE ${listableWhere()} AND id=?`).get(row.id);
    assert.equal(listed, undefined);
    assert.equal(
      canAccessCharacter(
        {
          id: row.id,
          creator_id: row.creator_id,
          visibility: row.visibility,
          moderation_status: row.moderation_status,
          share_slug: row.share_slug,
          official: row.official,
        },
        USER.id
      ).ok,
      false
    );
    assert.equal(
      canAccessCharacter(
        {
          id: row.id,
          creator_id: row.creator_id,
          visibility: row.visibility,
          moderation_status: row.moderation_status,
          share_slug: row.share_slug,
          official: row.official,
        },
        ADMIN.id
      ).ok,
      true
    );
    const studio = db
      .prepare(
        `SELECT id FROM characters WHERE creator_id=? AND COALESCE(content_kind, 'character')='character'`
      )
      .all(ADMIN.id) as { id: number }[];
    assert.ok(studio.some((item) => item.id === row.id));
    const strangerStudio = db
      .prepare(
        `SELECT id FROM characters WHERE creator_id=? AND COALESCE(content_kind, 'character')='character'`
      )
      .all(USER.id) as { id: number }[];
    assert.equal(strangerStudio.some((item) => item.id === row.id), false);
    assert.equal(
      resolveOfficialCharacterEditorAccess(ADMIN, { id: row.id, official: row.official, creator_id: row.creator_id }),
      "owner"
    );
    assert.equal(
      resolveOfficialCharacterEditorAccess(USER, { id: row.id, official: row.official, creator_id: row.creator_id }),
      "forbidden"
    );
    const retry = await saveHeldAdminAuthorPreview(ADMIN, preview.previewId);
    assert.equal(retry.ok && retry.alreadySaved, true);
    assert.equal(retry.ok && retry.characterId, row.id);
  });
});

describe("G5-3E shared world projection runs before character calls", () => {
  it("fails on a projected-field user binding before character calls and does not save", async () => {
    clearAdminAuthorPreviewsForTests();
    const db = getDb();
    const before = db.prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number };
    const hidden = "운영실패복구금지토큰-비공개설정";
    const files = [
      "14-g5-horror-dry-world_bible.json",
      "15-g5-horror-dry-world_bible.json",
      "16-g5-horror-dry-world_bible.json",
      "17-g5-horror-dry-world_bible.json",
      "18-g5-horror-dry-character_bible_1.json",
      "19-g5-horror-dry-character_bible_voice.json",
      "20-g5-horror-dry-character_bible_bonds.json",
    ];
    const queue = files.map((file) => readJson<{ text: string }>(path.join(PROVIDER, file)).text);
    const core = JSON.parse(queue[0] ?? "{}") as { situation: { upcomingChange: string } };
    core.situation.upcomingChange = core.situation.upcomingChange.replace("세력은", "당신은");
    queue[0] = JSON.stringify(core);
    const atlas = JSON.parse(queue[1] ?? "{}") as {
      userEntry: { note: string };
      knowledge: { authorOnly: string[] };
    };
    atlas.userEntry.note = `${atlas.userEntry.note} 당신은 역할을 직접 고른다.`;
    atlas.knowledge.authorOnly = [...(atlas.knowledge.authorOnly ?? []), hidden];
    queue[1] = JSON.stringify(atlas);
    const tasks: string[] = [];
    const transport: OfficialAuthorTransport = {
      label: "g5-3e-projected-user-binding",
      async completeJson(input) {
        tasks.push(input.task);
        if (input.task === "character_experience") return fixtureExperienceCompletion();
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
    assert.deepEqual(tasks, ["character_experience", "world_bible"]);
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal("previewId" in preview, false);
    assert.equal(
      preview.error,
      "official shared world projection addresses or binds the user; entry guidance belongs to the character situation"
    );
    assert.equal(preview.worldProjection?.stage, "world_projection");
    assert.equal(preview.worldProjection?.code, "official_world_projection_user_binding");
    const hit = preview.worldProjection?.hits.find((item) => item.field === "situation.upcomingChange");
    assert.ok(hit);
    assert.match(hit?.excerpt ?? "", /당신은/);
    assert.ok((hit?.excerpt.length ?? 0) <= 80);
    assert.equal(
      preview.worldProjection?.hits.some((item) => /userEntry|authorOnly|portfolio|socialImpact|means/.test(item.field)),
      false
    );
    assert.ok(
      preview.issues?.some(
        (issue) =>
          issue.code === "official_world_projection_user_binding" &&
          issue.message.includes("world_projection situation.upcomingChange:") &&
          issue.message.includes("당신은")
      )
    );
    assert.equal(preview.rejectedManuscript, undefined);
    const wire = JSON.stringify(preview);
    assert.equal(wire.includes(hidden), false);
    assert.equal(wire.includes("OPENROUTER"), false);
    assert.equal(wire.includes("너는 "), false);
    const saved = await saveHeldAdminAuthorPreview(ADMIN, "world-projection-has-no-hold");
    assert.equal(saved.ok, false);
    if (!saved.ok) assert.equal(saved.status, 404);
    const after = db.prepare("SELECT COUNT(*) AS n FROM characters").get() as { n: number };
    assert.equal(after.n, before.n);
  });
});

const CAST_POLICY: OfficialBatchMarketPolicy = {
  targetLocale: "ko-KR",
  signalRegion: "KR",
  marketPriority: "domestic_first",
  maxSupportingSignals: 4,
  marketRoleMix: { proven: { min: 0, max: 1 }, proven_twist: { min: 0, max: 1 }, experimental: { min: 0, max: 1 } },
  maxPrimaryTropeRepeat: 1,
  coreTags: { min: 4, max: 7 },
  maxTaglineWorldTerms: 2,
};

describe("G5-3H cast contrast", () => {
  const pilotPortfolio = () =>
    readJson<{ bible: { portfolio: PortfolioBriefInput[] } }>(
      path.join(process.cwd(), "src/lib/officialSupply/pilot/world-bible.json")
    ).bible.portfolio;
  const researchSnapshot = () =>
    readJson<ResearchSnapshot>(path.join(process.cwd(), "docs/official-supply/market-research-snapshot-2026-09.json"));

  it("uses the pilot portfolio only for romance fantasy", () => {
    const pilot = pilotPortfolio();
    assert.equal(comparisonCastForAdminGenre(OFFICIAL_ROFAN_GENRE, pilot).length, pilot.length);
    assert.deepEqual(comparisonCastForAdminGenre(OFFICIAL_MODERN_DAILY_GENRE, pilot), []);
    assert.equal(
      pilot.some((brief) => brief.name.includes("박은지") || brief.name.includes("박서윤")),
      false
    );
    assert.ok(pilot.some((brief) => brief.name.startsWith("카엘룸")));
    const selection = selectMarketSignals(researchSnapshot(), CAST_POLICY, OFFICIAL_MODERN_DAILY_GENRE, {
      excludeRomanceLed: true,
    });
    assert.deepEqual(
      selection.primary.map((signal) => signal.signalId),
      ["global-08"]
    );
  });

  it("does not flag the public 박은지/박서윤 pair as a role clone and does not score a nickname against the rofan court", () => {
    const eunji = readJson<PortfolioBriefInput>(path.join(ROOT, "g5-modern-comedy-e/brief.json"));
    // G5-3F kept the public manuscript only. These fields are copied from that text, not from a saved portfolio brief.
    const seoyun: PortfolioBriefInput = {
      ...eunji,
      name: "박서윤",
      age: 29,
      archetype: "공유주방 수리비와 가족 청구를 기록으로 나누는 실무자",
      relationshipTrope: "아버지의 체면과 공동 비용 사이에서 기록을 맡는 사람",
      occupation: "공유주방 운영 실무자이자 반찬 납품 보조",
      faction: "동네 공유주방 운영모임",
      socialPosition: "재개발 전까지 임시 사용 승인을 갱신하는 운영 실무자",
      personalityCore:
        "예약과 비용을 날짜와 이름으로 정리하고, 떠넘겨진 일은 기록한 뒤 다음 담당자를 정한다. 건조한 농담으로 회의를 낮추지만 책임을 지우지는 않는다.",
      visualSilhouette:
        "163cm. 검은색에 가까운 짙은 갈색 머리를 낮게 묶고 소매를 걷은 셔츠와 실용적인 앞치마를 입는다. 손등은 설거지로 건조하고 왼손 엄지에는 잉크가 묻는다.",
      rpHook:
        "공동 싱크대 수리비를 정하는 아침, 아버지 태식은 예약표 실수를 서윤의 무능이라고 몰아붙이고 바자회장에 식당 간판을 달겠다고 나선다. 서윤은 식당이 보탠 재료와 설거지 노동을 게시판에 적고, 당신에게 수리비와 준비 분담을 기록으로 맞춰 보자고 한다.",
      speechDirection: "건조한 농담으로 회의의 열기를 낮추지만 책임을 농담으로 지우지 않는다. 영수증과 숫자부터 맞춘다.",
    };
    const roleCodes = ["cast_occupation_clone", "cast_hook_clone", "cast_silhouette_clone", "cast_speech_clone"];
    const pair = evaluateCastRoleDiversity([
      { ...eunji, draftKey: eunji.name },
      { ...seoyun, draftKey: seoyun.name },
    ]);
    assert.deepEqual(
      pair.errors.map((error) => error.code),
      []
    );
    const pilot = pilotPortfolio();
    const snapshot = researchSnapshot();
    const againstPilot = evaluateBriefCastFit({
      fresh: [seoyun],
      kept: pilot,
      snapshot,
      policy: CAST_POLICY,
      namingProfile: "korean_modern",
    });
    assert.equal(
      againstPilot.errors.some((error) => roleCodes.some((code) => error.includes(code))),
      false
    );
    const againstSibling = evaluateBriefCastFit({
      fresh: [seoyun],
      kept: [eunji],
      snapshot,
      policy: CAST_POLICY,
      namingProfile: "korean_modern",
    });
    assert.equal(
      againstSibling.errors.some((error) => roleCodes.some((code) => error.includes(code))),
      false
    );
    const distinct = evaluateCastRoleDiversity([
      { ...eunji, draftKey: eunji.name },
      {
        ...eunji,
        draftKey: "한겨울",
        name: "한겨울",
        occupation: "심야 고속버스 기사",
        archetype: "밤길 운전사",
        socialPosition: "배차 기사",
        rpHook: "막차 정류장에서 놓친 짐을 같이 찾는다.",
        visualSilhouette: "짧은 은발과 형광 조끼.",
        speechDirection: "느린 사투리로 도로 상황을 말한다.",
      },
    ]);
    assert.deepEqual(
      distinct.errors.map((error) => error.code),
      []
    );
    const princess: PortfolioBriefInput = {
      ...eunji,
      name: "강나리 (공주님)",
      archetype: "공주님이라고 불리는 현장 수습꾼",
    };
    const court = evaluateBriefCastFit({
      fresh: [princess],
      kept: pilot,
      snapshot,
      policy: CAST_POLICY,
      namingProfile: "korean_modern",
    });
    assert.ok(court.errors.some((error) => error.includes("cast_royal_density")));
    const filtered = evaluateBriefCastFit({
      fresh: [princess],
      kept: comparisonCastForAdminGenre(OFFICIAL_MODERN_DAILY_GENRE, pilot),
      snapshot,
      policy: CAST_POLICY,
      namingProfile: "korean_modern",
    });
    assert.equal(
      filtered.errors.some((error) => error.includes("cast_royal_density")),
      false
    );
  });
});

describe("G5-3M-1 admin preview failure stage mapping", () => {
  const atlasQa = {
    ok: false as const,
    errors: [{ code: "world_lorebook_hidden", message: "lorebook[0] contains hidden-knowledge wording" }],
  };

  it("keeps Atlas early QA at world_atlas_qa", () => {
    const error = new OfficialSupplyGateError("author_world_rejected", "world bible failed QA", atlasQa);
    error.stage = "world_atlas_qa";
    const preview = adminAuthorPreviewFailureFromGateErrorForTests(error);
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.stage, "world_atlas_qa");
    assert.equal(preview.issues?.[0]?.code, "world_lorebook_hidden");
  });

  it("labels final World QA merge failures as world_bible_qa", () => {
    const error = new OfficialSupplyGateError("author_world_rejected", "world bible failed QA", atlasQa);
    const preview = adminAuthorPreviewFailureFromGateErrorForTests(error);
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.stage, "world_bible_qa");
  });

  it("does not label Voice QA failures as world_bible_qa", () => {
    const voiceQa = {
      ok: false as const,
      errors: [{ code: "voice_structure_tagline", message: "tagline required" }],
    };
    const error = new OfficialSupplyGateError("author_voice_rejected", "character_bible_voice: tagline", voiceQa);
    const preview = adminAuthorPreviewFailureFromGateErrorForTests(error);
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal("stage" in preview, false);
    assert.equal(preview.issues?.[0]?.code, "voice_structure_tagline");
  });

  it("does not label public manuscript or relation QA as world_bible_qa", () => {
    const pubQa = {
      ok: false as const,
      errors: [{ code: "public_description_user_binding", message: "binding" }],
    };
    const pub = new OfficialSupplyGateError(
      "author_public_manuscript_invalid",
      "author_public_manuscript_invalid: binding",
      pubQa,
      { greeting: "hi", description: "bind", comment: "c" }
    );
    const pubPreview = adminAuthorPreviewFailureFromGateErrorForTests(pub);
    assert.equal(pubPreview.ok, false);
    if (pubPreview.ok) return;
    assert.equal("stage" in pubPreview, false);
    assert.ok(pubPreview.rejectedManuscript);

    const relQa = {
      ok: false as const,
      errors: [{ code: "user_relation_premise", message: "bad relation" }],
    };
    const rel = new OfficialSupplyGateError("author_user_relation_mismatch", "premise mismatch", relQa);
    const relPreview = adminAuthorPreviewFailureFromGateErrorForTests(rel);
    assert.equal(relPreview.ok, false);
    if (relPreview.ok) return;
    assert.equal("stage" in relPreview, false);
  });

  it("omits a false top-level stage when only worldProjection is known", () => {
    const error = new OfficialSupplyGateError(
      "official_world_projection_user_binding",
      "official shared world projection addresses or binds the user; entry guidance belongs to the character situation",
      {
        ok: false,
        errors: [{ code: "official_world_projection_user_binding", message: "world_projection situation.upcomingChange: 당신은" }],
      },
      undefined,
      {
        stage: "world_projection",
        code: "official_world_projection_user_binding",
        hits: [{ field: "situation.upcomingChange", excerpt: "당신은" }],
      }
    );
    const preview = adminAuthorPreviewFailureFromGateErrorForTests(error);
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal("stage" in preview, false);
    assert.equal(preview.worldProjection?.stage, "world_projection");
    const wire = JSON.stringify(preview);
    assert.equal(wire.includes("authorOnly"), false);
    assert.equal(wire.includes("lorebook"), false);
  });
});
