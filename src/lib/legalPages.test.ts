import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ATTENDANCE_DAY_REWARDS, ATTENDANCE_POINTS_VALID_DAYS } from "./attendanceConstants";
import {
  BUSINESS_ADDRESS,
  BUSINESS_CUSTOMER_SERVICE_EMAIL,
  BUSINESS_CUSTOMER_SERVICE_PHONE,
  BUSINESS_IDENTITY_SOURCE,
  BUSINESS_IDENTITY_VERIFICATION,
  BUSINESS_ITEM,
  BUSINESS_OPERATING_STATUS,
  BUSINESS_PUBLIC_LINES,
  BUSINESS_REGISTRATION_NUMBER,
  BUSINESS_REPRESENTATIVE_NAME,
  BUSINESS_TAX_TYPE,
  BUSINESS_TRADE_NAME,
  PERSONAL_INFORMATION_PROTECTION_OFFICER_EMAIL,
  PERSONAL_INFORMATION_PROTECTION_OFFICER_NAME,
  PERSONAL_INFORMATION_PROTECTION_OFFICER_PHONE,
  SERVICE_PUBLIC_NAME,
  SERVICE_PUBLIC_ORIGIN,
  SERVICE_PUBLIC_STATUS,
} from "./businessIdentity";
import {
  EMAIL_SIGNUP_MAX_SENDS,
  EMAIL_SIGNUP_RESEND_COOLDOWN_MS,
  EMAIL_SIGNUP_TOKEN_TTL_MS,
} from "./emailSignupConstants";
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
  pointChargePackageBonusPercent,
} from "./plans";
import { PAYMENTS_DISABLED_MESSAGE } from "./portoneConfig";
import {
  CONFIRMED_CROSS_BORDER_TRANSFERS,
  CROSS_BORDER_ARTICLE_28_8_DISCLOSURE_COMPLETE,
  CROSS_BORDER_FINAL_COUNTRY_UNRESOLVABLE_PROVIDER_IDS,
  CROSS_BORDER_TRANSFERS,
  EXCLUDED_FROM_CROSS_BORDER_TABLE,
  PRODUCTION_CROSS_BORDER_PROVIDER_IDS,
  formatCrossBorderPrivacyParagraphs,
  isCrossBorderRowComplete,
} from "./privacyCrossBorder";
import {
  MEMBER_PAID_CHARGE_UNAVAILABLE_MESSAGE,
  MEMBER_PAID_POINT_CHARGE_PUBLICLY_AVAILABLE,
  SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS,
} from "./servicePublicCommerce";

const GIFT_FEE_PAID_PERCENT = Math.round(POINT_GIFT_FEE_RATE_PAID * 100);
const GIFT_FEE_FREE_PERCENT = Math.round(POINT_GIFT_FEE_RATE_FREE * 100);
const EMAIL_TOKEN_MINUTES = EMAIL_SIGNUP_TOKEN_TTL_MS / 60_000;
const EMAIL_RESEND_MINUTES = EMAIL_SIGNUP_RESEND_COOLDOWN_MS / 60_000;
const INTERNAL_PUBLIC_TERMS = [
  "PORTONE_CHARGE_ENABLED",
  "NEXT_PUBLIC_PAYMENTS_ENABLED",
  "SKIP_ADULT_VERIFICATION",
  "email_verify",
  "training_consent",
  "oauth_state",
  "notice_read_id",
  "현재 코드가",
  "사업자 상태 휴업",
  "function",
  "debug",
  "DB",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

test("one public commerce notice owner is reused and member charge stays unavailable", () => {
  assert.equal(MEMBER_PAID_POINT_CHARGE_PUBLICLY_AVAILABLE, false);
  assert.equal(PAYMENTS_DISABLED_MESSAGE, MEMBER_PAID_CHARGE_UNAVAILABLE_MESSAGE);
  assert.equal(SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS.length, 1);
  const notice = SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS[0] ?? "";
  assert.match(notice, new RegExp(SERVICE_PUBLIC_STATUS));
  assert.match(notice, /일반 회원의 유료 포인트 결제는 제공하지 않습니다/);
  assert.match(notice, /지정 심사 계정에서만 테스트 결제가 제공/);
  assert.doesNotMatch(notice, /매출로 처리/);
  const termsText = flattenLegalPageText(TERMS_PAGE);
  const privacyText = flattenLegalPageText(PRIVACY_PAGE);
  const refundText = flattenLegalPageText(PAYMENT_REFUND_PAGE);
  for (const paragraph of SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS) {
    assert.equal(termsText.split(paragraph).length - 1, 1);
    assert.equal(privacyText.split(paragraph).length - 1, 0);
    assert.equal(refundText.split(paragraph).length - 1, 0);
  }
});

test("privacy copy states proven processing facts and does not invent compliance", () => {
  assert.deepEqual(
    PRIVACY_PAGE.sections.map((section) => section.heading),
    [
      "개인정보 처리자",
      "처리 목적",
      "처리 항목",
      "보유 및 이용 기간",
      "제3자 제공",
      "처리위탁",
      "국외 이전",
      "파기",
      "정보주체의 권리",
      "쿠키",
      "안전성 확보조치",
      "개인정보 보호책임자",
      "변경",
    ],
  );
  const text = flattenLegalPageText(PRIVACY_PAGE);
  assert.match(text, /하브/);
  assert.match(text, /계정 식별자/);
  assert.match(text, /이메일/);
  assert.match(text, /표시 이름/);
  assert.match(text, /회원 가입, 이메일 인증, 로그인, 기존 계정 연결/);
  assert.match(text, /로그인 세션 쿠키/);
  assert.match(text, /OpenRouter/);
  assert.match(text, /Cheaper Inference/);
  assert.match(text, /Resend/);
  assert.match(text, new RegExp(`인증 링크의 유효기간은 ${EMAIL_TOKEN_MINUTES}분`));
  assert.match(text, /계정 전체를 삭제하는 기능은 없습니다/);
  assert.match(text, new RegExp(`개인정보 보호책임자는 대표자 ${PERSONAL_INFORMATION_PROTECTION_OFFICER_NAME}`));
  assert.match(text, new RegExp(`전화 ${PERSONAL_INFORMATION_PROTECTION_OFFICER_PHONE}`));
  assert.match(text, new RegExp(`이메일 ${PERSONAL_INFORMATION_PROTECTION_OFFICER_EMAIL}`));
  assert.doesNotMatch(text, /시행령 제32조/);
  assert.doesNotMatch(text, /보호책임자는 현재 없습니다/);
  assert.doesNotMatch(text, /대표자가 보호책임자가 된다고 쓰지 않습니다/);
  assert.doesNotMatch(text, /소상공인 예외에 해당하는지는/);
  assert.match(text, /Plus Five Five, Inc\.\(Resend\)/);
  assert.match(text, /미국/);
  assert.match(text, /OpenRouter, Inc\./);
  assert.match(text, /Keak AI, Inc\./);
  assert.match(text, /최대 30일/);
  assert.doesNotMatch(text, /그 고지가 완료되었다고 쓰지 않습니다/);
  assert.doesNotMatch(text, /법적 근거/);
  assert.doesNotMatch(text, /미확정/);
  assert.doesNotMatch(text, /국외에 서버를 둘 수 있는 외부 제공업체/);
  assert.doesNotMatch(text, /광고성 이메일·문자 발송 기능은 현재 없습니다/);
  assert.doesNotMatch(text, /모의 인증/);
  assert.doesNotMatch(text, /베타 테스트/);
  assert.doesNotMatch(text, /매출로 집계하지 않습니다/);
  assert.doesNotMatch(text, /OPEN_READY|CROSS_BORDER_BLOCKED|ZDR|google-ai-studio/);
  assert.doesNotMatch(text, /law\.go\.kr|openrouter\.ai\/privacy|cheaperinference\.com\/legal/);
  assert.match(text, /비밀번호와 이메일 인증 토큰은 해시로 저장합니다/);
  assert.doesNotMatch(text, /비밀번호와 이메일 인증 정보는 암호화하여 저장합니다/);
  assert.match(text, new RegExp(escapeRegExp(BUSINESS_CUSTOMER_SERVICE_PHONE)));
  for (const line of BUSINESS_PUBLIC_LINES) {
    assert.match(text, new RegExp(escapeRegExp(line)));
  }
  for (const term of INTERNAL_PUBLIC_TERMS) {
    assert.doesNotMatch(text, new RegExp(escapeRegExp(term)));
  }
  assert.doesNotMatch(text, /주식회사|자동으로 완전히|제3자에게 제공하지 않/);
  assert.doesNotMatch(text, /통신판매업 신고번호 \d/);
  assert.doesNotMatch(text, /휴업/);
  assert.doesNotMatch(text, /가입하면 바로 저장|가입 즉시/);
  assert.doesNotMatch(text, /성인 확인을 생략합니다/);
});

test("terms are production user terms without developer wording", () => {
  const text = flattenLegalPageText(TERMS_PAGE);
  assert.match(text, /하브/);
  assert.match(text, /목적/);
  assert.match(text, /정의/);
  assert.match(text, /이용계약/);
  assert.match(text, /금지행위/);
  assert.match(text, /계정 전체를 삭제하는 기능은 현재 없습니다/);
  assert.match(text, /비밀번호 재설정/);
  assert.match(text, /계정이 바로 만들어지지 않습니다/);
  assert.match(text, new RegExp(`${EMAIL_TOKEN_MINUTES}분`));
  assert.match(text, new RegExp(`${EMAIL_RESEND_MINUTES}분에 한 번`));
  assert.match(text, new RegExp(`최대 ${EMAIL_SIGNUP_MAX_SENDS}회`));
  assert.match(text, new RegExp(`${SIGNUP_BONUS_POINTS.toLocaleString("ko-KR")}P`));
  assert.match(text, /한 번만 지급됩니다/);
  assert.match(text, /회원가입을 완료함으로써 성립합니다/);
  assert.match(text, /가입 화면에서 이용약관, 개인정보처리방침, 결제 및 환불 정책을 확인할 수 있습니다/);
  assert.doesNotMatch(text, /확인한 뒤 회원가입을 완료/);
  assert.match(text, /성인 이용자에게만 제공되는 기능/);
  assert.doesNotMatch(text, /성인만 이용해서는 안 됩니다/);
  assert.doesNotMatch(text, /모의 인증/);
  assert.doesNotMatch(text, /베타 테스트/);
  assert.doesNotMatch(text, /법령이 허용하지 않는 책임 제한/);
  assert.match(text, new RegExp(escapeRegExp(BUSINESS_CUSTOMER_SERVICE_PHONE)));
  for (const term of INTERNAL_PUBLIC_TERMS) {
    assert.doesNotMatch(text, new RegExp(escapeRegExp(term)));
  }
  assert.doesNotMatch(text, /준거법|중재|주식회사/);
  assert.doesNotMatch(text, /개발·시험 단계/);
  assert.doesNotMatch(text, /가입 즉시/);
  assert.doesNotMatch(text, /성인 확인을 생략합니다/);
  assert.doesNotMatch(text, /휴업/);
});

test("terms and refund publish confirmed products and refund support without invented contacts", () => {
  const terms = flattenLegalPageText(TERMS_PAGE);
  const refund = flattenLegalPageText(PAYMENT_REFUND_PAGE);
  assert.match(terms, new RegExp(SERVICE_PUBLIC_NAME));
  assert.match(terms, new RegExp(`법적 상호는 ${BUSINESS_TRADE_NAME}`));
  for (const line of BUSINESS_PUBLIC_LINES) {
    assert.match(terms, new RegExp(escapeRegExp(line)));
  }
  for (const text of [terms, refund]) {
    assert.match(text, new RegExp(`지급일로부터 ${PAID_POINTS_VALID_YEARS}년`));
    assert.match(text, new RegExp(`지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일`));
    assert.match(text, new RegExp(`충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내`));
    assert.match(text, new RegExp(ATTENDANCE_DAY_REWARDS.map((points) => `${points}P`).join("·")));
    assert.match(text, /070-8080-5884/);
    for (const pkg of POINT_CHARGE_PACKAGES) {
      assert.match(text, new RegExp(escapeRegExp(formatPointChargePackagePublicLine(pkg))));
      if (pkg.bonusPoints > 0) {
        assert.match(text, new RegExp(`보너스 ${pkg.bonusPoints.toLocaleString("ko-KR")}P`));
        assert.equal(pointChargePackageBonusPercent(pkg) > 0, true);
      }
    }
    for (const term of INTERNAL_PUBLIC_TERMS) {
      assert.doesNotMatch(text, new RegExp(escapeRegExp(term)));
    }
    assert.doesNotMatch(text, /통신판매업 신고번호 \d/);
    assert.doesNotMatch(text, /159-31-01749/);
    assert.doesNotMatch(text, /휴업/);
  }
  assert.match(terms, /519-31-01749/);
  assert.match(terms, /고객센터 이메일 admin@hav\.chat/);
  assert.match(refund, new RegExp(`유료 ${GIFT_FEE_PAID_PERCENT}%`));
  assert.match(refund, new RegExp(`무료 ${GIFT_FEE_FREE_PERCENT}%`));
  assert.match(refund, new RegExp(`${MIN_POINT_GIFT_AMOUNT.toLocaleString("ko-KR")}P`));
  assert.match(refund, /인증 확인이 완료된 뒤에 한 번만 지급됩니다/);
  assert.match(refund, /하브가 제공하는 지원 경로/);
  assert.match(refund, /전자상거래법상 청약철회·계약해제와 같은 권리가 아닙니다/);
  assert.doesNotMatch(refund, /법정 권리가 제한된다고 쓰지 않습니다/);
  assert.doesNotMatch(refund, /이 문서는/);
  assert.doesNotMatch(refund, /이메일 가입 시 무료 포인트/);
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
  assert.match(footer, /aria-label="사업자 정보"/);
  assert.match(footer, /border-t border-white/);
  assert.match(footer, /flex flex-wrap gap-x-3/);
  assert.match(footer, /min-\[576px\]:pl-\[200px\]/);
  assert.doesNotMatch(footer, /space-y-0\.5/);
  assert.doesNotMatch(footer, /통신판매업|고객센터 전화/);
  assert.doesNotMatch(footer, /휴업/);
  assert.equal(layout.match(/<SiteLegalFooter \/>/g)?.length, 1);
  assert.match(document, /시행일/);
  assert.match(document, /목차/);
  assert.match(document, /제\$\{section\.article\}조/);
  assert.match(document, /section\.table/);
  assert.doesNotMatch(privacy, /getSessionUser|redirect\(/);
  assert.doesNotMatch(terms, /getSessionUser|redirect\(/);
  assert.doesNotMatch(refund, /getSessionUser|redirect\(/);
  assert.doesNotMatch(home, /\/privacy|\/terms|\/refund|개인정보처리방침|이용약관|SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.doesNotMatch(points, /SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.doesNotMatch(pointsClient, /SiteLegalFooter|BUSINESS_PUBLIC_LINES/);
  assert.match(pointsClient, /href=\"\/refund\"/);
  assert.match(signup, /LegalConsentLinks/);
  assert.match(signup, /이메일 인증 후/);
  assert.doesNotMatch(signup, /가입 즉시/);
  assert.match(login, /LegalConsentLinks/);
  assert.match(login, /verifyState === "failed"/);
  assert.match(consent, /PUBLIC_LEGAL_LINKS/);
  assert.doesNotMatch(consent, /type=\"checkbox\"|동의/);
});

test("business identity keeps brand and legal name distinct, publishes confirmed phone, and omits unverified mail-order number", () => {
  assert.equal(SERVICE_PUBLIC_NAME, "하브");
  assert.equal(SERVICE_PUBLIC_ORIGIN, "https://hav.chat");
  assert.equal(SERVICE_PUBLIC_STATUS, "개업 준비중");
  assert.equal(BUSINESS_TRADE_NAME, "노벨 챗");
  assert.notEqual(SERVICE_PUBLIC_NAME, BUSINESS_TRADE_NAME);
  assert.equal(BUSINESS_REGISTRATION_NUMBER, "519-31-01749");
  assert.equal(BUSINESS_REPRESENTATIVE_NAME, "조영지");
  assert.equal(BUSINESS_ADDRESS, "인천광역시 검단구 당곡로4번길 15, 301호(원당동)");
  assert.equal(BUSINESS_ITEM, "응용 소프트웨어 개발 및 공급업");
  assert.equal(BUSINESS_TAX_TYPE, "일반과세자");
  assert.equal(BUSINESS_OPERATING_STATUS, "휴업");
  assert.equal(BUSINESS_IDENTITY_SOURCE, "submitted_nts_certificate");
  assert.equal(BUSINESS_CUSTOMER_SERVICE_PHONE, "070-8080-5884");
  assert.equal(BUSINESS_IDENTITY_VERIFICATION.phoneNumber, "confirmed");
  assert.equal(BUSINESS_CUSTOMER_SERVICE_EMAIL, "admin@hav.chat");
  assert.equal(BUSINESS_IDENTITY_VERIFICATION.customerServiceEmail, "confirmed");
  assert.equal(new Set(BUSINESS_PUBLIC_LINES).size, BUSINESS_PUBLIC_LINES.length);
  assert.equal(BUSINESS_PUBLIC_LINES.filter((line) => line.includes("서비스 상태")).length, 1);
  assert.equal(BUSINESS_PUBLIC_LINES.some((line) => line.includes("사업자 상태")), false);
  assert.equal(BUSINESS_PUBLIC_LINES.filter((line) => line.includes("고객센터 전화")).length, 1);
  assert.equal(BUSINESS_PUBLIC_LINES.filter((line) => line.includes("고객센터 이메일")).length, 1);
  assert.equal(BUSINESS_IDENTITY_VERIFICATION.mailOrderReportNumber, "unverified");
  assert.equal(PERSONAL_INFORMATION_PROTECTION_OFFICER_NAME, BUSINESS_REPRESENTATIVE_NAME);
  assert.equal(PERSONAL_INFORMATION_PROTECTION_OFFICER_PHONE, BUSINESS_CUSTOMER_SERVICE_PHONE);
  assert.equal(PERSONAL_INFORMATION_PROTECTION_OFFICER_EMAIL, BUSINESS_CUSTOMER_SERVICE_EMAIL);
  assert.equal(PERSONAL_INFORMATION_PROTECTION_OFFICER_NAME, "조영지");
  assert.equal(PERSONAL_INFORMATION_PROTECTION_OFFICER_PHONE, "070-8080-5884");
  assert.equal(PERSONAL_INFORMATION_PROTECTION_OFFICER_EMAIL, "admin@hav.chat");
});

test("privacy cross-border copy is owned by one table and is not a complete 28-8 disclosure", () => {
  assert.equal(CROSS_BORDER_ARTICLE_28_8_DISCLOSURE_COMPLETE, false);
  assert.deepEqual(
    [...PRODUCTION_CROSS_BORDER_PROVIDER_IDS],
    ["openrouter", "cheaper-inference", "openai", "google", "resend"],
  );
  assert.deepEqual(
    CROSS_BORDER_TRANSFERS.map((row) => row.id),
    [...PRODUCTION_CROSS_BORDER_PROVIDER_IDS],
  );
  assert.deepEqual([...EXCLUDED_FROM_CROSS_BORDER_TABLE], ["portone", "vercel-blob"]);
  assert.equal(
    CROSS_BORDER_TRANSFERS.some((row) => EXCLUDED_FROM_CROSS_BORDER_TABLE.includes(row.id as never)),
    false,
  );
  assert.deepEqual(
    [...CROSS_BORDER_FINAL_COUNTRY_UNRESOLVABLE_PROVIDER_IDS],
    ["openrouter", "cheaper-inference"],
  );
  const confirmedIds = CONFIRMED_CROSS_BORDER_TRANSFERS.map((row) => row.id);
  assert.deepEqual(confirmedIds, ["resend"]);
  for (const row of CONFIRMED_CROSS_BORDER_TRANSFERS) {
    assert.equal(isCrossBorderRowComplete(row), true);
  }
  const privacy = flattenLegalPageText(PRIVACY_PAGE);
  for (const paragraph of formatCrossBorderPrivacyParagraphs()) {
    assert.match(privacy, new RegExp(escapeRegExp(paragraph)));
    assert.doesNotMatch(paragraph, /미확정/);
  }
  assert.match(privacy, /OpenRouter, Inc\./);
  assert.match(privacy, /Keak AI, Inc\./);
  assert.match(privacy, /확인되지 않음/);
  assert.doesNotMatch(privacy, /코리아포트원/);
  assert.doesNotMatch(privacy, /Vercel Inc\./);
  const incomplete = CROSS_BORDER_TRANSFERS.filter((row) => !isCrossBorderRowComplete(row));
  assert.equal(incomplete.length > 0, true);
  for (const row of incomplete) {
    assert.doesNotMatch(privacy, new RegExp(escapeRegExp(row.legalBasis.publicValue)));
    assert.doesNotMatch(privacy, new RegExp(escapeRegExp(row.countries.publicValue)));
  }
});

test("attendance expiry legal text follows the later-confirmed 21-day owner", () => {
  assert.equal(ATTENDANCE_POINTS_VALID_DAYS, 21);
  for (const page of [TERMS_PAGE, PAYMENT_REFUND_PAGE]) {
    const text = flattenLegalPageText(page);
    assert.match(text, /지급일로부터 21일/);
    assert.doesNotMatch(text, /출석 포인트의 유효기간은 지급일로부터 30일/);
  }
});

test("CPO designation has one owner and privacy only reads it", () => {
  const identity = readFileSync(new URL("./businessIdentity.ts", import.meta.url), "utf8");
  const privacyOwner = readFileSync(new URL("./privacyCrossBorder.ts", import.meta.url), "utf8");
  const legal = readFileSync(new URL("./legalPages.ts", import.meta.url), "utf8");
  assert.equal(
    identity.match(/export const PERSONAL_INFORMATION_PROTECTION_OFFICER_NAME/g)?.length,
    1,
  );
  assert.doesNotMatch(privacyOwner, /PERSONAL_INFORMATION_PROTECTION_OFFICER_/);
  assert.match(legal, /PERSONAL_INFORMATION_PROTECTION_OFFICER_NAME/);
  assert.match(legal, /PERSONAL_INFORMATION_PROTECTION_OFFICER_PHONE/);
  assert.match(legal, /PERSONAL_INFORMATION_PROTECTION_OFFICER_EMAIL/);
  assert.doesNotMatch(legal, /export const PERSONAL_INFORMATION_PROTECTION_OFFICER_/);
});

test("cross-border disclosure has one owner and matches the live production set", () => {
  const identity = readFileSync(new URL("./businessIdentity.ts", import.meta.url), "utf8");
  const privacyOwner = readFileSync(new URL("./privacyCrossBorder.ts", import.meta.url), "utf8");
  const legal = readFileSync(new URL("./legalPages.ts", import.meta.url), "utf8");
  const chatModels = readFileSync(new URL("./chatModels.ts", import.meta.url), "utf8");
  const routePolicy = readFileSync(new URL("./openRouterConfig.ts", import.meta.url), "utf8");
  const embeddings = readFileSync(new URL("./openRouterEmbeddings.ts", import.meta.url), "utf8");
  const imageEdit = readFileSync(new URL("./openAiImageEdit.ts", import.meta.url), "utf8");
  const email = readFileSync(new URL("./transactionalEmail.ts", import.meta.url), "utf8");
  const media = readFileSync(new URL("./mediaStorage.ts", import.meta.url), "utf8");
  const upload = readFileSync(new URL("./uploadStorage.ts", import.meta.url), "utf8");
  const commerce = readFileSync(new URL("./servicePublicCommerce.ts", import.meta.url), "utf8");

  assert.match(privacyOwner, /export const CROSS_BORDER_TRANSFERS/);
  assert.doesNotMatch(identity, /CROSS_BORDER_TRANSFERS/);
  assert.match(legal, /formatCrossBorderPrivacyParagraphs/);
  assert.doesNotMatch(legal, /export const CROSS_BORDER_TRANSFERS/);

  assert.match(chatModels, /provider: "cheaperinference"/);
  assert.match(chatModels, /provider: "openrouter"/);
  assert.match(routePolicy, /providerSlug: "google-ai-studio"/);
  assert.match(routePolicy, /allow_fallbacks: false/);
  assert.match(embeddings, /zdr: true/);
  assert.match(imageEdit, /api\.openai\.com|openai/i);
  assert.match(email, /api\.resend\.com/);
  assert.match(media, /Does not use BLOB_READ_WRITE_TOKEN/);
  assert.match(upload, /BLOB_READ_WRITE_TOKEN/);
  assert.match(commerce, /MEMBER_PAID_POINT_CHARGE_PUBLICLY_AVAILABLE = false/);
});
