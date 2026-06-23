import { describe, expect, it } from "vitest";
import {
  CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT,
  listPartnerTermMonths,
  meetsPartnerPromotionCriteria,
  passesPartnerRenewal,
} from "./partnerTier";
import {
  CREATOR_PARTNER_MIN_CHARACTERS,
  CREATOR_PARTNER_MIN_MONTHLY_SPENT,
  CREATOR_PARTNER_TERM_MONTHS,
} from "./creatorShared";

describe("partnerTier", () => {
  it("파트너 승급 조건: 공개 15개 + 월 500만P", () => {
    expect(meetsPartnerPromotionCriteria(CREATOR_PARTNER_MIN_CHARACTERS, CREATOR_PARTNER_MIN_MONTHLY_SPENT)).toBe(
      true
    );
    expect(
      meetsPartnerPromotionCriteria(CREATOR_PARTNER_MIN_CHARACTERS, CREATOR_PARTNER_MIN_MONTHLY_SPENT - 1)
    ).toBe(false);
    expect(meetsPartnerPromotionCriteria(CREATOR_PARTNER_MIN_CHARACTERS - 1, CREATOR_PARTNER_MIN_MONTHLY_SPENT)).toBe(
      false
    );
  });

  it("갱신 최소 월 소비는 승급 조건의 80%", () => {
    expect(CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT).toBe(4_000_000);
  });

  it("유지 기간 3개월의 연-월 목록", () => {
    expect(listPartnerTermMonths("2026-01-15")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(listPartnerTermMonths("2026-01-15", CREATOR_PARTNER_TERM_MONTHS)).toHaveLength(3);
  });

  it("3개월 모두 400만P+면 갱신 통과", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    expect(
      passesPartnerRenewal({
        termMonths: months,
        monthSpends: { "2026-01": 4_000_000, "2026-02": 5_000_000, "2026-03": 4_500_000 },
        publicCharacterCount: CREATOR_PARTNER_MIN_CHARACTERS,
      })
    ).toBe(true);
  });

  it("한 달이라도 400만P 미만이면 갱신 실패", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    expect(
      passesPartnerRenewal({
        termMonths: months,
        monthSpends: { "2026-01": 4_000_000, "2026-02": 3_999_999, "2026-03": 5_000_000 },
        publicCharacterCount: CREATOR_PARTNER_MIN_CHARACTERS,
      })
    ).toBe(false);
  });

  it("공개 캐릭터 15개 미만이면 갱신 실패", () => {
    expect(
      passesPartnerRenewal({
        termMonths: ["2026-01", "2026-02", "2026-03"],
        monthSpends: { "2026-01": 5_000_000, "2026-02": 5_000_000, "2026-03": 5_000_000 },
        publicCharacterCount: CREATOR_PARTNER_MIN_CHARACTERS - 1,
      })
    ).toBe(false);
  });
});
