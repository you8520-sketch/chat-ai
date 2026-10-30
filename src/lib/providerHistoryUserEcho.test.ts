import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GEMINI_38_FLASH_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
} from "@/lib/chatModels";
import { resolveNextTurnHistoryDelta } from "@/lib/mainRpNextTurnEstimate";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  applyGemini38HistoryEchoProjection,
  findProviderHistoryEchoRetainedAssistant,
  gemini38ProviderHistoryFromCanonical,
  isGemini38FlashHistoryEchoModel,
  omitContiguousReinjectedUserParagraphs,
} from "./providerHistoryUserEcho";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./providerHistoryUserEcho.fixture.json", import.meta.url)),
    "utf8"
  )
) as {
  t143History: Array<{ role: "user" | "assistant"; content: string }>;
  t144Pair: Array<{ role: "user" | "assistant"; content: string }>;
};

const ROUTE_SOURCE = readFileSync(
  fileURLToPath(new URL("../app/api/chat/route.ts", import.meta.url)),
  "utf8"
);

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

describe("Gemini 3.8 history echo projection", () => {
  it("drops B46-G3 contiguous user reprints and keeps every user message", () => {
    const history = FIXTURE.t143History;
    const projected = omitContiguousReinjectedUserParagraphs(history);

    assert.deepEqual(
      projected.filter((message) => message.role === "user").map((message) => message.content),
      history.filter((message) => message.role === "user").map((message) => message.content)
    );
    for (const message of history) {
      if (message.role === "user") {
        assert.equal(projected.includes(message), true);
      }
    }

    const assistants = projected.filter((message) => message.role === "assistant");
    const first = assistants[0]?.content ?? "";
    assert.equal(
      first.includes("제이는 바지선 갑판 위에 서서, 손목시계의 유리면을 엄지로 살짝 닦아냈다."),
      false
    );
    assert.equal(paragraphs(first).includes("동쪽."), true);
    assert.equal(first.includes("비상 정화 장치"), true);
    assert.equal(
      history[0]?.content.includes(
        "제이는 바지선 갑판 위에 서서, 손목시계의 유리면을 엄지로 살짝 닦아냈다."
      ),
      true
    );

    const report = assistants[3]?.content ?? "";
    assert.equal(report.includes("오스카의 처절한 보고를 들으며 드라이브 팩을 가볍게 쥐었다."), true);
    assert.equal(report.includes('"등대와 속사포, 그리고 아직 남아있는 잔해들."'), true);
    assert.equal(report.includes("그에게는 오직 나의 명령만이 존재할 뿐이었다."), false);
    assert.equal(report.includes("구둣발 아래에 고여 있던 검붉은 웅덩이"), true);
  });

  it("keeps the isolated T144 callback and the unique engine paragraph", () => {
    const projected = omitContiguousReinjectedUserParagraphs(FIXTURE.t144Pair);
    const assistant = projected[1]?.content ?? "";
    assert.equal(projected[0]?.content, FIXTURE.t144Pair[0]?.content);
    assert.equal(paragraphs(assistant).includes("기어올라와라."), true);
    assert.equal(assistant.includes("드라이브 팩을 주머니에 넣으며 발걸음을 돌렸다."), false);
    assert.equal(assistant.startsWith("바지선 선미의 디젤 보조 하이브리드 엔진"), true);
    assert.equal(FIXTURE.t144Pair[0]?.content.includes("기어올라와라."), true);
  });

  it("is deterministic and idempotent", () => {
    const once = omitContiguousReinjectedUserParagraphs(FIXTURE.t143History);
    const twice = omitContiguousReinjectedUserParagraphs(once);
    assert.equal(twice, once);
    assert.deepEqual(
      omitContiguousReinjectedUserParagraphs(FIXTURE.t143History).map((message) => message.content),
      once.map((message) => message.content)
    );
  });

  it("keeps an intentional quote, a short callback, and a mixed paragraph", () => {
    const user = [
      "Pick up the leash.",
      "동쪽.",
      "알파 문장이다.",
      "베타 문장이다.",
      "NPC는 고개만 끄덕였다.",
    ].join("\n\n");
    const history = [
      {
        role: "user" as const,
        content: user,
      },
      {
        role: "assistant" as const,
        content: [
          '"Pick up the leash."',
          "동쪽.",
          "그는 난간을 한번 짚었다.",
          "알파 문장이다.",
          "베타 문장이다.",
          "베타 문장이다. UNIQUE_FACT를 새로 보았다.",
          "NPC는 고개만 끄덕였다.",
          "갑판 난간이 식었다.",
        ].join("\n\n"),
      },
    ];
    const projected = omitContiguousReinjectedUserParagraphs(history);
    const assistant = projected[1]?.content ?? "";
    assert.equal(assistant.includes('"Pick up the leash."'), true);
    assert.equal(paragraphs(assistant).includes("동쪽."), true);
    assert.equal(assistant.includes("UNIQUE_FACT"), true);
    assert.equal(assistant.includes("NPC는 고개만 끄덕였다."), true);
    assert.equal(assistant.includes("갑판 난간이 식었다."), true);
    assert.equal(assistant.includes("알파 문장이다."), false);
    assert.equal(assistant.includes("베타 문장이다. UNIQUE_FACT"), true);
  });

  it("keeps an out-of-order quotation and the unique reaction after it", () => {
    const history = [
      {
        role: "user" as const,
        content: ["알파 문단은 동쪽에서 시작했다.", "베타 문단은 문을 닫는 장면이다."].join("\n\n"),
      },
      {
        role: "assistant" as const,
        content: [
          "베타 문단은 문을 닫는 장면이다.",
          "알파 문단은 동쪽에서 시작했다.",
          "그는 난간을 짚고 고유한 반응을 덧붙였다.",
        ].join("\n\n"),
      },
    ];
    const assistant = omitContiguousReinjectedUserParagraphs(history)[1]?.content ?? "";
    assert.equal(assistant.includes("베타 문단은 문을 닫는 장면이다."), true);
    assert.equal(assistant.includes("알파 문단은 동쪽에서 시작했다."), true);
    assert.equal(assistant.includes("그는 난간을 짚고 고유한 반응을 덧붙였다."), true);
    assert.equal(assistant, history[1]?.content);
  });

  it("keeps two short dialogue lines spoken back as a callback", () => {
    const history = [
      {
        role: "user" as const,
        content: ['"기다려."', '"따라와."'].join("\n\n"),
      },
      {
        role: "assistant" as const,
        content: ['"기다려."', '"따라와."', "그는 그 두 마디를 되받고 난간을 짚었다."].join("\n\n"),
      },
    ];
    const assistant = omitContiguousReinjectedUserParagraphs(history)[1]?.content ?? "";
    assert.equal(assistant.includes('"기다려."'), true);
    assert.equal(assistant.includes('"따라와."'), true);
    assert.equal(assistant.includes("그는 그 두 마디를 되받고 난간을 짚었다."), true);
    assert.equal(assistant, history[1]?.content);
  });

  it("treats Korean spacing and newline differences as the same paragraph", () => {
    const history = [
      {
        role: "user" as const,
        content: "그는  짧게\n말했다.\n\n그리고   문을 닫았다.",
      },
      {
        role: "assistant" as const,
        content: ["그는 짧게 말했다.", "그리고 문을 닫았다.", "창밖에 비가 왔다."].join("\n\n"),
      },
    ];
    const projected = omitContiguousReinjectedUserParagraphs(history);
    assert.equal(projected[1]?.content, "창밖에 비가 왔다.");
  });

  it("does not mix a different turn's user event into the assistant", () => {
    const history = [
      { role: "user" as const, content: "첫 사건의 긴 문장이다.\n\n첫 사건의 둘째 문장이다." },
      { role: "assistant" as const, content: "첫 턴의 고유 반응이다." },
      { role: "user" as const, content: "둘째 턴은 다른 장소다." },
      {
        role: "assistant" as const,
        content: ["첫 사건의 긴 문장이다.", "첫 사건의 둘째 문장이다.", "둘째 턴의 고유 반응이다."].join(
          "\n\n"
        ),
      },
    ];
    const projected = omitContiguousReinjectedUserParagraphs(history);
    assert.equal(projected[1]?.content, history[1]?.content);
    assert.equal(projected[3]?.content, history[3]?.content);
  });

  it("keeps a single-paragraph copy, an all-duplicate reply, and repeated short lines", () => {
    const single = omitContiguousReinjectedUserParagraphs([
      { role: "user", content: "한 문단으로 이어진 긴 사용자 원문이다." },
      { role: "assistant", content: "한 문단으로 이어진 긴 사용자 원문이다." },
    ]);
    assert.equal(single[1]?.content, "한 문단으로 이어진 긴 사용자 원문이다.");

    const onlyDuplicates = [
      { role: "user" as const, content: "같은 문장이다.\n\n다른 문장이다." },
      {
        role: "assistant" as const,
        content: ["같은 문장이다.", "다른 문장이다."].join("\n\n"),
      },
    ];
    assert.equal(
      omitContiguousReinjectedUserParagraphs(onlyDuplicates)[1],
      onlyDuplicates[1]
    );

    const repeated = omitContiguousReinjectedUserParagraphs([
      { role: "user", content: "같은 문장이다." },
      {
        role: "assistant",
        content: ["같은 문장이다.", "같은 문장이다.", "같은 문장이다.", "그 뒤에 고유 서술이다."].join(
          "\n\n"
        ),
      },
    ]);
    assert.equal(repeated[1]?.content, "그 뒤에 고유 서술이다.");
    const empty: Array<{ role: string; content: string }> = [];
    assert.equal(omitContiguousReinjectedUserParagraphs(empty), empty);
    assert.equal(
      omitContiguousReinjectedUserParagraphs([{ role: "assistant", content: "" }])[0]?.content,
      ""
    );
  });

  it("keeps a regen-shaped history's earlier unique reply and still drops a later run", () => {
    const history = [
      { role: "user" as const, content: "유지되는 사용자 문장." },
      { role: "assistant" as const, content: "재생성으로 지워지지 않은 고유 답." },
      {
        role: "user" as const,
        content: "다시 보낸 문단 하나다.\n\n다시 보낸 문단 둘이다.",
      },
      {
        role: "assistant" as const,
        content: ["다시 보낸 문단 하나다.", "다시 보낸 문단 둘이다.", "이어서 고유 반응이다."].join(
          "\n\n"
        ),
      },
    ];
    const projected = omitContiguousReinjectedUserParagraphs(history);
    assert.equal(projected[1]?.content, "재생성으로 지워지지 않은 고유 답.");
    assert.equal(projected[3]?.content, "이어서 고유 반응이다.");
    assert.equal(projected[2]?.content, history[2]?.content);
  });

  it("returns the same array for every non-Gemini 3.8 Flash model", () => {
    const history = FIXTURE.t143History;
    for (const modelId of [
      "google/gemini-4-argon",
      "gemini-4-argon",
      "google/gemini-3.7-flash",
      "gemini-3.7-flash",
      "anthropic/claude-opus-4.6",
      "deepseek/deepseek-v4-pro",
      "",
    ]) {
      assert.equal(isGemini38FlashHistoryEchoModel(modelId), false);
      assert.equal(applyGemini38HistoryEchoProjection(modelId, history), history);
    }
    assert.equal(isGemini38FlashHistoryEchoModel(GEMINI_38_FLASH_MODEL), true);
    assert.equal(
      isGemini38FlashHistoryEchoModel(OPENROUTER_GEMINI_38_FLASH_MODEL),
      true
    );
    assert.equal(isGemini38FlashHistoryEchoModel("google/gemini-3.8-flash:online"), false);
  });

  it("re-trims Gemini history from the projected canonical text and leaves other models untouched", () => {
    const canonical = FIXTURE.t143History;
    const trimmed = canonical.slice(0, 4);
    const gemini = gemini38ProviderHistoryFromCanonical({
      modelId: OPENROUTER_GEMINI_38_FLASH_MODEL,
      canonicalRecentHistoryFull: canonical,
      trimmedHistory: trimmed,
      historyTokenBudget: 100_000,
      trim: { minRealPlayableExchanges: 4, protectOpening: false },
    });
    assert.notEqual(gemini, trimmed);
    assert.equal(
      gemini
        .filter((message) => message.role === "assistant")
        .some((message) =>
          message.content.includes(
            "제이는 바지선 갑판 위에 서서, 손목시계의 유리면을 엄지로 살짝 닦아냈다."
          )
        ),
      false
    );
    assert.equal(
      gemini.filter((message) => message.role === "user").map((message) => message.content).join("\n"),
      canonical.filter((message) => message.role === "user").map((message) => message.content).join("\n")
    );
    const other = gemini38ProviderHistoryFromCanonical({
      modelId: "google/gemini-4-argon",
      canonicalRecentHistoryFull: canonical,
      trimmedHistory: trimmed,
      historyTokenBudget: 100_000,
      trim: { minRealPlayableExchanges: 4, protectOpening: false },
    });
    assert.equal(other, trimmed);
    const sentTokens = estimateTokens(gemini.map((message) => message.content).join("\n"));
    const billed = gemini38ProviderHistoryFromCanonical({
      modelId: GEMINI_38_FLASH_MODEL,
      canonicalRecentHistoryFull: canonical,
      trimmedHistory: trimmed,
      historyTokenBudget: 100_000,
      trim: { minRealPlayableExchanges: 4, protectOpening: false },
    });
    assert.equal(estimateTokens(billed.map((message) => message.content).join("\n")), sentTokens);
    assert.deepEqual(
      billed.map((message) => message.content),
      gemini.map((message) => message.content)
    );
  });

  it("counts a projected assistant as retained and scales its output tokens", () => {
    const stored = ["같은 문장이다.", "다른 문장이다.", "고유 답이다."].join("\n\n");
    const sent = "고유 답이다.";
    const history = [
      { role: "user", content: "같은 문장이다.\n\n다른 문장이다." },
      { role: "assistant", content: sent },
    ];
    assert.equal(findProviderHistoryEchoRetainedAssistant(stored, history), sent);
    const exact = resolveNextTurnHistoryDelta({
      previous: { actualBillableInputTokens: 4000, actualBillableOutputTokens: 1000 },
      previousAssistantContent: stored,
      nextPromptHistory: [
        { role: "user", content: "같은 문장이다.\n\n다른 문장이다." },
        { role: "assistant", content: stored },
      ],
      previousPromptHistory: [],
      currentUserEstimatedTokens: 10,
    });
    assert.equal(exact.previousAssistantRetained, true);
    assert.equal(exact.retainedNewHistoryTokens, 1000);

    const projected = resolveNextTurnHistoryDelta({
      previous: { actualBillableInputTokens: 4000, actualBillableOutputTokens: 1000 },
      previousAssistantContent: stored,
      nextPromptHistory: history,
      previousPromptHistory: history,
      currentUserEstimatedTokens: 10,
    });
    assert.equal(projected.previousAssistantRetained, true);
    assert.equal(projected.removedHistoryTokens, 0);
    const expected = Math.round(
      (1000 * estimateTokens(sent)) / estimateTokens(stored)
    );
    assert.equal(projected.retainedNewHistoryTokens, expected);
    assert.ok(projected.retainedNewHistoryTokens < 1000);

    const unrelated = resolveNextTurnHistoryDelta({
      previous: { actualBillableInputTokens: 4000, actualBillableOutputTokens: 1000 },
      previousAssistantContent: stored,
      nextPromptHistory: [{ role: "assistant", content: "전혀 다른 답이다." }],
      previousPromptHistory: [{ role: "assistant", content: stored }],
      currentUserEstimatedTokens: 10,
    });
    assert.equal(unrelated.previousAssistantRetained, false);
    assert.equal(unrelated.retainedNewHistoryTokens, 0);
    assert.ok(unrelated.removedHistoryTokens > 0);
  });

  it("wires one Gemini projection ahead of shortTermHistory and leaves fallback canonical history raw", () => {
    const projectionAt = ROUTE_SOURCE.indexOf("gemini38ProviderHistoryFromCanonical");
    const shortTermAt = ROUTE_SOURCE.indexOf("const shortTermHistory = providerRecentHistoryFull");
    assert.ok(projectionAt > 0);
    assert.ok(shortTermAt > projectionAt);
    assert.match(ROUTE_SOURCE, /selectAdultHandoffRawVariants\(\s*canonicalRecentHistoryFull/);
    assert.match(ROUTE_SOURCE, /nextPromptHistory: isGemini38FlashHistoryEchoModel\(contextModelId\)\s*\?\s*promptHistory/);
    assert.match(ROUTE_SOURCE, /: preparedHistory\.promptHistory/);
    assert.match(ROUTE_SOURCE, /: previousPreparedHistory\.promptHistory/);
  });
});
