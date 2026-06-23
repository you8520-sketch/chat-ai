/**
 * Token audit for B+D target sections (OpenRouter 19+ mock).
 * Usage: npx.cmd tsx scripts/audit-bd-section-tokens.ts [--label before|after]
 */
import { estimateTokens } from "../src/lib/tokenEstimate";
import { buildContext } from "../src/services/contextBuilder";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "../src/lib/chatModels";
import { loadCharacterChunks } from "../src/lib/characterChunks";
import { buildOpenRouterKoreanProseTopBlock } from "../src/lib/openRouterProsePolicy";
import { buildProseStyleXmlBundle } from "../src/lib/proseStyleXmlBundle";
import { buildNarrativeStyleLayer } from "../src/lib/narrativeStyle";
import { buildLengthInstruction } from "../src/lib/responseLength";
import type { CharacterChunk } from "../src/types";

const TARGET_IDS = [
  "prose-style-xml-bundle",
  "openrouter-korean-prose-top",
  "narrative-style",
  "rule-length-control",
] as const;

function mockChunks(): CharacterChunk[] {
  return loadCharacterChunks({
    id: 1,
    name: "백하율",
    gender: "male",
    system_prompt: `# 성격\n차분하고 관찰력이 뛰어나다.\n\n# 말투\n"~요", "~죠"`,
    world: `# 세계관\n현대 도시.`,
    example_dialog: `유저: 밤산책?\n백하율: …필요하면요.`,
    setting_chunks: "",
    speech_profile: "존댓말",
  });
}

function main() {
  const label = process.argv.includes("--label")
    ? process.argv[process.argv.indexOf("--label") + 1] ?? "run"
    : "run";

  const built = buildContext({
    charName: "백하율",
    chunks: mockChunks(),
    userNickname: "렌",
    userPersona: "20대.",
    shortTermHistory: [
      { role: "user", content: "오늘도 밤산책 갈래?" },
      { role: "assistant", content: "백하율은 고개를 끄덕였다.\n\"…같이 가시죠.\"" },
    ],
    currentUserMessage: "…방금 소리, 들었어?",
    nsfw: true,
    gender: "male",
    completedTurns: 9,
    modelId: OPENROUTER_QWEN_37_MAX_MODEL,
    provider: "openrouter",
    targetResponseChars: 2500,
    genres: ["현대/일상"],
  });

  const sections = built.meta?.trackedSections ?? [];
  const total = estimateTokens(built.systemPrompt);

  console.log(`\n=== B+D Section Audit (${label}) ===`);
  console.log(`Total system prompt: ~${total} tok (${built.systemPrompt.length} chars)\n`);

  let focusSum = 0;
  for (const id of TARGET_IDS) {
    const s = sections.find((x) => x.id === id);
    if (!s) {
      console.log(`- ${id}: (not injected)`);
      continue;
    }
    const tok = estimateTokens(s.text);
    focusSum += tok;
    console.log(`- ${s.id}: ~${tok} tok (${s.text.length} chars)`);
  }
  console.log(`\nFocus sections sum: ~${focusSum} tok`);

  // Standalone module sizes (for merge tracking)
  console.log("\n--- Standalone module tokens ---");
  console.log(`openRouterProsePolicy: ~${estimateTokens(buildOpenRouterKoreanProseTopBlock())} tok`);
  console.log(
    `proseStyleXmlBundle (NSFW): ~${estimateTokens(buildProseStyleXmlBundle({ nsfwEnabled: true, literaryEnhanced: true }))} tok`
  );
  console.log(
    `narrativeStyle (OR omit): ~${estimateTokens(buildNarrativeStyleLayer({ omitFormatRules: true, completedTurns: 9, genres: ["현대/일상"] }))} tok`
  );
  console.log(
    `rule-length-control: ~${estimateTokens(buildLengthInstruction(2500, { htmlFlashOwned: true, proseStylePolicyOwnsSceneExpansion: true }))} tok`
  );
}

main();
