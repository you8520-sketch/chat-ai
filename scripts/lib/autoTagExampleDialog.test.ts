import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  autoTagExampleDialog,
  autoTagComposedExampleDialog,
  autoTagExampleDialogDispatch,
  detectExampleDialogFormat,
  parseCardRegisterMap,
} from "./autoTagExampleDialog";

const LEON_SPEECH = `공적인 자리: 건조한 군대식 다나까체
유저와 둘만 있을 때: 해요체
침대: 속삭이는 해요체, 짧은 문장`;

describe("parseCardRegisterMap", () => {
  it("detects Leon-style context split", () => {
    const m = parseCardRegisterMap(LEON_SPEECH);
    assert.equal(m.hasContextSplit, true);
    assert.equal(m.publicRegister, "danakka");
    assert.equal(m.privateRegister, "haeyo");
  });

  it("single register card has no split", () => {
    const m = parseCardRegisterMap(`- 평소: "~요", "~죠" 등 정중한 존댓말`);
    assert.equal(m.hasContextSplit, false);
  });
});

describe("autoTagExampleDialog", () => {
  it("tags Leon-style untagged pairs (cue + register map), preserving dialogue text", () => {
    const raw = `유저: 적이다!
레온: …각오하십시오.
유저: 괜찮아?
레온: …괜찮아요.
유저: …불 끌까?
레온: …그래요.`;
    const r = autoTagExampleDialog(raw, LEON_SPEECH);
    assert.equal(r.valid, true, r.validationErrors.join("; "));
    assert.equal(r.pairCount, 3);
    assert.match(r.tagged, /\[공적\] 유저: 적이다!/);
    assert.match(r.tagged, /\[사적\] 유저: 괜찮아\?/);
    assert.match(r.tagged, /\[침대\] 유저: …불 끌까\?/);
    // Dialogue lines unchanged
    assert.match(r.tagged, /레온: …각오하십시오\./);
    assert.match(r.tagged, /레온: …괜찮아요\./);
  });

  it("keeps existing tags untouched", () => {
    const raw = `[공적] 유저: 적이다!
레온: …각오하십시오.
유저: 괜찮아?
레온: …괜찮아요.`;
    const r = autoTagExampleDialog(raw, LEON_SPEECH);
    assert.equal(r.pairs[0]!.source, "existing");
    assert.equal(r.pairs[0]!.tag, "public");
    assert.match(r.tagged, /^\[공적\] 유저: 적이다!/);
  });

  it("single-register character defaults ambiguous pairs to [사적]", () => {
    const raw = `유저: 따라와.
카인: …알았어.
유저: 위험해.
카인: …상관없어.`;
    const r = autoTagExampleDialog(raw, `- 평소: 반말, 짧은 문장`);
    assert.equal(r.valid, true);
    assert.equal(r.byTag["private"], 2);
    assert.equal(r.bySource["default_private"], 2);
  });

  it("register-map classifies untagged danakka line as public when cue is silent", () => {
    const raw = `유저: 그렇군.
레온: …명령을 기다리겠습니다.`;
    const r = autoTagExampleDialog(raw, LEON_SPEECH);
    // "그렇군" has no cue; danakka/formal ending → public via register map
    assert.equal(r.pairs[0]!.tag, "public");
    assert.equal(r.pairs[0]!.source, "register_map");
  });

  it("is idempotent — running twice produces identical output", () => {
    const raw = `유저: 적이다!
레온: …각오하십시오.
유저: 괜찮아?
레온: …괜찮아요.`;
    const once = autoTagExampleDialog(raw, LEON_SPEECH);
    const twice = autoTagExampleDialog(once.tagged, LEON_SPEECH);
    assert.equal(twice.tagged, once.tagged);
    assert.equal(twice.changed, false);
  });

  it("multi-line character responses stay with their pair", () => {
    const raw = `유저: 괜찮아?
레온: 레온은 고개를 저었다.
…괜찮아요.`;
    const r = autoTagExampleDialog(raw, LEON_SPEECH);
    assert.equal(r.pairCount, 1);
    assert.match(r.tagged, /\[사적\] 유저: 괜찮아\?/);
    assert.match(r.tagged, /…괜찮아요\./);
  });
});

// Real production shape from composeExampleDialog(): [예시 대사] with bare
// character lines, then metadata sections. No user lines anywhere.
const COMPOSED_BLOCK = `[예시 대사]
…괜찮아요. 별일 아니에요.
명령을 기다리겠습니다.
그쪽이야말로 조심해요.

[SPEECH CONSISTENCY]
Dialogue style is learned primarily from dialogue examples.
Trait descriptions are secondary.
When examples conflict with descriptions, examples always win.

[말투 — 특징]
짧은 문장, 낮은 목소리

[dialogue_avoid — generation only, never narrate]
과장된 웃음

[말투 — 성격]
과묵함`;

describe("detectExampleDialogFormat", () => {
  it("classifies pair format when user lines exist", () => {
    assert.equal(detectExampleDialogFormat("유저: hi\n레온: …네."), "pair");
  });

  it("classifies tagged pair format (tag before user line)", () => {
    assert.equal(detectExampleDialogFormat("[공적] 유저: hi\n레온: …네."), "pair");
  });

  it("classifies composed char-only block", () => {
    assert.equal(detectExampleDialogFormat(COMPOSED_BLOCK), "composed");
  });

  it("classifies headerless bare lines as composed", () => {
    assert.equal(detectExampleDialogFormat("…괜찮아요.\n명령을 기다리겠습니다."), "composed");
  });

  it("classifies empty", () => {
    assert.equal(detectExampleDialogFormat("   "), "empty");
  });
});

describe("autoTagComposedExampleDialog", () => {
  it("tags only [예시 대사] lines; metadata sections untouched", () => {
    const r = autoTagComposedExampleDialog(COMPOSED_BLOCK, LEON_SPEECH);
    assert.equal(r.valid, true, r.validationErrors.join("; "));
    // haeyo lines → private, danakka line → public (Leon-style split)
    assert.match(r.tagged, /\[사적\] …괜찮아요\. 별일 아니에요\./);
    assert.match(r.tagged, /\[공적\] 명령을 기다리겠습니다\./);
    assert.match(r.tagged, /\[사적\] 그쪽이야말로 조심해요\./);
    // Metadata sections must not be tagged
    assert.match(r.tagged, /\n\[SPEECH CONSISTENCY\]\nDialogue style is learned/);
    assert.doesNotMatch(r.tagged, /\[사적\] Dialogue style/);
    assert.doesNotMatch(r.tagged, /\[사적\] 짧은 문장/);
    assert.doesNotMatch(r.tagged, /\[사적\] 과장된 웃음/);
    assert.doesNotMatch(r.tagged, /\[사적\] 과묵함/);
  });

  it("single-register card: all lines default to [사적]", () => {
    const raw = `[예시 대사]
…알았어.
상관없어.`;
    const r = autoTagComposedExampleDialog(raw, "- 평소: 반말, 짧은 문장");
    assert.equal(r.byTag["private"], 2);
    assert.equal(r.bySource["default_private"], 2);
  });

  it("forceTag pins every line to [사적] regardless of register map", () => {
    const r = autoTagComposedExampleDialog(COMPOSED_BLOCK, LEON_SPEECH, { forceTag: "private" });
    assert.match(r.tagged, /\[사적\] 명령을 기다리겠습니다\./);
    assert.equal(r.byTag["public"] ?? 0, 0);
  });

  it("is idempotent", () => {
    const once = autoTagComposedExampleDialog(COMPOSED_BLOCK, LEON_SPEECH);
    const twice = autoTagComposedExampleDialog(once.tagged, LEON_SPEECH);
    assert.equal(twice.tagged, once.tagged);
    assert.equal(twice.changed, false);
    assert.equal(twice.alreadyTaggedCount, once.pairCount);
  });

  it("headerless bare-line block tags every line", () => {
    const r = autoTagComposedExampleDialog("…괜찮아요.\n명령을 기다리겠습니다.", LEON_SPEECH);
    assert.match(r.tagged, /\[사적\] …괜찮아요\./);
    assert.match(r.tagged, /\[공적\] 명령을 기다리겠습니다\./);
  });
});

describe("autoTagExampleDialogDispatch", () => {
  it("routes pair format to pair tagger — identical to direct call (Leon regression guard)", () => {
    const raw = `유저: 적이다!
레온: …각오하십시오.
유저: 괜찮아?
레온: …괜찮아요.`;
    const direct = autoTagExampleDialog(raw, LEON_SPEECH);
    const dispatched = autoTagExampleDialogDispatch(raw, LEON_SPEECH);
    assert.equal(dispatched.format, "pair");
    assert.equal(dispatched.tagged, direct.tagged);
  });

  it("routes composed block to line adapter", () => {
    const dispatched = autoTagExampleDialogDispatch(COMPOSED_BLOCK, LEON_SPEECH);
    assert.equal(dispatched.format, "composed");
    assert.match(dispatched.tagged, /\[공적\] 명령을 기다리겠습니다\./);
  });

  it("empty input returns empty result", () => {
    const r = autoTagExampleDialogDispatch("", LEON_SPEECH);
    assert.equal(r.format, "empty");
    assert.equal(r.changed, false);
  });
});
