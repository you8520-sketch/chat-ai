/**
 * Audit Speech Lock + NSFW rule duplication in buildContext() system prompt.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-speech-nsfw-duplication.ts
 *   npx.cmd tsx scripts/audit-speech-nsfw-duplication.ts --chat-id=26
 *   npx.cmd tsx scripts/audit-speech-nsfw-duplication.ts --mock --provider=openrouter
 *   npx.cmd tsx scripts/audit-speech-nsfw-duplication.ts --output=output/speech-nsfw-audit.txt
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

type CliOpts = {
  chatId: number;
  characterId?: number;
  userId?: number;
  provider: "gemini" | "openrouter";
  modelId: string;
  output: string;
  mock: boolean;
};

type TrackedSection = {
  id: string;
  label: string;
  category: string;
  text: string;
};

type ClusterMatch = {
  snippet: string;
  sourceLabel: string;
  sectionId: string;
};

type ClusterResult = {
  id: number;
  name: string;
  matches: ClusterMatch[];
  injectionPoints: number;
  wastedTokens: number;
  sourceLabels: string[];
};

type NsfwClusterResult = {
  theme: string;
  matches: ClusterMatch[];
  sourceLabels: string[];
  mergeRecommended: boolean;
};

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    chatId: 26,
    provider: "openrouter",
    modelId: "google/gemini-3.1-pro-preview",
    output: path.join("output", "speech-nsfw-audit.txt"),
    mock: false,
  };

  for (const arg of argv) {
    if (arg === "--mock") opts.mock = true;
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

/** Map trackedSections id → audit source label */
function resolveSourceLabel(sectionId: string): string {
  const exact: Record<string, string> = {
    "deepseek-v4-korean-style-top": "DEEPSEEK_KOREAN_NSFW_PREFIX",
    "deepseek-co-narration-rule": "DEEPSEEK_CO_NARRATION",
    "identity-and-rules": "IDENTITY_RULES",
    "user-persona-speech-guard": "USER_PERSONA_SPEECH_GUARD",
    "rule-core-master": "CORE_PROMPT",
    "rule-core-turn-hint": "CORE_PROMPT_TURN_HINT",
    "rule-shared-prose": "SHARED_PROSE_RULES",
    "deepseek-fewshot-style": "FEW_SHOT_STYLE_REFERENCE",
    "ooc-co-narration": "OOC_CO_NARRATION",
    "narrative-style": "NARRATIVE_STYLE_LAYER",
    "state-window-policy": "STATE_WINDOW_POLICY",
    "user-persona-narration-rules": "USER_PERSONA_NARRATION_RULES",
    "auto-continue-persona-rules": "AUTO_CONTINUE_PERSONA_RULES",
    "novel-mode-persona-rules": "NOVEL_MODE_PERSONA_RULES",
    "rule-prose-guard": "OPENROUTER_PROSE_GUARD",
    "rule-length-control": "LENGTH_CONTROL",
    "korean-output-directive": "KOREAN_OUTPUT_DIRECTIVE",
    "dialogue-format-directive": "DIALOGUE_FORMAT_DIRECTIVE",
    "korean-narration-ending": "KOREAN_NARRATION_ENDING",
    "visual-appearance-anchor": "VISUAL_APPEARANCE_ANCHOR",
    "nsfw-style-reference": "NSFW_STYLE_REFERENCE",
    "sfw-style-reference": "SFW_STYLE_REFERENCE",
    "nsfw-adult-style-reference": "NSFW_ADULT_TAIL",
    "current-memory": "MEMORY",
    "recent-narrative-context": "RECENT_NARRATIVE",
    "relationship-meta": "RELATIONSHIP_META",
    "user-note-reference": "USER_NOTE",
    "contextual-lore-rag": "CONTEXTUAL_LORE_RAG",
    "keyword-lorebook": "KEYWORD_LOREBOOK",
    "rule-asset-tags": "ASSET_EMOTION_TAGS",
  };

  if (exact[sectionId]) return exact[sectionId];
  if (sectionId.startsWith("chunk-critical-")) return `CHARACTER_CRITICAL_${sectionId.replace("chunk-critical-", "")}`;
  if (sectionId.startsWith("chunk-lore-")) return `CHARACTER_LORE_${sectionId.replace("chunk-lore-", "")}`;
  return sectionId.toUpperCase().replace(/-/g, "_");
}

function truncateSnippet(text: string, max = 120): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

function extractSnippetAroundMatch(text: string, index: number, max = 120): string {
  const radius = Math.floor(max / 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return truncateSnippet(snippet, max);
}

type PatternDef = { re: RegExp; weight?: number };

function findClusterMatches(
  sections: TrackedSection[],
  patterns: PatternDef[]
): { matches: ClusterMatch[]; matchedCharsBySection: Map<string, number> } {
  const matches: ClusterMatch[] = [];
  const matchedCharsBySection = new Map<string, number>();
  const seenSnippets = new Set<string>();

  for (const section of sections) {
    const sourceLabel = resolveSourceLabel(section.id);
    let sectionMatchChars = 0;

    for (const { re } of patterns) {
      const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
      const regex = new RegExp(re.source, flags);
      let m: RegExpExecArray | null;
      while ((m = regex.exec(section.text)) !== null) {
        const snippet = extractSnippetAroundMatch(section.text, m.index);
        const key = `${sourceLabel}::${snippet.slice(0, 60)}`;
        if (seenSnippets.has(key)) continue;
        seenSnippets.add(key);
        matches.push({ snippet, sourceLabel, sectionId: section.id });
        sectionMatchChars += m[0].length;
      }
    }

    if (sectionMatchChars > 0) {
      matchedCharsBySection.set(section.id, sectionMatchChars);
    }
  }

  return { matches, matchedCharsBySection };
}

function computeWastedTokens(matchedCharsBySection: Map<string, number>): number {
  const charCounts = [...matchedCharsBySection.values()];
  if (charCounts.length <= 1) return 0;
  charCounts.sort((a, b) => b - a);
  const duplicateChars = charCounts.slice(1).reduce((s, c) => s + c, 0);
  return Math.round(duplicateChars / 4);
}

const SPEECH_LOCK_CLUSTERS: { name: string; patterns: PatternDef[] }[] = [
  {
    name: "no user dialogue",
    patterns: [
      { re: /NO\s+["']?\$\{?userName\}?["']?\s+quoted\s+dialogue/i },
      { re: /NO\s+user\s+dialogue/i },
      { re: /Do\s+NOT\s+invent\s+["'][^"']+["']\s+dialogue/i },
      { re: /직접적인\s*대사/i },
      { re: /대사\s*\(\s*["']\s*["']\s*안의\s*말\s*\)/i },
      { re: /유저\s*페르소나\s*직접\s*대사[^\n]{0,20}금지/i },
      { re: /leave\s+["'][^"']+["']'s\s+next\s+line\s+to\s+the\s+human/i },
      { re: /유저(?:가|는)\s*직접\s*입력/i },
      { re: /User\s+types\s+their\s+own\s+lines/i },
    ],
  },
  {
    name: "no user action",
    patterns: [
      { re: /proactive\s+action/i },
      { re: /주도적인\s*(?:결정\s*및\s*)?행동/i },
      { re: /주도\s*행동/i },
      { re: /NO\s+invented\s+user\s+emotion\/decision/i },
      { re: /감정·결정\s*창작\s*금지/i },
      { re: /User\s+keeps\s+narrative\s+agency/i },
    ],
  },
  {
    name: "no user thought / inner monologue",
    patterns: [
      { re: /inner\s+monologue/i },
      { re: /deep\s+inner\s+monologue/i },
      { re: /속마음/i },
      { re: /내면(?:의)?\s*(?:깊은\s*)?(?:속마음|생각)/i },
      { re: /inner\s+thought/i },
    ],
  },
  {
    name: "godmodding ban",
    patterns: [
      { re: /godmod/i },
      { re: /사칭/i },
      { re: /Do\s+NOT\s+invent/i },
      { re: /적극적\s*개입/i },
      { re: /impersonation/i },
      { re: /co-narration\s*\(\s*사칭\s*허용\s*\)\s*OFF/i },
    ],
  },
  {
    name: "stop after NPC action / never speak for player",
    patterns: [
      { re: /End\s+after\s+["'][^"']+["']\s+acts/i },
      { re: /End\s+turn\s+with\s+choice\s+back/i },
      { re: /NO\s+scene\s+auto-close/i },
      { re: /멈추/i },
      { re: /유저(?:에게|의\s*대사는)\s*남겨/i },
      { re: /말할\s*차례(?:가\s*오면)?/i },
      { re: /기다리는\s*순간/i },
      { re: /Reaction\)\s*입장으로만/i },
    ],
  },
];

const NSFW_CLUSTERS: { theme: string; patterns: PatternDef[] }[] = [
  {
    theme: "erotic allowance (19+ explicit OK)",
    patterns: [
      { re: /\[19\+\s*NSFW\]/i },
      { re: /Adult\s+verified/i },
      { re: /Explicit\s+(?:OK|romance\/intimacy\s+OK)/i },
      { re: /성적\s*(?:표현|묘사)/i },
      { re: /성인\s*인증/i },
      { re: /19금/i },
      { re: /친밀(?:한)?\s*신체\s*접촉/i },
    ],
  },
  {
    theme: "sensual / decadent prose rules",
    patterns: [
      { re: /퇴폐적\s*관능/i },
      { re: /DECADENT|SENSUAL\s+WRITING/i },
      { re: /관능\s*문학/i },
      { re: /STYLE_REFERENCE/i },
      { re: /텐션(?:,|\s).*시각\/촉각/i },
      { re: /통각과\s*체온/i },
    ],
  },
  {
    theme: "anti-clinical wording (explicit anatomy, no euphemism dodge)",
    patterns: [
      { re: /검열(?:\s*회피|\s*하지)/i },
      { re: /대명사(?:로)?\s*뭉뚱/i },
      { re: /'그곳'/i },
      { re: /해부학\s*명칭/i },
      { re: /노골적(?:이고)?\s*정확한/i },
      { re: /성기|페니스|음경|귀두/i },
    ],
  },
  {
    theme: "pacing / no loop / new action each beat",
    patterns: [
      { re: /Gradual\s+escalation/i },
      { re: /NO\s+skip\s+to\s+climax/i },
      { re: /NEW\s+action(?:\/sense\/dialogue|\s+each\s+paragraph)?/i },
      { re: /조기\s*종료\s*금지/i },
      { re: /NO\s+repeated\s+moans\/poses/i },
      { re: /NO\s+copy\s+prior\s+turn/i },
    ],
  },
  {
    theme: "emotional realism / keep character voice",
    patterns: [
      { re: /KEEP\s+character\s+voice/i },
      { re: /keep\s+voice\/personality/i },
      { re: /personality\/tone\/world/i },
      { re: /캐릭터\s*페르소나(?:\s*및\s*세계관)?\s*—\s*절대\s*붕괴/i },
      { re: /성격(?:\/말투)?(?:\/관계)?\s*(?:유지|반영)/i },
    ],
  },
  {
    theme: "consent / relationship integrity",
    patterns: [
      { re: /relationship\s+(?:stage|\+)/i },
      { re: /NO\s+instant\s+submission/i },
      { re: /관계(?:·감정)?\s*발전/i },
      { re: /Distance\/boundaries/i },
      { re: /NO\s+obsession\/worship/i },
      { re: /종속(?:과|되는)?/i },
    ],
  },
  {
    theme: "no censorship / creative freedom",
    patterns: [
      { re: /검열하지\s*말\s*것/i },
      { re: /창작\s*자유\s*선언/i },
      { re: /경고\s*문구\s*삽입\s*금지/i },
      { re: /censorship/i },
    ],
  },
  {
    theme: "anti-generic moaning / anti-echo",
    patterns: [
      { re: /repeated\s+moans/i },
      { re: /신음(?:이|을)?\s*(?:터져|구구)/i },
      { re: /억눌린\s*신음/i },
      { re: /아,\s*읏/i },
      { re: /반복(?:·에코|된)/i },
    ],
  },
  {
    theme: "micro reaction / sensory detail rules",
    patterns: [
      { re: /생리적\s*반(?:사|응)/i },
      { re: /수동(?:적)?\s*반응/i },
      { re: /미세한\s*통증/i },
      { re: /근육(?:의)?\s*떨림/i },
      { re: /호흡(?:을|이)\s*끊/i },
      { re: /촉각(?:\/|·)온도/i },
    ],
  },
];

const MERGE_PROPOSALS: { clusterKey: string; block: string }[] = [
  {
    clusterKey: "no user dialogue",
    block: `[USER AGENCY — SPEECH]
"${"${userName}"}" dialogue: human types only — NEVER quote new lines for "${"${userName}"}".
End turn after "${"${charName}"}" acts; leave "${"${userName}"}"'s next line to the player.`,
  },
  {
    clusterKey: "no user action",
    block: `[USER AGENCY — ACTION]
NO proactive decisions or leading actions for "${"${userName}"}" — passive/physiological reactions to "${"${charName}"}" only.`,
  },
  {
    clusterKey: "no user thought / inner monologue",
    block: `[USER AGENCY — THOUGHT]
NO inner monologue or deep thoughts for "${"${userName}"}" unless novel/co-narration mode explicitly ON.`,
  },
  {
    clusterKey: "erotic allowance (19+ explicit OK)",
    block: `[19+ NSFW] Adult verified. Explicit intimacy OK — keep "${"${charName}"}" voice, relationship stage, gradual escalation; no censorship disclaimers.`,
  },
  {
    clusterKey: "sensual / decadent prose rules",
    block: `[NSFW PROSE] Sensory contrast, breath-cut short sentences, show via action not exposition — maintain decadent density for full target length.`,
  },
  {
    clusterKey: "anti-clinical wording (explicit anatomy, no euphemism dodge)",
    block: `[NSFW ANATOMY] Use direct anatomical terms; no vague "그곳" euphemism dodge in explicit scenes.`,
  },
];

// ─── Fixture loaders (from dump-system-prompt.ts) ───

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
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.\n\n# 말투\n- 평소: "~요", "~죠" 등 정중한 존댓말`,
    world: `# 세계관\n현대 도시 배경.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  return {
    source: "mock" as const,
    charName,
    userNickname,
    personaDisplayName,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(personaDisplayName, "other", "20대 대학원생."),
    userNotePrompt: formatUserNoteForPrompt("[고집중]\n렌은 백하율을 오래 알고 지낸 친구처럼 대한다."),
    longTermMemory: "[장기 기억]\n- 3년 전 실종 사건 이후 서로를 더 자주 확인한다.",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(JSON.stringify({ affection: 72, trust: 65 }))),
    shortTermHistory: [
      { role: "user" as const, content: "오늘도 밤산책 갈래?" },
      { role: "assistant" as const, content: `${charName}은 조용히 고개를 끄덕였다.\n"…같이 가시죠."` },
    ],
    currentUserMessage: "…방금 소리, 들었어?",
    nsfw: true,
    gender: "male" as const,
    assetTags: ["neutral"],
    completedTurns: 9,
    userPersonaGender: "other" as const,
    genres: ["현대/일상"] as import("../src/lib/characterGenres").CharacterGenre[],
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    contextualLore: undefined as string | undefined,
    recentNarrativeContext: undefined as string | undefined,
    keywordLorebookBlock: undefined as string | undefined,
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
  const chat = db.prepare("SELECT * FROM chats WHERE id=?").get(opts.chatId) as Record<string, unknown> | undefined;
  if (!chat) throw new Error(`Chat ${opts.chatId} not found`);

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

  const msgRows = db
    .prepare("SELECT role, content FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(opts.chatId) as { role: "user" | "assistant"; content: string }[];
  const completedTurns = messagesToTurns(msgRows);
  const recentHistory = recentTurnsToHistory(completedTurns, completedTurns.length);
  const lastUser = [...recentHistory].reverse().find((m) => m.role === "user");

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
    .get(opts.chatId) as { recent_summary?: string } | undefined;

  const genres = sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]")));
  const assetTags = [...new Set(chatAssets(parseAssets(String(ch.assets ?? "[]"))).map((a) => a.tag))];

  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(ch.name),
    systemPrompt: String(ch.system_prompt ?? ""),
    chunks,
    userName: personaDisplayName,
  });

  const memoryLayers = buildHierarchicalMemoryPromptLayers({
    chatId: opts.chatId,
    characterChunks: chunks,
    userMessage: lastUser?.content ?? "안녕",
    recentContext: recentHistory.slice(-6).map((m) => m.content).join("\n"),
    completedTurns: completedTurns.length,
    modelId: opts.modelId,
    provider: opts.provider,
  });

  return {
    source: "db" as const,
    chatId: opts.chatId,
    charName: String(ch.name),
    userNickname: String(user.nickname),
    personaDisplayName,
    chunks,
    userPersonaPrompt,
    userNotePrompt: formatUserNoteForPrompt(String(chat.user_note ?? user.user_note ?? "").trim()),
    longTermMemory: String(memRow?.recent_summary ?? chat.current_summary ?? chat.memory ?? "").trim(),
    memoryMeta: formatMemoryMetaForPrompt(
      normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "")), relationshipNames)
    ),
    shortTermHistory: recentHistory.slice(0, -1),
    currentUserMessage: lastUser?.content ?? "안녕",
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

function runSpeechLockAudit(sections: TrackedSection[]): ClusterResult[] {
  return SPEECH_LOCK_CLUSTERS.map((cluster, idx) => {
    const { matches, matchedCharsBySection } = findClusterMatches(sections, cluster.patterns);
    const sourceLabels = [...new Set(matches.map((m) => m.sourceLabel))];
    return {
      id: idx + 1,
      name: cluster.name,
      matches,
      injectionPoints: matchedCharsBySection.size,
      wastedTokens: computeWastedTokens(matchedCharsBySection),
      sourceLabels,
    };
  }).filter((c) => c.injectionPoints > 0);
}

function runNsfwAudit(
  sections: TrackedSection[],
  systemPrompt: string,
  openRouterNsfwCore: string
): NsfwClusterResult[] {
  const openRouterPresent = systemPrompt.includes("NO repeated moans/poses");

  return NSFW_CLUSTERS.map((cluster) => {
    const { matches, matchedCharsBySection } = findClusterMatches(sections, cluster.patterns);
    const sourceLabels = [...new Set(matches.map((m) => m.sourceLabel))];
    const inFullPrompt = cluster.patterns.some(({ re }) => re.test(systemPrompt));
    const openRouterHit =
      !openRouterPresent &&
      cluster.patterns.some(({ re }) => {
        const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
        return new RegExp(re.source, flags).test(openRouterNsfwCore);
      });

    if (openRouterHit && !sourceLabels.includes("OPENROUTER_NSFW_CORE")) {
      sourceLabels.push("OPENROUTER_NSFW_CORE (route overlay — NOT in buildContext)");
    }

    return {
      theme: cluster.theme,
      matches,
      sourceLabels,
      mergeRecommended: sourceLabels.length >= 2 || (inFullPrompt && matchedCharsBySection.size >= 2),
    };
  }).filter((c) => c.sourceLabels.length > 0 || c.matches.length > 0);
}

function formatReport(opts: {
  loadNote: string;
  fixture: { source: string; charName: string; personaDisplayName: string; nsfw: boolean };
  provider: string;
  modelId: string;
  systemPrompt: string;
  sections: TrackedSection[];
  speechResults: ClusterResult[];
  nsfwResults: NsfwClusterResult[];
  totalSavings: number;
}): string {
  const lines: string[] = [];
  lines.push("=".repeat(72));
  lines.push(`SPEECH LOCK + NSFW DUPLICATION AUDIT — ${new Date().toISOString()}`);
  lines.push(`load=${opts.loadNote}`);
  lines.push(
    `provider=${opts.provider} model=${opts.modelId} nsfw=${opts.fixture.nsfw} char="${opts.fixture.charName}" persona="${opts.fixture.personaDisplayName}"`
  );
  lines.push(`systemPrompt=${opts.systemPrompt.length} chars · sections=${opts.sections.length}`);
  lines.push("=".repeat(72));
  lines.push("");

  lines.push("TRACKED SECTIONS → SOURCE LABELS:");
  for (const s of opts.sections) {
    lines.push(`  ${resolveSourceLabel(s.id).padEnd(36)} ${s.id} (${s.text.length} chars)`);
  }
  lines.push("");

  lines.push("[Speech Lock Audit]");
  if (opts.speechResults.length === 0) {
    lines.push("(no speech-lock clusters detected)");
  }
  for (const c of opts.speechResults) {
    lines.push(`cluster #${c.id}:`);
    const uniqueSnippets = [...new Set(c.matches.map((m) => m.snippet))].slice(0, 8);
    for (const snip of uniqueSnippets) {
      lines.push(`- "${snip}"`);
    }
    lines.push(`=> duplicated: ${c.injectionPoints} injections`);
    lines.push(`=> wasted estimate: ${c.wastedTokens} tokens`);
    lines.push(`(sources: ${c.sourceLabels.join(", ")})`);
    lines.push("");
  }

  lines.push("[NSFW Audit]");
  for (const c of opts.nsfwResults) {
    lines.push(`"${c.theme}"`);
    if (c.sourceLabels.length >= 2) {
      lines.push("duplicated in:");
      for (const src of c.sourceLabels) {
        lines.push(`- ${src}`);
      }
      lines.push("=> merge recommended");
    } else if (c.sourceLabels.length === 1) {
      lines.push(`single source: ${c.sourceLabels[0]}`);
    } else {
      lines.push("(matched in full prompt only — no tracked section hit)");
    }
    const snips = [...new Set(c.matches.map((m) => m.snippet))].slice(0, 4);
    for (const snip of snips) {
      lines.push(`  · "${snip}"`);
    }
    lines.push("");
  }

  lines.push("[Compact Merge Proposals]");
  let proposalNum = 0;
  for (const proposal of MERGE_PROPOSALS) {
    const speechHit = opts.speechResults.find((s) => s.name === proposal.clusterKey && s.injectionPoints >= 2);
    const nsfwHit = opts.nsfwResults.find((n) => n.theme === proposal.clusterKey && n.mergeRecommended);
    if (!speechHit && !nsfwHit) continue;
    proposalNum++;
    const savings =
      (speechHit?.wastedTokens ?? 0) +
      (nsfwHit
        ? Math.round(
            nsfwHit.matches.reduce((s, m) => s + m.snippet.length, 0) /
              Math.max(1, nsfwHit.sourceLabels.length) /
              4
          )
        : 0);
    lines.push(`#${proposalNum} [${proposal.clusterKey}] (~${savings} tok savings if deduped)`);
    lines.push(proposal.block);
    lines.push("");
  }

  if (proposalNum === 0) {
    lines.push("(no multi-source clusters warranting merge — see cluster details above)");
    lines.push("");
  }

  lines.push(`Total estimated savings: ${opts.totalSavings} tokens`);
  lines.push("");
  lines.push("NOTES:");
  lines.push("- Audit scope: buildContext() systemPrompt + trackedSections (pre-stream assembly).");
  lines.push("- OPENROUTER_NSFW_CORE / buildAdultSystemPrompt overlay is NOT injected in current chat route.");
  lines.push("- Token waste = chars/4 heuristic on duplicate injection points beyond the first per cluster.");
  lines.push("=".repeat(72));

  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { buildContext } = await import("../src/services/contextBuilder");
  const { OPENROUTER_NSFW_CORE } = await import("../src/lib/openRouterAdult");

  let fixture: Awaited<ReturnType<typeof loadFromDb>> | Awaited<ReturnType<typeof buildMockFixture>>;
  let loadNote = "";

  if (opts.mock || !dbAvailable()) {
    fixture = await buildMockFixture();
    loadNote = opts.mock ? "forced mock (--mock)" : `mock (chat-id=${opts.chatId}, data/app.db not found)`;
  } else {
    try {
      fixture = await loadFromDb(opts);
      loadNote = `db chat=${opts.chatId} nsfw=${fixture.nsfw}`;
    } catch (e) {
      console.warn(`[audit] DB load failed: ${(e as Error).message} — falling back to mock`);
      fixture = await buildMockFixture();
      loadNote = `mock (chat ${opts.chatId} load failed)`;
    }
  }

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
  });

  const systemPrompt = built.systemPrompt;
  const sections: TrackedSection[] = (built.meta.trackedSections ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    category: s.category,
    text: s.text,
  }));

  const speechResults = runSpeechLockAudit(sections);
  const nsfwResults = runNsfwAudit(sections, systemPrompt, OPENROUTER_NSFW_CORE);

  const speechWaste = speechResults.reduce((s, c) => s + c.wastedTokens, 0);
  const nsfwWaste = nsfwResults
    .filter((c) => c.mergeRecommended)
    .reduce((s, c) => {
      const labels = c.sourceLabels.filter((l) => !l.includes("overlay"));
      if (labels.length < 2) return s;
      const chars = c.matches.reduce((n, m) => n + m.snippet.length, 0);
      return s + Math.round((chars * (labels.length - 1)) / labels.length / 4);
    }, 0);
  const totalSavings = speechWaste + nsfwWaste;

  const openRouterInPrompt = systemPrompt.includes(OPENROUTER_NSFW_CORE.slice(0, 30).trim());

  const report = formatReport({
    loadNote,
    fixture,
    provider: opts.provider,
    modelId: opts.modelId,
    systemPrompt,
    sections,
    speechResults,
    nsfwResults,
    totalSavings,
  });

  const outPath = path.resolve(process.cwd(), opts.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, report, "utf8");

  console.log(report);
  console.log("");
  console.log(`Wrote ${outPath}`);
  console.log(
    `Summary: ${speechResults.length} speech clusters · ${nsfwResults.filter((n) => n.mergeRecommended).length} NSFW merge candidates · ~${totalSavings} tok savings · OPENROUTER_NSFW_CORE in prompt=${openRouterInPrompt}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
