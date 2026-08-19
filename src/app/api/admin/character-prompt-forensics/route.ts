import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadCharacterChunksForPromptReadOnly } from "@/lib/characterChunks";
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
              speech_profile, creator_compiled_description_json, setting_chunks_en
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
  } | undefined;

  if (!row) {
    return NextResponse.json({ error: "character not found" }, { status: 404 });
  }

  const { chunks, usedEnglish } = loadCharacterChunksForPromptReadOnly(row, "유저", "유저");
  const chunkIds = chunks.map((c) => c.id);
  const duplicateChunkIds = chunkIds.filter((id, i) => chunkIds.indexOf(id) !== i);

  const sections = chunks.map((c) => ({
    id: c.id,
    label: c.id,
    category: c.category,
    chars: c.content.length,
    internalEstimate: estimateTokens(c.content),
  }));

  const finalCharacterChars = sections.reduce((n, s) => n + s.chars, 0);
  const koChunks = chunks.filter((c) => !c.id.startsWith("en-"));
  const enChunks = chunks.filter((c) => c.id.startsWith("en-"));

  return NextResponse.json({
    characterId: row.id,
    chatId: Number.isInteger(chatId) && chatId > 0 ? chatId : null,
    source: {
      systemPromptChars: row.system_prompt.length,
      worldChars: row.world.length,
      exampleDialogChars: row.example_dialog.length,
      creatorSpeechChars: row.speech_profile.length,
    },
    stored: {
      koSettingChunkCount: koChunks.length,
      koSettingChars: koChunks.reduce((n, c) => n + c.content.length, 0),
      enSettingChunkCount: enChunks.length,
      enSettingChars: enChunks.reduce((n, c) => n + c.content.length, 0),
      translationHash: row.setting_chunks_en ? "present" : null,
      translationStale: null,
    },
    finalPrompt: {
      usedEnglish,
      finalSelectedChunkCount: chunks.length,
      finalSelectedChars: finalCharacterChars,
      englishTranslatedChars: enChunks.reduce((n, c) => n + c.content.length, 0),
      retainedKoreanSpeechChars: koChunks
        .filter((c) => c.category === "speech")
        .reduce((n, c) => n + c.content.length, 0),
    },
    duplication: {
      duplicateChunkIds,
      fullKoEnDuplicate: koChunks.length > 0 && enChunks.length > 0,
      speechDuplicate: false,
      exampleDialogDuplicate: false,
      appearanceDuplicate: false,
    },
    trackedSections: sections,
    FULL_LEGACY_CHARACTER_CHARS: row.system_prompt.length + row.world.length + row.example_dialog.length,
    CORE_CANON_CHARS: null,
    ACTIVE_RAG_CANON_CHARS: null,
  });
}
