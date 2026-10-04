import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
} from "@/lib/chatModels";
import { INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION } from "@/lib/currentTurnUserAuthoringDelegation";
import {
  resolveProviderRawPoolExchangeCount,
  resolveProviderRawTrimFloorExchanges,
  shouldIncludeOpeningInProviderRaw,
  splitOpeningPlayableTurns,
  type DialogueTurn,
} from "@/lib/hybridMemory";
import { resolveNarrativePov } from "@/lib/narrativePov";
import { buildContext } from "@/services/contextBuilder";
import {
  assembleLegacyProductionContextBuildInput,
  prepareLegacyProductionNextTurnHistory,
  sharedOwnerArgsFromLegacyFixture,
  type FrozenLegacyProductionMapperInput,
} from "@/services/nextTurnAssemblyPreparation.legacyProductionMapper.fixture";
import {
  assembleNextTurnContextBuildInput,
  prepareNextTurnHistory,
} from "@/services/nextTurnAssemblyPreparation";
import type { CharacterChunk } from "@/types";

const CHUNK: CharacterChunk = {
  id: "c1",
  characterId: "16",
  content: "등대지기 솔. IDENTITY_CHUNK",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 12,
  keywords: ["솔"],
};

function baseCharacter() {
  return {
    id: 16,
    name: "솔",
    description: "등대지기.",
    system_prompt: "너는 솔이다.",
    world: "항구의 등대.",
    example_dialog: "안녕, 여행자.",
    greeting: "등대가 깜빡인다.",
    gender: "female",
    content_kind: "character",
    speech_profile: JSON.stringify({ personality: "낮고 짧은 말." }),
    narration_style_instructions: "",
    jsx_components_json: "",
  };
}

function baseTurns(): DialogueTurn[] {
  return [
    { user: "", assistant: "FIRST_TURN_GREETING 등대가 깜빡인다.", assistantOnly: true },
    { user: "문을 두드린다.", assistant: "문이 살짝 열린다." },
  ];
}

function identitySnapshot(built: ReturnType<typeof buildContext>) {
  return {
    systemPrompt: built.systemPrompt,
    history: built.history,
    openRouterSystemSplit: built.openRouterSystemSplit ?? null,
    totalAssembledTokens: built.meta.promptAudit?.totalAssembledTokens ?? null,
    trackedSectionIds: (built.meta.trackedSections ?? []).map((section) => section.id),
    trackedSectionHash: createHash("sha256")
      .update(
        JSON.stringify((built.meta.trackedSections ?? []).map((section) => [section.id, section.text]))
      )
      .digest("hex"),
    sectionFingerprint: built.meta.sectionFingerprint ?? null,
  };
}

function buildLegacyAndShared(fixture: FrozenLegacyProductionMapperInput) {
  const narrativePov = resolveNarrativePov({
    mode: fixture.chat.narrative_pov,
    contentKind: fixture.character.content_kind === "simulation" ? "simulation" : "character",
    mainCharacterName: fixture.character.name,
    povCharacterName: fixture.chat.pov_character_name,
  });
  const history = {
    canonicalRecentHistoryFull: fixture.promptHistory,
    coverageProtectedHistory: fixture.promptHistory,
    promptHistory: fixture.promptHistory,
    completedTurns: fixture.playableTurnCount,
    completedTurnsForMemoryCoverage: fixture.completedTurnsForMemoryCoverage,
    summarizedTurnCount: fixture.summarizedTurnCount,
    historyMinTurnFloor: fixture.historyMinTurnFloor,
    providerHistoryAbsoluteTurnFloor: fixture.providerHistoryAbsoluteTurnFloor,
    providerHistoryProtectOpening: fixture.protectOpening,
    providerHistoryMinRealPlayableExchanges: fixture.providerRawTrimFloor,
    providerRawPoolExchangeCount: 8,
    historyTokenBudget: 10000,
  };
  const sections = {
    narrativePov,
    statusWidgetActive: fixture.statusWidgetActive,
    keywordLorebookBlock: fixture.keywordLorebookBlock || "",
    userLorebookBlock: fixture.userLorebookBlock || "",
    globalLorebookBlock: fixture.globalLorebookBlock || "",
    relationshipMemory: fixture.relationshipMemoryForPrompt || "",
    privateSpeechControlBlock: fixture.privateSpeechControlBlock || "",
    jsxComponentCatalogJson: fixture.character.jsx_components_json ?? "",
    creatorNarrationStyle: fixture.character.narration_style_instructions ?? "",
    focusMaxChars: fixture.focusMaxChars,
  };
  const legacyMapped = assembleLegacyProductionContextBuildInput(fixture);
  const sharedMapped = assembleNextTurnContextBuildInput(
    sharedOwnerArgsFromLegacyFixture(fixture, history, sections)
  );
  const legacy = buildContext({
    ...legacyMapped,
    statusWidgetActive: fixture.statusWidgetActive,
    mainModelOwnsRelationshipExtract: false,
  });
  const shared = buildContext({
    ...sharedMapped,
    statusWidgetActive: fixture.statusWidgetActive,
    mainModelOwnsRelationshipExtract: false,
  });
  return { legacy, shared, legacyMapped, sharedMapped };
}

function normalSafeFixture(): FrozenLegacyProductionMapperInput {
  return {
    character: baseCharacter(),
    user: { id: 9, nickname: "여행자" },
    chat: { id: 44, narrative_pov: "third_person", pov_character_name: "" },
    chunks: [CHUNK],
    exampleDialog: "안녕, 여행자.",
    userPersona: "여행자. 항구에 막 도착했다.",
    userNote: "",
    memoryFeatureOn: false,
    promptHistory: [
      { role: "assistant", content: "FIRST_TURN_GREETING 등대가 깜빡인다." },
      { role: "user", content: "문을 두드린다." },
      { role: "assistant", content: "문이 살짝 열린다." },
    ],
    currentUserMessage: "불을 켠다.",
    currentTurnAuthoringDelegation: INACTIVE_CURRENT_TURN_AUTHORING_DELEGATION,
    nsfw: false,
    activeConsentMode: "standard",
    assetTags: [],
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    novelModeEnabled: false,
    personaDisplayName: "여행자",
    targetResponseChars: 1500,
    userPersonaGender: "other",
    isContinue: false,
    regenerate: false,
    playableTurnCount: 1,
    completedTurnsForMemoryCoverage: 1,
    summarizedTurnCount: 0,
    historyMinTurnFloor: 4,
    providerHistoryAbsoluteTurnFloor: 4,
    protectOpening: true,
    providerRawTrimFloor: 4,
    adultHandoffRequiredTurnFloor: 0,
    focusMaxChars: 400,
    statusWidgetActive: false,
  };
}

describe("production old/new prompt semantic identity", () => {
  it("legacy mapper fixture stays test-only", () => {
    const owners = [
      "src/app/api/chat/route.ts",
      "src/services/nextTurnAssemblyPreparation.ts",
      "src/services/modelPickerInputSnapshot.ts",
      "src/services/mainRpNextTurnEstimate.ts",
    ];
    for (const rel of owners) {
      const source = fs.readFileSync(path.join(process.cwd(), rel), "utf8");
      assert.doesNotMatch(source, /legacyProductionMapper/);
    }
  });

  it("PRE-FIX: omitting a mapped field makes the oracle fail", () => {
    const fixture = normalSafeFixture();
    fixture.userNote = "USER_NOTE_등대 열쇠를 찾아라.";
    const { shared } = buildLegacyAndShared(fixture);
    const broken = assembleLegacyProductionContextBuildInput(fixture);
    delete (broken as { userNote?: string | null }).userNote;
    const brokenBuilt = buildContext({
      ...broken,
      statusWidgetActive: fixture.statusWidgetActive,
      mainModelOwnsRelationshipExtract: false,
    });
    assert.notEqual(brokenBuilt.systemPrompt, shared.systemPrompt);
    assert.notDeepEqual(identitySnapshot(brokenBuilt), identitySnapshot(shared));
  });

  it("A NORMAL_SAFE legacy mapper equals shared owner after buildContext", () => {
    const { legacy, shared } = buildLegacyAndShared(normalSafeFixture());
    assert.deepEqual(identitySnapshot(shared), identitySnapshot(legacy));
  });

  it("B STATUS_POLICY active widget and user note stay identical", () => {
    const fixture = normalSafeFixture();
    fixture.statusWidgetActive = true;
    fixture.userNote = "STATUS_POLICY 체력과 호감도를 유지한다.";
    const { legacy, shared } = buildLegacyAndShared(fixture);
    assert.deepEqual(identitySnapshot(shared), identitySnapshot(legacy));
  });

  it("C FULL_PERSISTED_CONTEXT memory/lore/jsx/pov/narration stay identical", () => {
    const fixture = normalSafeFixture();
    fixture.memoryFeatureOn = true;
    fixture.longTermMemory = "LTM 솔은 여행자를 기억한다.";
    fixture.mediumTermMemoryBlock = "MTM 어제 항구에서 만났다.";
    fixture.archiveMemory = "ARCHIVE 오래된 등대 일지.";
    fixture.keywordLorebookBlock = "KEYWORD_LORE 등대는 항상 켜져 있다.";
    fixture.userLorebookBlock = "USER_LORE 여행자는 비를 싫어한다.";
    fixture.globalLorebookBlock = "GLOBAL_LORE 항구에는 안개가 잦다.";
    fixture.relationshipMemoryForPrompt = "RELATION 솔과 여행자는 처음이다.";
    fixture.character.jsx_components_json = JSON.stringify([{ id: "lamp", label: "등불" }]);
    fixture.character.narration_style_instructions = "NARRATION 짧고 건조하게.";
    fixture.chat.narrative_pov = "first_person";
    fixture.privateSpeechControlBlock = "SPEECH 낮고 짧게.";
    const { legacy, shared } = buildLegacyAndShared(fixture);
    assert.deepEqual(identitySnapshot(shared), identitySnapshot(legacy));
  });

  it("D ALTERNATE_LIFECYCLE regenerate path stays identical", () => {
    const fixture = normalSafeFixture();
    fixture.regenerate = true;
    fixture.rejectedAssistantDraft = "REJECTED 문이 열리지 않는다.";
    fixture.regenAttemptId = "regen-1";
    fixture.relocateSceneDirectiveToUserTurn = true;
    fixture.sceneDirectiveBlock = "SCENE 안개가 밀려온다.";
    const { legacy, shared } = buildLegacyAndShared(fixture);
    assert.deepEqual(identitySnapshot(shared), identitySnapshot(legacy));
  });

  it("history owner matches frozen main history prep", () => {
    const turns = baseTurns();
    const unsummarized = 1;
    const pool = resolveProviderRawPoolExchangeCount({
      memoryFeatureEnabled: false,
      completedTurns: 1,
      summarizedTurnCount: 0,
    });
    const floor = resolveProviderRawTrimFloorExchanges(unsummarized);
    const { opening, playable } = splitOpeningPlayableTurns(turns);
    const protectOpening = shouldIncludeOpeningInProviderRaw({
      opening,
      summarizedTurnCount: 0,
      memoryFeatureEnabled: false,
      playableCount: playable.length,
    });
    const args = {
      turns,
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      provider: "openrouter" as const,
      memoryFeatureOn: false,
      completedTurnsForMemoryCoverage: 1,
      summarizedTurnCount: 0,
      personaDisplayName: "여행자",
      userNickname: "여행자",
      providerRawPoolExchangeCount: pool,
      providerRawTrimFloor: floor,
      protectOpening,
    };
    const legacy = prepareLegacyProductionNextTurnHistory(args);
    const shared = prepareNextTurnHistory(args);
    assert.deepEqual(shared.canonicalRecentHistoryFull, legacy.canonicalRecentHistoryFull);
    assert.deepEqual(shared.coverageProtectedHistory, legacy.coverageProtectedHistory);
    assert.equal(shared.historyMinTurnFloor, legacy.historyMinTurnFloor);
    assert.equal(shared.providerHistoryAbsoluteTurnFloor, legacy.providerHistoryAbsoluteTurnFloor);
    assert.equal(shared.historyTokenBudget, legacy.historyTokenBudget);
  });
});
