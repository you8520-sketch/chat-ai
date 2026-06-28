/**
 * Phase 1 verification — production buildContext dump with hashes.
 *
 * Usage:
 *   npx.cmd tsx scripts/phase1-verify-production-prompt.ts --out=output/phase1-verify-after.json
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
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

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function sectionTextById(
  sections: Array<{ id: string; text: string }>,
  id: string
): string {
  return sections.find((s) => s.id === id)?.text ?? "";
}

function terminalBlockText(systemPrompt: string, sections: Array<{ id: string; text: string }>): string {
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
    shortTermHistory: historyMessages,
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
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg
    ? path.resolve(outArg.slice("--out=".length))
    : path.join("output", "phase1-verify-snapshot.json");

  const { buildContext } = await import("../src/services/contextBuilder");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("../src/lib/chatModels");
  const { rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");

  const fixture = await buildProductionFixture();
  const summarized = 0;
  const historyRaw = rawRecentTurnsToHistory(
    fixture.turns,
    summarized,
    resolveRawRecentTurnWindowForHistory(
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      "openrouter",
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

  const report = {
    generatedAt: new Date().toISOString(),
    gitHead: process.env.PHASE1_VERIFY_GIT_HEAD ?? "unknown",
    cwd: process.cwd(),
    modelId: fixture.modelId,
    hashes: {
      systemPrompt: sha256(parts.systemPrompt),
      cacheRules: sha256(parts.cacheRules),
      characterBlocks: sha256(parts.characterBlocks),
      dynamicBlocks: sha256(parts.dynamicBlocks),
      terminalBlocks: sha256(parts.terminalBlocks),
      ruleLengthControl: sha256(parts.ruleLengthControl),
      openRouterSplitFull: sha256(
        JSON.stringify(parts.openRouterSplit ?? null)
      ),
    },
    charCounts: {
      systemPrompt: parts.systemPrompt.length,
      cacheRules: parts.cacheRules.length,
      characterBlocks: parts.characterBlocks.length,
      dynamicBlocks: parts.dynamicBlocks.length,
      terminalBlocks: parts.terminalBlocks.length,
      ruleLengthControl: parts.ruleLengthControl.length,
    },
    sections: parts,
  };

  // sceneCompletionControl usage trace (static)
  const sccPath = path.resolve("src/lib/sceneCompletionControl.ts");
  let sccClassification = "not present";
  if (fs.existsSync(sccPath)) {
    const ctxSrc = fs.readFileSync(
      path.resolve("src/services/contextBuilder.ts"),
      "utf8"
    );
    const rlSrc = fs.readFileSync(path.resolve("src/lib/responseLength.ts"), "utf8");
    const thSrc = fs.readFileSync(
      path.resolve("src/lib/turnHandoffAndPacing.ts"),
      "utf8"
    );
    const inContextBuilder = /sceneCompletionControl/.test(ctxSrc);
    const reExportRl = /from ["']\.\/sceneCompletionControl["']/.test(rlSrc);
    const reExportTh = /from ["']\.\/sceneCompletionControl["']/.test(thSrc);
    const execSymbols = [
      "buildSceneCompletionControlBlock",
      "buildSceneCompletionControlInstruction",
      "buildTerminalSceneTailBlock",
      "buildLengthBudgetBlock",
      "buildTurnHandoffBlock",
    ];
    let execCallSites = 0;
    const walkSrc = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "node_modules" || ent.name === ".next-dev") continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walkSrc(p);
        else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts")) {
          if (p.replace(/\\/g, "/").endsWith("sceneCompletionControl.ts")) continue;
          const t = fs.readFileSync(p, "utf8");
          for (const sym of execSymbols) {
            const call = new RegExp(`\\b${sym}\\s*\\(`);
            if (call.test(t)) execCallSites++;
          }
        }
      }
    };
    walkSrc(path.resolve("src"));
    sccClassification =
      inContextBuilder || execCallSites > 0
        ? "actually executed"
        : reExportRl || reExportTh
          ? "re-export only"
          : "imported only";
  }

  report.sceneCompletionControlTrace = {
    classification: sccClassification,
    contextBuilderReferencesSceneCompletionControl: fs
      .readFileSync(path.resolve("src/services/contextBuilder.ts"), "utf8")
      .includes("sceneCompletionControl"),
    responseLengthReExportsSceneCompletionControl: fs
      .readFileSync(path.resolve("src/lib/responseLength.ts"), "utf8")
      .includes("./sceneCompletionControl"),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify({
      outPath,
      systemPromptSha256: report.hashes.systemPrompt,
      systemPromptChars: report.charCounts.systemPrompt,
      sceneCompletionControlTrace: report.sceneCompletionControlTrace,
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
