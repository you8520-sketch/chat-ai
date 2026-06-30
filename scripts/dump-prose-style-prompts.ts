/**
 * Dump all prose/style-related prompt blocks to output/prose-style-prompts-comprehensive.txt
 */
import Module from "module";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

async function main() {
  const {
    buildOpenRouterKoreanProseTopBlock,
    buildOutputLangLines,
  } = await import("@/lib/openRouterProsePolicy");
  const { buildAdvancedProseNsfwGuidelines } = await import("@/lib/advancedProseNsfwGuidelines");
  const { buildCoNarrationKoreanRule } = await import("@/lib/openRouterAdult");
  const { buildBilingualDialoguePromptBlock } = await import("@/lib/bilingualDialoguePolicy");
  type BilingualDialoguePolicy = import("@/lib/bilingualDialoguePolicy").BilingualDialoguePolicy;
  const {
    DIALOGUE_FORMAT_DIRECTIVE,
  } = await import("@/lib/promptTranslation");
  const { buildNarrativeStyleLayer } = await import("@/lib/narrativeStyle");
  const {
    buildLengthInstruction,
    buildTerminalLengthOverrideBlock,
    buildServerUnderLengthRecoveryUserMessage,
  } = await import("@/lib/responseLength");
  const { buildTurnHandoffAndPacingBlock } = await import("@/lib/turnHandoffAndPacing");
  const {
    buildNoGodmoddingBlock,
  } = await import("@/lib/noGodmodding");
  const {
    buildNovelModeUserPersonaRules,
  } = await import("@/lib/userPersonaNarrationRules");
  const { buildControlledPossessionRules } = await import("@/lib/controlledPossession");
  const { buildOocCoNarrationHint } = await import("@/lib/userImpersonationPolicy");
  const { buildUserActionThoughtRule } = await import("@/lib/userActionThoughtRules");
  const {
    buildRegenerateSystemDirective,
  } = await import("@/lib/continueNarrative");
  const {
    buildRecoveryContinuationSystemPrompt,
  } = await import("@/lib/turnApiBudget");
  const { buildVisibleLengthContinuationUserMessage } = await import(
    "@/lib/narrativeLengthContinuation"
  );
  const { buildDeepSeekBottomReminderBlock } = await import("@/lib/deepseekPromptStructure");
  const {
    buildFlashOwnedEmotionTagUserOverlay,
  } = await import("@/lib/emotionTag");
  const { buildSpeechRewriteUserMessage } = await import("@/lib/speechLock/prompts");
  type SpeechProfile = import("@/lib/speechLock/types").SpeechProfile;
  const { buildCoreMasterPrompt } = await import("@/lib/corePrompt");
  const { composeExampleDialog } = await import("@/lib/speechCreatorFields");

  const bilingualSample: Extract<BilingualDialoguePolicy, { enabled: true }> = {
    enabled: true,
    primary: "en",
    primaryDisplay: "English",
    source: "explicit_tag",
  };

  const sampleSpeechProfile: SpeechProfile = {
    charName: "Example",
    lockSummary: "formal, -요 endings",
    dialogue_examples: ['"…라고 말했다."'],
    creator_personality: "차분",
    creator_speech_traits: "짧은 문장",
    ending_anchors: ["-요"],
  };

  function section(title: string, body: string, meta?: string): string {
    const lines = [
      "",
      "=".repeat(80),
      title,
      meta ? `(${meta})` : "",
      "=".repeat(80),
      "",
      body.trim() || "(empty)",
      "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  const parts: string[] = [];

  parts.push(`문체·서술·대사·분량·페이싱 관련 프롬프트 전체 덤프
생성: ${new Date().toISOString()}
소스: src/lib/*, src/services/contextBuilder.ts 조립 순서 기준

OpenRouter 조립 순서 (요약):
  [TOP] Korean prose → [BILINGUAL]? → co-narration → godmodding → [CORE RP]
  → CHARACTER CANON(+캐릭터 speech chunk) → IDENTITY/RULES → [ADVANCED PROSE]
  → dynamic: 장르 Style → LENGTH → TURN_HANDOFF → REGEN? → terminal length
Gemini 추가 tail: dialogue-format only (language tails removed — OUTPUT LANG + PROSE STYLE)
DeepSeek: user 턴 직전 bottom reminder
`);

  parts.push(
    section(
      "1. [TOP] OpenRouter Korean prose — buildOpenRouterKoreanProseTopBlock()",
      buildOpenRouterKoreanProseTopBlock(),
      "openRouterProsePolicy.ts · cacheRules · 매 턴 OpenRouter"
    )
  );

  parts.push(
    section(
      "1b. [TOP] Bilingual OUTPUT LANG lines — buildOutputLangLines(bilingual)",
      buildOutputLangLines(bilingualSample),
      "openRouterProsePolicy.ts · TOP 블록 내 OUTPUT LANG 변형"
    )
  );

  parts.push(
    section(
      "2. [BILINGUAL DIALOGUE] — buildBilingualDialoguePromptBlock()",
      buildBilingualDialoguePromptBlock(bilingualSample),
      "bilingualDialoguePolicy.ts · cacheRules · 캐릭터 설정 bilingual 감지 시"
    )
  );

  parts.push(
    section(
      "3. Co-narration rule — buildCoNarrationKoreanRule (OFF / ON / novel)",
      [
        "--- OFF ---",
        buildCoNarrationKoreanRule(false, false),
        "",
        "--- ON (co-narration) ---",
        buildCoNarrationKoreanRule(true, false),
        "",
        "--- Novel mode ---",
        buildCoNarrationKoreanRule(true, true),
      ].join("\n"),
      "openRouterAdult.ts · dynamic"
    )
  );

  parts.push(
    section(
      "4. [NO GODMODDING] variants — buildNoGodmoddingBlock()",
      [
        "--- standard ---",
        buildNoGodmoddingBlock("Hero", "User", "standard"),
        "",
        "--- coNarration ---",
        buildNoGodmoddingBlock("Hero", "User", "coNarration"),
        "",
        "--- autoContinue ---",
        buildNoGodmoddingBlock("Hero", "User", "autoContinue"),
        "",
        "--- novel ---",
        buildNoGodmoddingBlock("Hero", "User", "novel"),
      ].join("\n"),
      "noGodmodding.ts · cacheRules"
    )
  );

  parts.push(
    section(
      "5. [CORE RP] — buildCoreMasterPrompt()",
      buildCoreMasterPrompt({
        charName: "Hero",
        userName: "User",
        charGender: "female",
        userGender: "male",
        nsfwEnabled: true,
        impersonationOn: false,
        novelModeEnabled: false,
        completedTurns: 5,
        hasMindReading: false,
        allowsBeard: true,
        allowsBodyHair: true,
        tailFormatActive: true,
        statusWindowTailActive: false,
        autoContinueTurn: false,
      }),
      "corePrompt.ts · cacheRules"
    )
  );

  parts.push(
    section(
      "6. [ADVANCED PROSE & NSFW GUIDELINES] — SFW",
      buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false }),
      "advancedProseNsfwGuidelines.ts · OpenRouter cacheCharacter / Gemini dynamic"
    )
  );

  parts.push(
    section(
      "6b. [ADVANCED PROSE & NSFW GUIDELINES] — NSFW ON",
      buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true, literaryEnhanced: true }),
      "advancedProseNsfwGuidelines.ts · NSFW 시 [19+ INTIMACY]만 추가; OpenRouter buildProseStyleXmlBundle() 동일"
    )
  );

  parts.push(
    section(
      "7. [7] Style Mode — buildNarrativeStyleLayer()",
      [
        "--- standard + romance genre ---",
        buildNarrativeStyleLayer({
          mode: "standard",
          charName: "Hero",
          genres: ["로맨스"],
        }),
        "",
        "--- possession mode ---",
        buildNarrativeStyleLayer({
          mode: "possession",
          charName: "Hero",
          genres: ["판타지/SF"],
        }),
      ].join("\n"),
      "narrativeStyle.ts · dynamic · 장르 톤 힌트만"
    )
  );

  parts.push(
    section(
      "8. [LENGTH CONTROL & SCENE EXPANSION] — buildLengthInstruction()",
      buildLengthInstruction(null, {
        statusWindowEveryTurn: false,
        htmlFlashOwned: true,
        proseStylePolicyOwnsSceneExpansion: true,
        statusWidgetActive: false,
      }),
      "responseLength.ts · rule-length-control · dynamic"
    )
  );

  parts.push(
    section(
      "9. <TURN_HANDOFF_AND_PACING> — buildTurnHandoffAndPacingBlock()",
      buildTurnHandoffAndPacingBlock(),
      "turnHandoffAndPacing.ts · dynamic"
    )
  );

  parts.push(
    section(
      "10. Terminal length — buildTerminalLengthOverrideBlock()",
      buildTerminalLengthOverrideBlock(null),
      "responseLength.ts · rule-terminal-length-override · dynamic 맨 끝"
    )
  );

  parts.push(
    section(
      "11. Novel mode — buildNovelModeUserPersonaRules()",
      buildNovelModeUserPersonaRules("Hero", "User"),
      "userPersonaNarrationRules.ts · novelModeEnabled"
    )
  );

  parts.push(
    section(
      "12. Controlled possession — buildControlledPossessionRules()",
      buildControlledPossessionRules({
        charName: "Hero",
        personaName: "User",
        completedTurns: 2,
      }),
      "controlledPossession.ts · 소설 모드 / buildAdultSystemPrompt overlay"
    )
  );

  parts.push(
    section(
      "13. OOC co-narration hint — buildOocCoNarrationHint()",
      buildOocCoNarrationHint("User"),
      "userImpersonationPolicy.ts · userImpersonation && !novelMode"
    )
  );

  parts.push(
    section(
      "14. REGENERATE — buildRegenerateSystemDirective()",
      buildRegenerateSystemDirective({
        charName: "Hero",
        rejectedAssistantDraft: "(rejected draft sample)",
        regenAttemptId: "sample-id",
      }),
      "continueNarrative.ts · regenerate === true"
    )
  );

  parts.push(
    section(
      "15. [Gemini only] DIALOGUE_FORMAT_DIRECTIVE",
      DIALOGUE_FORMAT_DIRECTIVE,
      "promptTranslation.ts · dialogue-format-directive tail (15–16·18 language tails removed — OUTPUT LANG + PROSE STYLE)"
    )
  );

  parts.push(
    section(
      "16. [DeepSeek V4] Bottom reminder — buildDeepSeekBottomReminderBlock()",
      buildDeepSeekBottomReminderBlock(),
      "deepseekPromptStructure.ts · user 턴 prepend"
    )
  );

  parts.push(
    section(
      "17. Emotion tag overlay — buildFlashOwnedEmotionTagUserOverlay()",
      buildFlashOwnedEmotionTagUserOverlay(["대화", "웃음", "슬픔"]),
      "emotionTag.ts · assetTags 있을 때 user 턴 (buildEmotionTagPrompt 동일 본문)"
    )
  );

  parts.push(
    section(
      "21. Recovery continuation system — buildRecoveryContinuationSystemPrompt()",
      buildRecoveryContinuationSystemPrompt(),
      "turnApiBudget.ts · 분량 미달 이어쓰기 2차 호출"
    )
  );

  parts.push(
    section(
      "22. Visible length continuation user message",
      buildVisibleLengthContinuationUserMessage(1200, null, 300),
      "narrativeLengthContinuation.ts"
    )
  );

  parts.push(
    section(
      "23. Server under-length recovery user message",
      buildServerUnderLengthRecoveryUserMessage(),
      "responseLength.ts · 85% 미달 stop 시"
    )
  );

  parts.push(
    section(
      "24. Speech Lock rewrite — buildSpeechRewriteUserMessage()",
      buildSpeechRewriteUserMessage(sampleSpeechProfile, [
        {
          type: "honorific_mix",
          matched: ["했습니다"],
          excerpt: "그는 조용히 말했다.",
        },
      ]),
      "speechLock/prompts.ts · validator 위반 시 2차 API (메인 system 아님)"
    )
  );

  parts.push(
    section(
      "25. [NOT INJECTED] User input format — buildUserActionThoughtRule()",
      [
        "--- no mind reading ---",
        buildUserActionThoughtRule(false),
        "",
        "--- mind reading ---",
        buildUserActionThoughtRule(true),
      ].join("\n"),
      "userActionThoughtRules.ts · 정의만 있음, contextBuilder 미주입"
    )
  );

  parts.push(
    section(
      "26. [OOC HTML MODE] OpenRouter stream overlay (해당 턴만)",
      `[OOC HTML MODE — THIS TURN]
User explicitly requested inline HTML via OOC. Output allowed: inline HTML with <div> and <span> only. FORBIDDEN: <!DOCTYPE>, <html>, <head>, <body>, <script>. You may mix Korean prose with HTML. Server Flash status window is DISABLED this turn.`,
      "openRouterAdult.ts · oocHtmlMode"
    )
  );

  parts.push(
    section(
      "27. 캐릭터 설정 쪽 말투 — composeExampleDialog()",
      composeExampleDialog({
        speech_personality: "차분하고 단정",
        speech_traits: "짧은 문장, -요 종결",
        speech_examples: '캐릭터: "…라고 말했다."\n캐릭터: "괜찮아요."',
        speech_forbidden: "반말, 욕설",
      }),
      "speechCreatorFields.ts · speech category chunk — KO→EN 번역 제외"
    )
  );

  const outPath = join(process.cwd(), "output", "prose-style-prompts-comprehensive.txt");
  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  const text = parts.join("\n");
  writeFileSync(outPath, text, "utf8");
  console.log(`Wrote ${outPath} (${text.length.toLocaleString()} chars)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
