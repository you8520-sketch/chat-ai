import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import {
  appendCompactTerminalLengthToUserTurn,
  BOUNDED_LENGTH_OWNER_SENTENCE,
  buildCompactTerminalLengthAbsoluteTail,
  buildLengthInstruction,
  buildSingleShotLengthReminder,
  buildTerminalLengthOverrideBlock,
  buildTerminalLengthOverrideRecencyBlock,
  normalizeTargetResponseChars,
  USER_TAIL_LENGTH_OWNER_SENTENCE,
} from "@/lib/responseLength";
import { LUNA_TERMINAL_OUTPUT_CONTRACT } from "@/lib/lunaSinglePrimaryAdapter";

async function withServerOnlyMock<T>(fn: () => Promise<T>): Promise<T> {
  const require = createRequire(import.meta.url);
  require.cache[require.resolve("server-only")] = {
    exports: {},
    loaded: true,
    id: "server-only",
    filename: "server-only",
  } as NodeModule;
  return fn();
}

function countOccurrences(hay: string, needle: string): number {
  let c = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    c++;
    i += needle.length;
  }
  return c;
}

describe("buildLengthInstruction", () => {
  it("system length instruction is empty; owner lives on user tail", () => {
    const block = buildLengthInstruction();
    assert.equal(block, "");
    assert.equal(BOUNDED_LENGTH_OWNER_SENTENCE, "");
    assert.match(USER_TAIL_LENGTH_OWNER_SENTENCE, /3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /최초로 확인 가능한 결과/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /TARGET_LENGTH/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /MINIMUM_FLOOR/);
    assert.doesNotMatch(USER_TAIL_LENGTH_OWNER_SENTENCE, /Never stop at the first satisfying ending/);
  });

  it("null targetInput still keeps empty system length (tier normalize unchanged)", () => {
    assert.equal(buildLengthInstruction(null), "");
    assert.equal(normalizeTargetResponseChars(2400), 3200);
  });

  it("legacy per-user aim still normalizes; system length stays empty", () => {
    for (const legacy of [2000, 2400, 2700, 2800, 3000]) {
      assert.equal(normalizeTargetResponseChars(legacy), 3200);
      assert.equal(buildLengthInstruction(legacy), "");
    }
  });

  it("appendCompactTerminalLengthToUserTurn: layout then length owner last", () => {
    const out = appendCompactTerminalLengthToUserTurn("밤이 깊었어.", 3200);
    assert.match(out, /^밤이 깊었어\./);
    assert.match(out, /지문과 "…" 대사 사이 빈 줄/);
    assert.match(out, /3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다/);
    assert.ok(out.endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    const layoutIdx = out.indexOf("지문과");
    const lengthIdx = out.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
    assert.ok(layoutIdx >= 0 && lengthIdx > layoutIdx, "layout must precede length");
    assert.equal(countOccurrences(out, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.doesNotMatch(out, /TARGET_LENGTH/);
    assert.doesNotMatch(out, /MINIMUM_FLOOR/);
    assert.doesNotMatch(out, /미달 조기 종료/);
    assert.doesNotMatch(out, /최초로 확인 가능한 결과/);
  });

  it("Gemini 3.7 Flash: layout remains, generic user-tail length owner is suppressed", async () => {
    const { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } = await import(
      "@/lib/chatModels"
    );
    const out = appendCompactTerminalLengthToUserTurn("같이 갈래? *두리번*", 3200, {
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    });
    assert.match(out, /^같이 갈래\? \*두리번\*/);
    assert.match(out, /지문과 "…" 대사 사이 빈 줄/);
    assert.equal(countOccurrences(out, USER_TAIL_LENGTH_OWNER_SENTENCE), 0);
    assert.doesNotMatch(out, /4,000~5,500/);
    assert.doesNotMatch(out, /RESPONSE LENGTH — GEMINI 3\.7 FLASH/);
    assert.doesNotMatch(out, /약 3,200~4,000자 분량으로 완성한다/);
  });

  it("terminal length override is empty after consolidation", () => {
    assert.equal(buildCompactTerminalLengthAbsoluteTail(undefined), "");
    assert.equal(buildTerminalLengthOverrideBlock(3200), "");
    assert.equal(buildTerminalLengthOverrideRecencyBlock(undefined), "");
  });

  it("single-shot reminder still exists for recovery paths (not primary owner)", () => {
    const tail = buildSingleShotLengthReminder();
    assert.match(tail, /\[분량 — 이번 턴 1회 출력\]/);
  });

  it("OpenRouter Luna: system owners=0; terminal contract last on user turn", async () => {
    await withServerOnlyMock(async () => {
      const { buildContext } = await import("@/services/contextBuilder");
      const { CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } = await import("@/lib/chatModels");

      const built = buildContext({
        charName: "태형",
        chunks: [
          {
            id: "c0",
            characterId: "95001",
            content: "태형: 본부 센티넬.",
            category: "identity",
            importance: "CRITICAL",
            tokenCount: 8,
            keywords: ["태형"],
          },
        ],
        userNickname: "렌",
        shortTermHistory: [],
        currentUserMessage: "안녕",
        nsfw: false,
        gender: "male",
        userId: 1,
        chatId: 1,
        targetResponseChars: 3200,
        completedTurns: 2,
        modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        provider: "openrouter",
        personaDisplayName: "렌",
        contentKind: "character",
      });

      const sys = built.systemPrompt ?? "";
      assert.equal(countOccurrences(sys, LUNA_TERMINAL_OUTPUT_CONTRACT), 0);
      assert.equal(countOccurrences(sys, USER_TAIL_LENGTH_OWNER_SENTENCE), 0);
      assert.doesNotMatch(sys, /4,200|4200/);
      assert.ok(!(built.meta.trackedSections ?? []).some((s) => s.id === "luna-single-primary-adapter"));
      assert.ok(!(built.meta.trackedSections ?? []).some((s) => s.id === "rule-length-control"));

      const lastUser = built.history[built.history.length - 1];
      assert.equal(lastUser?.role, "user");
      assert.match(lastUser!.content, /지문과 "…" 대사 사이 빈 줄/);
      assert.equal(countOccurrences(lastUser!.content, LUNA_TERMINAL_OUTPUT_CONTRACT), 1);
      assert.ok(lastUser!.content.trimEnd().endsWith(LUNA_TERMINAL_OUTPUT_CONTRACT));
      assert.ok(
        lastUser!.content.indexOf("지문과") < lastUser!.content.indexOf(LUNA_TERMINAL_OUTPUT_CONTRACT)
      );
      assert.doesNotMatch(lastUser!.content, /TARGET_LENGTH|MINIMUM_FLOOR/);
    });
  });
});
