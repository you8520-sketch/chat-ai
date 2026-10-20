import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import {
  buildCharacterBible1System,
  buildCharacterBondsSystem,
  buildCharacterBondsUser,
  buildCharacterVoiceSystem,
  OFFICIAL_DESIGN_CHECKLIST_LINES,
} from "@/lib/officialSupply/authorPrompts";
import { validatePilotDraftForTextLock } from "@/lib/officialSupply/author";
import {
  compileOfficialDraftFromBible,
  evaluateRelationBibleContract,
  validateCharacterBible,
  type OfficialCharacterBible,
} from "@/lib/officialSupply/bible";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  loadRelationStartBriefs,
  loadRelationStartCandidates,
  compileRelationStartDraft,
  type RelationStartCandidate,
} from "@/lib/officialSupply/relationStartCandidates";
import { buildRelationStartWire } from "@/lib/officialSupply/relationStartWire";
import {
  coerceUserRelationPlan,
  InvalidUserRelationPlanError,
  evaluateUserRelationStart,
  findForcedRelationOutcome,
  OFFICIAL_USER_RELATION_TYPES,
  userEntryWithoutFixedRestatement,
} from "@/lib/officialSupply/userRelationStart";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { estimateTokens } from "@/lib/tokenEstimate";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const LEGACY_KEYS = ["pilot-rf-02", "pilot-rf-03"] as const;
const squash = (text: string): string => text.replace(/\s+/g, "");
const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;
const withoutEndStop = (text: string): string => text.trim().replace(/[.!?。！？]+$/u, "");

/** Round 1: one candidate per type (first GPT evaluation is kept in the review packet). Round 2: one non-document replacement sample. */
const ROUND_ONE_KEYS = ["relation-start-free", "relation-start-role-bound", "relation-start-relationship-bound"] as const;
const ROUND_TWO_KEY = "relation-start-role-bound-field";

function candidates(): RelationStartCandidate[] {
  return loadRelationStartCandidates();
}

function candidateOf(type: (typeof OFFICIAL_USER_RELATION_TYPES)[number]): RelationStartCandidate {
  const found = candidates().find((c) => ROUND_ONE_KEYS.includes(c.key as (typeof ROUND_ONE_KEYS)[number]) && c.bible.userRelationship.type === type);
  assert.ok(found, `generated candidate for ${type}`);
  return found;
}

function withRelation(
  bible: OfficialCharacterBible,
  patch: Partial<OfficialCharacterBible["userRelationship"]>
): OfficialCharacterBible {
  return { ...bible, userRelationship: { ...bible.userRelationship, ...patch } };
}

function withoutV2(bible: OfficialCharacterBible): OfficialCharacterBible {
  const { type: _type, fixedFacts: _fixed, userDecides: _decides, ...relation } = bible.userRelationship;
  const { selfDrive: _selfDrive, ...engine } = bible.rpEngine;
  return { ...bible, userRelationship: relation, rpEngine: engine };
}

describe("official bible V2: three start types", () => {
  it("has one round-1 candidate per type plus the round-2 sample, all passing bible and Text Lock QA", () => {
    const list = candidates();
    assert.deepEqual(
      list.filter((c) => ROUND_ONE_KEYS.includes(c.key as (typeof ROUND_ONE_KEYS)[number])).map((c) => c.bible.userRelationship.type).sort(),
      [...OFFICIAL_USER_RELATION_TYPES].sort()
    );
    assert.ok(list.some((c) => c.key === ROUND_TWO_KEY), "round-2 non-document sample is committed");
    for (const candidate of list) {
      assert.deepEqual(validateCharacterBible(candidate.bible, { adultExpected: false }).errors, [], `${candidate.key} bible`);
      assert.deepEqual(
        validatePilotDraftForTextLock(compileRelationStartDraft(candidate), []).errors,
        [],
        `${candidate.key} draft`
      );
      assert.deepEqual(candidate.bibleQaErrors, [], `${candidate.key} recorded bible QA`);
      assert.deepEqual(candidate.draftQaErrors, [], `${candidate.key} recorded draft QA`);
    }
  });

  it("briefs and generated candidates agree on type and fixed-fact hint", () => {
    const briefs = new Map(loadRelationStartBriefs().map((b) => [b.key, b.brief]));
    for (const candidate of candidates()) {
      const plan = coerceUserRelationPlan(briefs.get(candidate.key)?.userRelation);
      assert.equal(candidate.bible.userRelationship.type, plan.type, candidate.key);
    }
  });

  it("FREE compiles no user-relation essay", () => {
    const free = candidateOf("free");
    assert.equal(free.bible.userRelationship.fixedFacts, "");
    assert.equal(free.bible.userRelationship.userDecides, "");
    const rel = compileRelationStartDraft(free).sections.relationshipsAndDrives;
    assert.doesNotMatch(rel, /유저 관계 원칙|유저가 정하는 것|첫인식:|유저 역할:|시작점:|관계 진행:|관계 변화 조건:/);
  });

  it("ROLE_BOUND and RELATIONSHIP_BOUND compile only the concrete fixed fact", () => {
    for (const [type, label] of [
      ["role_bound", "사건 전제"],
      ["relationship_bound", "고정된 관계"],
    ] as const) {
      const candidate = candidateOf(type);
      const rel = candidate.bible.userRelationship;
      const text = compileRelationStartDraft(candidate).sections.relationshipsAndDrives;
      assert.ok(rel.fixedFacts, `${type} fixedFacts`);
      assert.match(text, new RegExp(`${label}: `));
      assert.doesNotMatch(text, /유저가 정하는 것:|유저 관계 원칙:/);
      assert.equal(findForcedRelationOutcome([rel.fixedFacts ?? "", ...rel.progression, rel.startingPoint, rel.initialView]), null);
    }
  });

  it("a verbatim restatement of fixedFacts in the user-entry scene is dropped; other entries and legacy bibles are unchanged", () => {
    const fixed = "유저는 보급 상단이 고용한 호송 용병이며, 눈보라로 길이 끊겨 흑철 요새에 발이 묶였다.";
    const entry = `${fixed} 브리타는 호송대의 짐을 확인한다. 그녀는 피난 경로를 가리킨다.`;
    assert.equal(userEntryWithoutFixedRestatement(entry, fixed), "브리타는 호송대의 짐을 확인한다. 그녀는 피난 경로를 가리킨다.");
    assert.equal(userEntryWithoutFixedRestatement(entry, ""), entry);
    assert.equal(userEntryWithoutFixedRestatement(entry, undefined), entry);
    assert.equal(userEntryWithoutFixedRestatement("브리타는 짐을 확인한다.", fixed), "브리타는 짐을 확인한다.");
    assert.equal(userEntryWithoutFixedRestatement(fixed, fixed), fixed, "never empties the scene");
    const field = candidates().find((c) => c.key === ROUND_TWO_KEY);
    assert.ok(field);
    assert.ok(field.bible.situation.userEntry.includes(field.bible.userRelationship.fixedFacts ?? "\u0000"), "the raw author text restates the fixed fact");
    const draft = compileRelationStartDraft(field);
    const whole = [draft.sections.currentSituation ?? "", draft.sections.relationshipsAndDrives].join("\n");
    assert.equal(occurrences(squash(whole), squash(field.bible.userRelationship.fixedFacts ?? "")), 1, "the compiled setting carries it once");
  });

  it("every type carries the character's own goal, move and cost, independent of the user", () => {
    for (const candidate of candidates()) {
      const drive = candidate.bible.rpEngine.selfDrive;
      assert.ok(drive, `${candidate.key} selfDrive`);
      for (const value of [drive.goal, drive.ownMove, drive.setback]) assert.ok(value.length >= 20, candidate.key);
      assert.doesNotMatch(`${drive.goal}\n${drive.ownMove}`, /당신|유저|\{\{user\}\}/);
      const compiled = compileRelationStartDraft(candidate).sections.relationshipsAndDrives;
      assert.ok(compiled.includes(`목표: ${withoutEndStop(drive.goal)}`), `${candidate.key}: goal compiled`);
      assert.ok(compiled.includes(`스스로 택하는 행동: ${withoutEndStop(drive.ownMove)}`), `${candidate.key}: own move compiled`);
      assert.ok(compiled.includes(`막힘·대가: ${withoutEndStop(drive.setback)}`), `${candidate.key}: setback compiled`);
    }
  });

  it("compiled relationship text does not list warming and retreating endings", () => {
    for (const candidate of candidates()) {
      const text = compileRelationStartDraft(candidate).sections.relationshipsAndDrives;
      assert.doesNotMatch(text, /관계 진행:|관계 변화 조건:|중기 갈등|장기 변화/);
      assert.equal(findForcedRelationOutcome(candidate.bible.userRelationship.progression), null);
    }
  });
});

describe("official bible V2: deterministic QA catches violations (negative controls)", () => {
  const relationBound = (): OfficialCharacterBible => candidateOf("relationship_bound").bible;
  const free = (): OfficialCharacterBible => candidateOf("free").bible;
  const codes = (bible: OfficialCharacterBible): string[] =>
    evaluateUserRelationStart({ userRelationship: bible.userRelationship }).errors.map((e) => e.code);

  it("passes the three generated bibles", () => {
    for (const candidate of candidates()) assert.deepEqual(codes(candidate.bible), [], candidate.key);
  });

  it("rejects an unknown type, FREE with fixed text, and a bound type without fixed/decides", () => {
    assert.ok(codes(withRelation(free(), { type: "other" as never })).includes("bible_user_rel_type_invalid"));
    assert.ok(codes(withRelation(free(), { fixedFacts: "두 사람은 어릴 적 같은 마을에서 자란 사이다." })).includes("bible_user_rel_free_fixed"));
    const empty = codes(withRelation(relationBound(), { fixedFacts: "", userDecides: "" }));
    assert.ok(empty.includes("bible_user_rel_fixed_missing"));
    assert.equal(empty.includes("bible_user_rel_decides_missing"), false);
  });

  it("rejects an explicit invalid start type at the input boundary instead of demoting it to FREE", () => {
    assert.equal(coerceUserRelationPlan(undefined).type, "free");
    assert.equal(coerceUserRelationPlan(null).type, "free");
    assert.equal(coerceUserRelationPlan({}).type, "free");
    assert.deepEqual(coerceUserRelationPlan({ type: "role_bound", fixed: "유저는 호송 용병이다." }), { type: "role_bound", fixed: "유저는 호송 용병이다." });
    for (const bad of [{ type: "relationship-bound", fixed: "x" }, { fixed: "약혼이 공시됐다." }, { type: 3 }, "role_bound", ["free"]]) {
      assert.throws(() => coerceUserRelationPlan(bad), InvalidUserRelationPlanError, JSON.stringify(bad));
    }
  });

  it("rejects forced affection, surrender and fixed-turn progression", () => {
    for (const text of ["두 사람은 결국 서로를 사랑하게 된다.", "반드시 마음을 열게 된다.", "3턴 후 굴복하게 된다.", "매 턴 속마음을 말한다."]) {
      assert.ok(findForcedRelationOutcome([text]), text);
    }
    const forced = withRelation(relationBound(), {
      progression: ["당신이 협력하면 신뢰가 쌓인다.", "당신이 배신하면 멀어진다.", "5턴 뒤 반드시 사랑에 빠진다."],
    });
    assert.ok(codes(forced).includes("bible_user_rel_forced_outcome"));
  });

  it("does not require a two-direction progression list", () => {
    const warmOnly = withRelation(free(), {
      progression: ["당신이 증거를 공유하면 신뢰가 쌓이고 협력이 깊어진다.", "당신이 곁에 머물면 호감이 커지고 의지하게 된다."],
    });
    assert.equal(codes(warmOnly).includes("bible_progression_one_directional"), false);
  });

  it("rejects a gendered user in the fixed facts", () => {
    const gendered = withRelation(relationBound(), {
      fixedFacts: "황실 의무 결속령으로 아가씨와 이졸데의 약혼이 공시됐으며 두 사람은 공식 석상에서 만났다.",
    });
    assert.ok(codes(gendered).some((code) => /gender/.test(code)), codes(gendered).join(","));
  });

  it("requires a user-independent self drive and rejects shared RP directives in the character setting", () => {
    const base = free();
    const drive = base.rpEngine.selfDrive;
    assert.ok(drive);
    const withDrive = (patch: Partial<typeof drive> | null): OfficialCharacterBible => {
      const { selfDrive: _omit, ...engine } = base.rpEngine;
      return { ...base, rpEngine: patch ? { ...engine, selfDrive: { ...drive, ...patch } } : engine };
    };
    const codesOf = (bible: OfficialCharacterBible): string[] => evaluateRelationBibleContract(bible).errors.map((e) => e.code);
    assert.deepEqual(codesOf(base), []);
    const legacy = withoutV2(base);
    assert.deepEqual(codesOf({ ...legacy, rpEngine: { ...legacy.rpEngine, mediumConflict: "응답 분량은 항상 1500자 이상으로 유지한다." } }), [], "untyped legacy bibles are not re-judged");
    assert.ok(codesOf(withDrive(null)).includes("bible_self_drive_missing"), "a typed bible must carry selfDrive");
    assert.ok(codesOf(withDrive({ goal: "짧다" })).includes("bible_self_drive_thin"));
    assert.ok(codesOf(withDrive({ ownMove: "당신이 찾아오면 곧바로 도와줄 방법을 스스로 정한다" })).includes("bible_self_drive_user_dependent"));
    const remembers = { ...base, rpEngine: { ...base.rpEngine, mediumConflict: "그녀는 사라진 동료의 마지막 말을 끝내 기억한다. 그 말이 판단을 흔든다." } };
    assert.deepEqual(codesOf(remembers), [], "a character remembering a person is not a shared memory directive");
    const memoryDirective = { ...base, rpEngine: { ...base.rpEngine, mediumConflict: "이전 대화를 기억하고 그에 맞춰 답한다." } };
    assert.ok(codesOf(memoryDirective).includes("bible_common_directive"));
    const directive = { ...base, rpEngine: { ...base.rpEngine, mediumConflict: "응답 분량은 항상 1500자 이상으로 유지하고 매 턴 내면 서술을 넣는다." } };
    assert.ok(codesOf(directive).includes("bible_common_directive"));
  });
});

describe("official bible V2: 19-item checklist is a design aid, not output fields", () => {
  const ITEM_COUNT = 19;

  it("lists 19 design items, excludes the world, and is injected once into the part1 author prompt", () => {
    const items = OFFICIAL_DESIGN_CHECKLIST_LINES.slice(1, 4)
      .join(" ")
      .split("/")
      .map((item) => item.replace(/\.$/, "").trim())
      .filter(Boolean);
    assert.equal(items.length, ITEM_COUNT);
    assert.ok(items.every((item) => !/^세계관/.test(item)));
    const system = buildCharacterBible1System();
    assert.equal(occurrences(system, OFFICIAL_DESIGN_CHECKLIST_LINES[0]), 1);
    assert.equal(occurrences(buildCharacterVoiceSystem(), OFFICIAL_DESIGN_CHECKLIST_LINES[0]), 0, "voice call does not repeat the checklist");
    assert.equal(occurrences(buildCharacterBondsSystem(), OFFICIAL_DESIGN_CHECKLIST_LINES[0]), 0, "bonds call does not repeat the checklist");
  });

  it("each always-required item is carried by an existing canonical field in every generated bible", () => {
    const owners: Record<string, (b: OfficialCharacterBible) => unknown> = {
      "기본 스펙·외형": (b) => b.identity.name && b.appearance.faceShape,
      "현재 신분·상황·생활 환경": (b) => b.situation.personalSituation && b.dailyLife,
      "성격 구조·판단 방식": (b) => b.personality.behavioral,
      "욕망·목표·결핍": (b) => b.values.desires[0] && b.rpEngine.selfDrive?.goal,
      "가치관·신념·금기": (b) => b.values.coreValues[0] && b.values.nonNegotiable[0],
      "과거 형성 사건": (b) => b.backstory.events[0]?.residue,
      "내면 모순·외적 가면": (b) => b.contradiction,
      "약점·두려움·방어기제·무너지는 조건": (b) => b.values.fears[0],
      "말투·호칭": (b) => b.speech.description,
      "습관·비언어적 버릇": (b) => b.habits.habits[0],
      "능력·자원·한계": (b) => b.abilities[0]?.limit,
      "취미·기호·일상": (b) => b.habits.hobbies[0],
      "사용자 없이도 스스로 하는 행동·선택": (b) => b.rpEngine.selfDrive?.ownMove,
    };
    for (const candidate of candidates()) {
      for (const [item, read] of Object.entries(owners)) {
        assert.ok(read(candidate.bible), `${candidate.key}: ${item}`);
      }
    }
    assert.equal(
      Object.keys(owners).length + 6,
      ITEM_COUNT,
      "user view, progression, secrets, supporting characters, unresolved conflict and romance stay optional"
    );
  });

  it("the bonds user prompt sends only the planned type's rule, not all three", () => {
    const rules = (type: "free" | "role_bound" | "relationship_bound"): string =>
      buildCharacterBondsUser({
        name: "테스트",
        age: 30,
        rpHook: "훅",
        adultCandidate: false,
        castList: [],
        part1Recap: "",
        userRelation: { type, fixed: type === "free" ? "" : "고정된 사실" },
      });
    const free = rules("free");
    const role = rules("role_bound");
    const relation = rules("relationship_bound");
    assert.match(free, /FREE —/);
    assert.doesNotMatch(free, /ROLE_BOUND —|RELATIONSHIP_BOUND —/);
    assert.match(role, /ROLE_BOUND —/);
    assert.doesNotMatch(role, /FREE —|RELATIONSHIP_BOUND —/);
    assert.match(relation, /RELATIONSHIP_BOUND —/);
    assert.doesNotMatch(relation, /FREE —|ROLE_BOUND —/);
  });
});

describe("official bible V2: Lucian and Wolfgang omit user-relation essays", () => {
  for (const key of LEGACY_KEYS) {
    it(`${key}: compiled relationship text has no user-meta essay and matches the stored Text Lock`, () => {
      const stored = JSON.parse(fs.readFileSync(path.join(PILOT_DIR, "characters", `${key}.json`), "utf8")) as {
        bible: OfficialCharacterBible;
        draft: ReturnType<typeof compileOfficialDraftFromBible>;
      };
      if (key === "pilot-rf-03") {
        assert.equal(stored.bible.userRelationship.type, undefined);
        assert.equal(stored.bible.rpEngine.selfDrive, undefined);
      } else {
        assert.equal(stored.bible.userRelationship.type, "free");
        assert.ok(stored.bible.rpEngine.selfDrive);
      }
      assert.equal(evaluateRelationBibleContract(stored.bible).errors.length, 0);
      const source = loadCompiledOfficialCharacterSource(key);
      const rel = source.draft.sections.relationshipsAndDrives;
      assert.doesNotMatch(rel, /유저 관계 원칙:|유저가 정하는 것:|첫인식:|유저 역할:/);
      assert.equal(computeTextLockHash(source.draft), computeTextLockHash(stored.draft), `${key} Text Lock hash`);
    });
  }
});

describe("official bible V2: save and final RP wire carry the start type once, without truncation", () => {
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

  for (const key of [...ROUND_ONE_KEYS, ROUND_TWO_KEY]) {
    it(`${key}: fixed facts, user choices and self drive reach the final system prompt exactly once`, async () => {
      const candidate = candidates().find((c) => c.key === key);
      assert.ok(candidate, key);
      const type = candidate.bible.userRelationship.type ?? "free";
      const wire = await buildRelationStartWire(candidate);
      assert.equal(wire.settingOverflowChars, 0, "RP setting source has no overflow");
      const prompt = squash(wire.systemPrompt);
      const rel = candidate.bible.userRelationship;
      const drive = candidate.bible.rpEngine.selfDrive;
      assert.ok(drive);
      for (const [label, text] of [
        ["selfDrive.goal", withoutEndStop(drive.goal)],
        ["selfDrive.ownMove", withoutEndStop(drive.ownMove)],
        ["selfDrive.setback", withoutEndStop(drive.setback)],
        ...(type === "free" ? [] : ([["fixedFacts", rel.fixedFacts ?? ""]] as const)),
      ] as const) {
        assert.equal(occurrences(prompt, squash(text)), 1, `${type}: ${label} is injected exactly once`);
      }
      if (type !== "free") assert.equal(occurrences(prompt, squash(rel.userDecides ?? "")), 0);
      assert.doesNotMatch(wire.systemPrompt, /유저 관계 원칙:/);
    });
  }

  it("keeps the V2 setting-token cost small", () => {
    for (const candidate of candidates()) {
      const v2 = compileRelationStartDraft(candidate).sections.relationshipsAndDrives;
      const legacy = compileRelationStartDraft({ ...candidate, bible: withoutV2(candidate.bible) }).sections.relationshipsAndDrives;
      const delta = estimateTokens(v2) - estimateTokens(legacy);
      assert.ok(delta <= 450, `${candidate.key}: V2 relationship delta ${delta} tokens`);
    }
  });
});
