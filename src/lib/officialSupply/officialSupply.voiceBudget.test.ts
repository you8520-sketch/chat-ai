import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assembleOfficialCharacterBible } from "@/lib/officialSupply/author";
import {
  buildCharacterVoiceSystem,
  buildCharacterVoiceUser,
  OFFICIAL_AUTHOR_MAX_TOKENS,
  OFFICIAL_AUTHOR_QUALITY_CONTRACT,
} from "@/lib/officialSupply/authorPrompts";
import { validateCharacterBible } from "@/lib/officialSupply/bible";
import { CONTRACT_GREETING, CONTRACT_PITCH, CONTRACT_SPEECH } from "@/lib/officialSupply/officialSupply.fixtures";
import { estimateTokens } from "@/lib/tokenEstimate";

type Tier = "floor" | "typical";
type Fixture = { label: string; adult: boolean; npcCount: 0 | 1 | 2; tier: Tier; voice: Record<string, unknown> };

const GREETING_EXTRA = `
“말씀하시지 않아도 됩니다. 다만 이 성벽 위에서 거짓말은 소용없다는 것만 아십시오.”
그는 장갑 끝으로 봉인 조각을 가리켰다. 당신이 주울지 말지를 기다리는 동안에도 그의 시선은 당신의 손이 아니라 어깨의 움직임을 따라가고 있었다.`;

const SPEECH_EXTRA = ` 낯선 사람 앞에서는 문장 끝을 더 단정하게 맺고, 신뢰하는 사람 앞에서는 같은 문장에서 높임의 무게만 살짝 덜어 낸다. 침묵이 길어지면 먼저 입을 열지 않고 상대의 호흡이 바뀔 때를 기다린다.`;

const PITCH_EXTRA = ` 당신이 밤 순찰 기록을 함께 읽어 주는 유일한 사람이 되는 순간부터, 그는 규칙 뒤에 숨겨 둔 두려움을 조금씩 내보이기 시작한다. 가까워질수록 보고서에는 적히지 않는 대답이 늘어난다.`;

function npcFor(index: number, adult: boolean, tier: Tier): Record<string, unknown> {
  const age = adult ? 31 + index : 30 + index;
  if (tier === "floor") {
    return {
      name: `보좌관${index + 1}`,
      age,
      heightCm: 175,
      appearance: "단정한 차림",
      personalityKeywords: ["성실"],
      role: "부관",
      relationToChar: "카엘과 5년째 함께함",
      speech: "정중한 말투",
      adultEligible: adult,
    };
  }
  return {
    name: index === 0 ? "리안 하르트" : "세드릭 볼",
    age,
    heightCm: 176 + index,
    appearance: "짧은 갈색 머리에 낡은 견장을 단 단정한 군복 차림, 오른손 손등에 오래된 화상 흉터",
    personalityKeywords: ["성실", "눈치 빠름", "입이 무거움"],
    role: index === 0 ? "근위 기사단 부관, 순찰 기록 담당" : "원로원 파견 감찰관",
    relationToChar: index === 0 ? "카엘이 북부 전선에서 데려온 오랜 부하이자 유일하게 농담을 받아 주는 사람" : "카엘의 기사단 해체를 압박하는 감시자",
    speech: "존댓말, 낮은 목소리로 사실부터 보고하고 감정은 한 박자 늦게 드러낸다",
    adultEligible: adult,
  };
}

function buildVoice(adult: boolean, npcCount: 0 | 1 | 2, tier: Tier): Record<string, unknown> {
  const floor = tier === "floor";
  const npcs = Array.from({ length: npcCount }, (_, i) => npcFor(i, adult, tier));
  return {
    speech: {
      register: floor ? "격식체 존댓말" : "격식체 존댓말, 상대와 상황에 따라 높임의 무게만 조절",
      sentenceLength: floor ? "짧고 단호함" : "한 문장 20자 안팎, 결론을 먼저 말하고 이유는 되물을 때만 덧붙임",
      tempo: floor ? "느리고 신중함" : "느리고 낮게 끊어 말하며 중요한 단어 앞에서 한 박자 쉼",
      vocabulary: floor ? "군사 용어" : "군사·행정 용어와 보고서식 표현, 감정 형용사는 거의 쓰지 않음",
      frequentPhrases: floor ? ["명령이십니까", "확인했습니다"] : ["명령이십니까", "확인했습니다", "그 점은 제가 책임지겠습니다"],
      rarePhrases: floor ? ["농담", "잡담"] : ["농담", "잡담", "부탁드립니다"],
      profanity: floor ? "사용하지 않음" : "욕설은 쓰지 않고 분노는 침묵과 짧은 어조로 표현",
      humorStyle: floor ? "건조한 한 마디" : "표정 변화 없이 던지는 건조한 한 마디, 상대가 웃을지 망설이게 함",
      addressStyle: floor ? "직책으로 부름" : "처음엔 직책과 존칭으로 부르고 신뢰가 쌓이면 이름으로 바꿈",
      hiddenEmotionStyle: floor ? "더 짧아짐" : "감정이 클수록 문장이 짧아지고 시선을 피함",
      angryStyle: floor ? "낮고 느려짐" : "목소리를 높이지 않고 더 낮고 느리게 말하며 거리를 좁힘",
      intimateStyle: floor ? "어색하게 부드러워짐" : "어색하게 말끝이 부드러워지고 먼저 이름을 부르기 시작함",
      keywords: floor ? ["단호함", "격식", "절제", "신중"] : ["단호함", "격식", "절제", "신중", "충성", "건조함"],
      description: floor ? CONTRACT_SPEECH : `${CONTRACT_SPEECH}${SPEECH_EXTRA}`,
      examples: floor
        ? "명령이십니까.\n확인했습니다.\n물러서십시오.\n제가 막겠습니다."
        : "명령이십니까. 그렇다면 이유를 먼저 들려주십시오.\n확인했습니다. 보고는 새벽까지 올리겠습니다.\n물러서십시오. 이 선은 제가 넘게 두지 않습니다.\n제가 막겠습니다. 당신은 뒤를 보지 마십시오.\n……그 질문에는 지금 답하지 않겠습니다.",
      forbidden: floor ? "반말과 가벼운 농담" : "반말, 이모티콘식 과장, 상대를 비하하는 표현, 길고 감정적인 독백",
    },
    behaviorRules: floor
      ? ["명령 체계를 먼저 확인한다.", "위급 시 몸으로 막는다.", "사적 감정을 임무에 섞지 않는다."]
      : [
          "명령 체계를 먼저 확인하고 그 안에서 움직인다.",
          "위급하면 규칙보다 몸이 먼저 상대를 막아선다.",
          "사적 감정은 임무가 끝난 뒤에야 꺼낸다.",
          "거짓말을 들으면 반박하지 않고 기록해 둔다.",
          "받은 호의는 반드시 같은 무게로 갚는다.",
        ],
    greeting: floor ? CONTRACT_GREETING : `${CONTRACT_GREETING}${GREETING_EXTRA}`,
    publicProfile: {
      tagline: floor ? "황궁의 방패, 경계 너머의 충성" : "당신에게 등을 맡길지 고민하는 근위 기사단장",
      description: floor ? CONTRACT_PITCH : `${CONTRACT_PITCH}${PITCH_EXTRA}`,
      tags: floor ? ["기사", "궁정", "호위", "충성"] : ["로맨스판타지", "기사단장", "경계에서 신뢰로", "무심한 다정", "궁정 암투"],
    },
    npcs,
    nsfw: adult,
  };
}

function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const tier of ["floor", "typical"] as const) {
    for (const adult of [false, true]) {
      for (const npcCount of [0, 1, 2] as const) {
        out.push({ label: `${tier} ${adult ? "adult" : "SFW"} NPC${npcCount}`, adult, npcCount, tier, voice: buildVoice(adult, npcCount, tier) });
      }
    }
  }
  return out;
}

/** Voice-owned errors from the canonical validator; non-Voice (Part1/Bonds) codes are out of scope here. */
function voiceOwnedErrors(voice: Record<string, unknown>): string[] {
  const half1 = { identity: { name: "카엘", occupation: "기사단장", socialPosition: "고위", worldRole: "수호자" } };
  const bible = assembleOfficialCharacterBible(half1, voice, {});
  const owned = /^(bible_greeting|bible_speech|bible_pitch|bible_tagline|bible_tags|bible_behavior_rules|bible_npc)/;
  return validateCharacterBible(bible, { adultExpected: bible.nsfw })
    .errors.filter((e) => owned.test(e.code))
    .map((e) => `${e.code}:${e.message}`);
}

/** The only total-length cap the Voice prompt can state; null when the prompt states none. */
function statedTotalCap(): number | null {
  const match = /전체 분량은 반드시 (\d+)자 이내/.exec(buildCharacterVoiceSystem());
  return match ? Number(match[1]) : null;
}

const C = OFFICIAL_AUTHOR_QUALITY_CONTRACT;
const BAND_MAX_PROSE = C.greeting.max + C.speechDescription.max + C.publicDescription.max;

describe("Voice output budget feasibility (deterministic, no provider)", () => {
  it("every fixture is a genuinely complete Voice under the canonical QA", () => {
    for (const f of fixtures()) {
      assert.deepEqual(voiceOwnedErrors(f.voice), [], f.label);
    }
  });

  it("records serialized chars and estimated tokens for SFW/adult x NPC 0/1/2", () => {
    const rows = fixtures().map((f) => {
      const compact = JSON.stringify(f.voice);
      return {
        label: f.label,
        compactChars: compact.length,
        prettyChars: JSON.stringify(f.voice, null, 2).length,
        estTokens: estimateTokens(compact),
        statedCap: statedTotalCap(),
      };
    });
    console.table(rows);
    assert.equal(rows.length, 12);
  });

  it("NPC count and adult branch change the size only by the NPC payload", () => {
    const size = (adult: boolean, npcCount: 0 | 1 | 2, tier: Tier) => JSON.stringify(buildVoice(adult, npcCount, tier)).length;
    for (const tier of ["floor", "typical"] as const) {
      assert.ok(size(false, 1, tier) > size(false, 0, tier));
      assert.ok(size(false, 2, tier) > size(false, 1, tier));
      assert.ok(Math.abs(size(true, 1, tier) - size(false, 1, tier)) <= 4, "adult flag/age digits only");
    }
  });

  it("the Voice prompt never asks for less than its own field bands can produce", () => {
    const cap = statedTotalCap();
    if (cap === null) return;
    const floorOverhead = JSON.stringify(buildVoice(false, 0, "floor")).length - (CONTRACT_GREETING.length + CONTRACT_PITCH.length + CONTRACT_SPEECH.length);
    assert.ok(BAND_MAX_PROSE + floorOverhead <= cap, `bands allow ${BAND_MAX_PROSE + floorOverhead} chars (NPC 0) but the prompt caps ${cap}`);
  });

  it("any stated total cap fits mid-band contract-valid Voice for every NPC count", () => {
    const cap = statedTotalCap();
    if (cap === null) return;
    for (const f of fixtures().filter((x) => x.tier === "typical")) {
      const len = JSON.stringify(f.voice).length;
      assert.ok(len <= cap, `${f.label}: valid Voice is ${len} chars > stated cap ${cap}`);
    }
  });

  it("the largest valid Voice stays far below the Voice maxTokens, so truncation is fail-closed headroom", () => {
    const largest = Math.max(...fixtures().map((f) => estimateTokens(JSON.stringify(f.voice, null, 2))));
    assert.ok(largest * 2 < OFFICIAL_AUTHOR_MAX_TOKENS.character_bible_voice, `${largest} est tokens`);
  });

  it("the final Voice prompt keeps every field band and the adult-consistent template", () => {
    const system = buildCharacterVoiceSystem();
    for (const band of [C.greeting, C.speechDescription, C.publicDescription]) {
      assert.ok(system.includes(`${band.min}자 이상 ${band.max}자 이하`));
    }
    const user = buildCharacterVoiceUser({ name: "카엘", age: 30, adultCandidate: true, speechDirection: "단호", part1Recap: "r", npcDemand: "n" });
    const skeleton = JSON.parse(user.split("\n").find((l) => l.startsWith('{"speech"')) ?? "{}") as { nsfw?: boolean };
    assert.equal(skeleton.nsfw, true);
  });
});
