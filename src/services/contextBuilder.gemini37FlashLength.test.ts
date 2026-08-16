import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import {
  GEMINI37_FLASH_LENGTH_OWNER_BLOCK,
  REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE,
  auditGemini37LengthOwners,
} from "@/lib/gemini37FlashLengthAdapter";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "@/lib/gemini31UserAgencyAdapter";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { buildContext } from "./contextBuilder";

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
  };
}

describe("buildContext — Gemini 3.7 Flash SYSTEM length owner", () => {
  it("injects the SYSTEM owner once and suppresses the generic user-tail owner", () => {
    const built = buildContext(baseInput(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL));
    const section = built.meta.trackedSections?.find(
      (s) => s.id === "rule-gemini37-flash-length-adapter"
    );
    const lastUser = built.history[built.history.length - 1];
    assert.ok(section);
    assert.equal(section!.category, "systemRules");
    assert.equal(section!.text, GEMINI37_FLASH_LENGTH_OWNER_BLOCK);
    assert.ok(built.systemPrompt.includes(GEMINI37_FLASH_LENGTH_OWNER_BLOCK));
    assert.equal(lastUser?.role, "user");
    assert.match(lastUser!.content, /지문과 "…" 대사 사이 빈 줄/);
    assert.equal(lastUser!.content.includes(GEMINI37_FLASH_LENGTH_OWNER_BLOCK), false);
    assert.equal(lastUser!.content.includes(USER_TAIL_LENGTH_OWNER_SENTENCE), false);
    assert.equal(
      lastUser!.content.includes(REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE),
      false
    );
    assert.equal(built.systemPrompt.includes(USER_TAIL_LENGTH_OWNER_SENTENCE), false);
    assert.equal(
      built.systemPrompt.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
      false
    );

    const audit = auditGemini37LengthOwners({
      system: built.systemPrompt ?? "",
      lastUser: lastUser!.content,
    });
    assert.equal(audit.GEMINI37_LENGTH_OWNER_COUNT, 1);
    assert.equal(audit.location, "system");
    assert.equal(audit.genericUserTailCount, 0);
    assert.equal(audit.rejectedBCount, 0);
  });

  it("keeps GEMINI37_LENGTH_OWNER_COUNT=1 on the assembled cheaper-inference request", () => {
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
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const audit = auditGemini37LengthOwners({
      system: systemJoined,
      lastUser: flattenContent(lastUser?.content),
    });
    assert.equal(audit.GEMINI37_LENGTH_OWNER_COUNT, 1);
    assert.equal(audit.location, "system");
    assert.equal(audit.genericUserTailCount, 0);
    assert.equal((assembled.requestBody as { max_tokens?: unknown }).max_tokens, undefined);
    assert.equal(
      (assembled.requestBody as { reasoning_effort?: unknown }).reasoning_effort,
      "low"
    );
  });

  it("does not inject the Gemini 3.7 owner for Gemini 3.1 or DeepSeek", () => {
    for (const modelId of [
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
    ]) {
      const built = buildContext(baseInput(modelId));
      const section = built.meta.trackedSections?.find(
        (s) => s.id === "rule-gemini37-flash-length-adapter"
      );
      const lastUser = built.history[built.history.length - 1];
      assert.equal(section, undefined);
      assert.equal(
        built.systemPrompt.includes(GEMINI37_FLASH_LENGTH_OWNER_BLOCK),
        false
      );
      assert.ok(lastUser?.content.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));
    }
  });
});
