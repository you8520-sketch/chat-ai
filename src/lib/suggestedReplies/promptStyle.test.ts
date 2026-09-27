import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildPostTurnSharedInitialSystem } from "@/lib/postTurnSharedInitial/prompt";
import type { PostTurnSharedInitialInput } from "@/lib/postTurnSharedInitial/types";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import {
  buildSuggestedReplyCoreGenerationRules,
  suggestedReplyLengthPromptClause,
  suggestedReplyUserTurnFormatPromptClause,
} from "./promptStyle";
import { suggestedRepliesExtractSystemForTest } from "./extract";
import { parseSuggestedRepliesFromModelText } from "./parse";
import { observeSuggestedRepliesDecisionQuality } from "./decisionQualityObservatory";
import { SUGGESTED_REPLY_MAX_CHARS, SUGGESTED_REPLY_MIN_CHARS } from "./types";

function sharedSuggestionsInput(): PostTurnSharedInitialInput {
  return {
    mode: "dual",
    charName: "레온",
    characterIdentity: "캐릭터 정체성",
    characterCriticalContext: "중요 설정",
    personaName: "렌",
    userMessage: "커피에 시럽을 두 번 넣어.",
    assistantProse: "알겠어, 두 번 넣어줄게.",
    previousAssistantProse: "이전 턴 assistant prose",
    characterWidget: DEFAULT_STATUS_WIDGET,
    userWidget: DEFAULT_STATUS_WIDGET,
    primaryModelId: "gpt-5.6-luna",
    includeSuggestions: true,
    includeRelationship: false,
    includeEpisodic: false,
    relationshipRegenContext: null,
  };
}

describe("suggested reply prompt style owner", () => {
  it("length clause references canonical constants only", () => {
    assert.match(
      suggestedReplyLengthPromptClause(),
      new RegExp(`${SUGGESTED_REPLY_MIN_CHARS}–${SUGGESTED_REPLY_MAX_CHARS}`)
    );
    assert.doesNotMatch(suggestedReplyLengthPromptClause(), /200/);
  });

  it("requires action/narration plus dialogue in shared and standalone prompts", () => {
    const core = buildSuggestedReplyCoreGenerationRules();
    assert.match(core, /Combine one concise action or narration beat with at least one spoken line/i);
    assert.match(core, /plain Korean prose/i);
    assert.match(core, /double quotes/i);

    const shared = buildPostTurnSharedInitialSystem(sharedSuggestionsInput());
    assert.match(shared, /Combine one concise action or narration beat with at least one spoken line/i);
    assert.match(
      shared,
      new RegExp(`${SUGGESTED_REPLY_MIN_CHARS}–${SUGGESTED_REPLY_MAX_CHARS}`)
    );

    const standalone = suggestedRepliesExtractSystemForTest();
    assert.match(standalone, /Each text MUST read like one user RP message/);
    assert.doesNotMatch(standalone, /50–200/);
  });
});

describe("suggested reply output fixtures", () => {
  const dialogueOnlyShort =
    "응. 매일은 푹 쉬고 저녁 먹은 뒤에 같이 올라가자.";

  it("dialogue-only short output passes production normalization but flags quality telemetry", () => {
    const raw = JSON.stringify({
      items: [
        { kind: "natural", text: dialogueOnlyShort },
        { kind: "twist", text: `${dialogueOnlyShort} 다른 각.` },
        { kind: "banter", text: `${dialogueOnlyShort} 장난.` },
      ],
    });
    const observation = observeSuggestedRepliesDecisionQuality(raw);
    assert.ok(observation.issues.includes("text_out_of_bounds"));
    const parsed = parseSuggestedRepliesFromModelText(raw);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0]?.text, dialogueOnlyShort);
  });

  it("narration + dialogue fixture survives normalization", () => {
    const natural =
      '잠깐 고개를 끄덕이며 옆을 바라본다. "응. 오늘은 푹 쉬고 저녁 먹은 뒤에 같이 올라가자."';
    const twist =
      '창밖을 한 번 본다. "그 전에, 네가 먼저 확인하고 싶은 게 뭐야?"';
    const banter =
      '입꼬리를 올린다. "매일 그 얘기만 하면 내가 질투 나."';
    const parsed = parseSuggestedRepliesFromModelText(
      JSON.stringify({
        items: [
          { kind: "natural", text: natural },
          { kind: "twist", text: twist },
          { kind: "banter", text: banter },
        ],
      })
    );
    assert.deepEqual(
      parsed.map((item) => item.kind),
      ["natural", "twist", "banter"]
    );
    assert.notEqual(parsed[0]?.text, dialogueOnlyShort);
  });

  it(">150 chars clamp in production normalization", () => {
    const longText = `${"*한숨을 쉬며* \"계속 말해.\" "}${"가".repeat(200)}`;
    const parsed = parseSuggestedRepliesFromModelText(
      JSON.stringify({
        items: [
          { kind: "natural", text: longText },
          { kind: "twist", text: '*고개를 돌리며* "다른 선택은?"' },
          { kind: "banter", text: '*웃으며* "이번엔 네 차례."' },
        ],
      })
    );
    assert.equal(parsed[0]?.text.length, SUGGESTED_REPLY_MAX_CHARS);
  });
});

describe("SuggestedRepliesBar UI regression", () => {
  it("renders recommendation body only — no user-facing kind labels or hints", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SuggestedRepliesBar.tsx"),
      "utf8"
    );
    assert.doesNotMatch(source, /suggestedReplyKindMeta/);
    assert.doesNotMatch(source, /meta\.label/);
    assert.doesNotMatch(source, /meta\.hint/);
    assert.doesNotMatch(source, /SUGGESTED_REPLIES_CAPTION/);
    assert.match(source, /onPick\(item\.text\)/);
    assert.match(source, /aria-label=\{item\.text\}/);
  });
});
