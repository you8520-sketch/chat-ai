import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  OFFICIAL_AUTHOR_QUALITY_CONTRACT,
  buildCharacterBible1System,
  buildCharacterVoiceSystem,
  buildWorldCoreUser,
  buildWorldPortfolioUser,
  type PortfolioBriefInput,
  type WorldMarketInput,
} from "@/lib/officialSupply/authorPrompts";
import { validateCharacterBible, type OfficialCharacterBible, type OfficialWorldBible } from "@/lib/officialSupply/bible";
import {
  buildDomesticMarketFitReview,
  canonicalPrimaryTrope,
  coerceMarketFitBrief,
  evaluateDiscoveryTags,
  evaluateMarketFitPortfolio,
  evaluateMarketTropePortfolio,
  evaluateNamePortfolio,
  evaluatePublicHook,
  formatMarketSignalLines,
  parseCharacterName,
  resolveNamingProfile,
  selectMarketSignals,
  validateMarketFitBrief,
  type NamePortfolioEntry,
  type OfficialBatchMarketPolicy,
  type OfficialMarketFitBrief,
} from "@/lib/officialSupply/marketFit";
import { validateResearchSnapshot, type ResearchSignal, type ResearchSnapshot } from "@/lib/officialSupply/research";

const PILOT_DIR = path.join(process.cwd(), "src/lib/officialSupply/pilot");
const SNAPSHOT_FILE = path.join(process.cwd(), "docs/official-supply/market-research-snapshot-2026-09.json");

type PilotChar = { draftKey: string; brief: PortfolioBriefInput; bible: OfficialCharacterBible };
const readJson = <T,>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
const world = readJson<{ bible: OfficialWorldBible }>(path.join(PILOT_DIR, "world-bible.json")).bible;
const pilot = world.portfolio.map((b) =>
  readJson<PilotChar>(path.join(PILOT_DIR, "characters", `pilot-rf-${String(b.slot).padStart(2, "0")}.json`))
);
const snapshot = readJson<ResearchSnapshot>(SNAPSHOT_FILE);

const POLICY: OfficialBatchMarketPolicy = {
  targetLocale: "ko-KR",
  signalRegion: "KR",
  marketPriority: "domestic_first",
  maxSupportingSignals: 4,
  marketRoleMix: { proven: { min: 6, max: 7 }, proven_twist: { min: 2, max: 3 }, experimental: { min: 1, max: 1 } },
  maxPrimaryTropeRepeat: 2,
  coreTags: OFFICIAL_AUTHOR_QUALITY_CONTRACT.discoveryTags,
  maxTaglineWorldTerms: 2,
};

function signal(overrides: Partial<ResearchSignal>): ResearchSignal {
  return {
    signalId: "kr-x1",
    source: "manual",
    sourceUrl: "https://example.com/a",
    region: "KR",
    genre: "로맨스 판타지",
    audience: "female_oriented",
    relationshipTrope: "계약 결혼",
    archetype: "북부 대공",
    worldMechanic: null,
    scenarioHook: "계약 결혼으로 시작하는 관계",
    popularitySignal: "top",
    adultDemand: false,
    seasonal: null,
    originalityEligible: true,
    ipExclusionReason: null,
    ...overrides,
  };
}

function brief(overrides: Partial<OfficialMarketFitBrief> = {}): OfficialMarketFitBrief {
  return {
    targetLocale: "ko-KR",
    audienceSegment: "여성향 로판 독자",
    genre: "로맨스 판타지",
    relationshipTrope: { primary: "계약 결혼", secondary: ["후회"] },
    archetype: "북부 대공",
    provenMarketSignal: ["kr-x1"],
    marketRole: "proven",
    differentiationTwist: "계약 조건을 먼저 깬 쪽이 대공 자신이라는 비대칭 정보",
    userRelationship: "계약 신부",
    oneLineConflict: "몰락한 대공이 당신에게 1년짜리 계약 결혼을 제안하지만, 조건을 먼저 어긴 건 그다.",
    namingProfile: "western_rofan",
    discoveryTags: ["로판", "계약 결혼", "후회", "북부"],
    adultDemandSignal: null,
    originalityExclusions: ["경쟁작 캐릭터 이름"],
    ...overrides,
  };
}

const names = (list: string[], profile: NamePortfolioEntry["namingProfile"]): NamePortfolioEntry[] =>
  list.map((name, i) => ({ draftKey: `c${i}`, name, namingProfile: profile }));
const codes = (qa: { errors: { code: string }[]; warnings: { code: string }[] }) => ({
  errors: qa.errors.map((e) => e.code),
  warnings: qa.warnings.map((w) => w.code),
});

describe("market signal → portfolio dataflow", () => {
  it("the committed snapshot carries ids + IP eligibility and still validates", () => {
    assert.deepEqual(validateResearchSnapshot(snapshot).errors, []);
    assert.ok(snapshot.signals.every((s) => s.signalId && typeof s.originalityEligible === "boolean"));
    const excluded = snapshot.signals.filter((s) => !s.originalityEligible);
    assert.ok(excluded.length >= 1 && excluded.every((s) => s.ipExclusionReason));
  });

  it("an IP-excluded row without a reason is a schema error", () => {
    const bad: ResearchSnapshot = { ...snapshot, signals: [signal({ originalityEligible: false, ipExclusionReason: null })] };
    assert.ok(validateResearchSnapshot(bad).errors.some((e) => e.code === "ip_exclusion_reason_missing"));
  });

  it("domestic_first puts KR signals first and never forwards IP-excluded rows", () => {
    const selection = selectMarketSignals(snapshot, POLICY, "로맨스 판타지");
    assert.ok(selection.primary.length > 0 && selection.primary.every((s) => s.region === "KR"));
    assert.ok(selection.supporting.every((s) => s.region === "GLOBAL"));
    assert.ok(selection.supporting.length <= POLICY.maxSupportingSignals);
    assert.equal(selection.primary[0]!.genre, "로맨스 판타지");
    const lines = formatMarketSignalLines(selection).join("\n");
    for (const ex of selection.excluded) assert.ok(!lines.includes(`[${ex.signalId}]`), `${ex.signalId} leaked into prompt`);
    const global = selectMarketSignals(snapshot, { ...POLICY, marketPriority: "global_first" }, "로맨스 판타지");
    assert.ok(global.primary.every((s) => s.region === "GLOBAL"));
  });

  it("world + portfolio prompts are fed by the selection (no hand-written trope list)", () => {
    const market: WorldMarketInput = {
      targetLocale: "ko-KR",
      marketPriority: "domestic_first",
      signalLines: formatMarketSignalLines(selectMarketSignals(snapshot, POLICY, "로맨스 판타지")),
      namingProfile: resolveNamingProfile("로맨스 판타지"),
      marketRoleMix: POLICY.marketRoleMix,
      maxPrimaryTropeRepeat: 2,
      coreTags: POLICY.coreTags,
    };
    const core = buildWorldCoreUser({ genre: "로맨스 판타지", worldKey: "w", styleKey: "s", market, slots: 10, adultCandidates: 4, genderMix: "", slotGenders: [] });
    const portfolio = buildWorldPortfolioUser({
      worldName: "W", centralPremise: "P", factionNames: [], locationNames: [], slots: 10, adultCandidates: 4, genderMix: "", slotGenders: [], market,
    });
    for (const text of [core, portfolio]) {
      assert.ok(text.includes("ko-KR") && text.includes("[kr-"));
    }
    assert.ok(portfolio.includes("marketFit") && portfolio.includes("oneLineConflict"));
    assert.ok(portfolio.includes("proven 6~7") && !portfolio.includes("인기형 5"));
    assert.ok(portfolio.includes("같은 primary 트로프는 최대 2명"));
  });

  it("model-authored marketFit is coerced onto the brief", () => {
    const coerced = coerceMarketFitBrief({ ...brief(), marketRole: "bogus", namingProfile: "nope" });
    assert.equal(coerced?.marketRole, "proven");
    assert.equal(coerced?.namingProfile, "korean_modern");
    assert.equal(coerceMarketFitBrief(undefined), null);
  });
});

describe("market fit brief", () => {
  const snap: ResearchSnapshot = {
    observedAt: "2026-09-26",
    platforms: [],
    signals: [
      signal({}),
      signal({ signalId: "kr-ip", originalityEligible: false, ipExclusionReason: "웹툰 IP", observedCharacterName: "원작남주" }),
      signal({ signalId: "kr-adult", adultDemand: true }),
    ],
  };
  const ctx = { snapshot: snap, policy: POLICY, adultCandidate: false };

  it("a relationship-first brief with a twist passes", () => {
    assert.deepEqual(validateMarketFitBrief(brief(), ctx).errors, []);
  });

  it("famous-IP identity source fails (cited signal or carried identity)", () => {
    const cited = validateMarketFitBrief(brief({ provenMarketSignal: ["kr-ip"] }), ctx);
    assert.ok(codes(cited).errors.includes("market_fit_ip_identity_source"));
    const carried = validateMarketFitBrief(brief({ archetype: "원작남주 같은 대공" }), ctx);
    assert.ok(codes(carried).errors.includes("market_fit_ip_identity_source"));
  });

  it("no twist / no user relationship / wrong locale fail", () => {
    assert.ok(codes(validateMarketFitBrief(brief({ differentiationTwist: "" }), ctx)).errors.includes("market_fit_no_twist"));
    const worldOnly = brief({ oneLineConflict: "에테르노스 제국의 황실 에테르 공명술을 사용하는 제2황자." });
    assert.ok(codes(validateMarketFitBrief(worldOnly, ctx)).errors.includes("market_fit_not_relationship_first"));
    assert.ok(codes(validateMarketFitBrief(brief({ targetLocale: "en-US" }), ctx)).errors.includes("market_fit_locale"));
  });

  it("adult candidates tie to an eligible adult-demand signal", () => {
    const adult = { ...ctx, adultCandidate: true };
    assert.ok(codes(validateMarketFitBrief(brief(), adult)).warnings.includes("market_fit_adult_signal"));
    assert.ok(codes(validateMarketFitBrief(brief({ adultDemandSignal: "kr-x1" }), adult)).errors.includes("market_fit_adult_signal"));
    assert.deepEqual(validateMarketFitBrief(brief({ adultDemandSignal: "kr-adult" }), adult).errors, []);
  });

  it("portfolio gate: primary trope repeated 3× fails, 2× passes; shared secondary tropes never fail", () => {
    const make = (primaries: string[]) =>
      primaries.map((p, i) => ({
        draftKey: `c${i}`,
        name: ["아델", "카릴", "레오", "이안", "노아", "시엘"][i]!,
        adultCandidate: false,
        marketFit: brief({ relationshipTrope: { primary: p, secondary: ["구원"] } }),
      }));
    const three = evaluateMarketFitPortfolio(make(["계약 결혼", "정략결혼", "계약 약혼", "혐관"]), { snapshot: snap, policy: POLICY, genre: "로맨스 판타지" });
    assert.ok(codes(three).errors.includes("market_primary_trope_repeat"));
    const two = evaluateMarketFitPortfolio(make(["계약 결혼", "정략결혼", "혐관", "재회"]), { snapshot: snap, policy: POLICY, genre: "로맨스 판타지" });
    assert.ok(!codes(two).errors.includes("market_primary_trope_repeat"));
    const missing = evaluateMarketFitPortfolio([{ draftKey: "c0", name: "아델", adultCandidate: false, marketFit: null }], { snapshot: snap, policy: POLICY, genre: "로맨스 판타지" });
    assert.ok(codes(missing).errors.includes("market_fit_missing"));
  });

  it("primary tropes canonicalize paraphrases (계약결혼 / 정략결혼 → one trope)", () => {
    assert.equal(canonicalPrimaryTrope("정략결혼 후 후회"), canonicalPrimaryTrope("계약 결혼"));
    const qa = evaluateMarketTropePortfolio(
      ["북부 대공 계약", "계약 결혼", "정략 약혼"].map((p, i) => ({ draftKey: `c${i}`, primaryTrope: p, secondaryTropes: [] })),
      POLICY
    );
    assert.ok(codes(qa).errors.includes("market_primary_trope_repeat"));
  });
});

describe("Korean naming policy", () => {
  it("genre → naming profile", () => {
    assert.equal(resolveNamingProfile("현대/일상"), "korean_modern");
    assert.equal(resolveNamingProfile("센티넬버스"), "korean_codename");
    assert.equal(resolveNamingProfile("로맨스 판타지"), "western_rofan");
    assert.equal(resolveNamingProfile("무협"), "eastern_historical");
    assert.equal(resolveNamingProfile("로맨스 판타지", { nonHuman: true }), "nonhuman_designation");
  });

  it("parses Korean names, codenames, western house names and designations", () => {
    assert.deepEqual(
      [parseCharacterName("서도윤").kind, parseCharacterName("서도윤").familyName, parseCharacterName("서도윤").givenName],
      ["korean", "서", "도윤"]
    );
    assert.equal(parseCharacterName("남궁현").familyName, "남궁");
    const codename = parseCharacterName("한지우 (코드네임 레이븐)");
    assert.equal(codename.kind, "korean");
    assert.equal(codename.codename, "레이븐");
    const western = parseCharacterName("볼프강 폰 발켄하임");
    assert.deepEqual([western.kind, western.givenName, western.familyName, western.givenSyllables], ["western", "볼프강", "발켄하임", 3]);
    assert.equal(parseCharacterName("이노센트 0호").kind, "designation");
    assert.equal(parseCharacterName("가브리엘").kind, "western");
    assert.equal(parseCharacterName("김도윤").kind, "korean");
  });

  it("1. Korean modern cast with only foreign names fails", () => {
    const foreign = evaluateNamePortfolio(names(["루카스", "엘리엇", "노아", "케일", "리암"], "korean_modern"));
    assert.ok(codes(foreign).errors.includes("name_portfolio_all_foreign"));
    const korean = evaluateNamePortfolio(names(["서도윤", "한지우", "강이현", "권태현", "문세아"], "korean_modern"));
    assert.deepEqual(korean.errors, []);
  });

  it("codename profile keeps the Korean real name", () => {
    const qa = evaluateNamePortfolio(names(["레이븐", "팬텀", "블레이드"], "korean_codename"));
    assert.ok(codes(qa).errors.includes("name_portfolio_all_foreign"));
    assert.ok(codes(qa).warnings.includes("name_real_name_missing"));
    assert.deepEqual(evaluateNamePortfolio(names(["한지우 (코드네임 레이븐)", "서도윤", "문세아"], "korean_codename")).errors, []);
  });

  it("2. rofan cast of long look-alike coinages fails; short readable names pass", () => {
    const long = evaluateNamePortfolio(names(["아우렐리아누스", "세라피넬리아", "카시오페이아", "발렌티니우스"], "western_rofan"));
    assert.ok(codes(long).errors.includes("name_portfolio_long_coinage"));
    const short = evaluateNamePortfolio(names(["카일", "리엔", "아델", "노아"], "western_rofan"));
    assert.deepEqual(short.errors, []);
  });

  it("3. syllable clusters: 재현/재혁/재하/재윤 fails; shared endings warn", () => {
    const cluster = evaluateNamePortfolio(names(["김재현", "이재혁", "박재하", "최재윤"], "korean_modern"));
    assert.ok(codes(cluster).errors.includes("name_prefix_cluster"));
    assert.ok(codes(cluster).errors.includes("name_syllable_repetition"));
    const endings = evaluateNamePortfolio(names(["헬레나", "로웨나", "세라피나", "카일"], "western_rofan"));
    assert.ok(codes(endings).warnings.includes("name_suffix_cluster"));
    assert.ok(codes(evaluateNamePortfolio(names(["서도윤", "서도은"], "korean_modern"))).warnings.includes("name_sibling_close"));
  });

  it("same surname needs declared kinship", () => {
    const strangers = evaluateNamePortfolio(names(["김도윤", "김세아", "김태오"], "korean_modern"));
    assert.ok(codes(strangers).errors.includes("name_surname_repeat"));
    const family = evaluateNamePortfolio([
      { draftKey: "a", name: "볼프강 폰 발켄하임", namingProfile: "western_rofan", kinNames: ["헬레나 폰 발켄하임"] },
      { draftKey: "b", name: "헬레나 폰 발켄하임", namingProfile: "western_rofan" },
    ]);
    assert.ok(!codes(family).warnings.includes("name_surname_repeat"));
  });

  it("4. observed market name + near-identical hook fails; name alone only warns", () => {
    const observed = [{ name: "서도윤", hook: "게이트가 도시를 뒤덮은 세계에서 헌터로 활동한다" }];
    const entry = names(["서도윤", "한지우", "문세아"], "korean_modern");
    const clone = evaluateNamePortfolio(entry, { observed, hooks: { c0: "게이트가 도시를 뒤덮은 세계에서 헌터로 활동한다" } });
    assert.ok(codes(clone).errors.includes("name_observed_collision"));
    const nameOnly = evaluateNamePortfolio(entry, { observed, hooks: { c0: "편의점 야간 알바생이 당신의 비밀을 알아챈다" } });
    assert.deepEqual(codes(nameOnly), { errors: [], warnings: ["name_observed_name_only"] });
  });
});

describe("public hook + discovery tags", () => {
  const baseChar = pilot.find((c) => c.draftKey === "pilot-rf-07")!;
  const base = baseChar.bible;

  it("6. a public hook without any user relationship is a production warning", () => {
    const qa = evaluatePublicHook({ tagline: "흔들림 없는 기사, 빈틈을 기억하다", description: "제국 최강의 기사다.", worldTerms: [] }, POLICY);
    assert.ok(codes(qa).warnings.includes("hook_no_user_relationship"));
    assert.equal(qa.errors.length, 0);
    const relationship = evaluatePublicHook({ tagline: "목격자의 목에 칼을 겨눈 청부업자", description: "", worldTerms: [] }, POLICY);
    assert.deepEqual(relationship.warnings, []);
  });

  it("taglines that need several world terms warn", () => {
    const qa = evaluatePublicHook(
      { tagline: "에테르노스 판도라 발켄하임의 황자", description: "당신의 약혼자", worldTerms: ["에테르노스", "판도라", "발켄하임"] },
      POLICY
    );
    assert.ok(codes(qa).warnings.includes("tagline_world_jargon"));
  });

  it("tags may be grounded by the canonical hook that compiles into the draft", () => {
    const hook = { archetype: "타락한 성녀", relationshipTrope: "신성모독적 유혹", rpHook: "기계의 첫사랑" };
    assert.ok(evaluateDiscoveryTags({ tags: ["금단"], bible: base }, POLICY).errors.length === 1);
    assert.deepEqual(evaluateDiscoveryTags({ tags: ["금단", "순애"], bible: base, hook }, POLICY).errors, []);
  });

  it("8. tags must be supported by the bible; keyword stuffing fails", () => {
    assert.deepEqual(evaluateDiscoveryTags({ tags: base.publicProfile.tags, bible: base, hook: baseChar.brief }, POLICY).errors, []);
    const off = evaluateDiscoveryTags({ tags: [...base.publicProfile.tags.slice(0, 2), "아이돌", "오메가버스"], bible: base }, POLICY);
    assert.deepEqual(off.errors.map((e) => e.message), [
      'tag "아이돌" is not supported by the Character Bible',
      'tag "오메가버스" is not supported by the Character Bible',
    ]);
    const stuffed = evaluateDiscoveryTags({ tags: Array.from({ length: 10 }, () => "학자"), bible: base }, POLICY);
    assert.ok(codes(stuffed).errors.includes("tags_keyword_stuffing"));
  });

  it("tag band is one contract: voice prompt and bible validator agree", () => {
    const band = OFFICIAL_AUTHOR_QUALITY_CONTRACT.discoveryTags;
    assert.ok(buildCharacterVoiceSystem().includes(`tags ${band.min}~${band.max}개`));
    const tooMany = { ...base, publicProfile: { ...base.publicProfile, tags: Array.from({ length: band.max + 1 }, (_, i) => `태그${i}`) } };
    assert.ok(validateCharacterBible(tooMany, { adultExpected: false }).errors.some((e) => e.code === "bible_tags"));
    const few = { ...base, publicProfile: { ...base.publicProfile, tags: base.publicProfile.tags.slice(0, band.min - 1) } };
    const qa = validateCharacterBible(few, { adultExpected: false });
    assert.ok(!qa.errors.some((e) => e.code === "bible_tags") && qa.warnings.some((w) => w.code === "bible_tags_few"));
  });
});

describe("domestic market fit review of the committed pilot", () => {
  const characters = pilot.map((c) => ({ draftKey: c.draftKey, brief: c.brief, bible: c.bible }));

  it("is deterministic, facts-only, and matches the committed review artifact", () => {
    const review = buildDomesticMarketFitReview({ world, snapshot, policy: manifestMarketPolicy(), genre: "로맨스 판타지", characters });
    const committed = readJson(path.join(PILOT_DIR, "market-fit-review.json"));
    assert.deepEqual(JSON.parse(JSON.stringify(review)), committed);
    assert.equal(review.rows.length, 10);
    for (const row of review.rows) {
      assert.ok(!("score" in row) && !("rank" in row) && !("pass" in row));
      assert.ok(row.publicTagline && row.portfolioHook && row.primaryTrope);
    }
  });

  it("10. the review never rewrites or thins the deep Character Bible", () => {
    const before = JSON.stringify(characters);
    buildDomesticMarketFitReview({ world, snapshot, policy: POLICY, genre: "로맨스 판타지", characters });
    assert.equal(JSON.stringify(characters), before);
    assert.ok(buildCharacterBible1System().includes("part1 전체 분량은 반드시 5000자 이내"));
    for (const c of pilot) assert.ok(JSON.stringify(c.bible).length > 8000, `${c.draftKey} bible stays deep`);
  });

  it("current names are kept (review only): no name errors, only reviewable warnings", () => {
    const review = buildDomesticMarketFitReview({ world, snapshot, policy: POLICY, genre: "로맨스 판타지", characters });
    assert.deepEqual(review.portfolio.names.errors, []);
    assert.deepEqual(
      pilot.map((c) => c.bible.identity.name),
      ["카엘룸 폰 에테르노스", "볼프강 폰 발켄하임", "루시안 바스케스", "율리우스 클라인", "바스티안 에반스", "에드릭", "테오", "노엘 벨로체", "세라피나 오로라", "이노센트 0호"]
    );
  });

  it("7/9. no primary trope exceeds the pilot cap; shared secondary tropes are not failures", () => {
    const review = buildDomesticMarketFitReview({ world, snapshot, policy: POLICY, genre: "로맨스 판타지", characters });
    assert.deepEqual(review.portfolio.tropes.errors, []);
    assert.ok(Object.values(review.portfolio.tropes.primaryCounts).every((holders) => holders.length <= 2));
  });
});

function manifestMarketPolicy(): OfficialBatchMarketPolicy {
  return readJson<{ marketPolicy: OfficialBatchMarketPolicy }>(path.join(PILOT_DIR, "manifest.json")).marketPolicy;
}
