/**
 * KO→EN prompt translation end-to-end check on character 14.
 * Run: npx.cmd tsx scripts/test-prompt-translation.ts
 *
 * 1. Loads character 14, runs the real translation path (Gemini flash).
 * 2. Confirms setting_chunks_en + prompt_translation_hash populated.
 * 3. Builds the chat prompt with the English layer and prints:
 *    - the English character section,
 *    - the trailing CRITICAL Korean-output directive,
 *    - character-layer token estimate KO vs EN.
 */
import { loadEnvLocal } from "./load-env-local";
loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

async function main() {
  const { getDb } = await import("../src/lib/db");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { translateAndSaveCharacterPromptEn, loadEnglishChunks, KOREAN_OUTPUT_DIRECTIVE } =
    await import("../src/lib/promptTranslation");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");

  const db = getDb();
  const ch = db.prepare("SELECT * FROM characters WHERE id=14").get() as Record<string, unknown> & {
    id: number;
    name: string;
  };
  if (!ch) throw new Error("character 14 not found");

  const chunks = loadCharacterChunks({
    id: ch.id,
    name: ch.name,
    gender: ch.gender as string,
    system_prompt: ch.system_prompt as string,
    world: ch.world as string,
    example_dialog: ch.example_dialog as string,
    setting_chunks: ch.setting_chunks as string,
    speech_profile: ch.speech_profile as string,
  });
  console.log(`character 14: "${ch.name}" — ${chunks.length} Korean chunks`);

  console.log("\n[1] Running translation (Gemini flash, real call)…");
  const ok = await translateAndSaveCharacterPromptEn(ch.id, chunks);
  console.log("translation result:", ok ? "OK" : "FAILED (fallback to Korean)");

  const row = db
    .prepare("SELECT setting_chunks_en, prompt_translation_hash FROM characters WHERE id=14")
    .get() as { setting_chunks_en: string; prompt_translation_hash: string };
  console.log(
    `setting_chunks_en: ${row.setting_chunks_en?.length ?? 0} chars, hash: ${row.prompt_translation_hash?.slice(0, 12)}…`
  );

  const englishChunks = loadEnglishChunks(row, chunks);
  console.log(`english chunks loaded: ${englishChunks?.length ?? 0}`);

  const baseInput = {
    charName: ch.name,
    userNickname: "테스터",
    shortTermHistory: [],
    currentUserMessage: "안녕, 오늘 기분 어때?",
    nsfw: false,
    gender: resolveCharacterGender(ch.gender as string),
    provider: "gemini" as const,
  };

  const charLayerTokens = (built: ReturnType<typeof buildContext>) =>
    (built.meta.trackedSections ?? [])
      .filter((s) => s.id.startsWith("chunk-"))
      .reduce((sum, s) => sum + estimateTokens(s.text), 0);

  console.log("\n[2] Building prompt — Korean only (before)…");
  const builtKo = buildContext({ ...baseInput, chunks });
  const koTokens = charLayerTokens(builtKo);

  console.log("[3] Building prompt — English layer (after)…");
  const builtEn = buildContext({
    ...baseInput,
    chunks: englishChunks ?? chunks,
    useEnglishCharacterPrompt: !!englishChunks,
  });
  const enTokens = charLayerTokens(builtEn);

  console.log("\n──── English character sections ────");
  for (const s of (builtEn.meta.trackedSections ?? []).filter((x) => x.id.startsWith("chunk-"))) {
    console.log(`\n· ${s.label} (${estimateTokens(s.text)} tok)\n${s.text.slice(0, 500)}`);
  }

  const endsWithDirective = builtEn.systemPrompt.trimEnd().endsWith(KOREAN_OUTPUT_DIRECTIVE);
  console.log("\n──── Korean-output directive at end of system prompt:", endsWithDirective ? "YES" : "NO");
  console.log("system prompt tail:\n…" + builtEn.systemPrompt.slice(-220));

  const koHasDirective = builtKo.systemPrompt.includes(KOREAN_OUTPUT_DIRECTIVE);
  console.log("directive absent in Korean-only build:", koHasDirective ? "NO (BUG)" : "YES");

  console.log("\n──── Token estimate (character layer) ────");
  console.log(`Korean : ${koTokens} tok`);
  console.log(`English: ${enTokens} tok`);
  console.log(
    `Savings: ${koTokens - enTokens} tok (${koTokens > 0 ? Math.round(((koTokens - enTokens) / koTokens) * 100) : 0}%)`
  );
  console.log(`Full system prompt: KO ${builtKo.meta.estimatedSystemTokens} tok → EN ${builtEn.meta.estimatedSystemTokens} tok`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
