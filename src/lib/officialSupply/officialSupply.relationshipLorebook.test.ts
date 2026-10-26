import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { matchKeywordLorebookEntryDetails } from "@/lib/keywordLorebooks";
import { validateCharacterBible, type OfficialCharacterBible } from "@/lib/officialSupply/bible";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  attachOfficialCharacterLorebooks,
  projectOtherRelationshipsToCharacterLorebook,
  resolveOfficialCharacterLorebooks,
} from "@/lib/officialSupply/lorebookAttach";
import {
  composeOfficialSystemPrompt,
  evaluateOfficialStagedSaveLength,
  officialSubstantiveCharCount,
} from "@/lib/officialSupply/characterText";
import { evaluateSharedLorebook } from "@/lib/officialSupply/worldQa";
import {
  buildCharacterBondsSystem,
  buildCharacterBondsUser,
} from "@/lib/officialSupply/authorPrompts";
import type { OfficialWorldLorebookEntry } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function asKeywordEntries(entries: readonly OfficialWorldLorebookEntry[]) {
  return entries.map((entry) => ({ keywords: entry.keywords, content: entry.content }));
}

describe("official otherRelationships lorebook attach", () => {
  it("does not keep unused official-cast ties or their hidden notes on Wolfgang", () => {
    const source = loadCompiledOfficialCharacterSource("pilot-rf-02");
    const file = readJson<{ bible: OfficialCharacterBible }>(path.join(PILOT_DIR, "characters", "pilot-rf-02.json"));
    const projected = projectOtherRelationshipsToCharacterLorebook(file.bible.otherRelationships, "pilot-rf-02");
    const unused = /카엘룸|루시안|율리우스|바스티안|세라피나|이노센트|에드릭|테오|노엘/;

    assert.deepEqual(file.bible.otherRelationships, []);
    assert.deepEqual(projected, []);
    assert.equal(source.characterLorebook.some((entry) => entry.entryKey.startsWith("cast_rel_")), false);
    assert.equal(source.draft.secrets.length, 2);
    assert.equal(source.draft.secrets.some((secret) => unused.test(secret)), false);
    assert.doesNotMatch(source.draft.sections.relationshipsAndDrives, unused);
    assert.doesNotMatch(source.systemPrompt, unused);

    const mentioned = matchKeywordLorebookEntryDetails(asKeywordEntries(source.characterLorebook), {
      currentUserText: "카엘룸이 온실에서 승인을 기다리고 있습니다.",
    });
    assert.equal(mentioned.length, 0);

    assert.match(source.systemPrompt, /\[비밀 — 캐릭터는 앎\]/);
    assert.equal(evaluateOfficialStagedSaveLength(source.draft, source.appearanceBlock).ok, true);
    assert.ok(officialSubstantiveCharCount(source.draft, source.appearanceBlock) <= 12_000);
    assert.equal(evaluateSharedLorebook(source.resolvedLorebook, [source.draft]).ok, true);
  });

  it("keeps Lucian hand-authored lorebooks and still does not always-inject sibling maps", () => {
    const source = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const file = readJson<{
      bible: OfficialCharacterBible;
      characterLorebook?: OfficialWorldLorebookEntry[];
    }>(path.join(PILOT_DIR, "characters", "pilot-rf-03.json"));
    const authored = resolveOfficialCharacterLorebooks(source.sharedLorebook, file.characterLorebook);
    assert.equal(authored.length, 12);
    assert.equal(source.characterLorebook.some((entry) => entry.entryKey === "mercator_internal_dealings"), true);
    assert.deepEqual(file.bible.otherRelationships, []);
    assert.doesNotMatch(source.systemPrompt, /카엘룸|볼프강|율리우스|바스티안|세라피나|이노센트|에드릭|테오|노엘/);
  });

  it("does not cap compact otherRelationships at three people", () => {
    const file = readJson<{ bible: OfficialCharacterBible }>(path.join(PILOT_DIR, "characters", "pilot-rf-03.json"));
    const dense = {
      ...file.bible,
      otherRelationships: [
        {
          target: "볼프강 폰 발켄하임",
          public: "북부 방벽의 군 지휘관. 마석 운송 장부를 놓고 조건을 흥정한다.",
          privateOpinion: "",
          hidden: "",
        },
        {
          target: "카엘룸 폰 에테르노스",
          public: "황실 유리온실의 관측 기록을 거래한 적이 있다.",
          privateOpinion: "",
          hidden: "",
        },
        {
          target: "율리우스 클라인",
          public: "학술원 금서의 반출 시각을 장부와 대조한다.",
          privateOpinion: "",
          hidden: "",
        },
        {
          target: "바스티안 에반스",
          public: "밸브 구역 청부의 대금과 퇴로를 중개한다.",
          privateOpinion: "",
          hidden: "",
        },
      ],
    };
    const qa = validateCharacterBible(dense, { adultExpected: false });
    assert.equal(qa.errors.some((issue) => issue.code === "bible_other_relationships_dense"), false);
    const attached = attachOfficialCharacterLorebooks({
      shared: [],
      otherRelationships: dense.otherRelationships,
      ownerKey: "pilot-rf-03",
    });
    assert.equal(attached.length, 4);
  });

  it("author bonds prompt does not auto-fill official cast", () => {
    const system = buildCharacterBondsSystem();
    const user = buildCharacterBondsUser({
      name: "볼프강",
      age: 34,
      rpHook: "위조 처형 명령서",
      adultCandidate: true,
      castList: [],
      part1Recap: "북부 방벽 지휘관",
    });
    assert.match(system, /다른 공식 캐릭터를 관계 목록에 자동으로 채우지 않는다/);
    assert.match(system, /같은 세계관에 존재하거나 나중에 만날 수 있다는 이유만으로는 넣지 않는다/);
    assert.match(system, /인원 수를 채우는 목표는 없다/);
    assert.doesNotMatch(system, /0~3명/);
    assert.match(`${system}\n${user}`, /자동으로 채우지 않는다/);
    assert.match(`${system}\n${user}`, /없으면 \[\]/);
  });

  it("author bonds prompt allows zero secrets and does not seed secret slots", () => {
    const system = buildCharacterBondsSystem();
    const user = buildCharacterBondsUser({
      name: "볼프강",
      age: 34,
      rpHook: "위조 처형 명령서",
      adultCandidate: false,
      castList: [],
      part1Recap: "북부 방벽 지휘관",
    });
    assert.doesNotMatch(system, /secrets 1~3개/);
    assert.match(system, /필요한 비밀이 없으면 \[\]/);
    assert.match(system, /개수를 채우지 않는다/);
    assert.match(user, /"secrets": \[\]/);
  });

  it("compiles a draft with zero secrets without a secret section", () => {
    const source = loadCompiledOfficialCharacterSource("pilot-rf-02");
    const noSecrets = composeOfficialSystemPrompt({ ...source.draft, secrets: [] }, source.appearanceBlock);
    assert.doesNotMatch(noSecrets, /\[비밀 — 캐릭터는 앎\]/);
    assert.match(noSecrets, /\[관계·갈등·행동원리\]/);
  });

  it("pilot author does not push NPC creation by default", () => {
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/official-supply-pilot-author.ts"), "utf8");
    assert.doesNotMatch(script, /특별한 이유가 없으면 1~2명을 만든다/);
    assert.match(script, /필요 없으면 0명\(\[\]\)이 정상이다/);
  });
});
