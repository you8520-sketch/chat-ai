import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadCharacterChunksForPromptReadOnly } from "@/lib/characterChunks";
import { deserializeCharacterChunks } from "@/utils/characterParser";
import { estimateTokens } from "@/lib/tokenEstimate";

function requestToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.headers.get("x-admin-debug-token")?.trim() || "";
}

function requireDebugToken(req: Request): boolean {
  const expected = process.env.ADMIN_DEBUG_TOKEN?.trim() ?? "";
  if (!expected) return process.env.NODE_ENV !== "production";
  return requestToken(req) === expected;
}

function chunkChars(chunks: { content: string }[]): number {
  return chunks.reduce((n, c) => n + c.content.length, 0);
}

function detectExactDuplicateChunkIds(
  chunks: { id: string; content: string }[]
): string[] {
  const byContent = new Map<string, string[]>();
  for (const chunk of chunks) {
    const key = chunk.content.trim();
    if (!key) continue;
    const ids = byContent.get(key) ?? [];
    ids.push(chunk.id);
    byContent.set(key, ids);
  }
  const duplicateIds: string[] = [];
  for (const ids of byContent.values()) {
    if (ids.length > 1) duplicateIds.push(...ids);
  }
  return duplicateIds.sort();
}

function resolveFullKoEnDuplication(
  finalSelected: { id: string; content: string }[],
  exactDuplicateChunkIds: string[]
): boolean | "unknown" {
  if (exactDuplicateChunkIds.length === 0) return false;
  const dupSet = new Set(exactDuplicateChunkIds);
  const hasKo = finalSelected.some((c) => !c.id.startsWith("en-") && dupSet.has(c.id));
  const hasEn = finalSelected.some((c) => c.id.startsWith("en-") && dupSet.has(c.id));
  if (hasKo && hasEn) return true;
  return false;
}

export async function GET(req: Request) {
  if (!requireDebugToken(req)) {
    return NextResponse.json({ error: "admin diagnostics access denied" }, { status: 403 });
  }

  const url = new URL(req.url);
  const characterId = Number(url.searchParams.get("characterId"));
  const chatId = Number(url.searchParams.get("chatId"));
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "characterId is required" }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks,
              speech_profile, creator_compiled_description_json, setting_chunks_en,
              prompt_translation_hash
       FROM characters WHERE id=?`
    )
    .get(characterId) as {
    id: number;
    name: string;
    gender: string;
    system_prompt: string;
    world: string;
    example_dialog: string;
    setting_chunks: string | null;
    speech_profile: string;
    creator_compiled_description_json: string | null;
    setting_chunks_en?: string | null;
    prompt_translation_hash?: string | null;
  } | undefined;

  if (!row) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const storedKo = deserializeCharacterChunks(row.setting_chunks);
  const storedEn = deserializeCharacterChunks(row.setting_chunks_en);
  const { chunks: finalSelected, usedEnglish } = loadCharacterChunksForPromptReadOnly(
    row,
    "유저",
    "유저"
  );

  const finalEnCanon = finalSelected.filter((c) => c.id.startsWith("en-"));
  const finalKoSpeech = finalSelected.filter(
    (c) => !c.id.startsWith("en-") && c.category === "speech"
  );
  const exactDuplicateChunkIds = detectExactDuplicateChunkIds(finalSelected);
  const fullKoEnDuplication = resolveFullKoEnDuplication(
    finalSelected,
    exactDuplicateChunkIds
  );

  const sourceRawChars =
    row.system_prompt.length + row.world.length + row.example_dialog.length;
  const storedKoChars = chunkChars(storedKo);
  const storedEnChars = chunkChars(storedEn);
  const finalSelectedChars = chunkChars(finalSelected);
  const finalSelectedEnCanonChars = chunkChars(finalEnCanon);
  const finalSelectedKoSpeechChars = chunkChars(finalKoSpeech);

  const translationHashStatus = row.prompt_translation_hash?.trim()
    ? row.prompt_translation_hash.trim()
    : "UNAVAILABLE";

  return NextResponse.json({
    characterId: row.id,
    chatId: Number.isInteger(chatId) && chatId > 0 ? chatId : null,
    SOURCE_RAW_CHARS: sourceRawChars,
    STORED_KO_CHARS: storedKoChars,
    STORED_EN_CHARS: storedEnChars,
    STORED_KO_CHUNK_COUNT: storedKo.length,
    STORED_EN_CHUNK_COUNT: storedEn.length,
    FINAL_SELECTED_CHARS: finalSelectedChars,
    FINAL_SELECTED_CHUNK_COUNT: finalSelected.length,
    FINAL_SELECTED_EN_CANON_CHARS: finalSelectedEnCanonChars,
    FINAL_SELECTED_KO_SPEECH_CHARS: finalSelectedKoSpeechChars,
    FINAL_SELECTED_CHUNK_CHARS: finalSelectedChars,
    FULL_LEGACY_ASSEMBLED_CHARS: "UNAVAILABLE",
    usedEnglish,
    EXACT_DUPLICATE_CHUNK_IDS: exactDuplicateChunkIds,
    FULL_KO_EN_DUPLICATION: fullKoEnDuplication,
    TRANSLATION_HASH_STATUS: translationHashStatus,
    trackedSections: finalSelected.map((c) => ({
      id: c.id,
      category: c.category,
      chars: c.content.length,
      internalEstimate: estimateTokens(c.content),
    })),
  });
}
