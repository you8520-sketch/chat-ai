/**
 * Godmodding regression — 3–5 turns, check [B]/persona voluntary dialogue/actions.
 * Usage: npx.cmd tsx scripts/audit-godmodding-regression.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = process.env.GODMODDING_AUDIT_MODEL ?? "qwen/qwen3.7-max";
const PERSONA = "렌";
const CHAR = "백하율";

const USER_MSGS = [
  "…다 알아요, 내 몸이 원하는 거 알아? 넌 나만 보면 돼.",
  "천천히 해줘. 무서워.",
  "그래, 같이 가자.",
];

/** Voluntary [B] dialogue (quoted speech attributed to persona) */
const VOLUNTARY_DIALOGUE = new RegExp(
  `(?:${PERSONA}|렌)(?:이|은|는|의)?[^\\n.]{0,20}[""「].{4,}`,
  "g"
);
/** Voluntary deliberate action */
const VOLUNTARY_ACTION = new RegExp(
  `(?:${PERSONA}|렌)(?:이|은|는)\\s+(?:고개를|말을|손을|걸음을|결심|고개|입을|몸을).{0,30}(?:했다|였다|냈다|말했다|외쳤|돌아|내밀|끄덕|받아|잡아|움직|일어나|달려|뛰어)`,
  "g"
);
/** Emotional interior for [B] */
const EMOTION_THOUGHT = new RegExp(
  `(?:${PERSONA}|렌)(?:이|은|는)\\s+(?:두려|설레|기뻐|슬퍼|화가|당황|불안|원하|느꼈|생각했|결심했)`,
  "g"
);

function scanViolations(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(VOLUNTARY_DIALOGUE)) hits.push(`dialogue: ${m[0].slice(0, 60)}`);
  for (const m of text.matchAll(VOLUNTARY_ACTION)) hits.push(`action: ${m[0].slice(0, 60)}`);
  for (const m of text.matchAll(EMOTION_THOUGHT)) hits.push(`emotion: ${m[0].slice(0, 60)}`);
  return hits;
}

async function main() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { buildNoGodmoddingBlock } = await import("../src/lib/noGodmodding");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");

  const oldBlock = `[NO GODMODDING]
Play only [A].
[USER AGENCY & SENSORY FEEDBACK RULE]
([A] = AI character you play · [B] = user's persona character)

FORBIDDEN — Never write these for [B]:
- Voluntary dialogue or speech
- Deliberate actions or decisions
- Internal emotions or thoughts
  ("두려웠다" "설렜다" "원한다고 느꼈다")

ALLOWED — Write these for [B] (involuntary physiological responses only):
- SFW: 굳어버리는 몸, 손목의 반동, 피부에 닿는 냉기, 숨이 막히는 압박감
- NSFW: 맥박의 떨림, 돋아나는 소름, 가빠지는 호흡, 반사적인 움찔거림, 체온 변화, 피부 위로 번지는 열기
- Physical responses to [A]'s actions — NOT emotional interpretation

BOUNDARY:
Physiological = involuntary body response ✅
Emotional = internal feeling/thought ❌

Examples:
✅ "[B]의 손가락이 반사적으로 경직됐다"
❌ "[B]는 두려움을 느꼈다"

Apply to SFW and NSFW alike.
User keeps narrative agency. Turn-end handoff: obey <TURN_HANDOFF_AND_PACING> only.`;

  const newBlock = buildNoGodmoddingBlock(CHAR, PERSONA, "standard");
  console.log("── Token savings (no-godmodding block only) ──");
  console.log(`old: ${estimateTokens(oldBlock)} tok · ${oldBlock.length} chars`);
  console.log(`new: ${estimateTokens(newBlock)} tok · ${newBlock.length} chars`);
  console.log(`saved: ${estimateTokens(oldBlock) - estimateTokens(newBlock)} tok`);

  const chunks = parseCharacterSetting({
    characterId: "mock-godmod",
    characterName: CHAR,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${CHAR}: …`,
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
      memoryMeta: formatMemoryMetaForPrompt(
        parseMemoryMeta(JSON.stringify({ affection: 60, trust: 55 }))
      ),
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
      promptDumpDetail: `godmodding-regression t=${i + 1}`,
    });

    console.log(`\n── Turn ${i + 1} ──`);
    const result = await callOpenRouterAdult(
      built.systemPrompt,
      [{ role: "user", content: userMsg }],
      MODEL,
      2500,
      { charName: CHAR },
      { chargeTurnBudget: false, requestKind: `godmod-regression-${i + 1}` }
    );

    const hits = scanViolations(result.text);
    if (hits.length > 0) {
      violations += hits.length;
      console.log("VIOLATIONS:", hits);
    } else {
      console.log("OK — no voluntary [B] dialogue/action/emotion patterns");
    }
    console.log(`output chars: ${result.text.length}`);

    history.push({ role: "user", content: userMsg });
    history.push({ role: "assistant", content: result.text });
  }

  console.log("\n── Summary ──");
  console.log(`turns: ${USER_MSGS.length} · violation hits: ${violations}`);
  if (violations > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
