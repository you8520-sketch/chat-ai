/**
 * Experiment 14: Memory block cache position A/B
 *
 * A) Current: memory in dynamicBlock (uncached, changes every turn with dynamic tail)
 * B) Proposed: memory in characterSettingsBlock (cached), stable within 6-turn batch
 *
 * 3 consecutive turns × 4 production models × 2 arms — same chat fixture, stable memory text.
 *
 * Measures: cache_read/write, output_chars, raw API cost (KRW).
 *
 * Usage:
 *   npx.cmd tsx scripts/experiment14-memory-cache-position-ab.ts
 *   npx.cmd tsx scripts/experiment14-memory-cache-position-ab.ts --chat-id=38 --dry-run
 *   npx.cmd tsx scripts/experiment14-memory-cache-position-ab.ts --models=deepseek,opus
 */

import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

const origLoad = Module._load;
// @ts-expect-error server-only stub
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";
delete process.env.DEEPSEEK_CONTINUATION_MANDATE;

import type { OpenRouterSystemSplit } from "../src/lib/openRouterCache";
import type { TrackedPromptSection } from "../src/services/promptAudit";
import {
  OPENROUTER_CLAUDE_DEFAULT,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "../src/lib/chatModels";

const DELAY_MS = 4500;
const TURNS = 3;
const MEMORY_SECTION_IDS = new Set(["archive-memory", "current-memory", "relationship-meta"]);

type Arm = "A_dynamic" | "B_cached_character";

type Sample = {
  arm: Arm;
  modelId: string;
  modelLabel: string;
  turn: number;
  completedTurns: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  standardInputTokens: number;
  promptTokens: number;
  completionTokens: number;
  outputChars: number;
  displayProseChars: number;
  rawCostKrw: number;
  upstreamCostUsd?: number;
  cacheDiscountUsd?: number;
  charSettingsTokensEst: number;
  dynamicTokensEst: number;
  memoryTokensEst: number;
  finishReason: string;
  sessionId: string;
};

const MODEL_MAP: Record<string, { id: string; label: string }> = {
  opus: { id: OPENROUTER_CLAUDE_DEFAULT, label: "Claude Opus 4.5" },
  qwen: { id: OPENROUTER_QWEN_37_MAX_MODEL, label: "Qwen 3.7 Max" },
  gemini: { id: OPENROUTER_GEMINI_31_PRO_MODEL, label: "Gemini 3.1 Pro" },
  deepseek: { id: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, label: "DeepSeek V4 Pro" },
};

function parseArgs() {
  const chatArg = process.argv.find((a) => a.startsWith("--chat-id="));
  const modelsArg = process.argv.find((a) => a.startsWith("--models="));
  const dryRun = process.argv.includes("--dry-run");
  return {
    chatId: chatArg ? Number(chatArg.split("=")[1]) : 38,
    models: modelsArg
      ? modelsArg
          .split("=")[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : Object.keys(MODEL_MAP),
    dryRun,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProse(text: string): string {
  const i = (text || "").search(/<<<STATUS/i);
  return (i >= 0 ? text.slice(0, i) : text).trim();
}

/** Move memory sections from dynamic → start of characterSettings (cached region). */
function relocateMemoryToCharacterCache(
  split: OpenRouterSystemSplit,
  sections: TrackedPromptSection[]
): OpenRouterSystemSplit {
  const memorySections = sections.filter(
    (s) => MEMORY_SECTION_IDS.has(s.id) || s.category === "memory"
  );
  const memoryParts = memorySections.map((s) => s.text.trim()).filter(Boolean);
  if (memoryParts.length === 0) return split;

  let dynamic = split.dynamicBlock;
  for (const part of memoryParts) {
    const idx = dynamic.indexOf(part);
    if (idx >= 0) {
      dynamic = (dynamic.slice(0, idx) + dynamic.slice(idx + part.length))
        .replace(/\n\n\n+/g, "\n\n")
        .trim();
    }
  }

  const memoryBlock = memoryParts.join("\n\n");
  const characterSettingsBlock = [memoryBlock, split.characterSettingsBlock.trim()]
    .filter(Boolean)
    .join("\n\n");

  return {
    systemRulesBlock: split.systemRulesBlock,
    characterSettingsBlock,
    dynamicBlock: dynamic,
  };
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
  const userNotePrompt = formatUserNoteForPrompt(String(chat.user_note ?? user.user_note ?? "").trim());

  const msgRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chatId) as { role: "user" | "assistant"; content: string; model?: string | null }[];
  const completedTurns = messagesToTurns(msgRows);
  const recentHistory = recentTurnsToHistory(completedTurns, completedTurns.length);

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
    .prepare("SELECT recent_summary, archive_summary FROM chat_memories WHERE chat_id=?")
    .get(chatId) as { recent_summary?: string; archive_summary?: string } | undefined;
  const longTermMemory = String(memRow?.recent_summary ?? chat.current_summary ?? chat.memory ?? "").trim();
  const archiveMemory = String(memRow?.archive_summary ?? "").trim();
  const genres = sanitizeCharacterGenres(JSON.parse(String(ch.genres ?? "[]")));
  const assetTags = [...new Set(chatAssets(parseAssets(String(ch.assets ?? "[]"))).map((a) => a.tag))];
  const relationshipNames = resolveRelationshipMetaNames({
    displayName: String(ch.name),
    systemPrompt: String(ch.system_prompt ?? ""),
    chunks,
    userName: personaDisplayName,
  });

  const lastUser = [...recentHistory].reverse().find((m) => m.role === "user");
  const currentUserMessage = lastUser?.content ?? "자동진행";

  const memoryLayers = buildHierarchicalMemoryPromptLayers({
    chatId,
    characterChunks: chunks,
    userMessage: currentUserMessage,
    recentContext: recentHistory.slice(-6).map((m) => m.content).join("\n"),
    completedTurns: completedTurns.length,
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
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
    archiveMemory: archiveMemory || undefined,
    memoryMeta: formatMemoryMetaForPrompt(
      normalizeMemoryMeta(parseMemoryMeta(String(chat.memory_meta ?? "")), relationshipNames)
    ),
    shortTermHistoryBase: recentHistory.slice(0, -1),
    baseUserMessage: currentUserMessage,
    nsfw: String(chat.mode) === "nsfw" || Number(user.nsfw_on) === 1,
    gender: resolveCharacterGender(String(ch.gender)),
    assetTags: assetTags.length > 0 ? assetTags : undefined,
    baseCompletedTurns: completedTurns.length,
    userPersonaGender: (personaRow?.gender as import("../src/lib/characterGender").CharacterGender) ?? "other",
    genres,
    userImpersonation: Number(chat.user_impersonation) === 1,
    novelModeEnabled: Number(chat.novel_mode) === 1,
    targetResponseChars: Number(chat.target_response_chars ?? 2500),
    contextualLore: memoryLayers.contextualLore || undefined,
    statusWidgetActive: Number(chat.status_widget_active) === 1,
  };
}

function estimateMemoryTokens(sections: TrackedPromptSection[], estimateTokens: (s: string) => number): number {
  return sections
    .filter((s) => MEMORY_SECTION_IDS.has(s.id) || s.category === "memory")
    .reduce((sum, s) => sum + estimateTokens(s.text), 0);
}

async function main() {
  const { chatId, models, dryRun } = parseArgs();
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { parseOpenRouterUsage } = await import("../src/lib/openRouterUsage");
  const { openRouterRawCostKrw } = await import("../src/lib/billingRawCost");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const fx = await loadFixture(chatId);
  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "experiment14-memory-cache-position-ab.jsonl");
  const reportPath = path.join(outDir, "experiment14-memory-cache-position-ab-report.txt");

  const samples: Sample[] = [];
  const userMessages = ["자동진행", "자동진행", "자동진행"];

  console.log(`=== Experiment 14: Memory cache position A/B ===`);
  console.log(`chat=${chatId} baseCompletedTurns=${fx.baseCompletedTurns} dryRun=${dryRun}`);
  console.log(`memory chars=${fx.longTermMemory.length} archive=${(fx.archiveMemory ?? "").length}`);
  console.log(`models: ${models.join(", ")}\n`);

  for (const modelKey of models) {
    const model = MODEL_MAP[modelKey];
    if (!model) {
      console.warn(`Unknown model key: ${modelKey}`);
      continue;
    }

    for (const arm of ["A_dynamic", "B_cached_character"] as Arm[]) {
      const sessionId = `exp14-mem-cache-${modelKey}-${arm}-chat${chatId}`;
      const history: { role: "user" | "assistant"; content: string }[] = [...fx.shortTermHistoryBase];

      for (let turn = 1; turn <= TURNS; turn++) {
        const completedTurns = fx.baseCompletedTurns + turn - 1;
        const currentUserMessage = userMessages[turn - 1] ?? "자동진행";

        const built = buildContext({
          charName: fx.charName,
          chunks: fx.chunks,
          userNickname: fx.userNickname,
          userPersona: fx.userPersonaPrompt,
          userNote: fx.userNotePrompt,
          longTermMemory: fx.longTermMemory,
          archiveMemory: fx.archiveMemory,
          memoryMeta: fx.memoryMeta,
          shortTermHistory: history,
          currentUserMessage,
          nsfw: fx.nsfw,
          gender: fx.gender,
          assetTags: fx.assetTags,
          completedTurns,
          userPersonaGender: fx.userPersonaGender,
          genres: fx.genres,
          userImpersonation: fx.userImpersonation,
          novelModeEnabled: fx.novelModeEnabled,
          targetResponseChars: fx.targetResponseChars,
          modelId: model.id,
          provider: "openrouter",
          contextualLore: fx.contextualLore,
          personaDisplayName: fx.personaDisplayName,
          statusWidgetActive: fx.statusWidgetActive,
          mainModelOwnsRelationshipExtract: false,
        });

        const sections = built.meta.trackedSections ?? [];
        let split = built.openRouterSystemSplit!;
        if (arm === "B_cached_character") {
          split = relocateMemoryToCharacterCache(split, sections);
        }

        const memoryTokensEst = estimateMemoryTokens(sections, estimateTokens);
        const charSettingsTokensEst = estimateTokens(split.characterSettingsBlock);
        const dynamicTokensEst = estimateTokens(split.dynamicBlock);

        if (dryRun) {
          console.log(
            `[dry-run] ${model.label} ${arm} turn${turn} charTok=${charSettingsTokensEst} dynTok=${dynamicTokensEst} memTok=${memoryTokensEst}`
          );
          history.push({ role: "user", content: currentUserMessage });
          history.push({ role: "assistant", content: "[dry-run assistant stub]" });
          continue;
        }

        const result = await callOpenRouterAdult(
          built.systemPrompt,
          built.history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          model.id,
          fx.targetResponseChars,
          {
            charName: fx.charName,
            personaName: fx.personaDisplayName,
            systemSplit: split,
            sessionId,
          },
          {
            chargeTurnBudget: false,
            requestKind: `exp14-mem-${modelKey}-${arm}-t${turn}`,
          }
        );

        const parsed = parseOpenRouterUsage(result.usage.debugRawUsage);
        const prose = displayProse(result.text);
        const rawCostKrw = openRouterRawCostKrw({
          promptTokens: parsed.promptTokens,
          outputTokens: parsed.completionTokens,
          cacheReadTokens: parsed.cacheReadTokens,
          cacheWriteTokens: parsed.cacheWriteTokens,
          modelId: model.id,
          upstreamCostUsd: parsed.upstreamCostUsd,
        });

        const sample: Sample = {
          arm,
          modelId: model.id,
          modelLabel: model.label,
          turn,
          completedTurns,
          cacheReadTokens: parsed.cacheReadTokens,
          cacheWriteTokens: parsed.cacheWriteTokens,
          standardInputTokens: parsed.standardInputTokens,
          promptTokens: parsed.promptTokens,
          completionTokens: parsed.completionTokens,
          outputChars: result.text.length,
          displayProseChars: prose.length,
          rawCostKrw,
          upstreamCostUsd: parsed.upstreamCostUsd,
          cacheDiscountUsd: parsed.cacheDiscountUsd,
          charSettingsTokensEst,
          dynamicTokensEst,
          memoryTokensEst,
          finishReason: result.finishReason ?? "unknown",
          sessionId,
        };
        samples.push(sample);
        fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");

        console.log(
          `${model.label} ${arm} t${turn}: cacheR=${parsed.cacheReadTokens} cacheW=${parsed.cacheWriteTokens} out=${prose.length}c raw=${rawCostKrw.toFixed(1)}KRW`
        );

        history.push({ role: "user", content: currentUserMessage });
        history.push({ role: "assistant", content: result.text.slice(0, 600) });

        if (turn < TURNS || arm === "A_dynamic" || modelKey !== models[models.length - 1]) {
          await sleep(DELAY_MS);
        }
      }
    }
  }

  if (dryRun) {
    console.log("\nDry run complete — no API calls.");
    return;
  }

  const report = buildReport(samples, chatId, fx);
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(`\nWrote ${jsonlPath}`);
  console.log(`Wrote ${reportPath}`);
  console.log("\n" + report);
}

function buildReport(samples: Sample[], chatId: number, fx: { longTermMemory: string; baseCompletedTurns: number }): string {
  const lines: string[] = [
    "Experiment 14: Memory cache position A/B",
    `generated: ${new Date().toISOString()}`,
    `chat=${chatId} baseCompletedTurns=${fx.baseCompletedTurns} memoryChars=${fx.longTermMemory.length}`,
    "",
    "Arm A = production (memory in dynamicBlock)",
    "Arm B = proposed (memory at start of characterSettingsBlock, cached)",
    "3 consecutive turns, stable memory text (within 6-turn batch)",
    "",
  ];

  const modelLabels = [...new Set(samples.map((s) => s.modelLabel))];

  for (const label of modelLabels) {
    const modelSamples = samples.filter((s) => s.modelLabel === label);
    lines.push(`── ${label} ──`);

    for (const arm of ["A_dynamic", "B_cached_character"] as Arm[]) {
      const armSamples = modelSamples.filter((s) => s.arm === arm).sort((a, b) => a.turn - b.turn);
      if (armSamples.length === 0) continue;

      lines.push(`  ${arm}:`);
      for (const s of armSamples) {
        lines.push(
          `    turn${s.turn}: cacheRead=${s.cacheReadTokens} cacheWrite=${s.cacheWriteTokens} stdIn=${s.standardInputTokens} out=${s.displayProseChars}c rawCost=${s.rawCostKrw.toFixed(1)}KRW upstreamUsd=${s.upstreamCostUsd?.toFixed(5) ?? "n/a"}`
        );
      }

      const t2 = armSamples.find((s) => s.turn === 2);
      const t3 = armSamples.find((s) => s.turn === 3);
      const t1 = armSamples.find((s) => s.turn === 1);
      if (t1 && t2) {
        const stableHit = t2.cacheReadTokens + (t3?.cacheReadTokens ?? 0);
        const t1Hit = t1.cacheReadTokens;
        lines.push(
          `    cache_read stable (t2+t3)=${stableHit} vs t1=${t1Hit} ratio=${t1Hit > 0 ? (stableHit / t1Hit).toFixed(2) : "n/a"}`
        );
      }
      const avgCost =
        armSamples.reduce((sum, s) => sum + s.rawCostKrw, 0) / Math.max(1, armSamples.length);
      const avgOut =
        armSamples.reduce((sum, s) => sum + s.displayProseChars, 0) / Math.max(1, armSamples.length);
      lines.push(`    avg rawCost=${avgCost.toFixed(1)}KRW avg displayProse=${Math.round(avgOut)}c`);
    }

    const a = modelSamples.filter((s) => s.arm === "A_dynamic");
    const b = modelSamples.filter((s) => s.arm === "B_cached_character");
    const aStable = a.filter((s) => s.turn >= 2).reduce((sum, s) => sum + s.cacheReadTokens, 0);
    const bStable = b.filter((s) => s.turn >= 2).reduce((sum, s) => sum + s.cacheReadTokens, 0);
    const aAvgCost = a.reduce((sum, s) => sum + s.rawCostKrw, 0) / Math.max(1, a.length);
    const bAvgCost = b.reduce((sum, s) => sum + s.rawCostKrw, 0) / Math.max(1, b.length);
    const aAvgOut = a.reduce((sum, s) => sum + s.displayProseChars, 0) / Math.max(1, a.length);
    const bAvgOut = b.reduce((sum, s) => sum + s.displayProseChars, 0) / Math.max(1, b.length);

    lines.push(`  Δ B vs A:`);
    lines.push(`    cacheRead turns2-3: B=${bStable} A=${aStable} delta=${bStable - aStable}`);
    lines.push(
      `    avg rawCost: B=${bAvgCost.toFixed(1)} A=${aAvgCost.toFixed(1)} savings=${(aAvgCost - bAvgCost).toFixed(1)}KRW/turn`
    );
    lines.push(
      `    avg output chars: B=${Math.round(bAvgOut)} A=${Math.round(aAvgOut)} ratio=${aAvgOut > 0 ? (bAvgOut / aAvgOut).toFixed(2) : "n/a"}`
    );
    lines.push("");
  }

  lines.push("── Cross-model verdict ──");
  let cacheWinners = 0;
  let costWinners = 0;
  let lengthNeutral = 0;
  for (const label of modelLabels) {
    const a = samples.filter((s) => s.modelLabel === label && s.arm === "A_dynamic");
    const b = samples.filter((s) => s.modelLabel === label && s.arm === "B_cached_character");
    const aStable = a.filter((s) => s.turn >= 2).reduce((sum, s) => sum + s.cacheReadTokens, 0);
    const bStable = b.filter((s) => s.turn >= 2).reduce((sum, s) => sum + s.cacheReadTokens, 0);
    const aAvgCost = a.reduce((sum, s) => sum + s.rawCostKrw, 0) / Math.max(1, a.length);
    const bAvgCost = b.reduce((sum, s) => sum + s.rawCostKrw, 0) / Math.max(1, b.length);
    const aAvgOut = a.reduce((sum, s) => sum + s.displayProseChars, 0) / Math.max(1, a.length);
    const bAvgOut = b.reduce((sum, s) => sum + s.displayProseChars, 0) / Math.max(1, b.length);
    const cacheBetter = bStable > aStable;
    const costBetter = bAvgCost < aAvgCost;
    const lengthOk = Math.abs(bAvgOut - aAvgOut) / Math.max(1, aAvgOut) < 0.25;
    if (cacheBetter) cacheWinners++;
    if (costBetter) costWinners++;
    if (lengthOk) lengthNeutral++;
    lines.push(
      `  ${label}: cache B${cacheBetter ? ">" : "≤"}A | cost B${costBetter ? "<" : "≥"}A | length ${lengthOk ? "neutral" : "SWING"} (${Math.round(aAvgOut)}→${Math.round(bAvgOut)})`
    );
  }

  const universal =
    cacheWinners === modelLabels.length &&
    costWinners === modelLabels.length &&
    lengthNeutral === modelLabels.length;
  lines.push("");
  lines.push(
    universal
      ? "RECOMMENDATION: Universal structure OK — B wins cache+cost on all models, length stable."
      : "RECOMMENDATION: Per-model assembly likely needed — not all models benefit uniformly."
  );
  lines.push(
    `(cache wins ${cacheWinners}/${modelLabels.length}, cost wins ${costWinners}/${modelLabels.length}, length neutral ${lengthNeutral}/${modelLabels.length})`
  );

  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
