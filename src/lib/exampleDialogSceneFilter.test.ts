import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterExampleDialogInSetting,
  filterTaggedExampleDialogBody,
  inferSceneRegisterContext,
  stripLeadingContextTag,
  validateBracketTaggedExampleDialog,
} from "./exampleDialogSceneFilter";

describe("exampleDialogSceneFilter", () => {
  const taggedBody = `[공적] 유저: 적이다!
레온: …각오하십시오.
[사적] 유저: 괜찮아?
레온: …괜찮아요.
[침대] 유저: …불 끌까?
레온: …그래요.`;

  it("stripLeadingContextTag parses bracket tags", () => {
    assert.deepEqual(stripLeadingContextTag("[침대] 유저: hi"), { tag: "침대", rest: "유저: hi" });
  });

  it("inferSceneRegisterContext prioritizes bed cues", () => {
    assert.equal(
      inferSceneRegisterContext({ userMessage: "…불 끌까?", recentHistory: "" }),
      "bed"
    );
    assert.equal(
      inferSceneRegisterContext({ userMessage: "적이다!", recentHistory: "전장" }),
      "public"
    );
  });

  it("filterTaggedExampleDialogBody keeps bed pair with character line", () => {
    const bed = filterTaggedExampleDialogBody(taggedBody, "bed");
    assert.match(bed.filtered, /불 끌까/);
    assert.match(bed.filtered, /그래요/);
    assert.doesNotMatch(bed.filtered, /각오하십시오/);
    assert.equal(bed.injectedCount, 1);
  });

  // Tagged composed creator block (production save shape): char-only lines
  // in [예시 대사] + metadata sections, after auto-tag adapter has run.
  const taggedComposedBody = `[예시 대사]
[사적] …괜찮아요. 별일 아니에요.
[공적] 명령을 기다리겠습니다.
[침대] …그래요. 이리 와요.

[SPEECH CONSISTENCY]
Dialogue style is learned primarily from dialogue examples.

[말투 — 특징]
짧은 문장, 낮은 목소리`;

  it("composed block: filters tagged lines but ALWAYS keeps metadata sections", () => {
    const pub = filterTaggedExampleDialogBody(taggedComposedBody, "public");
    assert.match(pub.filtered, /명령을 기다리겠습니다/);
    assert.doesNotMatch(pub.filtered, /이리 와요/);
    // Untagged metadata must survive filtering
    assert.match(pub.filtered, /\[SPEECH CONSISTENCY\]/);
    assert.match(pub.filtered, /Dialogue style is learned/);
    assert.match(pub.filtered, /\[말투 — 특징\]/);
    assert.match(pub.filtered, /짧은 문장, 낮은 목소리/);
    // Section headers must not swallow following tagged lines
    const bed = filterTaggedExampleDialogBody(taggedComposedBody, "bed");
    assert.match(bed.filtered, /이리 와요/);
    assert.doesNotMatch(bed.filtered, /명령을 기다리겠습니다/);
    assert.match(bed.filtered, /\[SPEECH CONSISTENCY\]/);
  });

  it("filterExampleDialogInSetting rewrites [예시 대화] when env enabled", () => {
    const prev = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";
    try {
      const setting = `# 말투\n공적: 다나까\n\n[예시 대화]\n${taggedBody}`;
      const out = filterExampleDialogInSetting(setting, {
        userMessage: "…가까이 와도 돼?",
        recentHistory: "…불 끌까?",
      });
      assert.match(out, /\[예시 대화\]/);
      assert.match(out, /그래요/);
      assert.doesNotMatch(out, /각오하십시오/);
    } finally {
      if (prev === undefined) delete process.env.EXAMPLE_DIALOG_SCENE_FILTER;
      else process.env.EXAMPLE_DIALOG_SCENE_FILTER = prev;
    }
  });

  it("passes through untagged legacy examples", () => {
    const prev = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";
    try {
      const legacy = `유저: hi\n캐: …hello`;
      const setting = `[예시 대화]\n${legacy}`;
      const out = filterExampleDialogInSetting(setting, { userMessage: "bed" });
      assert.match(out, /유저: hi/);
      assert.match(out, /캐: …hello/);
    } finally {
      if (prev === undefined) delete process.env.EXAMPLE_DIALOG_SCENE_FILTER;
      else process.env.EXAMPLE_DIALOG_SCENE_FILTER = prev;
    }
  });

  it("filter disabled leaves tagged example unchanged", () => {
    const prev = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    delete process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    try {
      const setting = `[예시 대화]\n[침대] 유저: hi\n캐: …yo`;
      const out = filterExampleDialogInSetting(setting, { userMessage: "불 끌까?" });
      assert.match(out, /\[침대\]/);
    } finally {
      if (prev === undefined) delete process.env.EXAMPLE_DIALOG_SCENE_FILTER;
      else process.env.EXAMPLE_DIALOG_SCENE_FILTER = prev;
    }
  });

  it("empty example section does not throw", () => {
    const prev = process.env.EXAMPLE_DIALOG_SCENE_FILTER;
    process.env.EXAMPLE_DIALOG_SCENE_FILTER = "1";
    try {
      const setting = `# 말투\n해요체\n\n[성격]\n냉정`;
      const out = filterExampleDialogInSetting(setting, { userMessage: "test" });
      assert.equal(out, setting);
    } finally {
      if (prev === undefined) delete process.env.EXAMPLE_DIALOG_SCENE_FILTER;
      else process.env.EXAMPLE_DIALOG_SCENE_FILTER = prev;
    }
  });

  it("single-bucket [사적]-only block: public scene falls back to ALL pairs (하유진/그룹2 pattern)", () => {
    const privateOnly = `[사적] 유저: (명령하듯) 고개를 들어라.
하유진: 아, 예. 위대하신 황족 나리께서 친히 살려주셔서 정말 감~사하네요.
[사적] 유저: 밥 가져왔어.
하유진: 독이라도 탔나? ...역겨우니까 그거 치워.`;
    const pub = filterTaggedExampleDialogBody(privateOnly, "public");
    assert.equal(pub.hadTags, true);
    assert.equal(pub.injectedCount, 2);
    assert.match(pub.filtered, /감~사하네요/);
    assert.match(pub.filtered, /역겨우니까/);

    const priv = filterTaggedExampleDialogBody(privateOnly, "private");
    assert.equal(priv.injectedCount, 2);
  });

  it("mixed-register lines inside one pair survive filtering verbatim", () => {
    const body = `[사적] 유저: 목줄 확인 좀 할게.
하유진: 내 목에 목줄 채우니까 재밌어? 변태 새끼들.
하유진: 아, 예~ 마음껏 확인하세요, 고귀하신 분.`;
    const out = filterTaggedExampleDialogBody(body, "private");
    assert.match(out.filtered, /변태 새끼들\./);
    assert.match(out.filtered, /마음껏 확인하세요, 고귀하신 분\./);
    assert.doesNotMatch(out.filtered, /\[사적\]/);
  });

  it("does not treat unbracketed card prose as tag (Step 4)", () => {
    const stripped = stripLeadingContextTag("공적: …각오하십시오.");
    assert.equal(stripped.tag, null);
    assert.equal(stripped.rest, "공적: …각오하십시오.");

    const body = "공적: …각오하십시오.\n레온: …각오하십시오.";
    const filtered = filterTaggedExampleDialogBody(body, "public");
    assert.equal(filtered.hadTags, false);
    assert.match(filtered.filtered, /공적:/);
  });

  it("validateBracketTaggedExampleDialog accepts Leon staging shape", () => {
    const leon = `[공적] 유저: 적이다!
레온: …각오하십시오.
[사적] 유저: 괜찮아?
레온: …괜찮아요.
[침대] 유저: …불 끌까?
레온: …그래요.`;
    const v = validateBracketTaggedExampleDialog(leon);
    assert.equal(v.valid, true, v.errors.join("; "));
    assert.equal(v.bracketTagLineCount, 3);
  });

  it("validateBracketTaggedExampleDialog rejects unbracketed 공적:", () => {
    const bad = `공적: …각오하십시오.
레온: …각오하십시오.`;
    const v = validateBracketTaggedExampleDialog(bad);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => e.includes("Unbracketed") || e.includes("Card-prose")));
  });
});
