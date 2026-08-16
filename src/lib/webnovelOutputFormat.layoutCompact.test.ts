/**
 * STEP C1 — static layout compact candidate gates (API = 0).
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { estimateTokens } from "@/lib/tokenEstimate";
import {
  OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE,
  OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE_MARKER,
  buildCompactTerminalLayoutRecencyLine,
  buildWebnovelOutputLayoutRecencyBlock,
  replaceOutputLayoutSystemBlockWithCompactCandidate,
} from "@/lib/webnovelOutputFormat";
import { OPUS_ARM_E_TERMINAL } from "@/lib/opusTerminalLengthOwner";

const layoutA = buildWebnovelOutputLayoutRecencyBlock();
const layoutB = OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE;
const layoutTail = buildCompactTerminalLayoutRecencyLine();

describe("STEP C1 layout compact static gates", () => {
  it("L1 candidate contains semantic paragraph owner under [OUTPUT LAYOUT]", () => {
    assert.match(layoutB, /^\[OUTPUT LAYOUT\]/);
    assert.match(layoutB, /한 문단 안에서 자연스럽게 연결/);
    assert.ok(layoutB.includes(OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE_MARKER));
  });

  it("L2 sentence-per-paragraph prohibition preserved", () => {
    assert.match(layoutB, /한 문장이 끝났다는 이유만으로 습관적으로 새 문단/);
  });

  it("L3 intentional single-sentence emphasis exception preserved", () => {
    assert.match(layoutB, /의도적 정적|실제 강조/);
  });

  it("L4 speaker change boundary preserved", () => {
    assert.match(layoutB, /화자 변경|화자별/);
  });

  it("L5 time/place transition boundary preserved", () => {
    assert.match(layoutB, /시간·장소/);
    assert.match(layoutB, /중심 상황/);
  });

  it("L6 dialogue own paragraph preserved", () => {
    assert.match(layoutB, /독립 문단/);
  });

  it("L7 blank line preserved", () => {
    assert.match(layoutB, /빈 줄/);
    assert.match(layoutB, /\\n\\n/);
  });

  it("L8 narration+dialogue same-line prohibition preserved", () => {
    assert.match(layoutB, /지문 끝에 대사를 붙이지/);
  });

  it("L9 mid-utterance narration fragmentation prohibition preserved", () => {
    assert.match(layoutB, /대사 중간에 지문을 끼워/);
  });

  it("L10 user-tail layout echo exactly once / unchanged", () => {
    assert.equal(
      createHash("sha256").update(layoutTail).digest("hex"),
      createHash("sha256")
        .update(
          `레이아웃: 지문과 "…" 대사 사이 빈 줄(\\n\\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.`
        )
        .digest("hex")
    );
    assert.ok(!layoutB.includes(layoutTail));
  });

  it("L11 no duplicate [DIALOGUE & NARRATION] owner", () => {
    assert.match(layoutA, /\[DIALOGUE & NARRATION\]/);
    assert.doesNotMatch(layoutB, /\[DIALOGUE & NARRATION\]/);
    assert.doesNotMatch(layoutB, /\[SEMANTIC PARAGRAPHING\]/);
  });

  it("L12 no Wrong/Right production example required", () => {
    assert.match(layoutA, /Wrong:/);
    assert.doesNotMatch(layoutB, /Wrong:/);
    assert.doesNotMatch(layoutB, /Right:/);
  });

  it("token reduction >= 30% and production builder unchanged", () => {
    const a = estimateTokens(layoutA);
    const b = estimateTokens(layoutB);
    assert.equal(a, 670);
    assert.ok(b <= 420, `candidate ${b} too large`);
    assert.ok((a - b) / a >= 0.3, `reduction ${(1 - b / a) * 100}%`);
    // Production path still returns Arm A body.
    assert.equal(buildWebnovelOutputLayoutRecencyBlock(), layoutA);
    assert.ok(!layoutA.includes(OUTPUT_LAYOUT_SEMANTIC_COMPACT_CANDIDATE_MARKER));
  });

  it("protected Opus Arm E hash untouched by layout candidate", () => {
    assert.equal(
      createHash("sha256").update(OPUS_ARM_E_TERMINAL).digest("hex"),
      "05225756dc2b19abebcf7ae2d5bc01717a6a98fed4494b25108901cca90e28ca"
    );
    assert.ok(!layoutB.includes("3,200~4,200"));
  });

  it("replace helper swaps only layout block", () => {
    const fake = `HEAD\n\n${layoutA}\n\nTAIL`;
    const swapped = replaceOutputLayoutSystemBlockWithCompactCandidate(fake);
    assert.ok(swapped.includes(layoutB));
    assert.ok(!swapped.includes("[DIALOGUE & NARRATION]"));
    assert.ok(swapped.startsWith("HEAD"));
    assert.ok(swapped.endsWith("TAIL"));
  });
});
