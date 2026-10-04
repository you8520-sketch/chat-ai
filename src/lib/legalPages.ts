import { ATTENDANCE_DAY_REWARDS, ATTENDANCE_POINTS_VALID_DAYS } from "@/lib/attendanceConstants";
import {
  BUSINESS_CUSTOMER_SERVICE_EMAIL,
  BUSINESS_CUSTOMER_SERVICE_PHONE,
  BUSINESS_PUBLIC_LINES,
  BUSINESS_TRADE_NAME,
  PERSONAL_INFORMATION_PROTECTION_OFFICER_EMAIL,
  PERSONAL_INFORMATION_PROTECTION_OFFICER_NAME,
  PERSONAL_INFORMATION_PROTECTION_OFFICER_PHONE,
  SERVICE_PUBLIC_NAME,
} from "@/lib/businessIdentity";
import {
  EMAIL_SIGNUP_MAX_SENDS,
  EMAIL_SIGNUP_RESEND_COOLDOWN_MS,
  EMAIL_SIGNUP_TOKEN_TTL_MS,
} from "@/lib/emailSignupConstants";
import {
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE_FREE,
  POINT_GIFT_FEE_RATE_PAID,
} from "@/lib/pointGiftsShared";
import {
  formatPointChargePackagePublicLine,
  FREE_POINTS_VALID_YEARS,
  PAID_POINTS_VALID_YEARS,
  POINT_CHARGE_CANCEL_DAYS,
  POINT_CHARGE_PACKAGES,
  SIGNUP_BONUS_POINTS,
} from "@/lib/plans";
import {
  CROSS_BORDER_PUBLIC_TABLE,
  formatCrossBorderPrivacyParagraphs,
} from "@/lib/privacyCrossBorder";
import { SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS } from "@/lib/servicePublicCommerce";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/sessionCookie";
import { SITE_DESCRIPTION, SITE_DISPLAY_NAME } from "@/lib/siteBrand";

/** Site-wide public legal links. Footer always renders this set. */
export const PUBLIC_LEGAL_LINKS = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/refund", label: "결제 및 환불 정책" },
] as const;

export const LEGAL_DOCUMENT_AS_OF = "2026-10-04";

const GIFT_FEE_PAID_PERCENT = Math.round(POINT_GIFT_FEE_RATE_PAID * 100);
const GIFT_FEE_FREE_PERCENT = Math.round(POINT_GIFT_FEE_RATE_FREE * 100);
const ATTENDANCE_REWARD_LINE = ATTENDANCE_DAY_REWARDS.map((points) => `${points}P`).join("·");
const SIGNUP_BONUS_LINE = `${SIGNUP_BONUS_POINTS.toLocaleString("ko-KR")}P`;
const EMAIL_TOKEN_MINUTES = EMAIL_SIGNUP_TOKEN_TTL_MS / 60_000;
const EMAIL_RESEND_MINUTES = EMAIL_SIGNUP_RESEND_COOLDOWN_MS / 60_000;
const SESSION_DAYS = SESSION_MAX_AGE_SECONDS / (24 * 60 * 60);
const CUSTOMER_SERVICE_LINE = `고객센터 전화 ${BUSINESS_CUSTOMER_SERVICE_PHONE}, 이메일 ${BUSINESS_CUSTOMER_SERVICE_EMAIL}`;

const POINT_CHARGE_PRODUCT_PARAGRAPHS = [
  "포인트 상품은 아래 5종입니다.",
  ...POINT_CHARGE_PACKAGES.map(formatPointChargePackagePublicLine),
  "일반 회원 충전이 완료되면 해당 계정에 유료 포인트와 충전 보너스 무료 포인트를 즉시 적립하고, 대화 등 서비스 이용 시 포인트를 차감합니다.",
  `유료 포인트와 충전 보너스 무료 포인트의 유효기간은 지급일로부터 ${PAID_POINTS_VALID_YEARS}년입니다. 일반 무료 포인트의 유효기간도 ${FREE_POINTS_VALID_YEARS}년입니다.`,
  `출석 포인트의 유효기간은 지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일입니다. 주간 출석 보상은 ${ATTENDANCE_REWARD_LINE}입니다.`,
] as const;

export type LegalTable = {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
};

export type LegalSection = {
  id: string;
  article: number;
  heading: string;
  paragraphs: readonly string[];
  table?: LegalTable;
};

export type LegalPage = {
  title: string;
  href: (typeof PUBLIC_LEGAL_LINKS)[number]["href"];
  intro: readonly string[];
  sections: readonly LegalSection[];
};

function article(
  articleNumber: number,
  id: string,
  heading: string,
  paragraphs: readonly string[],
  table?: LegalTable,
): LegalSection {
  return table
    ? { id, article: articleNumber, heading, paragraphs, table }
    : { id, article: articleNumber, heading, paragraphs };
}

export function flattenLegalPageText(page: {
  intro: readonly string[];
  sections: readonly LegalSection[];
}): string {
  return [
    page.intro.join("\n"),
    ...page.sections.flatMap((section) => [
      `제${section.article}조 ${section.heading}`,
      ...section.paragraphs,
      ...(section.table
        ? [
            section.table.columns.join(" | "),
            ...section.table.rows.map((row) => row.join(" | ")),
          ]
        : []),
    ]),
  ].join("\n");
}

export const TERMS_PAGE = {
  title: "이용약관",
  href: "/terms",
  intro: [
    `${SITE_DISPLAY_NAME}는 ${SITE_DESCRIPTION}입니다.`,
    `이 약관은 ${SERVICE_PUBLIC_NAME} 서비스의 이용 조건이며, ${LEGAL_DOCUMENT_AS_OF}부터 시행합니다.`,
    ...SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS,
    "결제 금액, 포인트 지급, 유효기간, 결제 취소의 상세는 결제 및 환불 정책을 따릅니다.",
  ],
  sections: [
    article(1, "purpose", "목적", [
      `이 약관은 ${BUSINESS_TRADE_NAME}(이하 “회사”)가 운영하는 ${SERVICE_PUBLIC_NAME} 서비스의 이용과 관련하여 회사와 이용자의 권리, 의무 및 책임 사항을 정합니다.`,
    ]),
    article(2, "definitions", "정의", [
      `“서비스”란 회사가 웹 사이트를 통해 제공하는 AI 캐릭터 대화, 캐릭터·페르소나 제작, 포인트 이용 및 관련 기능을 말합니다.`,
      `“회원”이란 이 약관에 따라 이용계약을 맺고 계정을 만든 자를 말합니다.`,
      `“포인트”란 서비스 이용 대가를 차감하는 단위입니다. 결제 대금에 대응하는 유료 포인트와 보너스·출석·가입 혜택 등으로 지급되는 무료 포인트로 나뉩니다.`,
      `“콘텐츠”란 회원이 입력·업로드하거나 생성한 글과 이미지, 캐릭터, 페르소나, 대화, 그리고 서비스가 생성한 글과 이미지를 말합니다.`,
    ]),
    article(3, "contract", "이용계약과 회원", [
      "이용계약은 이용자가 회원가입을 완료함으로써 성립합니다.",
      "가입 화면에서 이용약관, 개인정보처리방침, 결제 및 환불 정책을 확인할 수 있습니다.",
      "Google 계정 또는 이메일·비밀번호로 가입할 수 있습니다.",
      `이메일로 가입을 요청하면 계정이 바로 만들어지지 않습니다. 회사는 인증 메일을 보내고, 인증 링크는 ${EMAIL_TOKEN_MINUTES}분 동안만 유효합니다. 재발송은 ${EMAIL_RESEND_MINUTES}분에 한 번, 최대 ${EMAIL_SIGNUP_MAX_SENDS}회입니다.`,
      `인증을 완료하면 계정이 만들어지고 가입 보너스 ${SIGNUP_BONUS_LINE}가 한 번만 지급됩니다. 링크를 열어 상태만 확인하는 것으로는 가입이 완료되지 않습니다.`,
    ]),
    article(4, "account", "계정 관리", [
      "회원은 자신의 계정 정보를 정확하게 유지하고, 비밀번호와 로그인 수단을 다른 사람에게 빌려주지 않아야 합니다.",
      "비밀번호 재설정 기능은 현재 제공하지 않습니다.",
      `로그인한 세션은 만든 시점부터 ${SESSION_DAYS}일이며, 이용할 때마다 연장되지 않습니다. 로그아웃하면 해당 브라우저 세션만 종료됩니다.`,
      "계정 전체를 삭제하는 기능은 현재 없습니다. 탈퇴를 원하는 회원은 고객센터로 요청할 수 있으나, 즉시 자동 삭제되지는 않습니다.",
    ]),
    article(5, "service", "서비스의 제공, 변경, 중단", [
      `${SITE_DISPLAY_NAME}는 로그인한 회원이 AI 캐릭터와 대화하고, 캐릭터·페르소나를 만들며, 포인트를 사용하는 웹 서비스입니다.`,
      "대화 응답은 로그인한 계정에서만 제공됩니다.",
      "회사는 운영상 필요에 따라 기능, 제공 범위, 요금, 사용 가능한 모델을 바꾸거나 일시적으로 중단할 수 있습니다.",
      "점검, 장애, 외부 제공업체의 중단으로 서비스가 지연되거나 멈출 수 있습니다.",
    ]),
    article(6, "ai-output", "AI 생성 콘텐츠", [
      "AI가 만든 글과 이미지는 서비스 제공을 위해 생성되며, 사실, 조언, 결과의 정확성이나 특정 산출물을 보장하지 않습니다.",
      "회원은 AI 결과를 그대로 사실이나 전문 자문으로 사용해서는 안 됩니다.",
    ]),
    article(7, "user-content", "이용자 콘텐츠와 권리·책임", [
      "회원이 만든 캐릭터, 페르소나, 대화, 업로드 이미지에 대한 책임은 해당 회원에게 있습니다.",
      "회원은 자신의 대화방을 삭제할 수 있습니다. 그때 그 대화의 메시지와 연결된 기억 등이 함께 지워집니다. 자신이 만든 캐릭터와 페르소나 등 일부 콘텐츠도 삭제할 수 있습니다.",
      "회원은 타인의 권리를 침해하거나 법령에 위반되는 콘텐츠를 올려서는 안 됩니다.",
    ]),
    article(8, "prohibited", "금지행위와 이용제한", [
      "회원은 법령을 위반하거나, 다른 사람 또는 회사의 권리를 침해하거나, 서비스를 부정하게 이용해서는 안 됩니다.",
      "금지되는 행위의 예는 불법·유해 콘텐츠 게시, 지식재산권 침해, 괴롭힘, 계정 도용, 결제·포인트 부정 사용, 자동화된 대량 요청입니다.",
      "회사는 위반이 확인되면 콘텐츠 삭제, 기능 제한, 계정 이용 제한 등 필요한 조치를 할 수 있습니다.",
    ]),
    article(9, "points", "유료 포인트 및 유료 서비스", [
      ...POINT_CHARGE_PRODUCT_PARAGRAPHS,
      `일반 회원 충전의 결제 취소 지원은 충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내 미사용인 경우이며, 자세한 조건은 결제 및 환불 정책에 있습니다.`,
    ]),
    article(10, "adult", "미성년자 및 성인 콘텐츠", [
      "일부 캐릭터와 기능은 성인 콘텐츠로 표시됩니다. 성인 콘텐츠는 성인 이용자에게만 제공되는 기능이며, 외부 본인확인 연동 전까지 일반 회원에게는 제공하지 않습니다.",
    ]),
    article(11, "liability", "회사와 이용자의 책임", [
      "회사는 안정적인 서비스 제공을 위해 노력합니다. 다만 AI 응답, 이용자가 만든 콘텐츠, 외부 제공업체의 처리 결과는 사실이나 특정 목적을 보장하지 않습니다.",
      "회원은 자신의 계정 사용과 게시한 콘텐츠에 책임을 집니다.",
    ]),
    article(12, "termination", "계약 해지와 회원 탈퇴", [
      "회원은 고객센터를 통해 이용계약 해지를 요청할 수 있습니다.",
      "계정 전체를 한 번에 삭제하는 기능은 현재 없습니다. 회사는 요청을 받은 뒤 처리 가능 범위와 일정을 안내합니다.",
      "회사는 이 약관을 중대하게 위반한 회원에 대해 이용을 제한하거나 이용계약을 해지할 수 있습니다.",
    ]),
    article(13, "business", "사업자 정보", [
      `${SERVICE_PUBLIC_NAME}는 서비스 브랜드명이고, 법적 상호는 ${BUSINESS_TRADE_NAME}입니다.`,
      ...BUSINESS_PUBLIC_LINES,
    ]),
    article(14, "disputes", "분쟁 및 문의", [
      `문의는 ${CUSTOMER_SERVICE_LINE}로 받습니다.`,
      "회사는 접수된 문의와 분쟁을 성실히 검토합니다.",
    ]),
    article(15, "notice", "시행일과 변경 고지", [
      `이 약관의 시행일은 ${LEGAL_DOCUMENT_AS_OF}입니다.`,
      "내용이 바뀌면 이 페이지에 시행일과 함께 다시 게시합니다.",
    ]),
  ],
} as const satisfies LegalPage;

export const PRIVACY_PAGE = {
  title: "개인정보처리방침",
  href: "/privacy",
  intro: [
    `${SITE_DISPLAY_NAME}는 ${SITE_DESCRIPTION}입니다.`,
    `이 방침은 ${BUSINESS_TRADE_NAME}이 ${SERVICE_PUBLIC_NAME} 서비스에서 개인정보를 어떻게 처리하는지 알리며, ${LEGAL_DOCUMENT_AS_OF}부터 시행합니다.`,
  ],
  sections: [
    article(1, "controller", "개인정보 처리자", [
      `${SERVICE_PUBLIC_NAME} 서비스의 개인정보 처리자는 상호 ${BUSINESS_TRADE_NAME}입니다.`,
      ...BUSINESS_PUBLIC_LINES,
    ]),
    article(2, "purpose", "처리 목적", [
      "회원 가입, 이메일 인증, 로그인, 기존 계정 연결에 사용합니다.",
      "대화, 이미지 생성·편집, 포인트 충전·사용·선물, 출석, 크리에이터 출금 등 요청한 기능을 제공하는 데 사용합니다.",
      "문의·피드백 처리와 브라우저 알림 발송에 사용합니다.",
    ]),
    article(3, "items", "처리 항목", [
      "Google 로그인 시 계정 식별자, 이메일, 표시 이름을 받습니다.",
      "이메일 가입 시 이메일, 닉네임, 비밀번호를 받습니다. 인증이 끝나기 전에는 계정이 만들어지지 않습니다.",
      "로그인한 계정의 대화, 메시지, 페르소나, 캐릭터, 업로드 이미지, 기억과 요약을 저장합니다.",
      "크리에이터 출금 신청 시 은행명, 계좌번호, 주민등록번호를 받습니다.",
      "결제 시 이용자, 상품, 결제 식별자, 금액, 상태가 기록됩니다.",
      "브라우저 알림을 켜면 구독 정보를 저장합니다.",
    ]),
    article(4, "retention", "보유 및 이용 기간", [
      "별도로 정한 기간이 지나면 자동으로 지우는 보관 기간은 없습니다.",
      `이메일 가입 인증 링크의 유효기간은 ${EMAIL_TOKEN_MINUTES}분입니다.`,
      `로그인 세션은 만든 시점부터 ${SESSION_DAYS}일이며, 이용할 때마다 연장되지 않습니다. 로그아웃하면 그 세션은 지워집니다.`,
    ]),
    article(5, "third-party", "제3자 제공", [
      "마케팅·광고를 위한 제3자 제공은 없습니다.",
    ]),
    article(6, "processors", "처리위탁", [
      "회사는 서비스 제공을 위해 아래 업무를 위탁합니다.",
      "OpenRouter, Cheaper Inference: 대화 응답 생성. OpenRouter: 기억 검색용 변환.",
      "OpenAI: 이미지 생성·편집.",
      "Resend: 가입 인증 메일 발송.",
      "Google: 로그인, 글꼴 표시, 피드백 전달.",
      "PortOne: 결제 처리.",
      "브라우저 알림을 켠 경우 알림 발송.",
    ]),
    article(
      7,
      "cross-border",
      "국외 이전",
      formatCrossBorderPrivacyParagraphs().slice(0, 1),
      {
        columns: CROSS_BORDER_PUBLIC_TABLE.columns,
        rows: CROSS_BORDER_PUBLIC_TABLE.rows,
      },
    ),
    article(8, "destruction", "파기", [
      "로그아웃은 현재 세션만 지웁니다.",
      "이용자는 자신의 대화방을 삭제할 수 있습니다. 그때 그 대화의 메시지와 연결된 기억 등이 함께 지워집니다. 자신이 만든 캐릭터와 페르소나 등 일부 콘텐츠도 삭제할 수 있습니다.",
      "계정 전체를 삭제하는 기능은 없습니다.",
    ]),
    article(9, "rights", "정보주체의 권리", [
      "이용자는 로그인 후 자신의 프로필, 대화, 캐릭터, 페르소나, 포인트 내역을 볼 수 있고, 대화와 일부 콘텐츠를 삭제할 수 있습니다.",
      `그 밖의 열람·정정·삭제 요청은 ${CUSTOMER_SERVICE_LINE}로 받습니다.`,
    ]),
    article(10, "cookies", "쿠키", [
      "로그인을 유지하기 위해 브라우저에 로그인 세션 쿠키를 둡니다. 최대 기간은 30일이며, 암호화된 연결에서만 전송됩니다.",
      `로그인 세션은 만든 시점부터 ${SESSION_DAYS}일입니다. 로그아웃하면 그 세션과 쿠키를 삭제합니다.`,
      "이메일 인증과 Google 로그인 진행 중에는 필요한 동안만 진행 쿠키를 둡니다.",
      "브라우저 설정에서 쿠키를 차단할 수 있으나, 로그인 등 일부 기능이 동작하지 않을 수 있습니다.",
    ]),
    article(11, "security", "안전성 확보조치", [
      "비밀번호와 이메일 인증 토큰은 해시로 저장합니다.",
      "크리에이터 출금 시 주민등록번호는 암호화해 저장합니다.",
      "로그인 세션 쿠키는 서버에서만 읽을 수 있으며, 암호화된 연결에서만 전송됩니다.",
    ]),
    article(12, "dpo", "개인정보 보호책임자", [
      `개인정보 보호책임자는 대표자 ${PERSONAL_INFORMATION_PROTECTION_OFFICER_NAME}입니다.`,
      `연락처는 전화 ${PERSONAL_INFORMATION_PROTECTION_OFFICER_PHONE}, 이메일 ${PERSONAL_INFORMATION_PROTECTION_OFFICER_EMAIL}입니다.`,
    ]),
    article(13, "changes", "변경", [
      `이 방침의 시행일은 ${LEGAL_DOCUMENT_AS_OF}입니다.`,
      "내용이 바뀌면 이 페이지에 시행일과 함께 다시 게시합니다.",
    ]),
  ],
} as const satisfies LegalPage;

export const PAYMENT_REFUND_PAGE = {
  title: "결제 및 환불 정책",
  href: "/refund",
  intro: [
    `${SITE_DISPLAY_NAME}의 포인트 상품, 유효기간, 선물, 결제 취소 조건을 알립니다. 시행일은 ${LEGAL_DOCUMENT_AS_OF}입니다.`,
  ],
  sections: [
    article(1, "products", "포인트 상품", POINT_CHARGE_PRODUCT_PARAGRAPHS),
    article(2, "grant-use", "지급 시점과 사용", [
      `이메일 가입 보너스 ${SIGNUP_BONUS_LINE}는 인증 확인이 완료된 뒤에 한 번만 지급됩니다.`,
      "일반 회원 충전이 완료되면 유료 포인트와 충전 보너스 무료 포인트가 해당 계정에 즉시 적립됩니다.",
      "대화 등 서비스 이용 시 포인트가 차감됩니다. 사용 시 만료가 가까운 포인트부터, 같은 만료라면 무료 포인트부터 차감됩니다.",
      "출석 포인트는 선물할 수 없습니다.",
    ]),
    article(3, "expiry", "유효기간", [
      `유료 포인트와 충전 보너스 무료 포인트의 유효기간은 지급일로부터 ${PAID_POINTS_VALID_YEARS}년입니다. 일반 무료 포인트의 유효기간도 ${FREE_POINTS_VALID_YEARS}년입니다.`,
      `출석 포인트의 유효기간은 지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일입니다. 주간 출석 보상은 ${ATTENDANCE_REWARD_LINE}입니다.`,
      `포인트 사용기간(${PAID_POINTS_VALID_YEARS}년)과 아래 결제 취소 지원기간(${POINT_CHARGE_CANCEL_DAYS}일)은 다릅니다.`,
    ]),
    article(4, "gifts", "선물과 수수료", [
      `포인트를 다른 이용자에게 선물할 수 있습니다. 최소 금액은 ${MIN_POINT_GIFT_AMOUNT.toLocaleString("ko-KR")}P입니다.`,
      `수수료는 유료 ${GIFT_FEE_PAID_PERCENT}%, 무료 ${GIFT_FEE_FREE_PERCENT}%이며, 받는 사람은 수수료를 제외한 금액을 받습니다.`,
      "출석 포인트는 선물할 수 없습니다.",
    ]),
    article(5, "cancel-support", "하브가 제공하는 결제 취소 지원", [
      `회사는 일반 회원 충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내이고, 해당 충전으로 지급된 유료 포인트와 충전 보너스 무료 포인트를 사용하지 않은 경우 PortOne을 통해 결제를 취소하는 지원 경로를 제공합니다.`,
      "이미 취소된 결제, 유료 또는 보너스 포인트를 일부라도 사용한 충전, 결제 정보가 연결되지 않은 충전은 이 자동 취소 지원 대상이 아닙니다.",
      `충전 후 ${POINT_CHARGE_CANCEL_DAYS}일이 지난 결제, 출석 포인트, 가입 보너스, 선물로 받은 포인트는 이 경로의 대상이 아닙니다.`,
      "취소를 요청하면 해당 충전의 포인트 사용이 보류되고, 결제 취소가 확인된 뒤에 취소가 확정됩니다.",
    ]),
    article(6, "cooling-off", "법정 청약철회와의 관계", [
      `위 ${POINT_CHARGE_CANCEL_DAYS}일 미사용 결제 취소는 하브가 제공하는 지원 경로이며, 전자상거래법상 청약철회·계약해제와 같은 권리가 아닙니다.`,
    ]),
    article(7, "refund-method", "환급 방법과 처리", [
      "자동 취소 지원 조건에 맞는 요청은 원래 결제에 사용한 수단으로 PortOne 취소가 진행됩니다.",
      "처리 완료 시점은 결제 수단과 카드사·결제대행사 처리에 따릅니다.",
      `조건에 맞지 않거나 자동 경로로 처리할 수 없는 경우 ${CUSTOMER_SERVICE_LINE}로 문의해 주세요.`,
    ]),
    article(8, "errors", "오류·중복 결제", [
      "진행 중인 결제 요청이 있으면 같은 계정에서 추가 결제 요청이 받아들여지지 않을 수 있습니다.",
      "오류 표시, 중복 결제, 금액 오기가 확인되면 회사는 해당 결제를 취소하거나 정정할 수 있습니다. 이미 결제된 금액은 확인 후 원래 결제 수단으로 돌려드립니다.",
      `자동 취소 지원 조건 밖인 경우에는 ${CUSTOMER_SERVICE_LINE}로 접수해 주세요.`,
    ]),
    article(9, "inquiry", "문의", [
      `결제·취소 문의는 ${CUSTOMER_SERVICE_LINE}로 받습니다.`,
      `이 정책의 시행일은 ${LEGAL_DOCUMENT_AS_OF}입니다.`,
    ]),
  ],
} as const satisfies LegalPage;
