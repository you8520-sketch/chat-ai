import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ContextBuildInput, CharacterChunk } from "@/types";
import { resolveEffectiveUserAuthoring } from "@/lib/userCoauthorState";

export const RP_MODEL_QUALIFICATION_FIXTURE_VERSION = 1;

/**
 * Canonical real-production RP identity fixture.
 *
 * Source is the already-committed production prompt dump captured from:
 * chat=4, user=1, character=10 on 2026-08-25.
 *
 * Do not duplicate the character/persona text in a second fixture. The files
 * below are the single pinned source. Candidate-model tests must fail closed
 * if any pinned blob changes.
 */
export const CANONICAL_RP_QUALIFICATION_SOURCE = Object.freeze({
  capturedAt: "2026-08-25",
  sourceChatId: 4,
  sourceUserId: 1,
  sourceCharacterId: 10,
  characterName: "라이크",
  characterRealName: "조태형",
  personaName: "렌",
  personaGender: "male" as const,
});

type PinnedFile = {
  path: string;
  gitBlobSha: string;
};

export const CANONICAL_RP_QUALIFICATION_FILES = Object.freeze({
  promptDump: {
    path: "docs/audits/real-production-mid-chat-style-handoff-benchmark/requests/T1-prompt_dump.txt",
    gitBlobSha: "1a4a42d1485ff7a59318404f68373887b2406924",
  },
  openingAssistant: {
    path: "docs/audits/real-production-mid-chat-style-handoff-benchmark/raw/OPENING_ASSISTANT_VISIBLE.txt",
    gitBlobSha: "ed5d0c15f04d955c2489ba3b4603c947cad6bff1",
  },
  t1User: {
    path: "docs/audits/real-production-mid-chat-style-handoff-benchmark/raw/T1-USER_RAW.txt",
    gitBlobSha: "640ab85e0f839c9b01ef79f2335e6882d0598a12",
  },
  t1Assistant: {
    path: "docs/audits/real-production-mid-chat-style-handoff-benchmark/raw/T1-ASSISTANT_PERSISTED_VISIBLE.txt",
    gitBlobSha: "0ff2a1b86657b8fe0f2c3aa0fe7972ae759b003a",
  },
  t2User: {
    path: "docs/audits/real-production-mid-chat-style-handoff-benchmark/raw/T2-USER_RAW.txt",
    gitBlobSha: "9af60833f11172231e35c6effdcf4e5e5531e56a",
  },
} satisfies Record<string, PinnedFile>);

export const RP_QUALIFICATION_SITE_POLICY_OWNERS = Object.freeze({
  standardInteractive:
    "src/lib/userCoauthorState.ts#resolveEffectiveUserAuthoring + src/lib/noGodmodding.ts#buildUserCoauthorOwnerBlock",
  autoProgression: "src/lib/autoProgressionRules.ts#buildAutoProgressionUserControlBlock",
  oocDelegation: "src/lib/noGodmodding.ts#buildUserCoauthorOwnerBlock",
  currentTurnDelegation: "src/lib/currentTurnUserAuthoringDelegation.ts",
});

/**
 * Reviewer guidance only. These examples summarize the canonical owners above;
 * they are NOT a second runtime policy owner.
 */
export const STANDARD_INTERACTIVE_REVIEW_EXAMPLES = Object.freeze({
  allowedWhenGrounded: [
    "USER_PERSONA/creator canon/confirmed memory facts may be used as canon",
    "direct user-persona dialogue that fits persona and current scene",
    "externally observable important actions and local scene choices",
    "ordinary dialogue exchange, approach/retreat, hesitation, acceptance/refusal as local reactions",
    "short expression or gaze consistent with current input and canon",
    "involuntary reversible reaction caused by an immediate stimulus",
    "natural completion of an action the user already started",
    "NPC/AI-character observation, inference, misunderstanding, rumor, or hypothesis clearly framed as non-objective",
  ],
  notAllowedWithoutDelegation: [
    "private emotional conclusion, hidden desire, or inner POV asserted as objective fact",
    "irreversible user fate such as death, permanent loss, identity/species rewrite, or permanent disability",
    "unsupported long-term relationship/goal/affiliation/canon change",
    "fabricated prior event, preference, medical/body history, promise, or shared memory not grounded in persona/history/canon",
  ],
});

function computeGitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  return crypto
    .createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

function readPinned(rootDir: string, pinned: PinnedFile): string {
  const absolute = path.join(rootDir, pinned.path);
  const content = fs.readFileSync(absolute, "utf8");
  const actual = computeGitBlobSha(content);
  if (actual !== pinned.gitBlobSha) {
    throw new Error(
      `Canonical RP fixture drift: ${pinned.path} expected ${pinned.gitBlobSha}, got ${actual}`
    );
  }
  return content;
}

function extractPromptSection(promptDump: string, sectionId: string): string {
  const marker = `### [${sectionId}]`;
  const start = promptDump.indexOf(marker);
  if (start < 0) throw new Error(`Missing prompt section: ${sectionId}`);
  const bodyStart = promptDump.indexOf("\n", start);
  if (bodyStart < 0) throw new Error(`Malformed prompt section: ${sectionId}`);
  const next = promptDump.indexOf(
    "\n--------------------------------------------------------------------------------\n### ",
    bodyStart + 1
  );
  const history = promptDump.indexOf(
    "\n--------------------------------------------------------------------------------\n### HISTORY",
    bodyStart + 1
  );
  const candidates = [next, history].filter((v) => v >= 0);
  const end = candidates.length ? Math.min(...candidates) : promptDump.length;
  return promptDump.slice(bodyStart + 1, end).trim();
}

function unwrapPersona(identitySection: string): string {
  const marker = "[USER_PERSONA]";
  const idx = identitySection.indexOf(marker);
  if (idx < 0) throw new Error("Canonical persona section is missing [USER_PERSONA]");
  return identitySection.slice(idx + marker.length).trim();
}

export type CanonicalRpQualificationFixture = {
  characterSetting: string;
  persona: string;
  openingAssistant: string;
  productionTurn1User: string;
  productionTurn1AssistantReference: string;
  productionTurn2User: string;
};

export function loadCanonicalRpQualificationFixture(
  rootDir = process.cwd()
): CanonicalRpQualificationFixture {
  const promptDump = readPinned(rootDir, CANONICAL_RP_QUALIFICATION_FILES.promptDump);
  const openingAssistant = readPinned(
    rootDir,
    CANONICAL_RP_QUALIFICATION_FILES.openingAssistant
  ).trim();
  const productionTurn1User = readPinned(
    rootDir,
    CANONICAL_RP_QUALIFICATION_FILES.t1User
  ).trim();
  const productionTurn1AssistantReference = readPinned(
    rootDir,
    CANONICAL_RP_QUALIFICATION_FILES.t1Assistant
  ).trim();
  const productionTurn2User = readPinned(
    rootDir,
    CANONICAL_RP_QUALIFICATION_FILES.t2User
  ).trim();

  const characterSetting = extractPromptSection(promptDump, "character-core-identity");
  const persona = unwrapPersona(extractPromptSection(promptDump, "identity-and-rules"));

  if (!characterSetting.includes("조태형") || !characterSetting.includes("라이크")) {
    throw new Error("Canonical production character identity was not found");
  }
  if (!persona.includes("이름/호칭: 렌") || !persona.includes("신입 S급 가이드")) {
    throw new Error("Canonical production admin persona identity was not found");
  }

  return {
    characterSetting,
    persona,
    openingAssistant,
    productionTurn1User,
    productionTurn1AssistantReference,
    productionTurn2User,
  };
}

export type CanonicalQualificationCaseId =
  | "production_midchat_t1"
  | "persona_grounded_reaction"
  | "agency_boundary"
  | "false_canon_trap";

export type CanonicalQualificationCase = {
  id: CanonicalQualificationCaseId;
  targetResponseChars: number;
  history: { role: "user" | "assistant"; content: string }[];
  currentUserMessage: string;
  reviewFocus: string[];
};

export function buildCanonicalRpQualificationCases(
  rootDir = process.cwd()
): CanonicalQualificationCase[] {
  const f = loadCanonicalRpQualificationFixture(rootDir);
  const baseHistory = [
    { role: "user" as const, content: "[채팅 시작]" },
    { role: "assistant" as const, content: f.openingAssistant },
  ];

  return [
    {
      id: "production_midchat_t1",
      targetResponseChars: 3200,
      history: baseHistory,
      currentUserMessage: f.productionTurn1User,
      reviewFocus: [
        "character voice and Korean webnovel prose",
        "actual persona/canon grounding",
        "standard interactive user-authoring boundary",
        "latency/output-control/transport hygiene",
      ],
    },
    {
      id: "persona_grounded_reaction",
      targetResponseChars: 2200,
      history: baseHistory,
      currentUserMessage:
        '렌은 복잡한 단말기 화면을 한참 들여다본다. "이거 왜 이래? 설명 좀 해봐."',
      reviewFocus: [
        "do not penalize persona-grounded visible behavior merely because the model narrates the user persona",
        "the persona canon says 렌 is poor with machines and tilts his head when he does not understand",
        "private inner emotion or new important decision still requires the runtime owner to allow it",
      ],
    },
    {
      id: "agency_boundary",
      targetResponseChars: 2200,
      history: baseHistory,
      currentUserMessage:
        '렌은 태형이 내민 손과 얼굴을 번갈아 본다. "내가 그걸 순순히 잡을 것 같아?"',
      reviewFocus: [
        "NORMAL may co-author user-persona dialogue, observable important actions, and local acceptance/refusal when grounded in persona/current scene",
        "private inner POV and irreversible user fate remain outside NORMAL",
        "AI character may act proactively without inventing unsupported long-term canon or shared history",
      ],
    },
    {
      id: "false_canon_trap",
      targetResponseChars: 2200,
      history: baseHistory,
      currentUserMessage:
        '렌은 냉장고 문을 열어 안을 훑어본다. "내가 평소에 뭐 좋아하는지 기억하지? 아무거나 골라봐."',
      reviewFocus: [
        "persona-known preferences such as fruit, street food, and good food are grounded and may be used",
        "do not fabricate unsupported preferences, prior meals, medical/body history, work history, promises, or shared events",
        "distinguish canon fact from character inference or playful guess",
      ],
    },
  ];
}

/**
 * Current-main runtime builder.
 *
 * Character/persona identity is frozen to the real production snapshot above,
 * while user-control/prose/model adapters come from current main. This prevents
 * candidate tests from silently switching characters/personas while still
 * testing the rules users actually receive now.
 */
export function buildCanonicalRpQualificationContextInput(opts: {
  modelId: string;
  caseData: CanonicalQualificationCase;
  provider?: "cheaperinference" | "openrouter";
  rootDir?: string;
}): ContextBuildInput {
  const f = loadCanonicalRpQualificationFixture(opts.rootDir ?? process.cwd());
  const chunk: CharacterChunk = {
    id: "canonical-rp-qualification-character-10",
    characterId: String(CANONICAL_RP_QUALIFICATION_SOURCE.sourceCharacterId),
    content: f.characterSetting,
    category: "identity",
    importance: "CRITICAL",
    tokenCount: Math.ceil(f.characterSetting.length / 4),
    keywords: ["라이크", "조태형", "렌"],
  };

  return {
    charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
    contentKind: "character",
    chunks: [chunk],
    personaDisplayName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
    userNickname: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
    userPersona: f.persona,
    userPersonaGender: CANONICAL_RP_QUALIFICATION_SOURCE.personaGender,
    gender: "male",
    shortTermHistory: opts.caseData.history,
    currentUserMessage: opts.caseData.currentUserMessage,
    nsfw: true,
    provider: opts.provider ?? "cheaperinference",
    modelId: opts.modelId,
    targetResponseChars: opts.caseData.targetResponseChars,
    completedTurns: Math.max(
      1,
      opts.caseData.history.filter((m) => m.role === "assistant").length
    ),
    novelModeEnabled: false,
    isContinue: false,
    currentTurnAuthoringDelegation: resolveEffectiveUserAuthoring({
      persistentMode: "OFF",
      baseLevel: "NORMAL",
      currentUserInput: opts.caseData.currentUserMessage,
    }).delegation,
    narrativePov: { mode: "third_person", povCharacterName: "라이크" },
  };
}
