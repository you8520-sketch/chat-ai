import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estimateTokens } from "@/lib/tokenEstimate";
import { AI_LEARNING_LIMIT } from "@/lib/characterFormLimits";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
  MAIN_RP_MODEL_IDS,
} from "@/lib/chatModels";
import { HISTORY_TOKEN_BUDGET, resolveMaxPayloadInputTokens } from "@/lib/contextTrack";
import { canonCoreInflationMetrics, compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { selectActiveCanonChunks } from "@/lib/canonPlan/activeSelector";
import { matchKeywordLorebookEntries, type KeywordLorebookEntry } from "@/lib/keywordLorebooks";
import { parseCharacterFormBody, type SessionUser } from "@/lib/characterFormSave";
import { substantiveAiLearningCharCount } from "@/lib/creatorNarrationStyle";
import { buildCombinedCharacterSettingSource, parseCharacterSetting } from "@/utils/characterParser";
import { buildContext } from "@/services/contextBuilder";
import type { ChatMsg } from "@/lib/ai";
import type { CharacterChunk } from "@/types";

const ADULT: SessionUser = { id: 1, nickname: "audit", is_adult: 1 };

const MODELS = [
  { id: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, provider: "cheaperinference" as const },
  { id: GEMINI_38_FLASH_MODEL, provider: "openrouter" as const },
  { id: CHEAPER_INFERENCE_GPT_61_SOL_MODEL, provider: "cheaperinference" as const },
  { id: CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL, provider: "cheaperinference" as const },
];

const SPEECH_PERSONALITY = "문장은 짧고 결론이 먼저다. 감정을 형용사로 풀지 않고 다음 행동으로 말한다.";
const SPEECH_TRAITS = "호칭은 직책으로 시작해서 신뢰가 생긴 뒤에만 이름으로 바뀐다. 화나면 더 낮고 느려진다.";
const WORLD = [
  "MARK_WORLD 세계는 은빛 강을 경계로 황궁과 북부 전선이 나뉜다.",
  "원로원은 기사단 예산을 쥐고, 강은 겨울에 얼어 보급이 끊긴다.",
  "마력석은 조명과 봉인에만 쓰며 사람을 고치는 용도로는 허가되지 않는다.",
].join(" ");

const CORE = [
  "[정체성]",
  "이름: 카엘",
  "MARK_IDENTITY 카엘은 스물일곱의 근위 기사단장이고, 작위 없이 황궁 경호를 총괄한다.",
  "[성격]",
  "MARK_BEHAVIOR 명령을 먼저 확인하고, 눈앞의 사람이 위험하면 규칙보다 몸이 먼저 움직인다. 사적 감정은 임무가 끝난 뒤에만 꺼낸다.",
  "[관계]",
  "MARK_RELATION 사용자는 황궁 출입이 허가된 협력자다. 처음에는 경계하고, 같은 순찰을 세 번 버티면 등을 맡긴다.",
  "[능력]",
  "MARK_ABILITY 검술과 소규모 호위 지휘가 가능하다. 장기전은 체력이 먼저 무너져 한계다. 절대로 마법을 함부로 쓰지 않는다.",
].join("\n");

const REGION = [
  "[세계관]",
  "MARK_REGION 북부 전선은 은빛 강 상류의 세 개 보루로 이루어진다. 첫째 보루는 식량을, 둘째는 병기를, 셋째는 부상병을 맡는다.",
  "MARK_FACTION 원로원 감찰국은 기사단 해체를 문서로 압박하고, 현장 지휘권은 아직 카엘에게 있다.",
  "MARK_NPC 리안은 카엘이 북부에서 데려온 부관이다. 순찰 기록을 쓰고, 카엘이 농담을 받아 주는 유일한 사람이다.",
].join("\n");

const PAD_SENTENCE = "겨울의 보급로는 강이 얼기 전에 셋째 보루까지 닿아야 한다. ";

function padTo(text: string, length: number): string {
  let out = text;
  while (out.length < length) out += PAD_SENTENCE;
  return out.slice(0, length);
}

function settingFor(total: number): { world: string; systemPrompt: string; substantive: number } {
  const speech = SPEECH_PERSONALITY.length + SPEECH_TRAITS.length;
  const fixed = WORLD.length + speech;
  const systemLen = total - fixed;
  const tail = "\nMARK_TAIL";
  assert.ok(systemLen > CORE.length + REGION.length + tail.length, `${total} system ${systemLen}`);
  const systemPrompt = `${padTo(`${CORE}\n${REGION}`, systemLen - tail.length)}${tail}`;
  const substantive = substantiveAiLearningCharCount({
    world: WORLD,
    systemPrompt,
    speechInput: {
      speech_personality: SPEECH_PERSONALITY,
      speech_traits: SPEECH_TRAITS,
      speech_examples: "",
      speech_forbidden: "",
    },
  });
  assert.equal(substantive, total);
  return { world: WORLD, systemPrompt, substantive };
}

function formBody(systemPrompt: string) {
  return {
    content_kind: "character",
    name: "카엘",
    tagline: "황궁의 방패",
    description: "공개 소개",
    greeting: "성벽 위에서 당신을 내려다본다.",
    system_prompt: systemPrompt,
    world: WORLD,
    speech_personality: SPEECH_PERSONALITY,
    speech_traits: SPEECH_TRAITS,
    speech_examples: "확인했습니다.",
    speech_forbidden: "반말",
    genres: ["로맨스"],
    gender: "male",
    nsfw: false,
    participant_min_age: 28,
    assets: [{ url: "/uploads/test.png", tag: "neutral", representativeRank: 1 }],
  };
}

function historyOf(turns: number): ChatMsg[] {
  const markers: Record<number, string> = {
    0: "MARK_HIST_50 첫 순찰에서 봉인 조각을 같이 줍기로 약속했다.",
    [turns - 30]: "MARK_HIST_30 그때 관계는 아직 경계였고 이름을 부르지 않았다.",
    [turns - 20]: "MARK_HIST_20 원로원 문서는 기사단 예산을 깎는 내용으로 고정되어 있다.",
    [turns - 10]: "MARK_HIST_10 리안은 순찰 기록을 맡는 부관이다.",
    [turns - 5]: "MARK_HIST_5 최근 관계는 경계에서 등으로 바뀌었고 이름을 부른다.",
  };
  const assistant = "카엘은 검을 고쳐 쥐고 다음 보루까지의 거리를 확인했다. ";
  const out: ChatMsg[] = [];
  for (let i = 0; i < turns; i += 1) {
    out.push({ role: "user", content: markers[i] ?? `순찰 ${i + 1}번째 보고를 올렸다.` });
    out.push({ role: "assistant", content: `${assistant.repeat(8)}턴${i + 1}` });
  }
  return out;
}

const MEMORY = {
  longTermMemory: "MARK_LTM 오래 전 요약은 관계를 경계로 적는다. MARK_OLD 사용자는 아직 협력자일 뿐이다.",
  mediumTermMemoryBlock: "MARK_MID 중기 요약은 셋째 보루의 부상병 부족을 남긴다.",
  archiveMemory: "MARK_ARCHIVE 아카이브는 북부 전선에서 주군을 선택한 과거를 보관한다.",
  episodicMemoryBlock: "MARK_EPISODIC 검색된 일화는 봉인 조각을 같이 주운 밤이다.",
  userPersona: "MARK_PERSONA 사용자는 황궁 기록관이고 성별은 지정하지 않는다.",
  userNote: "MARK_NOTE 최신 메모는 관계를 신뢰로 고친다. MARK_NEW 사용자는 이제 등을 맡기는 사이다.",
};

function unslicedChunk(text: string): CharacterChunk[] {
  return [
    {
      id: "audit-unsliced",
      characterId: "audit",
      content: text,
      category: "identity",
      importance: "CRITICAL",
      tokenCount: estimateTokens(text),
      keywords: [],
    },
  ];
}

function assemble(model: (typeof MODELS)[number], chunks: CharacterChunk[], history: ChatMsg[]) {
  return buildContext({
    charName: "카엘",
    chunks,
    userNickname: "기록관",
    userPersona: MEMORY.userPersona,
    userNote: MEMORY.userNote,
    longTermMemory: MEMORY.longTermMemory,
    mediumTermMemoryBlock: MEMORY.mediumTermMemoryBlock,
    archiveMemory: MEMORY.archiveMemory,
    episodicMemoryBlock: MEMORY.episodicMemoryBlock,
    speechPersonality: SPEECH_PERSONALITY,
    speechTraits: SPEECH_TRAITS,
    shortTermHistory: history,
    currentUserMessage: "리안이 셋째 보루에서 무엇을 적고 있나.",
    nsfw: false,
    gender: "male",
    provider: model.provider,
    modelId: model.id,
    completedTurns: 50,
  });
}

describe("character setting expansion readiness (no limit change, no provider)", () => {
  const ten = settingFor(10_000);
  const twelve = settingFor(12_000);
  const fifteen = settingFor(15_000);
  const history = historyOf(50);

  it("keeps the live 10000 authoring ceiling and rejects 12k/15k before any save", () => {
    assert.equal(AI_LEARNING_LIMIT, 10_000);
    assert.deepEqual(
      MAIN_RP_MODEL_IDS,
      MODELS.map((m) => m.id)
    );
    const accepted = parseCharacterFormBody(formBody(ten.systemPrompt), ADULT);
    assert.equal(accepted.ok, true, accepted.ok ? "" : accepted.error);
    for (const candidate of [twelve, fifteen]) {
      const rejected = parseCharacterFormBody(formBody(candidate.systemPrompt), ADULT);
      assert.equal(rejected.ok, false);
      if (!rejected.ok) {
        assert.match(rejected.error, /10,000자 이하/);
        assert.equal(rejected.status, 400);
      }
    }
  });

  it("the production chunk combiner silently drops everything past 10000 chars", () => {
    for (const candidate of [ten, twelve, fifteen]) {
      const combined = buildCombinedCharacterSettingSource({
        characterId: "audit",
        systemPrompt: candidate.systemPrompt,
        world: candidate.world,
        exampleDialog: "",
        characterName: "카엘",
        gender: "male",
      });
      assert.ok(combined.length <= 10_000, `${candidate.substantive} combined ${combined.length}`);
      assert.match(combined, /MARK_IDENTITY/);
      assert.match(combined, /MARK_BEHAVIOR/);
      const chunks = parseCharacterSetting({
        characterId: "audit",
        systemPrompt: candidate.systemPrompt,
        world: candidate.world,
        exampleDialog: "",
        characterName: "카엘",
        gender: "male",
      });
      const joined = chunks.map((c) => c.content).join("\n");
      assert.equal(joined.includes("MARK_TAIL"), candidate.substantive === 10_000);
    }
    const over = buildCombinedCharacterSettingSource({
      characterId: "audit",
      systemPrompt: fifteen.systemPrompt,
      world: fifteen.world,
      exampleDialog: "",
      characterName: "카엘",
      gender: "male",
    });
    assert.equal(over.includes("MARK_TAIL"), false);
    assert.ok(fifteen.systemPrompt.includes("MARK_TAIL"));
  });

  it("unsliced test-only assembly injects the whole setting and does not shrink memory or history", () => {
    const rows: Array<Record<string, number | string>> = [];
    let baselineHistory = 0;
    let baselineMemory = "";
    for (const model of MODELS) {
      for (const candidate of [ten, twelve, fifteen]) {
        const built = assemble(model, unslicedChunk(`${candidate.world}\n${candidate.systemPrompt}`), history);
        const system = built.systemPrompt;
        const historyText = built.history.map((m) => m.content).join("\n");
        for (const marker of ["MARK_IDENTITY", "MARK_BEHAVIOR", "MARK_RELATION", "MARK_ABILITY", "MARK_WORLD", "MARK_NPC", "MARK_TAIL"]) {
          assert.ok(system.includes(marker), `${model.id} ${candidate.substantive} missing ${marker}`);
        }
        assert.ok(historyText.includes("MARK_HIST_5"), model.id);
        assert.equal(historyText.includes("MARK_HIST_50"), false, model.id);
        for (const marker of ["MARK_LTM", "MARK_MID", "MARK_ARCHIVE", "MARK_EPISODIC", "MARK_PERSONA", "MARK_NOTE", "MARK_OLD", "MARK_NEW"]) {
          assert.ok(system.includes(marker), `${model.id} missing ${marker}`);
        }
        const memorySig = ["MARK_LTM", "MARK_MID", "MARK_ARCHIVE", "MARK_EPISODIC", "MARK_PERSONA", "MARK_NOTE"]
          .map((m) => system.includes(m))
          .join("");
        if (baselineMemory === "") baselineMemory = memorySig;
        assert.equal(memorySig, baselineMemory);
        if (model === MODELS[0] && candidate === ten) {
          console.log(JSON.stringify({
            historyKept: {
              t5: historyText.includes("MARK_HIST_5"),
              t10: historyText.includes("MARK_HIST_10"),
              t20: historyText.includes("MARK_HIST_20"),
              t30: historyText.includes("MARK_HIST_30"),
              t50: historyText.includes("MARK_HIST_50"),
            },
          }));
        }
        if (baselineHistory === 0) baselineHistory = built.history.length;
        assert.equal(built.history.length, baselineHistory, `${model.id} ${candidate.substantive}`);
        assert.equal(built.meta.memoryCoverage.degraded, false);
        rows.push({
          model: model.id,
          chars: candidate.substantive,
          systemTokens: built.meta.estimatedSystemTokens,
          historyTokens: built.meta.estimatedHistoryTokens,
          inputTokens: built.meta.estimatedInputTokens,
          cacheRulesTokens: estimateTokens(built.openRouterSystemSplit?.systemRulesBlock ?? ""),
          cacheCharacterTokens: estimateTokens(built.openRouterSystemSplit?.characterSettingsBlock ?? ""),
          historyMessages: built.history.length,
        });
      }
    }
    console.table(rows);
    const deepseek = rows.filter((r) => r.model === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(deepseek[0]!.historyTokens, deepseek[1]!.historyTokens);
    assert.equal(deepseek[1]!.historyTokens, deepseek[2]!.historyTokens);
    assert.ok(Number(deepseek[1]!.systemTokens) > Number(deepseek[0]!.systemTokens));
    assert.ok(Number(deepseek[2]!.systemTokens) > Number(deepseek[1]!.systemTokens));
    assert.equal(deepseek[0]!.cacheRulesTokens, deepseek[2]!.cacheRulesTokens);
    assert.ok(Number(deepseek[1]!.cacheCharacterTokens) > Number(deepseek[0]!.cacheCharacterTokens));
    assert.ok(Number(deepseek[2]!.cacheCharacterTokens) > Number(deepseek[1]!.cacheCharacterTokens));
    assert.equal(resolveMaxPayloadInputTokens(deepseek[0]!.model as string), Number.MAX_SAFE_INTEGER);
    assert.equal(HISTORY_TOKEN_BUDGET, 10_000);
  });

  it("layered canon, not the live default, is the only owner that can leave detail uninjected", () => {
    const compiled = compileCanonPlanV1({ creatorRawDescription: `${fifteen.world}\n${fifteen.systemPrompt}`, now: "2026-01-01T00:00:00.000Z" });
    assert.equal(compiled.ok, true);
    if (!compiled.ok) return;
    const metrics = canonCoreInflationMetrics(compiled.plan);
    const matched = selectActiveCanonChunks({ plan: compiled.plan, userMessage: "리안이 셋째 보루에서 무엇을 적고 있나." });
    const unmatched = selectActiveCanonChunks({ plan: compiled.plan, userMessage: "오늘 날씨가 어떤가." });
    console.table([{ ...metrics, activeBudget: compiled.plan.retrieval.activeBudgetChars, matchedActive: matched.activeChunks.length, unmatchedActive: unmatched.activeChunks.length }]);
    assert.equal(compiled.plan.retrieval.activeBudgetChars, 1200);
    assert.ok(metrics.dormantChunks > 0);
    assert.ok(metrics.coreChars < metrics.totalChars);
    assert.equal(matched.activeChunks.length, 0);
    assert.equal(unmatched.activeChunks.length, 0);
  });

  it("keyword lorebook already injects NPC detail only when the scan text matches", () => {
    const entries: KeywordLorebookEntry[] = [
      {
        keywords: ["리안"],
        content: "MARK_LORE_NPC 리안은 순찰 기록을 맡는 부관이다.",
      },
    ];
    assert.deepEqual(matchKeywordLorebookEntries(entries, "리안이 기록을 쓴다."), [entries[0]!.content]);
    assert.deepEqual(matchKeywordLorebookEntries(entries, "오늘 날씨가 어떤가."), []);
  });
});
