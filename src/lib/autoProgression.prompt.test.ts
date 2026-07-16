import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTO_PROGRESSION_BLOCK_TITLE,
  AUTO_PROGRESSION_CORE_ROLE,
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
}

describe("auto progression vs novel mode separation", () => {
  it("isContinue does not force novelModeEnabled (co-narration mode)", () => {
    assert.equal(
      resolveUserCoNarrationMode({ autoProgressionEnabled: true, novelModeEnabled: false }),
      "limited_external"
    );
    assert.equal(
      resolveUserCoNarrationMode({ autoProgressionEnabled: true, novelModeEnabled: true }),
      "explicit_full"
    );
    assert.equal(resolveUserCoNarrationMode({ autoProgressionEnabled: false }), "off");
  });

  it("auto progression does not enable full user impersonation", () => {
    const mode = resolveUserCoNarrationMode({
      autoProgressionEnabled: true,
      novelModeEnabled: false,
      oocUserImpersonationAllowed: false,
    });
    assert.equal(mode, "limited_external");
    assert.equal(userCoNarrationAllowsExternalAssist(mode), true);
    assert.notEqual(mode, "explicit_full");
  });

  it("auto progression resolves to limited_external co-narration", () => {
    assert.equal(
      resolveUserCoNarrationMode({ autoProgressionEnabled: true }),
      "limited_external"
    );
  });

  it("auto progression never resolves to explicit_full even with OOC opt-in present", () => {
    assert.equal(
      resolveUserCoNarrationMode({
        autoProgressionEnabled: true,
        oocUserImpersonationAllowed: true,
        novelModeEnabled: false,
      }),
      "limited_external"
    );
  });

  it("OOC opt-in alone maps to limited_external (LIMITED CO-NARRATION), not explicit_full", () => {
    assert.equal(
      resolveUserCoNarrationMode({
        autoProgressionEnabled: false,
        oocUserImpersonationAllowed: true,
        novelModeEnabled: false,
      }),
      "limited_external"
    );
  });

  it("resolveNoGodmoddingMode: continue → autoContinue, not novel", () => {
    assert.equal(
      resolveNoGodmoddingMode({ isContinue: true, novelModeEnabled: false }),
      "autoContinue"
    );
    assert.equal(
      resolveNoGodmoddingMode({ isContinue: true, novelModeEnabled: true }),
      "novel"
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

  it("novelModeEnabled alone does not map to auto_progression runtime", () => {
    assert.equal(resolveChatRuntimeMode({ novelModeEnabled: true }), "interactive");
    assert.equal(resolveChatRuntimeMode({ isContinue: true }), "auto_progression");
  });
});

describe("auto progression prompt content", () => {
  it("contains no NOVEL MODE rules in authoritative block", () => {
    const block = buildAutoProgressionUserControlBlock();
    assertNoNovelModeLeak(block);
    assert.match(block, /\[AI_CAST\]/);
    assert.match(block, /\[USER CONTROL — AUTO PROGRESSION\]/);
    assert.match(block, /\[AUTO PROGRESSION — AI-CENTERED\]/);
  });

  it("supports ensemble cast focalization", () => {
    const block = buildAutoProgressionAiCenteredBlock();
    assert.match(block, /\[AI_CAST\]/);
    assert.match(block, /여러 AI/);
    assert.match(block, /head-hopping/);
    assert.match(block, /고정 주인공/);
    assert.match(block, /다른 \[AI_CAST\] 구성원/);
    assert.doesNotMatch(block, /기본 서술 시점은 \[A\]/);
  });

  it("forbids [B] inner thought / decision / desire / memory interpretation", () => {
    const block = buildAutoProgressionUserControlBlock();
    assert.match(block, /내면 독백/);
    assert.match(block, /감정 결론/);
    assert.match(block, /욕망/);
    assert.match(block, /자각/);
    assert.match(block, /기억 해석/);
    assert.match(block, /중대 결정|되돌릴 수 없는 결정/);
  });

  it("allows short observable [B] action/dialogue", () => {
    const block = buildAutoProgressionUserControlBlock();
    assert.match(block, /짧은 외부 행동·대사/);
  });

  it("leaving focal AI does not switch to [B] POV", () => {
    const block = buildAutoProgressionAiCenteredBlock();
    assert.match(block, /\[B\]의 내면 시점으로 자동 전환하지 않는다/);
    assert.match(block, /다른 \[AI_CAST\] 구성원/);
  });

  it("continue command short-refs AI_CAST without novel rules", () => {
    const cmd = buildContinueNarrativeCommand({
      personaName: userCharacterName,
      charName: aiCharacterName,
      novelModeEnabled: true, // ignored
    });
    assertNoNovelModeLeak(cmd);
    assert.match(cmd, /\[AI_CAST\]/);
    assert.match(cmd, /AUTO PROGRESSION — AI-CENTERED/);
    assert.doesNotMatch(cmd, /buildNovelModeUserPersonaRules|속마음까지/);
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
    assert.match(core, /USER CONTROL/);
    assert.equal(core.includes(AUTO_PROGRESSION_CORE_ROLE.split("\n")[0]!), true);
  });

  it("canon fragment uses AI_CAST on auto progression", () => {
    const canon = buildCanonScopeKnowledgeBlock({ autoProgressionEnabled: true });
    assertNoNovelModeLeak(canon);
    assert.match(canon, /\[AI_CAST\]/);
  });

  it("scene directive uses external-only ensemble wording", () => {
    const block = buildSceneDirectivePromptBlock({
      mode: "auto_progression",
      recentMessages: [],
      currentUserMessage: "자동진행",
    });
    assert.match(block, /짧은 외부 행동·대사/);
    assert.match(block, /내면/);
    assert.match(block, /다인물|여러 AI/);
    assert.match(block, new RegExp(AUTO_PROGRESSION_SCENE_USER_CONTROL.slice(0, 20)));
    assert.doesNotMatch(block, /유저 페르소나와 최근 말투에 맞는 행동\/대사를 쓸 수 있으나/);
  });

  it("interactive mode remains unchanged (no AI_CAST CORE)", () => {
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
    assert.match(core, /\[NO GODMODDING\]를 따른다/);
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
    assert.match(built.systemPrompt, /\[AUTO PROGRESSION — AI-CENTERED\]/);
    assert.doesNotMatch(built.systemPrompt, /CONTROLLED POSSESSION MODE — ACTIVE/);
    assert.doesNotMatch(built.systemPrompt, /속마음까지 모두 주도적으로/);
  });

  it("godmodding autoContinue block is used for continue", () => {
    const block = buildNoGodmoddingBlock(aiCharacterName, userCharacterName, "autoContinue");
    assert.match(block, /\[USER CONTROL — AUTO PROGRESSION\]/);
    assert.match(block, /\[NO FALSE SHARED MEMORY\]/);
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
