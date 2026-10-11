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
  relationshipLorebookEntryKey,
  resolveOfficialCharacterLorebooks,
  sanitizeRelationshipLorebookText,
} from "@/lib/officialSupply/lorebookAttach";
import { evaluateOfficialStagedSaveLength, officialSubstantiveCharCount } from "@/lib/officialSupply/characterText";
import { evaluateSharedLorebook } from "@/lib/officialSupply/worldQa";
import {
  buildCharacterBondsSystem,
  buildCharacterBondsUser,
} from "@/lib/officialSupply/authorPrompts";
import type { OfficialWorldLorebookEntry } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const WOLFGANG_TARGETS = [
  "카엘룸 폰 에테르노스",
  "루시안 바스케스",
  "율리우스 클라인",
  "바스티안 에반스",
  "세라피나 오로라",
  "이노센트 0호",
  "에드릭",
  "테오",
  "노엘 벨로체",
] as const;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function asKeywordEntries(entries: readonly OfficialWorldLorebookEntry[]) {
  return entries.map((entry) => ({ keywords: entry.keywords, content: entry.content }));
}

describe("official otherRelationships lorebook attach", () => {
  it("projects Wolfgang public relationships into character-local lorebooks and activates them by name", () => {
    const source = loadCompiledOfficialCharacterSource("pilot-rf-02");
    const file = readJson<{ bible: OfficialCharacterBible }>(path.join(PILOT_DIR, "characters", "pilot-rf-02.json"));
    const projected = projectOtherRelationshipsToCharacterLorebook(file.bible.otherRelationships, "pilot-rf-02");

    assert.equal(file.bible.otherRelationships.map((rel) => rel.target).join("|"), WOLFGANG_TARGETS.join("|"));
    assert.equal(projected.length, 9);
    assert.equal(source.characterLorebook.length, 9);
    assert.equal(source.resolvedLorebook.length, source.sharedLorebook.length + 9);
    assert.ok(source.resolvedLorebook.length <= 20);

    const alwaysOn = [
      source.draft.sections.characterCore,
      source.draft.sections.relationshipsAndDrives,
      source.draft.sections.worldAndSituation,
      source.draft.sections.currentSituation ?? "",
      source.draft.sections.extraCanon,
    ].join("\n");
    for (const target of WOLFGANG_TARGETS) {
      const entry = source.characterLorebook.find(
        (item) => item.entryKey === relationshipLorebookEntryKey("pilot-rf-02", target)
      );
      const bibleRel = file.bible.otherRelationships.find((rel) => rel.target === target);
      assert.ok(entry, target);
      assert.ok(bibleRel, target);
      assert.ok(entry.keywords.includes(target.split(" ")[0]!));
      assert.match(entry.content, new RegExp(target));
      assert.ok(entry.content.includes(sanitizeRelationshipLorebookText(bibleRel.public).slice(0, 12)));
      if (bibleRel.hidden) assert.equal(entry.content.includes(bibleRel.hidden), false);
      assert.equal(alwaysOn.includes(target), false, target);
    }

    const kaelum = matchKeywordLorebookEntryDetails(asKeywordEntries(source.characterLorebook), {
      currentUserText: "카엘룸이 온실에서 승인을 기다리고 있습니다.",
    });
    assert.equal(kaelum.length, 1);
    assert.match(kaelum[0]!.content, /카엘룸 폰 에테르노스/);
    assert.match(kaelum[0]!.content, /황태자 대행/);
    assert.doesNotMatch(kaelum[0]!.content, /독자적인 손실 장부/);

    const idle = matchKeywordLorebookEntryDetails(asKeywordEntries(source.characterLorebook), {
      currentUserText: "요새 난방을 먼저 확인하자.",
    });
    assert.equal(idle.length, 0);

    for (const secret of source.draft.secrets) {
      assert.equal(source.resolvedLorebook.some((entry) => entry.content.includes(secret)), false);
    }
    assert.equal(source.draft.secrets.length, 8);
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
    assert.equal(source.characterLorebook.filter((entry) => entry.entryKey.startsWith("cast_rel_")).length, 3);
    assert.deepEqual(
      file.bible.otherRelationships.map((rel) => rel.target),
      ["에드릭", "테오", "노엘 벨로체"]
    );
    assert.doesNotMatch(source.systemPrompt, /카엘룸|볼프강|율리우스|바스티안|세라피나|이노센트|에드릭|테오|노엘/);

    const edric = matchKeywordLorebookEntryDetails(asKeywordEntries(source.characterLorebook), {
      currentUserText: "에드릭이 성기사 자격으로 정보를 요청했다.",
    });
    assert.equal(edric.length, 1);
    assert.match(edric[0]!.content, /에드릭/);
    assert.doesNotMatch(edric[0]!.content, /숨김|LOCKED_SECRET/);
  });

  it("does not share one character hidden opinion into another character lorebook", () => {
    const wolfgang = loadCompiledOfficialCharacterSource("pilot-rf-02");
    const lucian = loadCompiledOfficialCharacterSource("pilot-rf-03");
    const wolfgangHidden = wolfgang.draft.secrets.filter((secret) => secret.includes("루시안"));
    assert.ok(wolfgangHidden.length > 0);
    for (const secret of wolfgangHidden) {
      assert.equal(lucian.resolvedLorebook.some((entry) => entry.content.includes(secret)), false);
    }
    const lucianKeys = new Set(lucian.resolvedLorebook.map((entry) => entry.entryKey));
    for (const entry of wolfgang.characterLorebook) {
      assert.equal(lucianKeys.has(entry.entryKey), false);
    }
  });

  it("does not cap compact otherRelationships at three people", () => {
    const file = readJson<{ bible: OfficialCharacterBible }>(path.join(PILOT_DIR, "characters", "pilot-rf-03.json"));
    const dense = {
      ...file.bible,
      otherRelationships: [
        ...file.bible.otherRelationships,
        {
          target: "볼프강 폰 발켄하임",
          public: "북부 방벽의 군 지휘관. 필요한 군사 정보를 주고받는다.",
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

  it("author bonds prompt records needed people without a 3-person cap", () => {
    const system = buildCharacterBondsSystem();
    const user = buildCharacterBondsUser({
      name: "볼프강",
      age: 34,
      rpHook: "위조 처형 명령서",
      adultCandidate: true,
      castList: ["카엘룸", "루시안", "율리우스", "바스티안"],
      part1Recap: "북부 방벽 지휘관",
    });
    assert.match(system, /필요한 인원을 임의 숫자로 자르지 않는다/);
    assert.match(system, /이름이 대화에 등장할 때만/);
    assert.match(system, /hidden은 로어북에 넣지 않고/);
    assert.doesNotMatch(system, /0~3명/);
    assert.doesNotMatch(user, /0~3명/);
    assert.match(user, /인원 상한 없음/);
  });
});
