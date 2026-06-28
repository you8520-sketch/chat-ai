/**
 * History length · trim window · dual JSON tail · RP SPEED count · API payload shape.
 * Usage: node --import tsx scripts/investigate-history-payload.ts [--chat-id=N]
 */
import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";

const origLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy hook
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const RP_SPEED_PATTERNS = [
  /\[RP SPEED — NO INTERNAL REASONING\]/g,
  /Output the final Korean narrative immediately/gi,
  /first visible token must be story prose/gi,
];

function countMatches(text: string, pattern: RegExp): number {
  const g = pattern.global;
  const m = text.match(pattern);
  if (!g) pattern.lastIndex = 0;
  return m?.length ?? 0;
}

function summarizeRpSpeed(text: string) {
  return {
    rpSpeedBlock: countMatches(text, /\[RP SPEED — NO INTERNAL REASONING\]/g),
    immediateOutput: countMatches(text, /Output the final Korean narrative immediately/gi),
    firstVisibleToken: countMatches(text, /first visible token must be story prose/gi),
    total: RP_SPEED_PATTERNS.reduce((n, p) => n + countMatches(text, p), 0),
  };
}

async function main() {
  const { getDatabasePath } = await import("../src/lib/dataDir");
  const { messagesToTurns, rawRecentTurnsToHistory, resolveRawRecentTurnPool } = await import(
    "../src/lib/hybridMemory"
  );
  const {
    resolveRawRecentTurnWindowForHistory,
    resolveHistoryTokenBudget,
    MIN_HISTORY_TURN_FLOOR,
    CLAUDE_RAW_RECENT_TURN_WINDOW,
    DEEPSEEK_HISTORY_TOKEN_BUDGET,
  } = await import("../src/lib/contextTrack");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { buildOpenRouterMessages } = await import("../src/lib/openRouterAdult");
  const {
    buildPrimaryModelFlashFirewallBlock,
    sanitizePrimaryModelHistoryMessages,
  } = await import("../src/lib/flashOwnedOutputFirewall");
  const {
    isMainModelRelationshipSelfExtractModel,
    RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK,
  } = await import("../src/lib/relationshipMemoryTailPrompt");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL, OPENROUTER_GEMINI_25_PRO_MODEL } = await import(
    "../src/lib/chatModels"
  );
  const { isMemoryFeatureEnabled } = await import("../src/lib/memory/memory-feature");
  const { stripRpMetaPreamble } = await import("../src/lib/narrativeRules");
  const { loadCharacterChunksForPrompt } = await import("../src/lib/characterChunks");

  const chatIdArg = process.argv.find((a) => a.startsWith("--chat-id="));
  const dbPath = getDatabasePath();
  const db = new Database(dbPath, { readonly: true });

  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("=".repeat(80));
  push("HISTORY · PAYLOAD INVESTIGATION");
  push(`generated: ${new Date().toISOString()}`);
  push(`database: ${dbPath}`);
  push("=".repeat(80));

  // ── 1. Recent assistant message lengths (global last 20) ──
  push("", "## 1. Recent assistant messages (DB raw vs display chars)");
  const globalAssistants = db
    .prepare(
      `SELECT m.id, m.chat_id, m.content, m.model, m.created_at,
              c.character_id, ch.name AS char_name
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       JOIN characters ch ON ch.id = c.character_id
       WHERE m.role = 'assistant' AND m.model != 'greeting'
       ORDER BY m.id DESC
       LIMIT 20`
    )
    .all() as Array<{
    id: number;
    chat_id: number;
    content: string;
    model: string;
    created_at: string;
    character_id: number;
    char_name: string;
  }>;

  const lengths = globalAssistants.map((r) => {
    const raw = r.content.length;
    const display = visibleAssistantDisplayCharCount(r.content);
    return { raw, display };
  });
  const avgRaw = lengths.reduce((s, x) => s + x.raw, 0) / (lengths.length || 1);
  const avgDisplay = lengths.reduce((s, x) => s + x.display, 0) / (lengths.length || 1);

  push(`Last ${globalAssistants.length} assistant messages (all chats, newest first):`);
  push(`  average raw chars:     ${Math.round(avgRaw).toLocaleString()}`);
  push(`  average display chars: ${Math.round(avgDisplay).toLocaleString()} (billing/UI strip)`);
  push("");
  for (const r of globalAssistants) {
    const disp = visibleAssistantDisplayCharCount(r.content);
    push(
      `  msg#${r.id} chat=${r.chat_id} ${r.char_name} raw=${r.content.length} display=${disp} model=${r.model || "—"} ${r.created_at}`
    );
  }

  // Pick chat for deep simulation
  let chatId = chatIdArg ? Number(chatIdArg.split("=")[1]) : globalAssistants[0]?.chat_id;
  if (!chatId) {
    const row = db.prepare("SELECT id FROM chats ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
    chatId = row?.id;
  }
  if (!chatId) {
    push("No chat found.");
    fs.writeFileSync(path.join("output", "investigate-history-payload.txt"), lines.join("\n"));
    return;
  }

  push("", `### Per-chat last 20 assistants (chat_id=${chatId})`);
  const chatAssistants = db
    .prepare(
      `SELECT id, content, model, created_at FROM messages
       WHERE chat_id = ? AND role = 'assistant' AND model != 'greeting'
       ORDER BY id DESC LIMIT 20`
    )
    .all(chatId) as Array<{ id: number; content: string; model: string; created_at: string }>;

  const chatLengths = chatAssistants.map((r) => visibleAssistantDisplayCharCount(r.content));
  const chatAvg =
    chatLengths.reduce((a, b) => a + b, 0) / (chatLengths.length || 1);
  push(`  count: ${chatAssistants.length} · avg display chars: ${Math.round(chatAvg).toLocaleString()}`);
  for (const r of chatAssistants) {
    push(
      `  msg#${r.id} display=${visibleAssistantDisplayCharCount(r.content)} raw=${r.content.length} ${r.created_at}`
    );
  }

  // ── 2. History window & trim pipeline ──
  push("", "## 2. History window before API (route → contextBuilder)");
  const chatRow = db
    .prepare(
      `SELECT c.*, ch.name, ch.gender, ch.system_prompt, ch.world, ch.example_dialog,
              ch.setting_chunks, ch.setting_chunks_en, ch.prompt_translation_hash,
              ch.speech_profile, ch.nsfw, ch.genres, ch.status_widget_json,
              ch.status_widget_allow_user_override
       FROM chats c JOIN characters ch ON ch.id = c.character_id WHERE c.id = ?`
    )
    .get(chatId) as Record<string, unknown>;

  const allRows = db
    .prepare(
      `SELECT role, content, model FROM messages WHERE chat_id = ? ORDER BY id ASC`
    )
    .all(chatId) as Array<{ role: string; content: string; model: string }>;

  const turns = messagesToTurns(
    allRows.map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content,
      model: r.model,
    }))
  );
  const completedTurns = turns.length;
  const summarizedTurnCount = Number(
    (db.prepare("SELECT summarized_turn_count FROM chat_memories WHERE chat_id = ?").get(chatId) as
      | { summarized_turn_count: number }
      | undefined)?.summarized_turn_count ?? 0
  );

  const models = [
    { label: "DeepSeek V4 Pro", id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL },
    { label: "Gemini 2.5 Pro", id: OPENROUTER_GEMINI_25_PRO_MODEL },
  ];

  for (const m of models) {
    const rawWindow = resolveRawRecentTurnWindowForHistory(m.id, "openrouter", completedTurns);
    const pool = resolveRawRecentTurnPool(turns, summarizedTurnCount, rawWindow);
    const historyFromRoute = rawRecentTurnsToHistory(turns, summarizedTurnCount, rawWindow);
    const histBudget = resolveHistoryTokenBudget(m.id, "openrouter");

    push("", `### ${m.label} (${m.id})`);
    push(`  completedTurns: ${completedTurns} · summarizedTurnCount: ${summarizedTurnCount}`);
    push(`  resolveRawRecentTurnWindowForHistory: ${rawWindow} turns (not 20 by default)`);
    push(`  CLAUDE_RAW_RECENT_TURN_WINDOW (non-DeepSeek default): ${CLAUDE_RAW_RECENT_TURN_WINDOW}`);
    push(`  MIN_HISTORY_TURN_FLOOR: ${MIN_HISTORY_TURN_FLOOR} turns (= ${MIN_HISTORY_TURN_FLOOR * 2} messages min)`);
    push(`  raw pool turns after summarize slice: ${pool.pool.length} (firstTurn1Indexed=${pool.firstTurn1Indexed})`);
    push(`  rawRecentTurnsToHistory messages: ${historyFromRoute.length} (${historyFromRoute.length / 2} turn pairs)`);
    push(`  resolveHistoryTokenBudget: ${histBudget} tokens (DeepSeek=${DEEPSEEK_HISTORY_TOKEN_BUDGET})`);

    // inline trim (mirrors contextBuilder.trimHistoryToBudget)
    function trimHist(hist: typeof historyFromRoute, budget: number) {
      if (hist.length === 0) return [];
      const floorMsgCount = Math.min(hist.length, Math.max(1, MIN_HISTORY_TURN_FLOOR * 2));
      const floorSlice = hist.slice(-floorMsgCount);
      let tokens = floorSlice.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
      if (hist.length <= floorMsgCount || tokens >= budget) return floorSlice;
      const kept = [...floorSlice];
      for (let i = hist.length - floorMsgCount - 1; i >= 0; i--) {
        const t = estimateTokens(hist[i].content);
        if (tokens + t > budget) break;
        kept.unshift(hist[i]);
        tokens += t;
      }
      return kept;
    }

    let trimmed = trimHist(historyFromRoute, histBudget);
    const trimmedAssistants = trimmed.filter((x) => x.role === "assistant");
    const trimmedAvg =
      trimmedAssistants.reduce((s, x) => s + visibleAssistantDisplayCharCount(x.content), 0) /
      (trimmedAssistants.length || 1);

    let sanitized = trimmed.map((msg) =>
      msg.role === "assistant"
        ? { ...msg, content: stripRpMetaPreamble(msg.content) }
        : msg
    );
    sanitized = sanitizePrimaryModelHistoryMessages(sanitized, {});

    const sanAssistants = sanitized.filter((x) => x.role === "assistant");
    const sanAvg =
      sanAssistants.reduce((s, x) => s + visibleAssistantDisplayCharCount(x.content), 0) /
      (sanAssistants.length || 1);

    push(`  after trimHistoryToBudget: ${trimmed.length} messages, assistant avg display=${Math.round(trimmedAvg)}`);
    for (const a of trimmedAssistants.slice(-5)) {
      push(`    assistant preview ${visibleAssistantDisplayCharCount(a.content)} chars · ${a.content.slice(0, 80).replace(/\n/g, " ")}…`);
    }
    push(`  after sanitizePrimaryModelHistoryMessages: assistant avg display=${Math.round(sanAvg)}`);
    for (const a of sanAssistants.slice(-5)) {
      push(`    assistant preview ${visibleAssistantDisplayCharCount(a.content)} chars · ${a.content.slice(0, 80).replace(/\n/g, " ")}…`);
    }
  }

  // ── 3. Dual JSON tail by model path ──
  push("", "## 3. STATUS_WIDGET + RELATIONSHIP_MEMORY dual tail");
  const memoryOn = isMemoryFeatureEnabled();
  push(`  memory feature: ${memoryOn ? "ON" : "OFF"}`);

  const tailMatrix = [
    { model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, label: "DeepSeek V4 Pro" },
    { model: OPENROUTER_GEMINI_25_PRO_MODEL, label: "Gemini 2.5 Pro" },
    { model: "anthropic/claude-sonnet-4", label: "Claude (OpenRouter)" },
    { model: "google/gemini-2.5-flash", label: "Gemini Flash (native-style id)" },
  ];

  for (const row of tailMatrix) {
    const relExtract = memoryOn && isMainModelRelationshipSelfExtractModel(row.model);
    const firewall = buildPrimaryModelFlashFirewallBlock({
      statusWidgetActive: true,
      mainModelOwnsRelationshipExtract: relExtract,
    });
    const hasStatusWidget =
      firewall.includes("<<<STATUS_VALUES") ||
      firewall.includes("[STATUS WIDGET]");
    const hasRelBlock = firewall.includes("RELATIONSHIP MEMORY — SELF-EXTRACT");
    push(
      `  ${row.label}: relSelfExtract=${relExtract} · STATUS_WIDGET in firewall=${hasStatusWidget} · RELATIONSHIP block=${hasRelBlock} · DUAL_TAIL=${hasStatusWidget && hasRelBlock}`
    );
  }
  push(`  (STATUS_VALUES append rules also in status-widget-fields + terminal override)`);
  push(`  RELATIONSHIP block text prefix: ${RELATIONSHIP_MEMORY_SELF_EXTRACT_BLOCK.slice(0, 60)}…`);

  // ── 4. RP SPEED counts in final system ──
  push("", "## 4. RP SPEED / immediate output in final system prompt");

  // Minimal buildContext for DeepSeek with real chat
  const { chunks } = loadCharacterChunksForPrompt(
    {
      id: Number(chatRow.character_id),
      name: String(chatRow.name ?? "char"),
      gender: chatRow.gender as string | null,
      system_prompt: String(chatRow.system_prompt ?? ""),
      world: String(chatRow.world ?? ""),
      example_dialog: String(chatRow.example_dialog ?? ""),
      setting_chunks: String(chatRow.setting_chunks ?? "[]"),
      setting_chunks_en: String(chatRow.setting_chunks_en ?? ""),
      prompt_translation_hash: String(chatRow.prompt_translation_hash ?? ""),
      speech_profile: String(chatRow.speech_profile ?? ""),
    },
    "user",
    "user"
  );
  const { buildStatusWidgetPromptBlock } = await import("../src/lib/statusWidget/prompt");
  const { resolveStatusWidgetTurn } = await import("../src/lib/statusWidget/resolve");

  const statusResolved = resolveStatusWidgetTurn({
    characterWidgetJson: String(chatRow.status_widget_json ?? ""),
    userWidgetJson: String(chatRow.user_status_widget_json ?? ""),
    chatMode: String(chatRow.status_widget_mode ?? "off"),
    stackOrder: String(chatRow.status_widget_stack_order ?? ""),
    characterAllowUserOverride: Boolean(chatRow.status_widget_allow_user_override),
  });
  const statusWidgetPromptBlock = buildStatusWidgetPromptBlock(statusResolved);

  const lastUser =
    allRows.filter((r) => r.role === "user").at(-1)?.content ?? "…";

  for (const m of models) {
    const built = buildContext({
      charName: String(chatRow.name ?? "char"),
      chunks,
      userNickname: "user",
      shortTermHistory: rawRecentTurnsToHistory(
        turns,
        summarizedTurnCount,
        resolveRawRecentTurnWindowForHistory(m.id, "openrouter", completedTurns)
      ),
      currentUserMessage: lastUser,
      nsfw: Boolean(chatRow.nsfw),
      gender: (chatRow.gender as "male" | "female" | "other") ?? "other",
      modelId: m.id,
      provider: "openrouter",
      targetResponseChars: Number(chatRow.target_response_chars ?? 3300),
      completedTurns,
      statusWidgetActive: statusResolved.active,
      statusWidgetPromptBlock,
      mainModelOwnsRelationshipExtract:
        memoryOn && isMainModelRelationshipSelfExtractModel(m.id),
    });

    const sys = built.systemPrompt;
    const counts = summarizeRpSpeed(sys);
    push(`  ${m.label}: RP_SPEED block×${counts.rpSpeedBlock}, immediate×${counts.immediateOutput}, firstVisible×${counts.firstVisibleToken}`);
    push(`    full system tokens≈${built.meta.estimatedSystemTokens}`);
  }

  // ── 5. API payload structure (DeepSeek, live chat) ──
  push("", "## 5. OpenRouter API message order (DeepSeek, chat_id=" + chatId + ")");

  const builtDs = buildContext({
    charName: String(chatRow.name ?? "char"),
    chunks,
    userNickname: "user",
    shortTermHistory: rawRecentTurnsToHistory(
      turns,
      summarizedTurnCount,
      resolveRawRecentTurnWindowForHistory(
        OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        "openrouter",
        completedTurns
      )
    ),
    currentUserMessage: lastUser,
    nsfw: Boolean(chatRow.nsfw),
    gender: (chatRow.gender as "male" | "female" | "other") ?? "other",
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    provider: "openrouter",
    targetResponseChars: Number(chatRow.target_response_chars ?? 3300),
    completedTurns,
    statusWidgetActive: statusResolved.active,
    statusWidgetPromptBlock,
    mainModelOwnsRelationshipExtract:
      memoryOn && isMainModelRelationshipSelfExtractModel(OPENROUTER_DEEPSEEK_V4_PRO_MODEL),
  });

  const historyForApi = builtDs.history.slice(0, -1);
  const lastUserMsg = builtDs.history.at(-1)!;

  const messages = buildOpenRouterMessages(builtDs.systemPrompt, builtDs.history, {
    systemSplit: builtDs.openRouterSystemSplit,
  });

  const payloadOut: string[] = [];
  payloadOut.push("OPENROUTER MESSAGES ARRAY");
  payloadOut.push(`messageCount: ${messages.length}`);
  payloadOut.push("");

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    payloadOut.push(`--- [${i}] role=${msg.role} ---`);
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        payloadOut.push(`(single system string, ${msg.content.length} chars)`);
        payloadOut.push(msg.content.slice(0, 2000));
        if (msg.content.length > 2000) payloadOut.push(`… [truncated, total ${msg.content.length} chars]`);
      } else {
        for (let b = 0; b < msg.content.length; b++) {
          const block = msg.content[b];
          const cached = block.cache_control?.type === "ephemeral" ? "CACHED" : "dynamic";
          payloadOut.push(`  system block ${b + 1} [${cached}] ${block.text.length} chars`);
          if (b === msg.content.length - 1) {
            payloadOut.push(block.text.slice(-3500));
          } else if (b === 0) {
            payloadOut.push(block.text.slice(0, 1500));
            if (block.text.length > 1500) payloadOut.push("…");
          }
        }
      }
    } else {
      const c = msg.content;
      const disp =
        msg.role === "assistant" ? visibleAssistantDisplayCharCount(c) : c.length;
      payloadOut.push(`chars: raw=${c.length} display=${disp}`);
      payloadOut.push(c.length > 1200 ? c.slice(0, 1200) + "\n… [truncated]" : c);
    }
    payloadOut.push("");
  }

  push(`  messages[0]: system (${typeof messages[0].content === "string" ? "string" : messages[0].content.length + " blocks"})`);
  push(`  messages[1..${messages.length - 2}]: history (${messages.length - 2} msgs)`);
  push(`  messages[${messages.length - 1}]: last user`);
  push(`  built.history length (with current user): ${builtDs.history.length}`);
  push(`  history excluding last user: ${historyForApi.length} messages`);

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "investigate-history-payload.txt"), lines.join("\n"), "utf8");
  fs.writeFileSync(path.join(outDir, "investigate-api-payload-deepseek.txt"), payloadOut.join("\n"), "utf8");
  console.log("Wrote output/investigate-history-payload.txt");
  console.log("Wrote output/investigate-api-payload-deepseek.txt");
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
