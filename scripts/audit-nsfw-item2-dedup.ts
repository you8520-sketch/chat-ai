/**
 * Phase 2 item-2 dedup regression — directness (item 1), anti-OOC (item 3), Mode B density.
 * Usage: npx.cmd tsx scripts/audit-nsfw-item2-dedup.ts
 */
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL = process.env.NSFW_ITEM2_AUDIT_MODEL ?? "qwen/qwen3.7-max";
const PERSONA = "렌";
const CHAR = "백하율";

const USER_MSGS = [
  "알았어 손만 잡아주면 되지? 일어나봐.",
  "…무서워. 천천히만 해줘.",
  "…다 알아요, 내 몸이 원하는 거 알아?",
  "옷… 벗어도 돼? 너무 뜨거워…",
  "…응, 더 깊게. 안에서 움직일 때마다 숨이 막혀… 멈추지 마.",
];

const ANATOMY_DIRECT =
  /(?:성기|음경|귀두|질|내벽|항문|유두|클리|보지|자지|마찰|삽입|관통|젖꼭지)/;
const EUPHEMISM_ONLY = /(?:그곳|그 부위|아래|사적인 곳)/;
const OOC_SUBMISSIVE = /(?:주인님|완전히 굴복|무조건 따를|천박하게|야한 걸 원해)/;
/** 백하율 banmal character — sudden excessive 존댓말 in [A] dialogue */
const CHAR_DIALOGUE_HONORIFIC = /"[^"\n]{0,80}(?:했습니다|할게요|거예요|해요|돼요)"/;

function scanTurn(text: string, turn: number): string[] {
  const hits: string[] = [];
  const explicitTurn = turn >= 3;

  if (explicitTurn && !ANATOMY_DIRECT.test(text)) {
    hits.push("item1: no anatomical/direct terms in explicit turn");
  }
  if (explicitTurn && EUPHEMISM_ONLY.test(text) && !ANATOMY_DIRECT.test(text)) {
    hits.push("item1: euphemism-only ('그곳' etc.) without anatomy");
  }
  if (OOC_SUBMISSIVE.test(text)) {
    hits.push("item3: OOC submissive/melodrama pattern");
  }
  if (CHAR_DIALOGUE_HONORIFIC.test(text)) {
    hits.push("item3: [A] dialogue honorific leak");
  }
  if (text.length < 1000 && turn >= 4) {
    hits.push(`modeB: short output (${text.length} chars) on late turn`);
  }
  return hits;
}

async function main() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const chunks = parseCharacterSetting({
    characterId: "mock-nsfw-item2",
    characterName: CHAR,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며. 평소 반말·낮은 톤.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${CHAR}: …필요하면.`,
    statusWindowPrompt: "",
  });

  const history: { role: "user" | "assistant"; content: string }[] = [];
  let issues = 0;

  console.log(`model: ${MODEL} · 5 NSFW turns`);

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
      promptDumpDetail: `nsfw-item2-dedup t=${i + 1}`,
    });

    console.log(`\n── Turn ${i + 1} ──`);
    const result = await callOpenRouterAdult(
      built.systemPrompt,
      [{ role: "user", content: userMsg }],
      MODEL,
      2500,
      { charName: CHAR },
      { chargeTurnBudget: false, requestKind: `nsfw-item2-${i + 1}` }
    );

    const hits = scanTurn(result.text, i + 1);
    if (hits.length > 0) {
      issues += hits.length;
      console.log("CHECK:", hits);
    } else {
      console.log("OK — item1 directness, item3 anti-OOC, modeB length");
    }
    console.log(`chars: ${result.text.length} · anatomy: ${ANATOMY_DIRECT.test(result.text)}`);

    history.push({ role: "user", content: userMsg });
    history.push({ role: "assistant", content: result.text });
  }

  console.log(`\n── Summary ── turns: 5 · check hits: ${issues}`);
  if (issues > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
