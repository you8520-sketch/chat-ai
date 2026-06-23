/**
 * Dump body-output-related system prompt sections (prose, style, length, format).
 *
 * Usage:
 *   npx.cmd tsx scripts/dump-body-output-prompts.ts
 *   npx.cmd tsx scripts/dump-body-output-prompts.ts --model=google/gemini-2.5-pro
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const BODY_OUTPUT_SECTION_IDS = new Set([
  "openrouter-korean-prose-top",
  "openrouter-lang-critical",
  "openrouter-co-narration-rule",
  "no-godmodding",
  "no-godmodding-auto-continue-supplement",
  "user-persona-speech-guard",
  "rule-core-master",
  "rule-core-turn-hint",
  "prose-style-xml-bundle",
  "rule-advanced-prose-nsfw",
  "turn-handoff-and-pacing",
  "regenerate-divergence",
  "narrative-style",
  "state-window-policy",
  "user-persona-narration-rules",
  "auto-continue-persona-rules",
  "novel-mode-persona-rules",
  "rule-prose-guard",
  "rule-length-control",
  "openrouter-flash-owned-firewall",
  "korean-output-directive",
  "dialogue-format-directive",
  "korean-narration-ending",
  "visual-appearance-anchor",
]);

const SOURCE_FILES: Record<string, string> = {
  "openrouter-korean-prose-top": "src/lib/openRouterProsePolicy.ts — buildOpenRouterKoreanProseTopBlock()",
  "openrouter-lang-critical": "src/services/contextBuilder.ts (inline)",
  "openrouter-co-narration-rule": "src/lib/openRouterAdult.ts — buildCoNarrationKoreanRule()",
  "no-godmodding": "src/lib/noGodmodding.ts — buildNoGodmoddingBlock()",
  "no-godmodding-auto-continue-supplement": "src/lib/noGodmodding.ts — buildAutoContinueGodmoddingSupplement()",
  "user-persona-speech-guard": "src/lib/corePrompt.ts — buildUserPersonaSpeechGuard()",
  "rule-core-master": "src/lib/corePrompt.ts — buildCoreMasterPromptForCache() (OpenRouter cached t=99)",
  "rule-core-turn-hint": "src/lib/corePrompt.ts — buildCoreMasterEarlyTurnHint() (dynamic per turn)",
  "prose-style-xml-bundle": "src/lib/proseStyleXmlBundle.ts + advancedProseNsfwGuidelines.ts + writingStylePreset.ts",
  "rule-advanced-prose-nsfw": "src/lib/advancedProseNsfwGuidelines.ts (Gemini path only)",
  "turn-handoff-and-pacing": "src/lib/turnHandoffAndPacing.ts",
  "regenerate-divergence": "src/lib/regenerateDivergence.ts",
  "narrative-style": "src/lib/narrativeStyle.ts + writingStylePreset.ts (omitFormatRules on OpenRouter)",
  "state-window-policy": "src/lib/statusWindowNotePolicy.ts",
  "user-persona-narration-rules": "src/lib/userPersonaNarrationRules.ts",
  "auto-continue-persona-rules": "src/lib/userPersonaNarrationRules.ts",
  "novel-mode-persona-rules": "src/lib/userPersonaNarrationRules.ts",
  "rule-prose-guard": "src/lib/corePrompt.ts — buildOpenRouterOpusCompactTail()",
  "rule-length-control": "src/lib/responseLength.ts — buildLengthInstruction()",
  "openrouter-flash-owned-firewall": "src/lib/flashOwnedOutputFirewall.ts",
  "korean-output-directive": "src/services/contextBuilder.ts (Gemini tail)",
  "dialogue-format-directive": "src/services/contextBuilder.ts (Gemini tail)",
  "korean-narration-ending": "src/services/contextBuilder.ts (Gemini tail)",
  "visual-appearance-anchor": "src/services/contextBuilder.ts (visual anchor tail)",
};

/** Session changelog — update when body-output prompt rules change materially */
const SESSION_CHANGELOG = `
── 이번 작업 세션 변경 이력 (본문 출력·문체·서술 규칙) ──

[적용 완료]

1. EARLY 턴 완화 (corePrompt.ts)
   • [EARLY t=N] — 감정 에스컬레이션 속도만 제한; 내면 독백·환경·장면 깊이는 허용
   • OpenRouter: rule-core-turn-hint(dynamic)에만 주입; cached rule-core-master는 t=99

2. 하드코딩 이름 → [A]/[B] (advancedProseNsfwGuidelines.ts, writingStylePreset.ts)

3. 토큰 압축 trim (중복·장문 예시 삭제)
   • corePrompt.ts — CORE RP opener 단축, OUTPUT_FORMAT UI/Meta FORBIDDEN 제거(Flash firewall)
   • advancedProseNsfwGuidelines.ts — rule 3·대화 분절 예시 trim
   • writingStylePreset.ts — ping-pong/min-3-sentence/consecutive-quote 삭제, SHOW OVER TELL 1줄
   • userPersonaNarrationRules.ts — buildSmartUserPersonaNarrationRules 단일 cross-ref 줄

4. [DIALOGUE & NARRATION STRUCTURE] 통합 (advancedProseNsfwGuidelines.ts)
   • 5개 중복 블록 병합 (~1000+ tok 절감)

5. NSFW 서술 개정 (advancedProseNsfwGuidelines.ts)
   • 50/30/20 비율 줄 삭제
   • [SCENE VARIETY] 추가 (감각 채널 회전, 연속 반복 금지)
   • 절대 금지 1번 확장: 행동·환경·감각 채널 허용, 감정 라벨만 금지
   • NSFW item 2: 문단 요소 4종 강제 → 채널 회전
   • 삭제된 [Sensory layering guide]·[PRIORITY CLARIFICATION] 교차참조 정리

6. 턴 종료·호흡 (turnHandoffAndPacing.ts)
   • 단일 <TURN_HANDOFF_AND_PACING> 블록 — 분량 floor 없음, observer 종료 금지 유지

[감사·테스트만 — 프로덕션 미적용]

• 출력 압축 원인 A/B/C (scripts/audit-output-compression-causes.ts)
• handoff 완화만으로 Gemini 길이 큰 변화 없음; DeepSeek/Qwen은 중간 효과

[레거시·참고]

• buildAdultSystemPrompt / buildOpenRouterFinalReminder — route.ts 미사용 (contextBuilder 단일 조립)
• output/body-output-system-prompts.txt 이전 덤프는 재생성 전 스냅샷일 수 있음 — 본 파일이 live 소스 반영
`;

function parseModel(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--model=")) return arg.slice("--model=".length);
  }
  return "google/gemini-2.5-pro";
}

async function buildMockFixture(completedTurns: number) {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const personaDisplayName = "렌";

  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.`,
    world: `# 세계관\n현대 도시 배경.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  return {
    charName,
    userNickname: "렌",
    personaDisplayName,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(
      personaDisplayName,
      "other",
      "20대 후반 대학원생."
    ),
    userNotePrompt: formatUserNoteForPrompt("[고집중]\n렌은 백하율을 오래 알고 지낸 친구처럼 대한다."),
    longTermMemory: "[장기 기억 요약]\n- 3년 전 실종 사건.",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 72, trust: 65 }))
    ),
    shortTermHistory: [
      { role: "user" as const, content: "오늘도 밤산책 갈래?" },
      {
        role: "assistant" as const,
        content: "백하율은 창밖을 바라본 뒤 고개를 끄덕였다.\n\n\"…같이 가시죠.\"",
      },
    ],
    currentUserMessage: "그래, 같이 가자. 무서워.",
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
    contextualLore: undefined,
    recentNarrativeContext: undefined,
  };
}

async function main() {
  const modelId = parseModel(process.argv.slice(2));
  const outPath = path.join("output", "body-output-system-prompts.txt");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const MATURE_TURNS = 9;
  const EARLY_TURNS = 2;

  const fixtureMature = await buildMockFixture(MATURE_TURNS);
  const built = buildContext({
    charName: fixtureMature.charName,
    chunks: fixtureMature.chunks,
    userNickname: fixtureMature.userNickname,
    userPersona: fixtureMature.userPersonaPrompt,
    userNote: fixtureMature.userNotePrompt,
    longTermMemory: fixtureMature.longTermMemory,
    shortTermHistory: fixtureMature.shortTermHistory,
    currentUserMessage: fixtureMature.currentUserMessage,
    nsfw: fixtureMature.nsfw,
    gender: fixtureMature.gender,
    assetTags: undefined,
    memoryMeta: fixtureMature.memoryMeta,
    modelId,
    userImpersonation: fixtureMature.userImpersonation,
    novelModeEnabled: fixtureMature.novelModeEnabled,
    personaDisplayName: fixtureMature.personaDisplayName,
    targetResponseChars: fixtureMature.targetResponseChars,
    completedTurns: fixtureMature.completedTurns,
    userPersonaGender: fixtureMature.userPersonaGender,
    provider: "openrouter",
    genres: fixtureMature.genres,
    contextualLore: fixtureMature.contextualLore,
    recentNarrativeContext: fixtureMature.recentNarrativeContext,
  });

  const sections = (built.meta.trackedSections ?? []).filter((s) =>
    BODY_OUTPUT_SECTION_IDS.has(s.id)
  );

  // Early-turn dynamic sections (rule-core-turn-hint, early_scene) only at low completedTurns
  const fixtureEarly = await buildMockFixture(EARLY_TURNS);
  const builtEarly = buildContext({
    charName: fixtureEarly.charName,
    chunks: fixtureEarly.chunks,
    userNickname: fixtureEarly.userNickname,
    userPersona: fixtureEarly.userPersonaPrompt,
    userNote: fixtureEarly.userNotePrompt,
    longTermMemory: fixtureEarly.longTermMemory,
    shortTermHistory: fixtureEarly.shortTermHistory,
    currentUserMessage: fixtureEarly.currentUserMessage,
    nsfw: fixtureEarly.nsfw,
    gender: fixtureEarly.gender,
    assetTags: undefined,
    memoryMeta: fixtureEarly.memoryMeta,
    modelId,
    userImpersonation: fixtureEarly.userImpersonation,
    novelModeEnabled: fixtureEarly.novelModeEnabled,
    personaDisplayName: fixtureEarly.personaDisplayName,
    targetResponseChars: fixtureEarly.targetResponseChars,
    completedTurns: fixtureEarly.completedTurns,
    userPersonaGender: fixtureEarly.userPersonaGender,
    provider: "openrouter",
    genres: fixtureEarly.genres,
    contextualLore: fixtureEarly.contextualLore,
    recentNarrativeContext: fixtureEarly.recentNarrativeContext,
  });
  const earlyOnlyIds = new Set([
    "rule-core-turn-hint",
    "narrative-style",
    "rule-length-control",
  ]);
  const earlySections = (builtEarly.meta.trackedSections ?? []).filter((s) =>
    earlyOnlyIds.has(s.id)
  );

  const bodyTokens = sections.reduce((sum, s) => sum + estimateTokens(s.text), 0);
  const lines: string[] = [
    "=".repeat(80),
    "본문 출력 관련 시스템 프롬프트 감사 (body-output audit)",
    `generated: ${new Date().toISOString()}`,
    `provider: openrouter · model: ${modelId}`,
    `mock character: ${fixtureMature.charName} · nsfw: ${fixtureMature.nsfw} · completedTurns: ${MATURE_TURNS} (메인 덤프)`,
    `sections: ${sections.length} · ≈${bodyTokens.toLocaleString()} tokens (본문 출력 규칙만)`,
    `full system prompt: ≈${built.meta.estimatedSystemTokens?.toLocaleString() ?? "?"} tokens`,
    "=".repeat(80),
    "",
    "── 섹션 인덱스 (조립 순서) ──",
    "",
  ];

  for (const s of sections) {
    const tok = estimateTokens(s.text);
    lines.push(
      `  • ${s.id.padEnd(32)} ${tok.toLocaleString().padStart(5)} tok  — ${s.label}`
    );
    lines.push(`      source: ${SOURCE_FILES[s.id] ?? "see contextBuilder.ts"}`);
  }

  lines.push(SESSION_CHANGELOG);

  lines.push(
    "",
    "── 중복·잔존 참조 메모 ──",
    "",
    "• [WRITING STYLE: 한국 웹소설 표준 포맷 및 호흡 통제] — tail에서 참조하지만",
    "  실제 블록명은 [KOREAN_WEBNOVEL_STYLE] / <PROSE_STYLE_POLICY> (writingStylePreset.ts).",
    "• <STYLE_REFERENCE> few-shot — 삭제됨 (compressedStyleReference.ts 제거). 문체는 [KOREAN_WEBNOVEL_STYLE] 단일 출처.",
    "• [KOREAN_WEBNOVEL_STYLE] — prose bundle + (Gemini만) narrative-style에 중복 가능.",
    "• 분량: buildLengthInstruction() 단일 출처; <TURN_HANDOFF_AND_PACING>과 턴 종료 규칙 연동.",
    "• no-godmodding + user-persona-narration — [B] 서술 경계; 본문 길이·호흡과 직결.",
    "",
    "재생성: npx.cmd tsx scripts/dump-body-output-prompts.ts",
    "전체 덤프: npx.cmd tsx scripts/dump-system-prompt.ts --mock --model=" + modelId,
    "",
    "=".repeat(80),
    "SECTION TEXT (full) — 조립 순서",
    "=".repeat(80),
    ""
  );

  for (const s of sections) {
    lines.push(
      "",
      "─".repeat(72),
      `[${s.id}] ${s.label}`,
      `source: ${SOURCE_FILES[s.id] ?? "?"}`,
      `≈${estimateTokens(s.text)} tokens · ${s.text.length} chars`,
      "─".repeat(72),
      "",
      s.text,
      ""
    );
  }

  lines.push(
    "",
    "=".repeat(80),
    `EARLY TURN VARIANT — completedTurns=${EARLY_TURNS} (dynamic 섹션만 — rule-core-turn-hint · early_scene · 분량 tier)`,
    "=".repeat(80),
    ""
  );
  for (const s of earlySections) {
    lines.push(
      "",
      "─".repeat(72),
      `[${s.id}] ${s.label} (t=${EARLY_TURNS})`,
      `source: ${SOURCE_FILES[s.id] ?? "?"}`,
      `≈${estimateTokens(s.text)} tokens · ${s.text.length} chars`,
      "─".repeat(72),
      "",
      s.text,
      ""
    );
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`  ${sections.length} sections · ≈${bodyTokens} body-output tokens`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
