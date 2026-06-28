import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildContext } from "./contextBuilder";

const assistantWithArtifacts =
  "RP 본문입니다.\n\n| stat | val |\n|:---:|:---:|\n| HP | 100 |\n\n```html\n<div>card</div>\n```";

describe("buildContext — OpenRouter flash firewall", () => {
  it("strips html and pipe tables from assistant history for OpenRouter", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "안녕" },
        { role: "assistant", content: assistantWithArtifacts },
      ],
      currentUserMessage: "다음",
      nsfw: false,
      provider: "openrouter",
    });

    const assistantTurn = built.history.find((m) => m.role === "assistant");
    assert.ok(assistantTurn);
    assert.equal(assistantTurn!.content, "RP 본문입니다.");
    assert.doesNotMatch(assistantTurn!.content, /```html/);
    assert.doesNotMatch(assistantTurn!.content, /\| stat/);
  });

  it("does not inject recent-narrative-context or state-window-policy for OpenRouter", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [{ role: "user", content: "안녕" }],
      currentUserMessage: "다음",
      nsfw: false,
      provider: "openrouter",
      longTermMemory: "[현재기억]\n요약 본문",
      recentNarrativeContext: "[RECENT NARRATIVE CONTEXT]\n요약 본문",
      userNote: "ooc:다음상태창을 본문하단에 HTML을 사용하여 표기할것\nNPC 속마음",
    });

    const ids = built.meta.trackedSections?.map((s) => s.id) ?? [];
    assert.doesNotMatch(ids.join(","), /recent-narrative-context/);
    assert.doesNotMatch(ids.join(","), /state-window-policy/);
    assert.doesNotMatch(ids.join(","), /openrouter-flash-owned-firewall/);
  });

  it("preserves assistant html for gemini provider", () => {
    const built = buildContext({
      charName: "Test",
      chunks: [],
      userNickname: "User",
      shortTermHistory: [
        { role: "user", content: "안녕" },
        { role: "assistant", content: assistantWithArtifacts },
      ],
      currentUserMessage: "다음",
      nsfw: false,
      provider: "gemini",
    });

    const assistantTurn = built.history.find((m) => m.role === "assistant");
    assert.ok(assistantTurn);
    assert.match(assistantTurn!.content, /```html/);
    assert.match(assistantTurn!.content, /\| stat/);
  });
});
