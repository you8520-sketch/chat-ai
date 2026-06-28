/**
 * Audit LENGTH / scene / terminal rules in assembled OpenRouter prompt.
 * Usage: npx.cmd tsx scripts/audit-length-prompt-dedup.ts
 */
import { createRequire } from "node:module";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";

const require = createRequire(import.meta.url);
require.cache[require.resolve("server-only")] = {
  exports: {},
  loaded: true,
  id: "server-only",
  filename: "server-only",
};

function countAll(hay: string, needle: string | RegExp): number {
  if (typeof needle === "string") {
    let c = 0;
    let i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) {
      c++;
      i += needle.length;
    }
    return c;
  }
  return (hay.match(needle) ?? []).length;
}

async function audit(targetResponseChars: number | undefined, label: string) {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { buildTurnHandoffAndPacingBlock } = await import("../src/lib/turnHandoffAndPacing");

  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "vg-1",
    characterName: charName,
    gender: "male",
    systemPrompt: "# 성격\n차분.",
    world: "# 세계관\n현대.",
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });

  const built = buildContext({
    charName,
    chunks,
    userNickname: persona,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", persona),
    longTermMemory: "",
    shortTermHistory: "",
    currentUserMessage: "테스트",
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId: "qwen/qwen3.7-max",
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: targetResponseChars,
    completedTurns: 5,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });

  const sys = built.systemPrompt ?? "";
  const sections = built.meta.trackedSections ?? [];
  const lengthRelated = sections.filter((s) =>
    /length|terminal|handoff|prose-style|no-godmodding/i.test(s.id)
  );

  const handoff = buildTurnHandoffAndPacingBlock();
  let fullHandoff = 0;
  let idx = 0;
  while ((idx = sys.indexOf(handoff, idx)) !== -1) {
    fullHandoff++;
    idx += handoff.length;
  }

  const report = {
    label,
    targetResponseChars: targetResponseChars ?? "default",
    markers: {
      LENGTH_CONTROL_SCENE_EXPANSION: countAll(sys, "[LENGTH CONTROL & SCENE EXPANSION]"),
      SCENE_COMPLETION: countAll(sys, "[SCENE COMPLETION]"),
      SCENE_COMPLETION_CONTROL: countAll(sys, "[SCENE COMPLETION CONTROL]"),
      LENGTH_BUDGET: countAll(sys, "[LENGTH BUDGET]"),
      SCENE_CONTINUATION_PRIORITY: countAll(sys, "[SCENE CONTINUATION PRIORITY]"),
      TERMINAL_KO: countAll(sys, "[최우선 절대 지침"),
      TURN_HANDOFF_OPEN: countAll(sys, "<TURN_HANDOFF_AND_PACING>"),
      TURN_HANDOFF_FULL_BLOCKS: fullHandoff,
      DYNAMIC_PROSE_SCENE_EXPANSION: countAll(sys, "[DYNAMIC PROSE STYLING & SCENE EXPANSION]"),
    },
    numerics: {
      "2,400": countAll(sys, "2,400"),
      "2,500": countAll(sys, "2,500"),
      "3,300": countAll(sys, "3,300"),
      "2,200": countAll(sys, "2,200"),
      TARGET_LENGTH_lines: countAll(sys, /TARGET_LENGTH:/g),
      MINIMUM_FLOOR_lines: countAll(sys, /MINIMUM_FLOOR:/g),
    },
    lengthRelatedSections: lengthRelated.map((s) => ({
      id: s.id,
      chars: s.text.length,
      has_TARGET: s.text.includes("TARGET_LENGTH"),
      has_MINIMUM: s.text.includes("MINIMUM_FLOOR"),
    })),
  };

  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  await audit(undefined, "default-3300");
  await audit(2400, "target-2400");
  await audit(2500, "target-2500");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
