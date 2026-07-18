import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import type { buildContext as BuildContextFn } from "./contextBuilder";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL, OPENROUTER_QWEN_37_MAX_MODEL } from "@/lib/chatModels";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER } from "@/lib/deepseekOpeningSceneContext";
import { messagesToTurns, rawRecentTurnsToHistory } from "@/lib/hybridMemory";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("./contextBuilder"));
});

const GREETING = [
  "*안전가옥 거실.*",
  "레온은 이미 방 안으로 들어와 문을 닫았다. 낡은 손전등을 렌에게 건넸다.",
  '"여기서 기다려."',
].join("\n");

const chunk: CharacterChunk = {
  id: "c1",
  characterId: "1",
  content: "[Identity]\nLeon.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 5,
  keywords: ["leon"],
};

describe("buildContext — DeepSeek thin greeting remap", () => {
  it("moves creator greeting out of assistant history into opening context (DeepSeek thin)", () => {
    const shortTermHistory = rawRecentTurnsToHistory(
      messagesToTurns([{ role: "assistant", content: GREETING, model: "greeting" }])
    );
    const built = buildContext({
      charName: "레온",
      chunks: [chunk],
      userNickname: "렌",
      shortTermHistory,
      currentUserMessage: "렌이 식탁에 앉았다.",
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
      targetResponseChars: 3200,
    });

    const prior = built.history.slice(0, -1);
    assert.ok(!prior.some((m) => m.role === "assistant" && m.content.includes("손전등을")));
    assert.ok(!prior.some((m) => m.content === OPENING_TURN_USER));

    const lastUser = built.history.at(-1)!;
    assert.equal(lastUser.role, "user");
    assert.match(lastUser.content, new RegExp(DEEPSEEK_OPENING_SCENE_CONTEXT_HEADER.replace(/[[\]]/g, "\\$&")));
    assert.match(lastUser.content, /손전등을 렌에게 건넸다/);
    assert.match(lastUser.content, /여기서 기다려/);
    assert.match(lastUser.content, /\[DEEPSEEK LENGTH — SINGLE CALL\]/);
    assert.match(lastUser.content, /SHORT HISTORY/);
  });

  it("injects SHORT USER TURN for brief DeepSeek RP lines (normal + regen)", () => {
    const shortTermHistory = rawRecentTurnsToHistory(
      messagesToTurns([{ role: "assistant", content: GREETING, model: "greeting" }])
    );
    const normal = buildContext({
      charName: "레온",
      chunks: [chunk],
      userNickname: "렌",
      shortTermHistory,
      currentUserMessage: "배고파.",
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
      targetResponseChars: 3200,
    });
    const normalUser = normal.history.at(-1)!;
    assert.match(normalUser.content, /\[SHORT USER TURN\]/);
    assert.match(normalUser.content, /interaction cue/);

    const regenMsg =
      "[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]\n" +
      "- Obey divergence.\n\n" +
      "[User message — fixed anchor, not dialogue to rewrite]\n" +
      "배고파.";
    const regen = buildContext({
      charName: "레온",
      chunks: [chunk],
      userNickname: "렌",
      shortTermHistory,
      currentUserMessage: regenMsg,
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
      targetResponseChars: 3200,
      regenerate: true,
      rejectedAssistantDraft: "긴 초안. ".repeat(200),
    });
    const regenUser = regen.history.at(-1)!;
    assert.match(regenUser.content, /\[SHORT USER TURN\]/);
    assert.match(regenUser.content, /\[REGEN LENGTH\]/);
    assert.equal((regenUser.content.match(/\[SHORT USER TURN\]/g) ?? []).length, 1);

    const qwen = buildContext({
      charName: "레온",
      chunks: [chunk],
      userNickname: "렌",
      shortTermHistory,
      currentUserMessage: "배고파.",
      nsfw: false,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      targetResponseChars: 3200,
    });
    assert.doesNotMatch(qwen.history.at(-1)!.content, /\[SHORT USER TURN\]/);
  });

  it("does not remap greeting for Qwen (non-DeepSeek)", () => {
    const shortTermHistory = rawRecentTurnsToHistory(
      messagesToTurns([{ role: "assistant", content: GREETING, model: "greeting" }])
    );
    const built = buildContext({
      charName: "레온",
      chunks: [chunk],
      userNickname: "렌",
      shortTermHistory,
      currentUserMessage: "렌이 식탁에 앉았다.",
      nsfw: false,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      targetResponseChars: 3200,
    });
    const prior = built.history.slice(0, -1);
    assert.ok(prior.some((m) => m.role === "assistant" && m.content.includes("손전등을")));
    const lastUser = built.history.at(-1)!;
    assert.doesNotMatch(lastUser.content, /OPENING SCENE CONTEXT/);
  });

  it("keeps real playable assistant turns in history after peeling opening", () => {
    const shortTermHistory = rawRecentTurnsToHistory(
      messagesToTurns([
        { role: "assistant", content: GREETING, model: "greeting" },
        { role: "user", content: "응." },
        {
          role: "assistant",
          content: "레온은 짧게 고개를 끄덕였다.\n\n\"알겠습니다.\"",
          model: "deepseek/deepseek-v4-pro",
        },
      ])
    );
    const built = buildContext({
      charName: "레온",
      chunks: [chunk],
      userNickname: "렌",
      shortTermHistory,
      currentUserMessage: "괜찮아?",
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
      targetResponseChars: 3200,
    });
    const prior = built.history.slice(0, -1);
    assert.ok(prior.some((m) => m.role === "assistant" && m.content.includes("알겠습니다")));
    assert.ok(!prior.some((m) => m.role === "assistant" && m.content.includes("손전등을")));
  });
});
