/**
 * Dump "시스템 프롬프트 (고정 규칙)" sections for a chat — matches route.ts billing breakdown (category systemRules).
 *
 * Usage: npx.cmd tsx scripts/dump-system-rules-prompt.ts --chat-id=38
 */
import Module from "module";
import fs from "fs";
import path from "path";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";

function parseChatId(argv: string[]): number | undefined {
  for (const arg of argv) {
    if (arg.startsWith("--chat-id=")) return Number(arg.slice("--chat-id=".length));
  }
  return undefined;
}

async function loadFixture(chatId: number) {
  const { getDb } = await import("../src/lib/db");
  const { loadCharacterChunks } = await import("../src/lib/characterChunks");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta, normalizeMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns, recentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../src/lib/characterGenres");
  const { parseAssets, chatAssets } = await import("../src/lib/characterAssets");
  const { buildHierarchicalMemoryPromptLayers } = await import("../src/lib/memory/memory-manager");
  const { resolveRelationshipMetaNames } = await import("../src/lib/relationshipMetaCharacterName");

  const db = getDb();
  const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Record<string, unknown>;
  if (!chat) throw new Error(`chat ${chatId} not found`);

  const userId = Number(chat.user_id);
  const characterId = Number(chat.character_id);
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as Record<string, unknown>;
  const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(characterId) as Record<string, unknown>;
  const personaRow = chat.selected_persona_id
    ? (db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as Record<string, unknown> | null)
    : null;

  const personaDisplayName = String(personaRow?.name ?? user.nickname ?? "").trim() || "유저";
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
    String(personaRow?.description ?? "")
  );
  const userNotePrompt = formatUserNoteForPrompt(String(chat.user_note ?? user.user_note ?? "").trim());

  const msgRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chatId) as { role: "user" | "assistant"; content: string; model?: string | null }[];
  const completedTurns = messagesToTurns(msgRows);
  const recentHistory = recentTurnsToHistory(completedTurns, completedTurns.length);
  const lastUser = [...recentHistory].reverse().find((m) => m.role === "user");
  const currentUserMessage = lastUser?.content ?? "안녕";

  const chunks = loadCharacterChunks({
    id: Number(ch.id),
    name: String(ch.name),
    gender: String(ch.gender ?? ""),
    system_prompt: String(ch.system_prompt ?? ""),
    world: String(ch.world ?? ""),
    example_dialog: String(ch.example_dialog ?? ""),
    setting_chunks: String(ch.setting_chunks ?? ""),
    speech_profile: String(ch.speech_profile ?? ""),
  });

  const memRow = db
    .prepare("SELECT recent_summary FROM chat_memories WHERE chat_id=?")
    .get(chatId) as { recent_summary?: string } | undefined;
  const longTermMemory = String(memRow?.recent_summary ?? chat.current_summary ?? chat.memory ?? "").trim();
  const genres = sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]")));
  const assetTags = [...new Set(chatAssets(parseAssets(String(ch.assets ?? "[]"))).map((a) => a.tag))];
  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(ch.name),
    systemPrompt: String(ch.system_prompt ?? ""),
    chunks,
    userName: personaDisplayName,
  });
  const memoryLayers = buildHierarchicalMemoryPromptLayers({
    chatId,
    completedTurns: completedTurns.length,
    modelId: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
  });

  return {
    charName: String(ch.name),
    userNickname: String(user.nickname),
    personaDisplayName,
    chunks,
    userPersonaPrompt,
    userNotePrompt,
    longTermMemory,
    memoryMeta: formatMemoryMetaForPrompt(
      normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "")), relationshipNames)
    ),
    shortTermHistory: recentHistory.slice(0, -1),
    currentUserMessage,
    nsfw: String(chat.mode) === "nsfw" || Number(user.nsfw_on) === 1,
    gender: resolveCharacterGender(String(ch.gender)),
    assetTags: assetTags.length > 0 ? assetTags : undefined,
    completedTurns: completedTurns.length,
    userPersonaGender: (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
    genres,
    userImpersonation: Number(chat.user_impersonation) === 1,
    novelModeEnabled: Number(chat.novel_mode) === 1,
    targetResponseChars: Number(chat.target_response_chars ?? 2500),
  };
}

async function main() {
  const { estimateTokens } = await import("../src/lib/ai");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("../src/lib/chatModels");

  const chatId = parseChatId(process.argv.slice(2)) ?? 38;
  const fx = await loadFixture(chatId);
  const built = buildContext({
    charName: fx.charName,
    chunks: fx.chunks,
    userNickname: fx.userNickname,
    userPersona: fx.userPersonaPrompt,
    userNote: fx.userNotePrompt,
    longTermMemory: fx.longTermMemory,
    memoryMeta: fx.memoryMeta,
    shortTermHistory: fx.shortTermHistory,
    currentUserMessage: fx.currentUserMessage,
    nsfw: fx.nsfw,
    gender: fx.gender,
    assetTags: fx.assetTags,
    completedTurns: fx.completedTurns,
    userPersonaGender: fx.userPersonaGender,
    genres: fx.genres,
    userImpersonation: fx.userImpersonation,
    novelModeEnabled: fx.novelModeEnabled,
    targetResponseChars: fx.targetResponseChars,
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    provider: "openrouter",
    mainModelOwnsRelationshipExtract: false,
  });

  const sections = (built.meta.trackedSections ?? []).filter((s) => s.category === "systemRules");
  let sysRulesEst = 0;
  let assetEst = 0;
  for (const s of sections) {
    const t = estimateTokens(s.text);
    if (s.id === "rule-asset-tags") assetEst += t;
    else sysRulesEst += t;
  }
  sysRulesEst = Math.max(0, sysRulesEst - assetEst);

  const lines: string[] = [
    `시스템 프롬프트 (고정 규칙) — chat ${chatId} · DeepSeek V4 Pro`,
    `generated: ${new Date().toISOString()}`,
    `completedTurns: ${fx.completedTurns}`,
    `sections (systemRules category): ${sections.length}`,
    `estimated tokens (고정 규칙, asset 제외): ${sysRulesEst}`,
    `estimated tokens (rule-asset-tags, 별도 줄): ${assetEst}`,
    "",
    "── SECTION INDEX ──",
  ];

  for (const s of sections) {
    const tok = estimateTokens(s.text);
    lines.push(`  • ${s.id.padEnd(36)} ${tok} tok  ${s.label ?? ""}`);
  }

  lines.push("", "── COMBINED SYSTEM RULES TEXT ──", "");
  const combined = sections.map((s) => s.text).join("\n\n");
  lines.push(combined);

  const out = path.join("output", `system-rules-prompt-chat${chatId}-deepseek.txt`);
  fs.writeFileSync(out, lines.join("\n"), "utf8");
  console.log(`Wrote ${out} (${combined.length} chars, ~${sysRulesEst} tok rules + ${assetEst} asset)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
