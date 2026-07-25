import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRuntimeSpeechStyleMetadata,
  containsTrapPhrases,
  extractSpeechStyleFingerprint,
  MUSE_EXAMPLE_DIALOG_TRAP_PHRASES,
  sanitizeExampleDialogRuntimeText,
  sanitizeSpeechMetadataInSettingText,
  sanitizeSpeechProfileRuntimeJson,
} from "@/lib/museExampleDialogBoundary";

const EXAMPLE_DIALOG = [
  "[말투 — GENERATION METADATA · NEVER NARRATE]",
  "Apply only when writing [A] quoted dialogue. Not in-world facts.",
  "",
  "style_notes (do not narrate — dialogue only):",
  '- formal honorific speech; hesitates under pressure;',
  '- “처음 뵙겠습니다. S급 수계 센티넬, 코드네임 플러드입니다.”,',
  '- “...생각보다 활발하시군요.”,',
  '- “그렇게 가까이 오시면... 조금 곤란합니다.”,',
  '- “낯선 사람을 상대하는 건 아직 익숙하지 않습니다.”,',
].join("\n");

const SPEECH_PERSONALITY = "formal, honorific, socially cautious";
const SPEECH_TRAITS = "hesitates; self-corrects; apologizes; indirect phrasing";
const CHARACTER_PERSONALITY = "사회성이 서툰 엘리트. 긴장하면 손에 땀 남. 스킨십 꺼려함.";

describe("museExampleDialogBoundary — style fingerprint extraction", () => {
  it("extracts register, formality, endings without raw example text", () => {
    const { fingerprint, coverage, missingFields } = extractSpeechStyleFingerprint(
      EXAMPLE_DIALOG,
      SPEECH_PERSONALITY,
      SPEECH_TRAITS,
      CHARACTER_PERSONALITY
    );
    assert.equal(coverage, "ok");
    assert.deepEqual(missingFields, []);
    assert.equal(fingerprint.formality, "formal");
    assert.ok(fingerprint.register.includes("formal") || fingerprint.register.includes("polite"));
    assert.ok(fingerprint.sentenceEndings.some((e) => /습니다|합니다|군요|시군요/.test(e)));
    assert.ok(fingerprint.hesitationPattern.includes("hesitates"));
    assert.ok(fingerprint.selfCorrectionPattern.includes("self-corrects") || fingerprint.selfCorrectionPattern === "none");
    assert.ok(fingerprint.apologyPattern.includes("apologetic") || fingerprint.apologyPattern === "none");
    assert.ok(fingerprint.directness.includes("indirect"));
    assert.ok(fingerprint.punctuationPattern.includes("ellipsis"));
  });

  it("flags insufficient coverage when no examples or metadata", () => {
    const { coverage, missingFields } = extractSpeechStyleFingerprint("", "", "", "");
    assert.equal(coverage, "STYLE_COVERAGE_INSUFFICIENT");
    assert.ok(missingFields.length > 0);
  });

  it("does not flag direct/fluent characters as coverage-insufficient", () => {
    const directDialog = [
      "[말투 — GENERATION METADATA]",
      "style_notes:",
      '- formal honorific speech; direct and fluent;',
      '- “안녕하세요. 오늘 미팅을 위해 준비된 자료를 바로 시작하겠습니다. 준비되셨습니까?”',
      '- “반갑습니다. 회의실로 안내해 드리겠습니다.”',
    ].join("\n");
    const { fingerprint, coverage, missingFields } = extractSpeechStyleFingerprint(
      directDialog,
      "formal, direct, fluent",
      "formal; direct; fluent",
      "단호하고 유창한 인물"
    );
    assert.equal(coverage, "ok");
    assert.ok(!missingFields.includes("hesitation/rhythm"));
    assert.equal(fingerprint.hesitationPattern, "none");
    assert.equal(fingerprint.cadence, "brief");
    assert.equal(fingerprint.formality, "formal");
  });
});

describe("museExampleDialogBoundary — sanitization", () => {
  it("removes trap phrases from example_dialog", () => {
    const out = sanitizeExampleDialogRuntimeText(EXAMPLE_DIALOG);
    assert.deepEqual(containsTrapPhrases(out), []);
    assert.ok(!out.includes("생각보다 활발"));
    assert.ok(!out.includes("가까이 오시면"));
  });

  it("removes dialogue_examples from speech_profile JSON", () => {
    const raw = JSON.stringify({
      speech_tone: "formal",
      dialogue_examples: ["그렇게 가까이 오시면 조금 곤란합니다"],
      ending_anchors: ["습니다", "군요"],
      speech_formality: "formal",
    });
    const out = sanitizeSpeechProfileRuntimeJson(raw);
    assert.ok(!out.includes("dialogue_examples"));
    assert.ok(!out.includes("ending_anchors"));
    assert.ok(!out.includes("가까이 오시면"));
    assert.ok(out.includes("speech_formality"));
  });

  it("returns empty string for malformed speech_profile JSON", () => {
    const out = sanitizeSpeechProfileRuntimeJson("{not valid json");
    assert.equal(out, "");
    const out2 = sanitizeSpeechProfileRuntimeJson("{\"dialogue_examples\": [\"그렇게 가까이 오시면\"]");
    assert.equal(out2, "");
  });

  it("removes speech metadata examples from combined setting", () => {
    const combined = `[말투]\n${EXAMPLE_DIALOG}\n\n[성격]\n차분함`;
    const out = sanitizeSpeechMetadataInSettingText(combined);
    assert.deepEqual(containsTrapPhrases(out), []);
    assert.ok(out.includes("[성격]"));
    assert.ok(out.includes("차분함"));
    assert.ok(!out.includes("가까이 오시면"));
  });
});

describe("museExampleDialogBoundary — full runtime assembly", () => {
  it("builds sanitized style metadata with preserved deterministic signals", () => {
    const { text, coverage, missingFields, signals } = buildRuntimeSpeechStyleMetadata({
      exampleDialog: EXAMPLE_DIALOG,
      speechProfileJson: JSON.stringify({
        speech_tone: "formal",
        dialogue_examples: ["그렇게 가까이 오시면 조금 곤란합니다"],
        speech_formality: "formal",
      }),
      combinedSetting: "[말투]\nformal",
      speechPersonality: SPEECH_PERSONALITY,
      speechTraits: SPEECH_TRAITS,
      characterPersonality: CHARACTER_PERSONALITY,
    });

    assert.equal(coverage, "ok");
    assert.deepEqual(missingFields, []);
    assert.deepEqual(containsTrapPhrases(text), []);
    assert.ok(signals.length > 0);
    assert.ok(text.includes("register:"));
    assert.ok(text.includes("honorificLevel:"));
    assert.ok(text.includes("formality:"));
    assert.ok(text.includes("hesitationPattern:"));
    assert.ok(text.includes("sentenceEndings:"));
    assert.ok(text.includes("directness:"));
    assert.ok(text.includes("punctuationPattern:"));
  });

  it("detects remaining trap phrases when sanitization fails", () => {
    const text = 'some text "생각보다 활발하시군요" and "그렇게 가까이 오시면 조금 곤란합니다"';
    const traps = containsTrapPhrases(text);
    assert.deepEqual(traps, ["생각보다 활발하시군요", "그렇게 가까이 오시면", "조금 곤란합니다"]);
  });

  it("deduplicates examples across multiple sources", () => {
    const { text } = buildRuntimeSpeechStyleMetadata({
      exampleDialog: EXAMPLE_DIALOG,
      speechProfileJson: JSON.stringify({
        speech_tone: "formal",
        dialogue_examples: ["조금 곤란합니다", "그렇게 가까이 오시면"],
        speech_formality: "formal",
      }),
      combinedSetting: `[말투]\n${EXAMPLE_DIALOG}`,
      speechPersonality: SPEECH_PERSONALITY,
      speechTraits: SPEECH_TRAITS,
      characterPersonality: CHARACTER_PERSONALITY,
    });
    assert.deepEqual(containsTrapPhrases(text), []);
  });

  it("replacement block is not larger than removed raw examples", () => {
    const combinedSetting = `[말투]\n${EXAMPLE_DIALOG}`;
    const rawChars = combinedSetting.length;
    const { text } = buildRuntimeSpeechStyleMetadata({
      exampleDialog: EXAMPLE_DIALOG,
      speechProfileJson: "",
      combinedSetting,
      speechPersonality: SPEECH_PERSONALITY,
      speechTraits: SPEECH_TRAITS,
      characterPersonality: CHARACTER_PERSONALITY,
    });
    assert.ok(
      text.length <= rawChars,
      `sanitized combined setting (${text.length} chars) should not exceed raw combined setting (${rawChars} chars)`
    );
  });
});
