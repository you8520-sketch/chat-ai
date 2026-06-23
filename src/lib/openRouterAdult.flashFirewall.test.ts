import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { convertToOpenRouterFormat } from "@/lib/openRouterAdult";

describe("openRouterAdult — flash firewall history", () => {
  it("convertToOpenRouterFormat strips html and pipe tables from assistant turns", () => {
    const history = convertToOpenRouterFormat([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content:
          "RP\n\n| a | b |\n|:---:|:---:|\n| 1 | 2 |\n\n```html\n<div>x</div>\n```",
      },
      { role: "user", content: "next" },
    ]);

    const assistant = history.find((m) => m.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant!.content, "RP");
    assert.doesNotMatch(assistant!.content, /```html/);
    assert.doesNotMatch(assistant!.content, /\| a/);
  });
});
