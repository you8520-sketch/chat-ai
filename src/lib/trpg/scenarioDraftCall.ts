import {
  adaptCheaperInferenceChatBody,
  buildCheaperInferenceHeaders,
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  resolveCheaperInferenceApiKey,
} from "@/lib/cheaperInferenceConfig";
import { isMockApiMode } from "@/lib/mockApiMode";
import type { TrpgModelUsage } from "./billing";
import {
  parseScenarioDraftJson,
  TRPG_SCENARIO_DRAFT_MODEL,
  type TrpgScenarioDraftResult,
} from "./scenarioDraft";

export type TrpgAuthoringCallResult = {
  text: string;
  usage?: TrpgModelUsage;
  latencyMs: number;
  model: string;
};

export type TrpgAuthoringComplete = (opts: {
  system: string;
  user: string;
  repairOf?: string;
}) => Promise<TrpgAuthoringCallResult>;

const MOCK_DRAFT = JSON.stringify({
  title: "끊긴 북부 보급",
  summary: "통신이 끊긴 성채로 향하는 보급대와 함께 폐도시에 들어간다.",
  startingSituation: "북부 성채의 통신이 사흘째 끊긴 가운데, 파티는 마지막 보급대와 함께 폐도시에 진입한다.",
  centralConflict: "성채를 장악하려는 인간 세력과 도시 코어의 확장이 동시에 진행되고 있다.",
  goal: "통신 두절의 원인을 밝히고 생존자와 보급로의 운명을 결정한다.",
  secret: "성채 지하에서 코어가 이미 지휘관을 대체하고 있다.",
  endingConditions: ["코어의 확장을 막거나 협상한다", "생존자를 이끌고 남쪽으로 철수한다"],
  majorEvents: ["보급대가 야영 중 실종자를 발견한다", "성채 내부 파벌이 파티에게 협조를 요구한다"],
  clues: ["끊긴 통신기의 마지막 기록", "지휘관의 어색한 말투", "지하로 이어진 따뜻한 관"],
  npcs: [
    {
      name: "보급대장 하린",
      description: "지친 보급대 지휘관. 병사보다 짐부터 챙긴다.",
      greeting: "짧게, 실무적으로 말한다.",
      systemPrompt: "파티를 이용하되 배신하지는 않는다.",
      stats: null,
    },
  ],
  forbiddenEvents: ["현대 국가가 멀쩡히 등장하지 않는다"],
  boss: "",
  startLocation: "폐도시 외곽 검문소",
  startInventory: ["손전등", "비상식량"],
  specialRules: ["실패해도 철수 경로가 남는다"],
  difficulty: "normal",
  climax: "성채 지하에서 코어와 인간 지휘권의 충돌이 드러난다.",
  endingCandidates: ["성채를 봉쇄한다", "코어와 불안한 공존을 택한다"],
  factionChanges: ["보급대가 파티를 임시 동맹으로 본다"],
  gmDirection: "전투보다 탐험과 NPC 긴장을 우선한다. 플레이어 결정을 대신하지 않는다.",
  playLength: "medium",
});

export function logTrpgAuthoringUsage(opts: {
  kind: "scenario_draft" | "sandbox_blueprint";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}): void {
  console.info("[trpg-authoring]", {
    kind: opts.kind,
    model: opts.model,
    inputTokens: opts.inputTokens ?? 0,
    outputTokens: opts.outputTokens ?? 0,
    latencyMs: opts.latencyMs,
    success: opts.success,
    error: opts.error ?? "",
  });
}

export async function callTrpgAuthoringModel(opts: {
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<TrpgAuthoringCallResult> {
  const started = Date.now();
  const model = TRPG_SCENARIO_DRAFT_MODEL;
  if (isMockApiMode()) {
    return { text: MOCK_DRAFT, latencyMs: Date.now() - started, model };
  }
  const body = adaptCheaperInferenceChatBody({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    stream: false,
    temperature: 0.6,
    max_tokens: 4096,
    response_format: { type: "json_object" },
  });
  const res = await fetch(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[TRPG authoring] ${res.status}: ${errText.slice(0, 240)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) throw new Error("[TRPG authoring] empty completion");
  const prompt = Number(data.usage?.prompt_tokens ?? 0);
  const completion = Number(data.usage?.completion_tokens ?? 0);
  return {
    text,
    latencyMs: Date.now() - started,
    model,
    usage:
      prompt > 0 || completion > 0
        ? { modelId: model, inputTokens: prompt, outputTokens: completion }
        : undefined,
  };
}

export async function completeTrpgAuthoringJson(opts: {
  system: string;
  user: string;
  complete?: TrpgAuthoringComplete;
  kind: "scenario_draft" | "sandbox_blueprint";
}): Promise<TrpgScenarioDraftResult> {
  const complete = opts.complete ?? ((call) => callTrpgAuthoringModel(call));
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user =
      attempt === 0
        ? opts.user
        : `${opts.user}\n\nPREVIOUS_OUTPUT was not valid JSON/schema. Return corrected JSON only.\nERROR: ${lastError}`;
    const started = Date.now();
    try {
      const result = await complete({
        system: opts.system,
        user,
        repairOf: attempt === 1 ? lastError : undefined,
      });
      try {
        const parsed = parseScenarioDraftJson(result.text);
        logTrpgAuthoringUsage({
          kind: opts.kind,
          model: result.model || TRPG_SCENARIO_DRAFT_MODEL,
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          latencyMs: result.latencyMs || Date.now() - started,
          success: true,
        });
        return parsed;
      } catch (parseError) {
        lastError = parseError instanceof Error ? parseError.message : "invalid json";
        if (attempt === 1) {
          logTrpgAuthoringUsage({
            kind: opts.kind,
            model: result.model || TRPG_SCENARIO_DRAFT_MODEL,
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            latencyMs: result.latencyMs || Date.now() - started,
            success: false,
            error: lastError,
          });
          throw parseError;
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "authoring failed";
      if (attempt === 1) {
        logTrpgAuthoringUsage({
          kind: opts.kind,
          model: TRPG_SCENARIO_DRAFT_MODEL,
          latencyMs: Date.now() - started,
          success: false,
          error: lastError,
        });
        throw error;
      }
    }
  }
  throw new Error("시나리오 초안을 만들지 못했습니다.");
}
