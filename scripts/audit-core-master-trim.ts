/**
 * Core master trim regression — speech register, show-don't-tell, -다체 narration.
 * Usage: npx.cmd tsx scripts/audit-core-master-trim.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = process.env.CORE_MASTER_AUDIT_MODEL ?? "qwen/qwen3.7-max";
const PERSONA = "렌";
const CHAR = "백하율";

const USER_MSGS = [
  "알았어 손만 잡아주면 되지? 일어나봐.",
  "…무서워. 천천히만 해줘.",
  "밤산책 같이 갈래?",
  "그래, 같이 가자.",
];

/** Narration lines (non-dialogue) should use 해체 endings */
const DADA_ENDING =
  /(?:했다|였다|났다|갔다|돌았다|멈췄다|서있다|흘렀다|번졌다|스쳤다|닿았다|떨렸다|맞았다|내려앉|퍼졌|감쌌|비쳤)/;

/** Direct emotion labels in narration (show-don't-tell leak) */
const EMOTION_LABEL =
  /(?:긴장했|두려워|설레|기뻐|슬퍼|화가|당황|불안|원했|느꼈)(?:다|었다|였다|는다)/;

/** [A] dialogue should stay 존댓말 (~요/~죠) for this character */
const CHAR_DIALOGUE_HONORIFIC_LEAK = /"[^"\n]{0,80}(?:했다\.|했어\.|하지\?|할게\.|거야\.)/g;

function stripDialogue(text: string): string {
  return text
    .replace(/"[^"]*"/g, "")
    .replace(/「[^」]*」/g, "")
    .replace(/\n+/g, " ");
}

function scanTurn(text: string): string[] {
  const hits: string[] = [];
  const narration = stripDialogue(text);
  if (!DADA_ENDING.test(narration)) {
    hits.push("narration: weak or missing -다체 해체 endings in non-dialogue prose");
  }
  if (EMOTION_LABEL.test(narration)) {
    const m = narration.match(EMOTION_LABEL);
    hits.push(`show-don't-tell: emotion label "${m?.[0]}"`);
  }
  for (const m of text.matchAll(CHAR_DIALOGUE_HONORIFIC_LEAK)) {
    hits.push(`speech-register: casual dialogue leak "${m[0].slice(0, 50)}"`);
  }
  return hits;
}

async function main() {
  const { buildCoreMasterPrompt } = await import("../src/lib/corePrompt");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const oldCore = buildCoreMasterPrompt({
    charName: CHAR,
    userName: PERSONA,
    charGender: "male",
    userGender: "other",
    nsfwEnabled: true,
    impersonationOn: false,
    completedTurns: 99,
    hasMindReading: false,
    allowsBeard: false,
    allowsBodyHair: true,
  });

  // Reconstruct pre-trim items for savings estimate
  const oldItems = oldCore
    .replace(
      `3. [SPEECH] [A] dialogue: see [USER PERSONA SPEECH] above.`,
      `3. [SPEECH] [A] dialogue ONLY: match creator examples/ending particles/honorifics EVERY turn. NO mixed honorifics/slang/memes. Does NOT apply to [B] — see [USER PERSONA SPEECH].`
    )
    .replace(
      `5. [PROSE] obey 해설형 서술 금지 (see [ADVANCED PROSE & NSFW GUIDELINES]).`,
      `5. [PROSE] Show emotion via gesture/gaze/sense and embodied reaction in complete sentences. NO blush/tremble/heartbeat spam, melodrama, same phrase 3×.`
    )
    .replace(
      "Obey [OUTPUT LANG] and [KOREAN_WEBNOVEL_STYLE]. Out-loud speech in \"…\" only. NO cinematic fragment lines.",
      "Strictly obey [OUTPUT LANG] and <KOREAN_WEBNOVEL_FORMAT>. Out-loud speech in \"…\" only. Narration in -다 style only. NO cinematic fragment lines."
    );

  console.log("── rule-core-master token savings (items 3/5/8 trim) ──");
  console.log(`before (reconstructed): ${estimateTokens(oldItems)} tok`);
  console.log(`after: ${estimateTokens(oldCore)} tok`);
  console.log(`saved: ${estimateTokens(oldItems) - estimateTokens(oldCore)} tok`);

  const chunks = parseCharacterSetting({
    characterId: "mock-core-trim",
    characterName: CHAR,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며. 평소 "~요", "~죠" 존댓말.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${CHAR}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  const history: { role: "user" | "assistant"; content: string }[] = [];
  let violations = 0;

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
      shortTermHistory: history,
      currentUserMessage: userMsg,
      nsfw: true,
      gender: "male",
      userPersonaGender: "other",
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 2500,
      completedTurns: i + 2,
      genres: ["현대/일상"],
      modelId: MODEL,
      provider: "openrouter",
      promptDumpSource: "audit",
      promptDumpDetail: `core-master-trim t=${i + 1}`,
    });

    console.log(`\n── Turn ${i + 1} ──`);
    const result = await callOpenRouterAdult(
      built.systemPrompt,
      [{ role: "user", content: userMsg }],
      MODEL,
      2500,
      { charName: CHAR },
      { chargeTurnBudget: false, requestKind: `core-master-trim-${i + 1}` }
    );

    const hits = scanTurn(result.text);
    if (hits.length > 0) {
      violations += hits.length;
      console.log("CHECK:", hits);
    } else {
      console.log("OK — -다체 narration, no emotion-label spam, dialogue register OK");
    }
    console.log(`output chars: ${result.text.length}`);

    history.push({ role: "user", content: userMsg });
    history.push({ role: "assistant", content: result.text });
  }

  console.log("\n── Summary ──");
  console.log(`turns: ${USER_MSGS.length} · check hits: ${violations}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
