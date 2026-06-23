/**
 * Early-turn (t<9) output length probe — 3 API calls with softened [EARLY] hint.
 * Usage: npx.cmd tsx scripts/test-early-turn-length.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const TURNS = [2, 5, 8] as const;

function parseModel(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--model=")) return arg.slice("--model=".length);
  }
  return process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-pro";
}

async function buildFixture(completedTurns: number) {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
  const personaDisplayName = "렌";

  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.`,
    world: `# 세계관\n현대 도시 배경.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  return {
    charName,
    personaDisplayName,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(
      personaDisplayName,
      "other",
      "20대 후반 대학원생."
    ),
    userNotePrompt: formatUserNoteForPrompt(
      "[고집중]\n렌은 백하율을 오래 알고 지낸 친구처럼 대한다."
    ),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 25, trust: 30 }))
    ),
    shortTermHistory: [] as { role: "user" | "assistant"; content: string }[],
    currentUserMessage: "오늘 밤, 같이 산책하러 나갈래? 무서운 기분이 들어.",
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

async function main() {
  const MODEL = parseModel(process.argv.slice(2));
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { buildCoreMasterEarlyTurnHint } = await import("../src/lib/corePrompt");

  console.log(`model: ${MODEL} · MOCK_MODE=${process.env.MOCK_MODE}`);
  console.log("---");

  for (const t of TURNS) {
    const fixture = await buildFixture(t);
    const hint = buildCoreMasterEarlyTurnHint(t);
    const built = buildContext({
      charName: fixture.charName,
      chunks: fixture.chunks,
      userNickname: fixture.personaDisplayName,
      userPersona: fixture.userPersonaPrompt,
      userNote: fixture.userNotePrompt,
      longTermMemory: fixture.longTermMemory,
      shortTermHistory: fixture.shortTermHistory,
      currentUserMessage: fixture.currentUserMessage,
      nsfw: fixture.nsfw,
      gender: fixture.gender,
      assetTags: undefined,
      memoryMeta: fixture.memoryMeta,
      modelId: MODEL,
      userImpersonation: fixture.userImpersonation,
      novelModeEnabled: fixture.novelModeEnabled,
      personaDisplayName: fixture.personaDisplayName,
      targetResponseChars: fixture.targetResponseChars,
      completedTurns: fixture.completedTurns,
      userPersonaGender: fixture.userPersonaGender,
      provider: "openrouter",
      genres: fixture.genres,
    });

    const history = [
      ...fixture.shortTermHistory,
      { role: "user" as const, content: fixture.currentUserMessage },
    ];

    const result = await callOpenRouterAdult(
      built.systemPrompt,
      history,
      MODEL,
      fixture.targetResponseChars,
      { charName: fixture.charName },
      { chargeTurnBudget: false, requestKind: "early-turn-probe" }
    );

    const outputChars = visibleAssistantDisplayCharCount(result.text);
    console.log({
      completedTurns: t,
      early_hint_present: hint != null,
      early_hint_preview: hint?.slice(0, 80) + "…",
      output_chars: outputChars,
      finish_usage: result.usage,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
