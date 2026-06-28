/**
 * Experiment 1: ContextBuilder token & structure diff between "2026-06-14 era" and current
 *
 * We build the same logical turn twice:
 *   - "Old era" simulation: widget off or minimal, no extra continuation mandate, possibly older-style length reminder emphasis
 *   - Current: full widget instruction (if enabled), current scene completion + length budget
 *
 * We report:
 * - Token counts for major blocks (systemRules, characterSettings, dynamic)
 * - Rough breakdown inside dynamic: length rule, widget fields, other
 * - Order / position of key blocks
 * - Total system tokens
 *
 * This shows whether the *assembly* (what is injected, in what order, how much) changed significantly.
 *
 * Usage:
 *   npx.cmd tsx scripts/experiment1-contextbuilder-era-tokens.ts
 */

import { loadEnvLocal } from "./load-env-local";
import Module from "module";

const origLoad = Module._load;
// @ts-expect-error
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as any).NODE_ENV = "development";
delete process.env.DEEPSEEK_CONTINUATION_MANDATE;

import { estimateTokens } from "../src/lib/tokenEstimate";

async function main() {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const persona = "렌";

  // Minimal but representative history from the burst period (chat25)
  const history = [
    { role: "user" as const, content: "자동진행" },
    { role: "assistant" as const, content: "백하율은 렌의 손목을 잡고 엘리베이터 벽 쪽으로 밀었다. \"가이드님. 지금 저랑 떨어져야 된다고 말씀하실 건가요?\" 렌의 연두색 눈동자가 흔들렸다." },
    { role: "user" as const, content: "정말 고장났나봐.... 나랑 떨어져야되는거아니야??" },
  ];

  const chunks = parseCharacterSetting({
    characterId: "bc-exp1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대. 밀폐 공간.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const baseOpts = {
    charName,
    chunks,
    userNickname: persona,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", persona),
    longTermMemory: "[요약] 엘리베이터 긴장",
    shortTermHistory: history.slice(0, -1),
    currentUserMessage: history[history.length-1].content,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense"}')),
    modelId: "deepseek/deepseek-v4-pro",
    provider: "openrouter" as const,
    personaDisplayName: persona,
    targetResponseChars: 3000,
    completedTurns: 5,
    userPersonaGender: "other" as const,
  };

  const configs: Array<{ label: string; statusWidgetActive: boolean; note?: string }> = [
    { label: "2026-06-14-like (widget OFF)", statusWidgetActive: false },
    { label: "Current (widget ON)", statusWidgetActive: true },
  ];

  console.log("=== Experiment 1: ContextBuilder Era Token Breakdown ===\n");

  for (const cfg of configs) {
    const built = buildContext({ ...baseOpts, statusWidgetActive: cfg.statusWidgetActive });

    const split = built.openRouterSystemSplit!;
    const sysRulesTok = estimateTokens(split.systemRulesBlock);
    const charTok = estimateTokens(split.characterSettingsBlock);
    const dynTok = estimateTokens(split.dynamicBlock);
    const total = sysRulesTok + charTok + dynTok;

    console.log(`--- ${cfg.label} ---`);
    console.log(`systemRules: ${sysRulesTok} tok`);
    console.log(`character  : ${charTok} tok`);
    console.log(`dynamic    : ${dynTok} tok`);
    console.log(`TOTAL (3 blocks): ${total} tok`);

    // Rough widget vs length rule detection inside dynamic
    const dyn = split.dynamicBlock;
    const hasWidgetInstr = /STATUS WIDGET|statusWidget|<<<STATUS_VALUES/i.test(dyn);
    const widgetTokEst = hasWidgetInstr ? Math.round(dynTok * 0.12) : 0; // heuristic; real widget block is small
    const lengthRuleTokEst = Math.round(dynTok * 0.25);

    console.log(`  (inside dynamic, rough)`);
    console.log(`  widget instruction present: ${hasWidgetInstr}`);
    console.log(`  est. widget-related in dynamic: ~${widgetTokEst}`);
    console.log(`  est. length/rule portion: ~${lengthRuleTokEst}`);

    // Show first 300 chars of dynamic to see order
    console.log(`  dynamic head: ${dyn.slice(0, 280).replace(/\n/g, " ")}...\n`);
  }

  console.log("Notes:");
  console.log("- This uses current buildContext. '2026-06-14-like' is simulated by turning widget off.");
  console.log("- For a true old prompt you would need the exact sceneCompletionControl / length instruction text from mid-June.");
  console.log("- Order of injection can be seen in the dynamic head and in contextBuilder trackedSections logs when debug is on.");
}

main().catch(e => { console.error(e); process.exit(1); });
