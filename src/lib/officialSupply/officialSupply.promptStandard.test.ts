import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { compileOfficialDraftFromBible, type OfficialCharacterBible } from "@/lib/officialSupply/bible";
import { composeOfficialSystemPrompt } from "@/lib/officialSupply/characterText";
import {
  renderAppearanceBlock,
  renderRuntimeAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import type { OfficialAppearanceLock, OfficialCharacterDraft } from "@/lib/officialSupply/types";

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
  appearance: OfficialAppearanceLock;
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
    const { draft } = compileLucian();
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
    const { draft } = compileLucian();
    for (const name of ["카엘룸", "볼프강", "율리우스", "바스티안", "세라피나", "이노센트", "에드릭", "테오", "노엘"]) {
      assert.doesNotMatch(draft.sections.relationshipsAndDrives, new RegExp(name));
      assert.ok(!draft.secrets.some((secret) => secret.includes(name)));
    }
    assert.deepEqual(file.bible.otherRelationships.map((rel) => rel.target), ["에드릭", "테오", "노엘 벨로체"]);
    assert.ok(file.bible.otherRelationships.length <= 3);
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
    assert.deepEqual(file.bible.otherRelationships, []);
    assert.doesNotMatch(draft.sections.relationshipsAndDrives, /카엘룸|볼프강|율리우스|바스티안|세라피나|이노센트|에드릭|테오|노엘/);
  });

  it("uses only the approved first-character shared lorebook set", () => {
    const world = readJson<{ bible: { lorebook: Array<{ entryKey: string }> } }>(path.join(PILOT_DIR, "world-bible.json"));
    assert.deepEqual(
      world.bible.lorebook.map((entry) => entry.entryKey),
      ["mercator_guild", "aether_bonds", "mercator_exchange_underworld", "bio_aether_taboos"]
    );
  });

  it("routes character-known secrets through the canonical LOCKED_SECRET owner", () => {
    const { file, draft } = compileLucian();
    const runtimeAppearance = renderRuntimeAppearanceBlock(file.appearance);
    const systemPrompt = composeOfficialSystemPrompt(draft, runtimeAppearance);
    assert.match(systemPrompt, /\[비밀 — 캐릭터는 앎\]/);
    for (const secret of draft.secrets) assert.match(systemPrompt, new RegExp(secret.slice(0, 12)));

    const compilerDescription = [draft.sections.worldAndSituation, systemPrompt].join("\n\n");
    const compiled = compileCanonPlanV1({
      creatorRawDescription: compilerDescription,
      compilerDescription,
    });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const locked = compiled.plan.chunks.filter((chunk) => chunk.visibility === "LOCKED_SECRET");
    assert.ok(locked.length >= draft.secrets.length);
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
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/official-supply-character-review.ts"), "utf8");
    assert.match(source, /SYSTEM PROMPT — ACTUAL STAGED FORM/);
    assert.match(source, /RUNTIME APPEARANCE — COMPACT/);
    assert.doesNotMatch(source, /getDb|better-sqlite3|createCharacterFromForm|storeUpload|callOpenAi|fetch\(/);
  });

});
