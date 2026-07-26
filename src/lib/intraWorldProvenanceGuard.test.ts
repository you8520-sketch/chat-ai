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

  it("includes required persistence-based intent phrases", () => {
    for (const phrase of [
      "설정 근거",
      "없는 세계관 사실",
      "일회성 비고유 묘사는 허용",
      "이후에도 사실로 남을 새 설정은 만들지 않는다",
      "이미 확립된 요소로 전개",
      "본문에 드러내지 않는다",
    ]) {
      assert.ok(
        INTRA_WORLD_PROVENANCE_GUARD_BLOCK.includes(phrase),
        `missing phrase: ${phrase}`
      );
    }
  });

  it("excludes old category enumeration and failure terms", () => {
    for (const phrase of [
      "제도",
      "규정",
      "절차",
      "의무",
      "검사",
      "서식",
      "기록 체계",
      "전용 장치",
      "장치 체계",
      "기관 관행",
      "단말기",
      "바이탈",
      "시스템",
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

  it("stays in the compact target band", () => {
    const chars = [...INTRA_WORLD_PROVENANCE_GUARD_BLOCK].length;
    const tokens = estimateTokens(INTRA_WORLD_PROVENANCE_GUARD_BLOCK);
    assert.ok(chars >= 120, `chars ${chars} < 120`);
    assert.ok(chars <= 220, `chars ${chars} > 220`);
    assert.ok(tokens >= 80, `tokens ${tokens} < 80`);
    assert.ok(tokens <= 250, `tokens ${tokens} > 250`);
    console.log(JSON.stringify({ chars, tokens }));
  });

  it("does not include the Unknown Information Truth Guard block", () => {
    assert.ok(!INTRA_WORLD_PROVENANCE_GUARD_BLOCK.includes("미확인 정보"));
  });
});
