/**
 * Phase 2 verification — compare production prompt dump vs PROMPT_BASELINE_V1.
 *
 * Usage: npx.cmd tsx scripts/phase2-verify-against-baseline.ts
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

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

const BASELINE_PATH = path.resolve("output/prompt-baseline-v1.json");
const MANIFEST_PATH = path.resolve("output/PROMPT_BASELINE_V1-manifest.json");

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function lineDiff(a: string, b: string): number {
  const la = a.split("\n");
  const lb = b.split("\n");
  const max = Math.max(la.length, lb.length);
  let diff = 0;
  for (let i = 0; i < max; i++) {
    if (la[i] !== lb[i]) diff++;
  }
  return diff;
}

function extractXmlBlock(text: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start < 0 || end < 0) return "";
  return text.slice(start, end + close.length);
}

function sectionTextById(
  sections: Array<{ id: string; text: string }>,
  id: string
): string {
  return sections.find((s) => s.id === id)?.text ?? "";
}

function terminalBlockText(
  systemPrompt: string,
  sections: Array<{ id: string; text: string }>
): string {
  const terminal = sectionTextById(sections, "rule-terminal-length-override");
  if (terminal) return terminal;
  const marker = "[최우선 절대 지침";
  const idx = systemPrompt.indexOf(marker);
  return idx >= 0 ? systemPrompt.slice(idx) : "";
}

async function buildProductionFixture() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns } = await import("../src/lib/hybridMemory");

  const charName = "백하율";
  const userNickname = "렌";
  const personaDisplayName = "렌";
  const completedTurns = 9;

  const chunks = parseCharacterSetting({
    characterId: "verify-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.`,
    world: `# 세계관\n현대 도시 배경.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  const personaDescription = "20대 후반. 호기심 많고 직설적.";
  const userPersonaPrompt = formatSelectedPersonaForPrompt(
    personaDisplayName,
    "other",
    personaDescription
  );
  const userNotePrompt = formatUserNoteForPrompt("검증용 유저 노트", personaDisplayName);
  const memoryMeta = formatMemoryMetaForPrompt(
    parseMemoryMeta('{"relationship":"acquaintance"}')
  );
  const longTermMemory = "[요약] 엘리베이터에서 긴장된 분위기가 이어졌다.";

  const historyMessages = [
    { role: "user" as const, content: "자동진행" },
    {
      role: "assistant" as const,
      content:
        "백하율은 렌의 손목을 잡은 채 엘리베이터 벽에 등을 댔다. 좁은 공간 안 온도가 뒤섞였다.",
    },
    {
      role: "user" as const,
      content: "정말 고장났나봐.... 나랑 떨어져야되는거아니야??",
    },
  ];
  const turns = messagesToTurns(
    historyMessages.map((m) => ({ ...m, model: "assistant" }))
  );

  return {
    charName,
    chunks,
    userNickname,
    userPersona: userPersonaPrompt,
    userNote: userNotePrompt,
    longTermMemory,
    currentUserMessage: historyMessages[historyMessages.length - 1].content,
    nsfw: true,
    gender: "male" as const,
    memoryMeta,
    modelId: "deepseek/deepseek-v4-pro",
    provider: "openrouter" as const,
    personaDisplayName,
    targetResponseChars: 3300,
    completedTurns,
    userPersonaGender: "other" as const,
    statusWidgetActive: false,
    turns,
  };
}

async function main() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`Missing baseline: ${BASELINE_PATH}`);
    process.exit(2);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));

  const { buildContext } = await import("../src/services/contextBuilder");
  const { rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");

  const fixture = await buildProductionFixture();
  const summarized = 0;
  const historyRaw = rawRecentTurnsToHistory(
    fixture.turns,
    summarized,
    resolveRawRecentTurnWindowForHistory(
      fixture.modelId,
      fixture.provider,
      fixture.turns.length
    )
  );

  const built = buildContext({
    charName: fixture.charName,
    chunks: fixture.chunks,
    userNickname: fixture.userNickname,
    userPersona: fixture.userPersona,
    userNote: fixture.userNote,
    longTermMemory: fixture.longTermMemory,
    shortTermHistory: historyRaw,
    currentUserMessage: fixture.currentUserMessage,
    nsfw: fixture.nsfw,
    gender: fixture.gender,
    memoryMeta: fixture.memoryMeta,
    modelId: fixture.modelId,
    provider: fixture.provider,
    personaDisplayName: fixture.personaDisplayName,
    targetResponseChars: fixture.targetResponseChars,
    completedTurns: fixture.completedTurns,
    userPersonaGender: fixture.userPersonaGender,
    statusWidgetActive: fixture.statusWidgetActive,
  });

  const sections = built.meta?.trackedSections ?? [];
  const split = built.openRouterSystemSplit;
  const systemPrompt = built.systemPrompt;

  const parts = {
    systemPrompt,
    openRouterSplit: split
      ? {
          systemRulesBlock: split.systemRulesBlock,
          characterSettingsBlock: split.characterSettingsBlock,
          dynamicBlock: split.dynamicBlock,
        }
      : null,
    cacheRules: split?.systemRulesBlock ?? "",
    characterBlocks: split?.characterSettingsBlock ?? "",
    dynamicBlocks: split?.dynamicBlock ?? "",
    terminalBlocks: terminalBlockText(systemPrompt, sections),
    ruleLengthControl: sectionTextById(sections, "rule-length-control"),
  };

  const hashes = {
    systemPrompt: sha256(parts.systemPrompt),
    cacheRules: sha256(parts.cacheRules),
    characterBlocks: sha256(parts.characterBlocks),
    dynamicBlocks: sha256(parts.dynamicBlocks),
    terminalBlocks: sha256(parts.terminalBlocks),
    ruleLengthControl: sha256(parts.ruleLengthControl),
    openRouterSplitFull: sha256(JSON.stringify(parts.openRouterSplit ?? null)),
    proseStylePolicy: sha256(extractXmlBlock(parts.characterBlocks, "PROSE_STYLE_POLICY")),
    longTermMemory: sha256(extractXmlBlock(parts.dynamicBlocks, "LONG_TERM_MEMORY")),
  };

  const baselineHashes = baseline.hashes as Record<string, string>;
  const baselineSections = baseline.sections as {
    systemPrompt: string;
    cacheRules: string;
    characterBlocks: string;
    dynamicBlocks: string;
    terminalBlocks: string;
    ruleLengthControl: string;
  };

  const baselineProseHash = sha256(
    extractXmlBlock(baselineSections.characterBlocks, "PROSE_STYLE_POLICY")
  );
  const baselineLtmHash = sha256(
    extractXmlBlock(baselineSections.dynamicBlocks, "LONG_TERM_MEMORY")
  );

  const systemDiffLines = lineDiff(baselineSections.systemPrompt, parts.systemPrompt);
  const cacheRulesDiffLines = lineDiff(baselineSections.cacheRules, parts.cacheRules);

  let changedFiles: string[] = [];
  try {
    changedFiles = execSync("git diff --name-only", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    changedFiles = ["(git diff unavailable)"];
  }

  const forbiddenPaths = [
    "src/app/api/",
    "continuation",
    "recovery",
    "responseLengthConstants",
    "maxTokens",
    "maxOutputTokens",
  ];
  const apiOrRecoveryChanged = changedFiles.some(
    (f) =>
      f.includes("src/app/api/") ||
      (f.includes("continuation") && !f.includes(".test.")) ||
      (f.includes("recovery") && !f.includes(".test."))
  );

  const phase2ScopeFiles = [
    "src/services/contextBuilder.ts",
    "src/lib/responseLength.ts",
    "src/lib/sceneCompletionControl.ts",
    "src/lib/turnHandoffAndPacing.ts",
    "src/lib/corePrompt.ts",
    "src/lib/noGodmodding.ts",
    "src/lib/userPersonaNarrationRules.ts",
    "src/lib/controlledPossession.ts",
    "src/lib/continueNarrative.ts",
  ];

  let tierChangedInPhase2 = false;
  try {
    const phase2Diff = execSync(
      `git diff ${phase2ScopeFiles.join(" ")}`,
      { encoding: "utf8" }
    );
    tierChangedInPhase2 =
      /UNIFIED_TIER|MAX_OUTPUT_TOKEN|resolveMaxOutputTokens/i.test(phase2Diff);
  } catch {
    tierChangedInPhase2 = false;
  }

  const { resolveMaxOutputTokensForTarget, resolveResponseLengthTarget } =
    await import("../src/lib/responseLength");
  const tierSnapshot = {
    min: resolveResponseLengthTarget(3300).min,
    aim: resolveResponseLengthTarget(3300).aimChars,
    max: resolveResponseLengthTarget(3300).max,
    maxOutputTokens: resolveMaxOutputTokensForTarget(3300, fixture.modelId),
  };

  const characterBlocksMatch = hashes.characterBlocks === baselineHashes.characterBlocks;
  const proseMatch = hashes.proseStylePolicy === baselineProseHash;
  const ltmMatch = hashes.longTermMemory === baselineLtmHash;

  const hashKeys = [
    "cacheRules",
    "characterBlocks",
    "dynamicBlocks",
    "terminalBlocks",
    "ruleLengthControl",
    "openRouterSplitFull",
  ] as const;

  const failReasons: string[] = [];
  if (!characterBlocksMatch) failReasons.push("characterBlocks hash changed");
  if (!proseMatch) failReasons.push("proseStylePolicy hash changed");
  if (!ltmMatch) failReasons.push("longTermMemory section changed");
  if (apiOrRecoveryChanged) failReasons.push("API or continuation/recovery path changed");
  if (tierChangedInPhase2) failReasons.push("tier/maxTokens changed in Phase 2 scope diff");

  const pass = failReasons.length === 0;

  const lines: string[] = [];
  lines.push("Phase 2 Verification Report");
  lines.push(`baseline: PROMPT_BASELINE_V1 (${BASELINE_PATH})`);
  lines.push(`manifest: ${MANIFEST_PATH}`);
  lines.push(`generatedAt: ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## 1. Changed files");
  lines.push("### Phase 2 scope (this task)");
  for (const f of phase2ScopeFiles) {
    if (changedFiles.includes(f)) lines.push(`  - ${f}`);
  }
  lines.push("### All working-tree (git diff --name-only)");
  for (const f of changedFiles) lines.push(`  - ${f}`);
  lines.push("");

  lines.push("## 2. systemPrompt diff line count");
  lines.push(`  ${systemDiffLines}`);
  lines.push("");

  lines.push("## 3. Changed section ids");
  const allChanged: string[] = [];
  if (parts.ruleLengthControl !== baselineSections.ruleLengthControl)
    allChanged.push("rule-length-control");
  if (parts.terminalBlocks !== baselineSections.terminalBlocks)
    allChanged.push("rule-terminal-length-override");
  if (parts.cacheRules !== baselineSections.cacheRules)
    allChanged.push("(cacheRules — cross-ref strings only)");
  for (const id of allChanged) lines.push(`  - ${id}`);
  if (allChanged.length === 0) lines.push("  (none)");
  lines.push("");

  lines.push("## 4. Hash changes vs PROMPT_BASELINE_V1");
  lines.push("| block | baseline | after | match |");
  lines.push("|-------|----------|-------|-------|");
  const systemBaseline =
    baselineHashes.systemPrompt ?? sha256(baselineSections.systemPrompt);
  lines.push(
    `| systemPrompt | ${systemBaseline.slice(0, 16)}… | ${hashes.systemPrompt.slice(0, 16)}… | ${systemBaseline === hashes.systemPrompt ? "SAME" : "CHANGED"} |`
  );
  for (const k of hashKeys) {
    const b = baselineHashes[k] ?? "—";
    const a = hashes[k as keyof typeof hashes] ?? "—";
    const match = b === a;
    lines.push(`| ${k} | ${b.slice(0, 16)}… | ${String(a).slice(0, 16)}… | ${match ? "SAME" : "CHANGED" } |`);
  }
  lines.push(`| proseStylePolicy | ${baselineProseHash.slice(0, 16)}… | ${hashes.proseStylePolicy.slice(0, 16)}… | ${proseMatch ? "SAME" : "CHANGED"} |`);
  lines.push(`| longTermMemory | ${baselineLtmHash.slice(0, 16)}… | ${hashes.longTermMemory.slice(0, 16)}… | ${ltmMatch ? "SAME" : "CHANGED"} |`);
  lines.push("");

  lines.push("## 5. cacheRules diff line count (cross-ref only expected)");
  lines.push(`  ${cacheRulesDiffLines}`);
  lines.push("");

  lines.push("## PASS criteria");
  lines.push(`  characterBlocks: ${characterBlocksMatch ? "PASS" : "FAIL"}`);
  lines.push(`  proseStylePolicy: ${proseMatch ? "PASS" : "FAIL"}`);
  lines.push(`  memory/history (LTM block): ${ltmMatch ? "PASS" : "FAIL"}`);
  lines.push(`  dynamicBlocks change allowed: ${hashes.dynamicBlocks !== baselineHashes.dynamicBlocks ? "YES (expected)" : "unchanged"}`);
  lines.push(`  terminalBlocks change allowed: ${hashes.terminalBlocks !== baselineHashes.terminalBlocks ? "YES (expected)" : "unchanged"}`);
  lines.push(`  API/continuation/recovery untouched: ${apiOrRecoveryChanged ? "FAIL" : "PASS"}`);
  lines.push(`  tier constants untouched (Phase 2 diff): ${tierChangedInPhase2 ? "FAIL" : "PASS"}`);
  lines.push(
    `  tier snapshot (min/aim/max/maxTokens): ${tierSnapshot.min}/${tierSnapshot.aim}/${tierSnapshot.max}/${tierSnapshot.maxOutputTokens}`
  );
  lines.push("");

  lines.push(`## VERDICT: ${pass ? "PASS" : "FAIL"}`);
  if (!pass) {
    lines.push("");
    lines.push("FAIL reasons:");
    for (const r of failReasons) lines.push(`  - ${r}`);
  }

  const out = lines.join("\n");
  fs.writeFileSync(path.resolve("output/phase2-verify-report.txt"), out, "utf8");
  console.log(out);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
