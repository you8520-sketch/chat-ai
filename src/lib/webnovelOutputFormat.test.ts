import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WEBNOVEL_OUTPUT_FORMAT_BLOCK,
  buildWebnovelOutputLayoutRecencyBlock,
  buildUserInputParsingBlock,
  containsParagraphLayoutInstructions,
  unwrapRoleplayMarkdownInText,
} from "@/lib/webnovelOutputFormat";
import { buildAdvancedProseNsfwGuidelines } from "@/lib/advancedProseNsfwGuidelines";
import { buildUserActionThoughtRule } from "@/lib/userActionThoughtRules";

describe("webnovelOutputFormat", () => {
  it("WEBNOVEL_OUTPUT_FORMAT has marker bans only — no paragraph layout", () => {
    assert.match(WEBNOVEL_OUTPUT_FORMAT_BLOCK, /\[WEBNOVEL OUTPUT FORMAT\]/);
    assert.match(WEBNOVEL_OUTPUT_FORMAT_BLOCK, /마크다운\/RP 표기/);
    assert.doesNotMatch(WEBNOVEL_OUTPUT_FORMAT_BLOCK, /Dialogue uses " "/);
    assert.doesNotMatch(WEBNOVEL_OUTPUT_FORMAT_BLOCK, /\[OUTPUT LAYOUT\]/);
    assert.doesNotMatch(WEBNOVEL_OUTPUT_FORMAT_BLOCK, /append spoken dialogue/i);
  });

  it("buildWebnovelOutputLayoutRecencyBlock is the sole layout source", () => {
    const block = buildWebnovelOutputLayoutRecencyBlock();
    assert.match(block, /\[OUTPUT LAYOUT\]/);
    assert.equal((block.match(/\[OUTPUT LAYOUT\]/g) ?? []).length, 1);
    assert.match(block, /\[SEMANTIC PARAGRAPHING\]/);
    assert.match(block, /blank line/i);
    assert.match(block, /Never append dialogue/i);
    assert.match(block, /Wrong:/);
    assert.match(block, /Right:/);
    assert.match(block, /초점/);
    assert.match(block, /\[DIALOGUE & NARRATION\]/);
    assert.doesNotMatch(block, /Continuous narration stays in one paragraph/);
    assert.doesNotMatch(block, /emotional beat shifts/i);
    assert.doesNotMatch(block, /Output formatting only/i);
  });

  it("containsParagraphLayoutInstructions detects layout leaks", () => {
    assert.ok(containsParagraphLayoutInstructions(buildWebnovelOutputLayoutRecencyBlock()));
    assert.ok(!containsParagraphLayoutInstructions(WEBNOVEL_OUTPUT_FORMAT_BLOCK));
    assert.ok(!containsParagraphLayoutInstructions(buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false })));
  });

  it("buildUserInputParsingBlock is interpret-only — not output format", () => {
    const block = buildUserInputParsingBlock(false);
    assert.match(block, /INTERPRET \[B\] ONLY/);
    assert.match(block, /출력에 쓰지 않는다/);
    assert.ok(!block.includes("* * = observable action"));
  });

  it("buildUserActionThoughtRule delegates to input parsing block", () => {
    assert.equal(buildUserActionThoughtRule(true), buildUserInputParsingBlock(true));
  });

  it("unwrapRoleplayMarkdownInText strips asterisk narration wrappers", () => {
    assert.equal(
      unwrapRoleplayMarkdownInText('*레온의 어깨가 굳었다.*\n\n"...대화를 원하신다고요."'),
      '레온의 어깨가 굳었다.\n\n"...대화를 원하신다고요."'
    );
  });
});
