/**
 * Probe dialogue wholeness + narration density after [DIALOGUE & NARRATION STRUCTURE] merge.
 * Usage: npx.cmd tsx scripts/test-dialogue-narration-structure.ts --model=google/gemini-2.5-pro
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

function parseModel(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--model=")) return arg.slice("--model=".length);
  }
  return process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-pro";
}

/** Split prose into alternating narration / quoted dialogue segments */
function splitNarrationAndQuotes(text: string): { kind: "narration" | "quote"; text: string }[] {
  const parts: { kind: "narration" | "quote"; text: string }[] = [];
  const re = /"[^"]*"/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const narr = text.slice(last, m.index).trim();
      if (narr) parts.push({ kind: "narration", text: narr });
    }
    parts.push({ kind: "quote", text: m[0] });
    last = m.index + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) parts.push({ kind: "narration", text: tail });
  return parts;
}

/** Classic fragmentation: short quote → thin narration → short quote */
function detectFragmentation(text: string): boolean {
  const parts = splitNarrationAndQuotes(text);
  for (let i = 0; i < parts.length - 2; i++) {
    const a = parts[i]!;
    const b = parts[i + 1]!;
    const c = parts[i + 2]!;
    if (a.kind !== "quote" || b.kind !== "narration" || c.kind !== "quote") continue;
    const aInner = a.text.slice(1, -1);
    const cInner = c.text.slice(1, -1);
    if (aInner.length <= 12 && cInner.length <= 20 && b.text.length < 80) {
      return true;
    }
  }
  return false;
}

function analyzeNarrationDensity(text: string) {
  const parts = splitNarrationAndQuotes(text);
  const narrBlocks = parts.filter((p) => p.kind === "narration").map((p) => p.text);
  const quotes = parts.filter((p) => p.kind === "quote");
  const thinBridges = narrBlocks.filter((n) => n.length < 50).length;
  const denseBlocks = narrBlocks.filter((n) => n.length >= 80).length;
  const avgNarrationChars =
    narrBlocks.length > 0
      ? Math.round(narrBlocks.reduce((s, n) => s + n.length, 0) / narrBlocks.length)
      : 0;
  const shortQuotes = quotes.filter((q) => q.text.length <= 14).length;
  return {
    narration_blocks: narrBlocks.length,
    quote_count: quotes.length,
    thin_narration_bridges_lt50: thinBridges,
    dense_narration_blocks_gte80: denseBlocks,
    avg_narration_block_chars: avgNarrationChars,
    short_quote_count_lte14: shortQuotes,
  };
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
  const { buildAdvancedProseNsfwGuidelines } = await import("../src/lib/advancedProseNsfwGuidelines");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const guidelines = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true, literaryEnhanced: true });
  console.log({
    model: MODEL,
    guidelines_tokens: estimateTokens(guidelines),
    has_unified_block: guidelines.includes("[DIALOGUE & NARRATION STRUCTURE]"),
    legacy_blocks_removed:
      !guidelines.includes("[NO DIALOGUE FRAGMENTATION]") &&
      !guidelines.includes("[NARRATION DENSITY — DIALOGUE SCENES]"),
  });
  console.log("---");

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
      { chargeTurnBudget: false, requestKind: "dialogue-narration-probe" }
    );

    const outputChars = visibleAssistantDisplayCharCount(result.text);
    const density = analyzeNarrationDensity(result.text);
    const fragmented = detectFragmentation(result.text);

    console.log({
      completedTurns: t,
      output_chars: outputChars,
      dialogue_fragmented: fragmented,
      dialogue_whole: !fragmented,
      narration_dense: density.dense_narration_blocks_gte80 >= 1 && density.avg_narration_block_chars >= 50,
      ...density,
      preview: result.text.slice(0, 200).replace(/\n/g, " "),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
