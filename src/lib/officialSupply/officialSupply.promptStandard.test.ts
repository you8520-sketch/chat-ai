import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { isPublicVisibleChunk } from "@/lib/canonPlan/canonVisibility";
import { compileOfficialDraftFromBible, type OfficialCharacterBible } from "@/lib/officialSupply/bible";
import { buildOfficialCharacterFormBody, composeOfficialSystemPrompt } from "@/lib/officialSupply/characterText";
import {
  renderAppearanceBlock,
  renderRuntimeAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import {
  LUCIAN_APPROVED_LOREBOOK_KEYS,
  resolveOfficialCharacterLorebooks,
} from "@/lib/officialSupply/lorebookAttach";
import {
  LUCIAN_REVIEW_RELATIVE_PATH,
  LUCIAN_REVIEW_REPRODUCE,
  buildOfficialCharacterReviewReport,
} from "@/lib/officialSupply/characterReview";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import type {
  OfficialAppearanceLock,
  OfficialCharacterDraft,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

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
  appearance: OfficialAppearanceLock;
  draft: OfficialCharacterDraft;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function lucianFile(): PilotChar {
  return readJson<PilotChar>(path.join(PILOT_DIR, "characters", "pilot-rf-03.json"));
}

function compileLucian() {
  const file = lucianFile();
  const world = readJson<{ bible: { name: string } }>(path.join(PILOT_DIR, "world-bible.json"));
  const manifest = readJson<{ worldKey: string; styleKey: string }>(path.join(PILOT_DIR, "manifest.json"));
  const draft = compileOfficialDraftFromBible(file.bible, {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"] as OfficialCharacterDraft["genres"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    hook: {
      archetype: file.brief.archetype,
      relationshipTrope: file.brief.relationshipTrope,
      occupation: file.brief.occupation,
      rpHook: file.brief.rpHook,
    },
  });
  return { file, draft };
}

describe("official character prompt standard v1", () => {
  it("keeps full visual geometry out of the always-on character core", () => {
    const { file, draft } = compileLucian();
    assert.match(draft.sections.characterCore, /기본 스펙:\n이름: 루시안 바스케스/);
    assert.match(draft.sections.characterCore, /성별: 남성/);
    assert.match(draft.sections.characterCore, /직업\/역할: 비밀 회계사·지하 암시장 브로커/);
    assert.match(draft.sections.characterCore, /소속: 메르카토르 골드 길드/);
    assert.doesNotMatch(draft.sections.characterCore, /직업\/역할: 메르카토르 골드 길드 비밀 회계사/);
    assert.match(draft.sections.characterCore, /성격 키워드:/);
    assert.match(draft.sections.characterCore, /과거 서사:/);
    assert.match(draft.sections.characterCore, /능력·권력:/);
    assert.match(draft.sections.characterCore, /취미:/);

    assert.doesNotMatch(draft.sections.characterCore, /광대|턱선|헤어스타일|머리색:|기본 복장:|액세서리:/);

    const systemPrompt = composeOfficialSystemPrompt(draft, renderRuntimeAppearanceBlock(file.appearance));
    assert.equal((systemPrompt.match(/\[외형\]/g) ?? []).length, 1);
    assert.doesNotMatch(systemPrompt, /광대가 도드라지지 않는|매끈한 턱선/);
  });

  it("does not inject sibling playable-character relationship maps into the character prompt", () => {
    const { file, draft } = compileLucian();
    for (const name of ["카엘룸", "볼프강", "율리우스", "바스티안", "세라피나", "이노센트", "에드릭", "테오", "노엘"]) {
      assert.doesNotMatch(draft.sections.relationshipsAndDrives, new RegExp(name));
      assert.ok(!draft.secrets.some((secret) => secret.includes(name)));
    }
    assert.deepEqual(file.bible.otherRelationships.map((rel) => rel.target), ["에드릭", "테오", "노엘 벨로체"]);
    assert.ok(file.bible.otherRelationships.length <= 3);
    for (const rel of file.bible.otherRelationships) {
      assert.match(rel.public, /공개된 접점/);
      assert.equal(rel.privateOpinion, "");
      assert.equal(rel.hidden, "");
    }
  });

  it("keeps user identity and prior relationship persona-flexible", () => {
    const { file, draft } = compileLucian();
    assert.match(draft.sections.relationshipsAndDrives, /유저 페르소나와 대화에서 명시된 설정을 우선/);
    assert.match(draft.sections.relationshipsAndDrives, /유저 페르소나와 대화에서 명시된 설정을 우선/);
    assert.doesNotMatch(file.bible.situation.userEntry, /가족·동료·연인·거래 상대|페르소나/);
    assert.doesNotMatch(draft.speech.traits, /유저의 이름·신분·성별·기존 관계는 페르소나/);
    assert.doesNotMatch(file.bible.greeting, /오늘 처음 만난|낯선 사람|처음 보는 당신/);
  });

  it("uses short hobby anchors instead of hobby essays", () => {
    const { file } = compileLucian();
    assert.ok(file.bible.habits.hobbies.length >= 3 && file.bible.habits.hobbies.length <= 5);
    assert.ok(file.bible.habits.hobbies.every((hobby) => hobby.length <= 20));
  });


  it("keeps shared world canon in the lorebook owner instead of duplicating it into the compact runtime prompt", () => {
    const { file, draft } = compileLucian();
    assert.ok(file.bible.situation.worldContext.length > 0);
    assert.equal(draft.sections.worldAndSituation.includes(file.bible.situation.worldContext), false);
    assert.equal(draft.sections.worldAndSituation.includes(file.bible.situation.personalSituation), true);
    assert.equal(draft.sections.worldAndSituation.includes(file.bible.situation.userEntry), true);
    assert.match(draft.description, /\[세계관 설정:/);
  });

  it("keeps compact public relationship copy persona-flexible", () => {
    const { draft } = compileLucian();
    assert.match(draft.description, /기존 관계는 페르소나 설정을 따르며/);
    assert.doesNotMatch(draft.description, /가능한 관계: 공범자이자 아슬아슬한 유혹자/);
    assert.doesNotMatch(draft.tagline, /손목을 잡고/);
  });


  it("keeps Lucian free of speculative sibling-character relationships", () => {
    const { file, draft } = compileLucian();
    const systemPrompt = composeOfficialSystemPrompt(draft, renderRuntimeAppearanceBlock(file.appearance));
    assert.doesNotMatch(draft.sections.relationshipsAndDrives, /카엘룸|볼프강|율리우스|바스티안|세라피나|이노센트|에드릭|테오|노엘/);
    assert.doesNotMatch(systemPrompt, /카엘룸|볼프강|율리우스|바스티안|세라피나|이노센트|에드릭|테오|노엘/);
    assert.equal(file.bible.otherRelationships.some((rel) => /카엘룸|볼프강|율리우스|바스티안|세라피나|이노센트/.test(rel.target)), false);
  });

  it("attaches all four Lucian-specific lorebooks while preserving the common guild canon", () => {
    const world = readJson<{ bible: { lorebook: OfficialWorldLorebookEntry[] } }>(path.join(PILOT_DIR, "world-bible.json"));
    const { file } = compileLucian();
    assert.deepEqual(
      world.bible.lorebook.map((entry) => entry.entryKey),
      ["aether_energy", "solar_throne", "valkenheim_coalition", "mercator_guild", "pandora_academy", "black_wall", "ether_sickness", "sun_eye_core"]
    );
    assert.deepEqual(
      (file.characterLorebook ?? []).map((entry) => entry.entryKey),
      [...LUCIAN_APPROVED_LOREBOOK_KEYS]
    );
    const resolved = resolveOfficialCharacterLorebooks(world.bible.lorebook, file.characterLorebook);
    assert.deepEqual(
      resolved.map((entry) => entry.entryKey),
      [...world.bible.lorebook.map((entry) => entry.entryKey), ...LUCIAN_APPROVED_LOREBOOK_KEYS]
    );
    assert.equal(resolved.length, 12);
    assert.equal(resolved.filter((entry) => entry.entryKey === "mercator_guild").length, 1);
    assert.equal(
      resolved.find((entry) => entry.entryKey === "mercator_guild")?.content,
      world.bible.lorebook.find((entry) => entry.entryKey === "mercator_guild")?.content
    );
    const internal = resolved.find((entry) => entry.entryKey === "mercator_internal_dealings");
    assert.ok(internal);
    assert.equal(internal.content, file.characterLorebook?.find((entry) => entry.entryKey === "mercator_internal_dealings")?.content);
    assert.deepEqual(internal.keywords, ["메르카토르 길드", "길드 장부", "길드 간부", "밀수 장부"]);
    assert.match(internal.content, /암시장·밀수망/);
    assert.match(internal.content, /장부와 채권 기록/);
    assert.doesNotMatch(internal.content, /금지 거래와 고위 간부의 자금 흐름을 기록한 개인 장부/);
    const sibling = readJson<PilotChar>(path.join(PILOT_DIR, "characters", "pilot-rf-01.json"));
    const siblingResolved = resolveOfficialCharacterLorebooks(world.bible.lorebook, sibling.characterLorebook);
    assert.deepEqual(siblingResolved.map((entry) => entry.entryKey), world.bible.lorebook.map((entry) => entry.entryKey));
    assert.ok(!siblingResolved.some((entry) => entry.entryKey === "mercator_internal_dealings"));
    assert.ok(resolved.find((entry) => entry.entryKey === "mercator_exchange_underworld")?.keywords.includes("지하 금고"));
    assert.ok(resolved.find((entry) => entry.entryKey === "bio_aether_taboos")?.keywords.includes("생체 에테르"));
    assert.ok(resolved.find((entry) => entry.entryKey === "aether_bonds")?.keywords.includes("에테르 채권"));
  });

  it("routes character-known secrets through the canonical LOCKED_SECRET owner", () => {
    const { file, draft } = compileLucian();
    const runtimeAppearance = renderRuntimeAppearanceBlock(file.appearance);
    const systemPrompt = composeOfficialSystemPrompt(draft, runtimeAppearance);
    const creatorComment = composeOfficialCreatorComment(draft);
    assert.match(systemPrompt, /\[비밀 — 캐릭터는 앎\]/);
    for (const secret of draft.secrets) assert.match(systemPrompt, new RegExp(secret.slice(0, 12)));

    const publicSurfaces = [
      draft.description,
      draft.tagline,
      draft.greeting,
      creatorComment,
      file.bible.publicProfile.description,
      file.bible.publicProfile.tagline,
    ].join("\n");
    for (const secret of draft.secrets) {
      assert.equal(publicSurfaces.includes(secret), false, secret.slice(0, 24));
    }

    const compilerDescription = [draft.sections.worldAndSituation, systemPrompt].join("\n\n");
    const compiled = compileCanonPlanV1({
      creatorRawDescription: compilerDescription,
      compilerDescription,
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const locked = compiled.plan.chunks.filter((chunk) => chunk.visibility === "LOCKED_SECRET");
    assert.ok(locked.length >= draft.secrets.length);
    for (const chunk of locked) {
      assert.equal(isPublicVisibleChunk(chunk.visibility), false);
    }
  });

  it("keeps the full appearance lock for visuals but stages only compact RP anchors", () => {
    const { file } = compileLucian();
    const full = renderAppearanceBlock(file.appearance);
    const runtime = renderRuntimeAppearanceBlock(file.appearance);
    assert.ok(runtime.length < full.length);
    assert.match(runtime, /184cm/);
    assert.match(runtime, /짙은 갈색|붉은/);
    assert.match(runtime, /호박/);
    assert.match(runtime, /모노클/);
    assert.doesNotMatch(runtime, /얼굴:|연령대 인상:|기본 의상:|대표 복장:/);
  });

  it("future authoring rules preserve the same responsibility split", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/authorPrompts.ts"), "utf8");
    assert.match(source, /장문을 RP 캐릭터 본문에 복제하지 않는다/);
    assert.match(source, /hobbies는 짧은 명사\/구 3~5개/);
    assert.match(source, /기본은 persona-flexible/);
    assert.match(source, /출연진 전체를 채우지 않는다/);
    assert.match(source, /lorebook 후보 메모/);
  });
  it("keeps the reusable review dump read-only and provider-free", () => {
    const source = [
      fs.readFileSync(path.join(process.cwd(), "scripts/official-supply-character-review.ts"), "utf8"),
      fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/characterReview.ts"), "utf8"),
    ].join("\n");
    assert.match(source, /SYSTEM PROMPT — ACTUAL STAGED FORM/);
    assert.match(source, /RUNTIME APPEARANCE — COMPACT/);
    assert.match(source, /RESOLVED LOREBOOK — ACTUAL ATTACH SET/);
    assert.match(source, /AUTHORING SOURCE/);
    assert.match(source, /STORED SNAPSHOT vs LIVE COMPILE/);
    assert.match(source, /NOT IN THIS DUMP/);
    assert.doesNotMatch(source, /getDb|better-sqlite3|createCharacterFromForm|storeUpload|callOpenAi|fetch\(/);
  });

  it("keeps the committed Lucian review identical to the live compiler dump", () => {
    const generated = buildOfficialCharacterReviewReport("pilot-rf-03");
    const committed = fs.readFileSync(path.join(process.cwd(), LUCIAN_REVIEW_RELATIVE_PATH), "utf8");
    assert.equal(committed, generated);
    assert.doesNotMatch(generated, /OPENROUTER_API_KEY|sk-[A-Za-z0-9]{20,}|BEGIN PRIVATE KEY/);
    assert.match(LUCIAN_REVIEW_REPRODUCE, /official-supply:review-character/);
  });

  it("keeps one persona-flexible opening and does not force romance or a first meeting", () => {
    const { file, draft } = compileLucian();
    const creatorComment = composeOfficialCreatorComment(draft);
    assert.match(file.bible.greeting, /증권거래소 지하 금고/);
    assert.equal(file.bible.greeting, draft.greeting);
    assert.match(creatorComment, /추천 플레이 방향/);
    assert.match(creatorComment, /하나의 도입 상황/);
    assert.doesNotMatch(file.bible.situation.userEntry, /오늘 처음 만난|낯선 사람|처음 보는 당신|연인으로 시작한다|이미 연인/);
    assert.doesNotMatch(file.bible.greeting, /오늘 처음 만난|낯선 사람|처음 보는 당신|연인으로|약혼자/);
    assert.match(draft.sections.relationshipsAndDrives, /정해진 호감 수치처럼 관계를 자동 진행하지 않는다/);
    assert.match(draft.sections.relationshipsAndDrives, /어떤 관계도 자동으로 확정되지 않는다/);
    assert.match(draft.sections.relationshipsAndDrives, /가족·동료·연인·상관 등 기존 관계가 있다면 그 관계의 신뢰와 갈등을 유지/);
    assert.match(draft.description, /기존 관계는 페르소나 설정을 따르며/);
  });

  it("keeps the stored compact draft identical to the live compiler output", () => {
    const { file, draft } = compileLucian();
    assert.equal(file.draft.sections.characterCore, draft.sections.characterCore);
    assert.equal(file.draft.sections.relationshipsAndDrives, draft.sections.relationshipsAndDrives);
    assert.equal(file.draft.sections.worldAndSituation, draft.sections.worldAndSituation);
    assert.deepEqual(file.draft.secrets, draft.secrets);
    assert.equal(file.draft.description, draft.description);
    assert.equal(file.draft.greeting, draft.greeting);
  });

  it("keeps Lucian public copy, staged prompt, and greeting from forcing the user's first move", () => {
    const { file, draft } = compileLucian();
    const runtimeAppearance = renderRuntimeAppearanceBlock(file.appearance);
    const systemPrompt = composeOfficialSystemPrompt(draft, runtimeAppearance);
    const formBody = buildOfficialCharacterFormBody({
      draft,
      appearanceBlock: runtimeAppearance,
      assets: [],
    });
    const publicAndStaged = [
      draft.description,
      String(formBody.description),
      draft.sections.relationshipsAndDrives,
      String(formBody.system_prompt),
      systemPrompt,
      file.brief.rpHook,
      draft.hook.rpHook,
    ].join("\n");
    assert.doesNotMatch(publicAndStaged, /함께 움직여야/);
    assert.doesNotMatch(publicAndStaged, /손목을 잡고/);
    assert.doesNotMatch(draft.greeting, /손목을 잡고/);
    assert.match(draft.greeting, /따라오셔도 되고, 여기서 갈라서도 됩니다/);
    assert.doesNotMatch(draft.greeting, /당신을 믿어서가 아니라/);
    assert.match(draft.greeting, /다른 손은 코트 안쪽 장부 근처에 머물러 있었다/);
    assert.match(draft.description, /같은 탈출구 앞에 있다/);
    assert.match(systemPrompt, /도주에 협력할지, 거리를 둘지, 갈라설지는 유저가 정한다/);
  });

  it("keeps ledger-evidence facts in secrets only, not in public or situation teasers", () => {
    const { file, draft } = compileLucian();
    const runtimeAppearance = renderRuntimeAppearanceBlock(file.appearance);
    const systemPrompt = composeOfficialSystemPrompt(draft, runtimeAppearance);
    const formBody = buildOfficialCharacterFormBody({
      draft,
      appearanceBlock: runtimeAppearance,
      assets: [],
    });
    const creatorComment = composeOfficialCreatorComment(draft);
    const evidence = /고위 간부의 자금 흐름|간부와 금지 거래|금지 거래와 고위 간부/;
    const publicSurfaces = [
      draft.description,
      draft.tagline,
      draft.greeting,
      creatorComment,
      file.bible.publicProfile.description,
      file.bible.publicProfile.tagline,
      String(formBody.description),
      String(formBody.creator_comment),
      String(formBody.greeting),
    ].join("\n");
    const situationSurfaces = [
      file.bible.situation.personalSituation,
      file.bible.situation.userEntry,
      draft.sections.worldAndSituation,
      String(formBody.world),
    ].join("\n");
    assert.match(file.bible.secrets.join("\n"), evidence);
    assert.match(draft.secrets.join("\n"), evidence);
    assert.match(systemPrompt, evidence);
    assert.match(String(formBody.system_prompt), /\[비밀 — 캐릭터는 앎\]/);
    assert.doesNotMatch(publicSurfaces, evidence);
    assert.doesNotMatch(situationSurfaces, evidence);
    assert.match(situationSurfaces, /숨긴 기록/);
  });

  it("attaches all four approved local bodies and reports no shared-key collision", () => {
    const world = readJson<{ bible: { lorebook: OfficialWorldLorebookEntry[] } }>(path.join(PILOT_DIR, "world-bible.json"));
    const { file } = compileLucian();
    const approved = (file.characterLorebook ?? []).find((entry) => entry.entryKey === "mercator_internal_dealings");
    const shared = world.bible.lorebook.find((entry) => entry.entryKey === "mercator_guild");
    const resolved = resolveOfficialCharacterLorebooks(world.bible.lorebook, file.characterLorebook);
    assert.ok(approved?.keywords.includes("길드 장부"));
    assert.equal(shared?.keywords.includes("길드 장부"), false);
    assert.equal(resolved.find((entry) => entry.entryKey === "mercator_guild")?.content, shared?.content);
    assert.equal(resolved.find((entry) => entry.entryKey === "mercator_internal_dealings")?.content, approved?.content);
    const report = buildOfficialCharacterReviewReport("pilot-rf-03");
    assert.match(report, /SHARED-KEY COLLISION: none/);
    assert.match(report, /attached as authored local bodies: mercator_internal_dealings, aether_bonds, mercator_exchange_underworld, bio_aether_taboos \(4 of 4\)/);
    assert.doesNotMatch(report, /OWNER APPROVAL CHOICE unresolved/);
    assert.match(report, /keywords: 메르카토르 길드 \/ 길드 장부 \/ 길드 간부 \/ 밀수 장부/);
  });

});
