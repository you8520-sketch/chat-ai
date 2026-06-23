import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

async function main() {
  const { getDb } = await import("../src/lib/db");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta, normalizeMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns, recentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../src/lib/characterGenres");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const db = getDb();

  const msg = db
    .prepare(
      `SELECT m.*, c.user_id, c.character_id, c.id AS chat_id
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.role = 'assistant'
         AND (m.model LIKE '%deepseek%' OR m.usage LIKE '%deepseek%')
       ORDER BY m.id DESC
       LIMIT 1`
    )
    .get() as Record<string, unknown> | undefined;

  if (!msg) {
    console.error("No DeepSeek assistant message found");
    process.exit(1);
  }

  const chatId = Number(msg.chat_id);
  const characterId = Number(msg.character_id);
  const userId = Number(msg.user_id);
  console.log("message id:", msg.id, "chat:", chatId, "character:", characterId);

  const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Record<string, unknown>;
  const character = db.prepare("SELECT * FROM characters WHERE id=?").get(characterId) as import("../src/lib/characterChunks").CharacterSettingRow;
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as Record<string, unknown>;

  const personaRow = chat.selected_persona_id
    ? (db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as Record<
        string,
        unknown
      > | null)
    : null;

  const personaDisplayName =
    String(personaRow?.name ?? user?.nickname ?? "").trim() || "유저";
  let userPersona = formatSelectedPersonaForPrompt(
    personaDisplayName,
    (personaRow?.gender as string) || "other",
    String(personaRow?.description ?? "")
  );
  let userPersonaGender = resolveCharacterGender((personaRow?.gender as string) || "other");
  const userNote = formatUserNoteForPrompt(String(chat.user_note ?? user?.user_note ?? "").trim());
  const memoryMeta = formatMemoryMetaForPrompt(
    parseMemoryMeta((chat.memory_meta as string) || "{}")
  );
  const nsfw = (chat.mode as string) === "nsfw";
  const chunks = loadCharacterChunks(character);

  const allMessages = db
    .prepare("SELECT * FROM messages WHERE chat_id=? AND id < ? ORDER BY id ASC")
    .all(chatId, msg.id) as Array<{ role: string; content: string }>;

  const turns = messagesToTurns(allMessages.map((m) => ({ role: m.role, content: m.content })));
  const completedTurns = turns.length;
  const lastUser = allMessages.filter((m) => m.role === "user").pop();
  const currentUserMessage = lastUser?.content ?? "";

  const shortTermHistory = recentTurnsToHistory(turns.slice(0, -1));

  const memRow = db
    .prepare("SELECT recent_summary FROM chat_memories WHERE chat_id=?")
    .get(chatId) as { recent_summary?: string } | undefined;
  const longTermMemory = String(memRow?.recent_summary ?? chat.current_summary ?? chat.memory ?? "").trim();

  const modelId = "deepseek/deepseek-v4-pro";
  const built = buildContext({
    charName: character.name,
    personaDisplayName,
    chunks,
    userNickname: personaDisplayName,
    userPersona,
    userNote,
    longTermMemory,
    memoryMeta,
    shortTermHistory,
    currentUserMessage,
    nsfw,
    gender: resolveCharacterGender(character.gender),
    userPersonaGender,
    userImpersonation: Boolean(chat.user_impersonation),
    novelModeEnabled: Boolean(chat.user_impersonation),
    targetResponseChars: Number(chat.target_response_chars) || 2500,
    completedTurns,
    genres: sanitizeCharacterGenres(JSON.parse(String(character.genres ?? "[]"))),
    modelId,
    provider: "openrouter",
    systemPrompt: character.system_prompt,
    world: character.world ?? "",
    exampleDialog: character.example_dialog ?? "",
  });

  const sections = built.meta.trackedSections ?? [];
  const systemRulesSections = sections.filter((s) => s.category === "systemRules");
  const sysRulesText = systemRulesSections.map((s) => s.text).join("\n\n");
  const sysRulesTok = estimateTokens(sysRulesText);

  // Receipt also uses openRouter split Block 1 for cache — include both in dump header
  const cacheRulesBlock = built.openRouterSystemSplit?.systemRulesBlock ?? "";

  const outPath = path.join("output", "last-deepseek-system-rules-dump.txt");
  const header = [
    "DEEPSEEK TURN — 시스템 프롬프트 (고정 규칙) dump",
    `message_id=${msg.id} chat_id=${chatId} character_id=${characterId} (${character.name})`,
    `completedTurns=${completedTurns} model=${modelId}`,
    `audit systemRules sections: ${systemRulesSections.length} · ≈${sysRulesTok} tok`,
    `openRouter cacheRulesBlock: ≈${estimateTokens(cacheRulesBlock)} tok`,
    "",
    "SECTION INDEX (systemRules category — receipt line '시스템 프롬프트 (고정 규칙)'):",
    ...systemRulesSections.map(
      (s) => `  • ${s.id}  ${estimateTokens(s.text)} tok  ${s.label}`
    ),
    "",
    "========== FULL systemRules TEXT (receipt basis) ==========",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, header + sysRulesText, "utf8");

  if (cacheRulesBlock && cacheRulesBlock !== sysRulesText) {
    const cachePath = path.join("output", "last-deepseek-cache-rules-block.txt");
    fs.writeFileSync(
      cachePath,
      [
        "OpenRouter Block 1 (cacheRules only — subset of fixed rules for API cache)",
        `≈${estimateTokens(cacheRulesBlock)} tok`,
        "",
        cacheRulesBlock,
      ].join("\n"),
      "utf8"
    );
    console.log("Also wrote cache rules block:", cachePath);
  }

  console.log("Wrote:", outPath);
  console.log("Tokens (systemRules):", sysRulesTok);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
