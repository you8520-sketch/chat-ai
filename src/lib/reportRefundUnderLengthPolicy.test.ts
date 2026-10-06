import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { creditPoints, deductPoints } from "@/lib/points";
import { processReportRefund } from "@/lib/refund";
import { assessCategoryForAutoRefund } from "@/lib/refundCategoryValidation";
import { assessMessageForAutoRefund } from "@/lib/refundAutoValidation";
import {
  AUTO_REFUND_DAILY_LIMIT,
  AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS,
  REPORT_REFUND_WINDOW_MS,
} from "@/lib/reportRefundPolicy";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";

let characterId = 0;

before(() => {
  installIsolatedTestDatabase();
  const db = getDb();
  ensureChatBillingSettlementSchema(db);
  characterId = Number(
    db.prepare("INSERT INTO characters (name) VALUES ('under-length-policy')").run().lastInsertRowid
  );
});

function createUser(): number {
  const tag = `ul_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return Number(
    getDb()
      .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
      .run(`${tag}@t.local`, tag, "x").lastInsertRowid
  );
}

function createChat(userId: number): number {
  return Number(
    getDb()
      .prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)")
      .run(userId, characterId).lastInsertRowid
  );
}

function chargeAndInsertAssistant(opts: {
  userId: number;
  chatId: number;
  content: string;
  cost?: number;
  slices?: "present" | "missing";
}): number {
  const cost = opts.cost ?? 10;
  creditPoints(opts.userId, cost + 100, "PAID", "test credit");
  const messageId = Number(
    getDb()
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status)
         VALUES (?, 'assistant', ?, 'test-model', 'completed')`
      )
      .run(opts.chatId, opts.content).lastInsertRowid
  );
  const deducted = deductPoints(opts.userId, cost, "test charge", {
    messageId,
    chatId: opts.chatId,
  });
  getDb()
    .prepare("UPDATE messages SET usage = ?, deduction_slices = ? WHERE id = ?")
    .run(
      JSON.stringify({
        input: 100,
        output: 200,
        model: "test-model",
        route: "safe",
        cost,
        breakdown: [],
      }),
      JSON.stringify(opts.slices === "missing" ? [] : deducted.slices),
      messageId
    );
  return messageId;
}

describe("under_length auto-refund inclusive <=1000 owner", () => {
  it("1000 visible chars + under_length category is deterministic evidence", () => {
    const content = "x".repeat(AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS);
    const assessment = assessCategoryForAutoRefund({
      category: "under_length",
      content,
    });
    assert.equal(assessment.isError, true);
    assert.deepEqual(assessment.reasons, ["under_length"]);
  });

  it("1001 visible chars is not auto-refund evidence by length alone", () => {
    const content = "x".repeat(AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS + 1);
    const assessment = assessCategoryForAutoRefund({
      category: "under_length",
      content,
    });
    assert.equal(assessment.isError, false);
    assert.equal(assessment.reasons.includes("under_length"), false);
    const generic = assessMessageForAutoRefund({ content });
    assert.equal(generic.reasons.includes("under_length"), false);
  });

  it("other and spam categories do not auto-refund from length alone", () => {
    const short = [
      "창가 쪽 테이블에서 태형이 잔을 내려놓고 렌을 보았다.",
      "바깥 비는 아직 잦아들지 않았고, 유리에 빗줄기가 길게 이어졌다.",
      "렌은 컵을 한 번 돌린 뒤 대답을 고르는 듯 잠시 입을 다물었다.",
      "태형은 서두르지 않고 의자 등받이에 몸을 기대며 그 침묵을 받았다.",
      "가게 안 라디오는 낮은 재즈만 흘리고, 옆 테이블은 숟가락 소리만 났다.",
      "렌이 마침내 짧게 고개를 끄덕이자 태형의 어깨가 조금 내려갔다.",
      "둘은 바로 다음 말을 얹지 않고, 식어가는 차를 한 모금씩 마셨다.",
      "창밖 가로등 아래 웅덩이에 노란 불빛이 흔들렸고, 그제야 대화가 이어졌다.",
      "태형은 오늘 일정을 먼저 말하지 않고, 렌이 꺼낸 작은 걱정부터 받았다.",
      "렌은 가방 끈을 고쳐 잡으며 지하철이 끊기기 전에 일어나야 한다고 했다.",
      "계산대 앞에서 우산이 부딪히자 태형이 먼저 문을 열어 비를 가렸다.",
      "골목으로 접어들자 구두 소리와 빗소리가 겹쳤고, 둘의 걸음은 맞춰졌다.",
      "정류장 의자 끝에 앉은 렌이 손목을 훑자, 태형은 그 동작을 방해하지 않았다.",
      "버스 불빛이 가까워지자 렌이 짧게 고맙다고 했고, 태형은 손만 들었다.",
    ].join(" ");
    assert.ok(short.length > 500 && short.length <= AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS);
    assert.equal(
      assessCategoryForAutoRefund({ category: "other", content: short }).isError,
      false
    );
    assert.equal(
      assessCategoryForAutoRefund({ category: "spam_flood", content: short }).isError,
      false
    );
    assert.equal(
      assessCategoryForAutoRefund({
        category: "similar_content",
        content: short,
        previousAssistantContent: "전혀 다른 이전 답변입니다. ".repeat(8),
        userMessage: "다른 유저 입력입니다. ".repeat(6),
      }).isError,
      false
    );
  });

  it("processReportRefund auto-approves 1000-char under_length and leaves 1001 pending", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    const eligibleId = chargeAndInsertAssistant({
      userId,
      chatId,
      content: "가".repeat(AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS),
    });
    const eligible = processReportRefund(userId, eligibleId, chatId, "under_length");
    assert.equal(eligible.status, "approved");
    if (eligible.status === "approved") {
      assert.equal(eligible.autoRefund, true);
    }

    const tooLongId = chargeAndInsertAssistant({
      userId,
      chatId,
      content: "가".repeat(AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS + 1),
    });
    const pending = processReportRefund(userId, tooLongId, chatId, "under_length");
    assert.equal(pending.status, "pending");
  });

  it("keeps daily 3 auto-refund limit", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    for (let i = 0; i < AUTO_REFUND_DAILY_LIMIT; i += 1) {
      const messageId = chargeAndInsertAssistant({
        userId,
        chatId,
        content: "짧음",
      });
      const result = processReportRefund(userId, messageId, chatId, "under_length");
      assert.equal(result.status, "approved");
    }
    const fourthId = chargeAndInsertAssistant({
      userId,
      chatId,
      content: "짧음",
    });
    const fourth = processReportRefund(userId, fourthId, chatId, "under_length");
    assert.equal(fourth.status, "pending");
    if (fourth.status === "pending") {
      assert.equal(fourth.dailyLimitExceeded, true);
    }
  });

  it("rejects a second report on an already refunded message", () => {
    const userId = createUser();
    const chatId = createChat(userId);
    const messageId = chargeAndInsertAssistant({
      userId,
      chatId,
      content: "짧음",
    });
    const first = processReportRefund(userId, messageId, chatId, "under_length");
    assert.equal(first.status, "approved");
    const again = processReportRefund(userId, messageId, chatId, "under_length");
    assert.equal(again.status, "rejected");
  });

  it("integrity-fail slices stay pending/manual and 24h window is unchanged", () => {
    assert.equal(REPORT_REFUND_WINDOW_MS, 24 * 60 * 60 * 1000);
    const userId = createUser();
    const chatId = createChat(userId);
    const messageId = chargeAndInsertAssistant({
      userId,
      chatId,
      content: "짧음",
      slices: "missing",
    });
    const result = processReportRefund(userId, messageId, chatId, "under_length");
    assert.equal(result.status, "pending");
    if (result.status === "pending") {
      assert.notEqual(result.dailyLimitExceeded, true);
    }
  });
});
