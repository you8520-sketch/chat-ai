/**
 * Probe OpenRouter raw usage for implicit cache (Gemini / DeepSeek) — 2 turns same prefix.
 * Usage: npx.cmd tsx scripts/probe-openrouter-cache-usage.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODELS = [
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-v4-pro",
] as const;

const SESSION = "probe-cache-session-fixed";

async function fixture() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-probe",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며.\n\n# 외형\n키 178cm, 검은 머리, 날카로운 눈매.`,
    world: `# 세계관\n현대 도시. 게이트와 센티넬.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  return {
    charName,
    personaDisplayName: persona,
    chunks,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta(JSON.stringify({ affection: 50, trust: 45 }))),
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 800,
    completedTurns: 8,
    genres: ["현대/일상"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

async function main() {
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { parseOpenRouterUsage } = await import("../src/lib/openRouterUsage");

  const f = await fixture();
  const history: { role: "user" | "assistant"; content: string }[] = [];

  for (const modelId of MODELS) {
    console.log("\n==========", modelId, "==========");
    history.length = 0;
    for (let turn = 1; turn <= 2; turn++) {
      const userMsg = turn === 1 ? "밤이 깊었어. 잠깐 대화하자." : "그래, 계속 말해줘.";
      const built = buildContext({
        ...f,
        charName: f.charName,
        personaDisplayName: f.personaDisplayName,
        chunks: f.chunks,
        userNickname: f.personaDisplayName,
        userPersona: f.userPersona,
        userNote: f.userNote,
        longTermMemory: f.longTermMemory,
        memoryMeta: f.memoryMeta,
        shortTermHistory: history,
        currentUserMessage: userMsg,
        nsfw: f.nsfw,
        gender: f.gender,
        userPersonaGender: f.userPersonaGender,
        userImpersonation: f.userImpersonation,
        novelModeEnabled: f.novelModeEnabled,
        targetResponseChars: f.targetResponseChars,
        completedTurns: 8 + turn,
        genres: f.genres,
        modelId,
        provider: "openrouter",
      });

      const result = await callOpenRouterAdult(
        built.systemPrompt,
        built.history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        modelId,
        f.targetResponseChars,
        {
          charName: f.charName,
          personaName: f.personaDisplayName,
          systemSplit: built.openRouterSystemSplit,
          sessionId: SESSION,
        },
        { chargeTurnBudget: false, requestKind: `cache-probe-${modelId}-t${turn}` }
      );

      const raw = result.usage.debugRawUsage;
      const parsed = parseOpenRouterUsage(raw);
      console.log(`--- turn ${turn} ---`);
      console.log("parsed:", {
        prompt: parsed.promptTokens,
        cacheRead: parsed.cacheReadTokens,
        cacheWrite: parsed.cacheWriteTokens,
        standard: parsed.standardInputTokens,
        upstreamUsd: parsed.upstreamCostUsd,
        cacheDiscountUsd: parsed.cacheDiscountUsd,
      });
      console.log("raw usage:", JSON.stringify(raw, null, 2));

      history.push({ role: "user", content: userMsg });
      history.push({ role: "assistant", content: result.text.slice(0, 400) });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
