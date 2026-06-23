/**
 * Post-trim probe: dialogue structure, show-don't-tell, user persona boundaries.
 * Usage: npx.cmd tsx scripts/test-trim-regressions.ts --model=google/gemini-2.5-pro
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
const PERSONA = "렌";

function parseModel(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--model=")) return arg.slice("--model=".length);
  }
  return process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-pro";
}

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

function detectFragmentation(text: string): boolean {
  const parts = splitNarrationAndQuotes(text);
  for (let i = 0; i < parts.length - 2; i++) {
    const a = parts[i]!;
    const b = parts[i + 1]!;
    const c = parts[i + 2]!;
    if (a.kind !== "quote" || b.kind !== "narration" || c.kind !== "quote") continue;
    const aInner = a.text.slice(1, -1);
    const cInner = c.text.slice(1, -1);
    if (aInner.length <= 12 && cInner.length <= 20 && b.text.length < 80) return true;
  }
  return false;
}

function analyzeNarrationDensity(text: string) {
  const narrBlocks = splitNarrationAndQuotes(text)
    .filter((p) => p.kind === "narration")
    .map((p) => p.text);
  return {
    thin_narration_bridges_lt50: narrBlocks.filter((n) => n.length < 50).length,
    dense_narration_blocks_gte80: narrBlocks.filter((n) => n.length >= 80).length,
    avg_narration_block_chars:
      narrBlocks.length > 0
        ? Math.round(narrBlocks.reduce((s, n) => s + n.length, 0) / narrBlocks.length)
        : 0,
  };
}

/** [B] emotion/thought godmod — persona name + internal state verb */
function detectUserPersonaGodmod(text: string, persona: string): boolean {
  const patterns = [
    new RegExp(`${persona}(?:은|는|이|가)?[^\\n]{0,40}(?:느꼈|생각했|마음속|속마음|원했|결심했)`, "i"),
    new RegExp(`${persona}(?:은|는|이|가)?[^\\n]{0,30}(?:두려움|기쁨|슬픔|사랑|욕망)을? (?:느꼈|느끼)`, "i"),
  ];
  return patterns.some((p) => p.test(text));
}

/** Direct narrator emotional labeling (show-don't-tell violation heuristic) */
function detectShowDontTellViolations(text: string): number {
  const labels = text.match(
    /(?:마음이|심장이|가슴이)[^\n.]{0,20}(?:슬펐|기뻤|두려웠|설렜|행복했)|(?:분명히|확실히)[^\n.]{0,15}(?:슬픔|기쁨|두려움|사랑)이었/g
  );
  return labels?.length ?? 0;
}

async function buildFixture(completedTurns: number) {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const charName = "백하율";
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
    personaDisplayName: PERSONA,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(PERSONA, "other", "20대 후반 대학원생."),
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

  console.log({ model: MODEL });
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
      { chargeTurnBudget: false, requestKind: "trim-regression-probe" }
    );

    const text = result.text;
    const density = analyzeNarrationDensity(text);
    const fragmented = detectFragmentation(text);
    const godmod = detectUserPersonaGodmod(text, PERSONA);
    const tellViolations = detectShowDontTellViolations(text);

    console.log({
      completedTurns: t,
      output_chars: visibleAssistantDisplayCharCount(text),
      dialogue_whole: !fragmented,
      narration_dense: density.dense_narration_blocks_gte80 >= 1 && density.avg_narration_block_chars >= 50,
      user_persona_boundary_ok: !godmod,
      show_dont_tell_ok: tellViolations <= 1,
      tell_label_hits: tellViolations,
      ...density,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
