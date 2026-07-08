import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKeywordLorebookPromptBlock,
  matchKeywordLorebookEntries,
  type KeywordLorebookEntry,
} from "@/lib/keywordLorebooks";

const entries: KeywordLorebookEntry[] = [
  {
    keywords: ["레온", "Leon"],
    content: "레온은 렌의 오래된 조력자다.",
  },
  {
    keywords: ["칼리안"],
    content: "칼리안은 북부 기사단 소속이다.",
  },
];

describe("matchKeywordLorebookEntries", () => {
  it("matches keywords from recent dialogue scan text even when current input omits them", () => {
    const currentUserMessage = "그 사람에 대해서 더 말해줘.";
    const recentDialogue = '레온이 조용히 말했다. "칼리안이 곧 도착할 거야."';
    const matched = matchKeywordLorebookEntries(entries, `${currentUserMessage}\n${recentDialogue}`);

    assert.deepEqual(matched, [
      "레온은 렌의 오래된 조력자다.",
      "칼리안은 북부 기사단 소속이다.",
    ]);
  });

  it("matches latin keywords case-insensitively", () => {
    assert.deepEqual(matchKeywordLorebookEntries(entries, "leon mentioned the old gate"), [
      "레온은 렌의 오래된 조력자다.",
    ]);
  });
});

describe("buildKeywordLorebookPromptBlock", () => {
  it("labels keyword lorebook as recent dialogue/current input matching", () => {
    const block = buildKeywordLorebookPromptBlock(["내용"]);

    assert.match(block, /최근 대화\/유저 입력 키워드 매칭/);
  });
});
