import { ENOCH_FIXTURES } from "../data/canon-core-audit/d2-enoch-fixtures";
import { compileCanonPlanV1 } from "../src/lib/canonPlan/compiler";
import {
  compileCreatorDescriptionTriggers,
  buildPrivateSpeechControlBlock,
} from "../src/lib/creatorDescriptionTriggerCompiler";
import { resolveCanonInjectionPolicy } from "../src/lib/canonInjectionPolicy";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "../src/lib/chatModels";
import { loadCharacterChunksForPromptReadOnly } from "../src/lib/characterChunks";
import { formatSelectedPersonaForPrompt } from "../src/lib/userPersonas";
import { OPENING_TURN_USER } from "../src/lib/chatGreetingContext";
import { buildContext } from "../src/services/contextBuilder";
import { resolveNarrativePov } from "../src/lib/narrativePov";
import type { CanonInjectionPolicy } from "../src/lib/canonInjectionPolicy";

const raw = ENOCH_FIXTURES[0]!.creatorRawDescription;
const plan = compileCanonPlanV1({
  creatorRawDescription: raw,
  now: "2026-08-08T00:00:00.000Z",
});
if (!plan.ok) throw new Error(plan.error);
const speech = buildPrivateSpeechControlBlock(
  compileCreatorDescriptionTriggers({ description: raw })
);
const modelId = OPENROUTER_GEMINI_31_PRO_MODEL;
const GREETING =
  "에녹은 무너진 상가 그늘에 등을 기대고 있었다. 손전등은 꺼져 있었고, 방독면은 턱 아래에 걸쳐져 있었다.";
const userInput = "누구세요? …방금 그 소리는 뭐였죠?";
const { chunks } = loadCharacterChunksForPromptReadOnly(
  {
    id: 10,
    name: "에녹",
    gender: "male",
    system_prompt: raw,
    world: "회색 생태권. 총성은 죽음.",
    example_dialog: "유저: 저쪽\n에녹: 따라와",
    setting_chunks: "",
    speech_profile: "",
  },
  "렌",
  "렌"
);
const narrativePov = resolveNarrativePov({
  mode: "third_person",
  contentKind: "character",
  mainCharacterName: "에녹",
});
const base = {
  charName: "에녹",
  chunks,
  userNickname: "렌",
  userPersona: formatSelectedPersonaForPrompt("렌", "other", "20대"),
  userNote: "",
  longTermMemory: "",
  shortTermHistory: [
    { role: "user" as const, content: OPENING_TURN_USER },
    { role: "assistant" as const, content: GREETING },
  ],
  currentUserMessage: userInput,
  nsfw: false,
  gender: "male" as const,
  memoryMeta: "",
  modelId,
  userImpersonation: false,
  novelModeEnabled: false,
  isContinue: false,
  personaDisplayName: "렌",
  targetResponseChars: 3200,
  completedTurns: 0,
  provider: "openrouter" as const,
  contentKind: "character" as const,
  exampleDialog: "유저: 저쪽\n에녹: 따라와",
  userId: 4,
  narrativePov,
};
const A = buildContext({
  ...base,
  canonInjectionPolicy: resolveCanonInjectionPolicy(modelId),
  canonPlan: null,
});
const Bpol: CanonInjectionPolicy = {
  modelId,
  injectionEnabled: true,
  shadowOnly: false,
  canonMode: "LAYERED",
  archiveMode: "FULL_ALWAYS",
  rolloutStage: "D2",
  forceFullLegacy: false,
  canaryActualInjection: true,
  actualCanonMode: "LAYERED",
  actualArchiveMode: "FULL_ALWAYS",
  masterCanaryEnabled: true,
  canaryPercent: 100,
  cohortEligible: true,
  cohortBucket: 0,
  cohortEligibilityReason: "d6a",
};
const B = buildContext({
  ...base,
  canonInjectionPolicy: Bpol,
  canonPlan: plan.plan,
  privateSpeechControlBlock: speech || undefined,
});
console.log(
  JSON.stringify(
    {
      A_sys: A.systemPrompt.length,
      B_sys: B.systemPrompt.length,
      B_le_A: B.systemPrompt.length <= A.systemPrompt.length,
      reduction_pct: Math.round(
        (1 - B.systemPrompt.length / A.systemPrompt.length) * 100
      ),
      A_has_mother_section: A.systemPrompt.includes("[세계관 — 마더]"),
      B_has_mother_section: B.systemPrompt.includes("[세계관 — 마더]"),
      A_has_core_law: A.systemPrompt.includes("총성은 죽음"),
      B_has_core_law: B.systemPrompt.includes("총성은 죽음"),
      B_has_active: /Active scene canon|현재 장면|ACTIVE/i.test(
        B.systemPrompt
      ),
      B_has_speech_private: B.systemPrompt.includes("PRIVATE SPEECH CONTROL"),
      speech_block_chars: speech.length,
    },
    null,
    2
  )
);
