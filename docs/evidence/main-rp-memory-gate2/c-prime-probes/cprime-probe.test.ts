/**
 * C' feasibility probes (scratch evidence, provider-free, isolated DB).
 * Drives the real current-main owners: isRollingSummaryGroundedInDialogue,
 * resolveMemorySourceAuthority, processRollingSummaryBatch (fixed summarizer replay),
 * buildMemoryContextForChat, updateMemoryRecordById, rebuildLorebookFromRecords,
 * emergencyFallbackTrimLorebookSync.
 */
import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import { after, before, it } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { buildMemoryContextForChat } from "./memory-manager";
import {
  __formatBatchDialogueForTests,
  __setSummarizeTurnBatchCallerForTests,
  isRollingSummaryInFlight,
  processRollingSummaryBatch,
} from "./memory-rolling-summary";
import { isRollingSummaryGroundedInDialogue, validateSummaryNarrative } from "./memory-summary-integrity";
import { resolveMemorySourceAuthority, sourcesFromUserText } from "./memory-source-authority";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import {
  listMemoryRecordsForChat,
  rebuildLorebookFromRecords,
  updateMemoryRecordById,
} from "./memory-turn-summary";
import { emergencyFallbackTrimLorebookSync } from "./memory-global-projection";

const OUT_DIR = process.env.AB_OUT ?? "/tmp/cprime-out";
const PERSONA = "이름/호칭: 렌\n성격: 조용함";
const CHAR_NAME = "라이크";
const LINE = "솔직히 너 좀 아마추어 같아.";
const REACTION = "라이크는 입술을 깨물며 시선을 피했다.";

const USER_BY_TURN: Record<number, string> = {
  1: LINE,
  2: "내일까지 검을 갈아다 줄게. 약속이야.",
  10: "좋아, 우리 오늘부터 연인하자.",
  15: "그 약속은 취소할게. 검은 내가 직접 갈게.",
  20: "문 쪽을 바라본다.",
  24: "시장에 다녀왔어.",
  30: "커피를 마셨어.",
  33: "라이크와 함께 걷는다.",
  40: "미안, 우리 그만 헤어지자.",
};
const ASSISTANT_BY_TURN: Record<number, string> = {
  1: `${REACTION} "…그래, 아직 부족하긴 하지."`,
  2: "라이크는 고개를 끄덕이며 작게 웃었다.",
  10: "라이크는 놀란 얼굴로 한참 말이 없다가 손을 맞잡았다.",
  15: "라이크는 아쉬운 듯 어깨를 으쓱했다.",
  20: "서린이 문을 열고 들어왔다. 그녀는 라이크에게 목례했다.",
  24: '라이크는 고개를 끄덕였다. "누나가 시장에서 널 알아봤대. 예전부터 알던 사이라더라."',
  30: "라이크는 말없이 커피를 저었다.",
  33: "렌은 라이크의 손을 잡고 걸음을 옮겼다.",
  40: "라이크는 말없이 시선을 떨궜다.",
};
const userText = (t: number) => USER_BY_TURN[t] ?? `오늘의 잡담 ${t}`;
const assistantText = (t: number) => ASSISTANT_BY_TURN[t] ?? `라이크는 ${t}번째 장작을 쌓았다.`;

function dialogueFor(start: number, end: number): string {
  const entries = [];
  for (let t = start; t <= end; t++) {
    entries.push({ turnIndex: t, turn: { user: userText(t), assistant: assistantText(t) } as never });
  }
  return __formatBatchDialogueForTests(entries as never, CHAR_NAME);
}

type Case = {
  id: string;
  batch: [number, number];
  summary: string;
  mustPass: boolean;
  note: string;
};

const CASES: Case[] = [
  { id: "F1_fake_lifelong_promise", batch: [1, 5], mustPass: false,
    summary: "라이크가 렌에게 평생 지키겠다고 약속했고 렌은 그 약속을 받아들였다. 렌이 아마추어 같다고 하자 라이크는 입술을 깨물었다.",
    note: "promise not in source (generated-summary fabrication)" },
  { id: "F1b_fake_promise_short_form", batch: [1, 5], mustPass: false,
    summary: "라이크는 렌에게 평생 곁에서 지켜 주겠다고 맹세했다. 렌이 솔직히 아마추어 같다고 했고 라이크는 시선을 피했다.",
    note: "same fabrication, different wording" },
  { id: "F2_fake_sister_familiarity_objective", batch: [21, 25], mustPass: false,
    summary: "렌은 라이크의 누나와 예전부터 알던 사이였고 시장에서 서로 알아보았다.",
    note: "sister familiarity stated as objective shared history" },
  { id: "F2b_sister_attributed_character_claim", batch: [21, 25], mustPass: true,
    summary: "라이크는 누나가 시장에서 렌을 알아봤다고 말했다.",
    note: "attributed CHARACTER_CLAIM must stay allowed" },
  { id: "F2c_sister_familiarity_variant", batch: [21, 25], mustPass: false,
    summary: "렌은 라이크의 누나와 오래전부터 알고 지낸 친구 사이다. 누나는 렌을 시장에서 반갑게 맞았다.",
    note: "sister familiarity variant wording" },
  { id: "F3_wrong_speaker_amateur", batch: [1, 5], mustPass: false,
    summary: "라이크가 렌에게 솔직히 아마추어 같다고 말했고 렌은 입술을 깨물며 시선을 피했다.",
    note: "speaker inverted: source = user said it to the character" },
  { id: "F4_kiss_from_coffee", batch: [26, 30], mustPass: false,
    summary: "렌과 라이크는 커피를 마시다 입을 맞췄고 둘의 사이는 한층 가까워졌다.",
    note: "kiss invented from a coffee utterance" },
  { id: "F4b_hug_from_coffee", batch: [26, 30], mustPass: false,
    summary: "렌이 커피를 마시자 라이크는 렌을 끌어안았고 렌은 그에게 기대어 울었다.",
    note: "physical action invented (user-owned action)" },
  { id: "L1_legit_npc_door", batch: [16, 20], mustPass: true,
    summary: "서린이 문을 열고 들어와 라이크에게 목례했다. 렌은 문 쪽을 바라보았다.",
    note: "legitimate NPC action" },
  { id: "L2_user_relationship_declaration", batch: [6, 10], mustPass: true,
    summary: "렌이 라이크에게 오늘부터 연인하자고 말했고 라이크는 놀라 한참 말이 없다가 손을 맞잡았다.",
    note: "user-direct relationship declaration" },
  { id: "L3_user_breakup_declaration", batch: [36, 40], mustPass: true,
    summary: "렌이 미안하다며 그만 헤어지자고 말했고 라이크는 말없이 시선을 떨궜다.",
    note: "user-direct relationship change" },
  { id: "L4_true_quote_and_reaction", batch: [1, 5], mustPass: true,
    summary: "렌이 라이크에게 솔직히 너 좀 아마추어 같다고 말하자 라이크는 입술을 깨물며 시선을 피했고 아직 부족하긴 하다고 답했다.",
    note: "exact line + lip-bite reaction" },
  { id: "L5_emotion_interpretation", batch: [1, 5], mustPass: true,
    summary: "렌이 아마추어 같다고 하자 라이크는 상처받은 듯 시선을 피했다. 이후 검술에 대한 자존심이 흔들렸을 가능성이 있다.",
    note: "emotional interpretation grounded in an observed action" },
  { id: "L6_character_backstory", batch: [1, 5], mustPass: true,
    summary: "라이크는 어릴 때 스승에게 검을 배운 견습 검사로, 렌의 말에 입술을 깨물며 시선을 피했다.",
    note: "character-authored personal past (not a user tie)" },
];

const PAD = " 둘은 오늘의 잡담을 나누며 장작을 쌓았다.";
for (const c of CASES) {
  while (c.summary.length < 90) c.summary += PAD;
}

const results: Record<string, unknown> = {};
let USER = 961001;
let CHAR = 961003;
let CHAT = 961002;

before(() => {
  installIsolatedTestDatabase();
  process.env.MEMORY_FEATURE_ENABLED = "1";
});
after(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/cprime-probe-results.json`, JSON.stringify(results, null, 2));
  uninstallIsolatedTestDatabase();
});

const PERSONA_VARIANTS: Record<string, string | undefined> = {
  formatted_name_line: PERSONA,
  bare_name_as_passed_by_chat_route: "렌",
  none: undefined,
};

it("PROBE-V: summary validators vs fabricated and legitimate summaries", () => {
  const out: Record<string, unknown[]> = {};
  for (const [variant, persona] of Object.entries(PERSONA_VARIANTS)) {
    out[variant] = CASES.map((c) => {
      const dialogue = dialogueFor(c.batch[0], c.batch[1]);
      const narrative = validateSummaryNarrative(c.summary, "main_canon");
      const grounded = isRollingSummaryGroundedInDialogue(c.summary, dialogue, persona, CHAR_NAME);
      const userOnly = dialogue
        .split("\n")
        .filter((l) => l.startsWith("유저:"))
        .map((l) => l.replace(/^유저:\s*/, ""))
        .join("\n");
      const authority = resolveMemorySourceAuthority(c.summary, {
        sources: sourcesFromUserText(userOnly),
        personaName: persona ? (persona.match(/(?:^|\n)이름\/호칭:\s*([^\n]+)/)?.[1]?.trim() ?? null) : null,
        charName: CHAR_NAME,
      }).kind;
      const accepted = narrative.ok && grounded;
      return {
        id: c.id,
        batch: c.batch,
        expected: c.mustPass ? "ACCEPT" : "REJECT",
        narrativeOk: narrative.ok,
        grounded,
        authorityKind: authority,
        verdict: accepted ? "ACCEPTED_AT_SEAL" : "REJECTED_AT_SEAL",
        correct: accepted === c.mustPass,
        note: c.note,
        summary: c.summary,
      };
    });
  }
  results.validatorProbe = out;
});

function seedStatic(chatId: number, userId: number, charId: number) {
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(userId, `cp-${userId}@test.local`, "렌", "x");
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, CHAR_NAME);
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(chatId, userId, charId);
  getOrCreateChatMemory(chatId, userId, charId, "pro");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(chatId, "assistant", "인사.", "greeting");
}
function insertTurn(chatId: number, turn: number) {
  const db = getDb();
  const uid = Number(
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(chatId, "user", userText(turn), "user").lastInsertRowid
  );
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model, user_message_id, generation_status) VALUES (?,?,?,?,?,'completed')`
  ).run(chatId, "assistant", assistantText(turn), "test", uid);
}
function extractiveFake(userContent: string): string {
  const lines = [...userContent.matchAll(/^유저:\s*(.+)$/gm)].map((m) => m[1]!.trim());
  let text = lines.join(" ");
  if (text.length < 80) text = `${text} ${text}`.trim();
  return text;
}

it("PROBE-P/E: passing fabricated summary propagates to [현재기억]; user edit renders identically", async () => {
  const chatId = CHAT + 10;
  const userId = USER + 10;
  const charId = CHAR + 10;
  seedStatic(chatId, userId, charId);
  const fabricated: Record<string, string> = {
    "1": "라이크는 렌에게 평생 지키겠다고 약속했다. 렌이 솔직히 아마추어 같다고 하자 라이크는 입술을 깨물며 시선을 피했다." + PAD,
    "21": "렌은 라이크의 누나와 예전부터 알던 사이였다. 시장에서 서로 알아보았다." + PAD + PAD,
  };
  const seenAttempts: Record<string, number> = {};
  __setSummarizeTurnBatchCallerForTests(async (_s, history) => {
    const content = history.map((m) => m.content).join("\n");
    const start = content.match(/\[(\d+)~\d+턴 원본 대화\]/)?.[1] ?? "?";
    seenAttempts[start] = (seenAttempts[start] ?? 0) + 1;
    if (fabricated[start]) return { text: fabricated[start]! };
    return { text: extractiveFake(content) };
  });
  for (let t = 1; t <= 80; t++) insertTurn(chatId, t);
  updateChatMemory(chatId, userId, charId, { message_count: 80, membership_tier: "pro" } as never);
  const frontierMsg = Number(
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`)
      .run(chatId, "user", "다음 입력").lastInsertRowid
  );
  let sealed = 0;
  for (let round = 0; round < 20; round++) {
    const ok = await processRollingSummaryBatch({
      chatId, userId, characterId: charId, charName: CHAR_NAME, tier: "pro", memoryCapacity: MEMORY_CAPACITY_FIXED,
      userPersona: "렌",
    } as never);
    if (!ok) break;
    sealed += 1;
  }
  getDb().prepare("DELETE FROM messages WHERE id=?").run(frontierMsg);
  void isRollingSummaryInFlight;

  const records = listMemoryRecordsForChat(chatId).filter((r) => !r.inactive);
  const byStart = Object.fromEntries(records.map((r) => [r.turnStart, { kind: r.summaryKind, userEdited: r.userEdited, summary: r.summary }]));
  const mem = await buildMemoryContextForChat({
    chatId, userId, characterId: charId, tier: "pro", memoryCapacity: MEMORY_CAPACITY_FIXED,
    userMessage: "저녁은 뭐 먹을까?", excludeSummaryTurnStartGte: 77, modelId: "deepseek-v4.1-flash", provider: "cheaperinference",
  } as never);
  const lorebookBefore = rebuildLorebookFromRecords(chatId, { excludeTurnStartGte: 77 });
  const first = records.find((r) => r.turnStart === 1) ?? records[0]!;
  const userAuthored = ("라이크는 렌에게 평생 지키겠다고 직접 약속했다. 렌은 그 약속을 소중히 여긴다." + PAD).padEnd(100, "가");
  const edited = updateMemoryRecordById(chatId, first.id, userAuthored);
  const lorebookAfter = rebuildLorebookFromRecords(chatId, { excludeTurnStartGte: 77 });
  const rowAfter = getDb()
    .prepare(`SELECT summary_kind, user_edited, scope_payload FROM chat_turn_summaries WHERE id=?`)
    .get(first.id);
  results.pipelineProbe = {
    sealed,
    attemptsByBatchStart: seenAttempts,
    batch1_persistedSummary: byStart[1],
    batch21_persistedSummary: byStart[21],
    currentMemoryContains_F1_promise: mem.text.includes("평생 지키겠다고 약속했다"),
    currentMemoryContains_F2_sister: mem.text.includes("누나와 예전부터 알던 사이"),
    currentMemoryHeader: mem.text.split("\n").slice(0, 2).join(" | "),
    currentMemoryFirstBlock: mem.text.split("\n\n").slice(1, 3),
    scopePayloadOfLlmRecord: getDb()
      .prepare(`SELECT scope_payload FROM chat_turn_summaries WHERE chat_id=? AND turn_number=1`)
      .get(chatId),
    userEdit: {
      accepted: Boolean(edited),
      rowAfter,
      renderedBlockBefore: lorebookBefore.split("\n\n")[0],
      renderedBlockAfter: lorebookAfter.split("\n\n")[0],
      renderedDistinguishable: lorebookAfter.split("\n\n")[0]!.includes("[사용자") || lorebookAfter.split("\n\n")[0]!.includes("직접 작성"),
    },
  };
});

it("PROBE-C: 10k budget arithmetic and non-LLM emergency trim keeps newest, drops oldest", () => {
  const rows: Record<string, unknown>[] = [];
  for (const avg of [250, 350, 450, 600]) {
    const header = "[1~5턴] ".length + 2;
    rows.push({ avgSummaryChars: avg, perBatchChars: avg + header, turnsUntil10kReached: Math.round((MEMORY_CAPACITY_FIXED / (avg + header)) * 5) });
  }
  const blocks: string[] = [];
  for (let b = 0; b < 24; b++) {
    const s = b * 5 + 1;
    const body = `${b === 0 ? "렌이 솔직히 아마추어 같다고 말했고 라이크는 입술을 깨물며 시선을 피했다. " : ""}`.padEnd(40, "가").padEnd(560, "나");
    blocks.push(`[${s}~${s + 4}턴] ${body}`);
  }
  const text = blocks.join("\n\n");
  const trimmed = emergencyFallbackTrimLorebookSync(text, MEMORY_CAPACITY_FIXED);
  const survivingHeaders = [...trimmed.matchAll(/\[(\d+)~(\d+)턴\]/g)].map((m) => `${m[1]}~${m[2]}`);
  results.compactionProbe = {
    budgetRows: rows,
    inputChars: text.length,
    trimmedChars: trimmed.length,
    firstSurvivingBlock: survivingHeaders[0],
    survivingBlockCount: survivingHeaders.length,
    oldestBlockSurvives: trimmed.includes("아마추어"),
  };
});
