import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";

import { COMMON_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import { buildChatOocRpContinuingUserPrompt } from "@/lib/chatOocPriority";
import { loadCharacterChunksForPromptReadOnly } from "@/lib/characterChunks";
import { replaceUserPlaceholder } from "@/lib/userPlaceholder";
import { resolveOpenRouterMaxTokens } from "@/lib/openRouterClient";
import { resolveEffectiveUserAuthoring } from "@/lib/userCoauthorState";
import {
  COMMON_PROSE_EMOTION_CUE_CANDIDATE,
  liveCommonProseEmotionCueBaseline,
} from "@/lib/mainRpFinalWireAudit";
import { buildContext } from "@/services/contextBuilder";
import {
  BODY_CUE_COMPARISON_REFS,
  BODY_CUE_PROPOSED_APPROVAL,
  HISTORICAL_RP_IDENTITY_HASHES,
  LIVE_ASSEMBLED_REQUEST_STATUS,
  LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS,
  LIVE_DEPLOYED_ROW_PROOF,
  LIVE_ROW_IDENTITY_STATUS,
  bodyCueInputCharacterId,
  bodyCueNextCallAllowed,
  buildBodyCueReviewPacket,
  buildLiveDeployedBodyCueContextInput,
  buildLiveDeployedBodyCueReviewPacket,
  payloadMatchesLiveDeployedRowProof,
  type LiveDeployedBodyCueRows,
} from "./mainRpBodyCuePreflight";
import {
  CANONICAL_RP_QUALIFICATION_FILES,
  CANONICAL_RP_QUALIFICATION_SOURCE,
  buildCanonicalRpQualificationCases,
  buildGreetingBodyCueReviewCases,
  loadCanonicalRpQualificationFixture,
} from "./rpModelQualificationFixture";

function publicSyntheticRows(overrides: {
  id?: number;
  name?: string;
  systemPrompt?: string;
  settingChunks?: string;
  settingChunksEn?: string;
  promptTranslationHash?: string;
  personaName?: string;
  userNickname?: string;
} = {}): LiveDeployedBodyCueRows {
  return {
    character: {
      id: overrides.id ?? 9001,
      name: overrides.name ?? "감사픽스처",
      gender: "male",
      system_prompt: overrides.systemPrompt ?? "공개 테스트 캐릭터. 본부 숙소에서 대기한다.",
      world: "테스트 세계. 본부 숙소가 있다.",
      example_dialog: "감사픽스처: 앉아.",
      description: "짧게 말한다.",
      greeting: "감사픽스처는 숙소 안을 한 번 둘러보고 고개를 끄덕였다.",
      setting_chunks: overrides.settingChunks ?? "[]",
      setting_chunks_en: overrides.settingChunksEn ?? "[]",
      prompt_translation_hash: overrides.promptTranslationHash,
      speech_profile: "",
      creator_compiled_description_json: "",
      appearance_raw: "",
      appearance_compiled: "",
      narration_style_instructions: "",
      content_kind: "character",
    },
    persona: {
      name: overrides.personaName ?? "렌",
      gender: "male",
      description: "공개 테스트 페르소나. 신입 가이드.",
    },
    userNickname: overrides.userNickname,
  };
}

describe("Main RP body-cue preflight", () => {
  const packet = buildBodyCueReviewPacket();

  it("keeps the candidate clause out of the production prose owner", () => {
    const source = fs.readFileSync("src/lib/advancedProseNsfwGuidelines.ts", "utf8");
    assert.equal(source.includes("COMMON_PROSE_EMOTION_CUE_CANDIDATE"), false);
    assert.equal(source.includes("COMMON_PROSE_EMOTION_CUE_BASELINE"), false);
    assert.equal(source.includes("COMMON_PROSE_FORWARD_MOTION"), false);
    assert.equal(source.includes("replaceCommonProseEmotionCue"), false);
    assert.equal(COMMON_PROSE_BLOCK.includes(liveCommonProseEmotionCueBaseline()), true);
    assert.equal(COMMON_PROSE_BLOCK.includes(COMMON_PROSE_EMOTION_CUE_CANDIDATE), false);
  });

  it("keeps the qualification case list and adds two review scenes beside it", () => {
    assert.deepEqual(
      buildCanonicalRpQualificationCases().map((entry) => entry.id),
      [
        "production_midchat_t1",
        "persona_grounded_reaction",
        "agency_boundary",
        "false_canon_trap",
        "memory_current_state_priority",
        "memory_false_shared_event",
      ]
    );
    assert.deepEqual(
      packet.scenes.map((scene) => scene.id),
      ["quiet_window_safe", "relationship_turn_safe"]
    );
    assert.equal(packet.providerCalls, 0);
    assert.equal(packet.modelId, "deepseek-v4.1-flash");
    assert.equal(packet.authoringLevel, "NORMAL");
    assert.equal(packet.nsfw, false);
    assert.notEqual(packet.scenes[0]?.userTurnSha256, packet.scenes[1]?.userTurnSha256);
    assert.notEqual(packet.scenes[0]?.promptUserSha256, packet.scenes[1]?.promptUserSha256);
    assert.equal(packet.evidence.source, "HISTORICAL_PINNED");
    assert.equal(bodyCueInputCharacterId(packet), 10);
    assert.equal("source" in packet, false);
    assert.equal(packet.evidence.liveRowIdentity, LIVE_ROW_IDENTITY_STATUS);
    assert.equal(packet.evidence.liveAssembledRequest, LIVE_ASSEMBLED_REQUEST_STATUS);
    assert.equal(packet.proseOwnerUnchanged, true);
    if (packet.evidence.source !== "HISTORICAL_PINNED") {
      throw new Error("expected historical evidence");
    }
    assert.equal(packet.evidence.historicalSourceCharacterId, 10);
    assert.equal(packet.evidence.recordedLiveRow.characterId, 18);
    assert.equal(packet.evidence.recordedLiveRow.deployedCommit, LIVE_DEPLOYED_ROW_PROOF.deployedCommit);
    assert.notEqual(
      packet.mainCommit,
      packet.evidence.recordedLiveRow.deployedCommit
    );
    assert.equal(packet.mainCommit, BODY_CUE_COMPARISON_REFS.historicalProseOwnerCommit);
    assert.equal(BODY_CUE_COMPARISON_REFS.liveDeployedCommit, LIVE_DEPLOYED_ROW_PROOF.deployedCommit);
    assert.equal(packet.evidence.recordedLiveRow.englishLayerPresent, true);
    assert.equal(packet.evidence.recordedLiveRow.englishLayerApplied, "UNVERIFIED");
    assert.equal(packet.evidence.assemblyGaps.liveSourceTextAssembled, false);
    assert.equal(CANONICAL_RP_QUALIFICATION_SOURCE.sourceCharacterId, 10);
    assert.notEqual(LIVE_DEPLOYED_ROW_PROOF.characterId, 10);
    assert.equal(LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS.englishLayerApplied, "UNVERIFIED");
  });

  it("keeps the 2026-08-25 dump hashes and only records live row hashes beside them", () => {
    const fixture = loadCanonicalRpQualificationFixture();
    const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
    assert.equal(sha(fixture.characterSetting), HISTORICAL_RP_IDENTITY_HASHES.characterCoreSha256);
    assert.equal(sha(fixture.persona), HISTORICAL_RP_IDENTITY_HASHES.personaSha256);
    assert.equal(sha(fixture.openingAssistant), HISTORICAL_RP_IDENTITY_HASHES.openingSha256);
    assert.equal(sha(fixture.openingAssistant), LIVE_DEPLOYED_ROW_PROOF.greetingSha256);
    assert.notEqual(sha(fixture.persona), LIVE_DEPLOYED_ROW_PROOF.personaPublicSha256);
    assert.notEqual(sha(fixture.characterSetting), LIVE_DEPLOYED_ROW_PROOF.systemPromptSha256);
    if (packet.evidence.source !== "HISTORICAL_PINNED") {
      throw new Error("expected historical evidence");
    }
    assert.equal(packet.evidence.historicalHashes.openingSha256, sha(fixture.openingAssistant));
    assert.equal(packet.evidence.historicalHashes.characterCoreSha256, sha(fixture.characterSetting));
    assert.equal(packet.evidence.historicalHashes.personaSha256, sha(fixture.persona));
    assert.equal(bodyCueInputCharacterId(packet), 10);
    assert.equal(CANONICAL_RP_QUALIFICATION_FILES.openingAssistant.gitBlobSha, "ed5d0c15f04d955c2489ba3b4603c947cad6bff1");
    assert.equal(CANONICAL_RP_QUALIFICATION_FILES.promptDump.gitBlobSha, "1a4a42d1485ff7a59318404f68373887b2406924");
  });

  it("sends the two OOC scenes through the live continuing-prompt owner", () => {
    for (const scene of packet.scenes) {
      assert.equal(scene.productionTurn.intent, "rp_continuing", scene.id);
      assert.equal(
        scene.productionTurn.promptUserMessage,
        buildChatOocRpContinuingUserPrompt(scene.currentUserMessage),
        scene.id
      );
      assert.equal(scene.productionTurn.policyUserMessage, scene.currentUserMessage, scene.id);
      assert.equal(scene.sceneControlMatchesPolicy, true, scene.id);
      assert.equal(scene.assembledUserCarriesScene, true, scene.id);
      assert.match(scene.productionTurn.promptUserMessage, /^\[SYSTEM: CHAT OOC/);
      assert.match(scene.productionTurn.promptUserMessage, /OOC:/);
      const normalDelegation = resolveEffectiveUserAuthoring({
        persistentMode: "OFF",
        baseLevel: "NORMAL",
        currentUserInput: "렌은 창을 본다.",
      }).delegation;
      assert.deepEqual(scene.productionTurn.delegation, normalDelegation, scene.id);
      assert.equal(scene.productionTurn.delegation.source, "chat_setting", scene.id);
      assert.equal(scene.productionTurn.runtimeMode, "current_turn_ooc_delegated", scene.id);
    }
  });

  it("changes only the emotion-cue clause on the pinned character request", () => {
    const expectedDelta =
      COMMON_PROSE_EMOTION_CUE_CANDIDATE.length - liveCommonProseEmotionCueBaseline().length;
    for (const scene of packet.scenes) {
      assert.equal(scene.soleAllowedDiff, true, scene.id);
      assert.equal(scene.flatCharDelta, expectedDelta, scene.id);
      assert.equal(scene.baseline.cached.join(), "true,true,false", scene.id);
      assert.equal(scene.candidate.cached.join(), "true,true,false", scene.id);
      assert.doesNotMatch(scene.currentUserMessage, /권태현|에녹|솔|플러드|로코/);
      assert.match(scene.currentUserMessage, /다른 인물은 없다/);
    }
  });

  it("separates the budget estimate from the ungranted stop check", () => {
    const cost = packet.cost.budgetEstimate;
    assert.equal(cost.kind, "budget_estimate");
    assert.equal(cost.enforceable, false);
    assert.equal(cost.calls, 4);
    assert.equal(cost.cacheReadTokens, 0);
    assert.equal(cost.inputUsdPerMillion, 0.3);
    assert.equal(cost.outputUsdPerMillion, 1.2);
    assert.equal(cost.cacheReadUsdPerMillion, 0.006);
    assert.equal(cost.targetMargin, 0.6);
    assert.equal(cost.publishedAt, "2026-09-21T00:00:00.000Z");
    assert.equal(cost.outputTokenCeiling, 8192);
    assert.equal(cost.promptTokenCeiling, cost.largerPromptChars * 2);
    assert.equal(cost.maxTokensSent, false);
    assert.equal(resolveOpenRouterMaxTokens(3200, undefined, packet.modelId), undefined);
    const perCall =
      (cost.promptTokenCeiling / 1_000_000) * 0.3 + (8192 / 1_000_000) * 1.2;
    assert.equal(cost.providerUsd, perCall * 4);
    assert.equal(
      cost.userChargeKrw,
      (cost.providerUsd * cost.fx.effectiveKrwPerUsd) / (1 - 0.6)
    );
    assert.equal(packet.cost.supplierRoute.provider, "cheaperinference");
    assert.equal(packet.cost.supplierRoute.expectedProviderModelId, "deepseek-v4.1-flash");
    assert.equal(packet.cost.supplierRoute.liveCatalogFetched, false);
    assert.equal(packet.cost.approvalBound.granted, false);
    assert.equal(packet.cost.stop.productionMaxTokensOmitted, true);
    assert.equal(packet.cost.stop.singleCallCanExceedBound, true);
    assert.equal(
      bodyCueNextCallAllowed({
        approvedProviderUsd: null,
        observedProviderUsd: 0,
        nextCallWorstCaseUsd: perCall,
      }),
      false
    );
    assert.equal(
      bodyCueNextCallAllowed({
        approvedProviderUsd: BODY_CUE_PROPOSED_APPROVAL.providerUsd,
        observedProviderUsd: 0,
        nextCallWorstCaseUsd: perCall,
      }),
      true
    );
    assert.equal(
      bodyCueNextCallAllowed({
        approvedProviderUsd: BODY_CUE_PROPOSED_APPROVAL.providerUsd,
        observedProviderUsd: 0.99,
        nextCallWorstCaseUsd: perCall,
      }),
      false
    );
  });

  it("does not stamp deploy-18 verification onto a synthetic id 9001 packet", () => {
    const synthetic = buildLiveDeployedBodyCueReviewPacket(publicSyntheticRows());
    assert.equal(synthetic.evidence.source, "SYNTHETIC");
    assert.equal(synthetic.evidence.liveRowIdentity, "NOT_CLAIMED");
    assert.equal(synthetic.evidence.liveAssembledRequest, "NOT_CLAIMED");
    assert.equal("deployedCharacterId" in synthetic.evidence, false);
    assert.equal("deployedCommit" in synthetic.evidence, false);
    assert.equal("uniqueAdminRen" in synthetic.evidence, false);
    assert.equal("hashes" in synthetic.evidence, false);
    assert.notEqual(synthetic.evidence.source, "LIVE_VERIFIED");
    if (synthetic.evidence.source !== "SYNTHETIC") {
      throw new Error("expected synthetic evidence");
    }
    assert.equal(synthetic.evidence.inputCharacterId, 9001);
    assert.equal(bodyCueInputCharacterId(synthetic), 9001);
    assert.equal("source" in synthetic, false);
    assert.equal("historicalSourceCharacterId" in synthetic.evidence, false);
    assert.notEqual(bodyCueInputCharacterId(synthetic), 10);
    assert.equal(synthetic.evidence.syntheticUsedEnglish, false);
    assert.equal(payloadMatchesLiveDeployedRowProof(publicSyntheticRows()), false);
  });

  it("does not mark id-18 name-matched rows LIVE_VERIFIED without payload hashes", () => {
    const idOnly = publicSyntheticRows({
      id: 18,
      name: "라이크",
      personaName: "렌",
    });
    assert.equal(payloadMatchesLiveDeployedRowProof(idOnly), false);
    const claimed = buildLiveDeployedBodyCueReviewPacket(idOnly, { source: "LIVE_VERIFIED" });
    assert.equal(claimed.evidence.source, "SYNTHETIC");
    assert.equal(claimed.evidence.liveRowIdentity, "NOT_CLAIMED");
    assert.equal(claimed.evidence.liveAssembledRequest, "NOT_CLAIMED");
    assert.equal(bodyCueInputCharacterId(claimed), 18);
    assert.notEqual(bodyCueInputCharacterId(claimed), 10);
    assert.equal("deployedCommit" in claimed.evidence, false);
    assert.notEqual(claimed.evidence.source, "LIVE_VERIFIED");
  });

  it("substitutes {{user}} with the production persona-then-nickname split", () => {
    const rows = publicSyntheticRows({
      systemPrompt: "공개 테스트 캐릭터. {{user}}은 본부 숙소에서 대기한다.",
      personaName: "렌",
      userNickname: "공개닉네임",
    });
    const splitNames = replaceUserPlaceholder(
      "{{user}}은 본부 숙소에서 대기한다.",
      rows.persona.name,
      rows.userNickname ?? ""
    );
    const bothPersonaNames = replaceUserPlaceholder(
      "{{user}}은 본부 숙소에서 대기한다.",
      rows.persona.name,
      rows.persona.name
    );
    assert.equal(splitNames, "렌은 본부 숙소에서 대기한다.");
    assert.equal(splitNames, bothPersonaNames);
    const auditReadOnly = loadCharacterChunksForPromptReadOnly(
      rows.character,
      rows.persona.name,
      rows.userNickname ?? ""
    );
    assert.equal(
      auditReadOnly.chunks.some((chunk) => chunk.content.includes("렌은 본부 숙소에서 대기한다.")),
      true
    );
    assert.equal(
      auditReadOnly.chunks.some((chunk) => chunk.content.includes("공개닉네임")),
      false
    );
    const caseData = buildGreetingBodyCueReviewCases(rows.character.greeting ?? "")[0];
    if (!caseData) throw new Error("expected greeting case");
    const input = buildLiveDeployedBodyCueContextInput({ rows, caseData });
    assert.equal(input.personaDisplayName, "렌");
    assert.equal(input.userNickname, "공개닉네임");
    assert.equal(
      input.chunks.some((chunk) => chunk.content.includes("렌은 본부 숙소에서 대기한다.")),
      true
    );
    assert.equal(
      input.chunks.some((chunk) => chunk.content.includes("{{user}}")),
      false
    );
  });

  it("remaps cheaperinference context to the same openrouter split for this model", () => {
    const rows = publicSyntheticRows();
    const caseData = buildGreetingBodyCueReviewCases(rows.character.greeting ?? "")[0];
    if (!caseData) throw new Error("expected greeting case");
    const cheaperInput = buildLiveDeployedBodyCueContextInput({ rows, caseData });
    assert.equal(cheaperInput.provider, "cheaperinference");
    const cheaper = buildContext(cheaperInput);
    const openrouter = buildContext({ ...cheaperInput, provider: "openrouter" });
    assert.equal(cheaper.systemPrompt, openrouter.systemPrompt);
    assert.deepEqual(cheaper.openRouterSystemSplit, openrouter.openRouterSystemSplit);
    assert.equal(cheaper.meta.runtimeMode, openrouter.meta.runtimeMode);
  });

  it("does not treat synthetic usedEnglish=false as production English evidence", () => {
    const withEnglishBytes = publicSyntheticRows({
      settingChunksEn: JSON.stringify([
        {
          id: "synthetic-en",
          characterId: "9001",
          content: "Public English fixture. Not a live row.",
          category: "identity",
          importance: "CRITICAL",
          tokenCount: 8,
          keywords: [],
        },
      ]),
    });
    const live = buildLiveDeployedBodyCueReviewPacket(withEnglishBytes);
    assert.equal(live.usedEnglish, false);
    if (live.evidence.source !== "SYNTHETIC") {
      throw new Error("expected synthetic evidence");
    }
    assert.equal(live.evidence.syntheticUsedEnglish, false);
    assert.equal(LIVE_DEPLOYED_ROW_PROOF.englishLayerPresent, true);
    assert.equal(LIVE_DEPLOYED_ROW_PROOF.englishLayerApplied, "UNVERIFIED");
    assert.equal(LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS.fieldsNotFilled.includes("prompt_translation_hash"), true);
    assert.equal(
      LIVE_ASSEMBLED_REQUEST_UNVERIFIED_GAPS.fieldsNotFilled.includes("setting_chunks_en application"),
      true
    );
  });

  it("assembles the live-row path through the same owners and changes only the cue", () => {
    const expectedDelta =
      COMMON_PROSE_EMOTION_CUE_CANDIDATE.length - liveCommonProseEmotionCueBaseline().length;
    const live = buildLiveDeployedBodyCueReviewPacket(publicSyntheticRows());
    assert.deepEqual(
      live.scenes.map((scene) => scene.id),
      ["quiet_window_safe", "relationship_turn_safe"]
    );
    assert.equal(bodyCueInputCharacterId(live), 9001);
    assert.equal("source" in live, false);
    assert.equal(live.nsfw, false);
    assert.equal(live.authoringLevel, "NORMAL");
    assert.equal(live.usedEnglish, false);
    assert.equal(live.evidence.source, "SYNTHETIC");
    assert.notEqual(live.cost.budgetEstimate.largerPromptChars, packet.cost.budgetEstimate.largerPromptChars);
    for (const scene of live.scenes) {
      assert.equal(scene.soleAllowedDiff, true, scene.id);
      assert.equal(scene.flatCharDelta, expectedDelta, scene.id);
      assert.equal(scene.baseline.cached.join(), "true,true,false", scene.id);
      assert.equal(scene.candidate.cached.join(), "true,true,false", scene.id);
      assert.equal(scene.baseline.safeContract, true, scene.id);
      assert.equal(scene.baseline.normalAuthoring, true, scene.id);
      assert.equal(scene.assembledUserCarriesScene, true, scene.id);
      assert.equal(scene.currentUserMessage, packet.scenes.find((row) => row.id === scene.id)?.currentUserMessage);
    }
  });

  it("does not open getDb or write a selected persona on the live-row path", () => {
    const source = [
      fs.readFileSync("scripts/lib/mainRpBodyCuePreflight.ts", "utf8"),
      fs.readFileSync("scripts/lib/rpModelQualificationFixture.ts", "utf8"),
    ].join("\n");
    assert.equal(source.includes("getDb("), false);
    assert.equal(source.includes("resolveChatSelectedPersona"), false);
    assert.equal(source.includes("ensureDefaultPublicPersona"), false);
    assert.equal(source.includes("loadCharacterChunksForPrompt("), false);
    assert.match(source, /loadCharacterChunksForPromptReadOnly/);
    assert.match(source, /formatPublicPersonaForPrompt/);
    assert.match(source, /personaDisplayName/);
    assert.match(source, /userNickname/);
    assert.equal(source.includes("LIVE_IDENTITY_UNVERIFIED"), false);
    assert.equal(source.includes("source: CANONICAL_RP_QUALIFICATION_SOURCE"), false);
  });
});
