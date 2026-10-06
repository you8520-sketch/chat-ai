import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  createCharacterFromForm,
  updateCharacterFromForm,
  type SessionUser,
} from "@/lib/characterFormSave";
import { getDb } from "@/lib/db";
import {
  compileOfficialDraftFromBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import {
  buildOfficialCharacterFormBody,
  composeOfficialSystemPrompt,
  evaluateOfficialTextLength,
  officialSubstantiveCharCount,
} from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { resolveOfficialCharacterLorebooks } from "@/lib/officialSupply/lorebookAttach";
import {
  composeOfficialCurrentSituation,
  ensureOfficialSharedWorldLibraryRow,
  OFFICIAL_SHARED_WORLD_LIBRARY_NAME,
  projectOfficialSharedWorld,
} from "@/lib/officialSupply/officialSharedWorld";
import type { OfficialCharacterDraft, OfficialWorldLorebookEntry } from "@/lib/officialSupply/types";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { estimateTokens } from "@/lib/tokenEstimate";
import { buildCombinedCharacterSettingSource } from "@/utils/characterParser";
import { resolveWorldSelectionForUser } from "@/lib/worldLibrary";
import { matchExplicitSectionHeading } from "@/lib/characterSettingSections";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

/** Frozen compact_rp_v1 World snapshot before this fix — personalSituation + userEntry. */
const LUCIAN_BEFORE_WORLD_PROJECTION =
  "루시안은 메르카토르 골드 길드의 비밀 회계사이면서 지하 암시장 중개인이다. 공개 장부와 별도로 숨긴 기록이 있으며, 그 내용은 쉽게 드러내지 않는다. 최근 증권거래소 지하 금고에서 장부와 농축 에테르가 연달아 사라졌고, 루시안은 범인을 찾기 위해 직접 금고에 들어왔다가 경보에 걸린다.\n\n증권거래소 지하 금고에서 경보가 울린 순간, 루시안과 당신은 같은 탈출구 앞에 얽힌다. 당장 경비를 피할 움직임은 각자 정해야 하며, 누가 왜 금고에 들어왔는지는 대화와 각자의 설정 속에서 드러난다.";

type PilotChar = {
  draftKey: string;
  brief: {
    archetype: string;
    relationshipTrope: string;
    occupation: string;
    rpHook: string;
    audience: OfficialCharacterDraft["audience"];
  };
  bible: OfficialCharacterBible;
  characterLorebook?: OfficialWorldLorebookEntry[];
  draft: OfficialCharacterDraft;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function worldBible(): OfficialWorldBible {
  return readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json")).bible;
}

function lucianFile(): PilotChar {
  return readJson<PilotChar>(path.join(PILOT_DIR, "characters", "pilot-rf-03.json"));
}

function compileKeys(file: PilotChar) {
  const manifest = readJson<{ worldKey: string; styleKey: string }>(path.join(PILOT_DIR, "manifest.json"));
  const world = worldBible();
  return {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"] as OfficialCharacterDraft["genres"],
    audience: file.brief.audience,
    worldName: world.name,
    worldBible: world,
    hook: {
      archetype: file.brief.archetype,
      relationshipTrope: file.brief.relationshipTrope,
      occupation: file.brief.occupation,
      rpHook: file.brief.rpHook,
    },
  };
}

function compileLucian() {
  const file = lucianFile();
  return { file, draft: compileOfficialDraftFromBible(file.bible, compileKeys(file)), world: worldBible() };
}

function session(id: number, nickname: string): SessionUser {
  return { id, nickname, is_adult: 1 };
}

function seedUser(id: number, nickname: string): SessionUser {
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
    )
    .run(id, `${nickname}@test.local`, nickname, "hash");
  return session(id, nickname);
}

function longPrompt(seed: string): string {
  return `${seed} ${"설정".repeat(800)}`;
}

function ordinaryCharacterBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "character",
    name: "일반 캐릭터",
    tagline: "한 줄 소개",
    description: "공개 소개",
    greeting: "안녕",
    system_prompt: longPrompt("본체"),
    world: "",
    speech_personality: "말투".repeat(250),
    speech_traits: "말투".repeat(250),
    speech_examples: "말투".repeat(40),
    speech_forbidden: "",
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral", representativeRank: 1 }],
    ...overrides,
  };
}

describe("official shared world owner — BEFORE vs AFTER", () => {
  it("BEFORE: compact_rp_v1 World was personalSituation + userEntry (wrong projection)", () => {
    const file = lucianFile();
    const local = composeOfficialCurrentSituation({
      personalSituation: file.bible.situation.personalSituation,
      userEntry: file.bible.situation.userEntry,
    });
    assert.equal(LUCIAN_BEFORE_WORLD_PROJECTION, local);
    assert.match(LUCIAN_BEFORE_WORLD_PROJECTION, /루시안은 메르카토르 골드 길드의 비밀 회계사/);
    assert.match(LUCIAN_BEFORE_WORLD_PROJECTION, /증권거래소 지하 금고에서 경보가 울린 순간/);
    assert.doesNotMatch(LUCIAN_BEFORE_WORLD_PROJECTION, /에테르노스 제국은/);
    assert.doesNotMatch(LUCIAN_BEFORE_WORLD_PROJECTION, /의무 결속령/);
    assert.ok(worldBible().era.length > 0);
    assert.ok(worldBible().lorebook.length >= 8);
    assert.equal(
      "WRONG WORLD PROJECTION",
      LUCIAN_BEFORE_WORLD_PROJECTION.includes(file.bible.situation.personalSituation)
        ? "WRONG WORLD PROJECTION"
        : "MISSING WORLD DATA"
    );
  });

  it("A: compact_rp_v1 keeps canonical shared Ethernos identity in World", () => {
    const { file, draft, world } = compileLucian();
    const projected = projectOfficialSharedWorld(world);
    assert.equal(draft.sections.worldAndSituation, projected);
    assert.match(draft.sections.worldAndSituation, /에테르노스 제국/);
    assert.match(draft.sections.worldAndSituation, /공허의 밤/);
    assert.match(draft.sections.worldAndSituation, /태양의 옥좌/);
    assert.match(draft.sections.worldAndSituation, /발켄하임/);
    assert.match(draft.sections.worldAndSituation, /메르카토르/);
    assert.match(draft.sections.worldAndSituation, /판도라/);
    assert.match(draft.sections.worldAndSituation, /의무 결속령/);
    assert.doesNotMatch(draft.sections.worldAndSituation, /루시안/);
    assert.equal(draft.sections.worldAndSituation.includes(file.bible.situation.personalSituation), false);
    assert.equal(draft.sections.worldAndSituation.includes(file.bible.situation.userEntry), false);
    assert.doesNotMatch(draft.sections.worldAndSituation, /황제는 이미 거동이|수도로 진격|인위적으로 부추|건국 당시의 원죄|고대 신의 유해|세계의 리셋/);
  });

  it("C: Lucian local vault incident lives in currentSituation exactly once", () => {
    const { file, draft } = compileLucian();
    const local = composeOfficialCurrentSituation({
      personalSituation: file.bible.situation.personalSituation,
      userEntry: file.bible.situation.userEntry,
    });
    assert.equal(draft.sections.currentSituation, local);
    const systemPrompt = composeOfficialSystemPrompt(draft);
    assert.match(systemPrompt, /\[현재 상황 \/ 도입\]/);
    assert.equal(systemPrompt.split(local).length - 1, 1);
    assert.equal(draft.sections.worldAndSituation.includes(local), false);
    assert.notEqual(draft.greeting, local);
    assert.equal(matchExplicitSectionHeading("[현재 상황 / 도입]")?.label, "현재 상황 / 도입");
  });

  it("B: two compact Ethernos characters resolve the same shared World body", () => {
    const lucian = compileLucian();
    const siblingBible: OfficialCharacterBible = {
      ...lucian.file.bible,
      identity: { ...lucian.file.bible.identity, name: "세컨드" },
      publicProfile: { ...lucian.file.bible.publicProfile, tagline: "두 번째 공식 시트" },
      situation: {
        worldContext: lucian.file.bible.situation.worldContext,
        personalSituation: "세컨드는 태양궁 유리온실에서 비공식 접견을 기다린다.",
        userEntry: "당신은 접견 대기실에서 그와 마주친다. 먼저 말을 걸지는 당신이 정한다.",
      },
      greeting: "유리온실 문이 열렸다. 세컨드가 당신을 보고 가볍게 목례했다.",
    };
    const sibling = compileOfficialDraftFromBible(siblingBible, {
      ...compileKeys(lucian.file),
      draftKey: "pilot-rf-second",
    });
    assert.equal(sibling.sections.worldAndSituation, lucian.draft.sections.worldAndSituation);
    assert.notEqual(sibling.sections.currentSituation, lucian.draft.sections.currentSituation);
    assert.match(sibling.sections.currentSituation ?? "", /태양궁 유리온실/);
    assert.match(lucian.draft.sections.currentSituation ?? "", /증권거래소 지하 금고/);
  });

  it("D: shared lorebooks stay shared and are not dumped into World", () => {
    const { file, draft, world } = compileLucian();
    const resolved = resolveOfficialCharacterLorebooks(world.lorebook, file.characterLorebook);
    assert.equal(resolved.length, 12);
    assert.equal(resolved.filter((entry) => entry.entryKey === "mercator_guild").length, 1);
    for (const entry of world.lorebook) {
      assert.equal(draft.sections.worldAndSituation.includes(entry.content), false, entry.entryKey);
    }
  });

  it("compact compile without a world bible fails closed", () => {
    const file = lucianFile();
    const keys = compileKeys(file);
    delete (keys as { worldBible?: OfficialWorldBible }).worldBible;
    assert.throws(
      () => compileOfficialDraftFromBible(file.bible, keys),
      (error: unknown) =>
        error instanceof Error && /compact_rp_v1 requires the shared OfficialWorldBible/.test(error.message)
    );
  });

  it("H: normal assembly consumes the same resolved World snapshot", () => {
    const { draft } = compileLucian();
    const systemPrompt = composeOfficialSystemPrompt(draft, "키/체형: 184cm");
    const combined = buildCombinedCharacterSettingSource({
      systemPrompt,
      world: draft.sections.worldAndSituation,
      characterName: draft.name,
      gender: "male",
    });
    assert.match(combined, /\[세계관\]\n에테르노스 제국/);
    assert.match(combined, /\[현재 상황 \/ 도입\]/);
    assert.equal((combined.match(/\[세계관\]/g) ?? []).length, 1);
    assert.equal((combined.match(/\[현재 상황 \/ 도입\]/g) ?? []).length, 1);
    const chat = fs.readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    const assembly = fs.readFileSync(
      path.join(process.cwd(), "src/services/nextTurnAssemblyPreparation.ts"),
      "utf8"
    );
    assert.match(chat, /world: ch\.world/);
    assert.match(assembly, /world: String\(character\.world/);
    assert.match(assembly, /world: source\.character\.world/);
  });

  it("I: Lucian identity/speech/greeting stay character-local and unchanged by World split", () => {
    const { file, draft } = compileLucian();
    assert.equal(draft.name, "루시안 바스케스");
    assert.equal(draft.greeting, file.bible.greeting);
    assert.equal(draft.sections.characterCore, file.draft.sections.characterCore);
    assert.equal(draft.sections.relationshipsAndDrives, file.draft.sections.relationshipsAndDrives);
    assert.deepEqual(draft.secrets, file.draft.secrets);
    assert.equal(draft.speech.personality, file.draft.speech.personality);
  });

  it("PHASE 8: AFTER prompt budget grows by shared world, not by deleting identity", () => {
    const { file, draft } = compileLucian();
    const beforeWorld = LUCIAN_BEFORE_WORLD_PROJECTION;
    const beforeDraft: OfficialCharacterDraft = {
      ...file.draft,
      sections: { ...file.draft.sections, worldAndSituation: beforeWorld },
    };
    const beforeChars = officialSubstantiveCharCount(beforeDraft);
    const afterChars = officialSubstantiveCharCount(draft);
    const worldDelta = draft.sections.worldAndSituation.length - beforeWorld.length;
    const situationDelta = (draft.sections.currentSituation ?? "").length;
    const tokenDelta = estimateTokens(draft.sections.worldAndSituation) - estimateTokens(beforeWorld);
    assert.ok(draft.sections.worldAndSituation.length >= 1500);
    assert.ok(draft.sections.worldAndSituation.length <= 2300);
    assert.ok(afterChars > beforeChars);
    assert.ok(worldDelta > 800, `world delta ${worldDelta}`);
    assert.ok(situationDelta > 100);
    assert.equal(draft.sections.characterCore, beforeDraft.sections.characterCore);
    const lengthQa = evaluateOfficialTextLength(draft);
    assert.equal(lengthQa.ok, true, JSON.stringify(lengthQa.errors));
    assert.ok(!lengthQa.errors.some((issue) => issue.code === "text_exceeds_canonical_ceiling"));
    process.stdout.write(
      `\nOFFICIAL_SHARED_WORLD_TOKEN_DELTA chars:${afterChars - beforeChars} worldChars:${worldDelta} situationChars:${situationDelta} worldTokens:${tokenDelta}\n`
    );
  });
});

describe("official shared world library reuse", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    const db = getDb();
    db.exec(`
      DELETE FROM character_lorebook_attachments;
      DELETE FROM characters;
      DELETE FROM worlds;
      DELETE FROM users WHERE email LIKE '%@test.local' OR email LIKE '%@site-managed.invalid';
    `);
  });

  it("B+E: one studio World row is reused; ordinary creator worlds stay isolated", () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "공식스튜디오",
      email: "official-studio@site-managed.invalid",
    });
    const world = worldBible();
    const first = ensureOfficialSharedWorldLibraryRow({
      db: getDb(),
      creatorId: studio.id,
      bible: world,
    });
    const second = ensureOfficialSharedWorldLibraryRow({
      db: getDb(),
      creatorId: studio.id,
      bible: world,
    });
    assert.equal(first.worldId, second.worldId);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.name, OFFICIAL_SHARED_WORLD_LIBRARY_NAME);
    const resolved = resolveWorldSelectionForUser(studio.id, { worldId: first.worldId });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.worldId, first.worldId);
    assert.equal(resolved.content, first.content);

    const ordinary = seedUser(4401, "ordinary-creator");
    const ordinaryWorldId = Number(
      getDb()
        .prepare(
          `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
           VALUES (?, '내 세계', '요약', '직접 쓴 세계관', datetime('now'))`
        )
        .run(ordinary.id).lastInsertRowid
    );
    const denied = resolveWorldSelectionForUser(ordinary.id, { worldId: first.worldId });
    assert.equal(denied.ok, false);
    const owned = resolveWorldSelectionForUser(ordinary.id, { worldId: ordinaryWorldId });
    assert.equal(owned.ok, true);
    if (owned.ok) assert.equal(owned.content, "직접 쓴 세계관");
  });

  it("E+F: direct manual world input remains detached from World Library", async () => {
    const user = seedUser(4402, "direct-input");
    const saved = await createCharacterFromForm(
      user,
      ordinaryCharacterBody({
        name: "직접입력",
        world: "손으로 쓴 세계관 본문",
        world_library_ref: "",
      })
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const row = getDb()
      .prepare("SELECT world, world_id FROM characters WHERE id=?")
      .get(saved.id) as { world: string; world_id: number | null };
    assert.equal(row.world, "손으로 쓴 세계관 본문");
    assert.equal(row.world_id, null);
  });

  it("G: borrowed World still snapshots without attaching world_id", async () => {
    const owner = seedUser(4403, "borrow-owner");
    const borrower = seedUser(4404, "borrower");
    const worldId = Number(
      getDb()
        .prepare(
          `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
           VALUES (?, '공유세계', '요약', '빌린 세계 본문', datetime('now'))`
        )
        .run(owner.id).lastInsertRowid
    );
    const share = getDb()
      .prepare(
        `INSERT INTO world_shares (share_slug, user_id, world_id, name, summary, content)
         VALUES ('slug-shared-world', ?, ?, '공유세계', '요약', '빌린 세계 본문')`
      )
      .run(owner.id, worldId);
    const shareId = Number(share.lastInsertRowid);
    const borrow = getDb()
      .prepare(`INSERT INTO world_borrows (user_id, world_share_id) VALUES (?, ?)`)
      .run(borrower.id, shareId);
    const borrowId = Number(borrow.lastInsertRowid);
    const saved = await createCharacterFromForm(
      borrower,
      ordinaryCharacterBody({
        name: "빌린세계캐",
        world_library_ref: `borrow:${borrowId}`,
        world: "클라이언트가 보낸 가짜 본문",
      })
    );
    assert.equal(saved.ok, true, saved.ok ? "" : saved.error);
    if (!saved.ok) return;
    const row = getDb()
      .prepare("SELECT world, world_id, source_world_share_id FROM characters WHERE id=?")
      .get(saved.id) as {
      world: string;
      world_id: number | null;
      source_world_share_id: number | null;
    };
    assert.equal(row.world, "빌린 세계 본문");
    assert.equal(row.world_id, null);
    assert.equal(row.source_world_share_id, shareId);
  });

  it("J: official form body keeps World Library link and does not write local situation into World", async () => {
    const studio = createSiteManagedStudioAccount({
      nickname: "공식스튜디오2",
      email: "official-studio-2@site-managed.invalid",
    });
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const shared = ensureOfficialSharedWorldLibraryRow({
      db: getDb(),
      creatorId: studio.id,
      bible: source.worldBible,
    });
    const body = buildOfficialCharacterFormBody({
      draft: source.draft,
      appearanceBlock: source.appearanceBlock,
      assets: [
        { url: "/uploads/official-lucian.webp", tag: "대표", width: 1024, height: 1536, viewerBlur: false },
      ],
      worldId: shared.worldId,
    });
    const owner: SessionUser = {
      id: studio.id,
      nickname: studio.nickname,
      email: studio.email,
      is_adult: 1,
    };
    const created = await createCharacterFromForm(owner, body);
    assert.equal(created.ok, true, created.ok ? "" : created.error);
    if (!created.ok) return;
    const before = getDb()
      .prepare("SELECT world, world_id, system_prompt FROM characters WHERE id=?")
      .get(created.id) as { world: string; world_id: number | null; system_prompt: string };
    assert.equal(before.world_id, shared.worldId);
    assert.equal(before.world, source.draft.sections.worldAndSituation);
    assert.match(before.system_prompt, /\[현재 상황 \/ 도입\]/);
    assert.doesNotMatch(before.world, /루시안은 메르카토르 골드 길드의 비밀 회계사/);

    const savedAgain = await updateCharacterFromForm(owner, created.id, {
      ...body,
      world_library_ref: `world:${shared.worldId}`,
      world_id: shared.worldId,
      world: source.draft.sections.worldAndSituation,
    });
    assert.equal(savedAgain.ok, true, savedAgain.ok ? "" : savedAgain.error);
    const after = getDb()
      .prepare("SELECT world, world_id, system_prompt FROM characters WHERE id=?")
      .get(created.id) as { world: string; world_id: number | null; system_prompt: string };
    assert.equal(after.world_id, shared.worldId);
    assert.equal(after.world, source.draft.sections.worldAndSituation);
    assert.equal(after.system_prompt.includes(source.draft.sections.currentSituation ?? ""), true);
  });
});
