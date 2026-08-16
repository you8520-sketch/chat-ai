/**
 * Assembled/dry-run English-layer check for main RP models.
 * No paid chat completion calls.
 *
 *   npx tsx scripts/english-layer-assemble-dry-run.ts --id=18
 */
import { getDb } from "../src/lib/db";
import { buildContext } from "../src/services/contextBuilder";
import {
  loadCharacterChunksForPromptReadOnly,
  type CharacterSettingRow,
} from "../src/lib/characterChunks";
import { inspectEnglishLayerAssembly } from "../src/lib/englishLayerAssemble";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "../src/lib/chatModels";

const MODELS = [
  ["DeepSeek V4 Pro", CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
  ["Gemini 3.1 Pro", CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL],
  ["Gemini 3.7 Flash", CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL],
  ["Terra", CHEAPER_INFERENCE_GPT_56_TERRA_MODEL],
  ["Opus 5 assemble-only", CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL],
] as const;

function parseId(): number {
  const arg = process.argv.find((a) => a.startsWith("--id="));
  const id = Number(arg?.slice("--id=".length) ?? 18);
  if (!Number.isInteger(id) || id <= 0) throw new Error("invalid --id");
  return id;
}

function main() {
  const id = parseId();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, status_window_prompt,
              setting_chunks, setting_chunks_en, prompt_translation_hash, speech_profile,
              creator_compiled_description_json, appearance_raw, appearance_compiled
       FROM characters WHERE id=?`
    )
    .get(id) as CharacterSettingRow | undefined;
  if (!row) {
    console.log(JSON.stringify({ id, error: "NOT_FOUND" }));
    process.exit(1);
  }
  const loaded = loadCharacterChunksForPromptReadOnly(row, "유저", "유저");
  const results = MODELS.map(([label, modelId]) => {
    const built = buildContext({
      charName: row.name,
      chunks: loaded.chunks,
      userNickname: "유저",
      shortTermHistory: [],
      currentUserMessage: "안녕",
      nsfw: false,
      systemPrompt: row.system_prompt,
      world: row.world ?? "",
      modelId,
      provider: "cheaperinference",
      useEnglishCharacterPrompt: loaded.usedEnglish,
    });
    const check = inspectEnglishLayerAssembly({
      usedEnglish: loaded.usedEnglish,
      mergedChunks: loaded.chunks,
      assembledSystemPrompt: built.systemPrompt,
      koreanSystemPrompt: row.system_prompt,
    });
    return { label, modelId, ...check };
  });
  console.log(
    JSON.stringify(
      {
        id,
        name: row.name,
        usedEnglish: loaded.usedEnglish,
        results,
        allPass: results.every((r) => r.pass),
      },
      null,
      2
    )
  );
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main();
