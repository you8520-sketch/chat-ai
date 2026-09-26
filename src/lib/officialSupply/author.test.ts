import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import {
  assembleOfficialCharacterBible,
  generateOfficialAssetPlan,
  generateOfficialStyleBoard,
  parseAuthorJson,
  resolveOfficialAuthorModelId,
  validatePilotAppearance,
  validatePilotAssetPlan,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
  type OfficialAuthorRawCompletion,
  type OfficialAuthorTransport,
} from "@/lib/officialSupply/author";
import { compileOfficialDraftFromBible, validateCharacterBible, validateWorldBible } from "@/lib/officialSupply/bible";
import type { OfficialWorldBible } from "@/lib/officialSupply/bible";
import { testAppearance, testAssetPlan, testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { officialSubstantiveCharCount } from "@/lib/officialSupply/characterText";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

const DIR = path.join(process.cwd(), "src/lib/officialSupply");

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

function fakeTransport(responses: Record<string, unknown>): OfficialAuthorTransport {
  return {
    label: "fake",
    async completeJson(input) {
      const data = responses[input.task];
      if (data === undefined) throw new Error(`no fake response for ${input.task}`);
      return fakeCompletion(typeof data === "string" ? data : JSON.stringify(data));
    },
  };
}

const VOCAB = ["궁정", "기사단", "은빛 강", "마력석", "원로원", "북부 전선", "제국력", "상단", "기사", "맹세"];
function prose(seed: number, length: number): string {
  const out: string[] = [];
  let i = seed;
  let size = 0;
  while (size < length) {
    const sentence = `${VOCAB[i % VOCAB.length]}의 ${VOCAB[(i * 7 + 3) % VOCAB.length]} ${VOCAB[(i * 11 + 5) % VOCAB.length]}을 지킨다.`;
    out.push(sentence);
    size += sentence.length + 1;
    i += 1;
  }
  return out.join(" ").slice(0, length);
}

function fakeHalf1(opts: { age?: number; name?: string } = {}): Record<string, unknown> {
  const age = opts.age ?? 27;
  const name = opts.name ?? "카엘";
  return {
    identity: {
      name,
      gender: "male",
      age,
      apparentAge: "20대 후반",
      heightCm: 184,
      species: "인간",
      occupation: "근위 기사단장",
      socialPosition: "작위 없는 고위 기사",
      affiliation: "근위 기사단",
      worldRole: "황궁 경호 총괄",
    },
    appearance: {
      faceShape: "갸름한 턱선",
      eyes: "날카로운 눈매",
      eyeColor: "회색",
      hairColor: "짙은 갈색",
      hairstyle: "짧게 친 머리",
      hairLength: "짧음",
      skin: "햇볕에 그을린 피부",
      build: "다부짐",
      musculature: "단련된 근육",
      distinguishingFeatures: "오른쪽 뺨의 검상",
      usualExpression: "무표정",
      defaultOutfit: "은회색 근위 기사 제복",
      accessories: "기사단 문장 반지",
      impression: "다가가기 어려운 위압감",
    },
    personality: { keywords: ["냉정", "책임감", "자존심", "통제욕", "충성", "고집"], behavioral: prose(1, 520) },
    contradiction: "통제를 중시하지만 자신을 통제하려 드는 명령에는 반발한다. 그 반발이 충성과 충돌한다.",
    values: {
      desires: ["기사단의 명예 회복"],
      fears: ["주군을 잃는 것"],
      coreValues: ["충성", "책임", "명예"],
      nonNegotiable: ["주군에 대한 충성"],
    },
    backstory: {
      events: [
        { event: prose(2, 260), choice: "주군을 선택했다.", residue: "충성이 신념이 되었다." },
        { event: prose(3, 260), choice: "검을 들었다.", residue: "상처가 남았다." },
      ],
    },
    abilities: [
      { name: "검술", scope: "근위 기사단 검술", level: "상급", limit: "장기전 불가", cost: "체력 소모", usage: "호위 임무" },
      { name: "전술 지휘", scope: "소규모 호위 작전", level: "중급", limit: "대규모 전쟁 불가", cost: "", usage: "경호 배치" },
    ],
    habits: {
      hobbies: ["새벽 연무", "검 손질"],
      habits: ["순찰 전 문장 확인", "야간 경계"],
      likes: ["맑은 새벽", "정돈된 무기", "충직한 부하"],
      dislikes: ["궁정 음모", "지각", "무례"],
    },
    dailyLife: prose(4, 260),
    situation: {
      worldContext: prose(5, 700),
      personalSituation: prose(6, 600),
      userEntry: prose(7, 250),
    },
  };
}

function fakeHalf2(opts: { nsfw?: boolean; npcCount?: 0 | 1 | 3 | 4; age?: number } = {}): Record<string, unknown> {
  const npcs = [];
  const count = opts.npcCount ?? 1;
  for (let i = 0; i < count; i++) {
    npcs.push({
      name: `보좌관${i + 1}`,
      age: 30,
      heightCm: 175,
      appearance: "단정한 차림",
      personalityKeywords: ["성실"],
      role: "부관",
      relationToChar: "카엘과 5년째 함께함",
      speech: "정중한 말투",
      adultEligible: true,
    });
  }
  return {
    speech: {
      register: "격식체 존댓말",
      sentenceLength: "짧고 단호함",
      tempo: "느리고 신중함",
      vocabulary: "군사 용어",
      frequentPhrases: ["명령이십니까", "확인했습니다"],
      rarePhrases: ["농담", "잡담"],
      profanity: "사용하지 않음",
      humorStyle: "건조한 한 마디",
      addressStyle: "직책으로 부름",
      hiddenEmotionStyle: "더 짧아짐",
      angryStyle: "낮고 느려짐",
      intimateStyle: "어색하게 부드러워짐",
      keywords: ["단호함", "격식", "절제", "신중", "충성"],
      description: prose(8, 320),
      examples: ["명령이십니까.\n확인했습니다.\n물러서십시오.\n제가 막겠습니다."],
      forbidden: "반말과 가벼운 농담",
    },
    behaviorRules: ["명령 체계를 먼저 확인한다.", "위급 시 몸으로 막는다.", "사적 감정을 임무에 섞지 않는다."],
    userRelationship: {
      initialView: "경계 대상",
      userRole: "황궁 출입이 허가된 협력자",
      startingPoint: "경계 70, 이해관계 30",
      progression: ["경계", "이해관계", "개인적 신뢰", "충성 맹세"],
    },
    otherRelationships: [{ target: "마법사 리안", public: "협력 관계", privateOpinion: "믿음직하다", hidden: "" }],
    secrets: ["북부 전선 패전의 생존자"],
    rpEngine: {
      immediateHook: "야간 순찰 중 침입자와 마주친다",
      repeatable: ["새벽 연무 동행", "순찰 보고", "검 손질", "식사"],
      mediumConflict: "원로원의 기사단 해체 압력",
      longTermChange: "주군과의 신뢰가 깊어지며 충성의 의미가 바뀐다",
    },
    greeting: prose(9, 800),
    publicProfile: {
      tagline: "황궁의 방패, 경계 너머의 충성",
      description: prose(10, 300),
      tags: ["기사", "궁정", "호위", "충성"],
    },
    npcs,
    nsfw: opts.nsfw === true,
    adultSection: opts.nsfw
      ? {
          orientation: "HL 이성애",
          hookSummary: "통제와 신뢰 사이의 긴장이 관계로 이어진다.",
          dialogueProfile: "explicit_rare",
          consentModes: ["standard"],
          tone: prose(11, 200),
          preferenceKeywords: ["느린 친밀감", "신뢰 우선", "주도적 보호", "언어적 긴장"],
          boundaries: ["합의 없는 접촉 금지", "임무 중 자제", "상대 거절 즉시 중단"],
          consentBehavior: prose(12, 200),
          scenarioExamples: ["야간 순찰 후 긴장을 푸는 대화", "신뢰 확인 후의 조용한 시간"],
        }
      : null,
  };
}

function fakeBible(nsfw: boolean, age = 27, name = "카엘") {
  return assembleOfficialCharacterBible(fakeHalf1({ age, name }), fakeHalf2({ nsfw, age }));
}

const STAGING_KEYS = {
  draftKey: "pilot-test-01",
  worldKey: "pilot-test-world",
  styleKey: "romance_fantasy_v1",
  genres: ["로맨스 판타지"] as OfficialCharacterDraft["genres"],
  audience: "female" as const,
  hook: {
    archetype: "충직한 기사단장",
    relationshipTrope: "경계에서 신뢰로",
    occupation: "근위 기사단장",
    rpHook: "야간 순찰 중 침입자와 마주친다",
  },
};

describe("official author adapter", () => {
  const originalFetch = globalThis.fetch;
  const egressAttempts: string[] = [];
  before(() => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      egressAttempts.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      throw new Error("network egress is not allowed in author tests");
    }) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = originalFetch;
    assert.deepEqual(egressAttempts, [], "author tests made network calls");
  });

  it("model resolver defaults to the canonical background primary and honors env override", () => {
    assert.equal(resolveOfficialAuthorModelId({} as NodeJS.ProcessEnv), BACKGROUND_OPENROUTER_MODEL);
    assert.equal(
      resolveOfficialAuthorModelId({ OFFICIAL_AUTHOR_MODEL: "  " } as NodeJS.ProcessEnv),
      BACKGROUND_OPENROUTER_MODEL
    );
    assert.equal(
      resolveOfficialAuthorModelId({ OFFICIAL_AUTHOR_MODEL: "custom-model" } as NodeJS.ProcessEnv),
      "custom-model"
    );
  });

  it("author sources never hardcode a provider model id", () => {
    for (const file of ["author.ts", "authorPrompts.ts", "bible.ts"]) {
      const source = fs.readFileSync(path.join(DIR, file), "utf8");
      assert.doesNotMatch(source, /gpt-6-luna|deepseek-v4|gemini-3\.|claude-opus|qwen-|glm-|gpt-5\.6/, file);
    }
  });

  it("strict JSON parse accepts fenced JSON and rejects patched prose", () => {
    assert.deepEqual(parseAuthorJson('{"a":1}', "world_bible"), { a: 1 });
    assert.deepEqual(parseAuthorJson('```json\n{"a":1}\n```', "world_bible"), { a: 1 });
    assert.throws(() => parseAuthorJson("not json {", "world_bible"), (e: unknown) => e instanceof OfficialSupplyGateError);
  });

  it("assembled SFW bible passes bible QA and compiles to a valid draft", () => {
    const bible = fakeBible(false);
    assert.equal(validatePilotBible(bible, { adultExpected: false }).ok, true);
    const draft = compileOfficialDraftFromBible(bible, STAGING_KEYS);
    assert.equal(validatePilotDraftForTextLock(draft, []).ok, true);
    const total = officialSubstantiveCharCount(draft);
    assert.ok(total >= 3000, `thin sheet: ${total}`);
  });

  it("assembled 19+ bible passes bible QA and draft adult contract", () => {
    const bible = fakeBible(true);
    assert.equal(validatePilotBible(bible, { adultExpected: true }).ok, true);
    const draft = compileOfficialDraftFromBible(bible, STAGING_KEYS);
    assert.equal(draft.adult.nsfw, true);
    assert.equal(validatePilotDraftForTextLock(draft, []).ok, true);
  });

  it("under-19 main character is rejected", () => {
    const bible = fakeBible(true, 17, "유년");
    assert.equal(validatePilotBible(bible, { adultExpected: true }).ok, false);
    const draft = compileOfficialDraftFromBible(
      { ...bible, identity: { ...bible.identity, age: 17 } },
      STAGING_KEYS
    );
    const qa = validatePilotDraftForTextLock(draft, []);
    assert.ok(qa.errors.some((e) => e.code === "adult_main_under_19"));
  });

  it("NPC count 0/1/3 pass, 4 fails", () => {
    for (const npcCount of [0, 1, 3] as const) {
      const bible = assembleOfficialCharacterBible(fakeHalf1(), fakeHalf2({ npcCount }));
      assert.equal(validatePilotBible(bible, { adultExpected: false }).ok, true, `npc=${npcCount}`);
    }
    const over = assembleOfficialCharacterBible(fakeHalf1(), fakeHalf2({ npcCount: 4 }));
    const qa = validatePilotBible(over, { adultExpected: false });
    assert.ok(qa.errors.some((e) => e.code === "bible_npc_count"));
  });

  it("bible QA requires contradiction, progression, engine, speech examples, secrets", () => {
    const base = fakeBible(false);
    assert.ok(!validateCharacterBible({ ...base, contradiction: "" }, { adultExpected: false }).ok);
    assert.ok(
      !validateCharacterBible(
        { ...base, userRelationship: { ...base.userRelationship, progression: ["경계"] } },
        { adultExpected: false }
      ).ok
    );
    assert.ok(
      !validateCharacterBible(
        { ...base, rpEngine: { ...base.rpEngine, repeatable: ["순찰"] } },
        { adultExpected: false }
      ).ok
    );
    assert.ok(
      !validateCharacterBible(
        { ...base, speech: { ...base.speech, examples: "한 줄" } },
        { adultExpected: false }
      ).ok
    );
    assert.ok(!validateCharacterBible({ ...base, secrets: [] }, { adultExpected: false }).ok);
    assert.ok(!validateCharacterBible({ ...base, behaviorRules: ["하나"] }, { adultExpected: false }).ok);
  });

  it("SFW bible with adult authoring content is rejected; 19+ without adult section is rejected", () => {
    const sfw = fakeBible(false);
    const polluted = {
      ...sfw,
      adultSection: {
        orientation: "HL",
        hookSummary: "x",
        dialogueProfile: "explicit_rare",
        consentModes: ["standard"],
        tone: "야한 내용",
        preferenceKeywords: ["a", "b", "c", "d"],
        boundaries: ["a", "b", "c"],
        consentBehavior: "내용",
        scenarioExamples: ["a", "b"],
      },
    };
    assert.ok(!validateCharacterBible(polluted, { adultExpected: false }).ok);
    const adult = fakeBible(true);
    assert.ok(!validateCharacterBible({ ...adult, adultSection: null }, { adultExpected: true }).ok);
  });

  it("compiler keeps keywords out of runtime prose and folds hidden opinions into secrets", () => {
    const draft = compileOfficialDraftFromBible(
      {
        ...fakeBible(false),
        otherRelationships: [{ target: "리안", public: "협력", privateOpinion: "믿음", hidden: "의심" }],
      },
      STAGING_KEYS
    );
    assert.doesNotMatch(draft.sections.characterCore, /냉정.*책임감.*자존심.*통제욕.*충성.*고집/);
    assert.ok(draft.secrets.some((s) => s.includes("리안") && s.includes("의심")));
    assert.match(draft.sections.characterCore, /27세/);
  });

  it("compiler enforces canonical caps instead of silently truncating", () => {
    const bible = fakeBible(false);
    assert.throws(
      () =>
        compileOfficialDraftFromBible(
          { ...bible, publicProfile: { ...bible.publicProfile, tagline: "가".repeat(51) } },
          STAGING_KEYS
        ),
      /tagline/
    );
    assert.throws(
      () => compileOfficialDraftFromBible({ ...bible, greeting: "가".repeat(2001) }, STAGING_KEYS),
      /greeting/
    );
  });

  it("duplicate greetings and hooks are detected across siblings", () => {
    const a = compileOfficialDraftFromBible(fakeBible(false, 27, "카엘"), STAGING_KEYS);
    const b = compileOfficialDraftFromBible(fakeBible(false, 29, "리안"), {
      ...STAGING_KEYS,
      draftKey: "pilot-test-02",
    });
    const qa = validatePilotDraftForTextLock(b, [a]);
    assert.ok(
      qa.errors.some((e) => e.code === "near_duplicate_greeting" || e.code === "clone_character_core"),
      JSON.stringify(qa.errors)
    );
  });

  it("shared lorebook secret leak is rejected", () => {
    const draft = compileOfficialDraftFromBible(fakeBible(false), STAGING_KEYS);
    const secret = draft.secrets[0] ?? "북부 전선 패전의 생존자";
    const clean = validatePilotLorebook(
      [{ entryKey: "lore-1", name: "기사단", keywords: ["기사단"], content: "황궁을 지키는 근위 기사단에 대한 공개 기록이다." }],
      [draft]
    );
    assert.equal(clean.ok, true);
    const leaked = validatePilotLorebook(
      [{ entryKey: "lore-1", name: "기사단", keywords: ["기사단"], content: `공개 기록. ${secret} 사실이 적혀 있다.` }],
      [draft]
    );
    assert.ok(leaked.errors.some((e) => e.code === "lorebook_secret_leak"));
  });

  it("asset plan exactly 14 with representative first-class and no background-only", () => {
    void generateOfficialAssetPlan;
    const draft = compileOfficialDraftFromBible(fakeBible(false), STAGING_KEYS);
    assert.equal(validatePilotAssetPlan(draft, testAssetPlan()).ok, true);
  });

  it("appearance lock validates against the compiled draft", () => {
    const draft = compileOfficialDraftFromBible(fakeBible(false), STAGING_KEYS);
    assert.equal(validatePilotAppearance(draft, testAppearance()).ok, true);
  });

  it("style board fake passes proposal QA; wrong count is rejected", async () => {
    const transport = fakeTransport({
      style_board: { candidates: ["s1", "s2", "s3"].map(testStyleCandidate) },
    });
    const ok = await generateOfficialStyleBoard({
      transport,
      board: { genre: "로맨스 판타지", allowedReferenceUrls: [], candidateCount: 3 },
    });
    assert.equal(ok.candidates.length, 3);
    const bad = fakeTransport({ style_board: { candidates: ["only"].map(testStyleCandidate) } });
    await assert.rejects(
      generateOfficialStyleBoard({ transport: bad, board: { genre: "로맨스 판타지", allowedReferenceUrls: [], candidateCount: 1 } }),
      (e: unknown) => e instanceof OfficialSupplyGateError
    );
  });

  it("author sources never import billing, creator rewards, image, or publish owners", () => {
    for (const file of ["author.ts", "authorPrompts.ts", "bible.ts"]) {
      const source = fs.readFileSync(path.join(DIR, file), "utf8");
      assert.doesNotMatch(
        source,
        /chatImageGenerationPersistence|chatImageGenerationJobs|chatImagePricing|imageGenerationEconomics|@\/lib\/points"|creatorPoints|deductPoints|creditPoints|runOfficialAssetSlot|productionAdapters|openAiImage|storeUpload|analyzeAssetImage|publishOfficial|stageOfficial|createCharacterFromForm|siteManaged|isAdminUser/,
        file
      );
    }
  });

  it("world bible requires factions, locations, lorebook bounds and portfolio slots", () => {
    const faction = (name: string) => ({
      name,
      purpose: "목적",
      leadership: "지도층",
      means: "수단",
      relations: "관계",
      publicView: "시선",
    });
    const base: OfficialWorldBible = {
      name: "테스트 제국",
      genre: "로맨스 판타지",
      subgenre: "궁정",
      tone: "무겁고 우아함",
      era: "제국력 500년",
      techLevel: "마법 공존 중세",
      regions: "황도",
      societyForm: "전제 황정",
      premise: prose(20, 400),
      centralPremise: "황위 계승을 둘러싼 갈등",
      situation: {
        biggestEvent: prose(21, 200),
        beneficiaries: "황태자파",
        threatened: "원로원",
        upcomingChange: "계승 서열 변경",
      },
      factions: [faction("황실"), faction("원로원"), faction("기사단")],
      powerSystem: {
        capabilities: "능력",
        users: "사용자",
        acquisition: "획득",
        ranks: "등급",
        limits: "한계",
        costs: "대가",
        socialImpact: "영향",
        taboos: "금기",
      },
      society: { 계급: "귀족과 평민", 법: "황실법", 결혼: "정략결혼" },
      culture: [
        { name: "복식", detail: "설명" },
        { name: "음식", detail: "설명" },
        { name: "축제", detail: "설명" },
      ],
      locations: ["궁", "성", "강", "탑", "시장"].map((name) => ({
        name,
        purpose: "용도",
        mood: "분위기",
        users: "이용자",
        rpEvents: "사건",
      })),
      history: [
        { event: "사건1", impact: "영향1" },
        { event: "사건2", impact: "영향2" },
        { event: "사건3", impact: "영향3" },
      ],
      knowledge: { common: ["황도는 수도로 알려져 있다."], faction: [], characterLocal: [], authorOnly: [] },
      userEntry: { allowedRoles: ["귀족", "고용인"], note: "비고" },
      lorebook: Array.from({ length: 8 }, (_, i) => ({
        entryKey: `lore-${i + 1}`,
        name: `항목${i + 1}`,
        keywords: ["공개"],
        content: `공개된 사실 기록이다. ${prose(30 + i, 60)}`,
      })),
      portfolio: [],
    };
    const slots = 2;
    const withPortfolio: OfficialWorldBible = {
      ...base,
      portfolio: [
        {
          slot: 1,
          name: "가나",
          gender: "male",
          age: 27,
          archetype: "기사",
          relationshipTrope: "경계",
          occupation: "기사단장",
          faction: "기사단",
          socialPosition: "고위",
          personalityCore: "냉정",
          visualSilhouette: "장신",
          rpHook: "순찰",
          adultCandidate: true,
          speechDirection: "단호",
          audience: "female",
        },
        {
          slot: 2,
          name: "다라",
          gender: "female",
          age: 24,
          archetype: "마법사",
          relationshipTrope: "협력",
          occupation: "궁정 마법사",
          faction: "황실",
          socialPosition: "중위",
          personalityCore: "호기심",
          visualSilhouette: "단신",
          rpHook: "연구",
          adultCandidate: false,
          speechDirection: "명랑",
          audience: "female",
        },
      ],
    };
    assert.equal(validateWorldBible(withPortfolio, { slots, adultCandidates: 1 }).ok, true);
    assert.ok(!validateWorldBible({ ...withPortfolio, factions: [] }, { slots, adultCandidates: 1 }).ok);
    assert.ok(!validateWorldBible({ ...withPortfolio, locations: [] }, { slots, adultCandidates: 1 }).ok);
    assert.ok(
      !validateWorldBible({ ...withPortfolio, lorebook: [] }, { slots, adultCandidates: 1 }).ok
    );
    assert.ok(
      !validateWorldBible(
        {
          ...withPortfolio,
          knowledge: { common: ["사실은 황자가 흑막이다."], faction: [], characterLocal: [], authorOnly: [] },
          lorebook: withPortfolio.lorebook,
        },
        { slots, adultCandidates: 1 }
      ).ok
    );
  });
});
