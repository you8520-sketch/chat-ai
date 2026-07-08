/**
 * Terminal length variant verify — Qwen 3.7 Max, same fixture, 1 call per arm.
 * 1 compact_tail_only — 맨 끝 1줄만
 * 2 handoff_compact — 현재 프로덕션
 * 3 recency_handoff_compact — 당시 C (3091자)
 *
 * Usage: npx.cmd tsx scripts/verify-terminal-length-variant.ts
 */
import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import { OPENROUTER_QWEN_37_MAX_MODEL } from "../src/lib/chatModels";
import {
  UNIFIED_TIER_MIN_CHARS,
  UNIFIED_TIER_AIM_CHARS,
} from "../src/lib/responseLengthConstants";

const origLoad = Module._load;
// @ts-expect-error legacy hook
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = OPENROUTER_QWEN_37_MAX_MODEL;
const TARGET = UNIFIED_TIER_AIM_CHARS;
const FLOOR = UNIFIED_TIER_MIN_CHARS;
const DEPTH = 6;
const USER_MESSAGE =
  "정말 고장났나봐.... 나랑 떨어져야되는거아니야?? 렌은 엘리베이터 안에서 숨을 고르며 백하율의 표정을 읽었다.";

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

function loadHistoryTemplates(): { user: string; assistant: string }[] {
  const db = new Database(getDatabasePath(), { readonly: true });
  const rows = db
    .prepare(
      `SELECT content FROM messages WHERE role='assistant' AND LENGTH(content)>2500 ORDER BY id DESC LIMIT 12`
    )
    .all() as { content: string }[];
  db.close();
  const templates: { user: string; assistant: string }[] = [];
  const userAlts = [
    "자동진행",
    "…여기 오래 갇혀 있었어?",
    "가이드님… 무서워.",
    "손 잡아줄래?",
    "이대로 계속 있어도 괜찮아?",
    "떨어지면 어떡해…",
  ];
  for (let i = 0; i < rows.length && templates.length < 8; i++) {
    let s = rows[i].content;
    const idx = s.search(/<<<STATUS/i);
    if (idx >= 0) s = s.slice(0, idx);
    const prose = s.trim();
    if (prose.length < 800) continue;
    templates.push({
      user: userAlts[templates.length % userAlts.length],
      assistant: prose.slice(0, Math.min(prose.length, 4500)),
    });
  }
  return templates;
}

function buildRecencyBlock(aim: number, min: number): string {
  return `[TERMINAL LENGTH AUTHORITY]
TARGET_LENGTH ${aim.toLocaleString()}+ · MINIMUM_FLOOR ${min.toLocaleString()}+ 미달 시 장면이 자연스럽게 끝났다고 판단하지 말 것.
분량이 충분히 전개되기 전 finish_reason=stop 형태의 조기 종료를 스스로 선택하지 말 것.
의미 없는 반복·패딩 없이 새로운 서사 진행(반응·행동·분위기·심리·상호작용)으로 분량을 채울 것.`;
}

async function buildFixture() {
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const templates = loadHistoryTemplates();
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < DEPTH / 2; i++) {
    const t = templates[i % templates.length];
    messages.push({ role: "user", content: t.user });
    messages.push({ role: "assistant", content: t.assistant });
  }
  const turns = messagesToTurns(
    [...messages, { role: "user", content: USER_MESSAGE }].map((m) => ({
      ...m,
      model: "assistant",
    }))
  );
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(MODEL, "openrouter", turns.length)
  );

  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "tlv",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });

  const built = buildContext({
    charName,
    chunks,
    userNickname: persona,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", persona),
    longTermMemory: "[요약] 엘리베이터에서 긴장된 분위기가 이어졌다.",
    shortTermHistory: historyRaw,
    currentUserMessage: USER_MESSAGE,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId: MODEL,
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: TARGET,
    completedTurns: DEPTH,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });

  return {
    charName,
    history: built.history.slice(0, -1).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    split: built.openRouterSystemSplit!,
    productionTerminal: built.meta.trackedSections?.find((s) => s.id === "rule-terminal-length-override")
      ?.text,
  };
}

function replaceTerminalBlock(dynamicBlock: string, terminalBlock: string): string {
  const markers = ["<TURN_HANDOFF_AND_PACING>", "TARGET_LENGTH "];
  let idx = -1;
  for (const m of markers) {
    const i = dynamicBlock.lastIndexOf(m);
    if (i > idx) idx = i;
  }
  if (idx < 0) return `${dynamicBlock.trimEnd()}\n\n${terminalBlock.trim()}`;
  const cut = dynamicBlock.lastIndexOf("\n\n", idx);
  const head = cut >= 0 ? dynamicBlock.slice(0, cut) : dynamicBlock.slice(0, idx);
  return `${head.trimEnd()}\n\n${terminalBlock.trim()}`;
}

function assembleSystem(
  split: { systemRulesBlock: string; characterSettingsBlock: string; dynamicBlock: string },
  terminalBlock: string
): string {
  const dynamic = replaceTerminalBlock(split.dynamicBlock, terminalBlock);
  return [split.systemRulesBlock, split.characterSettingsBlock, dynamic].filter(Boolean).join("\n\n");
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const {
    buildCompactTerminalLengthAbsoluteTail,
    buildTerminalLengthOverrideBlock,
  } = await import("../src/lib/responseLength");
  const { buildTurnHandoffAndPacingBlock } = await import("../src/lib/turnHandoffAndPacing");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const ctx = await buildFixture();
  const compact = buildCompactTerminalLengthAbsoluteTail(TARGET);
  const handoff = buildTurnHandoffAndPacingBlock();
  const recency = buildRecencyBlock(TARGET, FLOOR);

  const arms = [
    {
      id: "1_compact_only",
      label: "compact tail 1줄만 (맨 끝)",
      terminal: compact,
      promptExtraLines: 1,
    },
    {
      id: "2_handoff_compact",
      label: "handoff + compact (현재 프로덕션)",
      terminal: buildTerminalLengthOverrideBlock(TARGET),
      promptExtraLines: 4,
    },
    {
      id: "3_recency_handoff_compact",
      label: "recency + handoff + compact (당시 C)",
      terminal: `${recency}\n\n${handoff}\n\n${compact}`,
      promptExtraLines: 7,
    },
  ] as const;

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "verify-terminal-length-variant-report.txt");
  const jsonlPath = path.join(outDir, "verify-terminal-length-variant.jsonl");

  const lines: string[] = [
    `Terminal length variant verify — ${new Date().toISOString()}`,
    `MODEL=${MODEL} TARGET=${TARGET} FLOOR=${FLOOR}`,
    `production terminal now:\n${ctx.productionTerminal ?? "(none)"}`,
    "",
  ];
  fs.writeFileSync(jsonlPath, "", "utf8");

  const results: Array<{ id: string; chars: number; floor: boolean; aim: boolean }> = [];

  for (const arm of arms) {
    console.log(`\n=== ${arm.id}: ${arm.label} ===`);
    const system = assembleSystem(ctx.split, arm.terminal);
    console.log(`terminal tail:\n${arm.terminal}\n`);

    const result = await callOpenRouterAdult(
      system,
      [...ctx.history, { role: "user", content: USER_MESSAGE }],
      MODEL,
      TARGET,
      { charName: ctx.charName, systemSplit: ctx.split },
      { chargeTurnBudget: false, requestKind: "verify-terminal-length-variant" }
    );

    const prose = displayProse(result.text);
    const chars = visibleAssistantDisplayCharCount(prose);
    const row = {
      arm: arm.id,
      label: arm.label,
      prompt_extra_lines: arm.promptExtraLines,
      output_chars: chars,
      completion_tokens: result.usage.outputTokens,
      finish_reason: result.usage.finishReason ?? "",
      floor_pass: chars >= FLOOR,
      aim_pass: chars >= TARGET,
    };
    results.push({ id: arm.id, chars, floor: row.floor_pass, aim: row.aim_pass });
    fs.appendFileSync(jsonlPath, JSON.stringify(row) + "\n", "utf8");
    lines.push(
      `## ${arm.id}`,
      `- ${arm.label}`,
      `- prompt extra ~${arm.promptExtraLines} lines vs compact-only`,
      `- output_chars: ${chars}`,
      `- completion_tokens: ${result.usage.outputTokens}`,
      `- finish_reason: ${result.usage.finishReason ?? ""}`,
      `- FLOOR: ${row.floor_pass ? "PASS" : "FAIL"}`,
      `- TARGET: ${row.aim_pass ? "PASS" : "FAIL"}`,
      ""
    );
    console.log(row);
  }

  const ranked = [...results].sort((a, b) => b.chars - a.chars);
  lines.push("## RANKING (by output_chars)", ...ranked.map((r, i) => `${i + 1}. ${r.id}: ${r.chars} (floor=${r.floor} aim=${r.aim})`));
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`\nWrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
