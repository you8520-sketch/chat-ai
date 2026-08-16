/**
 * Read-only probe: how helpers treat deepseek-v4-pro vs deepseek-v4-pro-0813.
 * Does not change production behavior.
 */
import Module from "node:module";
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import {
  isCheaperInferenceDeepSeekV4ProModel,
  isCheaperInferenceModel,
  isDeepSeekModel,
  isDeepSeekV4ProModel,
  resolveSelectedAI,
  selectedAILabel,
  selectedAIProvider,
  isValidSelectedAI,
} from "../src/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "../src/lib/cheaperInferenceConfig";
import { ADULT_SCENE_MODEL_POLICY } from "../src/lib/adultSceneModelPolicy";
import { resolveAdultRoutingConfig } from "../src/lib/adultSceneRouting";

const BASE = "deepseek-v4-pro";
const SNAP = "deepseek-v4-pro-0813";

function row(id: string) {
  return {
    id,
    isCheaperInferenceDeepSeekV4ProModel: isCheaperInferenceDeepSeekV4ProModel(id),
    isDeepSeekV4ProModel: isDeepSeekV4ProModel(id),
    isCheaperInferenceModel: isCheaperInferenceModel(id),
    isDeepSeekModel: isDeepSeekModel(id),
    isValidSelectedAI: isValidSelectedAI(id),
    resolveSelectedAI: resolveSelectedAI(id),
    selectedAIProvider: isValidSelectedAI(id) ? selectedAIProvider(id) : "NOT_VALID_SELECTED_AI",
    selectedAILabel: selectedAILabel(id),
  };
}

const thinkingBase = adaptCheaperInferenceChatBody({
  model: BASE,
  temperature: 0.92,
  reasoning_effort: "medium",
});
const thinkingSnap = adaptCheaperInferenceChatBody({
  model: SNAP,
  temperature: 0.92,
  reasoning_effort: "medium",
});

console.log(
  JSON.stringify(
    {
      helpers: {
        [BASE]: row(BASE),
        [SNAP]: row(SNAP),
      },
      thinking_adapter: {
        [BASE]: {
          thinking: thinkingBase.thinking ?? null,
          reasoning_effort: thinkingBase.reasoning_effort ?? null,
        },
        [SNAP]: {
          thinking: thinkingSnap.thinking ?? null,
          reasoning_effort: thinkingSnap.reasoning_effort ?? null,
        },
      },
      adult_policy_primary: ADULT_SCENE_MODEL_POLICY.primaryModelId,
      adult_routing_model: resolveAdultRoutingConfig().adultModelId,
    },
    null,
    2
  )
);
