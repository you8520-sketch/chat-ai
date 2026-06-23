/**
 * Regression — observer-ban dedup, EARLY vs early_scene, memory priority framing.
 * Usage: npx.cmd tsx scripts/audit-prompt-dedup-fixes.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = process.env.PROMPT_DEDUP_AUDIT_MODEL ?? "qwen/qwen3.7-max";
const PERSONA = "렌";
const CHAR = "백하율";

const MEMORY_META = `[Memory — 참고, 우선순위 2순위 하위]
관계:
호칭: 백하율→렌: 가이드님
속마음(캐릭터·NPC): 백하율: 렌이 내 손을 잡는다고 진짜로 나아질까?`;

const USER_MSGS = [
  "…가이드님, 손만 잡아주면 되지? 일어나봐.",
  "…무서워. 천천히만 해줘, 가이드님.",
  "밤산책 같이 갈래?",
  "그래, 같이 가자. 오늘 밤은 좀 이상해.",
  "…다 알아요, 내 몸이 원하는 거 알아?",
];

const OBSERVER_VERB_BAN =
  /기다리며\s*\/\s*기다렸다\s*\/\s*바라보았다\s*\/\s*확인했다\s*\/\s*지켜보았다/;
const BANNED_ENDING =
  /(?:기다리며|기다렸다|바라보았다|확인했다|지켜보았다)\s*\.?\s*$/;
const EARLY_ESCALATION =
  /(?:평생|영원히|결혼|신부|남편|아내|숭배|헌신|내 것|넌 내|전속|소유)/;

function countObserverBanLines(system: string): number {
  return (system.match(/observer closing beats/g) ?? []).length;
}

function scanPrompt(system: string): string[] {
  const hits: string[] = [];
  const banCount = countObserverBanLines(system);
  if (banCount !== 1) hits.push(`observer-ban-lines=${banCount} (want 1)`);
  if (!system.includes("[WHEN YOU MUST NOT END EARLY]")) hits.push("missing WHEN YOU MUST NOT END EARLY");
  if (!OBSERVER_VERB_BAN.test(system)) hits.push("missing observer verb stem list in TURN_HANDOFF");
  if (system.includes("[early_scene t=")) hits.push("early_scene still present");
  if (!/\[EARLY t=1\]/.test(system)) hits.push("missing [EARLY t=1]");
  if (system.includes("반드시 반영")) hits.push("mandatory memory framing still present");
  if (!system.includes("[Memory — 참고, 우선순위 2순위 하위]")) hits.push("missing soft memory header");
  return hits;
}

function scanOutput(text: string): string[] {
  const hits: string[] = [];
  const trimmed = text.trim();
  if (BANNED_ENDING.test(trimmed)) hits.push("observer-ending");
  if (!/가이드님/.test(text)) hits.push("honorific 가이드님 not reflected");
  if (EARLY_ESCALATION.test(text)) hits.push("early-stage escalation tropes");
  return hits;
}

async function main() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const chunks = parseCharacterSetting({
    characterId: "mock-dedup",
    characterName: CHAR,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며. 평소 "~요", "~죠" 존댓말.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${CHAR}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  const history: { role: "user" | "assistant"; content: string }[] = [];
  let issues = 0;

  for (let i = 0; i < USER_MSGS.length; i++) {
    const userMsg = USER_MSGS[i];
    const built = buildContext({
      charName: CHAR,
      personaDisplayName: PERSONA,
      chunks,
      userNickname: PERSONA,
      userPersona: formatSelectedPersonaForPrompt(PERSONA, "other", "20대. 반말 구어체."),
      userNote: formatUserNoteForPrompt(""),
      longTermMemory: "",
      memoryMeta: MEMORY_META,
      shortTermHistory: history,
      currentUserMessage: userMsg,
      nsfw: true,
      gender: "male",
      userPersonaGender: "other",
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 2500,
      completedTurns: 1,
      genres: ["현대/일상"],
      modelId: MODEL,
      provider: "openrouter",
      promptDumpSource: "audit",
      promptDumpDetail: `prompt-dedup t=${i + 1}`,
    });

    const promptHits = scanPrompt(built.systemPrompt);
    if (promptHits.length) {
      issues += promptHits.length;
      console.log(`\n── Turn ${i + 1} PROMPT ──`);
      console.log("CHECK:", promptHits);
    }

    console.log(`\n── Turn ${i + 1} ──`);
    const result = await callOpenRouterAdult(
      built.systemPrompt,
      [{ role: "user", content: userMsg }],
      MODEL,
      2500,
      { charName: CHAR },
      { chargeTurnBudget: false, requestKind: `prompt-dedup-${i + 1}` }
    );

    const outHits = scanOutput(result.text);
    if (outHits.length) {
      issues += outHits.length;
      console.log("OUTPUT CHECK:", outHits);
    } else {
      console.log("OK — memory honorific, no observer end, early pacing");
    }
    console.log(`output chars: ${result.text.length}`);

    history.push({ role: "user", content: userMsg });
    history.push({ role: "assistant", content: result.text });
  }

  console.log("\n── Summary ──");
  console.log(`turns: ${USER_MSGS.length} · check hits: ${issues}`);
  if (issues > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
