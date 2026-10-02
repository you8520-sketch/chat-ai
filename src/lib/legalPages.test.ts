import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ATTENDANCE_POINTS_VALID_DAYS } from "./attendanceConstants";
import {
  BUSINESS_ADDRESS,
  BUSINESS_IDENTITY_SOURCE,
  BUSINESS_IDENTITY_VERIFICATION,
  BUSINESS_ITEM,
  BUSINESS_OPERATING_STATUS,
  BUSINESS_PUBLIC_LINES,
  BUSINESS_REGISTRATION_NUMBER,
  BUSINESS_REPRESENTATIVE_NAME,
  BUSINESS_TAX_TYPE,
  BUSINESS_TRADE_NAME,
  SERVICE_PUBLIC_NAME,
  SERVICE_PUBLIC_ORIGIN,
} from "./businessIdentity";
import { PRIVACY_PAGE, PUBLIC_LEGAL_LINKS, TERMS_PAGE } from "./legalPages";
import {
  formatPointChargePackagePublicLine,
  PAID_POINTS_VALID_YEARS,
  POINT_CHARGE_CANCEL_DAYS,
  POINT_CHARGE_PACKAGES,
} from "./plans";

function pageText(page: { intro: readonly string[]; sections: readonly { heading: string; paragraphs: readonly string[] }[] }): string {
  return [page.intro.join("\n"), ...page.sections.flatMap((section) => [section.heading, ...section.paragraphs])].join("\n");
}

test("public legal links are one shared privacy and terms pair", () => {
  assert.deepEqual(PUBLIC_LEGAL_LINKS, [
    { href: "/privacy", label: "개인정보처리방침" },
    { href: "/terms", label: "이용약관" },
  ]);
});

test("privacy copy states proven Google login fields and purpose", () => {
  const text = pageText(PRIVACY_PAGE);
  assert.match(text, /하브/);
  assert.match(text, /계정 식별자\(sub\)/);
  assert.match(text, /이메일/);
  assert.match(text, /표시 이름\(name\)/);
  assert.match(text, /로그인, 계정 만들기, 기존 계정 연결/);
  assert.match(text, /openid, email, profile/);
  assert.match(text, /session 쿠키/);
  assert.match(text, /OpenRouter/);
  assert.match(text, /Cheaper Inference/);
  assert.match(text, /계정 전체를 삭제하는 기능은 없습니다/);
  assert.doesNotMatch(text, /사업자등록|주식회사|자동으로 완전히|제3자에게 제공하지 않/);
});

test("terms stay within the current development and test service", () => {
  const text = pageText(TERMS_PAGE);
  assert.match(text, /하브/);
  assert.match(text, /개발·시험 단계/);
  assert.match(text, /계정 전체를 삭제하는 기능/);
  assert.doesNotMatch(text, /준거법|중재|주식회사/);
});

test("terms publish confirmed business fields and the five point products", () => {
  const text = pageText(TERMS_PAGE);
  assert.match(text, new RegExp(SERVICE_PUBLIC_NAME));
  assert.match(text, new RegExp(`법적 상호는 ${BUSINESS_TRADE_NAME}`));
  for (const line of BUSINESS_PUBLIC_LINES) {
    assert.match(text, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(text, /상품 공개와 실제 결제 활성화는 별개/);
  assert.match(text, new RegExp(`현재 사업자 상태가 ${BUSINESS_OPERATING_STATUS}이므로 결제를 활성화하지 않습니다`));
  assert.match(text, new RegExp(`지급일로부터 ${PAID_POINTS_VALID_YEARS}년`));
  assert.match(text, new RegExp(`지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일`));
  assert.match(text, new RegExp(`충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내`));
  for (const pkg of POINT_CHARGE_PACKAGES) {
    assert.match(text, new RegExp(formatPointChargePackagePublicLine(pkg).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(text, /통신판매업 신고번호|고객센터/);
  assert.doesNotMatch(text, /159-31-01749/);
});

test("legal footer is the only renderer of the shared link set", () => {
  const footer = readFileSync(new URL("../components/SiteLegalFooter.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const privacy = readFileSync(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
  const terms = readFileSync(new URL("../app/terms/page.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

  const points = readFileSync(new URL("../app/points/page.tsx", import.meta.url), "utf8");
  const pointsClient = readFileSync(new URL("../app/points/PointsClient.tsx", import.meta.url), "utf8");

  assert.match(footer, /PUBLIC_LEGAL_LINKS/);
  assert.match(footer, /SITE_DISPLAY_NAME/);
  assert.match(footer, /SITE_DESCRIPTION/);
  assert.match(footer, /BUSINESS_PUBLIC_LINES/);
  assert.match(footer, /BUSINESS_TRADE_NAME/);
  assert.doesNotMatch(footer, /통신판매업|고객센터/);
  assert.equal(layout.match(/<SiteLegalFooter \/>/g)?.length, 1);
  assert.doesNotMatch(privacy, /PUBLIC_LEGAL_LINKS|href=\"\/privacy\"|href=\"\/terms\"/);
  assert.doesNotMatch(terms, /PUBLIC_LEGAL_LINKS|href=\"\/privacy\"|href=\"\/terms\"/);
  assert.doesNotMatch(home, /\/privacy|\/terms|개인정보처리방침|이용약관|SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.doesNotMatch(points, /SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.doesNotMatch(pointsClient, /SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.doesNotMatch(terms, /getSessionUser|redirect\(/);
  assert.doesNotMatch(privacy, /getSessionUser|redirect\(/);
});

test("business identity keeps brand and legal name distinct and omits unverified contacts", () => {
  assert.equal(SERVICE_PUBLIC_NAME, "하브");
  assert.equal(SERVICE_PUBLIC_ORIGIN, "https://hav.chat");
  assert.equal(BUSINESS_TRADE_NAME, "노벨 챗");
  assert.notEqual(SERVICE_PUBLIC_NAME, BUSINESS_TRADE_NAME);
  assert.equal(BUSINESS_REGISTRATION_NUMBER, "519-31-01749");
  assert.equal(BUSINESS_REPRESENTATIVE_NAME, "조영지");
  assert.equal(BUSINESS_ADDRESS, "인천광역시 검단구 당곡로4번길 15, 301호(원당동)");
  assert.equal(BUSINESS_ITEM, "응용 소프트웨어 개발 및 공급업");
  assert.equal(BUSINESS_TAX_TYPE, "일반과세자");
  assert.equal(BUSINESS_OPERATING_STATUS, "휴업");
  assert.equal(BUSINESS_IDENTITY_SOURCE, "submitted_nts_certificate");
  assert.equal(BUSINESS_IDENTITY_VERIFICATION.phoneNumber, "unverified");
  assert.equal(BUSINESS_IDENTITY_VERIFICATION.customerServiceEmail, "unverified");
  assert.equal(BUSINESS_IDENTITY_VERIFICATION.mailOrderReportNumber, "unverified");
});
