/** Minimal 3-turn output_chars probe — no prompt dump. */
import { loadEnvLocal } from "./load-env-local";
loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [2, 5, 8] as const;
const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

async function fixture(t: number) {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  return {
    charName,
    personaDisplayName: persona,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(JSON.stringify({ affection: 40, trust: 35 }))),
    shortTermHistory: [] as { role: "user" | "assistant"; content: string }[],
    currentUserMessage: USER_MSG,
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns: t,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith("--")) ?? "probe";
const modelArg = args.find((a) => a.startsWith("--model="));
const model =
  modelArg?.slice("--model=".length) ??
  process.env.OPENROUTER_MODEL?.trim() ??
  "google/gemini-2.5-pro";

async function main() {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  console.log(`=== ${label} (model: ${model}) ===`);
  for (const t of TURNS) {
    const f = await fixture(t);
    const built = buildContext({
      ...f,
      userNickname: f.personaDisplayName,
      assetTags: undefined,
      modelId: model,
      provider: "openrouter",
    });
    const result = await callOpenRouterAdult(
      built.systemPrompt,
      [{ role: "user", content: f.currentUserMessage }],
      model,
      f.targetResponseChars,
      { charName: f.charName },
      { chargeTurnBudget: false, requestKind: `isolation-${label}` }
    );
    console.log({ label, completedTurns: t, output_chars: visibleAssistantDisplayCharCount(result.text) });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
