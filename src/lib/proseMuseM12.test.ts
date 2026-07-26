import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  IMMERSIVE_PROSE_BLOCK,
} from "@/lib/advancedProseNsfwGuidelines";
import { buildProseStyleXmlBundle } from "@/lib/proseStyleXmlBundle";
import { MUSE_PROSE_M1_STYLE_SECTION } from "@/lib/proseMuseM1";
import { MUSE_PROSE_M11_STYLE_SECTION } from "@/lib/proseMuseM11";
import { MUSE_PROSE_M12_STYLE_SECTION } from "@/lib/proseMuseM12";
import { PROSE_VNEXT_STYLE_SECTION } from "@/lib/proseVNext";
import { estimateTokens } from "@/lib/tokenEstimate";
import { UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK } from "@/lib/unknownInformationTruthGuard";

describe("MUSE_PROSE_M12_STYLE_SECTION — admin-only compact candidate", () => {
  it("preserves mechanical shell + 6 M1.2 principles", () => {
    assert.match(MUSE_PROSE_M12_STYLE_SECTION, /\[NARRATION REGISTER\]/);
    assert.match(MUSE_PROSE_M12_STYLE_SECTION, /\[SCENE FLOW\]/);
    assert.match(MUSE_PROSE_M12_STYLE_SECTION, /\[RHYTHM\]/);
    assert.match(MUSE_PROSE_M12_STYLE_SECTION, /\[MUSE PROSE M1\.2 — 압축 인과 장면 계약\]/);
    assert.match(MUSE_PROSE_M12_STYLE_SECTION, /1\. 다음 순간부터/);
    assert.match(MUSE_PROSE_M12_STYLE_SECTION, /6\. 달라진 장면 상태에 착지/);
    assert.doesNotMatch(MUSE_PROSE_M12_STYLE_SECTION, /7\./);
  });

  it("states the compact causal intent phrases", () => {
    for (const phrase of [
      "[MUSE PROSE M1.2 — 압축 인과 장면 계약]",
      "다음 순간부터",
      "캐릭터다운 선택으로 전개",
      "조기 종료와 과잉 전개를 동시에 피한다",
      "연결된 말은 하나의 의미 있는 발화 덩어리",
      "보여준 의미를 다시 설명하지 않는다",
      "달라진 장면 상태에 착지",
      "사용자 반응 기회를 여러 번 지나쳐",
    ]) {
      assert.ok(
        MUSE_PROSE_M12_STYLE_SECTION.includes(phrase),
        `missing phrase: ${phrase}`
      );
    }
  });

  it("excludes length/grounding/fixture leakage", () => {
    for (const phrase of [
      "1~4개",
      "0~2개",
      "2,500",
      "2500",
      "3,000",
      "3000",
      "3,200",
      "3200",
      "MINIMUM_FLOOR",
      "Truth > Length",
      "미확인 정보",
      "continuation",
      "source-bound",
      "Terminal",
      "서강우",
      "플러드",
      "휴게실",
      "복도",
      "일정·방 번호",
      "회의명",
    ]) {
      assert.ok(
        !MUSE_PROSE_M12_STYLE_SECTION.includes(phrase),
        `unexpected phrase: ${phrase}`
      );
    }
    assert.ok(!MUSE_PROSE_M12_STYLE_SECTION.includes(UNKNOWN_INFORMATION_TRUTH_GUARD_BLOCK));
    assert.doesNotMatch(MUSE_PROSE_M12_STYLE_SECTION, /\[LENGTH/);
    assert.doesNotMatch(MUSE_PROSE_M12_STYLE_SECTION, /TERMINAL/);
  });

  it("no VNext or legacy behavioral body", () => {
    assert.doesNotMatch(MUSE_PROSE_M12_STYLE_SECTION, /\[PROSE VNEXT/);
    assert.doesNotMatch(MUSE_PROSE_M12_STYLE_SECTION, /\[IMMERSIVE PROSE\]/);
    assert.doesNotMatch(MUSE_PROSE_M12_STYLE_SECTION, /\[SENSATION\]/);
    assert.doesNotMatch(MUSE_PROSE_M12_STYLE_SECTION, /\[WEBNOVEL BREATH\]/);
    assert.ok(!MUSE_PROSE_M12_STYLE_SECTION.includes(IMMERSIVE_PROSE_BLOCK));
    assert.ok(!MUSE_PROSE_M12_STYLE_SECTION.includes("[MUSE PROSE M1 — 장면 연속 계약]"));
    assert.ok(!MUSE_PROSE_M12_STYLE_SECTION.includes("[MUSE PROSE M1.1"));
  });

  it("keeps size in the compact target band vs M1 / M1.1-B", () => {
    const m12Chars = [...MUSE_PROSE_M12_STYLE_SECTION].length;
    const m1Chars = [...MUSE_PROSE_M1_STYLE_SECTION].length;
    const m11Chars = [...MUSE_PROSE_M11_STYLE_SECTION].length;
    const m12Tok = estimateTokens(MUSE_PROSE_M12_STYLE_SECTION);
    const m1Tok = estimateTokens(MUSE_PROSE_M1_STYLE_SECTION);
    const m11Tok = estimateTokens(MUSE_PROSE_M11_STYLE_SECTION);

    assert.ok(m12Chars >= 1300, `M1.2 chars ${m12Chars} < 1300`);
    assert.ok(m12Chars <= 1600, `M1.2 chars ${m12Chars} > 1600`);
    assert.ok(m12Chars < m11Chars, `M1.2 (${m12Chars}) should be shorter than M1.1-B (${m11Chars})`);
    assert.ok(
      m12Chars <= Math.ceil(m1Chars * 1.1),
      `M1.2 (${m12Chars}) exceeds M1+10% (${Math.ceil(m1Chars * 1.1)}); M1=${m1Chars}`
    );

    console.log(
      JSON.stringify({
        m1Chars,
        m11Chars,
        m12Chars,
        m1Tok,
        m11Tok,
        m12Tok,
        deltaCharsM1: m12Chars - m1Chars,
        deltaTokM1: m12Tok - m1Tok,
        deltaCharsM11: m12Chars - m11Chars,
        deltaTokM11: m12Tok - m11Tok,
        m1Plus10: Math.ceil(m1Chars * 1.1),
      })
    );
  });

  it("xml bundle embeds M1.2 once", () => {
    const bundled = buildProseStyleXmlBundle({
      proseStyleSection: MUSE_PROSE_M12_STYLE_SECTION,
    });
    assert.ok(bundled.includes(MUSE_PROSE_M12_STYLE_SECTION));
    assert.equal((bundled.match(/\[MUSE PROSE M1\.2/g) ?? []).length, 1);
    assert.equal((bundled.match(/\[MUSE PROSE M1\.1/g) ?? []).length, 0);
    assert.equal((bundled.match(/\[MUSE PROSE M1 /g) ?? []).length, 0);
    assert.ok(bundled !== PROSE_VNEXT_STYLE_SECTION);
  });

  it("mechanical shell matches M1 byte-identically before the M1.2 marker", () => {
    const m1Shell = MUSE_PROSE_M1_STYLE_SECTION.split("[MUSE PROSE M1 —")[0]!;
    const m12Shell = MUSE_PROSE_M12_STYLE_SECTION.split("[MUSE PROSE M1.2 —")[0]!;
    assert.equal(m12Shell, m1Shell);
  });
});
