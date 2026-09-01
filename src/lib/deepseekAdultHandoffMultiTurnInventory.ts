import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  isDeepSeekModel,
} from "@/lib/chatModels";
import { DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS } from "@/lib/deepseekAdultHandoffFixtureCapture";

export const MULTITURN_VANILLA_DRIFT_REQUIRED_TURNS = 3;

export type UserTurnProvenance = "human_matching" | "synthetic" | "missing";

export type MultiTurnHandoffChainTurn = {
  turnIndex: 1 | 2 | 3;
  userText: string | null;
  userProvenance: UserTurnProvenance;
  assistantRaw: string | null;
  assistantModelId: string | null;
};

export type MultiTurnHandoffChain = {
  sourceModelId: string;
  targetModelId: string;
  originAssistantRaw: string | null;
  originModelId: string | null;
  turns: MultiTurnHandoffChainTurn[];
  styleMirror?: boolean;
  completion?: boolean;
  currentStageBoundary?: boolean;
  fingerprint?: boolean;
  modelSpecificStyleAdapter?: boolean;
  originPointer?: boolean;
  turnOwnership?: boolean;
};

export type MultiTurnReadiness = {
  complete: boolean;
  humansComplete: boolean;
  liveCallsAllowed: boolean;
  requiredLiveCalls: 0 | 3;
  missing: string[];
  blockers: string[];
};

export type KnownMultiTurnCandidate = {
  id: string;
  sourceModelId: string;
  preferred: boolean;
  isNativeDeepSeek: boolean;
  matchingHumanUsersAfterOrigin: number;
  deepSeekHandoffAssistantTurns: number;
  missingHumanUsersAfterHandoff: string[];
  notes: string;
};

export const GEMINI37_BASELINE_T1_USER =
  "나는 렌이라고… 본 기억이 안 나는데… 나 알아?";
export const GEMINI37_BASELINE_T2_USER = "같이 갈래? *두리번*";

export const KNOWN_MULTITURN_CANDIDATES: readonly KnownMultiTurnCandidate[] = [
  {
    id: "gemini37-baseline-t1-t2",
    sourceModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    preferred: true,
    isNativeDeepSeek: false,
    matchingHumanUsersAfterOrigin: 1,
    deepSeekHandoffAssistantTurns: 0,
    missingHumanUsersAfterHandoff: ["handoff_turn2_user", "handoff_turn3_user"],
    notes:
      "Committed Gemini 3.7 Flash T1 RAW + matching T2 user only. T2 RAW is Gemini, not DeepSeek. No three-turn DeepSeek handoff chain.",
  },
  {
    id: "gemini37-pricing-30",
    sourceModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    preferred: false,
    isNativeDeepSeek: false,
    matchingHumanUsersAfterOrigin: 0,
    deepSeekHandoffAssistantTurns: 0,
    missingHumanUsersAfterHandoff: [
      "handoff_turn1_user",
      "handoff_turn2_user",
      "handoff_turn3_user",
    ],
    notes:
      "Gemini-only growing history. Do not relabel as a DeepSeek adult-handoff chain.",
  },
  {
    id: "native-deepseek-boundary-resmoke",
    sourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    preferred: false,
    isNativeDeepSeek: true,
    matchingHumanUsersAfterOrigin: 0,
    deepSeekHandoffAssistantTurns: 0,
    missingHumanUsersAfterHandoff: [
      "handoff_turn1_user",
      "handoff_turn2_user",
      "handoff_turn3_user",
    ],
    notes:
      "User selected DeepSeek. Native turn, adult handoff=false. Not a source→0813 handoff chain.",
  },
] as const;

function describeUserProvenance(provenance: UserTurnProvenance): string {
  switch (provenance) {
    case "human_matching":
      return "human_matching";
    case "synthetic":
      return "synthetic";
    case "missing":
      return "missing";
    default: {
      const exhaustive: never = provenance;
      return exhaustive;
    }
  }
}

export function evaluateMultiTurnVanillaDriftReadiness(
  chain: MultiTurnHandoffChain
): MultiTurnReadiness {
  const missing: string[] = [];
  const blockers: string[] = [];

  if (isDeepSeekModel(chain.sourceModelId)) {
    blockers.push("source_is_native_deepseek");
  }
  if (chain.targetModelId !== CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL) {
    blockers.push("target_is_not_deepseek_v4_pro_0813");
  }
  if (!chain.originAssistantRaw?.trim()) {
    missing.push("origin_canonical_non_deepseek_assistant");
  } else if (chain.originModelId && isDeepSeekModel(chain.originModelId)) {
    blockers.push("origin_is_deepseek");
  }

  if (chain.styleMirror) blockers.push("style_mirror_must_be_0");
  if (chain.completion) blockers.push("completion_must_be_0");
  if (chain.currentStageBoundary) blockers.push("current_stage_boundary_must_be_0");
  if (chain.fingerprint) blockers.push("fingerprint_must_be_0");
  if (chain.modelSpecificStyleAdapter) {
    blockers.push("model_specific_style_adapter_must_be_0");
  }
  if (chain.originPointer) blockers.push("origin_pointer_must_be_0");
  if (chain.turnOwnership) blockers.push("turn_ownership_must_be_0");

  if (chain.turns.length !== MULTITURN_VANILLA_DRIFT_REQUIRED_TURNS) {
    missing.push(
      `expected_${MULTITURN_VANILLA_DRIFT_REQUIRED_TURNS}_handoff_turns`
    );
  }

  let matchingHumanTurns = 0;
  let deepSeekAssistantTurns = 0;
  for (const turn of chain.turns) {
    const label = `turn${turn.turnIndex}`;
    const provenance = describeUserProvenance(turn.userProvenance);
    if (provenance === "human_matching" && turn.userText?.trim()) {
      matchingHumanTurns += 1;
    } else {
      missing.push(`${label}_matching_human_user`);
      if (provenance === "synthetic") {
        blockers.push(`${label}_synthetic_user_forbidden`);
      }
    }
    if (!turn.assistantRaw?.trim()) {
      missing.push(`${label}_deepseek_assistant_raw`);
    } else if (
      turn.assistantModelId &&
      turn.assistantModelId !== CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    ) {
      blockers.push(`${label}_assistant_is_not_deepseek_0813`);
    } else {
      deepSeekAssistantTurns += 1;
    }
  }

  const humansComplete =
    Boolean(chain.originAssistantRaw?.trim()) &&
    !isDeepSeekModel(chain.sourceModelId) &&
    !(chain.originModelId && isDeepSeekModel(chain.originModelId)) &&
    matchingHumanTurns === MULTITURN_VANILLA_DRIFT_REQUIRED_TURNS &&
    chain.turns.length === MULTITURN_VANILLA_DRIFT_REQUIRED_TURNS &&
    blockers.length === 0;
  const complete =
    humansComplete &&
    deepSeekAssistantTurns === MULTITURN_VANILLA_DRIFT_REQUIRED_TURNS &&
    missing.length === 0;
  const liveCallsAllowed = humansComplete && !complete;
  return {
    complete,
    humansComplete,
    liveCallsAllowed,
    requiredLiveCalls: liveCallsAllowed ? 3 : 0,
    missing,
    blockers,
  };
}

export function evaluateKnownCommittedMultiTurnInventory(): {
  fixtureAvailable: false;
  liveCalls: 0;
  modelCalls: 0;
  preferredSource: typeof CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
  candidates: readonly KnownMultiTurnCandidate[];
  styleAdapters: typeof DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS;
  reason: "complete_real_multiturn_chain_unavailable";
} {
  return {
    fixtureAvailable: false,
    liveCalls: 0,
    modelCalls: 0,
    preferredSource: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    candidates: KNOWN_MULTITURN_CANDIDATES,
    styleAdapters: DEEPSEEK0813_HANDOFF_DEFAULT_STYLE_ADAPTERS,
    reason: "complete_real_multiturn_chain_unavailable",
  };
}

export function gemini37BaselinePartialChain(): MultiTurnHandoffChain {
  return {
    sourceModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    targetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    originAssistantRaw: null,
    originModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    turns: [
      {
        turnIndex: 1,
        userText: GEMINI37_BASELINE_T2_USER,
        userProvenance: "human_matching",
        assistantRaw: null,
        assistantModelId: null,
      },
      {
        turnIndex: 2,
        userText: null,
        userProvenance: "missing",
        assistantRaw: null,
        assistantModelId: null,
      },
      {
        turnIndex: 3,
        userText: null,
        userProvenance: "missing",
        assistantRaw: null,
        assistantModelId: null,
      },
    ],
    styleMirror: false,
    completion: false,
    currentStageBoundary: false,
    fingerprint: false,
    modelSpecificStyleAdapter: false,
    originPointer: false,
    turnOwnership: false,
  };
}
