import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildWorldCoreUser, type WorldBibleInput, type WorldMarketInput } from "@/lib/officialSupply/authorPrompts";
import { normalizeWorldSocietyField, validateWorldBible, type OfficialWorldBible } from "@/lib/officialSupply/bible";
import {
  OFFICIAL_MODERN_DAILY_GENRE,
  OFFICIAL_ROFAN_GENRE,
  ROFAN_PARITY_PLAN,
  resolveOfficialAuthoringPlan,
} from "@/lib/officialSupply/genreProfile";

const MARKET: WorldMarketInput = {
  targetLocale: "ko-KR",
  marketPriority: "domestic_first",
  signalLines: ["- [PRIMARY] test"],
  namingProfile: "korean_modern",
  marketRoleMix: { proven: { min: 0, max: 1 }, proven_twist: { min: 0, max: 1 }, experimental: { min: 0, max: 1 } },
  maxPrimaryTropeRepeat: 1,
  coreTags: { min: 4, max: 7 },
};

function prose(words: number): string {
  return Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
}

function faction(name: string) {
  return {
    name,
    purpose: "목적",
    leadership: "지도",
    means: "수단",
    relations: "관계",
    publicView: "시선",
  };
}

function minimalWorld(overrides: Partial<OfficialWorldBible> = {}): OfficialWorldBible {
  const base: OfficialWorldBible = {
    name: "테스트",
    genre: OFFICIAL_MODERN_DAILY_GENRE,
    subgenre: "코미디",
    tone: "가벼움",
    era: "현대",
    techLevel: "현대",
    regions: "동네",
    societyForm: "도시",
    premise: prose(80),
    centralPremise: "한 문장",
    situation: {
      biggestEvent: prose(40),
      beneficiaries: "A",
      threatened: "B",
      upcomingChange: "C",
    },
    factions: [faction("A")],
    powerSystem: {
      capabilities: "행동",
      users: "사람",
      acquisition: "습득",
      ranks: "없음",
      limits: "한계",
      costs: "대가",
      socialImpact: "영향",
      taboos: "금기",
    },
    society: { 일상: "규칙" },
    culture: [{ name: "습관", detail: "설명" }],
    locations: [
      { name: "1", purpose: "p", mood: "m", users: "u", rpEvents: "e" },
      { name: "2", purpose: "p", mood: "m", users: "u", rpEvents: "e" },
    ],
    history: [{ event: "e", impact: "i" }],
    knowledge: { common: ["공개 사실"], faction: [], characterLocal: [], authorOnly: [] },
    userEntry: { allowedRoles: ["이웃", "동료"], note: "n" },
    lorebook: [{ entryKey: "k1", name: "항목", keywords: ["a", "b"], content: "내용" }],
    portfolio: [],
  };
  return { ...base, ...overrides };
}

describe("worldScale QA — scene vs full", () => {
  it("normalizeWorldSocietyField flattens domains[] from provider output", () => {
    const flat = normalizeWorldSocietyField({
      domains: [
        { name: "공용부", detail: "택배와 복도" },
        { name: "회의", detail: "채팅방" },
      ],
    });
    assert.equal(Object.keys(flat).length, 2);
    assert.equal(flat["공용부"], "택배와 복도");
  });

  it("scene: one faction passes; zero factions rejected", () => {
    const bible = minimalWorld();
    assert.equal(validateWorldBible(bible, { slots: 0, adultCandidates: 0, worldScale: "scene" }).ok, true);
    assert.ok(!validateWorldBible({ ...bible, factions: [] }, { slots: 0, adultCandidates: 0, worldScale: "scene" }).ok);
  });

  it("full: two factions rejected when worldScale omitted (defaults full)", () => {
    const bible = minimalWorld({ factions: [faction("A"), faction("B")] });
    assert.ok(!validateWorldBible(bible, { slots: 0, adultCandidates: 0 }).ok);
    assert.ok(!validateWorldBible(bible, { slots: 0, adultCandidates: 0, worldScale: "full" }).ok);
  });

  it("scene boundaries for culture, locations, history, lorebook", () => {
    const bible = minimalWorld();
    assert.equal(validateWorldBible(bible, { slots: 0, adultCandidates: 0, worldScale: "scene" }).ok, true);
    assert.ok(
      !validateWorldBible({ ...bible, locations: [bible.locations[0]!] }, { slots: 0, adultCandidates: 0, worldScale: "scene" }).ok
    );
    assert.ok(
      !validateWorldBible({ ...bible, lorebook: [] }, { slots: 0, adultCandidates: 0, worldScale: "scene" }).ok
    );
    assert.ok(
      !validateWorldBible(
        {
          ...bible,
          lorebook: Array.from({ length: 5 }, (_, i) => ({
            entryKey: `k${i}`,
            name: `n${i}`,
            keywords: ["a", "b"],
            content: "c",
          })),
        },
        { slots: 0, adultCandidates: 0, worldScale: "scene" }
      ).ok
    );
  });

  it("현대/일상 prompts use scene counts; rofan absent plan stays full factions 3~6", () => {
    const dailyPlan = resolveOfficialAuthoringPlan({ genre: OFFICIAL_MODERN_DAILY_GENRE, humor: "central" });
    assert.equal(dailyPlan.profile.worldScale, "scene");
    const dailyCore = buildWorldCoreUser({
      genre: OFFICIAL_MODERN_DAILY_GENRE,
      worldKey: "w",
      styleKey: "k",
      market: MARKET,
      slots: 1,
      adultCandidates: 0,
      genderMix: "여 1",
      slotGenders: ["female"],
      authoring: dailyPlan,
    });
    assert.match(dailyCore, /factions 1~2개/);
    assert.match(dailyCore, /이 장면에서 인물이 실제로 할 수 있는 행동/);

    const rofanCore = buildWorldCoreUser({
      genre: OFFICIAL_ROFAN_GENRE,
      worldKey: "w",
      styleKey: "k",
      market: { ...MARKET, namingProfile: "western_rofan" },
      slots: 10,
      adultCandidates: 1,
      genderMix: "mix",
      slotGenders: ["male"],
      authoring: undefined,
    });
    assert.match(rofanCore, /factions 3~6개:/);
    assert.doesNotMatch(rofanCore, /factions 1~2/);
    assert.equal(ROFAN_PARITY_PLAN.profile.worldScale, "full");
  });
});
