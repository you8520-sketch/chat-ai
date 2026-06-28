import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBilingualDialoguePromptBlock,
  resolveBilingualDialoguePolicyFromSources,
} from "@/lib/bilingualDialoguePolicy";
import { buildOpenRouterKoreanProseTopBlock } from "@/lib/openRouterProsePolicy";

describe("bilingualDialoguePolicy", () => {
  it("detects explicit English tag", () => {
    const policy = resolveBilingualDialoguePolicyFromSources({
      systemPrompt: "미국인 캐릭터.\n[BILINGUAL DIALOGUE: en+ko]",
    });
    assert.equal(policy.enabled, true);
    if (!policy.enabled) return;
    assert.equal(policy.primary, "en");
    assert.equal(policy.source, "explicit_tag");
  });

  it("detects explicit Chinese tag", () => {
    const policy = resolveBilingualDialoguePolicyFromSources({
      systemPrompt: "[이중언어 대사: zh+ko] 북경 출신.",
    });
    assert.equal(policy.enabled, true);
    if (!policy.enabled) return;
    assert.equal(policy.primary, "zh");
    assert.match(policy.primaryDisplay, /中文/);
  });

  it("detects Japanese from creator text", () => {
    const policy = resolveBilingualDialoguePolicyFromSources({
      systemPrompt:
        "이중언어 대사: 일본어로 먼저 말하고 괄호 안에 한국어 번역을 넣는다.",
    });
    assert.equal(policy.enabled, true);
    if (!policy.enabled) return;
    assert.equal(policy.primary, "ja");
  });

  it("detects from example dialog pattern", () => {
    const policy = resolveBilingualDialoguePolicyFromSources({
      exampleDialog: '"你好。" (안녕.)',
    });
    assert.equal(policy.enabled, true);
    if (!policy.enabled) return;
    assert.equal(policy.primary, "zh");
  });

  it("OUTPUT LANG allows foreign language only in quotes when bilingual", () => {
    const policy = resolveBilingualDialoguePolicyFromSources({
      systemPrompt: "[BILINGUAL: en+ko]",
    });
    const block = buildOpenRouterKoreanProseTopBlock(
      policy.enabled ? policy : undefined
    );
    assert.match(block, /\[OUTPUT LANG — BILINGUAL DIALOGUE\]/);
    assert.doesNotMatch(block, /\[NO FOREIGN LANGUAGE MIXING\]/);
    assert.match(
      buildBilingualDialoguePromptBlock(
        policy as Extract<typeof policy, { enabled: true }>
      ),
      /English/
    );
  });

  it("OUTPUT LANG includes unified Korean-only language policy", () => {
    const block = buildOpenRouterKoreanProseTopBlock();
    assert.match(block, /\[OUTPUT LANG\]/);
    assert.match(block, /서술은 해체\(-다\)만 사용한다/);
    assert.match(block, /외국어 혼용 금지/);
    assert.doesNotMatch(block, /see \[/i);
    assert.doesNotMatch(block, /\[NO FOREIGN LANGUAGE MIXING\]/);
    assert.doesNotMatch(block, /\[LANG · CRITICAL\]/);
  });

  it("returns disabled when no bilingual intent", () => {
    const policy = resolveBilingualDialoguePolicyFromSources({
      systemPrompt: "평범한 한국 캐릭터. 한국어로만 대화한다.",
    });
    assert.equal(policy.enabled, false);
  });
});
