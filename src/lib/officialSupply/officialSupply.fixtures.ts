import type { OfficialPortfolioPolicy } from "@/lib/officialSupply/research";
import type { OfficialSupplyBatchConfig } from "@/lib/officialSupply/store";
import type {
  OfficialAppearanceLock,
  OfficialAssetPlan,
  OfficialAssetSlotPlan,
  OfficialCharacterDraft,
  OfficialSupportingNpc,
  VisualStyleCandidate,
} from "@/lib/officialSupply/types";

/** Deterministic prose of roughly `length` chars built from character-specific vocabulary. */
export function prose(vocabulary: readonly string[], length: number): string {
  const out: string[] = [];
  let i = 0;
  let size = 0;
  while (size < length) {
    const a = vocabulary[i % vocabulary.length]!;
    const b = vocabulary[(i * 7 + 3) % vocabulary.length]!;
    const c = vocabulary[(i * 11 + 5) % vocabulary.length]!;
    const sentence = `${a} ${b}${i % 3 === 0 ? "과" : "와"} ${c}${i % 2 ? "을 떠올린다." : "에 대해 말한다."}`;
    out.push(sentence);
    size += sentence.length + 1;
    i += 1;
  }
  return out.join(" ").slice(0, length);
}

const WORLD_VOCAB = ["황도", "에르셀", "성벽", "마력석", "궁정", "원로원", "북부 전선", "은빛 강", "제국력", "봉인의 탑", "상단", "기사단"];

export const DEFAULT_TEST_PORTFOLIO: OfficialPortfolioPolicy = {
  adultShareMin: 0,
  adultShareMax: 1,
  maxGenreShare: 1,
  minDistinctGenres: 1,
};

export function testBatchConfig(overrides: Partial<OfficialSupplyBatchConfig> = {}): OfficialSupplyBatchConfig {
  return {
    rollout: { maxWorlds: 5, maxCharacters: 50 },
    budgetUsd: { batch: 100 },
    reservePerImageUsd: 0.25,
    maxAttemptsPerSlot: 3,
    leaseMs: 60_000,
    quality: "medium",
    portfolio: DEFAULT_TEST_PORTFOLIO,
    ...overrides,
  };
}

export function testStyleCandidate(candidateId: string): VisualStyleCandidate {
  return {
    candidateId,
    label: `웹툰 세미리얼 ${candidateId}`,
    dna: {
      faceProportion: "갸름한 성인 비율",
      eyeShape: "가늘고 긴 눈매",
      noseMouthDetail: "절제된 코·입 묘사",
      lineDensity: "medium",
      rendering: "semi_realistic",
      skinRendering: "부드러운 그라데이션",
      hairRendering: "굵은 가닥 하이라이트",
      bodyProportion: "8등신 성인",
      costumeComplexity: "high",
      palette: "차가운 남색·금색",
      lightSoftness: "soft",
      contrast: "medium",
      backgroundDensity: "medium",
      framing: "상반신 중심",
      atmosphere: "우아하고 긴장감 있는",
    },
    suitability: {
      card: 5,
      rpLandscape: 4,
      maleCharacters: 5,
      femaleCharacters: 4,
      backgroundScene: 4,
      romanticScene: 5,
      tenseRelationshipScene: 4,
      indoorBedroomScene: 4,
      outfitVariation: 4,
      emotionRange: 4,
      identityConsistencyDifficulty: "medium",
    },
    strengths: ["카드 인지성", "감정 표현"],
    references: [{ url: "https://example.com/public-trend", provenance: "external_public_observation", note: "trend board" }],
  };
}

export type TestDraftOptions = {
  draftKey: string;
  name: string;
  vocabulary: readonly string[];
  age?: number;
  gender?: OfficialCharacterDraft["gender"];
  nsfw?: boolean;
  npcs?: OfficialSupportingNpc[];
  hook?: Partial<OfficialCharacterDraft["hook"]>;
  worldKey?: string;
  styleKey?: string;
  greeting?: string;
};

export function testNpc(name: string, age: number | null, adultEligible = false): OfficialSupportingNpc {
  return {
    name,
    age,
    heightCm: 184,
    appearance: "흑발/회안",
    personalityKeywords: ["냉정", "충성"],
    role: "직속 보좌관",
    relationToChar: "{{char}}와 8년째 함께 일함",
    speech: "존댓말",
    adultEligible,
  };
}

export function testDraft(opts: TestDraftOptions): OfficialCharacterDraft {
  const age = opts.age ?? 27;
  const npcs = opts.npcs ?? [];
  return {
    draftKey: opts.draftKey,
    worldKey: opts.worldKey ?? "world-ercel",
    styleKey: opts.styleKey ?? "romance_fantasy_v1",
    name: opts.name,
    tagline: `${opts.name}의 궁정 비화`,
    description: `${opts.name}은 제국 궁정의 인물이다.`,
    greeting: opts.greeting ?? prose(opts.vocabulary, 180),
    gender: opts.gender ?? "male",
    age,
    genres: ["로맨스 판타지"],
    tags: ["궁정", "로맨스"],
    audience: "female",
    sections: {
      worldAndSituation: prose(WORLD_VOCAB, 1800),
      characterCore: `${opts.name}, ${age}세. ${prose(opts.vocabulary, 2800)}`,
      relationshipsAndDrives: prose([...opts.vocabulary].reverse(), 800),
      extraCanon: prose(opts.vocabulary.slice(0, 5), 300),
    },
    speech: {
      personality: prose(opts.vocabulary.slice(2), 350),
      traits: prose(opts.vocabulary.slice(1), 300),
      examples: "\"물러서지 마십시오.\"",
      forbidden: "",
    },
    supportingNpcs: npcs,
    hook: {
      archetype: opts.hook?.archetype ?? "냉혈 황태자",
      relationshipTrope: opts.hook?.relationshipTrope ?? "계약 약혼",
      occupation: opts.hook?.occupation ?? "황태자",
      rpHook: opts.hook?.rpHook ?? "파혼 직전의 약혼식",
    },
    secrets: ["선황의 사생아", "봉인의 탑 열쇠"],
    adult: opts.nsfw
      ? {
          nsfw: true,
          participantMinAge: Math.min(age, ...npcs.filter((n) => n.adultEligible && n.age != null).map((n) => n.age!)),
          adultDialogueProfile: "explicit_rare",
          adultConsentModesAllowed: ["standard", "power_play"],
          orientation: "HL 이성애",
          adultHookSummary: "통제와 신뢰 사이의 긴장이 성인 관계로 이어진다. 합의된 주도권 역전을 즐긴다.",
        }
      : { nsfw: false },
  };
}

export const HWANG_VOCAB = ["황태자", "레온하르트", "검은 망토", "금빛 문장", "냉정한 시선", "정략", "왕좌", "침묵", "검술", "서재", "달빛", "맹세"];
export const KNIGHT_VOCAB = ["기사단장", "세라핀", "은갑옷", "붉은 깃발", "훈련장", "충성", "상처", "군마", "새벽 순찰", "방패", "형제애", "진흙"];
export const MAGE_VOCAB = ["궁정 마법사", "이안", "별자리", "잉크", "연구실", "금서", "호기심", "푸른 불꽃", "천문대", "안경", "주문서", "고양이"];

export function testAppearance(overrides: Partial<OfficialAppearanceLock["identity"]> = {}): OfficialAppearanceLock {
  return {
    identity: {
      apparentAgeBand: "late_20s",
      faceShape: "날렵한 턱선",
      eyes: "가늘고 긴 눈매",
      eyeColor: "금안",
      hair: "옆으로 넘긴 직모",
      hairColor: "흑발",
      hairLength: "목덜미 길이",
      heightCm: 187,
      build: "탄탄한 장신",
      skinTone: "밝은 피부",
      identifyingFeatures: ["왼쪽 눈 밑 점"],
      ...overrides,
    },
    outfit: {
      defaultOutfit: "검은 황태자 예복과 금빛 견장",
      alternateOutfitPolicy: "침실은 실내복, 무도회는 연회복 — 얼굴·머리·체형 유지",
    },
    forbiddenDrift: ["머리색 변경 금지", "눈 밑 점 유지"],
  };
}

function slot(partial: Partial<OfficialAssetSlotPlan> & Pick<OfficialAssetSlotPlan, "slotKey" | "kind" | "tag">): OfficialAssetSlotPlan {
  return {
    expression: partial.tag,
    pose: "",
    outfit: "default",
    location: null,
    situation: null,
    characterPresence: "required",
    imageSubjects: {
      foreground: "solo_character",
      backgroundExtras: partial.kind === "scene" ? "optional_unnamed" : "none",
    },
    depiction: "standard",
    personTag: null,
    ...partial,
  };
}

export function testAssetPlan(opts: { adultScene?: boolean } = {}): OfficialAssetPlan {
  return {
    slots: [
      slot({ slotKey: "rep", kind: "representative", tag: "대표", expression: "차갑게 내려다보는 시선" }),
      slot({ slotKey: "sig1", kind: "signature", tag: "무표정", personTag: "무표정" }),
      slot({ slotKey: "sig2", kind: "signature", tag: "비웃음", expression: "희미한 비웃음" }),
      slot({ slotKey: "sig3", kind: "signature", tag: "지루함", expression: "지루한 시선" }),
      slot({ slotKey: "sig4", kind: "signature", tag: "진지함", personTag: "진지함" }),
      slot({ slotKey: "emo1", kind: "emotion", tag: "부끄러움", personTag: "부끄러움" }),
      slot({ slotKey: "emo2", kind: "emotion", tag: "부끄러움", expression: "귀까지 붉어진 채 시선을 피함", personTag: "부끄러움" }),
      slot({ slotKey: "emo3", kind: "emotion", tag: "질투", expression: "질투 섞인 짜증" }),
      slot({ slotKey: "emo4", kind: "emotion", tag: "상처", expression: "상처받은 표정" }),
      slot({ slotKey: "emo5", kind: "emotion", tag: "분노", personTag: "분노" }),
      slot({ slotKey: "emo6", kind: "emotion", tag: "유혹", personTag: "유혹" }),
      slot({ slotKey: "scene1", kind: "scene", tag: "무도회장", location: "황궁 무도회장", situation: "연회복 차림으로 손을 내민다", outfit: "연회복" }),
      slot({
        slotKey: "scene2",
        kind: "scene",
        tag: "침실",
        location: "황궁 침실",
        situation: "실내복 차림으로 창가에 기대 있다",
        outfit: "실내복",
        depiction: opts.adultScene ? "adult_grounded_non_explicit" : "standard",
      }),
      slot({ slotKey: "scene3", kind: "scene", tag: "정원회랑", location: "달빛 정원 회랑", situation: "회랑을 걷다 뒤돌아본다" }),
    ],
  };
}

/** Hand-written, non-repetitive prose that satisfies OFFICIAL_AUTHOR_QUALITY_CONTRACT. */
export const CONTRACT_GREETING = `성문 위 횃불이 비에 젖어 낮게 흔들렸다. 카엘은 망루 계단 끝에 서서 젖은 장갑을 벗지 않은 채 당신을 내려다보았다. 순찰 교대가 끝난 지 한 시각, 이 시간에 성벽 위로 올라올 수 있는 사람은 손에 꼽혔다. 그는 허리의 검에 손을 얹지도, 거두지도 않았다. 다만 당신의 발밑에 떨어진 봉인 조각을 한 번 보고, 다시 당신의 얼굴을 보았다.
“이 시각에 여기 계신 이유부터 듣겠습니다. 짧게.”
목소리는 낮고 고르게 가라앉아 있었다. 멀리서 교대 종이 한 번 울렸고, 그는 그 소리가 끝날 때까지 기다렸다. 비에 젖은 망토 자락이 돌바닥에 닿아 무겁게 끌렸다. 망루 아래 안뜰에서는 말 한 마리가 불안하게 발굽을 굴렀다. 성벽 틈으로 새어 든 바람이 횃불을 한 차례 눕혔다가 다시 세웠다.
“봉인은 제 것이 아닙니다. 당신 것도 아니라면, 누군가 우리 둘을 여기로 부른 셈이지요.”
카엘은 한 걸음 옆으로 비켜서 계단 쪽 퇴로를 열어 두었다. 도망칠 길을 남겨 둔 것인지, 달아나는 방향을 보려는 것인지는 알 수 없었다. 그의 시선은 당신의 손과 계단과 성벽 바깥 어둠을 차례로 훑고 돌아왔다. 젖은 머리칼 끝에서 물방울이 떨어져 갑옷 목깃에 번졌지만 그는 닦지 않았다.
“선택하십시오. 봉인을 제게 넘기고 내려가시든지, 함께 이걸 보낸 자를 찾으시든지.”
빗소리가 조금 더 굵어졌다. 그는 대답을 재촉하지 않았고, 봉인 조각을 향한 시선도 거두지 않았다.`;
export const CONTRACT_PITCH = `카엘은 황궁 근위 기사단을 이끄는 스물일곱의 단장이다. 명령 체계와 절차를 먼저 따지지만, 눈앞의 사람이 위험해지면 규칙보다 몸이 먼저 움직인다. 당신은 그가 경계하는 협력자로 시작해, 순찰과 보고를 함께 견디며 그가 처음으로 등을 맡기는 사람이 될 수도 있다. 원로원의 해체 압력 속에서 그의 충성이 누구를 향하는지, 그 답을 당신이 곁에서 함께 정하게 된다.`;
export const CONTRACT_SPEECH = `카엘은 격식체 존댓말을 끝까지 유지한다. 문장은 짧고 결론이 먼저 나오며, 설명은 상대가 되물을 때만 덧붙인다. 군사 용어와 보고서식 표현을 즐겨 쓰고, 감정이 실린 형용사는 거의 쓰지 않는다. 농담은 건조한 한 마디로 끝나서 상대가 웃어야 할지 망설이게 만든다. 화가 나면 목소리가 높아지는 대신 더 느려지고 낮아진다. 가까워진 사람에게는 직책 대신 이름을 부르기 시작하는데, 그 변화가 그에게는 고백에 가깝다. 걱정할 때는 질문이 늘어나고, 대답을 들을 때까지 자리를 뜨지 않는다.`;
