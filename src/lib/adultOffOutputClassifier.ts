import "server-only";

import { CHEAPER_INFERENCE_GPT_6_LUNA_MODEL } from "@/lib/chatModels";
import { callOpenRouterCompletion } from "@/lib/openRouterCompletion";
import {
  ADULT_OFF_CLASSIFIER_JSON_SCHEMA,
  ADULT_OFF_CLASSIFIER_SCHEMA_NAME,
  ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT,
  buildAdultOffClassifierUserMessage,
  parseAdultOffClassifierOutput,
  type AdultOffClassify,
  type AdultOffClassifierResult,
} from "@/lib/adultOffOutputGuard";

/**
 * 성인 OFF 출력 검사용 독립 분류 모델. Main RP 모델과 호출·컨텍스트를 공유하지 않는다.
 * 단일 시도다: 실패는 자동 재시도하지 않고 호출자가 미승인으로 처리한다.
 */
export const ADULT_OFF_CLASSIFIER_MODEL = CHEAPER_INFERENCE_GPT_6_LUNA_MODEL;
export const ADULT_OFF_CLASSIFIER_REQUEST_KIND = "adult-off-output-moderation";
export const ADULT_OFF_CLASSIFIER_TIMEOUT_MS = 25_000;
const ADULT_OFF_CLASSIFIER_MAX_TOKENS = 200;

export const classifyAdultOffWindow: AdultOffClassify = async (
  windowText
): Promise<AdultOffClassifierResult> => {
  const startedAt = Date.now();
  const completion = await callOpenRouterCompletion({
    system: ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT,
    history: [{ role: "user", content: buildAdultOffClassifierUserMessage(windowText) }],
    model: ADULT_OFF_CLASSIFIER_MODEL,
    temperature: 0,
    maxTokens: ADULT_OFF_CLASSIFIER_MAX_TOKENS,
    disableReasoning: true,
    requestKind: ADULT_OFF_CLASSIFIER_REQUEST_KIND,
    timeoutMs: ADULT_OFF_CLASSIFIER_TIMEOUT_MS,
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: ADULT_OFF_CLASSIFIER_SCHEMA_NAME,
        strict: true,
        schema: ADULT_OFF_CLASSIFIER_JSON_SCHEMA as unknown as Record<string, unknown>,
      },
    },
  });
  const verdict = parseAdultOffClassifierOutput(completion.text);
  const usage = completion.usage;
  return {
    verdict,
    usage: {
      model: ADULT_OFF_CLASSIFIER_MODEL,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      costUsd: usage.cheaperInferenceBilledCostUsd ?? usage.upstreamCostUsd ?? null,
      providerRequestId: usage.providerRequestId ?? null,
      latencyMs: Date.now() - startedAt,
    },
  };
};
