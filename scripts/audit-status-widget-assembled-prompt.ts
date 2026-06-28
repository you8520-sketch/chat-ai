/**
 * Status Widget blocks in assembled prompt (widget-active turns) — actual buildContext path.
 * Usage: npx tsx scripts/audit-status-widget-assembled-prompt.ts
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { loadEnvLocal } from "./load-env-local";

const require = createRequire(import.meta.url);

function mockServerModules(): void {
  const serverOnlyPath = require.resolve("server-only");
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {},
  } as NodeModule;

  const dbPath = require.resolve("../src/lib/db");
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      getDb: () => ({}),
    },
  } as NodeModule;
}

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const WIDGET_SECTION_IDS = new Set([
  "status-widget-fields",
  "status-widget-append-instruction",
  "openrouter-flash-owned-firewall",
]);

function buildPreDedupeFirewallText(): string {
  return `[STATUS WIDGET — CREATOR (SERVER RENDERS HTML)]
You fill JSON values in <<<STATUS_VALUES>>> after RP prose. Flash/server render the widget UI.

[FLASH-OWNED — PRIMARY MODEL MUST NOT DO THESE]
Creator status widget is ON. Gemini Flash handles user-note HTML/plain status when needed.

FORBIDDEN in RP prose:
- Inline status lines, pipe tables, \`\`\`html, \`\`\`json fences, bare trailing { ... } objects in prose

Status values: see [STATUS WIDGET] field spec above.`;
}

function buildPreDedupeAppendText(): string {
  return `[STATUS WIDGET — append after RP prose]
Append the <<<STATUS_VALUES>>> block at the end. Values only — no status HTML in prose.`;
}

type BlockRow = {
  id: string;
  label: string;
  chars: number;
  tokens: number;
  source: string;
};

function measureBlock(
  text: string,
  id: string,
  label: string,
  source: string,
  estimateTokens: (t: string) => number
): BlockRow {
  return {
    id,
    label,
    chars: text.length,
    tokens: estimateTokens(text),
    source,
  };
}

function extractWidgetBlocks(
  trackedSections: Array<{ id: string; label: string; text: string }>,
  estimateTokens: (t: string) => number
): BlockRow[] {
  const rows: BlockRow[] = [];

  for (const s of trackedSections) {
    if (!WIDGET_SECTION_IDS.has(s.id)) continue;
    rows.push(
      measureBlock(s.text, s.id, s.label, "contextBuilder trackedSections", estimateTokens)
    );
  }

  return rows;
}

function simulatePreDedupeAssembledText(
  turn: {
    systemPrompt: string;
    history: Array<{ role: string; content: string }>;
    blocks: BlockRow[];
  },
  isDeepSeek: boolean,
  estimateTokens: (t: string) => number,
  DEEPSEEK_STATUS_WIDGET_BOTTOM_REMINDER: string
): { text: string; tokens: number; removedSlices: BlockRow[] } {
  const firewall = turn.blocks.find((b) => b.id === "openrouter-flash-owned-firewall");
  let system = turn.systemPrompt;
  if (firewall) {
    const flashIdx = system.indexOf("[FLASH-OWNED — PRIMARY MODEL MUST NOT DO THESE]");
    if (flashIdx >= 0) {
      const nextSection = system.indexOf("\n\n[", flashIdx + 1);
      const end = nextSection > flashIdx ? nextSection : system.length;
      system =
        system.slice(0, flashIdx) + buildPreDedupeFirewallText() + system.slice(end);
    }
  }

  const appendIdx = system.indexOf("[STATUS WIDGET — values only");
  if (appendIdx >= 0) {
    system =
      system.slice(0, appendIdx) +
      buildPreDedupeAppendText() +
      "\n\n" +
      system.slice(appendIdx);
  } else {
    system = system + "\n\n" + buildPreDedupeAppendText();
  }

  const history = turn.history.map((m) => ({ ...m }));
  if (isDeepSeek && history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === "user") {
      last.content = `${last.content}\n\n${DEEPSEEK_STATUS_WIDGET_BOTTOM_REMINDER}`;
    }
  }

  const removedSlices: BlockRow[] = [
    measureBlock(
      buildPreDedupeAppendText(),
      "status-widget-append-instruction",
      "Status widget append (removed post-dedupe)",
      "buildStatusWidgetAppendInstruction",
      estimateTokens
    ),
    measureBlock(
      buildPreDedupeFirewallText(),
      "openrouter-flash-owned-firewall-pre",
      "Flash firewall (pre-dedupe full)",
      "buildPrimaryModelFlashFirewallBlock pre-dedupe",
      estimateTokens
    ),
  ];
  if (isDeepSeek) {
    removedSlices.push(
      measureBlock(
        DEEPSEEK_STATUS_WIDGET_BOTTOM_REMINDER,
        "deepseek-user-tail-reminder",
        "DeepSeek user-turn bottom reminder (removed post-dedupe)",
        "DEEPSEEK_STATUS_WIDGET_BOTTOM_REMINDER",
        estimateTokens
      )
    );
  }

  const text = `${system}\n${history.map((m) => m.content).join("\n")}`;
  return { text, tokens: estimateTokens(text), removedSlices };
}

function sumBlocks(rows: BlockRow[]): { chars: number; tokens: number } {
  return {
    chars: rows.reduce((a, r) => a + r.chars, 0),
    tokens: rows.reduce((a, r) => a + r.tokens, 0),
  };
}

async function main() {
  mockServerModules();

  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { buildContext } = await import("../src/services/contextBuilder");
  const {
    OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    OPENROUTER_GEMINI_25_PRO_MODEL,
    OPENROUTER_QWEN_37_MAX_MODEL,
  } = await import("../src/lib/chatModels");
  const { buildStatusWidgetPromptBlock, resolveStatusWidgetTurn } = await import(
    "../src/lib/statusWidget"
  );
  const { DEFAULT_STATUS_WIDGET } = await import("../src/lib/statusWidget/defaultTemplate");
  const {
    applyStatusWidgetSystemPromptOverrides,
    patchOpenRouterSplitForStatusWidget,
  } = await import("../src/lib/statusWidget/promptOverrides");
  const { DEEPSEEK_STATUS_WIDGET_BOTTOM_REMINDER } = await import(
    "../src/lib/statusWidget/deepseekCapture"
  );
  const { buildPrimaryModelFlashFirewallBlock } = await import(
    "../src/lib/flashOwnedOutputFirewall"
  );
  const { compareWidgetActiveDedupe } = await import(
    "../src/lib/statusWidget/promptDedupeMetrics"
  );
  const { openRouterUsdCostFromRates } = await import("../src/lib/openRouterModelPricing");
  const { convertUsdToKrw, resolveBillingExchangeRateSnapshot } = await import(
    "../src/lib/exchangeRate"
  );
  const {
    explainOpenRouterDeepSeekTurnCost,
    explainOpenRouterGemini25TurnCost,
    explainOpenRouterQwenTurnCost,
  } = await import("../src/lib/points");

  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const personaDisplayName = "렌";

  const chunks = parseCharacterSetting({
    characterId: "mock-widget-audit",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.\n\n# 말투\n- 평소: "~요", "~죠" 등 정중한 존댓말`,
    world: `# 세계관\n현대 도시. 밤 산책과 실종 사건의 잔상.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  const fixture = {
    charName,
    userNickname: personaDisplayName,
    personaDisplayName,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(
      personaDisplayName,
      "other",
      "20대 대학원생. 백하율과 오래 알고 지낸 사이."
    ),
    userNotePrompt: formatUserNoteForPrompt("[고집중]\n렌은 백하율을 친구처럼 대한다."),
    longTermMemory: "[장기 기억]\n- 3년 전 실종 사건 이후 서로를 더 자주 확인한다.",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 72, trust: 65 }))
    ),
    shortTermHistory: [
      { role: "user" as const, content: "오늘도 밤산책 갈래?" },
      {
        role: "assistant" as const,
        content: `${charName}은 조용히 고개를 끄덕였다.\n"…같이 가시죠."`,
      },
    ],
    currentUserMessage: "…방금 소리, 들었어?",
    nsfw: true,
    gender: "male" as const,
    assetTags: ["neutral"] as string[],
    completedTurns: 9,
    userPersonaGender: "other" as const,
    genres: ["현대/일상"] as import("../src/lib/characterGenres").CharacterGenre[],
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
  };

  function assembleWidgetActiveTurn(modelId: string) {
    const statusWidgetTurn = resolveStatusWidgetTurn({
      characterWidgetJson: JSON.stringify(DEFAULT_STATUS_WIDGET),
      chatMode: "character_only",
    });
    const statusWidgetPromptBlock = buildStatusWidgetPromptBlock(statusWidgetTurn);

    const built = buildContext({
      charName: fixture.charName,
      chunks: fixture.chunks,
      userNickname: fixture.userNickname,
      userPersona: fixture.userPersonaPrompt,
      userNote: fixture.userNotePrompt,
      longTermMemory: fixture.longTermMemory,
      memoryMeta: fixture.memoryMeta,
      shortTermHistory: fixture.shortTermHistory,
      currentUserMessage: fixture.currentUserMessage,
      nsfw: fixture.nsfw,
      gender: fixture.gender,
      assetTags: fixture.assetTags,
      completedTurns: fixture.completedTurns,
      modelId,
      provider: "openrouter",
      targetResponseChars: fixture.targetResponseChars,
      userPersonaGender: fixture.userPersonaGender,
      genres: fixture.genres,
      userImpersonation: fixture.userImpersonation,
      novelModeEnabled: fixture.novelModeEnabled,
      personaDisplayName: fixture.personaDisplayName,
      statusWidgetActive: true,
      statusWidgetPromptBlock,
      mainModelOwnsHtmlVisualCard: false,
      promptDumpSource: "audit",
      promptDumpDetail: `status-widget-assembled ${modelId}`,
    });

    let systemPrompt = built.systemPrompt;
    let openRouterSystemSplit = built.openRouterSystemSplit;
    systemPrompt = applyStatusWidgetSystemPromptOverrides(systemPrompt);
    if (openRouterSystemSplit) {
      openRouterSystemSplit = patchOpenRouterSplitForStatusWidget(openRouterSystemSplit);
    }

    const history = built.history;
    const lastUser = history[history.length - 1]?.content ?? "";
    const assembledText = `${systemPrompt}\n${history.map((m) => m.content).join("\n")}`;
    const inputTokens = estimateTokens(assembledText);

    const blocks = extractWidgetBlocks(built.meta.trackedSections ?? [], estimateTokens);

    return {
      modelId,
      systemPrompt,
      history,
      lastUser,
      assembledText,
      inputTokens,
      blocks,
      widgetBlockOnly: statusWidgetPromptBlock,
      firewallOnly: buildPrimaryModelFlashFirewallBlock({ statusWidgetActive: true }),
    };
  }

  function apiInputCostKrw(savedInputTokens: number, modelId: string): number {
    const rates = openRouterUsdCostFromRates({
      promptTokens: savedInputTokens,
      outputTokens: 0,
      modelId,
    });
    const krw = resolveBillingExchangeRateSnapshot().effectiveKrwPerUsd;
    return convertUsdToKrw(rates.usdCost, krw);
  }

  function userTurnPoints(modelId: string, inputTokens: number, outputTokens: number): number {
    const out = 3000;
    if (modelId === OPENROUTER_DEEPSEEK_V4_PRO_MODEL) {
      return explainOpenRouterDeepSeekTurnCost(inputTokens, out, modelId).total;
    }
    if (modelId === OPENROUTER_QWEN_37_MAX_MODEL) {
      return explainOpenRouterQwenTurnCost(inputTokens, out, modelId).total;
    }
    return explainOpenRouterGemini25TurnCost(inputTokens, out, modelId).total;
  }

  const models = [
    { id: OPENROUTER_GEMINI_25_PRO_MODEL, label: "Gemini 2.5 Pro" },
    { id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, label: "DeepSeek V4 Pro" },
    { id: OPENROUTER_QWEN_37_MAX_MODEL, label: "Qwen 3.7 Max" },
  ];

  const dedupeReport = compareWidgetActiveDedupe();
  const report: Record<string, unknown> = {
    dedupeFootprint: dedupeReport,
    models: {} as Record<string, unknown>,
  };

  console.log("=== Status Widget — Assembled Prompt Audit (widget-active) ===\n");

  for (const { id, label } of models) {
    const turn = assembleWidgetActiveTurn(id);
    const isDeepSeek = id === OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
    const currentSum = sumBlocks(turn.blocks);
    const preSim = simulatePreDedupeAssembledText(
      turn,
      isDeepSeek,
      estimateTokens,
      DEEPSEEK_STATUS_WIDGET_BOTTOM_REMINDER
    );

    const savedTokens = preSim.tokens - turn.inputTokens;
    const dedupeFootprint = compareWidgetActiveDedupe();
    const savedChars = dedupeFootprint.savedTotalCharsPerTurn;

    const inputTokensBefore = preSim.tokens;
    const apiSaveKrw = apiInputCostKrw(savedTokens, id);
    const pointsBefore = userTurnPoints(id, inputTokensBefore, 3000);
    const pointsAfter = userTurnPoints(id, turn.inputTokens, 3000);

    const rawBefore =
      id === OPENROUTER_DEEPSEEK_V4_PRO_MODEL
        ? explainOpenRouterDeepSeekTurnCost(inputTokensBefore, 3000, id).rawCostKrw
        : id === OPENROUTER_QWEN_37_MAX_MODEL
          ? explainOpenRouterQwenTurnCost(inputTokensBefore, 3000, id).rawCostKrw
          : explainOpenRouterGemini25TurnCost(inputTokensBefore, 3000, id).rawCostKrw;
    const rawAfter =
      id === OPENROUTER_DEEPSEEK_V4_PRO_MODEL
        ? explainOpenRouterDeepSeekTurnCost(turn.inputTokens, 3000, id).rawCostKrw
        : id === OPENROUTER_QWEN_37_MAX_MODEL
          ? explainOpenRouterQwenTurnCost(turn.inputTokens, 3000, id).rawCostKrw
          : explainOpenRouterGemini25TurnCost(turn.inputTokens, 3000, id).rawCostKrw;

    const modelReport = {
      label,
      modelId: id,
      assembledInputTokens: turn.inputTokens,
      assembledInputTokensPreDedupe: inputTokensBefore,
      widgetBlocksCurrent: turn.blocks,
      widgetBlocksCurrentTotals: currentSum,
      dedupeRemovedSlices: preSim.removedSlices,
      dedupeSavedChars: savedChars,
      dedupeSavedTokensAssembled: savedTokens,
      dedupeSavedPctOfPreAssembledInput:
        inputTokensBefore > 0 ? savedTokens / inputTokensBefore : 0,
      apiRawInputCostSaveKrwPerTurn: Math.round(apiSaveKrw * 100) / 100,
      apiRawTurnCostSaveKrwPerTurn3000Out: Math.round((rawBefore - rawAfter) * 100) / 100,
      userPointsBeforeAssumed3000Out: pointsBefore,
      userPointsAfterAssumed3000Out: pointsAfter,
      userPointsSavedPerTurn: pointsAfter - pointsBefore,
      note:
        "User P is output-token floor for these models — input dedupe saves API cost, not user P (typical).",
    };

    (report.models as Record<string, unknown>)[id] = modelReport;

    console.log(`--- ${label} (${id}) ---`);
    console.log(
      `Assembled input tokens: ${turn.inputTokens} (pre-dedupe sim: ${inputTokensBefore})`
    );
    console.log("\nCurrent widget-related blocks (trackedSections):");
    for (const b of turn.blocks) {
      console.log(`  [${b.id}] ${b.chars} chars · ${b.tokens} tokens — ${b.label}`);
    }
    console.log(
      `  TOTAL widget-related: ${currentSum.chars} chars · ${currentSum.tokens} tokens`
    );
    console.log("\nRemoved post-dedupe slices:");
    for (const b of preSim.removedSlices) {
      console.log(`  [${b.id}] ${b.chars} chars · ${b.tokens} tokens — ${b.label}`);
    }
    console.log(
      `\nDedupe savings (assembled prompt): ${savedChars} chars footprint · ${savedTokens} tokens (${(
        (savedTokens / inputTokensBefore) *
        100
      ).toFixed(2)}% of pre input)`
    );
    console.log(`API raw input save/turn: ~${apiSaveKrw.toFixed(2)} KRW`);
    console.log(
      `API raw turn save/turn (3000 out): ~${(rawBefore - rawAfter).toFixed(2)} KRW`
    );
    console.log(
      `User points/turn (3000 out): ${pointsBefore}P → ${pointsAfter}P (Δ ${pointsAfter - pointsBefore}P)\n`
    );
  }

  const outPath = path.join(process.cwd(), "tmp", "status-widget-assembled-audit.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`Full JSON: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
