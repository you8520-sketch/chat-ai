import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateOfficialWorldBible,
  type OfficialAuthorRawCompletion,
  type OfficialAuthorTransport,
} from "@/lib/officialSupply/author";
import type { WorldBibleInput, WorldMarketInput } from "@/lib/officialSupply/authorPrompts";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { OFFICIAL_MODERN_DAILY_GENRE, resolveOfficialAuthoringPlan } from "@/lib/officialSupply/genreProfile";

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

function fakeCompletion(text: string): OfficialAuthorRawCompletion {
  return {
    text,
    model: "fake-author-model",
    inputTokens: 10,
    outputTokens: 10,
    costUsd: 0,
    providerRequestId: null,
  };
}

function queuedTransport(queue: unknown[]): { transport: OfficialAuthorTransport; tasks: string[] } {
  const tasks: string[] = [];
  return {
    tasks,
    transport: {
      label: "queued-world",
      async completeJson(input) {
        tasks.push(input.task);
        const data = queue.shift();
        if (data === undefined) throw new Error("fixture transport exhausted");
        return fakeCompletion(typeof data === "string" ? data : JSON.stringify(data));
      },
    },
  };
}

function worldInput(): WorldBibleInput {
  return {
    genre: OFFICIAL_MODERN_DAILY_GENRE,
    worldKey: "admin_private_v1",
    styleKey: "admin_draft_v1",
    market: MARKET,
    slots: 1,
    adultCandidates: 0,
    genderMix: "여성 1명",
    slotGenders: ["female"],
    castIntent: "전체 이용자 대상 현대/일상 캐릭터 1명.",
    authoring: resolveOfficialAuthoringPlan({ genre: OFFICIAL_MODERN_DAILY_GENRE }),
  };
}

const CORE = {
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
  factions: [
    {
      name: "이웃",
      purpose: "목적",
      leadership: "지도",
      means: "수단",
      relations: "관계",
      publicView: "시선",
    },
  ],
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
};

const CLEAN_ATLAS = {
  locations: [
    { name: "1", purpose: "p", mood: "m", users: "u", rpEvents: "e" },
    { name: "2", purpose: "p", mood: "m", users: "u", rpEvents: "e" },
  ],
  history: [{ event: "e", impact: "i" }],
  knowledge: {
    common: ["세탁실은 3층에 있다."],
    faction: [],
    characterLocal: [],
    authorOnly: ["훗날 진짜 정체가 드러난다."],
  },
  userEntry: { allowedRoles: ["이웃", "동료"], note: "n" },
  lorebook: [
    {
      entryKey: "k1",
      name: "공동 세탁실",
      keywords: ["세탁실", "3층"],
      content: "3층 공동 세탁실은 예약 없이 쓰고, 끝나면 물을 잠근다.",
    },
  ],
};

const PORTFOLIO = {
  portfolio: [
    {
      slot: 1,
      name: "한가온",
      gender: "female",
      age: 28,
      archetype: "실무",
      relationshipTrope: "이웃",
      occupation: "반찬가게",
      faction: "이웃",
      socialPosition: "직원",
      personalityCore: "담담",
      visualSilhouette: "앞치마",
      rpHook: "물통을 건넨다",
      adultCandidate: false,
      speechDirection: "존댓말",
      audience: "all",
    },
  ],
};

describe("world atlas early public-knowledge QA", () => {
  it("rejects hidden lorebook wording before the Portfolio call", async () => {
    const { transport, tasks } = queuedTransport([
      CORE,
      {
        ...CLEAN_ATLAS,
        lorebook: [
          {
            entryKey: "k1",
            name: "항목",
            keywords: ["a", "b"],
            content: "세라핀의 진짜 정체는 적국의 공주다.",
          },
        ],
      },
      PORTFOLIO,
    ]);
    await assert.rejects(
      generateOfficialWorldBible({ transport, world: worldInput() }),
      (error: unknown) => {
        assert.ok(error instanceof OfficialSupplyGateError);
        assert.equal(error.code, "author_world_rejected");
        assert.equal(error.stage, "world_atlas_qa");
        assert.equal(error.message, "world bible failed QA");
        assert.ok(error.qa?.errors.some((issue) => issue.code === "world_lorebook_hidden"));
        return true;
      }
    );
    assert.deepEqual(tasks, ["world_bible", "world_bible"]);
  });

  it("continues to Portfolio when Atlas public lorebook is clean, including authorOnly hidden wording", async () => {
    const { transport, tasks } = queuedTransport([CORE, CLEAN_ATLAS, PORTFOLIO]);
    const generated = await generateOfficialWorldBible({ transport, world: worldInput() });
    assert.equal(generated.bible.lorebook[0]?.content.includes("공동 세탁실"), true);
    assert.equal(generated.bible.knowledge.authorOnly[0]?.includes("진짜 정체"), true);
    assert.equal(generated.bible.portfolio.length, 1);
    assert.deepEqual(tasks, ["world_bible", "world_bible", "world_bible"]);
  });
});
