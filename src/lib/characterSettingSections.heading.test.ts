import assert from "node:assert/strict";
import { describe, it } from "node:test";

import fs from "node:fs";
import path from "node:path";

import {
  isPlainCategoryLabelHeader,
  matchExplicitSectionHeading,
  parseCharacterSettingIntoSections,
} from "@/lib/characterSettingSections";
import { FIXTURES } from "../../data/canon-core-audit/d2-fixtures";
import { ENOCH_FIXTURES } from "../../data/canon-core-audit/d2-enoch-fixtures";

function loadPr620CharacterSource(): string {
  const dump = fs.readFileSync(
    path.join(
      process.cwd(),
      "docs/audits/real-production-mid-chat-style-handoff-benchmark/requests/T1-prompt_dump.txt"
    ),
    "utf8"
  );
  const m = dump.match(/### \[character-core-identity\][^\n]*\n([\s\S]*?)(?=\n### \[|$)/);
  if (!m?.[1]) throw new Error("PR620 character-core-identity missing");
  return m[1]
    .trim()
    .split(/\n\[WORLD CANON/)[0]
    .replace(/^\[CHARACTER CANON —[^\n]+\n/, "");
}

describe("section heading structure", () => {
  it("recognizes compact markdown headings", () => {
    assert.equal(matchExplicitSectionHeading("#센티넬")?.label, "센티넬");
    assert.equal(matchExplicitSectionHeading("##기본 특성")?.label, "기본 특성");
    assert.equal(matchExplicitSectionHeading("# spaced")?.label, "spaced");
  });

  it("treats markdown-bold labels as headings", () => {
    assert.equal(matchExplicitSectionHeading("과거·트라우마**: 11년 차")?.label, "과거·트라우마");
    assert.equal(matchExplicitSectionHeading("- **ID**: 44/F"), null);
  });

  it("does not treat body sentences as category headers", () => {
    assert.equal(isPlainCategoryLabelHeader("능력 사용 시 가이딩 수치가 지속적으로 소모됨"), false);
    assert.equal(isPlainCategoryLabelHeader("가족관계**: 부모를 잃고 10살 연상 누나에게 자랐다."), false);
    assert.equal(isPlainCategoryLabelHeader("과거·트라우마**: 11년 차 특수계."), false);
    assert.equal(isPlainCategoryLabelHeader("능력"), true);
    assert.equal(isPlainCategoryLabelHeader("성격"), true);
    assert.equal(isPlainCategoryLabelHeader("직업"), true);
    assert.equal(isPlainCategoryLabelHeader("체형"), true);
    assert.equal(isPlainCategoryLabelHeader("의상"), true);
  });

  it("keeps bracket profile headings", () => {
    const sections = parseCharacterSettingIntoSections(
      "[이름]\n레온\n\n[조아연(누나)]\n보호자.\n\n능력 사용 시 수치가 소모됨\n계속되는 본문."
    );
    assert.ok(sections.some((s) => s.title === "[이름]"));
    assert.ok(sections.some((s) => s.title.includes("조아연")));
    assert.equal(
      sections.some((s) => s.title.includes("능력 사용 시")),
      false
    );
  });
});

describe("cross-world parser fixtures", () => {
  it("fantasy quiet — bracket headings preserved, body sentences stay in body", () => {
    const raw = FIXTURES.find((f) => f.id === "fantasy-quiet")!.creatorRawDescription;
    const sections = parseCharacterSettingIntoSections(raw);
    assert.ok(sections.some((s) => s.title === "[이름]"));
    assert.ok(sections.some((s) => /세계관/.test(s.title)));
    assert.equal(sections.some((s) => /사용 시/.test(s.title)), false);
  });

  it("enoch apocalypse — law and world sections remain headers", () => {
    const raw = ENOCH_FIXTURES[0].creatorRawDescription;
    const sections = parseCharacterSettingIntoSections(raw);
    assert.ok(sections.some((s) => /불변/.test(s.title)));
    assert.ok(sections.some((s) => /마더/.test(s.title)));
    assert.equal(sections.some((s) => s.title.length > 80), false);
  });
});

describe("PR620 라이크 source — heading vs body", () => {
  it("compact markdown headings leave [정체성] and become their own sections", () => {
    const sections = parseCharacterSettingIntoSections(loadPr620CharacterSource());
    const titles = sections.map((s) => s.title);
    assert.ok(titles.includes("[정체성]"));
    assert.ok(titles.includes("[센티넬]"));
    assert.ok(titles.some((t) => t.includes("기본 특성")));
    assert.ok(titles.some((t) => t.includes("가이딩 수치")));
    const identity = sections.find((s) => s.title === "[정체성]");
    assert.ok(identity);
    assert.equal(/#센티넬|##기본|#가이드/.test(identity!.body), false);
  });

  it("classifies BODY_LINE_MISCLASSIFIED_AS_HEADER for the 능력 sentence", () => {
    assert.equal(
      isPlainCategoryLabelHeader("능력 사용 시 가이딩 수치가 지속적으로 소모됨"),
      false
    );
    const sections = parseCharacterSettingIntoSections(loadPr620CharacterSource());
    assert.equal(
      sections.some((s) => s.title.includes("능력 사용 시 가이딩")),
      false,
      "body sentence must not become a section title"
    );
  });

  it("keeps bracket NPC profiles and bold family/history labels", () => {
    const sections = parseCharacterSettingIntoSections(loadPr620CharacterSource());
    assert.ok(sections.some((s) => s.title.includes("조아연")));
    assert.ok(sections.some((s) => /가족관계/.test(s.title)));
    assert.ok(sections.some((s) => /트라우마/.test(s.title)));
    assert.ok(sections.some((s) => s.title === "[예시 대사]" || /예시\s*대/.test(s.title)));
  });
});
