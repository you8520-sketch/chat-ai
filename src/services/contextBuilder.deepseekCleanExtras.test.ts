import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import type { buildContext as BuildContextFn } from "./contextBuilder";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import {
  DEEPSEEK_APPEARANCE_VARIATION_RULE,
} from "@/lib/appearanceCompiler";
import {
  DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY,
  DEEPSEEK_XML_TAGS,
} from "@/lib/deepseekPromptStructure";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const chunks: CharacterChunk[] = [
  {
    id: "c-chunk-0",
    characterId: "1",
    content: "[외형]\n흑발 녹안\n[성격]\n능글맞음",
    category: "identity",
    importance: "CRITICAL",
    tokenCount: 20,
    keywords: ["외형"],
  },
];

function baseInput(extra: Record<string, unknown> = {}) {
  return {
    charName: "라이크",
    chunks,
    userNickname: "렌",
    shortTermHistory: [
      { role: "assistant" as const, content: "라이크가 소매를 올려 보였다." },
    ],
    currentUserMessage: "이대로 더 해도 돼.",
    nsfw: true,
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    provider: "cheaperinference" as const,
    ...extra,
  };
}

describe("buildContext — DeepSeek CLEAN extras override", () => {
  it("keeps DeepSeek style adapters on the production default path", () => {
    const built = buildContext(baseInput());
    const userJoined = (built.history ?? [])
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n");
    assert.ok(
      built.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.worldLore}>`) ||
        built.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.persona}>`)
    );
    assert.ok(built.systemPrompt.includes(DEEPSEEK_APPEARANCE_VARIATION_RULE));
    assert.ok(userJoined.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY));
  });

  it("strips DeepSeek-only style adapters when extras override is off", () => {
    const built = buildContext(baseInput({ deepSeekExtrasModeOverride: "off" }));
    const lastUser = [...(built.history ?? [])].reverse().find((m) => m.role === "user");
    assert.equal(built.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.persona}>`), false);
    assert.equal(built.systemPrompt.includes(`<${DEEPSEEK_XML_TAGS.worldLore}>`), false);
    assert.equal(built.systemPrompt.includes(DEEPSEEK_APPEARANCE_VARIATION_RULE), false);
    assert.equal(lastUser?.content.includes(DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY), false);
    assert.ok(built.systemPrompt.includes("흑발 녹안"));
    assert.ok(lastUser?.content.includes("이대로 더 해도 돼."));
  });
});
