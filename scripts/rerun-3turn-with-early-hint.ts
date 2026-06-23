/**
 * Re-run 3-turn probe + dump [EARLY t] hint from assembled prompt.
 * Usage: npx.cmd tsx scripts/rerun-3turn-with-early-hint.ts --model=google/gemini-2.5-pro
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const TURNS = [2, 5, 8] as const;
const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";
const PREV_CHARS: Record<number, number> = { 2: 1070, 5: 1011, 8: 834 };

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
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 40, trust: 35 }))
    ),
    shortTermHistory: [] as { role: "user" | "assistant"; content: string }[],
    currentUserMessage: USER_MSG,
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

  console.log("=== [EARLY t] softened hint — live code verification ===\n");

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

    const sections = built.meta.trackedSections ?? [];
    const turnHintSection = sections.find((s) => s.id === "rule-core-turn-hint");
    const coreMaster = sections.find((s) => s.id === "rule-core-master");
    const integrityEarly = coreMaster?.text.match(/\[EARLY t=\d+\][^\n]*/)?.[0] ?? null;

    console.log(`--- t=${t} ---`);
    console.log("buildCoreMasterEarlyTurnHint():");
    console.log(hint ?? "(null)");
    console.log("\nAssembled prompt section [rule-core-turn-hint]:");
    console.log(turnHintSection?.text ?? "(section absent — completedTurns >= 15)");
    console.log("\n[INTEGRITY] embedded clause (cached core uses t=99, so absent in rule-core-master):");
    console.log(integrityEarly ?? "(absent in cached rule-core-master — expected for OpenRouter)");
    console.log("");
  }

  console.log("=== 3-turn API probe (model:", MODEL, ") ===\n");

  for (const t of TURNS) {
    const fixture = await buildFixture(t);
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

    const history = [{ role: "user" as const, content: fixture.currentUserMessage }];
    const result = await callOpenRouterAdult(
      built.systemPrompt,
      history,
      MODEL,
      fixture.targetResponseChars,
      { charName: fixture.charName },
      { chargeTurnBudget: false, requestKind: "rerun-3turn-early-hint" }
    );

    const outputChars = visibleAssistantDisplayCharCount(result.text);
    const prev = PREV_CHARS[t]!;
    console.log({
      completedTurns: t,
      output_chars: outputChars,
      previous_output_chars: prev,
      delta: outputChars - prev,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
