import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTO_PROGRESSION_BLOCK_TITLE,
  AUTO_PROGRESSION_CORE_ROLE,
  AUTO_PROGRESSION_POV_ASSERTIONS,
  AUTO_PROGRESSION_SCENE_USER_CONTROL,
  buildAutoProgressionAiCenteredBlock,
  buildAutoProgressionUserControlBlock,
} from "@/lib/autoProgressionRules";
import { buildContinueNarrativeCommand } from "@/lib/continueNarrative";
import { buildCoreMasterPrompt } from "@/lib/corePrompt";
import { buildNoGodmoddingBlock, resolveNoGodmoddingMode } from "@/lib/noGodmodding";
import { buildSceneDirectivePromptBlock } from "@/lib/sceneDirective";
import { buildCanonScopeKnowledgeBlock } from "@/lib/staticSystemRulesCanon";
import {
  resolveUserCoNarrationMode,
  userCoNarrationAllowsExternalAssist,
} from "@/lib/userCoNarrationMode";
import { buildNovelModeUserPersonaRules } from "@/lib/userPersonaNarrationRules";
import { resolveChatRuntimeMode } from "@/lib/chatRuntimeMode";
import { buildContext } from "@/services/contextBuilder";

const userCharacterName = "테스트_유저_캐릭터";
const aiCharacterName = "테스트_AI_캐릭터";

function assertNoNovelModeLeak(text: string) {
  assert.doesNotMatch(text, /NOVEL MODE/);
  assert.doesNotMatch(text, /USER PERSONA NARRATION RULES/);
  assert.doesNotMatch(text, /속마음까지 모두 주도적으로 서술/);
  assert.doesNotMatch(text, /CONTROLLED POSSESSION MODE — ACTIVE/);
  assert.doesNotMatch(text, /ROLE — 소설 모드 ON/);
  assert.doesNotMatch(text, /\[USER CONTROL MODE - NOVEL \/ EXPLICIT FULL\]/);
}

describe("auto progression vs novel mode separation", () => {
  it("legacy novelModeEnabled normalizes to limited_external auto progression", () => {
    assert.equal(
      resolveUserCoNarrationMode({ autoProgressionEnabled: true, novelModeEnabled: false }),
      "limited_external"
    );
    assert.equal(
      resolveUserCoNarrationMode({ autoProgressionEnabled: false, novelModeEnabled: true }),
      "limited_external"
    );
    assert.equal(resolveUserCoNarrationMode({ autoProgressionEnabled: false }), "off");
  });

  it("auto progression does not enable full novel POV", () => {
    const mode = resolveUserCoNarrationMode({
      autoProgressionEnabled: true,
      novelModeEnabled: false,
      oocUserImpersonationAllowed: false,
    });
    assert.equal(mode, "limited_external");
    assert.equal(userCoNarrationAllowsExternalAssist(mode), true);
  });

  it("OOC opt-in alone maps to limited_external", () => {
    assert.equal(
      resolveUserCoNarrationMode({
        autoProgressionEnabled: false,
        oocUserImpersonationAllowed: true,
        novelModeEnabled: false,
      }),
      "limited_external"
    );
  });

  it("resolveNoGodmoddingMode: continue and legacy novel → autoContinue", () => {
    assert.equal(
      resolveNoGodmoddingMode({ isContinue: true, novelModeEnabled: false }),
      "autoContinue"
    );
    assert.equal(
      resolveNoGodmoddingMode({ isContinue: true, novelModeEnabled: true }),
      "autoContinue"
    );
    assert.equal(
      resolveNoGodmoddingMode({ novelModeEnabled: true }),
      "autoContinue"
    );
    assert.equal(
      resolveNoGodmoddingMode({
        isContinue: true,
        impersonationOn: true,
        novelModeEnabled: false,
      }),
      "autoContinue"
    );
  });

  it("legacy novelModeEnabled maps to auto_progression runtime", () => {
    assert.equal(resolveChatRuntimeMode({ novelModeEnabled: true }), "auto_progression");
    assert.equal(resolveChatRuntimeMode({ isContinue: true }), "auto_progression");
  });
});

describe("auto progression prompt content", () => {
  it("contains no NOVEL MODE rules in authoritative block", () => {
    const block = buildAutoProgressionUserControlBlock();
    assertNoNovelModeLeak(block);
    assert.match(block, /\[AI_CAST\]/);
    assert.match(block, new RegExp(AUTO_PROGRESSION_BLOCK_TITLE.replace(/[[\]]/g, "\\$&")));
  });

  it("default LIMITED auto progression advances the world without taking over B", () => {
    const block = buildAutoProgressionUserControlBlock();
    assert.match(block, /\[B\]는 제한 모드/);
    assert.match(block, /새 직접 대사·중요한 자발적 행동·내면·불가역 결정을 대신하지 않는다/);
    assert.equal(AUTO_PROGRESSION_POV_ASSERTIONS.authorizesBExternalAction, false);
    assert.equal(AUTO_PROGRESSION_POV_ASSERTIONS.authorizesBDialogue, false);
    assert.equal(AUTO_PROGRESSION_POV_ASSERTIONS.authorizesBInnerPov, false);
    assert.equal(AUTO_PROGRESSION_POV_ASSERTIONS.aiFocalViewpointOwnerCount, 1);
  });

  it("NORMAL auto progression co-authors B external action/dialogue but not inner POV", () => {
    const block = buildAutoProgressionUserControlBlock({
      active: true,
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: false,
      allowIrreversibleFate: false,
      source: "chat_setting",
      duration: "persistent",
    });
    assert.match(block, /외부에서 관찰 가능한 행동/);
    assert.match(block, /대사를 공동 서술할 수 있다/);
    assert.match(block, /비공개 속마음·내면 독백/);
    assert.match(block, /정본에 없던 결정적 과거·비밀을 객관적 사실로 잠그거나/);
    assert.doesNotMatch(block, /빈 과거·비밀을 창작해 해당 branch의 사실로 발전시킬 수 있다/);
  });

  it("ALLOW auto progression may narrate B inner POV while preserving irreversible fate", () => {
    const block = buildAutoProgressionUserControlBlock({
      active: true,
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: true,
      allowIrreversibleFate: false,
      allowAiCastIrreversibleExpansion: true,
      source: "chat_setting",
      duration: "persistent",
    });
    assert.match(block, /속마음·내면 독백/);
    assert.match(block, /사망, 영구 장애·능력 상실/);
    assert.match(block, /명시적 전권 OOC 없이는 확정하지 않는다/);
    assert.match(block, /빈 과거·비밀을 창작해 해당 branch의 사실로 발전시킬 수 있다/);
    assert.match(block, /결혼·영구 이별·배신·조직 탈퇴·사망·능력 상실/);
  });

  it("inner-POV grant alone does not widen AI-cast irreversible history/outcomes", () => {
    const block = buildAutoProgressionUserControlBlock({
      active: true,
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: true,
      allowIrreversibleFate: false,
      allowAiCastIrreversibleExpansion: false,
      source: "explicit_ooc",
      duration: "persistent",
    });
    assert.match(block, /속마음·내면 독백/);
    assert.match(block, /정본에 없던 결정적 과거·비밀을 객관적 사실로 잠그거나/);
    assert.doesNotMatch(block, /빈 과거·비밀을 창작해 해당 branch의 사실로 발전시킬 수 있다/);
  });

  it("ALLOW keeps AI-cast irreversible freedom even when B coauthor is fully revoked", () => {
    const block = buildAutoProgressionUserControlBlock({
      active: false,
      allowDialogue: false,
      allowMajorActions: false,
      allowInnerPov: false,
      allowIrreversibleFate: false,
      allowAiCastIrreversibleExpansion: true,
      source: "explicit_ooc",
      duration: "persistent",
    });
    assert.match(block, /\[B\]는 제한 모드/);
    assert.match(block, /빈 과거·비밀을 창작해 해당 branch의 사실로 발전시킬 수 있다/);
    assert.match(block, /결혼·영구 이별·배신·조직 탈퇴·사망·능력 상실/);
  });

  it("ABSOLUTE auto progression may decide B irreversible fate and forbids unexplained resurrection", () => {
    const block = buildAutoProgressionUserControlBlock({
      active: true,
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: true,
      allowIrreversibleFate: true,
      allowAiCastIrreversibleExpansion: true,
      source: "explicit_ooc",
      duration: "persistent",
    });
    assert.match(block, /능력 상실·죽음 같은 불가역적 운명까지/);
    assert.match(block, /자동 복구하거나 되살리지 않는다/);
  });

  it("supports ensemble cast focalization", () => {
    const block = buildAutoProgressionAiCenteredBlock();
    assert.match(block, /\[AI_CAST\]/);
    assert.match(block, /능동적으로 진행/);
    assert.doesNotMatch(block, /기본 서술 시점은 \[A\]/);
  });

  it("continue command short-refs AI_CAST without novel rules", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: userCharacterName,
      charName: aiCharacterName,
      novelModeEnabled: true, // ignored / normalized elsewhere
    });
    assertNoNovelModeLeak(cmd);
    assert.match(cmd, /\[AI_CAST\]/);
    assert.match(cmd, /EFFECTIVE USER AUTHORING policy/);
    assert.doesNotMatch(cmd, /\[AUTO PROGRESSION — AI-FOCAL CO-NARRATION\]/);
  });

  it("buildNovelModeUserPersonaRules is not the auto progression path", () => {
    const novel = buildNovelModeUserPersonaRules(aiCharacterName, userCharacterName);
    assert.match(novel, /NOVEL MODE/);
    const auto = buildAutoProgressionUserControlBlock();
    assert.doesNotMatch(auto, /NOVEL MODE/);
  });

  it("CORE uses AI_CAST ensemble role", () => {
    const core = buildCoreMasterPrompt({
      charName: aiCharacterName,
      userName: userCharacterName,
      charGender: "other",
      userGender: "other",
      nsfwEnabled: false,
      impersonationOn: false,
      novelModeEnabled: false,
      autoProgressionEnabled: true,
      completedTurns: 3,
      hasMindReading: false,
      allowsBeard: false,
      allowsBodyHair: false,
    });
    assertNoNovelModeLeak(core);
    assert.match(core, /\[AI_CAST\]/);
    assert.equal(core.includes(AUTO_PROGRESSION_CORE_ROLE.split("\n")[0]!), true);
  });

  it("canon fragment uses AI_CAST on auto progression", () => {
    const canon = buildCanonScopeKnowledgeBlock({ autoProgressionEnabled: true });
    assertNoNovelModeLeak(canon);
    assert.match(canon, /\[AI_CAST\]/);
  });

  it("scene directive uses external ensemble wording", () => {
    const block = buildSceneDirectivePromptBlock({
      mode: "auto_progression",
      recentMessages: [],
      currentUserMessage: "자동진행",
    });
    assert.match(block, /USER AUTHORING owner/);
    assert.match(block, /내면/);
    assert.match(block, new RegExp(AUTO_PROGRESSION_SCENE_USER_CONTROL.slice(0, 20)));
  });

  it("interactive mode uses collaborative owner reference", () => {
    const core = buildCoreMasterPrompt({
      charName: aiCharacterName,
      userName: userCharacterName,
      charGender: "other",
      userGender: "other",
      nsfwEnabled: false,
      impersonationOn: false,
      novelModeEnabled: false,
      autoProgressionEnabled: false,
      completedTurns: 3,
      hasMindReading: false,
      allowsBeard: false,
      allowsBodyHair: false,
    });
    assert.match(core, /\[A\]=AI · \[B\]=user/);
    assert.match(core, /COLLABORATIVE INTERACTIVE/);
  });

  it("contextBuilder auto progression injects no novel / possession", () => {
    const built = buildContext({
      charName: aiCharacterName,
      chunks: [],
      userNickname: userCharacterName,
      userPersona: `이름/호칭: ${userCharacterName}`,
      shortTermHistory: [],
      currentUserMessage: buildContinueNarrativeCommand({
        personaName: userCharacterName,
        charName: aiCharacterName,
      }),
      nsfw: false,
      provider: "openrouter",
      isContinue: true,
      novelModeEnabled: false,
      userImpersonation: false,
      personaDisplayName: userCharacterName,
      completedTurns: 2,
    });
    assertNoNovelModeLeak(built.systemPrompt);
    assert.match(built.systemPrompt, /\[AI_CAST\]/);
    assert.match(built.systemPrompt, /EFFECTIVE USER AUTHORING/);
    assert.doesNotMatch(built.systemPrompt, /CONTROLLED POSSESSION MODE — ACTIVE/);
  });

  it("contextBuilder legacy novelModeEnabled injects auto owner only", () => {
    const built = buildContext({
      charName: aiCharacterName,
      chunks: [],
      userNickname: userCharacterName,
      userPersona: `이름/호칭: ${userCharacterName}`,
      shortTermHistory: [],
      currentUserMessage: "이어가줘",
      nsfw: false,
      provider: "openrouter",
      isContinue: false,
      novelModeEnabled: true,
      userImpersonation: false,
      personaDisplayName: userCharacterName,
      completedTurns: 2,
    });
    assertNoNovelModeLeak(built.systemPrompt);
    assert.match(built.systemPrompt, /EFFECTIVE USER AUTHORING/);
    assert.equal(
      built.systemPrompt.split("[AUTO PROGRESSION — EFFECTIVE USER AUTHORING]").length - 1,
      1
    );
  });

  it("godmodding autoContinue block is used for continue", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "autoContinue");
    assert.match(block, /EFFECTIVE USER AUTHORING/);
    assert.notEqual(
      block,
      buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "standard")
    );
  });

  it("production rule text has no fixture character names", () => {
    const corpus = [
      buildAutoProgressionUserControlBlock(),
      AUTO_PROGRESSION_CORE_ROLE,
      AUTO_PROGRESSION_SCENE_USER_CONTROL,
      buildContinueNarrativeCommand({ personaName: "x", charName: "y" }),
    ].join("\n");
    assert.doesNotMatch(corpus, /테스트_유저_캐릭터|테스트_AI_캐릭터/);
    assert.doesNotMatch(corpus, /백하율|체향|에카르트/);
  });
});
