import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  OFFICIAL_AUTHOR_QUALITY_CONTRACT,
  buildAssetPlanUser,
  buildCharacterVoiceSystem,
} from "@/lib/officialSupply/authorPrompts";
import {
  OfficialAuthorTruncatedError,
  createAuthorCostReport,
  generateOfficialCharacterBible,
  recordWorkflowRetry,
  reviseOfficialAdultProfile,
  reviseOfficialCharacterVoice,
  withAuthorAccounting,
  type OfficialAuthorRawCompletion,
  type OfficialAuthorTransport,
} from "@/lib/officialSupply/author";
import {
  evaluateAdultPortfolioDiversity,
  evaluateAuthorQualityContract,
  isFillerProse,
  type OfficialCharacterBible,
  type WorldLocation,
} from "@/lib/officialSupply/bible";
import { clearQuarantine, listActiveQuarantines, writeQuarantine } from "@/lib/officialSupply/pilotArtifacts";
import {
  evaluateSceneCandidateAgainstPortfolio,
  evaluateScenePortfolioDiversity,
  extractSceneMotifs,
  resolveOfficialCharacterSceneContext,
  type OfficialCharacterSceneContext,
  type ScenePortfolioEntry,
} from "@/lib/officialSupply/scenePortfolio";
import { CONTRACT_GREETING, CONTRACT_PITCH, CONTRACT_SPEECH } from "@/lib/officialSupply/officialSupply.fixtures";
import type { OfficialAssetPlan, OfficialAssetSlotPlan } from "@/lib/officialSupply/types";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const LOCATIONS: WorldLocation[] = [
  { name: "솔라리스 유리온실", purpose: "황실 외교 접견", mood: "고요", users: "황족, 근위대장", rpEvents: "밀담" },
  { name: "검은 방벽 흑철 요새", purpose: "북부 방어 사령부", mood: "혹한", users: "방벽 수병, 군벌", rpEvents: "보급" },
  { name: "황금 증권거래소 지하 암시장", purpose: "채권과 밀거래", mood: "소란", users: "거상, 브로커", rpEvents: "경매" },
  { name: "심연의 아카이브", purpose: "금서 보관과 연구", mood: "적막", users: "학술원 석학, 수사관", rpEvents: "금서" },
  { name: "하수도 가스 밸브 구역", purpose: "슬럼 거주지", mood: "눅눅", users: "하층민, 암살자", rpEvents: "잠입" },
  { name: "빛의 회랑 대신전", purpose: "예배와 축복식", mood: "성스러움", users: "신관, 참배객", rpEvents: "의식" },
];

function contextFor(
  draftKey: string,
  primary: string,
  anchors: string[],
  others: "secondary" | "exceptional" = "exceptional"
): OfficialCharacterSceneContext {
  return {
    name: draftKey,
    occupation: anchors[0] ?? "",
    faction: anchors[1] ?? "",
    socialPosition: "",
    ranked: LOCATIONS.map((l) => ({
      name: l.name,
      tier: l.name === primary ? ("primary" as const) : others,
      score: l.name === primary ? 10 : 0,
      why: [],
      rpEvents: l.rpEvents,
    })),
    hooks: {
      immediateHook: "",
      repeatable: [],
      mediumConflict: "",
      longTermChange: "",
      personalSituation: "",
      backstoryResidue: [],
      userInitialView: "",
      relationshipCues: [],
    },
    anchors,
  };
}

function scene(slotKey: string, location: string, situation: string): OfficialAssetSlotPlan {
  return {
    slotKey,
    kind: "scene",
    tag: slotKey,
    expression: "",
    pose: "",
    outfit: "default",
    location,
    situation,
    characterPresence: "required",
    depiction: "standard",
    personTag: null,
  };
}

function entry(
  draftKey: string,
  scenes: Array<[string, string]>,
  context = contextFor(draftKey, LOCATIONS[0]!.name, [], "secondary")
): ScenePortfolioEntry {
  const plan: OfficialAssetPlan = { slots: scenes.map(([loc, sit], i) => scene(`scene${i + 1}`, loc, sit)) };
  return { draftKey, name: draftKey, plan, context };
}

// ── Scene portfolio ──────────────────────────────────────────────────────────

describe("scene portfolio diversity (canonical owner)", () => {
  it("fails the observed collapse: 유리온실 + 정략결혼 repeated across the world", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry(`c${i}`, [
        ["솔라리스 유리온실", `정략결혼 제안서 속 배신 증거를 두고 밀담한다 ${i}`],
        ["하수도 가스 밸브 구역", `잠입 중 서로 다른 출구를 고른다 ${i}`],
        ["빛의 회랑 대신전", `의식 준비 ${i}`],
      ])
    );
    const qa = evaluateScenePortfolioDiversity(entries, LOCATIONS);
    assert.equal(qa.ok, false);
    assert.ok(qa.errors.some((e) => e.code === "scene_location_motif_clone" && e.message.includes("정략")));
  });

  it("catches paraphrased clones: 방벽 + 체온 + 반역 in different wording", () => {
    const wordings = [
      "눈보라 요새에서 체온을 나누다 반역 증거를 발견한다",
      "보급 끊긴 방벽에서 서로 몸을 녹이다 반역 문서를 찾는다",
      "흑철 요새 초소에서 온기를 맞대고 모반 밀서를 읽는다",
      "검은 방벽 위 불 꺼진 막사에서 몸을 녹이며 내통 흔적을 캔다",
    ];
    const entries = wordings.map((w, i) =>
      entry(`c${i}`, [
        ["검은 방벽 흑철 요새", w],
        ["심연의 아카이브", `연구 기록 ${i}`],
        ["빛의 회랑 대신전", `축복식 ${i}`],
      ])
    );
    const motifs = wordings.map((w) => extractSceneMotifs(w));
    for (const m of motifs) assert.ok(m.includes("warmth") && m.includes("betrayal"), JSON.stringify(motifs));
    const qa = evaluateScenePortfolioDiversity(entries, LOCATIONS);
    assert.ok(qa.stats.clonePairs.length >= 6, `pairs ${qa.stats.clonePairs.length}`);
    assert.ok(qa.errors.some((e) => e.code === "scene_location_motif_clone"));
  });

  it("allows the same world location used for genuinely different incidents", () => {
    const palace = "솔라리스 유리온실";
    const entries = [
      entry("a", [[palace, "무도회가 끝난 뒤 가면 살롱의 잔을 치운다"], ["심연의 아카이브", "금서 해독"], ["하수도 가스 밸브 구역", "밸브 정비"]]),
      entry("b", [[palace, "암살자를 추격해 온실 지붕에서 저지한다"], ["황금 증권거래소 지하 암시장", "채권 흥정"], ["빛의 회랑 대신전", "기도"]]),
      entry("c", [[palace, "상처 입은 근위병을 응급 치료한다"], ["검은 방벽 흑철 요새", "사격 훈련"], ["하수도 가스 밸브 구역", "도주로 탐색"]]),
      entry("d", [[palace, "코어 부품을 분해해 수리한다"], ["빛의 회랑 대신전", "대신전 계단에서 결투 신청을 받는다"], ["심연의 아카이브", "관측"]]),
    ];
    const qa = evaluateScenePortfolioDiversity(entries, LOCATIONS);
    assert.deepEqual(qa.errors.filter((e) => e.code !== "scene_location_concentration"), []);
    assert.equal(qa.stats.clonePairs.length, 0);
  });

  it("rejects characters whose scenes are unrelated to their occupation/faction/places", () => {
    const merchant = contextFor("merchant", "황금 증권거래소 지하 암시장", ["브로커", "길드"]);
    const qa = evaluateScenePortfolioDiversity(
      [
        entry(
          "merchant",
          [
            ["빛의 회랑 대신전", "성가대의 축복식을 돕는다"],
            ["검은 방벽 흑철 요새", "사격 훈련을 참관한다"],
            ["황금 증권거래소 지하 암시장", "채권을 흥정한다"],
          ],
          merchant
        ),
      ],
      LOCATIONS
    );
    assert.ok(qa.errors.some((e) => e.code === "scene_off_character"));
  });

  it("candidate gate rejects a sibling clone and passes a distinct plan", () => {
    const planned = [entry("a", [["검은 방벽 흑철 요새", "보급이 끊긴 밤 체온을 나눈다"]])];
    const clone = entry("b", [["검은 방벽 흑철 요새", "배급이 끊겨 서로 몸을 녹인다"]]);
    const distinct = entry("c", [["검은 방벽 흑철 요새", "결투처럼 사격 훈련을 겨룬다"]]);
    assert.ok(evaluateSceneCandidateAgainstPortfolio(clone, planned, LOCATIONS).errors.some((e) => e.code === "scene_clone_of_sibling"));
    assert.equal(evaluateSceneCandidateAgainstPortfolio(distinct, planned, LOCATIONS).ok, true);
  });

  it("home ground: a shared PRIMARY belongs to the character with ≥1.5× the claim", () => {
    const temple = "빛의 회랑 대신전";
    const scored = (key: string, score: number) => {
      const c = contextFor(key, temple, ["신관"]);
      return { ...c, ranked: c.ranked.map((r) => (r.name === temple ? { ...r, score } : r)) };
    };
    const knight = entry("knight", [[temple, "축복식 도중 금지된 인장을 발견한다"]], scored("knight", 27));
    const priestess = entry("priestess", [[temple, "새벽 기도 중 성가가 끊긴다"]], scored("priestess", 49));
    const owner = evaluateSceneCandidateAgainstPortfolio(priestess, [knight], LOCATIONS);
    assert.ok(owner.ok && owner.warnings.some((w) => w.code === "scene_clone_of_sibling"));
    const visitor = evaluateSceneCandidateAgainstPortfolio(knight, [priestess], LOCATIONS);
    assert.ok(visitor.errors.some((e) => e.code === "scene_clone_of_sibling" && e.message.includes("주 무대")));
    const tie = evaluateSceneCandidateAgainstPortfolio(entry("p2", [[temple, "기도"]], scored("p2", 30)), [knight], LOCATIONS);
    assert.ok(tie.errors.some((e) => e.code === "scene_clone_of_sibling"));
  });

  it("negated clauses do not count as the scene's incident; 의식을 잃다 is not a ritual", () => {
    assert.deepEqual(extractSceneMotifs("거래나 추격이 아니라 폐기 명령의 책임을 밝힌다"), []);
    assert.deepEqual(extractSceneMotifs("경매장에서 채권을 흥정한다"), ["deal"]);
    assert.deepEqual(extractSceneMotifs("복도에서 의식을 잃고 쓰러진다"), []);
    assert.deepEqual(extractSceneMotifs("제단 앞 축복 의식"), ["ritual"]);
  });

  it("a diverse 10×3 portfolio stays under the clone-rate ceiling", () => {
    const incidents = ["밀담", "경매 흥정", "금서 해독", "밸브 정비", "기도", "결투 훈련", "응급 치료", "무도회", "도주", "심문"];
    const entries = incidents.map((inc, i) =>
      entry(`c${i}`, [
        [LOCATIONS[i % 6]!.name, inc],
        [`c${i} 개인 작업실`, incidents[(i + 3) % 10]!],
        [`c${i} 단골 찻집`, incidents[(i + 5) % 10]!],
      ])
    );
    const qa = evaluateScenePortfolioDiversity(entries, LOCATIONS);
    assert.ok(qa.stats.cloneRate <= 0.25, `clone rate ${qa.stats.cloneRate}`);
    assert.equal(qa.errors.filter((e) => e.code === "scene_location_motif_clone").length, 0);
  });

  it("scene context ranks the character's own domain first (not the same world order for everyone)", () => {
    const bible = (occupation: string, affiliation: string): OfficialCharacterBible =>
      ({
        identity: { occupation, socialPosition: "", affiliation, worldRole: "" },
        situation: { personalSituation: "", worldContext: "", userEntry: "" },
        rpEngine: { immediateHook: "", repeatable: [], mediumConflict: "", longTermChange: "" },
        dailyLife: "",
        backstory: { events: [] },
        userRelationship: { initialView: "", userRole: "", startingPoint: "", progression: [] },
        otherRelationships: [],
      }) as unknown as OfficialCharacterBible;
    const world = { locations: LOCATIONS };
    const broker = resolveOfficialCharacterSceneContext({
      world,
      bible: bible("암시장 브로커", "거상 길드"),
      brief: { faction: "길드", occupation: "브로커", socialPosition: "", rpHook: "채권 경매" },
    });
    const priest = resolveOfficialCharacterSceneContext({
      world,
      bible: bible("대신전 신관", "신관단"),
      brief: { faction: "대신전", occupation: "신관", socialPosition: "", rpHook: "축복식 의식" },
    });
    assert.equal(broker.ranked[0]!.name, "황금 증권거래소 지하 암시장");
    assert.equal(broker.ranked[0]!.tier, "primary");
    assert.equal(priest.ranked[0]!.name, "빛의 회랑 대신전");
    const prompt = buildAssetPlanUser({
      name: "브로커",
      adult: false,
      defaultOutfit: "정장",
      scene: broker,
      avoid: { combos: ["솔라리스 유리온실 × 정략·혼담"], overusedMotifs: ["배신·반역·공모"] },
    });
    assert.match(prompt, /PRIMARY 장소:\n- 황금 증권거래소/);
    assert.match(prompt, /피해야 할 조합/);
    assert.match(prompt, /과다 사용 사건/);
  });
});

// ── Author quality contract ──────────────────────────────────────────────────

function voiceBible(patch: Partial<Pick<OfficialCharacterBible, "greeting">> & {
  speech?: Partial<OfficialCharacterBible["speech"]>;
  pitch?: string;
} = {}): Pick<OfficialCharacterBible, "greeting" | "speech" | "publicProfile"> {
  return {
    greeting: patch.greeting ?? CONTRACT_GREETING,
    speech: {
      register: "격식체",
      sentenceLength: "짧음",
      tempo: "느림",
      vocabulary: "군사 용어",
      frequentPhrases: [],
      rarePhrases: [],
      profanity: "없음",
      humorStyle: "건조함",
      addressStyle: "직책",
      hiddenEmotionStyle: "짧아짐",
      angryStyle: "낮아짐",
      intimateStyle: "이름을 부름",
      keywords: ["격식", "절제", "단호", "신중"],
      description: CONTRACT_SPEECH,
      examples: "a\nb\nc\nd",
      forbidden: "",
      ...patch.speech,
    },
    publicProfile: { tagline: "t", description: patch.pitch ?? CONTRACT_PITCH, tags: ["a", "b", "c"] },
  };
}

describe("author quality contract (prompt == QA)", () => {
  const C = OFFICIAL_AUTHOR_QUALITY_CONTRACT;

  it("voice prompt states exactly the validator bands", () => {
    const system = buildCharacterVoiceSystem();
    assert.ok(system.includes(`${C.greeting.min}자 이상 ${C.greeting.max}자 이하`));
    assert.ok(system.includes(`${C.speechDescription.min}자 이상 ${C.speechDescription.max}자 이하`));
    assert.ok(system.includes(`${C.publicDescription.min}자 이상 ${C.publicDescription.max}자 이하`));
    for (const stale of ["900자 이상", "400자 이상 600자", "300자 이상 500자"]) assert.ok(!system.includes(stale), stale);
  });

  it("complete contract prose passes", () => {
    assert.deepEqual(evaluateAuthorQualityContract(voiceBible()).errors, []);
  });

  it("greeting under the hard minimum fails; at the minimum passes", () => {
    const short = CONTRACT_GREETING.slice(0, C.greeting.min - 1);
    assert.ok(evaluateAuthorQualityContract(voiceBible({ greeting: short })).errors.some((e) => e.code === "bible_greeting_band"));
    assert.ok(CONTRACT_GREETING.length >= C.greeting.min);
  });

  it("greeting must be an in-scene opening with voice and the user", () => {
    const noUser = CONTRACT_GREETING.replaceAll("당신", "그녀");
    const qa = evaluateAuthorQualityContract(voiceBible({ greeting: noUser }));
    assert.ok(qa.errors.some((e) => e.code === "bible_greeting_no_user"));
    const intro = `나는 카엘이다. ${CONTRACT_GREETING}`;
    assert.ok(evaluateAuthorQualityContract(voiceBible({ greeting: intro })).errors.some((e) => e.code === "bible_greeting_self_intro"));
  });

  it("speech requires structural coverage, not just length", () => {
    const qa = evaluateAuthorQualityContract(voiceBible({ speech: { angryStyle: "", intimateStyle: " " } }));
    assert.ok(qa.errors.some((e) => e.code === "bible_speech_coverage" && /angryStyle/.test(e.message)));
  });

  it("public pitch needs the minimum length and a user-facing promise", () => {
    assert.ok(
      evaluateAuthorQualityContract(voiceBible({ pitch: CONTRACT_PITCH.slice(0, C.publicDescription.min - 1) })).errors.some(
        (e) => e.code === "bible_pitch_band"
      )
    );
    assert.ok(
      evaluateAuthorQualityContract(voiceBible({ pitch: CONTRACT_PITCH.replaceAll("당신", "상대") })).errors.some(
        (e) => e.code === "bible_pitch_no_user"
      )
    );
  });

  it("padding to reach a band never passes", () => {
    const sentence = "“당신은 여기 있어야 합니다.” 그는 말했다. ";
    const padded = sentence.repeat(Math.ceil(C.greeting.min / sentence.length) + 1);
    assert.ok(padded.length >= C.greeting.min);
    assert.equal(isFillerProse(padded), true);
    assert.ok(evaluateAuthorQualityContract(voiceBible({ greeting: padded })).errors.some((e) => e.code === "bible_greeting_filler"));
    assert.equal(isFillerProse(CONTRACT_GREETING), false);
  });
});

// ── Adult portfolio ──────────────────────────────────────────────────────────

function adultBible(name: string, profile: string, keywords: string[]): OfficialCharacterBible {
  return {
    identity: { name },
    nsfw: true,
    adultSection: {
      orientation: "HL",
      hookSummary: "h",
      dialogueProfile: profile,
      consentModes: ["standard"],
      tone: "",
      preferenceKeywords: keywords,
      boundaries: [],
      consentBehavior: "",
      scenarioExamples: [],
    },
  } as unknown as OfficialCharacterBible;
}

describe("adult portfolio diversity (pilot-scoped, no global ratio)", () => {
  it("fails the observed convergence: every sheet on slow trust + restraint", () => {
    const qa = evaluateAdultPortfolioDiversity([
      adultBible("a", "suggestive", ["느린 긴장", "상호 신뢰", "속삭임"]),
      adultBible("b", "suggestive", ["느린 긴장감", "절제된 주도권", "사후 돌봄"]),
      adultBible("c", "suggestive", ["느린 신뢰", "절제된 긴장", "다정한 배려"]),
      adultBible("d", "suggestive", ["느린 진전", "도발적 농담", "돌봄"]),
    ]);
    assert.ok(qa.errors.some((e) => e.code === "adult_dynamic_monoculture"));
  });

  it("valid mixed profiles and distinct dynamics pass", () => {
    const qa = evaluateAdultPortfolioDiversity([
      adultBible("a", "suggestive", ["의례처럼 허락을 구하기", "취약함을 드러내는 의존", "속삭임"]),
      adultBible("b", "explicit_rare", ["협상된 명령·보고 역할극", "짧은 인정", "사후 돌봄"]),
      adultBible("c", "suggestive", ["합의된 보호적 독점욕", "질투를 숨기지 않음"]),
      adultBible("d", "explicit_frequent", ["결투 같은 주도권 다툼", "호탕한 도발과 장난"]),
    ]);
    assert.deepEqual(qa.errors, []);
    assert.deepEqual(qa.warnings, []);
  });

  it("imposes no global profile ratio: uniform profile with distinct dynamics is only a warning", () => {
    const qa = evaluateAdultPortfolioDiversity([
      adultBible("a", "suggestive", ["의례처럼 허락을 구하기"]),
      adultBible("b", "suggestive", ["결투 같은 승부"]),
      adultBible("c", "suggestive", ["합의된 독점욕"]),
    ]);
    assert.equal(qa.ok, true);
    assert.ok(qa.warnings.some((w) => w.code === "adult_profile_uniform"));
  });

  it("adult revision keeps orientation/age and forces the canonical plan enums; SFW sheets are refused", async () => {
    const current = {
      ...adultBible("볼프강", "suggestive", ["느린 긴장감"]),
      identity: { name: "볼프강", age: 34 },
      personality: { keywords: ["규율"] },
      contradiction: "c",
      speech: { keywords: ["군대식"], intimateStyle: "짧음" },
      userRelationship: { progression: ["경계", "신뢰", "동행"] },
    } as unknown as OfficialCharacterBible;
    const transport = fake({
      adult_profile: {
        adultSection: {
          orientation: "바뀐 성향",
          hookSummary: "명령과 보고의 역할극",
          dialogueProfile: "none",
          consentModes: ["cnc_opt_in"],
          tone: "t",
          preferenceKeywords: ["협상된 권력 교환"],
          boundaries: ["중단 신호 즉시 멈춤"],
          consentBehavior: "사전 합의",
          scenarioExamples: ["보고 후 휴식"],
        },
      },
    });
    const plan = { dialogueProfile: "explicit_rare" as const, consentModes: ["standard", "power_play"] as ("standard" | "power_play")[], direction: "d" };
    const { bible } = await reviseOfficialAdultProfile({ transport, bible: current, participantMinAge: 34, plan, siblingDynamics: [] });
    assert.equal(bible.adultSection!.orientation, "HL");
    assert.equal(bible.adultSection!.dialogueProfile, "explicit_rare");
    assert.deepEqual(bible.adultSection!.consentModes, ["standard", "power_play"]);
    assert.equal(bible.identity.age, 34);
    await assert.rejects(
      reviseOfficialAdultProfile({ transport, bible: { ...current, nsfw: false }, participantMinAge: 34, plan, siblingDynamics: [] }),
      /not an adult sheet/
    );
  });
});

// ── Voice revision scope ─────────────────────────────────────────────────────

function fake(responses: Record<string, unknown>, failFirst: string[] = []): OfficialAuthorTransport {
  const pending = [...failFirst];
  return {
    label: "fake",
    async completeJson(input) {
      const idx = pending.indexOf(input.task);
      if (idx >= 0) {
        pending.splice(idx, 1);
        throw new Error("CheaperInference 503: fake provider failure");
      }
      const data = responses[input.task];
      if (data === undefined) throw new Error(`no fake for ${input.task}`);
      const completion: OfficialAuthorRawCompletion = {
        text: JSON.stringify(data),
        model: "fake-model",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.001,
        providerRequestId: null,
      };
      return completion;
    },
  };
}

describe("voice revision copies back only the named fields", () => {
  it("greeting-only revision leaves pitch, tagline, speech, NPCs and part1 untouched", async () => {
    const current = {
      identity: { name: "카엘", age: 27, occupation: "기사단장", socialPosition: "고위 기사", worldRole: "황궁 경호" },
      personality: { behavioral: "b", keywords: [] },
      greeting: "old greeting",
      speech: { description: "old speech", keywords: ["x"] },
      publicProfile: { tagline: "old tagline", description: "old pitch", tags: ["a"] },
      npcs: [{ name: "보좌관", role: "부관", relationToChar: "r" }],
      backstory: { events: [{ event: "e", choice: "c", residue: "r" }] },
    } as unknown as OfficialCharacterBible;
    const transport = fake({
      character_bible_voice: {
        speech: { description: "NEW speech" },
        greeting: "NEW greeting",
        publicProfile: { tagline: "NEW tagline", description: "NEW pitch", tags: ["z"] },
        npcs: [{ name: "새 NPC", role: "새 역할", relationToChar: "x" }],
      },
    });
    const { bible } = await reviseOfficialCharacterVoice({
      transport,
      bible: current,
      voice: { name: "카엘", age: 27, adultCandidate: false, speechDirection: "", npcDemand: "" },
      fields: ["greeting"],
      reasons: ["bible_greeting_band"],
    });
    assert.equal(bible.greeting, "NEW greeting");
    assert.equal(bible.publicProfile.tagline, "old tagline");
    assert.equal(bible.publicProfile.description, "old pitch");
    assert.equal(bible.speech.description, "old speech");
    assert.deepEqual(bible.npcs, current.npcs);
    assert.deepEqual(bible.backstory, current.backstory);
  });
});

// ── Cost / retry provenance ──────────────────────────────────────────────────

describe("physical-attempt cost accounting", () => {
  it("one failed part1 + successful outer retry: no retry double-counting on voice/bonds", async () => {
    const report = createAuthorCostReport();
    const inner = fake(
      {
        character_bible_1: { identity: { name: "카엘", occupation: "o", socialPosition: "s", worldRole: "w" } },
        character_bible_voice: { speech: {}, greeting: "g" },
        character_bible_bonds: { secrets: [] },
      },
      ["character_bible_1"]
    );
    const brief = {
      slot: 1, name: "카엘", gender: "male" as const, age: 27, archetype: "a", relationshipTrope: "t", occupation: "o",
      faction: "f", socialPosition: "s", personalityCore: "p", visualSilhouette: "v", rpHook: "h", adultCandidate: false,
      speechDirection: "d", audience: "female" as const,
    };
    const run = (transport: OfficialAuthorTransport) =>
      generateOfficialCharacterBible({
        transport,
        part1: { brief, worldName: "w", worldContext: "c", siblingSketches: [] },
        voice: { name: "카엘", age: 27, adultCandidate: false, speechDirection: "d", npcDemand: "n" },
        bonds: { name: "카엘", age: 27, rpHook: "h", adultCandidate: false, castList: [] },
      });
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (attempt > 1) recordWorkflowRetry(report);
      try {
        await run(withAuthorAccounting(inner, report, { draftKey: "pilot-rf-01", workflowAttempt: attempt }));
        break;
      } catch {
        // workflow retry
      }
    }
    assert.equal(report.successfulCompletions, 3);
    assert.equal(report.failedProviderAttempts, 1);
    assert.equal(report.physicalAttempts, 4);
    assert.equal(report.workflowRetries, 1);
    assert.deepEqual(
      report.lines.map((l) => `${l.task}@${l.workflowAttempt}:${l.outcome}`),
      [
        "character_bible_1@1:provider_failed",
        "character_bible_1@2:success",
        "character_bible_voice@2:success",
        "character_bible_bonds@2:success",
      ]
    );
    assert.ok(Math.abs(report.billedCostUsd - 0.003) < 1e-9);
  });

  it("a truncated but billed response is a failed physical attempt with its cost kept visible", async () => {
    const report = createAuthorCostReport();
    const truncating: OfficialAuthorTransport = {
      label: "trunc",
      async completeJson(input) {
        throw new OfficialAuthorTruncatedError(input.task, {
          text: "{", model: "m", inputTokens: 10, outputTokens: 9000, costUsd: 0.004, providerRequestId: null,
        });
      },
    };
    const wrapped = withAuthorAccounting(truncating, report, { draftKey: null, workflowAttempt: 1 });
    await assert.rejects(wrapped.completeJson({ task: "world_bible", system: "s", user: "u", schemaName: "x", schema: {} }));
    assert.equal(report.failedProviderAttempts, 1);
    assert.equal(report.successfulCompletions, 0);
    assert.equal(report.lines[0]!.outcome, "truncated");
    assert.equal(report.failedAttemptCostUsd, 0.004);
    assert.equal(report.billedCostUsd, 0.004);
  });

  it("canonical cost owner is unchanged: author never prices or records ledger rows itself", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/author.ts"), "utf8");
    assert.match(source, /callBackgroundMemory\(/);
    assert.doesNotMatch(source, /recordBackgroundProviderCost\(|fetch\(|Pricing|pricePer|costPerToken/);
  });
});

// ── Quarantine lifecycle ─────────────────────────────────────────────────────

describe("quarantine is active status only", () => {
  let dir = "";
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-quarantine-"));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("a failed world step creates an active quarantine; a later success clears it", () => {
    writeQuarantine(dir, "world", new Error("CheaperInference 503"));
    assert.deepEqual(listActiveQuarantines(dir), ["world"]);
    assert.equal(clearQuarantine(dir, "world"), true);
    assert.deepEqual(listActiveQuarantines(dir), []);
    assert.equal(clearQuarantine(dir, "world"), false);
  });
});
