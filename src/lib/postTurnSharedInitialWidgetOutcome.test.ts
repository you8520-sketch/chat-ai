import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluatePostTurnSharedInitialWidgetExtraction,
  postTurnSharedInitialSuggestedRepliesOk,
  shouldPreservePostTurnSharedInitialParsed,
} from "@/lib/postTurnSharedInitialWidgetOutcome";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { parsePostTurnSharedInitialResponse } from "@/lib/postTurnSharedInitial/parse";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";

const userJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

function dualInput() {
  return {
    mode: "dual" as const,
    charName: "레온",
    personaName: "렌",
    userMessage: "안녕",
    assistantProse: "본문",
    characterWidget: DEFAULT_STATUS_WIDGET,
    userWidget: {
      ...DEFAULT_STATUS_WIDGET,
      name: "내 커스텀",
      fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
    },
    primaryModelId: "gpt-5.6-luna",
  };
}

function validDualJson() {
  const character_values: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)) {
    character_values[key] = `${key}-값`.padEnd(8, "x");
  }
  const user_values: Record<string, string> = {};
  for (const key of collectWidgetJsonKeys(JSON.parse(userJson) as typeof DEFAULT_STATUS_WIDGET)) {
    user_values[key] = `${key}-값`.padEnd(8, "x");
  }
  return JSON.stringify({
    statusWidget: { character_values, user_values, extracted_facts: [] },
    suggestedReplies: { items: [] },
  });
}

function padReply(seed: string, length = 72): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

describe("postTurnSharedInitialWidgetOutcome", () => {
  it("HTTP 200 + invalid JSON → V3_PARSE_FAILED, not OK", () => {
    const parsed = parsePostTurnSharedInitialResponse("not-json{{{", dualInput());
    assert.equal(parsed.jsonParseOk, false);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_PARSE_FAILED");
    assert.equal(postTurnSharedInitialSuggestedRepliesOk(parsed), false);
  });

  it("transport failure → V3_EMPTY_OUTPUT", () => {
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: false,
      mode: "dual",
      parsed: null,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_EMPTY_OUTPUT");
  });

  it("parsed payload preservation is independent of diagnostic full success", () => {
    const parsed = parsePostTurnSharedInitialResponse(validDualJson(), dualInput());
    parsed.dual!.userOk = false;
    assert.equal(
      evaluatePostTurnSharedInitialWidgetExtraction({
        transportOk: true,
        mode: "dual",
        parsed,
      }).succeeded,
      false
    );
    assert.equal(
      shouldPreservePostTurnSharedInitialParsed({ transportOk: true, parsed }),
      true
    );
  });

  it("invalid JSON is not preserved for downstream widget reuse", () => {
    const parsed = parsePostTurnSharedInitialResponse("not-json{{{", dualInput());
    assert.equal(
      shouldPreservePostTurnSharedInitialParsed({ transportOk: true, parsed }),
      false
    );
  });

  it("dual valid JSON both sources → OK", () => {
    const parsed = parsePostTurnSharedInitialResponse(validDualJson(), dualInput());
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, true);
    assert.equal(outcome.reasonCode, "OK");
  });

  it("dual partial — one source empty → not full success", () => {
    const character_values: Record<string, string> = {};
    for (const key of collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)) {
      character_values[key] = `${key}-값`.padEnd(8, "x");
    }
    const parsed = parsePostTurnSharedInitialResponse(
      JSON.stringify({
        statusWidget: { character_values, user_values: {}, extracted_facts: [] },
      }),
      dualInput()
    );
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_INITIAL_EMPTY");
  });

  it("suggested replies ok does not imply widget ok", () => {
    const parsed = parsePostTurnSharedInitialResponse(
      JSON.stringify({
        suggestedReplies: {
          items: [
            { kind: "escalate", text: padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\"") },
            { kind: "soften", text: padReply("*숨을 고르며* \"일단 여기 앉아서 천천히 얘기하자.\"") },
            { kind: "pivot", text: padReply("*창밖을 가리키며* \"저기 새로 생긴 카페, 같이 가볼래?\"") },
          ],
        },
      }),
      dualInput()
    );
    assert.equal(parsed.jsonParseOk, true);
    assert.equal(postTurnSharedInitialSuggestedRepliesOk(parsed), true);
    const outcome = evaluatePostTurnSharedInitialWidgetExtraction({
      transportOk: true,
      mode: "dual",
      parsed,
    });
    assert.equal(outcome.succeeded, false);
    assert.equal(outcome.reasonCode, "V3_INITIAL_EMPTY");
  });
});
