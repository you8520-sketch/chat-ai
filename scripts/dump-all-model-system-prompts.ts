/**
 * Dump full assembled system prompts for every production RP model into one text file.
 *
 * Usage:
 *   npx.cmd tsx scripts/dump-all-model-system-prompts.ts
 *   npx.cmd tsx scripts/dump-all-model-system-prompts.ts --chat-id=25
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_GEMINI_25_FLASH_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
} from "../src/lib/chatModels";

const OUTPUT = path.join("output", "all-model-system-prompts.txt");

const MODELS: { id: string; label: string; opts?: Record<string, unknown> }[] = [
  { id: OPENROUTER_GEMINI_31_PRO_MODEL, label: "Gemini 3.1 Pro (primary premium)", opts: { mainModelOwnsHtmlVisualCard: true, mainModelOwnsRelationshipExtract: true } },
  { id: OPENROUTER_GEMINI_25_PRO_MODEL, label: "Gemini 2.5 Pro" },
  { id: OPENROUTER_QWEN_37_MAX_MODEL, label: "Qwen 3.7 Max" },
  { id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, label: "DeepSeek V4 Pro (DeepSeek XML mode)" },
  { id: OPENROUTER_GEMINI_25_FLASH_MODEL, label: "Gemini 2.5 Flash (flash-owned firewall)" },
  { id: OPENROUTER_GEMINI_31_FLASH_MODEL, label: "Gemini 3.1 Flash Lite (flash-owned firewall)" },
];

function parseChatId(argv: string[]): number | undefined {
  for (const arg of argv) {
    if (arg.startsWith("--chat-id=")) return Number(arg.slice("--chat-id=".length));
  }
  return undefined;
}

function padLineNumber(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function withLineNumbers(text: string): string {
  const lines = text.split("\n");
  const width = Math.max(4, String(lines.length).length);
  return lines.map((line, i) => `${padLineNumber(i + 1, width)}| ${line}`).join("\n");
}

async function loadFixture(chatId?: number) {
  const dbPath = path.join(process.cwd(), "data", "app.db");
  if (!fs.existsSync(dbPath)) {
    throw new Error("use mock");
  }

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
  let chat: Record<string, unknown> | undefined;
  if (chatId) {
    chat = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Record<string, unknown> | undefined;
  } else {
    chat = db.prepare("SELECT * FROM chats ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
  }
  if (!chat) throw new Error("No chat in DB");

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
    .all(Number(chat.id)) as { role: "user" | "assistant"; content: string; model?: string | null }[];
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
    .get(Number(chat.id)) as { recent_summary?: string } | undefined;
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
    chatId: Number(chat.id),
    characterChunks: chunks,
    userMessage: currentUserMessage,
    recentContext: recentHistory.slice(-6).map((m) => m.content).join("\n"),
    completedTurns: completedTurns.length,
    modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    provider: "openrouter",
  });

  return {
    source: `db chat=${chat.id} user=${userId} character=${characterId}`,
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
    contextualLore: memoryLayers.contextualLore || undefined,
    recentNarrativeContext: memoryLayers.recentNarrativeContext || undefined,
  };
}

async function buildMockFixture() {
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
    source: "mock fixture",
    charName,
    userNickname: personaDisplayName,
    personaDisplayName,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(personaDisplayName, "other", "20대 대학원생."),
    userNotePrompt: formatUserNoteForPrompt("[고집중] 오래 알고 지낸 친구."),
    longTermMemory: "[장기 기억] 3년 전 실종 사건 이후 서로를 더 자주 확인한다.",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(JSON.stringify({ affection: 72, trust: 65 }))),
    shortTermHistory: [
      { role: "user" as const, content: "오늘도 밤산책 갈래?" },
      { role: "assistant" as const, content: `${charName}은 조용히 고개를 끄덕였다. "…가시려면, 제 옆에 붙어 있으세요."` },
    ],
    currentUserMessage: "…방금 소리, 들었어?",
    nsfw: true,
    gender: "male" as const,
    assetTags: ["neutral"],
    completedTurns: 20,
    userPersonaGender: "other" as const,
    genres: ["현대/일상"] as import("../src/lib/characterGenres").CharacterGenre[],
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3300,
    contextualLore: "[CONTEXTUAL LORE] 실종 사건 관련 목격 증언.",
    recentNarrativeContext: "[RECENT NARRATIVE] 골목 입구에서 멈춰 섰다.",
  };
}

async function main() {
  const chatId = parseChatId(process.argv.slice(2));
  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { formatPromptAuditLog } = await import("../src/services/promptAudit");

  let fixture: Awaited<ReturnType<typeof loadFixture>>;
  try {
    fixture = await loadFixture(chatId);
  } catch {
    fixture = await buildMockFixture();
  }

  const lines: string[] = [
    "=".repeat(100),
    "ALL MODEL SYSTEM PROMPTS — production buildContext() assembly",
    `generated: ${new Date().toISOString()}`,
    `fixture: ${fixture.source}`,
    `character="${fixture.charName}" persona="${fixture.personaDisplayName}" completedTurns=${fixture.completedTurns} nsfw=${fixture.nsfw}`,
    "",
    "ASSEMBLY: src/services/contextBuilder.ts → buildContext()",
    "PRODUCTION ROUTE: src/app/api/chat/route.ts (provider=openrouter)",
    "NOT INCLUDED: speech-rewrite overlay, continuation pass, Anthropic cache blocks, assistant prefill",
    "=".repeat(100),
    "",
    "MODEL VARIANTS IN THIS FILE:",
    ...MODELS.map((m, i) => `  ${i + 1}. ${m.label} — ${m.id}`),
    "",
  ];

  for (const model of MODELS) {
    const built = buildContext({
      charName: fixture.charName,
      chunks: fixture.chunks,
      userNickname: fixture.userNickname,
      userPersona: fixture.userPersonaPrompt,
      userNote: fixture.userNotePrompt,
      longTermMemory: fixture.longTermMemory,
      shortTermHistory: fixture.shortTermHistory,
      currentUserMessage: fixture.currentUserMessage,
      nsfw: fixture.nsfw,
      gender: fixture.gender,
      assetTags: fixture.assetTags,
      memoryMeta: fixture.memoryMeta,
      modelId: model.id,
      userImpersonation: fixture.userImpersonation,
      novelModeEnabled: fixture.novelModeEnabled,
      personaDisplayName: fixture.personaDisplayName,
      targetResponseChars: fixture.targetResponseChars,
      completedTurns: fixture.completedTurns,
      userPersonaGender: fixture.userPersonaGender,
      provider: "openrouter",
      genres: fixture.genres,
      contextualLore: fixture.contextualLore,
      recentNarrativeContext: fixture.recentNarrativeContext,
      geminiStaticDynamicMode: false,
      promptDumpSource: "dump-all-model-system-prompts",
      promptDumpDetail: fixture.source,
      ...(model.opts ?? {}),
    });

    const systemPrompt = built.systemPrompt;
    const sections = built.meta.trackedSections ?? [];

    lines.push(
      "",
      "#".repeat(100),
      `MODEL: ${model.label}`,
      `modelId: ${model.id}`,
      `chars: ${systemPrompt.length.toLocaleString()} · lines: ${systemPrompt.split("\n").length.toLocaleString()} · ≈${estimateTokens(systemPrompt).toLocaleString()} tok`,
      `deepSeekXmlMode: ${built.meta.promptAudit?.deepSeekXmlMode ?? false}`,
      `sections: ${sections.length}`,
      "#".repeat(100),
      "",
      "── SECTION INDEX (assembly order) ──",
    );

    for (const s of sections) {
      lines.push(
        `  • ${s.id.padEnd(32)} ${String(estimateTokens(s.text)).padStart(6)} tok  [${s.category}] ${s.label}`
      );
    }

    if (built.meta.promptAudit) {
      lines.push("", "── PROMPT AUDIT ──", formatPromptAuditLog(built.meta.promptAudit, { route: model.id }));
    }

    lines.push(
      "",
      "── FULL SYSTEM PROMPT ──",
      "",
      withLineNumbers(systemPrompt),
    );
  }

  lines.push(
    "",
    "=".repeat(100),
    "END OF FILE",
    "Re-run: npx.cmd tsx scripts/dump-all-model-system-prompts.ts [--chat-id=N]",
    "=".repeat(100),
  );

  const outPath = path.resolve(process.cwd(), OUTPUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");

  console.log(`Wrote ${outPath} (${lines.join("\n").length.toLocaleString()} chars)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
