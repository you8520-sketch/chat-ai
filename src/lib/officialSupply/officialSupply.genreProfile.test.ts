import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { CHARACTER_GENRES } from "@/lib/characterGenres";
import {
  buildCharacterBible1System,
  buildCharacterBible1User,
  buildCharacterBondsSystem,
  buildCharacterBondsUser,
  buildCharacterVoiceSystem,
  buildCharacterVoiceUser,
  buildPortfolioReplacementUser,
  buildStyleBoardSystem,
  buildWorldAtlasUser,
  buildWorldBibleSystem,
  buildWorldCoreUser,
  buildWorldPortfolioUser,
  describeCastForPlanning,
  type PortfolioBriefInput,
  type WorldBibleInput,
  type WorldMarketInput,
} from "@/lib/officialSupply/authorPrompts";
import type { OfficialWorldBible } from "@/lib/officialSupply/bible";
import {
  OFFICIAL_ROFAN_GENRE,
  ROFAN_PARITY_PLAN,
  recommendOfficialAuthoringDirection,
  resolveOfficialAuthoringPlan,
  resolveOfficialGenreProfile,
  type OfficialAuthoringDirection,
  type OfficialAuthoringPlan,
} from "@/lib/officialSupply/genreProfile";
import {
  evaluateBriefCastFit,
  formatMarketSignalLines,
  isRomanceLedSignal,
  selectMarketSignals,
  type OfficialBatchMarketPolicy,
  type OfficialMarketFitBrief,
} from "@/lib/officialSupply/marketFit";
import type { ResearchSnapshot } from "@/lib/officialSupply/research";

const SNAPSHOT_FILE = path.join(process.cwd(), "docs/official-supply/market-research-snapshot-2026-09.json");
const PILOT_WORLD = path.join(process.cwd(), "src/lib/officialSupply/pilot/world-bible.json");
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")) as ResearchSnapshot;
const pilotWorld = (JSON.parse(fs.readFileSync(PILOT_WORLD, "utf8")) as { bible: OfficialWorldBible }).bible;

const POLICY: OfficialBatchMarketPolicy = {
  targetLocale: "ko-KR",
  signalRegion: "KR",
  marketPriority: "domestic_first",
  maxSupportingSignals: 4,
  marketRoleMix: { proven: { min: 0, max: 1 }, proven_twist: { min: 0, max: 1 }, experimental: { min: 0, max: 1 } },
  maxPrimaryTropeRepeat: 1,
  coreTags: { min: 4, max: 7 },
  maxTaglineWorldTerms: 2,
};

function marketFor(plan: OfficialAuthoringPlan): WorldMarketInput {
  const selection = selectMarketSignals(snapshot, POLICY, plan.genre ?? "", {
    excludeRomanceLed: plan.profile.excludeRomanceLedSignals,
  });
  return {
    targetLocale: POLICY.targetLocale,
    marketPriority: POLICY.marketPriority,
    signalLines: formatMarketSignalLines(selection),
    namingProfile: plan.namingProfile,
    marketRoleMix: POLICY.marketRoleMix,
    maxPrimaryTropeRepeat: POLICY.maxPrimaryTropeRepeat,
    coreTags: POLICY.coreTags,
  };
}

const BRIEF: PortfolioBriefInput = {
  slot: 1,
  name: "한소리",
  gender: "female",
  age: 27,
  archetype: "말 많은 수습",
  relationshipTrope: "라이벌",
  occupation: "방송부 신입",
  faction: "방송부",
  socialPosition: "2학년",
  personalityCore: "허세와 눈치",
  visualSilhouette: "작은 키에 큰 헤드셋",
  rpHook: "당신의 마이크를 먼저 켜 버린다",
  adultCandidate: false,
  speechDirection: "빠르고 짧은 반말",
  audience: "all",
};

type Composition = {
  worldSystem: string;
  worldCore: string;
  worldPortfolio: string;
  replacement: string;
  part1System: string;
  part1User: string;
  voiceSystem: string;
  voiceUser: string;
  bondsSystem: string;
  bondsUser: string;
  styleSystem: string;
};

function compose(plan: OfficialAuthoringPlan | undefined): Composition {
  const market = marketFor(plan ?? ROFAN_PARITY_PLAN);
  const world: WorldBibleInput = {
    genre: plan?.genre ?? OFFICIAL_ROFAN_GENRE,
    worldKey: "w",
    styleKey: "k_v1",
    market,
    slots: 1,
    adultCandidates: 0,
    genderMix: "여성 1명",
    slotGenders: ["female"],
    castIntent: "전체 이용자",
    authoring: plan,
  };
  return {
    worldSystem: buildWorldBibleSystem(plan),
    worldCore: buildWorldCoreUser(world),
    worldPortfolio: buildWorldPortfolioUser({
      worldName: "W",
      centralPremise: "C",
      factionNames: ["방송부"],
      locationNames: ["옥상"],
      slots: 1,
      adultCandidates: 0,
      genderMix: "여성 1명",
      slotGenders: ["female"],
      market,
      authoring: plan,
    }),
    replacement: buildPortfolioReplacementUser({
      worldName: "W",
      centralPremise: "C",
      factionNames: ["방송부"],
      locationNames: ["옥상"],
      market,
      castIntent: "전체 이용자",
      keptSiblings: ["가온 — female, 사서, 라이벌"],
      slots: [{ slot: 1, gender: "female", adultCandidate: false, direction: "d" }],
      authoring: plan,
    }),
    part1System: buildCharacterBible1System(plan),
    part1User: buildCharacterBible1User({ brief: BRIEF, worldName: "W", worldContext: "ctx", siblingSketches: [], authoring: plan }),
    voiceSystem: buildCharacterVoiceSystem(true, plan),
    voiceUser: buildCharacterVoiceUser({
      name: BRIEF.name,
      age: BRIEF.age,
      adultCandidate: false,
      speechDirection: BRIEF.speechDirection,
      part1Recap: "recap",
      npcDemand: "0",
      authoring: plan,
    }),
    bondsSystem: buildCharacterBondsSystem(),
    bondsUser: buildCharacterBondsUser({
      name: BRIEF.name,
      age: BRIEF.age,
      rpHook: BRIEF.rpHook,
      adultCandidate: false,
      castList: [],
      part1Recap: "recap",
      authoring: plan,
    }),
    styleSystem: buildStyleBoardSystem(plan),
  };
}

const ROFAN_ONLY_STRINGS = ["로맨스 판타지", "황태자", "기사단장", "마탑주", "북부 대공", "냉미남", "집착남", "DOMESTIC ROFAN", "190cm", "황자"];
const DIRECTION_HEADER = "창작 방향(";
const count = (text: string, needle: string) => text.split(needle).length - 1;

/** Same market as `compose(undefined)`; bytes match `git show 2ae39783` authorPrompts (see scripts/compare-rofan-baseline.mts). */
const G5_1D_ROFAN_WORLD_CORE_SHA256 = "73919ae96b84c97a7ac042f3f033beb2810d7854f65213be7b4f1bc70dc84319";

const ROFAN_SERIOUS: OfficialAuthoringDirection = { genre: OFFICIAL_ROFAN_GENRE, tone: "serious", humor: "none" };
const SCHOOL_COMEDY: OfficialAuthoringDirection = {
  genre: "학원",
  tone: "light",
  humor: "central",
  pacing: "dialogue",
  nameWordplay: "nickname",
  namingProfile: "korean_modern",
};
const HORROR_DRY: OfficialAuthoringDirection = {
  genre: "공포/추리",
  tone: "dry",
  humor: "light",
  pacing: "narration",
  nameWordplay: "pun",
};

describe("genre profile owner — rofan parity", () => {
  it("absent plan and explicit rofan plan render identical prompts for every builder", () => {
    const explicit = compose(resolveOfficialAuthoringPlan({ genre: OFFICIAL_ROFAN_GENRE }));
    const legacy = compose(undefined);
    const overlapRule = explicit.replacement.split("\n").filter((line) => /^(겹침 판단|각 축이)/.test(line));
    assert.equal(overlapRule.length, 2, "an explicit plan adds only the cast-experience overlap rule");
    const withoutOverlap = explicit.replacement.split("\n").filter((line) => !overlapRule.includes(line)).join("\n");
    assert.deepEqual({ ...explicit, replacement: withoutOverlap }, legacy);
  });

  it("rofan worldCore byte-matches G5-1D authorPrompts baseline (2ae39783)", () => {
    const core = compose(undefined).worldCore;
    assert.ok(!core.includes("키=영역명"), "full-scale society hint must not appear on rofan/absent plan");
    assert.equal(
      core.split("\n").find((line) => line.startsWith("- society:")),
      "- society: RP에 영향을 주는 영역 3개 이상(계급·법·결혼/가족·교육·직업·군사·차별/예절 중)"
    );
    assert.equal(createHash("sha256").update(core).digest("hex"), G5_1D_ROFAN_WORLD_CORE_SHA256);
  });

  it("the rofan parity profile carries the pre-G5 wording and no direction block", () => {
    const c = compose(undefined);
    assert.ok(c.worldSystem.startsWith("너는 로맨스 판타지 세계관 아키텍트다.\n10명의 플레이어블 캐릭터가"));
    assert.match(c.worldCore, /황태자·기사단장·마탑주·북부 대공 등/);
    assert.match(c.worldPortfolio, /냉미남·집착남·황태자·계약관계·검은머리·190cm 클론 금지/);
    assert.match(c.part1System, /^너는 로맨스 판타지 캐릭터 작가다\./);
    assert.match(c.part1System, /개인적 관심·애정 앞에서/);
    assert.match(c.voiceSystem, /황자·기사단장·청부업자 등/);
    assert.match(c.styleSystem, /\[DOMESTIC ROFAN PRODUCT DIRECTION\]/);
    for (const text of Object.values(c)) assert.equal(count(text, DIRECTION_HEADER), 0);
    assert.equal(count(c.replacement, "겹침 판단"), 0, "legacy replacement callers keep their exact prompt");
  });
});

describe("genre profile owner — genre-generic composition", () => {
  it("resolves all 19 site genres; only rofan gets the rofan profile, undefined genres fall back to neutral", () => {
    assert.equal(CHARACTER_GENRES.length, 19);
    for (const genre of CHARACTER_GENRES) {
      const profile = resolveOfficialGenreProfile(genre);
      assert.equal(profile.key, genre === OFFICIAL_ROFAN_GENRE ? "rofan_parity" : "genre_neutral", genre);
    }
    for (const unknown of [undefined, "", "판타지/SF", "없는 장르"]) {
      const plan = resolveOfficialAuthoringPlan({ genre: unknown });
      assert.equal(plan.profile.key, "genre_neutral");
      assert.equal(plan.genre, null);
      assert.ok(!compose(plan).worldSystem.includes("로맨스 판타지"));
    }
  });

  it("no non-rofan genre's prompts carry rofan-only wording", () => {
    for (const genre of CHARACTER_GENRES.filter((g) => g !== OFFICIAL_ROFAN_GENRE)) {
      const c = compose(resolveOfficialAuthoringPlan({ genre }));
      for (const [key, text] of Object.entries(c)) {
        for (const needle of ROFAN_ONLY_STRINGS) {
          // 시장 신호 lines may quote another genre's trope vocabulary only for that signal's own genre.
          if (key === "worldCore" || key === "worldPortfolio" || key === "replacement") {
            const withoutSignals = text.split("\n").filter((l) => !l.startsWith("- [")).join("\n");
            assert.ok(!withoutSignals.includes(needle), `${genre} ${key} contains "${needle}"`);
          } else {
            assert.ok(!text.includes(needle), `${genre} ${key} contains "${needle}"`);
          }
        }
      }
    }
  });

  it("rofan serious, school comedy and horror dry black comedy compose different prompts", () => {
    const rofan = compose(resolveOfficialAuthoringPlan(ROFAN_SERIOUS));
    const school = compose(resolveOfficialAuthoringPlan(SCHOOL_COMEDY));
    const horror = compose(resolveOfficialAuthoringPlan(HORROR_DRY));

    assert.match(rofan.part1System, /로맨스 판타지 캐릭터 작가/);
    assert.match(school.part1System, /^너는 학원 캐릭터 작가다\./);
    assert.match(horror.part1System, /^너는 공포\/추리 캐릭터 작가다\./);

    assert.match(rofan.part1User, /문체: 진지하게/);
    assert.match(rofan.part1User, /유머 비중: 없음/);
    assert.match(school.part1User, /문체: 경쾌하게/);
    assert.match(school.part1User, /유머 비중: 핵심/);
    assert.match(school.part1User, /웃기는 상황과 인물의 행동이 다음 사건을 만든다/);
    assert.ok(!school.part1User.includes("대신하지"));
    assert.match(horror.part1User, /문체: 건조하게/);
    assert.match(horror.part1User, /유머 비중: 가벼움/);

    assert.match(school.voiceUser, /대사 중심/);
    assert.match(horror.voiceUser, /서술 중심/);
    assert.ok(!/전개 비중/.test(rofan.voiceUser));

    const modern = compose(resolveOfficialAuthoringPlan(recommendOfficialAuthoringDirection("현대/일상")));
    assert.match(modern.voiceUser, /문체: 경쾌하게/);
    assert.match(modern.voiceUser, /유머 비중: 핵심/);
    assert.match(modern.voiceUser, /전개 비중: 대사 중심/);
    assert.match(modern.worldPortfolio, /별명은 name의 괄호 별칭/);
    assert.match(modern.part1User, /identity\.name은 브리프 name을 그대로 유지한다/);
    assert.ok(!modern.part1User.includes("별명은 name의 괄호 별칭"));
    assert.match(modern.voiceUser, /주어진 이름\(괄호 별칭이 있으면 포함\)을 공개 소개와 첫 장면/);
    assert.match(modern.voiceUser, /이름을 새로 정하거나 바꾸지 않으며/);
    assert.match(modern.voiceUser, /대사마다 별명을 반복하지 않는다/);
    assert.ok(!modern.voiceUser.includes("별명은 name의 괄호 별칭"));
    assert.ok(!modern.worldCore.includes("이름 방식"));
    assert.ok(!modern.bondsUser.includes("이름 방식"));
    assert.ok(!compose(undefined).part1User.includes("이름 방식"));
    assert.ok(!compose(undefined).voiceUser.includes("이름 방식"));

    assert.match(school.worldPortfolio, /별명은 name의 괄호 별칭/);
    assert.match(school.part1User, /identity\.name은 브리프 name을 그대로 유지한다/);
    assert.match(horror.worldPortfolio, /이름 자체를 말장난으로/);
    assert.match(horror.replacement, /현대 인터넷 유행어를 이세계·시대 배경에 섞지 않는다/);
    assert.match(horror.part1User, /identity\.name은 브리프 name을 그대로 유지한다/);
    assert.ok(!horror.part1User.includes("이름 자체를 말장난으로"));
    assert.match(horror.voiceUser, /주어진 이름\(괄호 별칭이 있으면 포함\)/);
    assert.ok(!horror.voiceUser.includes("이름 자체를 말장난으로"));
    assert.ok(!/이름 방식/.test(rofan.worldPortfolio));

    assert.notEqual(school.part1User, horror.part1User);
    assert.notEqual(school.voiceSystem, rofan.voiceSystem);
  });

  it("each direction instruction appears at most once per provider call", () => {
    for (const direction of [ROFAN_SERIOUS, SCHOOL_COMEDY, HORROR_DRY]) {
      const c = compose(resolveOfficialAuthoringPlan(direction));
      for (const [key, text] of Object.entries(c)) {
        assert.ok(count(text, DIRECTION_HEADER) <= 1, `${direction.genre} ${key} repeats the direction block`);
        for (const marker of ["문체:", "유머 비중:", "전개 비중:", "이름 방식:"]) {
          assert.ok(count(text, marker) <= 1, `${direction.genre} ${key} repeats ${marker}`);
        }
      }
    }
  });

  it("non-romance genres get an open user relation; romance-family genres do not", () => {
    for (const genre of CHARACTER_GENRES) {
      const c = compose(resolveOfficialAuthoringPlan({ genre }));
      const open = c.part1User.includes("유저와의 관계는 연애로 한정하지 않는다");
      const romanceFamily = ["로맨스", "로맨스 판타지", "BL", "GL", "HL"].includes(genre);
      assert.equal(open, !romanceFamily, genre);
      assert.equal(c.part1System.includes("개인적 관심·애정 앞에서"), romanceFamily, genre);
    }
    const horror = compose(resolveOfficialAuthoringPlan(HORROR_DRY));
    assert.match(horror.bondsUser, /연애로 한정하지 않는다/);
    assert.match(horror.part1System, /누군가 다가오거나 도움·호의를 건넬 때/);
  });

  it("world core asks non-magic worlds to describe influence rules instead of inventing magic", () => {
    const school = compose(resolveOfficialAuthoringPlan(SCHOOL_COMEDY));
    assert.match(school.worldCore, /초자연 능력이 없는 세계라면 powerSystem은/);
    assert.ok(!compose(undefined).worldCore.includes("초자연 능력이 없는 세계"));
  });

  it("visual direction is injected for rofan only", () => {
    assert.match(buildStyleBoardSystem(), /DOMESTIC ROFAN PRODUCT DIRECTION/);
    for (const genre of CHARACTER_GENRES.filter((g) => g !== OFFICIAL_ROFAN_GENRE)) {
      assert.ok(!buildStyleBoardSystem(resolveOfficialAuthoringPlan({ genre })).includes("ROFAN"), genre);
    }
  });

  it("naming profile follows genre unless the direction overrides it; tone and naming stay independent", () => {
    assert.equal(resolveOfficialAuthoringPlan({ genre: "무협" }).namingProfile, "eastern_historical");
    assert.equal(resolveOfficialAuthoringPlan({ genre: "무협", tone: "light", humor: "central" }).namingProfile, "eastern_historical");
    assert.equal(resolveOfficialAuthoringPlan({ genre: "학원", namingProfile: "korean_codename" }).namingProfile, "korean_codename");
    assert.equal(resolveOfficialAuthoringPlan({ genre: OFFICIAL_ROFAN_GENRE, humor: "central", tone: "satirical" }).namingProfile, "western_rofan");
  });

  it("cast sketches carry goal, first event, user dynamic and voice so overlap is judged by experience", () => {
    const sketch = describeCastForPlanning({ ...BRIEF, marketFit: null });
    for (const needle of ["방송부 신입", "허세와 눈치", "당신의 마이크를 먼저 켜 버린다", "빠르고 짧은 반말"]) assert.ok(sketch.includes(needle), needle);
  });

  it("the replacement overlap rule is added only when an authoring plan is supplied", () => {
    const withPlan = compose(resolveOfficialAuthoringPlan(SCHOOL_COMEDY)).replacement;
    assert.match(withPlan, /목표·첫 사건·말투·유저와의 역학·유머 방식·플레이 경험/);
    assert.match(withPlan, /트로프 자체를 피하지 않는다/);
  });

  it("puts cast intent on the world stage only for a genre-neutral plan", () => {
    const legacy = compose(undefined);
    const rofan = compose(resolveOfficialAuthoringPlan({ genre: OFFICIAL_ROFAN_GENRE }));
    const school = compose(resolveOfficialAuthoringPlan(SCHOOL_COMEDY));
    for (const core of [legacy.worldCore, rofan.worldCore]) {
      assert.ok(!core.includes("캐스트 의도"));
      assert.ok(!core.includes("첫 행동이 벌어지는 무대"));
    }
    assert.match(school.worldCore, /캐스트 의도: 전체 이용자/);
    assert.match(school.worldCore, /신호의 인물 관계를 세계의 줄거리로 쓰지 않는다/);
    assert.ok(!buildWorldAtlasUser({ worldName: "W", centralPremise: "C", factionNames: ["방송부"] }).includes("캐스트 의도"));
    assert.match(
      buildWorldAtlasUser({ worldName: "W", centralPremise: "C", factionNames: ["방송부"], castIntent: "이웃으로 엮인다" }),
      /장소에서 벌어지는 사건은 이 의도의 관계와 첫 행동이다/
    );
    const portfolio = buildWorldPortfolioUser({
      worldName: "W",
      centralPremise: "C",
      factionNames: ["방송부"],
      locationNames: ["옥상"],
      slots: 1,
      adultCandidates: 0,
      genderMix: "여성 1명",
      slotGenders: ["female"],
      market: marketFor(resolveOfficialAuthoringPlan(SCHOOL_COMEDY)),
      castIntent: "이웃·동료·룸메이트",
      authoring: resolveOfficialAuthoringPlan(SCHOOL_COMEDY),
    });
    assert.match(portfolio, /이 슬롯의 정체로 쓰지 않는다/);
    assert.ok(!school.worldPortfolio.includes("이 슬롯의 정체로"));
    assert.match(school.replacement, /이 슬롯의 정체로 쓰지 않는다/);
    assert.ok(!rofan.replacement.includes("이 슬롯의 정체로"));
    assert.match(school.part1User, /본인에게 그는·그가·그를 쓰지 않는다/);
    assert.ok(!rofan.part1User.includes("본인에게 그는"));
    assert.ok(!school.voiceUser.includes("본인에게 그는"));
    const voiced = buildCharacterVoiceUser({
      name: BRIEF.name,
      age: BRIEF.age,
      gender: "female",
      adultCandidate: false,
      speechDirection: BRIEF.speechDirection,
      part1Recap: "recap",
      npcDemand: "0",
      authoring: resolveOfficialAuthoringPlan(SCHOOL_COMEDY),
    });
    assert.match(voiced, /그녀·그녀는·그녀가·그녀를·그녀의/);
  });
});

describe("market signal input by genre", () => {
  const ids = (selection: ReturnType<typeof selectMarketSignals>) =>
    [...selection.primary, ...selection.supporting].map((s) => s.signalId);
  const byId = new Map(snapshot.signals.map((s) => [s.signalId, s] as const));

  it("drops romance-led signals for non-romance genres and keeps non-romantic ones", () => {
    const horror = resolveOfficialAuthoringPlan(HORROR_DRY);
    assert.equal(horror.profile.excludeRomanceLedSignals, true);
    const filtered = ids(selectMarketSignals(snapshot, POLICY, "공포/추리", { excludeRomanceLed: true }));
    assert.ok(filtered.length > 0);
    for (const id of filtered) assert.equal(isRomanceLedSignal(byId.get(id)!), false, id);
    for (const id of ["kr-01", "kr-05", "kr-06", "kr-09", "kr-11", "kr-12", "kr-23", "kr-26", "global-10"]) {
      assert.ok(!filtered.includes(id), `${id} is romance-led and must be dropped`);
    }
    assert.ok(filtered.includes("global-07"), "same-genre 공포/추리 signal stays");
  });

  it("leaves romance-frame genres and the default selection untouched", () => {
    const unfiltered = selectMarketSignals(snapshot, POLICY, "공포/추리");
    assert.deepEqual(
      unfiltered.primary.map((s) => s.signalId),
      ["global-07"]
    );
    assert.ok(unfiltered.supporting.some((s) => s.signalId === "kr-01"), "off-genre romance may remain supporting only");
    for (const genre of ["로맨스", "로맨스 판타지", "BL", "GL", "HL"]) {
      assert.equal(resolveOfficialAuthoringPlan({ genre }).profile.excludeRomanceLedSignals, false, genre);
    }
  });

  it("genre-matched PRIMARY for non-rofan; fantasy tops no longer pose as 현대/일상 primary", () => {
    const comedy = selectMarketSignals(snapshot, POLICY, "현대/일상", { excludeRomanceLed: true });
    assert.ok(comedy.primary.every((s) => s.genre === "현대/일상"));
    assert.ok(!comedy.primary.some((s) => s.signalId === "kr-07" || s.signalId === "kr-08"));
    assert.ok(comedy.primary.some((s) => s.signalId === "global-08"));
  });

  it("classifies romance-led signals by genre label or romantic relationship structure", () => {
    assert.equal(isRomanceLedSignal({ genre: "현대/일상", relationshipTrope: "사내 연애", scenarioHook: "x" }), true);
    assert.equal(isRomanceLedSignal({ genre: "판타지", relationshipTrope: "구원", scenarioHook: "x" }), true);
    assert.equal(isRomanceLedSignal({ genre: "오메가버스", relationshipTrope: null, scenarioHook: "x" }), true);
    assert.equal(isRomanceLedSignal({ genre: "공포/추리", relationshipTrope: null, scenarioHook: "an investigation partner" }), false);
    assert.equal(isRomanceLedSignal({ genre: "아포칼립스", relationshipTrope: "유사 가족·느린 신뢰", scenarioHook: "생존자 무리" }), false);
  });
});

describe("cast fit gate (shared by pilot replacement and the genre runner)", () => {
  const kept = pilotWorld.portfolio;
  const modernSignal = snapshot.signals.find((s) => s.region === "KR" && s.genre === "현대/일상" && s.originalityEligible);

  function fresh(overrides: Partial<PortfolioBriefInput>): PortfolioBriefInput {
    const marketFit: OfficialMarketFitBrief = {
      targetLocale: "ko-KR",
      audienceSegment: "전체",
      genre: "현대/일상",
      relationshipTrope: { primary: "룸메이트", secondary: [] },
      archetype: "허세 부리는 막내",
      provenMarketSignal: modernSignal ? [modernSignal.signalId] : [],
      marketRole: "proven_twist",
      differentiationTwist: "빌린 돈을 갚는 방식이 매번 공연이다",
      userRelationship: "같은 집에 사는 룸메이트",
      oneLineConflict: "룸메이트인 그는 당신의 월세 몫을 자기 공연으로 갚겠다고 우긴다.",
      namingProfile: "korean_modern",
      discoveryTags: ["일상", "룸메이트", "코미디", "허세"],
      adultDemandSignal: null,
      originalityExclusions: [],
    };
    return {
      ...BRIEF,
      slot: 99,
      name: "오박수",
      occupation: "동네 마술 동아리 막내",
      archetype: "허세 부리는 막내",
      relationshipTrope: "룸메이트",
      visualSilhouette: "구깃한 조끼와 큰 카드 케이스",
      rpHook: "당신의 방문 앞에서 월세 대신 공연을 시작한다",
      speechDirection: "과장된 존댓말 사회자 톤",
      marketFit,
      ...overrides,
    };
  }

  it("accepts a distinct non-romance brief against the rofan cast", () => {
    assert.ok(modernSignal, "snapshot has an eligible KR 현대/일상 signal");
    const qa = evaluateBriefCastFit({
      fresh: [fresh({})],
      kept,
      snapshot,
      policy: POLICY,
      namingProfile: "korean_modern",
    });
    assert.deepEqual(qa.errors, []);
  });

  it("flags a fresh brief that copies a kept character's occupation, hook and speech", () => {
    const source = kept[0]!;
    const clone = fresh({
      occupation: source.occupation,
      rpHook: source.rpHook,
      visualSilhouette: source.visualSilhouette,
      speechDirection: source.speechDirection,
    });
    const qa = evaluateBriefCastFit({ fresh: [clone], kept, snapshot, policy: POLICY, namingProfile: "korean_modern" });
    const codes = qa.errors.join("\n");
    assert.match(codes, /cast_occupation_clone/);
    assert.match(codes, /cast_hook_clone/);
    assert.match(codes, /cast_speech_clone/);
  });

  it("does not re-litigate problems between kept characters and reports a missing market fit", () => {
    const qa = evaluateBriefCastFit({
      fresh: [fresh({ marketFit: null })],
      kept: [...kept, { ...kept[0]!, slot: 98, name: "복제본" }],
      snapshot,
      policy: POLICY,
      namingProfile: "korean_modern",
    });
    assert.deepEqual(qa.errors, ["오박수: marketFit missing"]);
  });

  it("passes 최하늘 against 박수진 when only the play pattern matches", () => {
    const review = path.join(process.cwd(), "docs/official-supply/reviews/g5-1-2026-10-28/candidates");
    const park = JSON.parse(fs.readFileSync(path.join(review, "g5-modern-comedy/brief.json"), "utf8")) as PortfolioBriefInput;
    const choi = JSON.parse(fs.readFileSync(path.join(review, "g5-modern-comedy-c/brief.json"), "utf8")) as PortfolioBriefInput;
    const qa = evaluateBriefCastFit({
      fresh: [choi],
      kept: [...kept, park],
      snapshot,
      policy: POLICY,
      namingProfile: "korean_modern",
    });
    assert.deepEqual(qa.errors, []);
  });
});
