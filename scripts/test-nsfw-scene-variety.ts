/**
 * NSFW scene-variety probe — 5 turns.
 * Usage: npx.cmd tsx scripts/test-nsfw-scene-variety.ts --model=google/gemini-2.5-pro
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const TURNS = [1, 3, 5, 7, 9] as const;
const MSGS = [
  "창문을 닫아줄래? 밖에서 이상한 소리가 들려.",
  "…손 잡아줘. 천천히 해줘.",
  "오늘 밤은 여기서 자고 싶어. 괜찮아?",
  "다 알아요. 내 몸이 원하는 거 알아?",
  "문 좀 잠가줄 수 있어? 무서워.",
];

function parseModel(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--model=")) return arg.slice("--model=".length);
  }
  return process.env.OPENROUTER_MODEL?.trim() || "google/gemini-2.5-pro";
}

const EMOTION_LABEL_RE =
  /(?:그는|그녀는|백하율은|하율은|렌은|당신은)[^\n.]{0,30}(?:긴장했|설렜|두려워했|불안했|기뻤|슬펐|화났|당황했)/g;
const SENSORY_LOOP_RE = /(?:체온|숨결|시선|피부|호흡|맥박|체온)/g;
const ACTION_ENV_RE =
  /(?:창문|문을|손을 뻗|고개를|발걸음|조명|그림자|바람|소리|침대|의자|벽|거리|불빛|닫|열|걸음|환경)/;

async function fixture(t: number, msg: string) {
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
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.`,
    world: `# 세계관\n현대 도시 배경.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });
  return {
    charName,
    personaDisplayName: persona,
    chunks,
    userPersonaPrompt: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 45, trust: 40 }))
    ),
    shortTermHistory: [] as { role: "user" | "assistant"; content: string }[],
    currentUserMessage: msg,
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

function analyze(text: string) {
  const emotionHits = text.match(EMOTION_LABEL_RE) ?? [];
  const sensoryTokens = text.match(SENSORY_LOOP_RE) ?? [];
  const sensoryKinds = new Set(sensoryTokens);
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim() && !p.trim().startsWith('"'));
  let consecutiveSensoryParas = 0;
  let maxConsecutiveSensoryParas = 0;
  for (const p of paragraphs) {
    const sensoryCount = (p.match(SENSORY_LOOP_RE) ?? []).length;
    if (sensoryCount >= 2) {
      consecutiveSensoryParas += 1;
      maxConsecutiveSensoryParas = Math.max(maxConsecutiveSensoryParas, consecutiveSensoryParas);
    } else {
      consecutiveSensoryParas = 0;
    }
  }
  const actionEnvParas = paragraphs.filter((p) => ACTION_ENV_RE.test(p)).length;
  return {
    emotion_label_hits: emotionHits,
    emotion_label_ok: emotionHits.length === 0,
    sensory_token_count: sensoryTokens.length,
    sensory_kind_count: sensoryKinds.size,
    max_consecutive_sensory_heavy_paras: maxConsecutiveSensoryParas,
    sensory_loop_ok: maxConsecutiveSensoryParas <= 2,
    action_or_env_paragraphs: actionEnvParas,
    has_non_sensory_tension: actionEnvParas >= 1,
    preview: text.slice(0, 180).replace(/\n/g, " "),
  };
}

async function main() {
  const model = parseModel(process.argv.slice(2));
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { buildAdvancedProseNsfwGuidelines } = await import("../src/lib/advancedProseNsfwGuidelines");

  const guidelines = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: true, literaryEnhanced: true });
  console.log({
    model,
    has_scene_variety: guidelines.includes("[SCENE VARIETY]"),
    has_50_30_20: guidelines.includes("50/30/20"),
    has_widened_rule1: guidelines.includes("행동·선택·시선·환경과의 상호작용"),
  });
  console.log("---");

  for (let i = 0; i < TURNS.length; i++) {
    const t = TURNS[i]!;
    const msg = MSGS[i]!;
    const f = await fixture(t, msg);
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
      { chargeTurnBudget: false, requestKind: "nsfw-scene-variety" }
    );
    const text = result.text;
    const metrics = analyze(text);
    console.log({
      completedTurns: t,
      output_chars: visibleAssistantDisplayCharCount(text),
      ...metrics,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
