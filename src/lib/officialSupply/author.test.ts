import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { BACKGROUND_OPENROUTER_MODEL } from "@/lib/ai";
import {
  assembleOfficialCharacterBible,
  createAuthorCostReport,
  generateOfficialAssetPlan,
  generateOfficialCharacterBible,
  generateOfficialStyleBoard,
  parseAuthorJson,
  resolveOfficialAuthorModelId,
  validatePilotAppearance,
  validatePilotAssetPlan,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
  OFFICIAL_CHARACTER_CALL_CAP,
  OfficialAuthorCallBudget,
  reviseOfficialCharacterVoice,
  withAuthorAccounting,
  withOfficialAuthorCallBudget,
  type OfficialAuthorRawCompletion,
  type OfficialAuthorTransport,
} from "@/lib/officialSupply/author";
import {
  CHARACTER_VOICE_SCHEMA,
  compileOfficialDraftFromBible,
  validateCharacterBible,
  validateWorldBible,
} from "@/lib/officialSupply/bible";
import type { OfficialWorldBible } from "@/lib/officialSupply/bible";
import {
  CONTRACT_GREETING,
  CONTRACT_PITCH,
  CONTRACT_SPEECH,
  testAppearance,
  testAssetPlan,
  testStyleCandidate,
} from "@/lib/officialSupply/officialSupply.fixtures";
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

function recordingTransport(responses: Record<string, unknown>): {
  transport: OfficialAuthorTransport;
  tasks: string[];
} {
  const tasks: string[] = [];
  return {
    tasks,
    transport: {
      label: "fake-recording",
      async completeJson(input) {
        tasks.push(input.task);
        const data = responses[input.task];
        if (data === undefined) throw new Error(`no fake response for ${input.task}`);
        return fakeCompletion(typeof data === "string" ? data : JSON.stringify(data));
      },
    },
  };
}

const GENERATION_BRIEF = {
  slot: 1,
  name: "카엘",
  gender: "male" as const,
  age: 27,
  archetype: "기사",
  relationshipTrope: "경계",
  occupation: "기사단장",
  faction: "기사단",
  socialPosition: "고위",
  personalityCore: "냉정",
  visualSilhouette: "장신",
  rpHook: "순찰",
  adultCandidate: false,
  speechDirection: "단호",
  audience: "female" as const,
};

function generationArgs(transport: OfficialAuthorTransport) {
  return {
    transport,
    part1: {
      brief: GENERATION_BRIEF,
      worldName: "테스트",
      worldContext: "맥락",
      siblingSketches: [],
    },
    voice: { name: "카엘", age: 27, adultCandidate: false, speechDirection: "단호", npcDemand: "없음" },
    bonds: { name: "카엘", age: 27, rpHook: "순찰", adultCandidate: false, castList: [] },
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
      hobbies: ["새벽 연무", "검 손질", "전술 지도 읽기"],
      habits: ["순찰 전 문장 확인", "야간 경계", "대화 전 출입구 확인"],
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
      description: CONTRACT_SPEECH,
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
    greeting: CONTRACT_GREETING,
    publicProfile: {
      tagline: "황궁의 방패, 경계 너머의 충성",
      description: CONTRACT_PITCH,
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
  const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw }));
  return assembleOfficialCharacterBible(fakeHalf1({ age, name }), voice, bonds);
}

function splitHalf2(combined: Record<string, unknown>): [Record<string, unknown>, Record<string, unknown>] {
  const { userRelationship, otherRelationships, secrets, rpEngine, adultSection, nsfw, ...voice } = combined;
  return [
    voice as Record<string, unknown>,
    { userRelationship, otherRelationships, secrets, rpEngine, nsfw, adultSection } as Record<string, unknown>,
  ];
}

function voiceWithNpcRelation(relation: unknown, mode: "set" | "omit" = "set"): Record<string, unknown> {
  const [voice] = splitHalf2(fakeHalf2({ npcCount: 1 }));
  const source = ((voice.npcs as unknown[])[0] ?? {}) as Record<string, unknown>;
  const npc = { ...source };
  if (mode === "omit") delete npc.relationToChar;
  else npc.relationToChar = relation;
  return { ...voice, npcs: [npc] };
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

  it("Voice schema is advisory only: json_object transport and no NPC required list", () => {
    const author = fs.readFileSync(path.join(DIR, "author.ts"), "utf8");
    assert.match(author, /responseFormat: "json_object"/);
    assert.doesNotMatch(author, /responseFormat: "json_schema"/);
    const npcItems = (CHARACTER_VOICE_SCHEMA as { properties: { npcs: { items: { required?: string[] } } } }).properties
      .npcs.items;
    assert.equal(npcItems.required, undefined);
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
    const lock = validatePilotDraftForTextLock(draft, []);
    assert.equal(lock.ok, true, JSON.stringify(lock.errors));
    const total = officialSubstantiveCharCount(draft);
    assert.ok(total >= 3000, `thin sheet: ${total}`);
  });

  it("assembled 19+ bible passes bible QA and draft adult contract", () => {
    const bible = fakeBible(true);
    assert.equal(validatePilotBible(bible, { adultExpected: true }).ok, true);
    const draft = compileOfficialDraftFromBible(bible, STAGING_KEYS);
    assert.equal(draft.adult.nsfw, true);
    const lock = validatePilotDraftForTextLock(draft, []);
    assert.equal(lock.ok, true, JSON.stringify(lock.errors));
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
      const [voice, bonds] = splitHalf2(fakeHalf2({ npcCount }));
      const bible = assembleOfficialCharacterBible(fakeHalf1(), voice, bonds);
      assert.equal(validatePilotBible(bible, { adultExpected: false }).ok, true, `npc=${npcCount}`);
    }
    const [voice4, bonds4] = splitHalf2(fakeHalf2({ npcCount: 4 }));
    const over = assembleOfficialCharacterBible(fakeHalf1(), voice4, bonds4);
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

  it("compiler treats Korean appearance fields as complete text and keeps height single-owned", () => {
    const base = fakeBible(false);
    const bible = {
      ...base,
      identity: { ...base.identity, heightCm: 184 },
      appearance: {
        ...base.appearance,
        faceShape: "매끈한 턱선이 이어진다.",
        eyes: "눈꼬리가 가늘게 올라간다.",
        eyeColor: "짙은 호박색.",
        hairColor: "붉은 기가 도는 짙은 갈색.",
        hairstyle: "이마를 비스듬히 가로지르는 쉼표머리.",
        hairLength: "옆과 뒤는 짧다.",
        skin: "햇볕에 그을린 구리빛 피부.",
        build: "184cm의 유연하고 길쭉한 체격.",
        usualExpression: "느긋한 미소.",
        defaultOutfit: "짙은 녹색 실크 베스트를 입는다.",
        accessories: "금장식 모노클.",
      },
    };
    const draft = compileOfficialDraftFromBible(bible, STAGING_KEYS);
    const core = draft.sections.characterCore;

    assert.match(core, /키: 184cm\. 체격: 유연하고 길쭉한 체격\./);
    assert.match(core, /피부: 햇볕에 그을린 구리빛 피부\./);
    assert.match(core, /기본 복장: 짙은 녹색 실크 베스트를 입는다\./);
    assert.doesNotMatch(core, /184cm\s+184cm/);
    assert.doesNotMatch(core, /피부\.?\s*피부/);
    assert.doesNotMatch(core, /이어진다\.에/);
    assert.doesNotMatch(core, /\.\./);
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

  it("three-call bible generation assembles through the canonical path (fake transport)", async () => {
    const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
    const { bible } = await generateOfficialCharacterBible(
      generationArgs(
        fakeTransport({
          character_bible_1: fakeHalf1(),
          character_bible_voice: voice,
          character_bible_bonds: bonds,
        })
      )
    );
    assert.equal(bible.promptStandard, "compact_rp_v1");
    assert.equal(validatePilotBible(bible, { adultExpected: false }).ok, true);
  });

  it("Voice NPC relationToChar shape is rejected at assemble with the exact field path", () => {
    const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
    const cases: Array<{ label: string; voice: Record<string, unknown> }> = [
      { label: "missing", voice: voiceWithNpcRelation(undefined, "omit") },
      { label: "empty", voice: voiceWithNpcRelation("") },
      { label: "blank", voice: voiceWithNpcRelation("   ") },
      { label: "null", voice: voiceWithNpcRelation(null) },
      { label: "number", voice: voiceWithNpcRelation(12) },
    ];
    for (const { label, voice } of cases) {
      assert.throws(
        () => assembleOfficialCharacterBible(fakeHalf1(), voice, bonds),
        (error: unknown) => {
          assert.ok(error instanceof OfficialSupplyGateError, label);
          assert.equal(error.code, "author_shape_invalid", label);
          assert.match(error.message, /npcs\[0\]\.relationToChar must be a non-empty string/, label);
          return true;
        },
        label
      );
    }
    const valid = assembleOfficialCharacterBible(fakeHalf1(), voiceWithNpcRelation("카엘과 5년째 함께함"), bonds);
    assert.equal(valid.npcs[0]?.relationToChar, "카엘과 5년째 함께함");
  });

  it("invalid Voice NPC relation rejects before Bonds and does not invent a relationship", async () => {
    const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
    const { transport, tasks } = recordingTransport({
      character_bible_1: fakeHalf1(),
      character_bible_voice: voiceWithNpcRelation(undefined, "omit"),
      character_bible_bonds: bonds,
    });
    await assert.rejects(
      () => generateOfficialCharacterBible(generationArgs(transport)),
      (error: unknown) => {
        assert.ok(error instanceof OfficialSupplyGateError);
        assert.equal(error.code, "author_shape_invalid");
        assert.match(error.message, /npcs\[0\]\.relationToChar must be a non-empty string/);
        return true;
      }
    );
    assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice"]);
  });

  it("valid 0/1/3 Voice NPCs still call Bonds and leave relation text unchanged", async () => {
    for (const npcCount of [0, 1, 3] as const) {
      const [voice, bonds] = splitHalf2(fakeHalf2({ npcCount }));
      const { transport, tasks } = recordingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voice,
        character_bible_bonds: bonds,
      });
      const { bible } = await generateOfficialCharacterBible(generationArgs(transport));
      assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice", "character_bible_bonds"], `npc=${npcCount}`);
      assert.equal(bible.npcs.length, npcCount, `npc=${npcCount}`);
      for (const npc of bible.npcs) {
        assert.equal(npc.relationToChar, "카엘과 5년째 함께함");
      }
      assert.equal(validatePilotBible(bible, { adultExpected: false }).ok, true, `npc=${npcCount}`);
    }
  });

  it("billed Voice shape rejection counts Part1 and Voice once and never starts Bonds", async () => {
    const report = createAuthorCostReport();
    const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
    const inner = recordingTransport({
      character_bible_1: fakeHalf1(),
      character_bible_voice: voiceWithNpcRelation(""),
      character_bible_bonds: bonds,
    });
    const transport = withAuthorAccounting(inner.transport, report, { draftKey: "pilot-rf-shape", workflowAttempt: 1 });
    await assert.rejects(() => generateOfficialCharacterBible(generationArgs(transport)));
    assert.deepEqual(inner.tasks, ["character_bible_1", "character_bible_voice"]);
    assert.equal(report.successfulCompletions, 2);
    assert.equal(report.failedProviderAttempts, 0);
    assert.equal(report.physicalAttempts, 2);
    assert.deepEqual(
      report.lines.map((line) => `${line.task}:${line.outcome}`),
      ["character_bible_1:success", "character_bible_voice:success"]
    );
  });

  describe("NPC relation targeted repair", () => {
    const REPAIR_RELATION = "카엘과 5년째 함께함";
    const REPAIR_TASKS = ["character_bible_1", "character_bible_voice", "character_npc_relation", "character_bible_bonds"];

    function repairResponse(entries: Array<{ index: unknown; relationToChar: unknown }>): Record<string, unknown> {
      return { npcs: entries };
    }

    function npcVoice(npcCount: 1 | 3, mutate: (npcs: Record<string, unknown>[]) => void): Record<string, unknown> {
      const [voice] = splitHalf2(fakeHalf2({ npcCount }));
      const npcs = (voice.npcs as Record<string, unknown>[]).map((npc) => ({ ...npc }));
      mutate(npcs);
      return { ...voice, npcs };
    }

    function scriptedTransport(responses: Record<string, unknown>, costUsd = 0) {
      const calls: Array<{ task: string; schemaName: string }> = [];
      const transport: OfficialAuthorTransport = {
        label: "fake-scripted",
        async completeJson(input) {
          calls.push({ task: input.task, schemaName: input.schemaName });
          const data = responses[input.task];
          if (data === undefined) throw new Error(`no fake response for ${input.task}`);
          return { ...fakeCompletion(typeof data === "string" ? data : JSON.stringify(data)), costUsd };
        },
      };
      return { transport, calls };
    }

    const tasksOf = (calls: Array<{ task: string }>) => calls.map((call) => call.task);

    it("repair OFF keeps fail-closed and never calls the repair task", async () => {
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const { transport, calls } = scriptedTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voiceWithNpcRelation(undefined, "omit"),
        character_bible_bonds: bonds,
        character_npc_relation: repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }]),
      });
      await assert.rejects(
        () => generateOfficialCharacterBible(generationArgs(transport)),
        (error: unknown) => {
          assert.ok(error instanceof OfficialSupplyGateError);
          assert.equal(error.code, "author_shape_invalid");
          return true;
        }
      );
      assert.deepEqual(tasksOf(calls), ["character_bible_1", "character_bible_voice"]);
    });

    it("repair ON adds no call for valid 0/1/3 NPCs", async () => {
      for (const npcCount of [0, 1, 3] as const) {
        const [voice, bonds] = splitHalf2(fakeHalf2({ npcCount }));
        const { transport, calls } = scriptedTransport({
          character_bible_1: fakeHalf1(),
          character_bible_voice: voice,
          character_bible_bonds: bonds,
        });
        const out = await generateOfficialCharacterBible({ ...generationArgs(transport), npcRelationRepair: true });
        assert.deepEqual(tasksOf(calls), ["character_bible_1", "character_bible_voice", "character_bible_bonds"], `npc=${npcCount}`);
        assert.deepEqual(out.npcRelationRepairs, [], `npc=${npcCount}`);
        assert.equal(validatePilotBible(out.bible, { adultExpected: false }).ok, true, `npc=${npcCount}`);
      }
    });

    it("missing relationToChar gets one targeted repair and the repaired bible matches the valid baseline", async () => {
      const [baseVoice, bonds] = splitHalf2(fakeHalf2({ npcCount: 1 }));
      const baseline = await generateOfficialCharacterBible(
        generationArgs(
          scriptedTransport({
            character_bible_1: fakeHalf1(),
            character_bible_voice: baseVoice,
            character_bible_bonds: bonds,
          }).transport
        )
      );
      const { transport, calls } = scriptedTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voiceWithNpcRelation(undefined, "omit"),
        character_bible_bonds: bonds,
        character_npc_relation: repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }]),
      });
      const out = await generateOfficialCharacterBible({ ...generationArgs(transport), npcRelationRepair: true });
      assert.deepEqual(tasksOf(calls), REPAIR_TASKS);
      assert.equal(calls[2]?.schemaName, "official_npc_relation_repair");
      assert.equal(out.npcRelationRepairs.length, 1);
      assert.equal(JSON.stringify(out.bible), JSON.stringify(baseline.bible));
    });

    it("repair changes only the broken NPC relation field and keeps every other Voice and Part1 field", async () => {
      const [baseVoice, bonds] = splitHalf2(fakeHalf2({ npcCount: 1 }));
      const baseline = await generateOfficialCharacterBible(
        generationArgs(
          scriptedTransport({
            character_bible_1: fakeHalf1(),
            character_bible_voice: baseVoice,
            character_bible_bonds: bonds,
          }).transport
        )
      );
      const { transport } = scriptedTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voiceWithNpcRelation(undefined, "omit"),
        character_bible_bonds: bonds,
        character_npc_relation: repairResponse([{ index: 0, relationToChar: `  ${REPAIR_RELATION} ` }]),
      });
      const out = await generateOfficialCharacterBible({ ...generationArgs(transport), npcRelationRepair: true });
      const { npcs: repairedNpcs, ...repairedRest } = out.bible;
      const { npcs: baselineNpcs, ...baselineRest } = baseline.bible;
      assert.equal(JSON.stringify(repairedRest), JSON.stringify(baselineRest));
      assert.equal(repairedNpcs[0]?.relationToChar, REPAIR_RELATION);
      assert.equal(JSON.stringify({ ...repairedNpcs[0], relationToChar: "" }), JSON.stringify({ ...baselineNpcs[0], relationToChar: "" }));
    });

    it("invalid repair results fail closed before Bonds without a second repair call", async () => {
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const singleBroken = () => voiceWithNpcRelation(undefined, "omit");
      const doubleBroken = () =>
        npcVoice(3, (npcs) => {
          delete npcs[0]?.relationToChar;
          delete npcs[2]?.relationToChar;
        });
      const cases: Array<{ label: string; voice: Record<string, unknown>; repair: unknown }> = [
        { label: "empty", voice: singleBroken(), repair: repairResponse([{ index: 0, relationToChar: "" }]) },
        { label: "blank", voice: singleBroken(), repair: repairResponse([{ index: 0, relationToChar: "   " }]) },
        { label: "null", voice: singleBroken(), repair: repairResponse([{ index: 0, relationToChar: null }]) },
        { label: "number", voice: singleBroken(), repair: repairResponse([{ index: 0, relationToChar: 12 }]) },
        { label: "unknown index", voice: singleBroken(), repair: repairResponse([{ index: 1, relationToChar: REPAIR_RELATION }]) },
        { label: "duplicate index", voice: singleBroken(), repair: repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }, { index: 0, relationToChar: REPAIR_RELATION }]) },
        { label: "no npcs array", voice: singleBroken(), repair: {} },
        { label: "missing one of two", voice: doubleBroken(), repair: repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }]) },
      ];
      for (const { label, voice, repair } of cases) {
        const { transport, calls } = scriptedTransport({
          character_bible_1: fakeHalf1(),
          character_bible_voice: voice,
          character_bible_bonds: bonds,
          character_npc_relation: repair,
        });
        await assert.rejects(
          () => generateOfficialCharacterBible({ ...generationArgs(transport), npcRelationRepair: true }),
          (error: unknown) => {
            assert.ok(error instanceof OfficialSupplyGateError, label);
            assert.equal(error.code, "author_npc_relation_rejected", label);
            return true;
          },
          label
        );
        assert.deepEqual(tasksOf(calls), ["character_bible_1", "character_bible_voice", "character_npc_relation"], label);
      }
    });

    it("several broken relations share one repair call and untouched NPCs stay identical", async () => {
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const voice = npcVoice(3, (npcs) => {
        delete npcs[0]?.relationToChar;
        delete npcs[2]?.relationToChar;
      });
      const { transport, calls } = scriptedTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voice,
        character_bible_bonds: bonds,
        character_npc_relation: repairResponse([
          { index: 0, relationToChar: "첫째 관계" },
          { index: 2, relationToChar: "셋째 관계" },
        ]),
      });
      const out = await generateOfficialCharacterBible({ ...generationArgs(transport), npcRelationRepair: true });
      assert.deepEqual(tasksOf(calls), REPAIR_TASKS);
      assert.equal(out.bible.npcs.length, 3);
      assert.deepEqual(
        out.bible.npcs.map((npc) => npc.relationToChar),
        ["첫째 관계", "카엘과 5년째 함께함", "셋째 관계"]
      );
      assert.equal(out.bible.npcs[1]?.name, (voice.npcs as Record<string, unknown>[])[1]?.name);
    });

    it("a broken NPC name or role never triggers relation repair", async () => {
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const voice = npcVoice(1, (npcs) => {
        npcs[0]!.role = "  ";
        delete npcs[0]?.relationToChar;
      });
      const { transport, calls } = scriptedTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voice,
        character_bible_bonds: bonds,
        character_npc_relation: repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }]),
      });
      await assert.rejects(
        () => generateOfficialCharacterBible({ ...generationArgs(transport), npcRelationRepair: true }),
        (error: unknown) => {
          assert.ok(error instanceof OfficialSupplyGateError);
          assert.equal(error.code, "author_shape_invalid");
          assert.match(error.message, /npcs\[0\]\.role/);
          return true;
        }
      );
      assert.deepEqual(tasksOf(calls), ["character_bible_1", "character_bible_voice"]);
    });

    function sequenceTransport(queues: Record<string, unknown[]>, costUsd = 0) {
      const remaining = Object.fromEntries(Object.entries(queues).map(([task, items]) => [task, [...items]]));
      const calls: Array<{ task: string; schemaName: string }> = [];
      const transport: OfficialAuthorTransport = {
        label: "fake-sequence",
        async completeJson(input) {
          calls.push({ task: input.task, schemaName: input.schemaName });
          const next = remaining[input.task]?.shift();
          if (next === undefined) throw new Error(`no fake response for ${input.task}`);
          if (next instanceof Error) throw next;
          return { ...fakeCompletion(typeof next === "string" ? next : JSON.stringify(next)), costUsd };
        },
      };
      return { transport, calls };
    }

    const REVISION_VOICE = { name: "카엘", age: 27, adultCandidate: false, speechDirection: "단호", npcDemand: "없음" };

    it("approved character cap is six calls: Part1, Voice, NPC repair, Bonds, and two Voice revisions", () => {
      assert.equal(OFFICIAL_CHARACTER_CALL_CAP, 6);
    });

    const CAP_ROWS = [
      { label: "normal run without revision", npcBroken: false, revisions: 0, expectedUsed: 3 },
      { label: "normal run with two Voice revisions", npcBroken: false, revisions: 2, expectedUsed: 5 },
      { label: "NPC repair without revision", npcBroken: true, revisions: 0, expectedUsed: 4 },
      { label: "NPC repair with two Voice revisions", npcBroken: true, revisions: 2, expectedUsed: 6 },
    ] as const;
    for (const row of CAP_ROWS) {
      it(`call budget counts ${row.label} as ${row.expectedUsed} physical calls`, async () => {
        const [voiceValid, bonds] = splitHalf2(fakeHalf2({ npcCount: 1 }));
        const { transport, calls } = sequenceTransport({
          character_bible_1: [fakeHalf1()],
          character_bible_voice: [
            row.npcBroken ? voiceWithNpcRelation(undefined, "omit") : voiceValid,
            ...Array.from({ length: row.revisions }, () => voiceValid),
          ],
          character_bible_bonds: [bonds],
          character_npc_relation: [repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }])],
        });
        const budget = new OfficialAuthorCallBudget(OFFICIAL_CHARACTER_CALL_CAP);
        const guarded = withOfficialAuthorCallBudget(transport, budget);
        let { bible } = await generateOfficialCharacterBible({ ...generationArgs(guarded), npcRelationRepair: true });
        for (let revision = 0; revision < row.revisions; revision += 1) {
          ({ bible } = await reviseOfficialCharacterVoice({
            transport: guarded,
            bible,
            voice: REVISION_VOICE,
            fields: ["greeting"],
            reasons: ["greeting too short"],
          }));
        }
        assert.equal(budget.used, row.expectedUsed);
        assert.equal(calls.length, row.expectedUsed);
        assert.equal(validatePilotBible(bible, { adultExpected: false }).ok, true);
      });
    }

    it("valid 0/1/3 NPC runs keep three calls under the cap in the same order", async () => {
      for (const npcCount of [0, 1, 3] as const) {
        const [voice, bonds] = splitHalf2(fakeHalf2({ npcCount }));
        const { transport, calls } = sequenceTransport({
          character_bible_1: [fakeHalf1()],
          character_bible_voice: [voice],
          character_bible_bonds: [bonds],
        });
        const budget = new OfficialAuthorCallBudget(OFFICIAL_CHARACTER_CALL_CAP);
        await generateOfficialCharacterBible({ ...generationArgs(withOfficialAuthorCallBudget(transport, budget)), npcRelationRepair: true });
        assert.equal(budget.used, 3, `npc=${npcCount}`);
        assert.deepEqual(tasksOf(calls), ["character_bible_1", "character_bible_voice", "character_bible_bonds"], `npc=${npcCount}`);
      }
    });

    it("the seventh physical call is refused before the provider, with no cost line or success receipt", async () => {
      const report = createAuthorCostReport();
      const [voiceValid, bonds] = splitHalf2(fakeHalf2({ npcCount: 1 }));
      const { transport, calls } = sequenceTransport(
        {
          character_bible_1: [fakeHalf1()],
          character_bible_voice: [voiceWithNpcRelation(undefined, "omit"), voiceValid, voiceValid, voiceValid],
          character_bible_bonds: [bonds],
          character_npc_relation: [repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }])],
        },
        0.001
      );
      const budget = new OfficialAuthorCallBudget(OFFICIAL_CHARACTER_CALL_CAP);
      const guarded = withOfficialAuthorCallBudget(
        withAuthorAccounting(transport, report, { draftKey: "pilot-rf-cap", workflowAttempt: 1 }),
        budget
      );
      let { bible } = await generateOfficialCharacterBible({ ...generationArgs(guarded), npcRelationRepair: true });
      for (let revision = 0; revision < 2; revision += 1) {
        ({ bible } = await reviseOfficialCharacterVoice({ transport: guarded, bible, voice: REVISION_VOICE, fields: ["greeting"], reasons: ["greeting too short"] }));
      }
      await assert.rejects(
        () => reviseOfficialCharacterVoice({ transport: guarded, bible, voice: REVISION_VOICE, fields: ["greeting"], reasons: ["greeting too short"] }),
        (error: unknown) => {
          assert.ok(error instanceof OfficialSupplyGateError);
          assert.equal(error.code, "author_call_budget_exhausted");
          return true;
        }
      );
      assert.equal(calls.length, 6);
      assert.equal(report.physicalAttempts, 6);
      assert.equal(report.successfulCompletions, 6);
      assert.equal(report.failedProviderAttempts, 0);
      assert.equal(report.lines.length, 6);
      assert.ok(Math.abs(report.billedCostUsd - 0.006) < 1e-9);
    });

    it("a provider failure consumes a cap slot and is recorded once as provider_failed", async () => {
      const report = createAuthorCostReport();
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const { transport, calls } = sequenceTransport({
        character_bible_1: [fakeHalf1()],
        character_bible_voice: [new Error("provider timeout")],
        character_bible_bonds: [bonds],
      });
      const budget = new OfficialAuthorCallBudget(OFFICIAL_CHARACTER_CALL_CAP);
      const guarded = withOfficialAuthorCallBudget(
        withAuthorAccounting(transport, report, { draftKey: "pilot-rf-fail", workflowAttempt: 1 }),
        budget
      );
      await assert.rejects(() => generateOfficialCharacterBible({ ...generationArgs(guarded), npcRelationRepair: true }), /provider timeout/);
      assert.equal(budget.used, 2);
      assert.equal(calls.length, 2);
      assert.equal(report.physicalAttempts, 2);
      assert.equal(report.failedProviderAttempts, 1);
      assert.deepEqual(
        report.lines.map((line) => `${line.task}:${line.outcome}`),
        ["character_bible_1:success", "character_bible_voice:provider_failed"]
      );
    });

    it("workflow retries share one six-call cap across attempts", async () => {
      const budget = new OfficialAuthorCallBudget(OFFICIAL_CHARACTER_CALL_CAP);
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const repair = repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }]);
      const first = sequenceTransport({
        character_bible_1: [fakeHalf1()],
        character_bible_voice: [voiceWithNpcRelation(undefined, "omit")],
        character_bible_bonds: [bonds],
        character_npc_relation: [repair],
      });
      await generateOfficialCharacterBible({
        ...generationArgs(withOfficialAuthorCallBudget(first.transport, budget)),
        npcRelationRepair: true,
      });
      assert.equal(budget.used, 4);

      const retry = sequenceTransport({
        character_bible_1: [fakeHalf1()],
        character_bible_voice: [voiceWithNpcRelation(undefined, "omit")],
        character_bible_bonds: [bonds],
        character_npc_relation: [repair],
      });
      await assert.rejects(
        () =>
          generateOfficialCharacterBible({
            ...generationArgs(withOfficialAuthorCallBudget(retry.transport, budget)),
            npcRelationRepair: true,
          }),
        (error: unknown) => {
          assert.ok(error instanceof OfficialSupplyGateError);
          assert.equal(error.code, "author_call_budget_exhausted");
          return true;
        }
      );
      assert.deepEqual(tasksOf(retry.calls), ["character_bible_1", "character_bible_voice"]);
      assert.equal(budget.used, 6);
    });

    it("budget exhausted before Bonds stops without a provider call for Bonds", async () => {
      const report = createAuthorCostReport();
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const inner = scriptedTransport(
        {
          character_bible_1: fakeHalf1(),
          character_bible_voice: voiceWithNpcRelation(undefined, "omit"),
          character_bible_bonds: bonds,
          character_npc_relation: repairResponse([{ index: 0, relationToChar: REPAIR_RELATION }]),
        },
        0.001
      );
      const accounted = withAuthorAccounting(inner.transport, report, { draftKey: "pilot-rf-budget", workflowAttempt: 1 });
      const guarded = withOfficialAuthorCallBudget(accounted, new OfficialAuthorCallBudget(3));
      await assert.rejects(
        () => generateOfficialCharacterBible({ ...generationArgs(guarded), npcRelationRepair: true }),
        (error: unknown) => {
          assert.ok(error instanceof OfficialSupplyGateError);
          assert.equal(error.code, "author_call_budget_exhausted");
          return true;
        }
      );
      assert.deepEqual(tasksOf(inner.calls), ["character_bible_1", "character_bible_voice", "character_npc_relation"]);
    });

  });

  describe("Voice/Bonds input contract and Voice structure gate", () => {
    const ADULT_SECTION_KEYS = [
      "orientation",
      "hookSummary",
      "dialogueProfile",
      "consentModes",
      "tone",
      "preferenceKeywords",
      "boundaries",
      "consentBehavior",
      "scenarioExamples",
    ];
    const SPARSE_VOICE_CODES = [
      "bible_behavior_rules",
      "bible_greeting_missing",
      "bible_speech_band",
      "bible_pitch_band",
      "bible_tagline_missing",
      "bible_tags",
      "bible_nsfw_mismatch",
      "bible_sfw_adult_content",
    ];

    function adultArgs(transport: OfficialAuthorTransport) {
      const base = generationArgs(transport);
      return {
        ...base,
        voice: { ...base.voice, adultCandidate: true },
        bonds: { ...base.bonds, adultCandidate: true },
      };
    }

    function capturingTransport(responses: Record<string, unknown>) {
      const calls: Array<{ task: string; user: string }> = [];
      const transport: OfficialAuthorTransport = {
        label: "fake-capture",
        async completeJson(input) {
          calls.push({ task: input.task, user: input.user });
          const data = responses[input.task];
          if (data === undefined) throw new Error(`no fake response for ${input.task}`);
          return fakeCompletion(typeof data === "string" ? data : JSON.stringify(data));
        },
      };
      return { transport, calls };
    }

    function skeletonOf(user: string, firstKey: string): Record<string, unknown> {
      const line = user.split("\n").find((l) => l.startsWith(`{"${firstKey}"`));
      assert.ok(line, `skeleton starting with ${firstKey} must be present in the final prompt`);
      return JSON.parse(line) as Record<string, unknown>;
    }

    function sparseVoice(): Record<string, unknown> {
      const [voice] = splitHalf2(fakeHalf2({ npcCount: 0 }));
      const speech = { ...(voice.speech as Record<string, unknown>), description: prose(3, 225) };
      const { greeting: _greeting, ...rest } = voice;
      return {
        ...rest,
        speech,
        behaviorRules: [],
        publicProfile: { tagline: "", tags: [] },
        nsfw: false,
      };
    }

    function adultBondsWithSfwFlag(): Record<string, unknown> {
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: true }));
      return { ...bonds, nsfw: false };
    }

    function codesOf(qa: { errors: Array<{ code: string }> }): string[] {
      return qa.errors.map((e) => e.code);
    }

    it("adult-candidate input gets an adult-consistent Voice/Bonds template", async () => {
      const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw: true }));
      const { transport, calls } = capturingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voice,
        character_bible_bonds: bonds,
      });
      const { bible } = await generateOfficialCharacterBible(adultArgs(transport));
      const voiceTemplate = skeletonOf(calls.find((c) => c.task === "character_bible_voice")!.user, "speech");
      const bondsUser = calls.find((c) => c.task === "character_bible_bonds")!.user;
      const bondsTemplate = skeletonOf(bondsUser, "userRelationship");
      assert.equal(voiceTemplate.nsfw, true);
      assert.equal(bondsTemplate.nsfw, true);
      const adult = bondsTemplate.adultSection as Record<string, unknown> | null;
      assert.ok(adult && typeof adult === "object", "adult candidate template must not default adultSection to null");
      assert.deepEqual(Object.keys(adult).sort(), [...ADULT_SECTION_KEYS].sort());
      assert.ok((adult.preferenceKeywords as unknown[]).length >= 4 && (adult.preferenceKeywords as unknown[]).length <= 8);
      assert.ok((adult.boundaries as unknown[]).length >= 3 && (adult.boundaries as unknown[]).length <= 6);
      assert.ok((adult.scenarioExamples as unknown[]).length >= 2 && (adult.scenarioExamples as unknown[]).length <= 3);
      assert.ok((adult.consentModes as unknown[]).length >= 1);
      assert.doesNotMatch(bondsUser, /adultSection은 null/);
      assert.equal(validatePilotBible(bible, { adultExpected: true }).ok, true);
    });

    it("regular-character input keeps the SFW Voice/Bonds template", async () => {
      const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const { transport, calls } = capturingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voice,
        character_bible_bonds: bonds,
      });
      await generateOfficialCharacterBible(generationArgs(transport));
      const voiceTemplate = skeletonOf(calls.find((c) => c.task === "character_bible_voice")!.user, "speech");
      const bondsUser = calls.find((c) => c.task === "character_bible_bonds")!.user;
      const bondsTemplate = skeletonOf(bondsUser, "userRelationship");
      assert.equal(voiceTemplate.nsfw, false);
      assert.equal(bondsTemplate.nsfw, false);
      assert.equal(bondsTemplate.adultSection, null);
      assert.match(bondsUser, /adultSection은 null/);
    });

    it("the model's own nsfw output is never overwritten by the server", () => {
      const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw: true }));
      const bible = assembleOfficialCharacterBible(fakeHalf1(), voice, { ...bonds, nsfw: false });
      assert.equal(bible.nsfw, false);
      assert.ok(codesOf(validatePilotBible(bible, { adultExpected: true })).includes("bible_nsfw_mismatch"));
    });

    it("sparse Voice + adult Bonds reproduces the recorded final QA failure types", () => {
      const bible = assembleOfficialCharacterBible(fakeHalf1(), sparseVoice(), adultBondsWithSfwFlag());
      const codes = codesOf(validatePilotBible(bible, { adultExpected: true }));
      for (const code of SPARSE_VOICE_CODES) assert.ok(codes.includes(code), `${code} in ${codes.join(",")}`);
    });

    it("sparse Voice is rejected before Bonds is called, with structure-only diagnostics", async () => {
      const { transport, tasks } = recordingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: sparseVoice(),
        character_bible_bonds: adultBondsWithSfwFlag(),
      });
      await assert.rejects(
        () => generateOfficialCharacterBible(adultArgs(transport)),
        (error: unknown) => {
          assert.ok(error instanceof OfficialSupplyGateError);
          assert.equal(error.code, "author_voice_rejected");
          assert.match(error.message, /bible_behavior_rules/);
          assert.match(error.message, /bible_tagline_missing/);
          assert.match(error.message, /behaviorRules=array:0/);
          assert.match(error.message, /greeting=missing/);
          assert.match(error.message, /speech\.description=string:225/);
          assert.match(error.message, /publicProfile\.tagline=string:0/);
          assert.match(error.message, /publicProfile\.description=missing/);
          assert.match(error.message, /publicProfile\.tags=array:0/);
          assert.match(error.message, /nsfw=boolean:false/);
          assert.match(error.message, /adultExpected=true/);
          assert.ok(error.qa && !error.qa.ok);
          return true;
        }
      );
      assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice"]);
    });

    it("diagnostics carry lengths and counts only, never provider prose", async () => {
      const voice = sparseVoice();
      const description = (voice.speech as Record<string, unknown>).description as string;
      const { transport } = recordingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voice,
        character_bible_bonds: adultBondsWithSfwFlag(),
      });
      await assert.rejects(
        () => generateOfficialCharacterBible(adultArgs(transport)),
        (error: unknown) => {
          assert.ok(error instanceof OfficialSupplyGateError);
          assert.equal(error.message.includes(description.slice(0, 20)), false);
          assert.ok(error.message.length < 1200);
          return true;
        }
      );
    });

    it("billed sparse Voice rejection counts Part1 and Voice once and never bills Bonds", async () => {
      const report = createAuthorCostReport();
      const inner = recordingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: sparseVoice(),
        character_bible_bonds: adultBondsWithSfwFlag(),
      });
      const accounted = withAuthorAccounting(inner.transport, report, { draftKey: "pilot-rf-sparse", workflowAttempt: 1 });
      const budget = new OfficialAuthorCallBudget(OFFICIAL_CHARACTER_CALL_CAP);
      const guarded = withOfficialAuthorCallBudget(accounted, budget);
      await assert.rejects(() => generateOfficialCharacterBible({ ...adultArgs(guarded), npcRelationRepair: true }));
      assert.deepEqual(inner.tasks, ["character_bible_1", "character_bible_voice"]);
      assert.equal(report.successfulCompletions, 2);
      assert.equal(report.physicalAttempts, 2);
      assert.equal(budget.used, 2);
      assert.deepEqual(
        report.lines.map((line) => `${line.task}:${line.outcome}`),
        ["character_bible_1:success", "character_bible_voice:success"]
      );
    });

    it("a doomed sparse Voice does not spend the paid NPC relation repair call", async () => {
      const broken = voiceWithNpcRelation("");
      const { transport, tasks } = recordingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: { ...sparseVoice(), npcs: broken.npcs },
        character_npc_relation: { npcs: [{ index: 0, relationToChar: "카엘과 5년째 함께함" }] },
        character_bible_bonds: adultBondsWithSfwFlag(),
      });
      await assert.rejects(
        () => generateOfficialCharacterBible({ ...adultArgs(transport), npcRelationRepair: true }),
        (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "author_voice_rejected"
      );
      assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice"]);
    });

    it("Voice defects the existing Voice QA revision can repair still reach Bonds", async () => {
      const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const { greeting: _greeting, ...withoutGreeting } = voice;
      const repairableVoice = {
        ...withoutGreeting,
        publicProfile: { ...(voice.publicProfile as Record<string, unknown>), tags: [] },
      };
      const { transport, tasks } = recordingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: repairableVoice,
        character_bible_bonds: bonds,
      });
      const { bible } = await generateOfficialCharacterBible(generationArgs(transport));
      assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice", "character_bible_bonds"]);
      assert.deepEqual(codesOf(validatePilotBible(bible, { adultExpected: false })).sort(), ["bible_greeting_missing", "bible_tags"]);
    });

    it("the structure gate reuses the canonical bible QA codes for rule count and tagline", async () => {
      const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      const cases: Array<{ label: string; mutate: Record<string, unknown>; code: string }> = [
        { label: "rules over band", mutate: { behaviorRules: ["a", "b", "c", "d", "e", "f", "g", "h"] }, code: "bible_behavior_rules" },
        { label: "rules under band", mutate: { behaviorRules: ["a", "b"] }, code: "bible_behavior_rules" },
        {
          label: "tagline over limit",
          mutate: { publicProfile: { ...(voice.publicProfile as Record<string, unknown>), tagline: "가".repeat(51) } },
          code: "bible_tagline_limit",
        },
      ];
      for (const { label, mutate, code } of cases) {
        const mutated = { ...voice, ...mutate };
        const { transport, tasks } = recordingTransport({
          character_bible_1: fakeHalf1(),
          character_bible_voice: mutated,
          character_bible_bonds: bonds,
        });
        await assert.rejects(
          () => generateOfficialCharacterBible(generationArgs(transport)),
          (error: unknown) => error instanceof OfficialSupplyGateError && error.code === "author_voice_rejected" && error.message.includes(code),
          label
        );
        assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice"], label);
        const full = assembleOfficialCharacterBible(fakeHalf1(), mutated, bonds);
        assert.ok(codesOf(validatePilotBible(full, { adultExpected: false })).includes(code), label);
      }
    });

    it("malformed or failing Voice responses stop before Bonds", async () => {
      const [, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
      for (const voice of ["not json at all", "[]", '"text"']) {
        const { transport, tasks } = recordingTransport({
          character_bible_1: fakeHalf1(),
          character_bible_voice: voice,
          character_bible_bonds: bonds,
        });
        await assert.rejects(() => generateOfficialCharacterBible(generationArgs(transport)), voice);
        assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice"], voice);
      }
      const tasks: string[] = [];
      const failing: OfficialAuthorTransport = {
        label: "fake-provider-failure",
        async completeJson(input) {
          tasks.push(input.task);
          if (input.task === "character_bible_voice") throw new Error("CheaperInference 503: upstream unavailable");
          return fakeCompletion(JSON.stringify(fakeHalf1()));
        },
      };
      await assert.rejects(() => generateOfficialCharacterBible(generationArgs(failing)), /503/);
      assert.deepEqual(tasks, ["character_bible_1", "character_bible_voice"]);
    });

    it("adult, age and consent QA stay enforced after the template change", async () => {
      const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw: true }));
      const badConsent = {
        ...bonds,
        adultSection: { ...(bonds.adultSection as Record<string, unknown>), consentModes: ["anything_goes"] },
      };
      const { transport } = recordingTransport({
        character_bible_1: fakeHalf1(),
        character_bible_voice: voice,
        character_bible_bonds: badConsent,
      });
      const { bible } = await generateOfficialCharacterBible(adultArgs(transport));
      assert.ok(codesOf(validatePilotBible(bible, { adultExpected: true })).includes("bible_adult_consent"));
      const minor = fakeBible(true, 17);
      assert.ok(codesOf(validatePilotBible(minor, { adultExpected: true })).includes("bible_identity_age"));
      const noSection = assembleOfficialCharacterBible(fakeHalf1(), voice, { ...bonds, adultSection: null });
      assert.ok(codesOf(validatePilotBible(noSection, { adultExpected: true })).includes("bible_adult_missing"));
    });
  });

  it("prompt standard is stamped by canonical code even when provider Part1 omits it", async () => {
    const half1 = fakeHalf1();
    assert.equal("promptStandard" in half1, false);
    const [voice, bonds] = splitHalf2(fakeHalf2({ nsfw: false }));
    const { bible } = await generateOfficialCharacterBible({
      transport: fakeTransport({
        character_bible_1: half1,
        character_bible_voice: voice,
        character_bible_bonds: bonds,
      }),
      part1: {
        brief: {
          slot: 1,
          name: "카엘",
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
          adultCandidate: false,
          speechDirection: "단호",
          audience: "female",
        },
        worldName: "테스트",
        worldContext: "맥락",
        siblingSketches: [],
      },
      voice: { name: "카엘", age: 27, adultCandidate: false, speechDirection: "단호", npcDemand: "없음" },
      bonds: { name: "카엘", age: 27, rpHook: "순찰", adultCandidate: false, castList: [] },
    });
    assert.equal(bible.promptStandard, "compact_rp_v1");
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
      board: { genre: "로맨스 판타지", styleKey: "romance_fantasy_v1", allowedReferenceUrls: [], candidateCount: 3 },
    });
    assert.equal(ok.candidates.length, 3);
    const bad = fakeTransport({ style_board: { candidates: ["only"].map(testStyleCandidate) } });
    await assert.rejects(
      generateOfficialStyleBoard({ transport: bad, board: { genre: "로맨스 판타지", styleKey: "romance_fantasy_v1", allowedReferenceUrls: [], candidateCount: 1 } }),
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
