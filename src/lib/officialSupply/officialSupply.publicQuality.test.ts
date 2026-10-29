import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { compileOfficialDraftFromBible, type OfficialWorldBible } from "@/lib/officialSupply/bible";
import { buildOfficialCharacterFormBody } from "@/lib/officialSupply/characterText";
import { canonicalPrimaryTrope } from "@/lib/officialSupply/marketFit";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import {
  HWANG_VOCAB,
  testAppearance,
  testAssetPlan,
  testDraft,
  testStyleCandidate,
} from "@/lib/officialSupply/officialSupply.fixtures";
import {
  compileRelationStartDraft,
  loadRelationStartCandidates,
} from "@/lib/officialSupply/relationStartCandidates";
import {
  composeOfficialCreatorComment,
  composeOfficialPublicDescription,
  evaluateOfficialCharacterPronoun,
  evaluateOfficialCreatorComment,
  evaluateOfficialPlayerGenderNeutral,
  evaluateOfficialPublicDescription,
  officialPlayStartChoices,
  OFFICIAL_PUBLIC_INTRO_SECTIONS,
  publicAppearanceFacts,
} from "@/lib/officialSupply/publicProfileText";
import {
  evaluateOfficialShotPlan,
  officialShotComboKey,
  officialShotSeed,
  OFFICIAL_SLOT_SHOT_PLAN,
  resolveOfficialSlotShot,
} from "@/lib/officialSupply/shotPlan";
import type { OfficialCharacterBible } from "@/lib/officialSupply/bible";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");

type PilotChar = {
  draftKey: string;
  slot: number;
  brief: OfficialCharacterDraft["hook"] & { audience: OfficialCharacterDraft["audience"]; name: string };
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function sampleChars(): PilotChar[] {
  return ["01", "03", "05"].map((slot) =>
    readJson<PilotChar>(path.join(PILOT_DIR, "characters", `pilot-rf-${slot}.json`))
  );
}

function compileKeys(file: PilotChar) {
  const world = readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json"));
  const manifest = readJson<{ worldKey: string; styleKey: string }>(path.join(PILOT_DIR, "manifest.json"));
  return {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"] as OfficialCharacterDraft["genres"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    worldBible: world.bible,
    hook: {
      archetype: file.brief.archetype,
      relationshipTrope: file.brief.relationshipTrope,
      occupation: file.brief.occupation,
      rpHook: file.brief.rpHook,
    },
  };
}

describe("official slot shot responsibilities", () => {
  it("assigns a distinct face+distance+expression combo to each canonical slot", () => {
    const combos = Object.values(OFFICIAL_SLOT_SHOT_PLAN).map(officialShotComboKey);
    assert.equal(new Set(combos).size, combos.length);
    const qa = evaluateOfficialShotPlan(testAssetPlan().slots);
    assert.deepEqual(qa.errors, []);
  });

  it("keeps representative as the only required bust card and never consecutive busts", () => {
    const shots = testAssetPlan().slots.map((slot) => resolveOfficialSlotShot(slot, "pilot-rf-01"));
    const busts = shots.filter((shot) => shot.distance === "bust");
    assert.equal(busts.length, 1);
    assert.equal(busts[0]?.slotKey, "rep");
    assert.ok(shots.filter((shot) => shot.kind === "scene").every((shot) => shot.background === "scene"));
  });

  it("rotates non-rep families by draftKey so two characters do not share the same storyboard", () => {
    const slots = testAssetPlan().slots;
    const a = slots.map((slot) => officialShotComboKey(resolveOfficialSlotShot(slot, "pilot-rf-01")));
    const b = slots.map((slot) => officialShotComboKey(resolveOfficialSlotShot(slot, "pilot-rf-03")));
    assert.notDeepEqual(a, b);
    assert.equal(officialShotSeed("pilot-rf-01"), officialShotSeed("pilot-rf-01"));
    const sig1a = resolveOfficialSlotShot({ slotKey: "sig1", kind: "signature" }, "pilot-rf-01");
    const sig1b = resolveOfficialSlotShot({ slotKey: "sig1", kind: "signature" }, "pilot-rf-03");
    assert.notEqual(officialShotComboKey(sig1a), officialShotComboKey(sig1b));
    assert.equal(evaluateOfficialShotPlan(slots, "pilot-rf-01").errors.length, 0);
    assert.equal(evaluateOfficialShotPlan(slots, "pilot-rf-03").errors.length, 0);
  });

  it("builds prompts with different shot responsibilities; scene is not a portrait", () => {
    const draft = testDraft({ draftKey: "hwang", name: "레온하르트", vocabulary: HWANG_VOCAB });
    const appearance = testAppearance();
    const style = testStyleCandidate("c1").dna;
    const prompts = testAssetPlan().slots.map((slot) => ({
      slotKey: slot.slotKey,
      kind: slot.kind,
      text: buildOfficialAssetPrompts({ draft, appearance, style, slot }).primaryPrompt,
    }));
    const shotLines = prompts.map((row) => {
      const match = row.text.match(/SHOT RESPONSIBILITY \([^)]+\):[^]+?IDENTITY LOCK/);
      return match?.[0] ?? row.text;
    });
    assert.equal(new Set(shotLines).size, shotLines.length);
    for (const row of prompts) {
      if (row.kind === "representative") {
        assert.match(row.text, /character card portrait/);
        continue;
      }
      assert.match(row.text, /SHOT RESPONSIBILITY/);
      assert.match(row.text, /ART STYLE describes rendering language, color, and illustration grammar only/);
      assert.doesNotMatch(row.text, /face and upper body readable/);
      if (row.kind === "scene") {
        assert.match(row.text, /SCENE illustration/);
        assert.match(row.text, /not a portrait substitute/);
        assert.doesNotMatch(row.text, /supporting background only/);
      }
    }
  });
});

describe("official detailed intro + creator comment", () => {
  it("compiled public intro has world/character/play/entry facts and no HTML", () => {
    for (const file of sampleChars()) {
      const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
      const qa = evaluateOfficialPublicDescription(draft.description, draft.name);
      assert.deepEqual(qa.errors, [], `${file.draftKey}: ${JSON.stringify(qa.errors)}`);
      assert.match(draft.description, new RegExp(`\\[${OFFICIAL_PUBLIC_INTRO_SECTIONS.world}`));
      assert.match(draft.description, new RegExp(`\\[${OFFICIAL_PUBLIC_INTRO_SECTIONS.character}\\]`));
      assert.match(draft.description, new RegExp(`\\[${OFFICIAL_PUBLIC_INTRO_SECTIONS.intro}\\]`));
      assert.match(draft.description, new RegExp(`${file.bible.identity.age}세`));
      assert.match(draft.description, new RegExp(`${file.bible.identity.heightCm}cm`));
      assert.doesNotMatch(draft.description, /<\/?[a-z][\s\S]*>/i);
      assert.notEqual(draft.description, file.bible.publicProfile.description);
      const facts = publicAppearanceFacts(file.bible.appearance);
      assert.ok(facts.length >= 3 && facts.length <= 5, `${file.draftKey} look facts ${facts.length}`);
      assert.ok(facts.every((fact) => /^(머리|눈|피부|체형|특징|복식|소품|인상): /.test(fact)));
      assert.doesNotMatch(draft.description, /[가-힣](?:보다|하며|하고)\s*\//);
      assert.match(draft.description, new RegExp(facts[0]!.slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const lucian = sampleChars().find((file) => file.draftKey === "pilot-rf-03")!;
    const lucianDraft = compileOfficialDraftFromBible(lucian.bible, compileKeys(lucian));
    assert.match(lucianDraft.description, /머리:.*갈색/);
    assert.match(lucianDraft.description, /눈:.*호박/);
    assert.match(lucianDraft.description, /피부:.*구리빛/);
    assert.match(lucianDraft.description, /특징:.*모노클/);
    assert.doesNotMatch(lucianDraft.description, /표정보다\s*\//);
    assert.match(lucianDraft.description, /에테르 잔향 감응 — [^\n]*읽는다/);
  });

  it("creator comment is a play guide and not a copy of the detailed intro", () => {
    const starts = new Set<string>();
    for (const file of sampleChars()) {
      const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
      const comment = composeOfficialCreatorComment(draft);
      const qa = evaluateOfficialCreatorComment(comment, draft.description);
      assert.deepEqual(qa.errors, [], `${file.draftKey}: ${JSON.stringify(qa.errors)}`);
      assert.match(comment, /지금 상황/);
      const authored = file.bible.publicProfile.creatorComment?.trim();
      if (authored) {
        assert.equal(comment, authored);
        assert.match(comment, /추천 플레이 방향/);
        starts.add(comment.match(/추천 플레이 방향<\/b><br>([^<]+)/)?.[1] ?? "");
      } else {
        assert.doesNotMatch(comment, /추천 플레이 방향/, `${file.draftKey}: auto fallback must not duplicate rpHook`);
      }
      assert.doesNotMatch(comment, /가능한 관계/);
      assert.doesNotMatch(comment, /하나의 도입 상황|이런 식으로 시작해 보세요|런타임|프롬프트/);
      assert.doesNotMatch(comment, /\[캐릭터 설정\]/);
      assert.doesNotMatch(comment, /(신뢰|호감|경계).{0,8}(낮음|높음|미정)/);
      assert.doesNotMatch(comment, /첫 장면에서는 목적 한 가지만|반응을 보세요|따라 누구와/);
      assert.doesNotMatch(comment, /고르세요|중에서 먼저|첫 수를 정해|선택지|에피소드/);
      assert.deepEqual(officialPlayStartChoices(draft), [], `${file.draftKey} no longer compiles a user-choice menu`);
      assert.ok(!draft.description.includes(comment.replace(/<[^>]+>/g, "").trim()));
    }
    const lucian = sampleChars().find((file) => file.draftKey === "pilot-rf-03")!;
    assert.deepEqual(
      officialPlayStartChoices(compileOfficialDraftFromBible(lucian.bible, compileKeys(lucian))),
      []
    );
    assert.ok(starts.size >= 1, "authored play-direction lines stay distinct");
  });

  it("auto creator comment keeps situation only when play-start choices are empty", () => {
    for (const candidate of loadRelationStartCandidates()) {
      const draft = compileRelationStartDraft(candidate);
      assert.equal(draft.creatorComment, undefined, `${candidate.key}: uses auto fallback`);
      assert.deepEqual(officialPlayStartChoices(draft), [], candidate.key);
      const comment = composeOfficialCreatorComment(draft);
      const situation = comment.match(/지금 상황<\/b><br>([^<]+)/)?.[1]?.trim() ?? "";
      const start = comment.match(/추천 플레이 방향<\/b><br>([^<]+)/)?.[1]?.trim() ?? "";
      assert.ok(situation.length > 0, candidate.key);
      assert.equal(start, "", `${candidate.key}: must not repeat rpHook as play direction`);
      assert.doesNotMatch(comment, /추천 플레이 방향/, candidate.key);
      assert.deepEqual(
        evaluateOfficialCreatorComment(comment, draft.description).errors,
        [],
        `${candidate.key}: ${JSON.stringify(evaluateOfficialCreatorComment(comment, draft.description).errors)}`
      );
    }
  });

  it("compiled greeting, public intro, and creator comment stay player-gender neutral", () => {
    const files = fs
      .readdirSync(path.join(PILOT_DIR, "characters"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson<PilotChar>(path.join(PILOT_DIR, "characters", name)));
    for (const file of files) {
      const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
      const comment = composeOfficialCreatorComment(draft);
      const qa = evaluateOfficialPlayerGenderNeutral({
        greeting: draft.greeting,
        description: draft.description,
        comment,
      });
      assert.deepEqual(qa.errors, [], `${file.draftKey}: ${JSON.stringify(qa.errors)}`);
      assert.match(draft.greeting, /당신/);
    }
    const titledPlayer = evaluateOfficialPlayerGenderNeutral({
      greeting: "문가에 선 왕자비를 향해 손을 내밀었다.",
    });
    assert.ok(titledPlayer.errors.some((issue) => issue.code === "official_player_gender_locked"));
    assert.match(titledPlayer.errors.map((issue) => issue.message).join("\n"), /왕자비/);
    const genderedPlayer = evaluateOfficialPlayerGenderNeutral({
      description: "당신은 그 남자 플레이어로 시작한다.",
    });
    assert.ok(genderedPlayer.errors.some((issue) => issue.code === "official_player_gender_locked"));
    assert.match(genderedPlayer.errors.map((issue) => issue.message).join("\n"), /남자 플레이어/);
    const prompt = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/authorPrompts.ts"), "utf8");
    assert.match(prompt, /오프닝은 하나다/);
    assert.match(prompt, /아가씨\/도련님\/왕자비\/신부/);
    assert.doesNotMatch(prompt, /에피소드를 만들|N개의 에피소드|episode picker/);
  });

  it("keeps character and NPC gender while blocking a player gender or titled role", () => {
    const passes = [
      "여성인 그녀는 당신을 조용히 바라본다.",
      "그는 남성이다. 당신은 이름을 묻지 않는다.",
      "당신은 남성 단골 손님의 빈 자리를 본다.",
      "여자 동료가 당신을 불렀다.",
      "당신은 남자친구의 메시지를 읽지 않는다.",
      "단골 아가씨가 당신을 웃으며 맞이한다.",
      "아가씨가 당신을 맞이한다.",
      "그녀는 골목의 신부로 불린다. 당신은 이름을 묻는다.",
      "그는 도련님으로 자랐다. 당신은 문 앞에 서 있다.",
      "성당의 신부님은 당신을 문 앞에서 맞이한다.",
    ];
    for (const description of passes) {
      assert.deepEqual(
        evaluateOfficialPlayerGenderNeutral({ description }).errors,
        [],
        description
      );
    }
    const blocks = [
      ["당신은 남성 경찰관입니다.", /남성 경찰관/],
      ["당신은 남성 경찰관으로 현장에 들어온다.", /남성 경찰관으로/],
      ["당신은 여성 의사로 병원에 들어온다.", /여성 의사로/],
      ["당신은 여자 직원으로 근무합니다.", /여자 직원으로/],
      ["당신은 여성 의사다.", /여성 의사/],
      ["아가씨가 당신입니다.", /아가씨가 당신/],
      ["당신은 여자로 이 가게에 들어온다.", /여자/],
      ["여자인 당신은 카운터 앞에 선다.", /여자인 당신/],
      ["당신은 그 남자다.", /남자/],
      ["당신은 여성이 아니다.", /여성/],
      ["당신은 신부로 입장한다.", /신부/],
      ["그녀는 당신을 아가씨로 불렀다.", /아가씨/],
      ["문가에 선 왕자비를 향해 손을 내밀었다.", /왕자비/],
      ["아가씨와 이졸데의 약혼이 공시됐다.", /아가씨/],
      ["당신은 아가씨가 아니다.", /아가씨/],
      ["당신은 남자친구다.", /남자친구/],
      ["남자친구인 당신은 카운터 앞에 선다.", /남자친구인 당신/],
    ] as const;
    for (const [description, excerpt] of blocks) {
      const qa = evaluateOfficialPlayerGenderNeutral({ description });
      assert.ok(qa.errors.some((issue) => issue.code === "official_player_gender_locked"), description);
      assert.match(qa.errors.map((issue) => issue.message).join("\n"), excerpt, description);
    }
  });

  it("flags a female public 그는 and a male public 그녀, and leaves other pronouns", () => {
    assert.ok(evaluateOfficialCharacterPronoun("female", { description: "그는 주민들의 영수증을 읽는다." }).errors.some((e) => e.code === "official_character_pronoun"));
    assert.deepEqual(evaluateOfficialCharacterPronoun("female", { description: "그녀는 주민들의 영수증을 읽는다." }).errors, []);
    assert.ok(evaluateOfficialCharacterPronoun("male", { description: "그녀는 장부를 덮지 않았다." }).errors.some((e) => e.code === "official_character_pronoun"));
    assert.deepEqual(evaluateOfficialCharacterPronoun("male", { description: "그는 장부를 덮지 않았다." }).errors, []);
    assert.deepEqual(evaluateOfficialCharacterPronoun("other", { description: "그는 이름을 밝히지 않는다." }).errors, []);
    assert.deepEqual(evaluateOfficialCharacterPronoun("female", { description: "그를 먼저 확인한 그녀는 펜을 내려놓았다." }).errors, []);
    const choi = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "docs/official-supply/reviews/g5-1-2026-10-28/candidates/g5-modern-comedy-c/bible.assembled.json"),
        "utf8"
      )
    ) as OfficialCharacterBible;
    const flagged = evaluateOfficialCharacterPronoun(choi.identity.gender, {
      description: [choi.publicProfile.description, choi.publicProfile.detailedDescription ?? ""].join("\n"),
    });
    assert.deepEqual(flagged.errors.map((e) => e.code), ["official_character_pronoun"]);
  });

  it("form body keeps the compiled intro and adds creator_comment without changing publish owner", () => {
    const file = sampleChars()[0]!;
    const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
    const body = buildOfficialCharacterFormBody({
      draft,
      appearanceBlock: "외형",
      assets: [{ url: "/uploads/rep.webp", tag: "대표", width: 1024, height: 1536, viewerBlur: false }],
    });
    assert.equal(body.description, draft.description);
    assert.equal(typeof body.creator_comment, "string");
    assert.match(String(body.creator_comment), /<p><b>지금 상황<\/b>/);
    const publishSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/publish.ts"), "utf8");
    const stagingSource = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/staging.ts"), "utf8");
    assert.match(publishSource, /function publishOfficialSupplyCharacter/);
    assert.match(stagingSource, /buildOfficialCharacterFormBody/);
    assert.doesNotMatch(publishSource, /composeOfficialPublicDescription|composeOfficialCreatorComment/);
    const startChat = fs.readFileSync(path.join(process.cwd(), "src/components/StartChatButton.tsx"), "utf8");
    assert.doesNotMatch(
      `${publishSource}\n${stagingSource}\n${startChat}`,
      /introVariant|selectedIntro|scenarioSnapshot|intro_id/
    );
  });

  it("auto public intro uses the play section header when userRole is empty", () => {
    const file = sampleChars().find((row) => row.draftKey === "pilot-rf-03")!;
    const composed = composeOfficialPublicDescription({
      worldName: "에테르노스 제국 (Aethernos Empire)",
      rpHook: file.brief.rpHook,
      relationshipTrope: file.brief.relationshipTrope,
      identity: file.bible.identity,
      appearance: file.bible.appearance,
      personality: file.bible.personality,
      abilities: file.bible.abilities,
      situation: file.bible.situation,
      userRole: "",
    });
    assert.match(composed, new RegExp(`\\[${OFFICIAL_PUBLIC_INTRO_SECTIONS.play}\\]`));
    assert.doesNotMatch(composed, new RegExp(`\\[${OFFICIAL_PUBLIC_INTRO_SECTIONS.relation}\\]`));
  });

  it("accepts the bare name when the name field carries a `본명 (별명)` alias, and still requires the name", () => {
    const file = sampleChars()[0]!;
    const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
    const bare = draft.name;
    assert.deepEqual(evaluateOfficialPublicDescription(draft.description, `${bare} (별명)`).errors, []);
    const missing = evaluateOfficialPublicDescription(draft.description, "없는이름 (별명)");
    assert.ok(missing.errors.some((issue) => issue.code === "public_intro_name_missing"), JSON.stringify(missing.errors));
  });

  it("public intro evaluator rejects a one-paragraph pitch", () => {
    const pitch = composeOfficialPublicDescription;
    assert.ok(evaluateOfficialPublicDescription("황자가 온실에서 당신을 기다린다. 거래가 시작된다.").errors.length > 0);
    assert.equal(typeof pitch, "function");
  });

  it("still rejects an auto-sheet that is missing occupation or role labels", () => {
    const file = sampleChars()[0]!;
    assert.equal(file.bible.publicProfile.detailedDescription, undefined);
    const complete = composeOfficialPublicDescription({
      worldName: "에테르노스 제국 (Aethernos Empire)",
      rpHook: file.brief.rpHook,
      relationshipTrope: file.brief.relationshipTrope,
      identity: file.bible.identity,
      appearance: file.bible.appearance,
      personality: file.bible.personality,
      abilities: file.bible.abilities,
      situation: file.bible.situation,
      userRole: file.bible.userRelationship.userRole,
    });
    assert.match(complete, /^이름:/m);
    assert.match(complete, /^나이:/m);
    assert.match(complete, /^키:/m);
    assert.match(complete, /직업\/소속/);
    assert.match(complete, /능력\/역할:/);
    const malformed = complete.replace(/직업\/소속:[^\n]*\n/, "").replace(/능력\/역할:[^\n]*\n/, "");
    assert.doesNotMatch(malformed, /직업\/소속/);
    assert.doesNotMatch(malformed, /능력\/역할:/);
    assert.match(malformed, /^이름:/m);
    assert.match(malformed, /^나이:/m);
    assert.match(malformed, /^키:/m);
    const qa = evaluateOfficialPublicDescription(malformed, file.bible.identity.name);
    assert.ok(
      qa.errors.some((issue) => issue.code === "public_intro_facts_missing"),
      JSON.stringify(qa.errors)
    );
  });

  it("uses an authored detailed description as draft.description without shortening", () => {
    const file = sampleChars()[0]!;
    const authored = "[세계관 설정: 에테르노스 제국]\n남겨 둔 문장.\n\n[캐릭터 설정]\n이름: 테스트\n나이: 34세\n키: 188cm\n직업/소속: 사령관 / 연맹\n\n외형: 머리: 흑회색, 울프컷 / 눈: 회청색, 긴 눈매 / 피부: 창백 / 체형: 넓은 어깨\n성격: 냉정\n능력/역할: 지휘\n배경: 배경.\n\n[관계 포인트]\n관계는 선택에 따라 달라진다.\n\n[도입 상황]\n당신이 집무실에 있다.";
    const composed = composeOfficialPublicDescription({
      worldName: "에테르노스 제국 (Aethernos Empire)",
      rpHook: file.brief.rpHook,
      relationshipTrope: file.brief.relationshipTrope,
      identity: file.bible.identity,
      appearance: file.bible.appearance,
      personality: file.bible.personality,
      abilities: file.bible.abilities,
      situation: file.bible.situation,
      userRole: file.bible.userRelationship.userRole,
      detailedDescription: authored,
    });
    assert.equal(composed, authored);
    assert.doesNotMatch(composed, /이름: 카엘룸|이름: 레온/);
  });
});

describe("Wolfgang GPT-authored public copy", () => {
  function section(md: string, start: string, end: string): string {
    const from = md.indexOf(start);
    const to = md.indexOf(end, from + start.length);
    return md.slice(from + start.length, to).trim();
  }

  function candidate() {
    const md = fs.readFileSync(
      path.join(process.cwd(), "docs/official-supply/reviews/pilot-rf-02-gpt-public-copy-candidate.md"),
      "utf8"
    );
    return {
      tagline: section(md, "## One-line tagline (37/50 characters)\n\n", "\n\n## Public detailed description"),
      detailedDescription: section(md, "## Public detailed description (1299/3,000 characters)\n\n", "\n\n## Greeting / opening"),
      greeting: section(md, "## Greeting / opening (1547 characters; editorial aim approximately 1,500; storage ceiling 2,000)\n\n", "\n\n\n## GPT-authored"),
      pitch: section(md, "### Short discovery pitch / `bible.publicProfile.description` (200–500 chars) — 254 chars\n\n", "\n\n### Character current situation"),
      personalSituation: section(md, "### Character current situation / `bible.situation.personalSituation` — 456 chars\n\n", "\n\n### Player entry"),
      userEntry: section(md, "### Player entry / `bible.situation.userEntry` — 222 chars\n\n", "\n\n### Immediate hook"),
      immediateHook: section(md, "### Immediate hook / `bible.rpEngine.immediateHook` — 187 chars\n\n", "\n\n### Medium conflict"),
      mediumConflict: section(md, "### Medium conflict / `bible.rpEngine.mediumConflict` — 177 chars\n\n", "\n\n**Integration note:**"),
    };
  }

  it("keeps compiled Wolfgang public surfaces aligned to the approved public tagline", () => {
    const file = readJson<PilotChar>(path.join(PILOT_DIR, "characters", "pilot-rf-02.json"));
    const manifest = readJson<{ publicSurfaceDecisions: Record<string, { tagline?: string }> }>(
      path.join(PILOT_DIR, "manifest.json")
    );
    const copy = candidate();
    const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
    assert.equal(file.bible.publicProfile.tagline, manifest.publicSurfaceDecisions["pilot-rf-02"]?.tagline);
    assert.equal(file.bible.publicProfile.tagline, "“당신의 처형 명령에 내 인장이 있습니다. 서명한 적은 없습니다.”");
    assert.equal(draft.description, file.bible.publicProfile.detailedDescription);
    assert.equal(draft.greeting, file.bible.greeting);
    assert.equal(draft.tagline, file.bible.publicProfile.tagline);
    assert.notEqual(draft.description, file.bible.publicProfile.description);
    assert.equal(
      readJson<PilotChar>(path.join(PILOT_DIR, "fixtures", "pilot-rf-02-approved-c91ba66a.source.json")).bible
        .publicProfile.detailedDescription,
      copy.detailedDescription,
      "the GPT candidate document remains the previously approved c91 copy"
    );
    assert.ok(file.bible.greeting.length <= 2000);
    assert.deepEqual(evaluateOfficialPublicDescription(draft.description, draft.name).errors, []);
    assert.match(draft.description, /세계관 설정: 에테르노스 제국/);
    assert.match(draft.description, /캐릭터 설정/);
    assert.match(draft.description, /도입 상황/);
    assert.match(draft.description, /서명도 인장도 볼프강의 것이다/);
    assert.doesNotMatch(draft.description, /정략적 혐오에서 맹목적 충성으로/);
    assert.doesNotMatch(draft.greeting, /눈과 서리를 묻힌 당신이|젖은 외투/);
    assert.doesNotMatch(file.bible.identity.worldRole, /92kg|92㎏/);
    assert.match(draft.description, /몸무게 약 92kg/);
  });

  it("keeps Wolfgang creator comment on the GPT hook, trope, and action-only start choices", () => {
    const file = readJson<PilotChar>(path.join(PILOT_DIR, "characters", "pilot-rf-02.json"));
    const draft = compileOfficialDraftFromBible(file.bible, compileKeys(file));
    const comment = composeOfficialCreatorComment(draft);
    const qa = evaluateOfficialCreatorComment(comment, draft.description);
    assert.deepEqual(qa.errors, [], JSON.stringify(qa.errors));
    assert.equal(
      file.brief.rpHook,
      "금지 마석 사건과 연결된 당신의 처형 명령서에 자신의 인장이 찍힌 것을 발견한 북부대공이, 흑철 요새에서 당신과 문서의 진위를 확인하려 한다."
    );
    assert.equal(file.brief.relationshipTrope, "의심 속에서도 처형을 막는 보호자, 선택에 따라 깊어지는 신뢰");
    assert.equal(file.bible.userRelationship.initialView, "");
    assert.equal(file.bible.userRelationship.userRole, "");
    const world = readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json"));
    const portfolio = world.bible.portfolio.find((item) => item.slot === 2);
    assert.equal(portfolio?.rpHook, file.brief.rpHook);
    assert.equal(portfolio?.relationshipTrope, file.brief.relationshipTrope);
    assert.equal(file.draft.hook.rpHook, file.brief.rpHook);
    assert.equal(file.draft.hook.relationshipTrope, file.brief.relationshipTrope);
    assert.equal(draft.promptStandard, undefined);
    assert.equal(draft.hook.rpHook, file.brief.rpHook);
    assert.equal(draft.hook.relationshipTrope, file.brief.relationshipTrope);
    assert.equal(comment, file.bible.publicProfile.creatorComment);
    assert.match(comment, /처형 명령서에 이름이 올라 있고/);
    assert.match(comment, /추천 플레이 방향/);
    assert.doesNotMatch(comment, /자신의 방식으로 확인할 수 있다|하나의 도입 상황|이런 식으로 시작해 보세요/);
    assert.doesNotMatch(comment, /진위를 자신의<\/p>/);
    assert.doesNotMatch(comment, /압송해 심문/);
    assert.doesNotMatch(comment, /정략적 혐오에서 맹목적 충성으로/);
    assert.deepEqual(officialPlayStartChoices(draft), []);
    assert.doesNotMatch(comment, /기록을 조사할지|명령을 공개할지|봉인을 지킬지/);
    assert.equal(canonicalPrimaryTrope(file.brief.relationshipTrope), "보호자");
    assert.equal(canonicalPrimaryTrope(portfolio!.relationshipTrope), "보호자");
    const edric = readJson<PilotChar>(path.join(PILOT_DIR, "characters", "pilot-rf-06.json"));
    const noel = readJson<PilotChar>(path.join(PILOT_DIR, "characters", "pilot-rf-08.json"));
    assert.equal(canonicalPrimaryTrope(edric.brief.relationshipTrope), "혐관");
    assert.equal(canonicalPrimaryTrope(noel.brief.relationshipTrope), "혐관");
  });
});

describe("official shot QA path stays non-persistent", () => {
  it("QA script uses prompt/image owners and never writes production rows", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/official-supply-quality-shot-qa.ts"), "utf8");
    const lib = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/qualityShotQa.ts"), "utf8");
    assert.match(source, /buildOfficialAssetPrompts/);
    assert.match(source, /callOpenAiImageEditWithSafetyFallback/);
    assert.match(source, /prepareLucianSig4Trial/);
    assert.match(source, /prepareLucianSig4StyleTrial/);
    assert.match(source, /buildClusterBRofanStyleSeed/);
    assert.match(source, /resolveLucianSig4TrialStyle/);
    assert.match(source, /resolveLucianSig4ProofImageModel/);
    assert.match(source, /identity_then_style/);
    assert.match(source, /references: input.references/);
    assert.match(lib, /OFFICIAL_QUALITY_SHOT_QA_ARTIFACT_DIR/);
    assert.match(lib, /OFFICIAL_QUALITY_SHOT_QA_REFERENCE_PATH/);
    assert.match(lib, /OFFICIAL_QUALITY_SHOT_QA_STYLE_REFERENCE_PATH/);
    assert.match(lib, /OFFICIAL_QUALITY_SHOT_QA_STYLE_COST_APPROVED/);
    assert.match(source, /lucianSig4StyleProviderCallDecision/);
    const mainAt = source.indexOf("async function main(");
    const decisionCallAt = source.indexOf("lucianSig4StyleProviderCallDecision({");
    const generateCallAt = source.indexOf("await generateSlots({");
    assert.ok(mainAt >= 0 && decisionCallAt > mainAt && generateCallAt > decisionCallAt);
    assert.match(lib, /lucian-sig4-style/);
    assert.match(lib, /OFFICIAL_IDENTITY_THEN_STYLE_IMAGE1_LABEL/);
    assert.match(lib, /OFFICIAL_IMAGE2_STYLE_ONLY_EXTRA_BAN/);
    assert.doesNotMatch(lib, /CLUSTER_B_PRIMARY_GENERATION_PATHS\[0\]/);
    assert.match(source, /OFFICIAL_QUALITY_SHOT_QA_CONTACT_SHEET_PATH/);
    assert.match(lib, /\/opt\/cursor\/artifacts\/official-shot-qa/);
    assert.match(lib, /lucian-sig4/);
    assert.match(lib, /ROFAN_CLUSTER_B_VISUAL_STYLE_DNA/);
    assert.match(lib, /isLucianSig4ProofSupportedImageModel/);
    assert.match(lib, /planningCeilingIsProviderHardCap/);
    assert.match(source, /styles\.candidates\[0\]!/);
    assert.doesNotMatch(source, /runOfficialAssetSlot|OfficialSupplyStore|publishOfficialSupplyCharacter|stageOfficialCharacterPrivately|storeUpload/);
    assert.doesNotMatch(lib, /runOfficialAssetSlot|OfficialSupplyStore|publishOfficialSupplyCharacter|stageOfficialCharacterPrivately|storeUpload/);
    assert.doesNotMatch(source, /resolveOfficialStyleGenerationReferences|officialSlotGenerationReferences/);
  });
});
