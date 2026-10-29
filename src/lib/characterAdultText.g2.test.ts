import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { findAdultTermsInText } from "@/lib/characterAdultText";

describe("G2 Korean see verb versus adult noun", () => {
  it("accepts G1 and ordinary negative verb inflections", () => {
    for (const text of [
      "사람을 소모품으로 보지 않으려 위험을 먼저 떠안지만...",
      "그를 보지 않았다.", "다시 보지 못했다.", "돌보지 못한 사람들",
      "함부로 바라보지 말아라.", "보지는 않았어.", "보지도 못했어.",
      "아직 보지\n않았다.",
    ]) assert.deepEqual(findAdultTermsInText(text), [], text);
  });
  it("retains independent nouns, particles, punctuation and obfuscations", () => {
    for (const text of ["보지", "보지를", "보지에", "보지의", "보지 속", "보지!", "보.지", "보 지", "보\u200b지", "보－지"]) {
      assert.ok(findAdultTermsInText(text).includes("보지"), text);
    }
    for (const [text, expected] of [["그를 보지 않고 섹스를 한다", "섹스"], ["보지 않았다. 보지를 만졌다", "보지"], ["blowjob", "blowjob"], ["보지 않고 자위를 한다", "자위"]]) {
      assert.ok(findAdultTermsInText(text!).includes(expected!), text);
    }
  });
});

describe("G3 adult-term boundaries", () => {
  it("allows ordinary place phrases and the see-verb, and still blocks real terms and bypasses", () => {
    for (const text of [
      "긴 탁자 위에는 통행 협약서가 펼쳐져 있었다.",
      "의자 위에 앉았다.",
      "상자 위를 열었다.",
      "책상 위에는 빈 확인란이 남아 있었다.",
      "사람을 소모품으로 보지 않으려 한다.",
      "그는 그 이름을 알아보지 못했다.",
    ]) assert.deepEqual(findAdultTermsInText(text), [], text);
    for (const text of ["자위", "자 위", "자.위", "자\u200b위", "자－위", "보지", "보 지", "섹 스"]) {
      assert.ok(findAdultTermsInText(text).length > 0, text);
    }
  });
  it("allows ordinary 사정 particles and still blocks the adult stem", () => {
    assert.deepEqual(findAdultTermsInText("단, 누구의 사정도 허락 없이 종이에 올리진 않을"), []);
    assert.deepEqual(findAdultTermsInText("사정이 생겨서 자리를 비웠다"), []);
    for (const text of ["사정", "사정을", "사정했다", "사 정"]) {
      assert.ok(findAdultTermsInText(text).includes("사정"), text);
    }
    assert.ok(findAdultTermsInText("폰섹스").includes("섹스"));
    const greeting = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "docs/official-supply/reviews/g5-1-2026-10-28/candidates/g5-modern-comedy-c/bible.assembled.json"),
        "utf8"
      )
    ).greeting as string;
    assert.match(greeting, /사정도/);
    assert.deepEqual(findAdultTermsInText(greeting), []);
  });
  it("still catches an unambiguous adult stem inside a compound", () => {
    for (const [text, expected] of [
      ["폰섹스", "섹스"],
      ["구강성교", "성교"],
      ["아동포르노", "포르노"],
      ["질삽입", "삽입"],
    ] as const) assert.ok(findAdultTermsInText(text).includes(expected), text);
  });
});
