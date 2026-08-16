import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { buildContext } from "./contextBuilder";

const REJECTED_SYSTEM_OWNER_TITLE = "[RESPONSE LENGTH — GEMINI 3.7 FLASH]";
const REJECTED_B_SENTENCE =
  "현재 장면을 충분히 전개하여 한국어 공백 포함 약 3,200~4,000자 분량으로 완성한다. 짧게 마무리하거나 요약하지 않는다.";
const REJECTED_C_MARKER = "약 3,200~4,000자 분량으로 완성한다";

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof (part as { text?: unknown }).text === "string"
            ? String((part as { text: string }).text)
            : "";
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while ((index = hay.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function baseInput(modelId: string) {
  return {
    charName: "조태형",
    chunks: [],
    userNickname: "렌",
    shortTermHistory: [{ role: "assistant" as const, content: "어? 신입이야?" }],
    currentUserMessage: "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
    nsfw: false,
    provider: "cheaperinference" as const,
    modelId,
    targetResponseChars: 3200,
  };
}

function lastUserText(built: ReturnType<typeof buildContext>): string {
  const last = built.history[built.history.length - 1];
  assert.equal(last?.role, "user");
  return last!.content;
}

describe("buildContext — Gemini 3.7 Flash vanilla length restore", () => {
  it("has no SYSTEM model-specific length owner and one generic user-tail owner", () => {
    const built = buildContext(baseInput(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL));
    const section = built.meta.trackedSections?.find(
      (s) => s.id === "rule-gemini37-flash-length-adapter"
    );
    const lastUser = lastUserText(built);
    assert.equal(section, undefined);
    assert.equal(built.systemPrompt.includes(REJECTED_SYSTEM_OWNER_TITLE), false);
    assert.equal(built.systemPrompt.includes(USER_TAIL_LENGTH_OWNER_SENTENCE), false);
    assert.equal(built.systemPrompt.includes(REJECTED_B_SENTENCE), false);
    assert.equal(lastUser.includes(REJECTED_SYSTEM_OWNER_TITLE), false);
    assert.equal(lastUser.includes(REJECTED_B_SENTENCE), false);
    assert.equal(lastUser.includes(REJECTED_C_MARKER), false);
    assert.equal(countOccurrences(lastUser, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.ok(lastUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.match(lastUser, /지문과 "…" 대사 사이 빈 줄/);
    const layoutIdx = lastUser.indexOf("지문과");
    const lengthIdx = lastUser.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
    assert.ok(layoutIdx >= 0 && lengthIdx > layoutIdx);
  });

  it("matches DeepSeek / Gemini 3.1 user-tail owner placement", () => {
    const gemini37 = lastUserText(
      buildContext(baseInput(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL))
    );
    const deepseek = lastUserText(
      buildContext(baseInput(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL))
    );
    const gemini31 = lastUserText(
      buildContext(baseInput(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL))
    );
    const tailOf = (text: string) => {
      const idx = text.lastIndexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
      return text.slice(idx);
    };
    assert.equal(tailOf(gemini37), tailOf(deepseek));
    assert.equal(tailOf(gemini37), tailOf(gemini31));
    assert.equal(countOccurrences(gemini37, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.equal(countOccurrences(deepseek, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.equal(countOccurrences(gemini31, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
  });

  it("assembled cheaper-inference request keeps vanilla user-tail owner and omits max_tokens", () => {
    const built = buildContext(baseInput(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL));
    const assembled = assemblePrimaryRpRequest({
      system: built.systemPrompt ?? "",
      history: built.history,
      modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      stream: true,
      messageOpts: {
        transportProvider: "cheaperinference",
        systemSplit: built.openRouterSystemSplit,
        charName: "조태형",
      },
    });
    const messages = assembled.requestBody.messages as Array<{
      role?: string;
      content?: unknown;
    }>;
    const systemJoined = messages
      .filter((m) => m.role === "system")
      .map((m) => flattenContent(m.content))
      .join("\n");
    const lastUser = flattenContent(
      [...messages].reverse().find((m) => m.role === "user")?.content
    );
    assert.equal(countOccurrences(systemJoined, REJECTED_SYSTEM_OWNER_TITLE), 0);
    assert.equal(countOccurrences(systemJoined, USER_TAIL_LENGTH_OWNER_SENTENCE), 0);
    assert.equal(countOccurrences(lastUser, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.ok(lastUser.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.equal((assembled.requestBody as { max_tokens?: unknown }).max_tokens, undefined);
    assert.equal(
      (assembled.requestBody as { reasoning_effort?: unknown }).reasoning_effort,
      "low"
    );
  });
});
