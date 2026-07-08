/**
 * Assembled prompt zones + silver-hair keyword audit.
 *
 * Usage:
 *   npx.cmd tsx scripts/dump-prompt-hair-keyword-audit.ts --chat-id=39
 *   npx.cmd tsx scripts/dump-prompt-hair-keyword-audit.ts --character-id=18
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const KEYWORDS = [
  { id: "silver hair", re: /silver\s*hair/gi },
  { id: "silver-haired", re: /silver-haired/gi },
  { id: "은발", re: /은발/g },
  { id: "은빛 머리카락", re: /은빛\s*머리카락/g },
];

type ZoneKey =
  | "1. System Prompt"
  | "2. Character Card"
  | "3. Memory"
  | "4. Summary Memory"
  | "5. Recent Messages";

function parseChatId(argv: string[]): number | undefined {
  for (const arg of argv) {
    if (arg.startsWith("--chat-id=")) return Number(arg.slice("--chat-id=".length));
  }
  return undefined;
}

function parseCharacterId(argv: string[]): number | undefined {
  for (const arg of argv) {
    if (arg.startsWith("--character-id=")) return Number(arg.slice("--character-id=".length));
  }
  return undefined;
}

function findMatches(text: string, label: string) {
  const hits: { keyword: string; count: number; snippets: string[] }[] = [];
  for (const { id, re } of KEYWORDS) {
    re.lastIndex = 0;
    const matches = [...text.matchAll(re)];
    if (!matches.length) continue;
    const snippets = matches.slice(0, 5).map((m) => {
      const idx = m.index ?? 0;
      return text.slice(Math.max(0, idx - 40), idx + 60).replace(/\n/g, " ");
    });
    hits.push({ keyword: id, count: matches.length, snippets });
  }
  return hits;
}

function printZone(zone: ZoneKey, text: string) {
  const chars = text.length;
  const hits = findMatches(text, zone);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${zone}  (${chars.toLocaleString()} chars)`);
  console.log("=".repeat(72));
  if (!text.trim()) {
    console.log("(empty)");
    return;
  }
  if (!hits.length) {
    console.log("KEYWORDS: (none)");
    return;
  }
  console.log("KEYWORDS:");
  for (const h of hits) {
    console.log(`  • ${h.keyword}: ${h.count} hit(s)`);
    for (const s of h.snippets) {
      console.log(`      …${s}…`);
    }
  }
}

async function main() {
  const chatIdArg = parseChatId(process.argv.slice(2));
  const characterIdArg = parseCharacterId(process.argv.slice(2));

  const { getDb } = await import("../src/lib/db");
  const { loadCharacterChunksForPrompt } = await import("../src/lib/characterChunks");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta, normalizeMemoryMeta } =
    await import("../src/lib/chatMemory");
  const { messagesToTurns, recentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveCharacterGender } = await import("../src/lib/characterGender");
  const { sanitizeCharacterGenres } = await import("../src/lib/characterGenres");
  const { parseAssets, chatAssets } = await import("../src/lib/characterAssets");
  const { buildHierarchicalMemoryPromptLayers } = await import("../src/lib/memory/memory-manager");
  const { resolveRelationshipMetaNames } = await import("../src/lib/relationshipMetaCharacterName");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const db = getDb();
  let chat: Record<string, unknown> | undefined;
  if (chatIdArg) {
    chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatIdArg) as Record<string, unknown>;
  } else {
    chat = db
      .prepare(
        `SELECT * FROM chats WHERE (? IS NULL OR character_id=?) ORDER BY id DESC LIMIT 1`
      )
      .get(characterIdArg ?? null, characterIdArg ?? null) as Record<string, unknown>;
  }
  if (!chat) throw new Error("No chat found");

  const userId = Number(chat.user_id);
  const characterId = Number(chat.character_id);
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as Record<string, unknown>;
  const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(characterId) as Record<string, unknown>;

  const personaRow = chat.selected_persona_id
    ? (db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as Record<
        string,
        unknown
      > | null)
    : null;

  const personaDisplayName = String(personaRow?.name ?? user.nickname ?? "").trim() || "유저";
  const { chunks, usedEnglish } = loadCharacterChunksForPrompt(
    {
      id: Number(ch.id),
      name: String(ch.name),
      gender: String(ch.gender ?? ""),
      system_prompt: String(ch.system_prompt ?? ""),
      world: String(ch.world ?? ""),
      example_dialog: String(ch.example_dialog ?? ""),
      setting_chunks: String(ch.setting_chunks ?? ""),
      setting_chunks_en: String(ch.setting_chunks_en ?? ""),
      speech_profile: String(ch.speech_profile ?? ""),
    },
    personaDisplayName,
    String(user.nickname)
  );

  const msgRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(Number(chat.id)) as { role: "user" | "assistant"; content: string; model?: string | null }[];
  const completedTurns = messagesToTurns(msgRows);
  const recentHistory = recentTurnsToHistory(completedTurns, completedTurns.length);
  const lastUser = [...recentHistory].reverse().find((m) => m.role === "user");
  const currentUserMessage = lastUser?.content ?? "";

  const memRow = db
    .prepare("SELECT recent_summary, archive_summary FROM chat_memories WHERE chat_id=?")
    .get(Number(chat.id)) as { recent_summary?: string; archive_summary?: string } | undefined;
  const longTermMemory = String(memRow?.recent_summary ?? chat.current_summary ?? chat.memory ?? "").trim();
  const archiveMemory = String(memRow?.archive_summary ?? "").trim();

  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(ch.name),
    systemPrompt: String(ch.system_prompt ?? ""),
    chunks,
    userName: personaDisplayName,
  });

  const recentContextForRag = recentHistory
    .slice(-6)
    .map((m) => m.content)
    .join("\n");
  const memoryLayers = buildHierarchicalMemoryPromptLayers({
    chatId: Number(chat.id),
    completedTurns: completedTurns.length,
    modelId: String(chat.selected_ai ?? "deepseek/deepseek-v4-pro"),
    provider: "openrouter",
  });

  const built = buildContext({
    charName: String(ch.name),
    chunks,
    userNickname: String(user.nickname),
    userPersona: formatSelectedPersonaForPrompt(
      personaDisplayName,
      (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
      String(personaRow?.description ?? "")
    ),
    userNote: formatUserNoteForPrompt(String(chat.user_note ?? user.user_note ?? "").trim()),
    longTermMemory,
    archiveMemory,
    shortTermHistory: recentHistory.slice(0, -1),
    currentUserMessage,
    nsfw: String(chat.mode) === "nsfw" || Number(user.nsfw_on) === 1,
    gender: resolveCharacterGender(String(ch.gender)),
    memoryMeta: formatMemoryMetaForPrompt(
      normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "")), relationshipNames)
    ),
    modelId: String(chat.selected_ai ?? "deepseek/deepseek-v4-pro"),
    personaDisplayName,
    targetResponseChars: Number(chat.target_response_chars ?? 3200),
    completedTurns: completedTurns.length,
    userPersonaGender: (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
    provider: "openrouter",
    genres: sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]"))),
    useEnglishCharacterPrompt: usedEnglish,
    recentNarrativeContext: memoryLayers.recentNarrativeContext || undefined,
    promptDumpSource: "db",
    promptDumpDetail: `hair-audit chat=${chat.id} char=${characterId}`,
  });

  const sections = built.meta.trackedSections ?? [];

  const systemPromptText = sections
    .filter((s) => s.category === "systemRules")
    .map((s) => s.text)
    .join("\n\n");

  const characterCardText = sections
    .filter((s) => s.category === "characterSetting")
    .map((s) => s.text)
    .join("\n\n");

  const memoryText = sections
    .filter(
      (s) =>
        s.category === "memory" &&
        (s.id === "current-memory" ||
          s.id === "relationship-meta")
    )
    .map((s) => s.text)
    .join("\n\n");

  const summaryMemoryText = [
    sections.filter((s) => s.id === "archive-memory").map((s) => s.text).join("\n\n"),
    built.meta.trackedSections?.find((s) => s.id.includes("recent-narrative"))?.text ??
      memoryLayers.recentNarrativeContext ??
      "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const recentMessagesText = [
    ...built.history.map((m) => `[${m.role}]\n${m.content}`),
    `[user — current turn]\n${currentUserMessage}`,
  ].join("\n\n---\n\n");

  console.log("PROMPT HAIR-KEYWORD AUDIT");
  console.log(`chat=${chat.id} character=${ch.name} (id=${characterId}) usedEnglishChunks=${usedEnglish}`);
  console.log(
    `system≈${estimateTokens(built.systemPrompt)} tok · history=${built.history.length} msgs · sections=${sections.length}`
  );

  const zones: [ZoneKey, string][] = [
    ["1. System Prompt", systemPromptText],
    ["2. Character Card", characterCardText],
    ["3. Memory", memoryText],
    ["4. Summary Memory", summaryMemoryText],
    ["5. Recent Messages", recentMessagesText],
  ];

  for (const [zone, text] of zones) {
    printZone(zone, text);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("SECTION INDEX (reference)");
  console.log("=".repeat(72));
  for (const s of sections) {
    console.log(`  [${s.category}] ${s.id} — ${s.label}`);
  }

  const outPath = path.join(
    "output",
    `prompt-hair-keyword-audit-chat${chat.id}.txt`
  );
  const lines: string[] = [
    `PROMPT HAIR-KEYWORD AUDIT — ${new Date().toISOString()}`,
    `chat=${chat.id} character=${ch.name} usedEnglish=${usedEnglish}`,
    "",
  ];
  for (const [zone, text] of zones) {
    lines.push("=".repeat(72), zone, "=".repeat(72), "");
    const hits = findMatches(text, zone);
    if (!hits.length) lines.push("KEYWORDS: (none)", "");
    else {
      lines.push("KEYWORDS:");
      for (const h of hits) {
        lines.push(`  ${h.keyword}: ${h.count}`);
        for (const s of h.snippets) lines.push(`    …${s}…`);
      }
      lines.push("");
    }
    lines.push("--- full text ---", text.slice(0, 12000), text.length > 12000 ? "\n…[truncated]…" : "", "");
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
