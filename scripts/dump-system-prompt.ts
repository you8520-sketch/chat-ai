/**
 * Dump the fully assembled system prompt (via buildContext) to a line-numbered text file.
 *
 * Usage:
 *   npx.cmd tsx scripts/dump-system-prompt.ts
 *   npx.cmd tsx scripts/dump-system-prompt.ts --chat-id=24 --character-id=14 --user-id=4
 *   npx.cmd tsx scripts/dump-system-prompt.ts --mock --provider=openrouter --model=google/gemini-3.1-pro-preview
 *   npx.cmd tsx scripts/dump-system-prompt.ts --output=output/system-prompt-dump.txt
 *
 * DB mode (default when data/app.db exists): loads user/chat/character/persona/history from SQLite.
 * Mock mode (--mock or missing DB): uses built-in sample character/persona/note/memory blocks.
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type CliOpts = {
  chatId?: number;
  characterId?: number;
  userId?: number;
  provider: "gemini" | "openrouter";
  modelId: string;
  output: string;
  mock: boolean;
  includeHistory: boolean;
};

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    provider: "openrouter",
    modelId: "google/gemini-3.1-pro-preview",
    output: path.join("output", "system-prompt-dump.txt"),
    mock: false,
    includeHistory: false,
  };

  for (const arg of argv) {
    if (arg === "--mock") opts.mock = true;
    else if (arg === "--include-history") opts.includeHistory = true;
    else if (arg.startsWith("--chat-id=")) opts.chatId = Number(arg.slice("--chat-id=".length));
    else if (arg.startsWith("--character-id=")) opts.characterId = Number(arg.slice("--character-id=".length));
    else if (arg.startsWith("--user-id=")) opts.userId = Number(arg.slice("--user-id=".length));
    else if (arg.startsWith("--provider=")) {
      const p = arg.slice("--provider=".length);
      if (p === "gemini" || p === "openrouter") opts.provider = p;
    } else if (arg.startsWith("--model=")) opts.modelId = arg.slice("--model=".length);
    else if (arg.startsWith("--output=")) opts.output = arg.slice("--output=".length);
  }

  return opts;
}

function dbPath(): string {
  return path.join(process.cwd(), "data", "app.db");
}

function dbAvailable(): boolean {
  try {
    return fs.existsSync(dbPath());
  } catch {
    return false;
  }
}

function padLineNumber(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function withLineNumbers(text: string, startLine = 1): string {
  const lines = text.split("\n");
  const width = Math.max(4, String(startLine + lines.length - 1).length);
  return lines
    .map((line, i) => `${padLineNumber(startLine + i, width)}| ${line}`)
    .join("\n");
}

async function buildMockFixture() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const userNickname = "렌";
  const personaDisplayName = "렌";

  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격
차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다. 필요할 때만 짧고 단호하게 말한다.

# 말투
- 평소: "~요", "~죠" 등 정중한 존댓말
- 긴장/분노: 문장이 짧아지고 말끝이 딱 끊긴다
- 금지: 과도한 이모티콘, 현대 인터넷 슬랭

# 외형
키 178cm, 검은 머리, 날카로운 눈매. 검은 코트와 장갑을 즐겨 착용한다.`,
    world: `# 세계관
현대 도시 배경. 초자연적 존재와 일반인이 공존하는 세계. 밤거리에는 감시자들이 순찰한다.`,
    exampleDialog: `유저: 오늘 밤에도 나가?
${charName}: …필요하면요. 당신은 집에 계시죠.
유저: 혼자 가기 무섭잖아.
${charName}: 무섭다면, 제 옆에 있으면 됩니다.`,
    statusWindowPrompt: "",
  });

  const personaDescription =
    "20대 후반 대학원생. 호기심 많고 직설적이지만 상대를 존중한다. 밤 산책과 커피를 좋아한다.";
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    "other",
    personaDescription
  );

  const userNoteRaw = `[고집중]
렌은 백하율을 오래 알고 지낸 친구처럼 대한다. 과거 사건(3년 전 실종 사건)을 아직 완전히 극복하지 못했다.

[참조]
- 렌의 집은 도심 아파트 12층
- 백하율에게는 반말 섞인 편한 존댓말 사용
- 상태창: 기분, 피로도, 현재 위치`;

  const userNotePrompt = formatUserNoteForPrompt(userNoteRaw);

  const memoryMeta = formatMemoryMetaForPrompt(
    parseMemoryMeta(
      JSON.stringify({
        affection: 72,
        trust: 65,
        tension: 18,
        relationshipLabel: "오래된 지인",
      })
    )
  );

  const longTermMemory = `[장기 기억 요약]
- 3년 전 실종 사건 이후 렌과 백하율은 서로를 더 자주 확인한다.
- 최근 도심 골목에서 이상한 그림자를 목격했다.
- 백하율은 렌에게 위험 신호를 숨기려는 경향이 있다.`;

  const shortTermHistory = [
    {
      role: "user" as const,
      content: "오늘도 밤산책 갈래? 요즘 거리가 좀 이상한 것 같아.",
    },
    {
      role: "assistant" as const,
      content: `백하율은 창밖의 어두운 거리를 잠시 바라본 뒤, 조용히 고개를 끄덕였다.

"…이상하다고 느끼셨군요. 저도 같은 감각입니다."

그는 코트 단추를 채우며 렌 쪽을 돌아보았다.

"가시려면, 제 옆에 붙어 있으세요."`,
    },
  ];

  const contextualLore = `[CONTEXTUAL LORE · matched keywords: 실종, 그림자]
3년 전 실종 사건 당시 목격자들은 '그림자가 사람을 삼켰다'고 증언했다. 공식 기록에는 남지 않았다.`;

  const recentNarrativeContext = `[RECENT NARRATIVE CONTEXT · turn 8]
렌과 백하율은 골목 입구에서 멈춰 섰고, 멀리서 금속성 소리가 울렸다.`;

  return {
    source: "mock" as const,
    charName,
    userNickname,
    personaDisplayName,
    chunks,
    userPersonaPrompt,
    userNotePrompt,
    longTermMemory,
    memoryMeta,
    shortTermHistory,
    currentUserMessage: "…방금 소리, 들었어? 뭔가 따라오는 것 같아.",
    nsfw: true,
    gender: "male" as const,
    assetTags: ["neutral", "alert", "protective"],
    completedTurns: 9,
    userPersonaGender: "other" as const,
    genres: ["공포/추리", "현대/일상"] as import("../src/lib/characterGenres").CharacterGenre[],
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    contextualLore,
    recentNarrativeContext,
    keywordLorebookBlock: "[KEYWORD LOREBOOK]\n금속성 소리: 감시자 순찰의 신호음일 수 있다.",
  };
}

async function loadFromDb(opts: CliOpts) {
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
  if (opts.chatId) {
    chat = db.prepare("SELECT * FROM chats WHERE id=?").get(opts.chatId) as Record<string, unknown> | undefined;
  } else {
    chat = db
      .prepare(
        `SELECT * FROM chats
         WHERE (? IS NULL OR user_id=?) AND (? IS NULL OR character_id=?)
         ORDER BY id DESC LIMIT 1`
      )
      .get(opts.userId ?? null, opts.userId ?? null, opts.characterId ?? null, opts.characterId ?? null) as
      | Record<string, unknown>
      | undefined;
  }

  if (!chat) throw new Error("No matching chat in DB — use --chat-id or --mock");

  const userId = Number(chat.user_id);
  const characterId = Number(chat.character_id);
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(userId) as Record<string, unknown> | undefined;
  const ch = db.prepare("SELECT * FROM characters WHERE id=?").get(characterId) as Record<string, unknown> | undefined;
  if (!user || !ch) throw new Error(`Missing user(${userId}) or character(${characterId}) row`);

  const personaRow = chat.selected_persona_id
    ? (db.prepare("SELECT * FROM user_personas WHERE id=?").get(chat.selected_persona_id) as Record<
        string,
        unknown
      > | null)
    : null;

  const personaDisplayName = String(personaRow?.name ?? user.nickname ?? "").trim() || "유저";
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
    String(personaRow?.description ?? "")
  );
  const userNotePrompt = formatUserNoteForPrompt(
    String(chat.user_note ?? user.user_note ?? "").trim()
  );

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

  const recentContextForRag = recentHistory
    .slice(-6)
    .map((m) => m.content)
    .join("\n");
  const memoryLayers = buildHierarchicalMemoryPromptLayers({
    chatId: Number(chat.id),
    characterChunks: chunks,
    userMessage: currentUserMessage,
    recentContext: recentContextForRag,
    completedTurns: completedTurns.length,
    modelId: opts.modelId,
    provider: opts.provider,
  });

  return {
    source: "db" as const,
    chatId: Number(chat.id),
    userId,
    characterId: Number(ch.id),
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
    keywordLorebookBlock: undefined as string | undefined,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { buildContext } = await import("../src/services/contextBuilder");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { formatPromptAuditLog } = await import("../src/services/promptAudit");

  let fixture: Awaited<ReturnType<typeof loadFromDb>> | Awaited<ReturnType<typeof buildMockFixture>>;
  let loadNote = "";

  if (opts.mock || !dbAvailable()) {
    fixture = await buildMockFixture();
    loadNote = opts.mock ? "forced mock (--mock)" : "mock (data/app.db not found)";
  } else {
    try {
      fixture = await loadFromDb(opts);
      loadNote = `db chat=${fixture.chatId} user=${fixture.userId} character=${fixture.characterId}`;
    } catch (e) {
      console.warn(`[dump-system-prompt] DB load failed: ${(e as Error).message} — falling back to mock`);
      fixture = await buildMockFixture();
      loadNote = "mock (DB load failed)";
    }
  }

  const promptDumpSource = fixture.source === "db" ? "db" : "mock";
  const promptDumpDetail =
    fixture.source === "db"
      ? `chat=${fixture.chatId} user=${fixture.userId} character=${fixture.characterId}`
      : loadNote;

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
    modelId: opts.modelId,
    userImpersonation: fixture.userImpersonation,
    novelModeEnabled: fixture.novelModeEnabled,
    personaDisplayName: fixture.personaDisplayName,
    targetResponseChars: fixture.targetResponseChars,
    completedTurns: fixture.completedTurns,
    userPersonaGender: fixture.userPersonaGender,
    provider: opts.provider,
    genres: fixture.genres,
    contextualLore: fixture.contextualLore,
    recentNarrativeContext: fixture.recentNarrativeContext,
    keywordLorebookBlock: fixture.keywordLorebookBlock,
    geminiStaticDynamicMode: opts.provider === "gemini",
    promptDumpSource,
    promptDumpDetail,
  });

  const systemPrompt = built.systemPrompt;
  const lineCount = systemPrompt.split("\n").length;
  const sections = built.meta.trackedSections ?? [];
  const audit = built.meta.promptAudit;

  const header: string[] = [
    "=".repeat(80),
    `SYSTEM PROMPT DUMP — ${new Date().toISOString()}`,
    `source=${fixture.source} load=${loadNote}`,
    `provider=${opts.provider} model=${opts.modelId}`,
    `character="${fixture.charName}" persona="${fixture.personaDisplayName}" user="${fixture.userNickname}"`,
    `system=${systemPrompt.length.toLocaleString()} chars · ${lineCount.toLocaleString()} lines · ≈${estimateTokens(systemPrompt).toLocaleString()} tok`,
    `sections=${sections.length} completedTurns=${fixture.completedTurns} nsfw=${fixture.nsfw}`,
    "=".repeat(80),
    "",
    "SECTION INDEX (in assembly order):",
  ];

  for (const s of sections) {
    const tok = estimateTokens(s.text);
    header.push(
      `  • ${s.id.padEnd(28)} ${String(tok).padStart(6)} tok  [${s.category}] ${s.label}`
    );
  }

  if (audit) {
    header.push("", "PROMPT AUDIT:", formatPromptAuditLog(audit, { route: "dump-system-prompt" }));
  }

  header.push("", "=".repeat(80), "FULL ASSEMBLED SYSTEM PROMPT (line-numbered)", "=".repeat(80), "");

  const body = withLineNumbers(systemPrompt);
  const chunks: string[] = [...header, body];

  if (opts.includeHistory) {
    chunks.push(
      "",
      "=".repeat(80),
      `HISTORY + CURRENT USER TURN (${built.history.length} messages)`,
      "=".repeat(80),
      ""
    );
    built.history.forEach((m, i) => {
      chunks.push(`--- [${i + 1}] ${m.role} (${m.content.length} chars) ---`, withLineNumbers(m.content), "");
    });
  }

  chunks.push(
    "",
    "=".repeat(80),
    "NOTES",
    "- This file is the buildContext() systemPrompt string (same as chat route before streaming).",
    "- For an exact last-turn dump from production, pass --chat-id=<id> with a populated data/app.db.",
    "- OpenRouter post-request overlays (speech rewrite, continuation) are not included.",
    "- Re-run: npx.cmd tsx scripts/dump-system-prompt.ts [--mock] [--chat-id=N] [--include-history]",
    "=".repeat(80)
  );

  const outPath = path.resolve(process.cwd(), opts.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, chunks.join("\n"), "utf8");

  console.log(`Wrote ${outPath}`);
  console.log(`  ${lineCount} lines · ${systemPrompt.length} chars · ≈${estimateTokens(systemPrompt)} system tokens`);
  console.log(`  source=${fixture.source} provider=${opts.provider} model=${opts.modelId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
