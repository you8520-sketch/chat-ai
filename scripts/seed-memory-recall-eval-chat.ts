/**
 * Local-only synthetic fixture for the Memory v2 promise-recall comparison (no provider calls).
 * Builds an 79-turn chat where T10 makes a promise and T20 cancels it, the current ledger holds
 * only a later promise, and the user-curated Global memory does not mention the cancelled promise.
 *
 * Usage: DATA_DIR=<dir> tsx scripts/seed-memory-recall-eval-chat.ts
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

const CHAT_ID = Number(process.env.EVAL_CHAT_ID ?? 99201);
const USER_ID = Number(process.env.EVAL_USER_ID ?? 99102);
const CHAR_ID = Number(process.env.EVAL_CHARACTER_ID ?? 2);
const NAMES = { charName: "히유", userName: "데모유저" };
const PROMISE = { text: "금요일 저녁 한강에서 같이 야경을 보기로 했다.", deadline: "금요일" };
const LIBRARY_PROMISE = {
  text: "다음 주 토요일 도서관 앞에서 빌린 책을 돌려주기로 했다.",
  deadline: "다음 주 토요일",
};

const FILLER_USER = [
  "오늘도 삼각김밥 하나 주세요.",
  "늦게까지 일하느라 힘들죠? 이거 마셔요.",
  "시험 기간이라 잠을 못 잤어요.",
  "비 오는 날 편의점 불빛이 좋네요.",
  "오늘은 어떤 신상이 들어왔어요?",
];
const FILLER_ASSISTANT = [
  "히유는 계산대 너머로 작게 웃으며 삼각김밥을 스캔했다. \"오늘도 참치마요죠? 기억하고 있어요.\"",
  "히유는 건네받은 음료를 두 손으로 감싸 쥐었다. \"고마워요. 덕분에 남은 두 시간은 버틸 수 있겠어요.\"",
  "히유는 걱정스러운 눈으로 당신을 올려다보았다. \"무리하지 마요. 저도 시험 때는 편의점에서 졸았어요.\"",
  "히유는 유리창에 번지는 빗방울을 한참 바라보다 말했다. \"이 시간이 제일 좋아요. 손님이 없어서요.\"",
  "히유는 진열대를 가리키며 눈을 반짝였다. \"오늘은 딸기 샌드위치가 들어왔어요. 제가 먼저 골랐다는 건 비밀이에요.\"",
];

const BATCH_SUMMARIES: Record<number, string> = {
  1: "편의점 단골이 된 주인공과 알바생 히유가 매일 밤 짧은 인사를 나누기 시작했다. 히유는 수줍어하면서도 주인공의 메뉴를 기억해 두었다.",
  6: "주인공이 금요일 저녁 한강에서 같이 야경을 보자고 제안했고 히유가 수줍게 그러자고 했다. 두 사람은 금요일 야경 약속을 정했다.",
  11: "시험 기간의 주인공을 히유가 걱정하며 간식을 챙겨 주었다. 히유는 주인공이 오는 시간을 기다리게 되었다고 털어놓았다.",
  16: "주인공이 사정이 생겨 금요일 야경 약속을 없던 걸로 하자고 말했다. 히유는 애써 담담하게 웃어 보였지만 잠시 말이 없었다.",
  21: "취소 이후 어색해진 분위기를 히유가 먼저 풀었다. 주인공은 다음 기회를 말하지 못한 채 편의점을 나섰다.",
  26: "비 오는 밤 히유가 우산을 빌려주며 서로의 사정을 조금씩 이야기했다. 히유는 대학 과제와 알바를 병행 중이다.",
  31: "주인공이 히유에게 빌린 책 이야기를 꺼냈고 두 사람은 책 취향이 비슷하다는 걸 알게 되었다.",
  36: "주인공이 다음 주 토요일 도서관 앞에서 책을 돌려주기로 히유와 약속했다. 히유는 그날을 기대한다고 했다.",
  41: "히유가 야간 근무 중 졸음을 참는 모습을 주인공이 도왔다. 두 사람 사이에 사소한 농담이 늘었다.",
  46: "주인공이 청동열쇠를 히유에게 맡겼다. 히유는 열쇠를 소중히 보관하겠다고 말했다.",
  51: "편의점 점장이 히유의 근무 시간을 바꾸려 해 히유가 고민했다. 주인공은 조용히 곁에서 이야기를 들어주었다.",
  56: "히유가 처음으로 자기 꿈에 대해 이야기했다. 주인공은 응원한다고 답했다.",
  61: "히유가 주인공을 위해 신상 샌드위치를 따로 챙겨 두었다. 두 사람은 편의점 앞 벤치에서 잠시 쉬었다.",
  66: "비가 그친 새벽 히유가 근무를 마치고 주인공과 함께 걸었다. 둘은 말없이 가로등 길을 걸었다.",
  71: "히유는 주인공을 신뢰하기 시작했고 마음을 조금씩 열었다. 서로 사소한 선물을 주고받으며 가까워졌다.",
};

const MANUAL_GLOBAL =
  "[직접 정리한 장기기억] 주인공은 히유가 일하는 편의점의 단골이다. 히유는 21살 대학생이며 밝고 수줍음이 많다. " +
  "두 사람은 매일 밤 짧은 대화를 나누며 천천히 가까워졌고, 히유는 주인공을 신뢰하기 시작했다. " +
  "주인공은 청동열쇠를 히유에게 맡겼고 히유가 보관 중이다. 히유는 대학 과제와 알바를 병행하며 자기 꿈에 대해서도 이야기했다.";

const RAW_TURNS: { user: string; assistant: string }[] = [
  {
    user: "오늘 근무 끝나면 같이 편의점 앞 벤치에 앉아도 돼요?",
    assistant:
      "히유는 정리하던 컵라면 진열대에서 손을 떼고 당신을 돌아보았다. 형광등 불빛 아래에서도 귓가가 붉어진 게 보였다. \"벤치요? 그럼요. 근무 교대는 새벽 한 시니까… 조금만 기다려 줄래요?\" 그녀는 말끝을 흐리며 앞치마 끈을 괜히 한 번 고쳐 맸다.",
  },
  {
    user: "기다릴게요. 그동안 여기서 책이나 읽고 있을게요.",
    assistant:
      "히유는 카운터 아래에서 작은 담요를 꺼내 계산대 옆 의자에 올려놓았다. \"밤에는 좀 추워요. 이거 덮고 있어요.\" 그녀는 말하고 나서야 자신이 너무 자연스럽게 챙겼다는 걸 깨달았는지 헛기침을 했다. 자동문이 열릴 때마다 찬 바람이 들어왔고, 그때마다 히유의 시선이 슬쩍 당신 쪽을 향했다.",
  },
  {
    user: "담요 따뜻하네요. 히유 씨는 쉬는 날엔 뭐 해요?",
    assistant:
      "히유는 재고 목록을 확인하던 손을 멈추고 잠시 생각에 잠겼다. \"쉬는 날이요? 대부분 밀린 과제 하고, 잠자고… 가끔 혼자 강변 걷기도 해요.\" 말해 놓고 그녀는 작게 웃었다. \"재미없죠. 대학생 알바의 휴일이라는 게 원래 그래요.\" 그 목소리에는 변명보다 조금의 기대가 섞여 있었다.",
  },
  {
    user: "강변 좋아하는구나. 다음에 같이 걸어도 될까요?",
    assistant:
      "히유의 손에서 바코드 스캐너가 달칵 소리를 내며 내려앉았다. 그녀는 눈을 몇 번 깜빡이다가 시선을 피한 채 대답했다. \"같이… 걷는 거요? 저는 괜찮은데, 그, 제가 말을 잘 못해서 재미없을 수도 있어요.\" 말끝이 작아졌지만 그녀의 입꼬리는 어쩔 수 없이 올라가 있었다.",
  },
  {
    user: "말 안 해도 돼요. 그냥 같이 걷는 것만으로 좋아요.",
    assistant:
      "히유는 한동안 아무 말도 하지 못했다. 냉장고 모터 소리와 형광등의 낮은 웅웅거림만이 편의점 안을 채웠다. 이윽고 그녀가 조용히 말했다. \"그런 말, 처음 들어봐요.\" 앞치마 주머니에서 꺼낸 손가락이 작게 떨리고 있었다. \"근무 끝나면, 벤치에서 그 얘기 더 해요.\"",
  },
];

import { getDb } from "@/lib/db";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { applyRelationshipDeltaToChat } from "@/lib/memory/memory-relationship-meta";
import { getMemorySourceBoundary } from "@/lib/memory/memory-source-boundary";
import { commitManualGlobalCheckpointCore } from "@/lib/memory/memory-global-checkpoint";
import { upsertSummaryRowCore } from "@/lib/memory/memory-summary-persist";

const db = getDb();
db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
db.prepare(
  `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?,?,?,'safe',?)`
).run(
  CHAT_ID,
  USER_ID,
  CHAR_ID,
  JSON.stringify({ honorifics: [], items: [], thoughts: [], promises: [] })
);
getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
  CHAT_ID,
  "assistant",
  "어서오세요~ 아, 또 오셨네요. 오늘도 삼각김밥이에요?",
  "greeting"
);

const TOTAL_TURNS = 79;
const rawStart = TOTAL_TURNS - RAW_TURNS.length + 1;
const assistantIds = new Map<number, number>();
const userIds = new Map<number, number>();
for (let turn = 1; turn <= TOTAL_TURNS; turn++) {
  const raw = turn >= rawStart ? RAW_TURNS[turn - rawStart]! : null;
  const idx = (turn - 1) % FILLER_USER.length;
  let userText = raw?.user ?? FILLER_USER[idx]!;
  let assistantText = raw?.assistant ?? FILLER_ASSISTANT[idx]!;
  if (turn === 10) {
    userText = "이번 금요일 저녁에 한강에서 같이 야경 볼래요?";
    assistantText =
      "히유는 잠시 숨을 고르더니 수줍게 고개를 끄덕였다. \"좋아요. 금요일 저녁, 한강에서 야경 같이 봐요. 약속이에요.\"";
  } else if (turn === 20) {
    userText = "미안해요, 사정이 생겨서 금요일 야경 약속은 없던 걸로 해야 할 것 같아요.";
    assistantText =
      "\"괜찮아요. 야경 약속은 없던 걸로 해요.\" 히유는 애써 담담하게 웃어 보였다. 하지만 계산대 위에 올려둔 손끝이 잠깐 굳었다.";
  } else if (turn === 14) {
    userText = "이 청동열쇠, 잠시만 맡아 줄래요?";
    assistantText = "히유는 두 손으로 청동열쇠를 받아 앞치마 주머니에 조심스럽게 넣었다. \"잘 보관할게요.\"";
  } else if (turn === 35) {
    userText = "다음 주 토요일에 도서관 앞에서 빌린 책 돌려줄게요.";
    assistantText = "\"네, 토요일 도서관 앞에서요. 기다리고 있을게요.\" 히유가 작게 웃었다.";
  }
  const userId = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
    )
    .run(CHAT_ID, "user", userText).lastInsertRowid as number;
  const assistantId = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id)
       VALUES (?,?,?,?,'completed',?)`
    )
    .run(CHAT_ID, "assistant", assistantText, "synthetic-fixture", userId).lastInsertRowid as number;
  userIds.set(turn, userId);
  assistantIds.set(turn, assistantId);
}

function applyAt(turn: number, delta: Parameters<typeof applyRelationshipDeltaToChat>[0]["delta"]) {
  const assistantMessageId = assistantIds.get(turn)!;
  return applyRelationshipDeltaToChat({
    chatId: CHAT_ID,
    names: NAMES,
    delta,
    sourceUserMessageId: userIds.get(turn)!,
    boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
    assistantMessageId,
    generationScope: { assistantMessageId, generationSequence: 0, generationRequestId: null },
  });
}
applyAt(10, { promisesAdd: [PROMISE] });
applyAt(14, { items: ["데모유저: 청동열쇠"] });
applyAt(20, { promisesRemove: [PROMISE.text] });
applyAt(35, { promisesAdd: [LIBRARY_PROMISE] });

for (const [startText, summary] of Object.entries(BATCH_SUMMARIES)) {
  const start = Number(startText);
  const end = start + 4;
  upsertSummaryRowCore({
    chatId: CHAT_ID,
    turnStart: start,
    turnEnd: end,
    assistantMessageId: assistantIds.get(end)!,
    summary,
    summaryKind: "main_canon",
    userEdited: false,
  });
}

db.transaction(() => {
  commitManualGlobalCheckpointCore(db, {
    chatId: CHAT_ID,
    manualText: MANUAL_GLOBAL,
    archiveSummary: "",
  });
  db.prepare(
    `UPDATE chat_memories SET message_count=?, summarized_turn_count=75 WHERE chat_id=?`
  ).run(TOTAL_TURNS, CHAT_ID);
}).immediate();

console.log(
  JSON.stringify({
    chatId: CHAT_ID,
    turns: TOTAL_TURNS,
    memoryMeta: JSON.parse(
      (db.prepare("SELECT memory_meta FROM chats WHERE id=?").get(CHAT_ID) as { memory_meta: string })
        .memory_meta
    ),
  })
);
