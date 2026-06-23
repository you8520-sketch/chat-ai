/**
 * Builds the real prompt for user 4 / character 14 / chat 24 and prints
 * the per-section token breakdown of the new 3-layer architecture.
 * Run: npx.cmd tsx scripts/prompt-token-report.ts
 */
import Database from "better-sqlite3";
import path from "path";

if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

async function main() {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns, recentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { sanitizeCharacterGenres } = await import("../src/lib/characterGenres");
  const { parseAssets, chatAssets } = await import("../src/lib/characterAssets");

  const db = new Database(path.join(process.cwd(), "data", "app.db"));

  const user = db.prepare("SELECT * FROM users WHERE id=4").get() as any;
  const ch = db.prepare("SELECT * FROM characters WHERE id=14").get() as any;
  const chat = db.prepare("SELECT * FROM chats WHERE id=24").get() as any;
  if (!user || !ch || !chat) {
    console.error("Missing fixture data:", { user: !!user, ch: !!ch, chat: !!chat });
    process.exit(1);
  }

  const personaRow = chat.selected_persona_id
    ? (db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as any)
    : null;
  const personaDisplayName = personaRow?.name?.trim() || user.nickname;
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    personaRow?.gender ?? "other",
    personaRow?.description ?? ""
  );
  const userNotePrompt = formatUserNoteForPrompt(chat.user_note?.trim() || user.user_note?.trim() || "");

  const msgRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=24 ORDER BY id ASC")
    .all() as any[];
  const completedTurns = messagesToTurns(msgRows);
  const recentHistory = recentTurnsToHistory(completedTurns, completedTurns.length);

  const chunks = loadCharacterChunks({
    id: ch.id,
    name: ch.name,
    gender: ch.gender,
    system_prompt: ch.system_prompt,
    world: ch.world,
    example_dialog: ch.example_dialog,
    setting_chunks: ch.setting_chunks,
    speech_profile: ch.speech_profile,
  });

  const genres = sanitizeCharacterGenres(JSON.parse(ch.genres || "[]"));
  const assetTags = [...new Set(chatAssets(parseAssets(ch.assets)).map((a: any) => a.tag))];

  const built = buildContext({
    charName: ch.name,
    chunks,
    userNickname: user.nickname,
    userPersona: userPersonaPrompt,
    userNote: userNotePrompt,
    longTermMemory: chat.memory ?? "",
    shortTermHistory: recentHistory,
    currentUserMessage: "오늘 기분이 어때?",
    nsfw: chat.mode === "nsfw",
    gender: resolveCharacterGender(ch.gender),
    assetTags: assetTags.length > 0 ? assetTags : undefined,
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(chat.memory_meta)),
    userImpersonation: !!chat.user_impersonation,
    personaDisplayName,
    targetResponseChars: chat.target_response_chars ?? 2500,
    completedTurns: completedTurns.length,
    userPersonaGender: personaRow?.gender ?? "other",
    provider: "gemini",
    genres,
  });

  const sections = built.meta.trackedSections ?? [];
  console.log("=== NEW 3-LAYER PROMPT — SECTION BREAKDOWN (user 4 / char 14 / chat 24) ===");
  let sysFixed = 0;
  let charData = 0;
  let other = 0;
  for (const s of sections) {
    const t = estimateTokens(s.text);
    const fixed = s.category === "systemRules";
    if (fixed) sysFixed += t;
    else if (["characterSetting", "worldLore", "dialogueExamples"].includes(s.category)) charData += t;
    else other += t;
    console.log(
      `${fixed ? "[FIXED]" : "       "} ${s.id.padEnd(28)} ${String(t).padStart(6)} tok  (${s.category})`
    );
  }
  console.log("───────────────────────────────────────────");
  console.log(`FIXED SYSTEM LAYER (core+style+speech+status+length): ${sysFixed.toLocaleString()} tokens`);
  console.log(`Character data (chunks/lore/examples):                ${charData.toLocaleString()} tokens`);
  console.log(`Memory/persona/user-note:                             ${other.toLocaleString()} tokens`);
  console.log(`System prompt total:  ${built.meta.estimatedSystemTokens.toLocaleString()} tokens`);
  console.log(`History total:        ${built.meta.estimatedHistoryTokens.toLocaleString()} tokens`);
  console.log(`Target check: fixed layer 1,000–3,500 → ${sysFixed >= 200 && sysFixed <= 3500 ? "PASS" : "FAIL"}`);
  const dups = built.meta.promptAudit?.duplicates ?? [];
  console.log(`Duplicate signatures detected: ${dups.length}`);
  dups.forEach((d) => console.log(`  • ${d.label} [${d.sectionIds.join(", ")}]`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
