/**
 * Qwen possessive/intimate fixture — Konglish + hanja leak regression check.
 * Usage: npx.cmd tsx scripts/audit-foreign-mixing-qwen.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = "qwen/qwen3.7-max";
const TURN = 5;
const USER_MSG =
  "…다 알아요, 내 몸이 원하는 거 알아? 넌 나만 보면 돼. 나를 독점해줘. 천천히 해줘.";

const HANJA_LEAK = /[\u4e00-\u9fff]/;
const KONGLISH_LEAK = /[a-zA-Z]{3,}(?:될|되|했다|하다|해|함)/;

async function main() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

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

  const built = buildContext({
    charName,
    personaDisplayName: persona,
    chunks,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 72, trust: 68 }))
    ),
    shortTermHistory: [],
    currentUserMessage: USER_MSG,
    nsfw: true,
    gender: "male",
    userPersonaGender: "other",
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns: TURN,
    genres: ["현대/일상"],
    userNickname: persona,
    modelId: MODEL,
    provider: "openrouter",
  });

  assertPrompt(built.systemPrompt);

  console.log(`Calling ${MODEL} t=${TURN}...`);
  const result = await callOpenRouterAdult(
    built.systemPrompt,
    [{ role: "user", content: USER_MSG }],
    MODEL,
    2500,
    { charName },
    { chargeTurnBudget: false, requestKind: "foreign-mix-qwen" }
  );

  const text = result.text;
  const hanjaHits = text.match(HANJA_LEAK) ?? [];
  const konglishHits = text.match(KONGLISH_LEAK) ?? [];

  console.log({
    chars: visibleAssistantDisplayCharCount(text),
    finish: result.usage.finishReason,
    hanja_leak: hanjaHits.length > 0,
    hanja_chars: [...new Set(hanjaHits)],
    konglish_leak: konglishHits.length > 0,
    konglish_samples: konglishHits.slice(0, 5),
  });
  console.log("preview:", text.slice(0, 400).replace(/\n/g, " "));
}

function assertPrompt(system: string) {
  if (!system.includes("[NO FOREIGN LANGUAGE MIXING]")) {
    throw new Error("missing consolidated rule in prompt");
  }
  if (system.includes("[NO KONGLISH HYBRID]") || system.includes("[NO HANJA SUBSTITUTION]")) {
    throw new Error("legacy dual blocks still present");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
