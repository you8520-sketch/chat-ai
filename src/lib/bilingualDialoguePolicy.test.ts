import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBilingualDialoguePromptBlock,
  buildLangCriticalRule,
  resolveBilingualDialoguePolicyFromSources,
} from "@/lib/bilingualDialoguePolicy";

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

  it("buildLangCriticalRule allows foreign language only in quotes when bilingual", () => {
    const policy = resolveBilingualDialoguePolicyFromSources({
      systemPrompt: "[BILINGUAL: en+ko]",
    });
    assert.match(buildLangCriticalRule({ bilingual: policy }), /BILINGUAL DIALOGUE EXCEPTION/);
    assert.match(buildLangCriticalRule({ bilingual: policy }), /\[OUTPUT LANG\]/);
    assert.match(
      buildBilingualDialoguePromptBlock(
        policy as Extract<typeof policy, { enabled: true }>
      ),
      /English/
    );
  });

  it("buildLangCriticalRule references foreign-mixing rule for Korean-only output", () => {
    const block = buildLangCriticalRule();
    assert.match(block, /\[LANG · CRITICAL\]/);
    assert.match(block, /NO English sentences\/words/);
    assert.match(block, /\[NO FOREIGN LANGUAGE MIXING\]/);
    assert.match(block, /\[CORE RP\] §6/);
  });

  it("returns disabled when no bilingual intent", () => {
    const policy = resolveBilingualDialoguePolicyFromSources({
      systemPrompt: "평범한 한국 캐릭터. 한국어로만 대화한다.",
    });
    assert.equal(policy.enabled, false);
  });
});
