/**
 * KOREAN_WEBNOVEL_STYLE trim regression — 해체, ellipsis, fragments, dialogue, density.
 * Usage: npx.cmd tsx scripts/audit-korean-webnovel-style-trim.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = process.env.KWN_STYLE_AUDIT_MODEL ?? "qwen/qwen3.7-max";
const PERSONA = "렌";
const CHAR = "백하율";

const USER_MSGS = [
  "알았어 손만 잡아주면 되지? 일어나봐.",
  "…무서워. 천천히만 해줘.",
  "밤산책 같이 갈래?",
  "그래, 같이 가자. 오늘 밤은 좀 이상해.",
  "…다 알아요, 내 몸이 원하는 거 알아?",
];

const NOUN_FRAGMENT = /(?:^|\n)[가-힣]{1,4}\.\s*$/m;
const EXCESS_ELLIPSIS = /\.{6,}/;
const MANY_ELLIPSIS = (text: string) => (text.match(/\.\.\./g) ?? []).length > 3;
const HONORIFIC_NARRATION = /(?<!["「][^"\n]{0,200})[가-힣]{4,}(?:습니다|입니다|해요|돼요|거예요)(?![^"\n]*["」])/;

/** Split dialogue across quote + narration + quote */
const DIALOGUE_FRAGMENTED = /"[^"]{0,40}"\s*[^\n"]{5,40}\s*"/;

function stripDialogue(text: string): string {
  return text.replace(/"[^"]*"/g, "").replace(/「[^」]*」/g, "");
}

function scanTurn(text: string): string[] {
  const hits: string[] = [];
  const narration = stripDialogue(text);

  if (!/(했다|였다|났다|갔다|돌았다|멈췄다|스쳤다|닿았다|번졌|감쌌|비쳤|떨렸|맞았)/.test(narration)) {
    hits.push("dada: weak 해체 endings in narration");
  }
  if (HONORIFIC_NARRATION.test(narration)) {
    hits.push("dada: ~습니다/~요 in narration");
  }
  if (NOUN_FRAGMENT.test(text)) {
    hits.push("fragment: noun-only line");
  }
  if (EXCESS_ELLIPSIS.test(text)) {
    hits.push("ellipsis: 6+ dots");
  }
  if (MANY_ELLIPSIS(text)) {
    hits.push("ellipsis: more than 3 ... in turn");
  }
  if (DIALOGUE_FRAGMENTED.test(text)) {
    hits.push("dialogue: split across quote breaks");
  }
  if (text.length < 1200) {
    hits.push(`density: output short (${text.length} chars) — check expansion`);
  }
  return hits;
}

async function main() {
  const { KOREAN_WEBNOVEL_STYLE, DYNAMIC_PROSE_STYLING_BLOCK } = await import("../src/lib/writingStylePreset");
  const { estimateTokens } = await import("../src/lib/tokenEstimate");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const oldStyle = `[KOREAN_WEBNOVEL_STYLE]

Writing principles:
- Natural Korean webnovel prose.
- Narration body: 해체(-다/-했다/-이었다) only — forbid ~습니다 / ~입니다 / ~요 in narration.
- No translationese or excessive comma chaining.
- Dense but readable paragraphs — avoid cinematic pause-heavy formatting.
- Avoid excessive ellipsis (...), silence beats, and one-line paragraphs.
- Emotional scenes may become more introspective; action scenes faster and more concise.
- Adapt pacing automatically from scene context.

Layout:
- Group 2–8 connected narration sentences per paragraph (50+ chars, typically 80–550 chars).
- Dialogue "…" in separate paragraphs from narration — never embed in the same block.
- Each quoted block = one complete utterance or thought — do NOT split one sentence across quote + narration + quote.
- Dialogue-heavy scenes: prefer **narration blocks** (2–8 sentences) before/after speech — NOT a thin 1–2 sentence bridge between every quote pair.
- Forbid noun-fragment lines ("숨." / "시선.") and one-action-one-line RP layouts.
- Ellipsis: ... allowed; ...... forbidden; max ~3 per turn in narration.
- Scene or time shift only — then start a new narration paragraph.

${DYNAMIC_PROSE_STYLING_BLOCK}`;

  console.log("── KOREAN_WEBNOVEL_STYLE token savings ──");
  console.log(`before: ${estimateTokens(oldStyle)} tok · ${oldStyle.length} chars`);
  console.log(`after: ${estimateTokens(KOREAN_WEBNOVEL_STYLE)} tok · ${KOREAN_WEBNOVEL_STYLE.length} chars`);
  console.log(`saved: ${estimateTokens(oldStyle) - estimateTokens(KOREAN_WEBNOVEL_STYLE)} tok`);

  const chunks = parseCharacterSetting({
    characterId: "mock-kwn",
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
      shortTermHistory: history,
      currentUserMessage: userMsg,
      nsfw: true,
      gender: "male",
      userPersonaGender: "other",
      userImpersonation: false,
      novelModeEnabled: false,
      targetResponseChars: 2500,
      completedTurns: i + 3,
      genres: ["현대/일상"],
      modelId: MODEL,
      provider: "openrouter",
      promptDumpSource: "audit",
      promptDumpDetail: `kwn-style-trim t=${i + 1}`,
    });

    console.log(`\n── Turn ${i + 1} ──`);
    const result = await callOpenRouterAdult(
      built.systemPrompt,
      [{ role: "user", content: userMsg }],
      MODEL,
      2500,
      { charName: CHAR },
      { chargeTurnBudget: false, requestKind: `kwn-style-${i + 1}` }
    );

    const hits = scanTurn(result.text);
    if (hits.length > 0) {
      issues += hits.length;
      console.log("CHECK:", hits);
    } else {
      console.log("OK — 해체, ellipsis, fragments, dialogue, density");
    }
    console.log(`output chars: ${result.text.length}`);

    history.push({ role: "user", content: userMsg });
    history.push({ role: "assistant", content: result.text });
  }

  console.log("\n── Summary ──");
  console.log(`turns: ${USER_MSGS.length} · check hits: ${issues}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
