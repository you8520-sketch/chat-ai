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
