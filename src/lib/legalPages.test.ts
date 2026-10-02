import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ATTENDANCE_DAY_REWARDS, ATTENDANCE_POINTS_VALID_DAYS } from "./attendanceConstants";
import {
  BUSINESS_ADDRESS,
  BUSINESS_CUSTOMER_SERVICE_EMAIL,
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
import {
  flattenLegalPageText,
  LEGAL_DOCUMENT_AS_OF,
  PAYMENT_REFUND_PAGE,
  PRIVACY_PAGE,
  PUBLIC_LEGAL_LINKS,
  TERMS_PAGE,
} from "./legalPages";
import {
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE_FREE,
  POINT_GIFT_FEE_RATE_PAID,
} from "./pointGiftsShared";
import {
  formatPointChargePackagePublicLine,
  PAID_POINTS_VALID_YEARS,
  POINT_CHARGE_CANCEL_DAYS,
  POINT_CHARGE_PACKAGES,
  SIGNUP_BONUS_POINTS,
} from "./plans";

const GIFT_FEE_PAID_PERCENT = Math.round(POINT_GIFT_FEE_RATE_PAID * 100);
const GIFT_FEE_FREE_PERCENT = Math.round(POINT_GIFT_FEE_RATE_FREE * 100);

test("public legal links are terms, privacy, and refund", () => {
  assert.deepEqual(PUBLIC_LEGAL_LINKS, [
    { href: "/terms", label: "이용약관" },
    { href: "/privacy", label: "개인정보처리방침" },
    { href: "/refund", label: "결제 및 환불 정책" },
  ]);
});

test("legal pages expose article numbers, anchors, and the shared effective date", () => {
  for (const page of [TERMS_PAGE, PRIVACY_PAGE, PAYMENT_REFUND_PAGE]) {
    assert.match(page.intro.join("\n"), new RegExp(LEGAL_DOCUMENT_AS_OF));
    const ids = new Set<string>();
    const articles = new Set<number>();
    for (const [index, section] of page.sections.entries()) {
      assert.equal(section.article, index + 1);
      assert.ok(section.id.length > 0);
      assert.equal(ids.has(section.id), false);
      assert.equal(articles.has(section.article), false);
      ids.add(section.id);
      articles.add(section.article);
    }
  }
});

test("privacy copy states proven Google login fields and does not invent compliance", () => {
  const text = flattenLegalPageText(PRIVACY_PAGE);
  assert.match(text, /하브/);
  assert.match(text, /계정 식별자\(sub\)/);
  assert.match(text, /이메일/);
  assert.match(text, /표시 이름\(name\)/);
  assert.match(text, /로그인, 기존 계정 연결|회원 가입, 로그인, 기존 계정 연결/);
  assert.match(text, /openid, email, profile/);
  assert.match(text, /session 쿠키/);
  assert.match(text, /OpenRouter/);
  assert.match(text, /Cheaper Inference/);
  assert.match(text, /계정 전체를 삭제하는 기능은 없습니다/);
  assert.match(text, /별도로 지정·공개된 개인정보 보호책임자/);
  assert.match(text, /국외에 서버를 둘 수 있는 외부 제공업체/);
  assert.match(text, /광고성 이메일·문자 발송 기능은 현재 서비스 코드에 없습니다/);
  assert.match(text, /이용자가 동의하는 화면은 없고/);
  for (const line of BUSINESS_PUBLIC_LINES) {
    assert.match(text, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(text, /주식회사|자동으로 완전히|제3자에게 제공하지 않/);
  assert.doesNotMatch(text, /통신판매업 신고번호 \d|고객센터 전화 \d/);
});

test("terms stay within the current development and test service", () => {
  const text = flattenLegalPageText(TERMS_PAGE);
  assert.match(text, /하브/);
  assert.match(text, /개발·시험 단계/);
  assert.match(text, /계정 전체를 삭제하는 기능/);
  assert.match(text, /이메일 인증, 비밀번호 재설정/);
  assert.match(text, new RegExp(`${SIGNUP_BONUS_POINTS.toLocaleString("ko-KR")}P`));
  assert.doesNotMatch(text, /준거법|중재|주식회사/);
});

test("terms and refund publish confirmed business or product facts without invented contacts", () => {
  const terms = flattenLegalPageText(TERMS_PAGE);
  const refund = flattenLegalPageText(PAYMENT_REFUND_PAGE);
  assert.match(terms, new RegExp(SERVICE_PUBLIC_NAME));
  assert.match(terms, new RegExp(`법적 상호는 ${BUSINESS_TRADE_NAME}`));
  for (const line of BUSINESS_PUBLIC_LINES) {
    assert.match(terms, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const text of [terms, refund]) {
    assert.match(text, /상품 공개와 실제 결제 활성화는 별개/);
    assert.match(
      text,
      new RegExp(`현재 사업자 상태가 ${BUSINESS_OPERATING_STATUS}이므로 결제를 활성화하지 않습니다`),
    );
    assert.match(text, new RegExp(`지급일로부터 ${PAID_POINTS_VALID_YEARS}년`));
    assert.match(text, new RegExp(`지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일`));
    assert.match(text, new RegExp(`충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내`));
    assert.match(text, new RegExp(ATTENDANCE_DAY_REWARDS.map((points) => `${points}P`).join("·")));
    for (const pkg of POINT_CHARGE_PACKAGES) {
      assert.match(text, new RegExp(formatPointChargePackagePublicLine(pkg).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(text, /통신판매업 신고번호 \d|고객센터 전화 \d/);
    assert.doesNotMatch(text, /159-31-01749/);
  }
  assert.match(terms, /고객센터 이메일 admin@hav\.chat/);
  assert.match(refund, new RegExp(`유료 ${GIFT_FEE_PAID_PERCENT}%`));
  assert.match(refund, new RegExp(`무료 ${GIFT_FEE_FREE_PERCENT}%`));
  assert.match(refund, new RegExp(`${MIN_POINT_GIFT_AMOUNT.toLocaleString("ko-KR")}P`));
  assert.match(refund, /전자상거래법상 청약철회·계약해제와 같은 권리가 아닙니다/);
});

test("legal footer remains the site-wide renderer and public pages stay server-rendered", () => {
  const footer = readFileSync(new URL("../components/SiteLegalFooter.tsx", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const document = readFileSync(new URL("../components/LegalDocument.tsx", import.meta.url), "utf8");
  const privacy = readFileSync(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
  const terms = readFileSync(new URL("../app/terms/page.tsx", import.meta.url), "utf8");
  const refund = readFileSync(new URL("../app/refund/page.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const points = readFileSync(new URL("../app/points/page.tsx", import.meta.url), "utf8");
  const pointsClient = readFileSync(new URL("../app/points/PointsClient.tsx", import.meta.url), "utf8");
  const signup = readFileSync(new URL("../app/signup/page.tsx", import.meta.url), "utf8");
  const login = readFileSync(new URL("../app/login/LoginClient.tsx", import.meta.url), "utf8");
  const consent = readFileSync(new URL("../components/LegalConsentLinks.tsx", import.meta.url), "utf8");

  assert.match(footer, /PUBLIC_LEGAL_LINKS/);
  assert.match(footer, /SITE_DISPLAY_NAME/);
  assert.match(footer, /SITE_DESCRIPTION/);
  assert.match(footer, /BUSINESS_PUBLIC_LINES/);
  assert.match(footer, /BUSINESS_TRADE_NAME/);
  assert.doesNotMatch(footer, /통신판매업|고객센터 전화/);
  assert.equal(layout.match(/<SiteLegalFooter \/>/g)?.length, 1);
  assert.match(document, /시행일/);
  assert.match(document, /목차/);
  assert.match(document, /제\$\{section\.article\}조/);
  assert.doesNotMatch(privacy, /getSessionUser|redirect\(/);
  assert.doesNotMatch(terms, /getSessionUser|redirect\(/);
  assert.doesNotMatch(refund, /getSessionUser|redirect\(/);
  assert.doesNotMatch(home, /\/privacy|\/terms|\/refund|개인정보처리방침|이용약관|SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.doesNotMatch(points, /SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.doesNotMatch(pointsClient, /SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.match(pointsClient, /href=\"\/refund\"/);
  assert.match(signup, /LegalConsentLinks/);
  assert.match(login, /LegalConsentLinks/);
  assert.match(consent, /PUBLIC_LEGAL_LINKS/);
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
  assert.equal(BUSINESS_CUSTOMER_SERVICE_EMAIL, "admin@hav.chat");
  assert.equal(BUSINESS_IDENTITY_VERIFICATION.customerServiceEmail, "confirmed");
  assert.equal(BUSINESS_IDENTITY_VERIFICATION.mailOrderReportNumber, "unverified");
});
