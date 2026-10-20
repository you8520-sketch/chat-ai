import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  characterSettingInputForRow,
  loadCharacterChunksForPromptReadOnly,
  type CharacterSettingRow,
} from "@/lib/characterChunks";
import { createCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { getDb } from "@/lib/db";
import {
  compileOfficialDraftFromBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import {
  buildOfficialCharacterFormBody,
  computeTextLockHash,
  evaluateOfficialStagedSaveLength,
  officialRpSettingOverflowChars,
} from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { WOLFGANG_IN_PLACE_TARGET } from "@/lib/officialSupply/inPlaceWolfgang";
import {
  ensureOfficialSharedWorldLibraryRow,
  findOfficialSharedWorldLibraryRow,
  officialDraftUsesSharedWorld,
  projectOfficialSharedWorld,
} from "@/lib/officialSupply/officialSharedWorld";
import {
  composeOfficialCreatorComment,
  evaluateOfficialCreatorComment,
  evaluateOfficialPublicDescription,
} from "@/lib/officialSupply/publicProfileText";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";
import { createSiteManagedStudioAccount } from "@/lib/siteManagedAccounts";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { characterSettingSourceOverflowChars } from "@/utils/characterParser";
import { buildPrivateSpeechControlBlock, parseCreatorDescriptionCompiled } from "@/lib/creatorDescriptionTriggerCompiler";
import { buildContext } from "@/services/contextBuilder";
import { CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL } from "@/lib/chatModels";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const SHARED_WORLD_KEYS = ["pilot-rf-03", "pilot-rf-02"] as const;

/** SHA-256 of JSON.stringify(field) taken from the Lucian draft before the world/intro rework. */
const LUCIAN_PRE_CHANGE_SHA256: Record<string, string> = {
  name: "c6056d1576e65373894fdbec0efd19ff9e547a1d5ed94fceecb1e41be7ede863",
  tagline: "303d72908a9c05c967e3dd4ffb3913a5e4af513a0dd6b5158699c61e16fcafe1",
  greeting: "e3c4fb2b76c928e7a45094bd5f8e1d99e67fe785cc7982123612008b8f3ba4e6",
  gender: "5ab8d93f4798e69a129a5f26c9164ef4ceec62d23a8cc60293c73d7771c24290",
  age: "59e19706d51d39f66711c2653cd7eb1291c94d9b55eb14bda74ce4dc636d015a",
  genres: "6a836239f36f76b72e1cbab6b266a41f586119095b7a7a1822df7f3de70ec8bb",
  speech: "d4a258966f4d3a75eb013c6a1a034df48deffa092445b6e05b70c2453387ee7d",
  supportingNpcs: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  secrets: "6cdfebd6bb8f240f3a1faa762b134507679716cf93b3856fcc389a93a6c3b533",
  adult: "40c21aa4f887bf9e5385fe13f41aa9fa74f4f7c8d160ae34b1d38271779df4bd",
  "sections.characterCore": "d0f7b5a04cb96bab465f3a5ca0974ff4384f83469982c40f47f2aaa5456e589e",
  "sections.extraCanon": "12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126",
};

type PilotFile = {
  draftKey: string;
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function pilotFile(key: string): PilotFile {
  return readJson<PilotFile>(path.join(PILOT_DIR, "characters", `${key}.json`));
}

function worldBible(): OfficialWorldBible {
  return readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json")).bible;
}

const squash = (text: string): string => text.replace(/\s+/g, "");

/** Mirrors the sentence boundary of `compileCreatorDescriptionTriggers`, which may route a fragment to the private speech block. */
const COMPILER_SENTENCE_BOUNDARY = /(?<=[.!?。！？다요])\s+/;

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("official shared world: bible -> projection -> drafts is one canon", () => {
  it("compiles the same shared world body from the single bible for Lucian and Wolfgang", () => {
    const projected = projectOfficialSharedWorld(worldBible());
    for (const key of SHARED_WORLD_KEYS) {
      const source = loadCompiledOfficialCharacterSource(key);
      assert.equal(source.draft.sections.worldAndSituation, projected, `${key}: compiled world`);
      assert.equal(pilotFile(key).draft.sections.worldAndSituation, projected, `${key}: stored draft snapshot`);
      assert.equal(officialDraftUsesSharedWorld(source.draft), true, `${key}: attaches to the World Library row`);
    }
    assert.ok(projected.length >= 2000 && projected.length <= 3000, `shared world length ${projected.length}`);
  });

  it("keeps the user and per-character incidents out of the shared world", () => {
    const projected = projectOfficialSharedWorld(worldBible());
    assert.doesNotMatch(projected, /당신|유저|플레이어/);
    for (const key of SHARED_WORLD_KEYS) {
      const { draft, bible } = { draft: loadCompiledOfficialCharacterSource(key).draft, bible: pilotFile(key).bible };
      assert.equal(projected.includes(bible.situation.personalSituation), false, `${key}: personal situation`);
      assert.equal(projected.includes(bible.situation.userEntry), false, `${key}: user entry`);
      assert.ok((draft.sections.currentSituation ?? "").trim().length > 0, `${key}: currentSituation owns the incident`);
    }
  });

  it("D1-D4: one consistent Valkenheim canon in the shared world", () => {
    const projected = projectOfficialSharedWorld(worldBible());
    assert.match(projected, /병상에 누운 전대공 '알렉세이 폰 발켄하임'\('전장의 늑대'로 불리던 선대 가주\)/);
    assert.match(projected, /현 가주 대공이 북부 방벽 사령관으로서 연맹을 이끎/);
    assert.equal(occurrences(projected, "전장의 늑대"), 1);
    assert.match(projected, /적들은 현 가주 대공을 '전장의 도살자'라 부르며/);
    assert.equal(occurrences(projected, "전장의 도살자"), 1);
    assert.match(projected, /공공연한 적대는 발켄하임 가문의 정치적 입장일 뿐, 개별 지휘관이 황실 명령을 어떻게 이행하느냐는 각자의 판단/);
    assert.match(projected, /북부 광산에서 나오나 정제는 중앙 정제탑에 의존해 왔기에 북부도 보급과 배급난을 겪으며/);
  });

  it("D1-D4: Wolfgang's own surfaces never reassign the epithets or the dukedom", () => {
    const wolfgang = loadCompiledOfficialCharacterSource("pilot-rf-02").draft;
    const surfaces = [
      wolfgang.description,
      wolfgang.greeting,
      wolfgang.sections.currentSituation ?? "",
      wolfgang.sections.characterCore,
      wolfgang.sections.relationshipsAndDrives,
      composeOfficialCreatorComment(wolfgang),
    ].join("\n");
    assert.match(wolfgang.description, /현 대공은 적들 사이에서 '전장의 도살자'로 불린다/);
    assert.match(wolfgang.description, /병상에 누운 전대공 알렉세이는 '전장의 늑대'로 불렸고/);
    for (const sentence of surfaces.split(/(?<=[.!?。])\s+|\n/)) {
      if (sentence.includes("전장의 늑대")) assert.match(sentence, /알렉세이|선대 가주/, sentence);
      if (/알렉세이/.test(sentence)) assert.doesNotMatch(sentence, /현 가주 대공이 북부 방벽 사령관|알렉세이는 현/, sentence);
    }
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03").draft;
    assert.doesNotMatch(
      [lucian.description, lucian.greeting, lucian.sections.characterCore, lucian.sections.currentSituation].join("\n"),
      /전장의 (늑대|도살자)/
    );
  });
});

describe("official shared world: manuscripts keep what was not meant to change", () => {
  it("Lucian keeps secrets, greeting, speech and core byte-identical while dropping the user-relation essay", () => {
    const draft = loadCompiledOfficialCharacterSource("pilot-rf-03").draft;
    assert.equal(draft.promptStandard, "compact_rp_v1");
    const sha = (value: unknown): string => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
    for (const [field, expected] of Object.entries(LUCIAN_PRE_CHANGE_SHA256)) {
      const value = field.startsWith("sections.")
        ? draft.sections[field.slice("sections.".length) as keyof OfficialCharacterDraft["sections"]]
        : draft[field as keyof OfficialCharacterDraft];
      assert.equal(sha(value), expected, `Lucian ${field} changed`);
    }
    assert.equal(draft.sections.relationshipsAndDrives, "");
    assert.match(draft.sections.currentSituation ?? "", /증권거래소 지하 금고/);
    assert.match(draft.sections.characterCore, /자금 흐름 추적/);
    assert.match(draft.sections.characterCore, /에테르 잔향 감응/);
    assert.match(draft.sections.characterCore, /브로커/);
  });

  it("Wolfgang public sheet matches the GPT-approved Text Lock and keeps c91 identity facts", () => {
    const c91Historical = readJson<PilotFile>(
      path.join(PILOT_DIR, "fixtures", "pilot-rf-02-approved-c91ba66a.source.json")
    );
    const now = loadCompiledOfficialCharacterSource("pilot-rf-02").draft;
    const before = compileOfficialDraftFromBible(c91Historical.bible, {
      draftKey: c91Historical.draftKey,
      worldKey: now.worldKey,
      styleKey: now.styleKey,
      worldName: "에테르노스 제국",
      hook: now.hook,
      genres: now.genres,
      audience: now.audience,
    });
    assert.equal(
      WOLFGANG_IN_PLACE_TARGET.previousTextLockHash,
      "599854610891ee4e09224d1bec863501227157584b66068f0e1cab5e0e1ca89c"
    );
    assert.equal(
      WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash,
      "e22ba966bdeab1babb331bdc916fe43a0e0d4e8adb3f5f2ba32f969c28ba2af2"
    );
    assert.equal(
      computeTextLockHash(now),
      WOLFGANG_IN_PLACE_TARGET.approvedTextLockHash,
      "the public repo sheet is the GPT-approved manuscript"
    );
    assert.deepEqual(now.secrets, before.secrets);
    assert.equal(now.sections.characterCore, before.sections.characterCore);
    assert.equal(now.sections.extraCanon, before.sections.extraCanon);
    for (const field of ["name", "gender", "age", "genres", "supportingNpcs"] as const) {
      assert.deepEqual(now[field], before[field], `Wolfgang ${field} changed`);
    }
    assert.deepEqual(pilotFile("pilot-rf-02").bible.identity, c91Historical.bible.identity);
    assert.equal(now.tagline, "“당신의 처형 명령에 내 인장이 있습니다. 서명한 적은 없습니다.”");
    assert.notEqual(now.tagline, before.tagline);
    assert.ok(now.creatorComment);
    assert.notEqual(computeTextLockHash(now), computeTextLockHash(before));
  });

  it("Wolfgang's old world and incident text is still present in the split surfaces", () => {
    const approved = readJson<PilotFile>(path.join(PILOT_DIR, "fixtures", "pilot-rf-02-approved-c91ba66a.source.json"));
    const now = loadCompiledOfficialCharacterSource("pilot-rf-02").draft;
    const situation = now.sections.currentSituation ?? "";
    assert.ok(situation.length > 0);
    for (const key of ["personalSituation", "userEntry"] as const) {
      assert.ok(approved.bible.situation[key].trim().length > 0, key);
    }
    assert.match(situation, /금지 마석/);
    assert.match(situation, /서명과 인장/);
    assert.match(situation, /처형 명령서/);
    assert.doesNotMatch(now.sections.relationshipsAndDrives ?? "", /사건 전제:/);
    assert.match(now.sections.relationshipsAndDrives ?? "", /자기 추진 —/);
    assert.doesNotMatch(now.sections.relationshipsAndDrives ?? "", /유저의 이름·신분·성별|유저 역할:|관계 진행:/);
  });
});

describe("official public intro and creator comment", () => {
  it("pass the public-text gates and carry no internal production phrases", () => {
    for (const key of SHARED_WORLD_KEYS) {
      const draft = loadCompiledOfficialCharacterSource(key).draft;
      assert.deepEqual(evaluateOfficialPublicDescription(draft.description, draft.name).errors, [], `${key} intro`);
      const comment = composeOfficialCreatorComment(draft);
      assert.deepEqual(evaluateOfficialCreatorComment(comment, draft.description).errors, [], `${key} comment`);
      assert.equal(comment, draft.creatorComment, `${key}: comment is the authored text`);
      assert.doesNotMatch(
        `${draft.description}\n${comment}`,
        /하나의 도입 상황|이런 식으로 시작해 보세요|런타임|프롬프트|Text Lock|compact_rp|GPT|후보 원고/
      );
    }
  });

  it("does not repeat one recommended-role sentence across the two intros", () => {
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03").draft.description;
    const wolfgang = loadCompiledOfficialCharacterSource("pilot-rf-02").draft.description;
    assert.doesNotMatch(`${lucian}\n${wolfgang}`, /모두 어울|가능한 관계/);
    assert.notEqual(lucian, wolfgang);
  });
});

describe("official shared world: save and final RP wire are lossless", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    getDb().exec(`
      DELETE FROM character_lorebook_attachments;
      DELETE FROM characters;
      DELETE FROM worlds;
      DELETE FROM users WHERE email LIKE '%@test.local' OR email LIKE '%@site-managed.invalid';
    `);
  });

  for (const key of SHARED_WORLD_KEYS) {
    it(`${key}: one World Library row, saved snapshot equals source, zero truncation in the RP setting`, async () => {
      const studio = createSiteManagedStudioAccount({
        nickname: `공식스튜디오-${key}`,
        email: `official-${key}@site-managed.invalid`,
      });
      const source = loadCompiledOfficialCharacterSource(key);
      assert.equal(findOfficialSharedWorldLibraryRow(getDb(), studio.id), null);
      const shared = ensureOfficialSharedWorldLibraryRow({ db: getDb(), creatorId: studio.id, bible: source.worldBible });
      assert.equal(shared.content, source.draft.sections.worldAndSituation);
      assert.equal(
        ensureOfficialSharedWorldLibraryRow({ db: getDb(), creatorId: studio.id, bible: source.worldBible }).worldId,
        shared.worldId,
        "the second character reuses the same row"
      );

      assert.equal(evaluateOfficialStagedSaveLength(source.draft, source.appearanceBlock).ok, true);
      assert.equal(officialRpSettingOverflowChars(source.draft, source.appearanceBlock), 0);

      const body = buildOfficialCharacterFormBody({
        draft: source.draft,
        appearanceBlock: source.appearanceBlock,
        assets: [{ url: `/uploads/${key}.webp`, tag: "대표", width: 1024, height: 1536, viewerBlur: false }],
        worldId: shared.worldId,
      });
      const owner: SessionUser = { id: studio.id, nickname: studio.nickname, email: studio.email, is_adult: 1 };
      const created = await createCharacterFromForm(owner, body);
      assert.equal(created.ok, true, created.ok ? "" : created.error);
      if (!created.ok) return;

      const row = getDb().prepare("SELECT * FROM characters WHERE id = ?").get(created.id) as CharacterSettingRow & {
        world: string;
        world_id: number | null;
        system_prompt: string;
        creator_comment: string | null;
        speech_personality: string | null;
        speech_traits: string | null;
      };
      assert.equal(row.world_id, shared.worldId);
      assert.equal(row.world, source.draft.sections.worldAndSituation);
      assert.equal(row.creator_comment, composeOfficialCreatorComment(source.draft));

      const input = characterSettingInputForRow(row);
      assert.equal(characterSettingSourceOverflowChars(input), 0);

      const { chunks } = loadCharacterChunksForPromptReadOnly(row, "기록관", "기록관");
      const built = buildContext({
        charName: source.draft.name,
        chunks,
        userNickname: "기록관",
        speechPersonality: row.speech_personality ?? "",
        speechTraits: row.speech_traits ?? "",
        systemPrompt: row.system_prompt,
        world: row.world,
        exampleDialog: row.example_dialog ?? "",
        privateSpeechControlBlock: buildPrivateSpeechControlBlock(
          parseCreatorDescriptionCompiled(row.creator_compiled_description_json)
        ),
        shortTermHistory: [],
        currentUserMessage: "상황을 알려 줘.",
        nsfw: false,
        gender: source.draft.gender,
        provider: "cheaperinference",
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        completedTurns: 0,
      });
      const wire = squash(built.systemPrompt);
      const draft = source.draft;

      for (const [label, text] of [
        ["world", draft.sections.worldAndSituation],
        ["currentSituation", draft.sections.currentSituation ?? ""],
      ] as const) {
        assert.equal(occurrences(wire, squash(text)), 1, `${key}: ${label} is injected exactly once`);
      }
      for (const [label, text] of [
        ["characterCore", draft.sections.characterCore],
        ["relationshipsAndDrives", draft.sections.relationshipsAndDrives],
        ["speech examples", draft.speech.examples],
        ["speech forbidden", draft.speech.forbidden],
      ] as const) {
        const missing = text
          .split(/\n/)
          .flatMap((line) => line.split(COMPILER_SENTENCE_BOUNDARY))
          .filter((piece) => piece.trim() && !wire.includes(squash(piece)));
        assert.deepEqual(missing, [], `${key}: ${label} reached the final system prompt`);
      }
      for (const secret of draft.secrets) {
        assert.ok(wire.includes(squash(secret).slice(0, 24)), `${key}: secret reached the final system prompt`);
      }
    });
  }
});
