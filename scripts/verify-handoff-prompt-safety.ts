/** Verify turn-handoff edit only changes tagged block; print system prompt char counts. */
import { loadEnvLocal } from "./load-env-local";
loadEnvLocal();
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

async function buildSystem(): Promise<string> {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { buildContext } = await import("../src/services/contextBuilder");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
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
    userNote: formatUserNoteForPrompt(""),
    longTermMemory: "",
    shortTermHistory: [
      { role: "user", content: "오늘도 밤산책 갈래?" },
      { role: "assistant", content: "백하율은 고개를 끄덕였다." },
    ],
    currentUserMessage: "밤이 깊었어. 무서워서 손 잡아줄래?",
    nsfw: true,
    gender: "male",
    assetTags: undefined,
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(JSON.stringify({ affection: 40 }))),
    modelId: "google/gemini-2.5-pro",
    userImpersonation: false,
    novelModeEnabled: false,
    personaDisplayName: persona,
    targetResponseChars: 2500,
    completedTurns: 5,
    userPersonaGender: "other",
    provider: "openrouter",
    genres: ["공포/추리"],
  });
  return built.systemPrompt;
}

function inlineRefCount(s: string): number {
  return (s.match(/obey <TURN_HANDOFF_AND_PACING>/g) ?? []).length;
}

function taggedBlock(s: string): string | null {
  const open = "<TURN_HANDOFF_AND_PACING>\n";
  const close = "</TURN_HANDOFF_AND_PACING>";
  const start = s.indexOf(open);
  if (start < 0) return null;
  const end = s.indexOf(close, start);
  if (end < 0) return null;
  return s.slice(start, end + close.length);
}

async function main() {
  const system = await buildSystem();
  const block = taggedBlock(system);
  const ref = inlineRefCount(system);
  console.log({
    system_prompt_chars: system.length,
    inline_cross_ref_count: ref,
    tagged_block_chars: block?.length ?? 0,
    tagged_block_has_pause_instruction: block?.includes("pause at [A] waiting") ?? false,
    core_master_inline_preserved: system.includes("Obey [NO GODMODDING] and <TURN_HANDOFF_AND_PACING>."),
    prose_bundle_present: system.includes("<PROSE_STYLE_POLICY>"),
    nsfw_scene_variety: system.includes("[SCENE VARIETY]"),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
