import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INTRA_WORLD_PROVENANCE_GUARD_BLOCK,
  INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID,
} from "@/lib/intraWorldProvenanceGuard";
import { estimateTokens } from "@/lib/tokenEstimate";

describe("INTRA_WORLD_PROVENANCE_GUARD_BLOCK", () => {
  it("has the expected section ID", () => {
    assert.equal(INTRA_WORLD_PROVENANCE_GUARD_SECTION_ID, "rule-intraworld-provenance-absolute-tail");
  });

  it("includes required intent phrases", () => {
    for (const phrase of [
      "사용자가 묻지 않았더라도",
      "제도·규정·절차",
      "전용 장치의 존재나 기능",
      "장르상 그럴듯하다는 이유만으로",
      "비고유 배경 디테일은 사용할 수 있다",
      "새로운 규칙·제도·기관 관행",
      "분량이나 분위기를 채우기 위해",
      "이 규칙 자체를 본문에서 설명하거나 인용하지 않는다",
    ]) {
      assert.ok(
        INTRA_WORLD_PROVENANCE_GUARD_BLOCK.includes(phrase),
        `missing phrase: ${phrase}`
      );
    }
  });

  it("excludes canary failure exact expressions", () => {
    for (const phrase of [
      "별도로 체크",
      "범위를 체크",
      "바이탈을 체크",
      "수계 능력자",
      "신체 접촉 허용 범위",
      "센티넬 바이탈",
      "서강우",
      "플러드",
      "휴게실",
      "평가실",
    ]) {
      assert.ok(
        !INTRA_WORLD_PROVENANCE_GUARD_BLOCK.includes(phrase),
        `unexpected phrase: ${phrase}`
      );
    }
  });

  it("excludes implementation-only terms", () => {
    for (const phrase of ["provenance", "source-bound", "system prompt", "Terminal", "LENGTH owner", "continuation"]) {
      assert.ok(
        !INTRA_WORLD_PROVENANCE_GUARD_BLOCK.toLowerCase().includes(phrase.toLowerCase()),
        `unexpected implementation term: ${phrase}`
      );
    }
  });

  it("stays in the target token band", () => {
    const chars = [...INTRA_WORLD_PROVENANCE_GUARD_BLOCK].length;
    const tokens = estimateTokens(INTRA_WORLD_PROVENANCE_GUARD_BLOCK);
    assert.ok(chars >= 300, `chars ${chars} < 300`);
    assert.ok(chars <= 500, `chars ${chars} > 500`);
    assert.ok(tokens >= 250, `tokens ${tokens} < 250`);
    assert.ok(tokens <= 500, `tokens ${tokens} > 500`);
    console.log(JSON.stringify({ chars, tokens }));
  });

  it("does not include the Unknown Information Truth Guard block", () => {
    assert.ok(!INTRA_WORLD_PROVENANCE_GUARD_BLOCK.includes("미확인 정보"));
  });
});
