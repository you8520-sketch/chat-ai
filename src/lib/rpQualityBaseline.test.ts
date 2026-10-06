import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { COMMON_PROSE_BLOCK } from "@/lib/advancedProseNsfwGuidelines";
import {
  visibleAssistantDisplayCharCount,
  visibleAssistantDisplayText,
} from "@/lib/chatDisplayLength";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { UNIFIED_TIER_AIM_CHARS } from "@/lib/responseLengthConstants";
import {
  AUTO_REFUND_DAILY_LIMIT,
  AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS,
  REPORT_REFUND_WINDOW_MS,
  isAutoRefundUnderLengthEvidence,
} from "@/lib/reportRefundPolicy";
import {
  classifyVisibleLength,
  countVisibleParagraphs,
  estimateDialogueShare,
} from "@/lib/rpQualityBaseline";
import {
  RP_QUALITY_RUBRIC,
  RP_QUALITY_RUBRIC_TOTAL,
  authoringEvaluationNotes,
  buildQualityEvaluationContract,
  buildQualityOutputPacket,
  liveAuthoringCapabilityMatrix,
} from "@/lib/rpQualityEvaluationPacket";
import {
  GEMINI_38_FLASH_MODEL,
  isCheaperInferenceModel,
} from "@/lib/chatModels";
import { TRPG_BOT_MODEL, TRPG_GM_MODEL } from "@/lib/trpg/types";

describe("rp product quality baseline", () => {
  it("keeps generation steering at 3200+ without treating exact 3200 as acceptance", () => {
    assert.equal(UNIFIED_TIER_AIM_CHARS, 3200);
    const contract = buildQualityEvaluationContract();
    assert.equal(contract.steeringSoftAimChars, UNIFIED_TIER_AIM_CHARS);
    assert.equal(contract.exactLengthIsNotAcceptance, true);
    assert.equal(contract.cursorScores, false);
    assert.equal(contract.lengthServesQuality, true);
    const baselineSrc = readFileSync("src/lib/rpQualityBaseline.ts", "utf8");
    assert.doesNotMatch(baselineSrc, /RP_QUALITY_STEERING_SOFT_AIM_CHARS|=\s*3200/);
  });

  it("classifies visible length with inclusive <=1000 refund evidence", () => {
    assert.equal(AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS, 1000);
    assert.equal(isAutoRefundUnderLengthEvidence(0), true);
    assert.equal(isAutoRefundUnderLengthEvidence(500), true);
    assert.equal(isAutoRefundUnderLengthEvidence(1000), true);
    assert.equal(isAutoRefundUnderLengthEvidence(1001), false);
    assert.equal(classifyVisibleLength(1000), "refund_evidence");
    assert.equal(classifyVisibleLength(1001), "short_risk");
    assert.equal(classifyVisibleLength(1500), "short_risk");
    assert.equal(classifyVisibleLength(1501), "short_acceptable");
    assert.equal(classifyVisibleLength(2699), "short_acceptable");
    assert.equal(classifyVisibleLength(2700), "center_band");
    assert.equal(classifyVisibleLength(3000), "center_band");
    assert.equal(classifyVisibleLength(3500), "center_band");
    assert.equal(classifyVisibleLength(3501), "long_ok");
  });

  it("records deterministic length metadata without scoring", () => {
    const text = "첫 문단.\n\n「안녕.」\n\n둘째 문단.";
    const packet = buildQualityOutputPacket({
      opaqueLabel: "Q-1",
      generatedText: text,
      authoringLevel: "NORMAL",
      turnKind: "manual",
      contentMode: "SAFE",
      model: "deepseek-v4.1-flash",
      sceneClass: "quiet_window_safe",
    });
    assert.equal(packet.metadata.visibleChars, visibleAssistantDisplayCharCount(text));
    assert.equal(packet.generatedText, text);
    assert.equal(
      packet.metadata.paragraphCount,
      countVisibleParagraphs(visibleAssistantDisplayText(text))
    );
    assert.equal(packet.metadata.paragraphCount, 3);
    assert.ok(estimateDialogueShare(visibleAssistantDisplayText(text)) != null);
    assert.equal(packet.scores.natural_korean, null);
    assert.equal(packet.adultOverlay, null);
  });

  it("reuses canonical visible projection when raw and visible length differ", () => {
    const generatedText = [
      "역할 몰입 중, 성인 콘텐츠 허용 확인됨",
      "[SPEECH PROFILE test]",
      "첫 문단.",
      "",
      "「안녕.」",
      "",
      "둘째 문단.",
      "[태그: 진지함]",
      "```html",
      '<div style="x"><p>상태창 HP 80</p></div>',
      "```",
    ].join("\n");
    assert.notEqual(generatedText.length, visibleAssistantDisplayCharCount(generatedText));
    assert.notEqual(generatedText.trim().length, visibleAssistantDisplayCharCount(generatedText));
    const packet = buildQualityOutputPacket({
      opaqueLabel: "Q-VISIBLE",
      generatedText,
      authoringLevel: "NORMAL",
      turnKind: "manual",
      contentMode: "SAFE",
    });
    const visibleText = visibleAssistantDisplayText(generatedText);
    assert.equal(packet.generatedText, generatedText);
    assert.equal(packet.metadata.visibleChars, visibleAssistantDisplayCharCount(generatedText));
    assert.equal(packet.metadata.lengthClass, classifyVisibleLength(packet.metadata.visibleChars));
    assert.equal(packet.metadata.paragraphCount, countVisibleParagraphs(visibleText));
    assert.equal(packet.metadata.dialogueShareEstimate, estimateDialogueShare(visibleText));
    assert.ok(packet.metadata.visibleChars < generatedText.length);
    assert.doesNotMatch(visibleText, /SPEECH PROFILE/);
    assert.doesNotMatch(visibleText, /\[태그:/);
    assert.doesNotMatch(visibleText, /<div/);
  });

  it("uses the live authoring capability matrix", () => {
    assert.deepEqual(liveAuthoringCapabilityMatrix(), {
      LIMITED: {
        allowDialogue: false,
        allowMajorActions: false,
        allowInnerPov: false,
        allowIrreversibleFate: false,
      },
      NORMAL: {
        allowDialogue: true,
        allowMajorActions: true,
        allowInnerPov: false,
        allowIrreversibleFate: false,
      },
      ALLOW: {
        allowDialogue: true,
        allowMajorActions: true,
        allowInnerPov: true,
        allowIrreversibleFate: false,
      },
    });
    assert.match(authoringEvaluationNotes("LIMITED").join(" "), /Do not invent/);
    assert.match(authoringEvaluationNotes("NORMAL").join(" "), /Do not deduct/);
    assert.match(authoringEvaluationNotes("ALLOW").join(" "), /Inner POV is allowed/);
  });

  it("rubric weights sum to 100 and packet leaves scores empty", () => {
    assert.equal(
      RP_QUALITY_RUBRIC.reduce((sum, row) => sum + row.max, 0),
      RP_QUALITY_RUBRIC_TOTAL
    );
    const adult = buildQualityOutputPacket({
      opaqueLabel: "A-1",
      generatedText: "성인 장면 본문.",
      authoringLevel: "ALLOW",
      turnKind: "manual",
      contentMode: "19+",
    });
    assert.deepEqual(adult.adultOverlay, {});
  });

  it("does not change prompt owners or refund window / daily limit", () => {
    assert.ok(COMMON_PROSE_BLOCK.includes("[COMMON PROSE]"));
    assert.ok(USER_TAIL_LENGTH_OWNER_SENTENCE.trim().length > 0);
    assert.equal(REPORT_REFUND_WINDOW_MS, 24 * 60 * 60 * 1000);
    assert.equal(AUTO_REFUND_DAILY_LIMIT, 3);
    const baselineSrc = readFileSync("src/lib/rpQualityBaseline.ts", "utf8");
    const packetSrc = readFileSync("src/lib/rpQualityEvaluationPacket.ts", "utf8");
    assert.doesNotMatch(baselineSrc, /COMMON_PROSE_BLOCK/);
    assert.doesNotMatch(packetSrc, /USER_TAIL_LENGTH_OWNER_SENTENCE/);
  });

  it("uses the live Main RP registry as the quality benchmark set", () => {
    assert.equal(TRPG_GM_MODEL, GEMINI_38_FLASH_MODEL);
    assert.equal(TRPG_BOT_MODEL, GEMINI_38_FLASH_MODEL);
    assert.equal(isCheaperInferenceModel(GEMINI_38_FLASH_MODEL), true);
    const contract = buildQualityEvaluationContract();
    assert.deepEqual(
      [...contract.benchmarkModels].sort(),
      ["Claude Opus 5.5", "DeepSeek V4.1 Flash", "GPT-6.1 Sol", "Gemini 3.8 Flash"].sort()
    );
    assert.equal(contract.benchmarkModels.includes("Gemini 3.1 Pro Preview"), false);
    assert.equal(contract.benchmarkModels.includes("Gemini 3.7 Flash"), false);
  });
});
