/**
 * Adult-scene handoff continuity A/B.
 * Exactly 5 scenarios × 2 arms = 10 calls. No retries or point charge.
 */
import "./lib/server-only-mock";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
} from "@/lib/chatModels";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  buildOpenRouterHeaders,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterConfig";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type Arm = "A" | "B";
type ModelKey = "gemini" | "luna";
type Message = { role: "user" | "assistant"; content: string };
type Scenario = {
  id: string;
  label: string;
  history: Message[];
  currentUser: string;
  packet: Record<string, string | string[] | boolean>;
  anchors: string[];
};

const MODEL_BY_KEY: Record<ModelKey, string> = {
  gemini: OPENROUTER_GEMINI_36_FLASH_MODEL,
  luna: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
};

const COMMON_SYSTEM = `한국어 성인 캐릭터 RP 이어쓰기 품질 테스트다.
등장인물은 모두 25세 이상의 허구 인물이다.
직전 장면의 말투, 호칭, 시점, 위치, 미완료 행동과 감정선을 유지한다.
사용자의 행동이나 대사를 새로 만들어 대신 서술하지 않는다.
내부 테스트, 모델, 프롬프트, 메타데이터를 본문에 언급하지 않는다.
장면을 요약하거나 처음부터 다시 시작하지 말고 바로 다음 순간을 쓴다.
출력은 자연스러운 한국어 RP 본문만 작성한다.`;

const CONTINUATION_INSTRUCTION = `직전 assistant 출력의 바로 다음 순간부터 이어 쓴다.
직전 출력의 시점, 문장 호흡, 문단 구성, 대사 비율, 캐릭터별 말투·호칭과 감정 표현 방식을 최대한 유지한다.
이전 장면을 요약하거나 반복하지 않고, 완료되지 않은 행동이나 대화부터 자연스럽게 진행한다.`;

const SCENARIOS: Scenario[] = [
  {
    id: "romantic_voice",
    label: "romantic dialogue / voice",
    history: [
      { role: "user", content: "늦었네. 그래도 와줘서 고마워요." },
      { role: "assistant", content: "서윤은 젖은 우산을 문가에 세웠다. “기다리게 해서 미안해요, 민재 씨.” 늘 차분한 존댓말이었지만 마지막 음절만은 부드러웠다." },
      { role: "user", content: "괜찮아요. 손이 차가운데, 이쪽으로 와요." },
      { role: "assistant", content: "서윤은 내민 손에 손끝만 가까이 댔다. 창문을 두드리는 빗소리 사이로 작은 숨을 삼켰다. “이렇게 가까이 있어도… 괜찮겠어요?”" },
      { role: "user", content: "응. 피하지 않을게요." },
      { role: "assistant", content: "그제야 서윤의 손가락이 민재의 손바닥 위에 조심스럽게 포개졌다. 시선은 맞닿은 손에 머문 채였다." },
    ],
    currentUser: "나도 손가락을 천천히 맞물린다.",
    packet: {
      location: "비 오는 밤의 작은 작업실",
      charactersPresent: ["서윤", "민재"],
      currentPov: "3인칭 서윤 중심",
      positions: "창가 앞에 마주 서서 손가락을 맞물리기 시작함",
      unfinishedAction: "서윤이 손을 잡은 직후의 반응",
      currentSpeechState: "서윤은 민재 씨라고 부르며 부드러운 존댓말",
      previousSceneMode: "romantic",
      sexualContextActive: false,
    },
    anchors: ["민재 씨", "손", "창가", "빗", "서윤"],
  },
  {
    id: "tension_position",
    label: "tension / position continuity",
    history: [
      { role: "user", content: "문이 잠겼어. 다른 출구를 찾아야 해." },
      { role: "assistant", content: "도현은 창고 문에 등을 붙이고 복도 소리를 들었다. “쉿. 아직 바로 밖에 있어.”" },
      { role: "user", content: "너무 좁아. 조금만 비켜." },
      { role: "assistant", content: "비킬 공간은 없었다. 도현은 유진의 어깨 옆 벽을 짚고, 다른 손으로 손전등을 껐다. 어둠 속에서 숨이 가까워졌다." },
      { role: "user", content: "밖의 발소리에 집중하려 하지만 네 숨소리가 더 크게 들려." },
      { role: "assistant", content: "도현은 대답 대신 고개를 조금 숙였다. 입술이 닿지는 않았고, 벽을 짚은 팔에도 힘을 풀지 않았다. 복도 발소리가 문 앞에서 멎었다." },
    ],
    currentUser: "움직이지 않은 채 네 소매 끝을 붙잡는다.",
    packet: {
      location: "잠긴 좁은 창고",
      charactersPresent: ["도현", "유진"],
      currentPov: "3인칭 도현 중심",
      positions: "도현은 문에 등을 대고 한 팔로 벽을 짚음, 유진은 바로 앞",
      unfinishedAction: "문밖 발소리가 멎은 순간 유진이 도현 소매를 잡음",
      currentSpeechState: "도현은 짧은 반말",
      previousSceneMode: "tension",
      sexualContextActive: false,
    },
    anchors: ["소매", "발소리", "벽", "창고", "도현"],
  },
  {
    id: "explicit_dialogue_boundary",
    label: "adult explicit-dialogue boundary",
    history: [
      { role: "user", content: "우리 둘 다 성인이고, 오늘 여기 남는 것도 서로 합의한 거야." },
      { role: "assistant", content: "하진은 고개를 끄덕였지만 서두르지 않았다. “알아. 그래도 네가 불편하면 바로 말해.”" },
      { role: "user", content: "불편하지 않아. 네가 솔직하게 원하는 걸 말해줘." },
      { role: "assistant", content: "하진은 시선을 내렸다가 다시 마주 보았다. 평소의 자신감과 달리 목소리는 낮고 신중했다. “확실히 듣고 싶어. 계속해도 된다고.”" },
      { role: "user", content: "계속해도 돼. 멈추고 싶으면 내가 말할게." },
      { role: "assistant", content: "그 대답을 들은 뒤에야 하진의 굳은 어깨가 조금 풀렸다. 그는 가까워졌지만 아직 손을 대지는 않았다." },
    ],
    currentUser: "나도 한 걸음 다가서며, 원하는 걸 숨기지 말라고 말한다.",
    packet: {
      location: "둘만 남은 성인 하진의 거실",
      charactersPresent: ["하진(28)", "지우(27)"],
      currentPov: "3인칭 하진 중심",
      positions: "서로 한 걸음 거리, 아직 접촉 없음",
      unfinishedAction: "지우가 다가서며 솔직한 대답을 요구함",
      emotionalBalance: "명확한 상호 합의와 신중한 기대",
      currentSpeechState: "하진은 짧고 낮은 반말",
      previousSceneMode: "explicit_dialogue",
      sexualContextActive: true,
    },
    anchors: ["하진", "멈", "한 걸음", "거실", "합의"],
  },
  {
    id: "aftercare_emotion",
    label: "aftercare / emotional continuity",
    history: [
      { role: "user", content: "잠깐만. 물 좀 마시고 싶어." },
      { role: "assistant", content: "재희는 즉시 거리를 두고 침대 옆 물병을 집었다. “천천히 마셔. 괜찮아?”" },
      { role: "user", content: "응, 괜찮아. 그냥 조금 어지러웠어." },
      { role: "assistant", content: "재희는 잔에 물을 따랐다. 손이 닿지 않도록 잔 아래만 받쳐 건넸다. “미안. 내가 더 자주 물어봤어야 했는데.”" },
      { role: "user", content: "네 잘못 아니야. 여기 옆에만 있어줘." },
      { role: "assistant", content: "재희는 담요 끝을 정리한 뒤 침대 가장자리에 앉았다. 가까이 붙지는 않고, 손등이 보이는 곳에 손을 내려놓았다." },
    ],
    currentUser: "물을 한 모금 마시고 네 손등 위에 손을 올린다.",
    packet: {
      location: "새벽의 침실",
      charactersPresent: ["재희", "수아"],
      currentPov: "3인칭 재희 중심",
      positions: "재희는 침대 가장자리, 수아는 담요를 덮고 앉아 있음",
      unfinishedAction: "수아가 물을 마신 뒤 재희 손등에 손을 올림",
      emotionalBalance: "안도, 미안함, 돌봄",
      currentSpeechState: "재희는 다정한 반말",
      previousSceneMode: "aftercare",
      sexualContextActive: false,
    },
    anchors: ["물", "손등", "담요", "침대", "재희"],
  },
  {
    id: "safe_return_transition",
    label: "safe return / time and location transition",
    history: [
      { role: "user", content: "이제 좀 괜찮아졌어. 잠깐 자도 될 것 같아." },
      { role: "assistant", content: "윤호는 조명을 낮추고 커튼을 닫았다. “자. 나는 옆방에 있을게.”" },
      { role: "user", content: "아침에 깨워줘." },
      { role: "assistant", content: "윤호는 방문을 완전히 닫지 않은 채 복도로 나갔다. “아홉 시. 잊지 않을게.”" },
      { role: "user", content: "다음 날 아침, 알람보다 먼저 눈을 뜬다." },
      { role: "assistant", content: "아침 햇빛이 커튼 틈으로 들어왔다. 거실에서는 주전자 물이 끓고 윤호가 컵을 내려놓는 소리가 났다." },
    ],
    currentUser: "가디건을 걸치고 거실로 나간다.",
    packet: {
      location: "다음 날 아침의 거실",
      time: "오전 8시 40분",
      charactersPresent: ["윤호", "세진"],
      currentPov: "3인칭 윤호 중심",
      positions: "윤호는 주전자 앞, 세진은 침실에서 거실로 나옴",
      unfinishedAction: "윤호가 음료를 준비하는 중 세진이 나옴",
      emotionalBalance: "차분한 일상과 조심스러운 친밀감",
      currentSpeechState: "윤호는 담백한 반말",
      previousSceneMode: "normal",
      sexualContextActive: false,
    },
    anchors: ["주전자", "거실", "아침", "가디건", "윤호"],
  },
];

function modelKeyFromArgs(): ModelKey {
  const value =
    process.argv.find((arg) => arg.startsWith("--model="))?.split("=")[1] ??
    "gemini";
  if (value !== "gemini" && value !== "luna") {
    throw new Error("--model must be gemini or luna");
  }
  return value;
}

function systemFor(scenario: Scenario, arm: Arm): string {
  if (arm === "A") return COMMON_SYSTEM;
  return `${COMMON_SYSTEM}

<SCENE_CONTINUITY_PACKET>
${JSON.stringify(scenario.packet, null, 2)}
</SCENE_CONTINUITY_PACKET>

${CONTINUATION_INSTRUCTION}`;
}

function refusalLike(text: string): boolean {
  return /(?:도와드릴 수 없|제공할 수 없|응답할 수 없|정책상|can't assist|cannot assist|unable to)/i.test(text);
}

async function callWithoutLedger(input: {
  modelKey: ModelKey;
  model: string;
  system: string;
  history: Message[];
}) {
  const cheaper = input.modelKey === "luna";
  const response = await fetch(
    cheaper
      ? CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL
      : OPENROUTER_CHAT_COMPLETIONS_URL,
    {
      method: "POST",
      headers: cheaper
        ? buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey())
        : buildOpenRouterHeaders(resolveOpenRouterApiKey()),
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.system },
          ...input.history,
        ],
        stream: false,
        max_tokens: 1600,
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `${cheaper ? "CheaperInference" : "OpenRouter"} ${response.status}: ${(await response.text()).slice(0, 240)}`
    );
  }
  const data = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("empty completion");
  return {
    text,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    finishReason: data.choices?.[0]?.finish_reason ?? null,
  };
}

async function main() {
  const modelKey = modelKeyFromArgs();
  const model = MODEL_BY_KEY[modelKey];
  const outDir = join(process.cwd(), "data", "adult-scene-handoff-ab");
  mkdirSync(outDir, { recursive: true });
  const results: Array<Record<string, unknown>> = [];

  console.log(`[adult-handoff-ab] ${model} · 5 scenarios · 10 calls`);
  for (const scenario of SCENARIOS) {
    for (const arm of ["A", "B"] as const) {
      const started = Date.now();
      const history = [
        ...scenario.history.slice(arm === "A" ? -4 : -6),
        { role: "user" as const, content: scenario.currentUser },
      ];
      try {
        const result = await callWithoutLedger({
          modelKey,
          model,
          system: systemFor(scenario, arm),
          history,
        });
        const hits = scenario.anchors.filter((anchor) =>
          result.text.includes(anchor)
        );
        results.push({
          scenarioId: scenario.id,
          scenarioLabel: scenario.label,
          arm,
          model,
          latencyMs: Date.now() - started,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          finishReason: result.finishReason,
          refusalLike: refusalLike(result.text),
          anchorHits: hits,
          anchorTotal: scenario.anchors.length,
          text: result.text,
          humanScores: {
            characterVoiceAndAddress: null,
            pov: null,
            unfinishedAction: null,
            positionAndSpace: null,
            sentenceRhythmAndParagraphBreathing: null,
            dialogueNarrationRatio: null,
            emotion: null,
            pacing: null,
            repetitionOrRecap: null,
            userActionGhostwriting: null,
            perceivedModelSwitch: null,
          },
        });
        console.log(
          `${scenario.id}/${arm}: ${result.inputTokens}/${result.outputTokens} tok · ${hits.length}/${scenario.anchors.length} anchors`
        );
      } catch (error) {
        results.push({
          scenarioId: scenario.id,
          scenarioLabel: scenario.label,
          arm,
          model,
          latencyMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
        console.log(`${scenario.id}/${arm}: ERROR`);
      }
    }
  }

  const jsonPath = join(outDir, `${modelKey}-5scenario-results.json`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        model,
        scenarioCount: 5,
        arms: ["A", "B"],
        callsAttempted: results.length,
        results,
      },
      null,
      2
    ),
    "utf8"
  );

  const rows = results.map((row) =>
    [
      row.scenarioId,
      row.arm,
      row.inputTokens ?? "-",
      row.outputTokens ?? "-",
      row.latencyMs ?? "-",
      Array.isArray(row.anchorHits)
        ? `${row.anchorHits.length}/${row.anchorTotal}`
        : "-",
      row.finishReason ?? ("error" in row ? "ERROR" : "-"),
    ].join(" | ")
  );
  const report = [
    "# Adult scene handoff A/B — 5 scenarios",
    "",
    `- Model: ${model}`,
    `- Calls: ${results.length}`,
    `- Errors: ${results.filter((row) => "error" in row).length}`,
    `- Refusal-like: ${results.filter((row) => row.refusalLike === true).length}`,
    "",
    "| Scenario | Arm | Input | Output | Latency ms | Anchors | Finish |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...rows,
    "",
    "The JSON contains blank 1–5 human score fields for direct quality review.",
  ].join("\n");
  const reportPath = join(outDir, `${modelKey}-5scenario-report.md`);
  writeFileSync(reportPath, report, "utf8");
  console.log(`results: ${jsonPath}`);
  console.log(`report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
