import { ATTENDANCE_DAY_REWARDS, ATTENDANCE_POINTS_VALID_DAYS } from "@/lib/attendanceConstants";
import {
  BUSINESS_CUSTOMER_SERVICE_EMAIL,
  BUSINESS_OPERATING_STATUS,
  BUSINESS_PUBLIC_LINES,
  BUSINESS_TRADE_NAME,
  SERVICE_PUBLIC_NAME,
} from "@/lib/businessIdentity";
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
import { SITE_DESCRIPTION, SITE_DISPLAY_NAME } from "@/lib/siteBrand";

/** Site-wide public legal links. Footer always renders this set. */
export const PUBLIC_LEGAL_LINKS = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/refund", label: "결제 및 환불 정책" },
] as const;

export const LEGAL_DOCUMENT_AS_OF = "2026-10-03";

const GIFT_FEE_PAID_PERCENT = Math.round(POINT_GIFT_FEE_RATE_PAID * 100);
const GIFT_FEE_FREE_PERCENT = Math.round(POINT_GIFT_FEE_RATE_FREE * 100);
const ATTENDANCE_REWARD_LINE = ATTENDANCE_DAY_REWARDS.map((points) => `${points}P`).join("·");
const SIGNUP_BONUS_LINE = `${SIGNUP_BONUS_POINTS.toLocaleString("ko-KR")}P`;

const POINT_CHARGE_PRODUCT_PARAGRAPHS = [
  "포인트 상품은 아래 5종입니다. 결제 기능이 꺼져 있어도 상품 정보는 공개합니다.",
  ...POINT_CHARGE_PACKAGES.map(formatPointChargePackagePublicLine),
  "서비스 제공 방식: 일반 회원 충전이 완료되면 해당 계정에 유료 포인트와 충전 보너스 무료 포인트를 즉시 적립하고, 대화 등 서비스 이용 시 포인트를 차감합니다.",
  `유료 포인트와 충전 보너스 무료 포인트의 유효기간은 지급일로부터 ${PAID_POINTS_VALID_YEARS}년입니다. 일반 무료 포인트의 유효기간도 ${FREE_POINTS_VALID_YEARS}년입니다.`,
  `출석 포인트의 유효기간은 지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일입니다. 주간 출석 보상은 ${ATTENDANCE_REWARD_LINE}입니다.`,
] as const;

const MEMBER_CHARGE_STATUS_PARAGRAPHS = [
  `일반 회원 포인트 충전은 PORTONE_CHARGE_ENABLED가 명시적으로 1 또는 true이고 PortOne 상점·채널·서버 검증 값이 있을 때만 진행됩니다. 값이 비어 있거나 다른 문자열이면 충전 요청은 거절됩니다. 상품 공개와 실제 결제 활성화는 별개입니다. 현재 사업자 상태가 ${BUSINESS_OPERATING_STATUS}이므로 결제를 활성화하지 않습니다.`,
  "포트원 심사 계정 전용 KG이니시스 테스트 결제창은 별도의 심사 전용 설정이 켜진 경우에만 열릴 수 있으며, 그 결제는 포인트를 지급하지 않고 매출로 집계하지 않습니다. 시험용 결제와 일반 회원의 유료 구매 가능 여부는 다릅니다.",
] as const;

const ADULT_ACCESS_PARAGRAPHS = [
  "외부 본인확인 제공업체가 연동되기 전까지 앱 안의 입력 화면, 모의 인증, 저장된 성인 표시는 성인 콘텐츠 열람을 열지 않습니다. 기존 관리자 권한의 베타 테스트 접근만 성인 목록·상세·채팅을 볼 수 있으며, 그 접근은 성인 인증 기록으로 승격되지 않습니다.",
  "SKIP_ADULT_VERIFICATION이나 결제 비활성 설정은 진단 플래그로 남을 수 있지만 일반 회원의 성인 접근을 부여하지 않습니다.",
] as const;

export type LegalSection = {
  id: string;
  article: number;
  heading: string;
  paragraphs: readonly string[];
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
): LegalSection {
  return { id, article: articleNumber, heading, paragraphs };
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
    ]),
  ].join("\n");
}

export const TERMS_PAGE = {
  title: "이용약관",
  href: "/terms",
  intro: [
    `${SITE_DISPLAY_NAME}는 ${SITE_DESCRIPTION}입니다. 현재 개발·시험 단계의 서비스입니다.`,
    `이 약관은 ${LEGAL_DOCUMENT_AS_OF}부터 시행하며, 같은 날 기준 서비스 코드가 실제로 제공하는 조건만 적습니다.`,
    "결제 금액, 포인트 지급, 유효기간, 결제 취소 조건의 상세는 결제 및 환불 정책을 따릅니다.",
  ],
  sections: [
    article(1, "purpose", "목적", [
      `이 약관은 ${SERVICE_PUBLIC_NAME} 서비스의 이용 조건과 운영 사실을 알리기 위한 것입니다.`,
      "확인되지 않은 권리·의무나 법정 해석은 이 약관에서 단정하지 않습니다.",
    ]),
    article(2, "service", "서비스", [
      `${SITE_DISPLAY_NAME}는 로그인한 이용자가 AI 캐릭터와 대화하고, 캐릭터·페르소나를 만들며, 포인트를 사용하는 웹 서비스입니다.`,
      "대화 응답은 로그인한 계정에서만 제공됩니다. AI가 만든 답변은 사실, 조언, 결과의 정확성을 보장하지 않습니다.",
    ]),
    article(3, "account", "계정", [
      "Google 계정 또는 이메일·비밀번호로 계정을 만들 수 있습니다.",
      `이메일로 가입을 요청하면 계정이 바로 만들어지지 않습니다. 서버는 이메일, 닉네임, 비밀번호 해시, 취향, 인증 토큰 해시를 대기 가입으로 두고 인증 메일을 보냅니다. 인증 링크는 30분 동안만 유효하고, 재발송은 1분에 한 번, 최대 5회입니다.`,
      `링크를 열어 상태를 확인하는 것만으로는 가입이 완료되지 않습니다. 확인을 완료하면 계정이 만들어지고 가입 보너스 ${SIGNUP_BONUS_LINE}가 한 번만 지급됩니다.`,
      "비밀번호 재설정과 계정 전체를 삭제하는 기능은 현재 없습니다.",
      "로그아웃은 현재 브라우저 세션만 지웁니다.",
    ]),
    article(4, "use", "이용", [
      "이용자는 입력한 내용과 직접 만든 캐릭터·페르소나에 주의해야 합니다.",
      "이용자는 자신의 대화방을 삭제할 수 있습니다. 그때 그 대화의 메시지와 연결된 기억 등이 함께 지워집니다. 자신이 만든 캐릭터와 페르소나 등 일부 콘텐츠도 삭제할 수 있습니다.",
      "서비스 내용과 제공 여부는 개발·시험 과정에서 바뀔 수 있고, 일시적으로 끊길 수 있습니다.",
    ]),
    article(5, "business", "사업자 정보", [
      `${SERVICE_PUBLIC_NAME}는 서비스 브랜드명이고, 법적 상호는 ${BUSINESS_TRADE_NAME}입니다.`,
      ...BUSINESS_PUBLIC_LINES,
      "통신판매업 신고번호는 확인되지 않아 기재하지 않습니다.",
    ]),
    article(6, "points", "유료 서비스와 포인트", [
      ...POINT_CHARGE_PRODUCT_PARAGRAPHS,
      ...MEMBER_CHARGE_STATUS_PARAGRAPHS,
      `결제 취소는 충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내이고, 해당 충전으로 지급된 유료 포인트와 충전 보너스 무료 포인트를 사용하지 않은 경우에만 PortOne 결제 취소로 처리합니다.`,
      "상품 가격, 유효기간, 선물, 결제 취소의 자세한 조건은 결제 및 환불 정책에 있습니다.",
    ]),
    article(7, "adult", "성인 콘텐츠", [
      "일부 캐릭터와 기능은 성인 콘텐츠로 표시됩니다.",
      ...ADULT_ACCESS_PARAGRAPHS,
    ]),
    article(8, "ai-output", "이용자 콘텐츠와 AI 결과", [
      "이용자가 만든 캐릭터, 페르소나, 대화, 업로드 이미지의 보관과 삭제는 해당 기능이 있는 범위에서 이용자가 관리합니다.",
      "AI가 생성한 글과 이미지는 서비스 제공을 위해 만들어지며, 사실 확인이나 특정 결과물을 약속하지 않습니다.",
    ]),
    article(9, "privacy", "개인정보", [
      "개인정보 처리 내용은 개인정보처리방침에 따릅니다.",
      "계정 전체를 삭제하는 기능과, 정한 기간 뒤 자동으로 지우는 보관 기간은 현재 없습니다.",
    ]),
    article(10, "availability", "제공의 변경과 중단", [
      "개발·시험 단계에서 기능, 요금, 모델, 제공 범위가 바뀔 수 있습니다.",
      "점검, 장애, 외부 제공업체 중단으로 서비스가 일시적으로 멈추거나 지연될 수 있습니다.",
    ]),
    article(11, "disclaimer", "책임의 한계", [
      "AI 응답, 이용자가 만든 콘텐츠, 외부 제공업체의 처리 결과는 사실이나 특정 목적을 보장하지 않습니다.",
      "이 조항은 법령이 허용하지 않는 책임 제한을 주장하지 않습니다.",
    ]),
    article(12, "notice", "고지와 문의", [
      `문의는 고객센터 이메일 ${BUSINESS_CUSTOMER_SERVICE_EMAIL}로 받습니다.`,
      `이 약관의 시행일은 ${LEGAL_DOCUMENT_AS_OF}입니다. 내용이 바뀌면 이 페이지에 시행일과 함께 다시 게시합니다.`,
    ]),
  ],
} as const satisfies LegalPage;

export const PRIVACY_PAGE = {
  title: "개인정보처리방침",
  href: "/privacy",
  intro: [
    `${SITE_DISPLAY_NAME}는 ${SITE_DESCRIPTION}입니다.`,
    `이 방침은 ${LEGAL_DOCUMENT_AS_OF}부터 시행하며, 같은 날 기준 서비스 코드가 처리하는 내용만 설명합니다.`,
    "법률상 필수 고지와 실제 구현이 아직 맞지 않는 항목은 충족했다고 쓰지 않고, 현재 상태를 그대로 적습니다.",
  ],
  sections: [
    article(1, "controller", "개인정보 처리자", [
      `${SERVICE_PUBLIC_NAME} 서비스의 개인정보 처리자는 상호 ${BUSINESS_TRADE_NAME}입니다.`,
      ...BUSINESS_PUBLIC_LINES,
      "통신판매업 신고번호는 확인되지 않아 기재하지 않습니다.",
    ]),
    article(2, "purpose", "처리 목적", [
      "회원 가입, 이메일 인증, 로그인, 기존 계정 연결에 사용합니다.",
      "대화, 이미지 생성·편집, 포인트 충전·사용·선물, 출석, 크리에이터 출금 등 요청한 기능을 제공하는 데 사용합니다.",
      "성인 콘텐츠 접근 제한, 피드백 전달, 설정된 경우 웹 푸시 알림에 사용합니다.",
      "광고성 이메일·문자 발송 기능은 현재 서비스 코드에 없습니다.",
    ]),
    article(3, "items", "처리 항목", [
      "Google 로그인은 openid, email, profile 권한을 요청합니다. Google 사용자 정보에서 계정 식별자(sub), 이메일, 표시 이름(name)을 읽습니다. 그 밖의 프로필 항목은 저장하지 않습니다.",
      "새 계정에는 이메일과 Google 계정 식별자를 저장합니다. 표시 이름이 있으면 그 이름을 닉네임으로 쓰고, 없으면 이메일 앞부분을 닉네임으로 씁니다.",
      "같은 Google 계정 식별자의 계정이 있으면 그 계정으로 로그인합니다. 식별자는 없고 이메일이 같은 계정이 있으면 그 계정에 Google 계정 식별자를 연결합니다. 이때 기존 이메일과 닉네임은 바꾸지 않습니다.",
      "이메일로 가입을 요청하면 이메일, 닉네임, 비밀번호 해시, 취향, 인증 토큰 해시, 만료 시각, 발송 횟수, 최근 발송 시각을 대기 가입으로 둡니다. 비밀번호 원문과 인증 토큰 원문은 저장하지 않습니다.",
      "확인을 완료하면 이메일, 닉네임, 비밀번호 해시를 계정으로 저장합니다. 링크를 열어 상태를 확인하는 것만으로는 계정이 만들어지지 않습니다.",
      "로그인한 계정의 대화, 메시지, 페르소나, 캐릭터, 업로드 이미지, 대화에서 만든 기억과 요약을 저장합니다.",
      "앱 안의 성인 확인 화면은 이름·생년월일·통신사를 받을 수 있으나, 저장된 성인 표시와 모의 인증은 성인 콘텐츠 열람을 열지 않습니다. 생년월일과 통신사는 저장하지 않습니다.",
      "크리에이터 출금 신청 시 은행명, 계좌번호, 주민등록번호를 받습니다. 일반 회원 결제 기록에는 이용자, 상품, 결제 식별자, 금액, 상태가 저장됩니다. 심사 전용 테스트 결제는 포인트를 지급하지 않고 매출로 집계하지 않습니다.",
      "웹 푸시가 켜진 환경에서는 브라우저 구독 주소와 키를 저장합니다.",
    ]),
    article(4, "retention", "보유 및 이용 기간", [
      "정한 기간이 지나면 자동으로 지우는 보관 기간은 현재 없습니다.",
      "이메일 가입 대기는 인증 링크 유효기간 30분이 지나면 사용할 수 없습니다. 만료된 대기 행을 자동으로 지우는 별도 보관 기간은 두지 않습니다.",
      "세션은 만든 시점부터 30일이며, 요청마다 연장하지 않습니다. 로그아웃하면 그 세션은 지워집니다.",
      "이메일 인증 확인용 email_verify 쿠키는 남은 인증 시간만큼만 둡니다. Google 로그인 진행 중 쿠키는 최대 10분, 로그인하지 않은 방문자의 공지 읽음 쿠키는 최대 1년입니다.",
      "계정 데이터를 이용자가 한 번에 파기하는 기능이 없어, 보유 기간을 목적 달성 후로 단정하지 않습니다.",
    ]),
    article(5, "destruction", "파기", [
      "로그아웃은 현재 세션만 지웁니다.",
      "이용자는 자신의 대화방을 삭제할 수 있습니다. 그때 그 대화의 메시지와 연결된 기억 등이 함께 지워집니다. 자신이 만든 캐릭터와 페르소나 등 일부 콘텐츠도 삭제할 수 있습니다.",
      "계정 전체를 삭제하는 기능은 없습니다. 회원 탈퇴·계정 파기 절차는 이 방침에서 있는 것처럼 쓰지 않습니다.",
    ]),
    article(6, "processors", "처리 위탁과 외부 처리", [
      "대화 응답을 만들 때 이용자 메시지, 캐릭터 설정, 페르소나, 대화에 연결된 기억과 요약이 선택한 모델에 따라 OpenRouter 또는 Cheaper Inference로 전송됩니다. 일부 Gemini 모델은 OpenRouter를 거쳐 Google AI Studio로만 전달됩니다.",
      "이미지 생성·편집을 요청하면 프롬프트와 참조 이미지가 OpenAI 이미지 API로 전송됩니다.",
      "대화에서 추출한 기억 문장을 검색용 임베딩으로 만들 때 그 문장을 OpenRouter 임베딩 API로 보냅니다. 이 요청에는 해당 문장의 보관과 데이터 수집을 거부하는 설정이 포함됩니다. 대화 응답 요청에는 같은 설정이 없습니다.",
      "이메일 가입 인증 메일은 Resend로 보냅니다. 수신 이메일, 제목, 본문이 전송됩니다. 발신 주소와 API 키가 없으면 인증 메일을 보내지 않고 가입 요청을 거절합니다.",
      "피드백을 보내면 이용자 아이디, 닉네임, 피드백 내용이 Google Apps Script 주소로 전송됩니다.",
      "대화 글꼴 옵션을 쓰면 브라우저가 Google Fonts에 스타일시트를 요청합니다.",
      "웹 푸시는 서버에 VAPID 설정이 있을 때만 동작합니다. 그때 브라우저 구독 주소와 키를 저장하고, 알림 제목·본문·이동 링크를 그 구독 주소로 보냅니다.",
      ...MEMBER_CHARGE_STATUS_PARAGRAPHS,
      "일반 회원 충전이 진행되면 이용자, 상품, 결제 식별자, 금액, 상태가 PortOne과 서버 결제 기록에 남습니다.",
      "업로드 이미지는 서버 저장소에 둡니다. 블롭 저장 토큰이 설정된 경우에는 Vercel Blob에 저장할 수 있습니다.",
      "서비스 코드에는 별도의 제3자 분석 추적기를 두지 않습니다.",
    ]),
    article(7, "third-party", "제3자 제공", [
      "마케팅·광고를 위한 제3자 제공 기능은 현재 서비스 코드에 없습니다.",
      "위 외부 처리는 요청한 기능을 수행하기 위해 해당 제공업체로 전송하는 것이며, 별도의 판매·중개 제공 목록은 두지 않습니다.",
    ]),
    article(8, "cross-border", "국외 이전", [
      "OpenRouter, Cheaper Inference, OpenAI, Google, Resend, PortOne, 설정된 경우 Vercel Blob은 국외에 서버를 둘 수 있는 외부 제공업체입니다.",
      "실제로 나가는 항목은 제6조의 전송 내용과 같습니다. 대화 응답 요청에는 보관·수집 거부 설정이 없고, 임베딩 요청에만 그 설정이 있습니다.",
      "이전 국가, 보유 기간, 법적 근거, 거부권 행사 방법, 업체와의 계약 내용은 이 방침에서 확정하지 않습니다. 해당 고지는 아직 완료되지 않았습니다.",
    ]),
    article(9, "rights", "정보주체의 권리", [
      "이용자는 로그인 후 자신의 프로필, 대화, 캐릭터, 페르소나, 포인트 내역을 서비스 화면에서 볼 수 있습니다.",
      "이용자는 자신의 대화와 일부 콘텐츠를 삭제할 수 있습니다.",
      "계정 열람·정정·삭제를 한 번에 처리하는 창구와 회원 탈퇴 기능은 없습니다.",
      `그 밖의 요청은 ${BUSINESS_CUSTOMER_SERVICE_EMAIL}로 받을 수 있으나, 계정 전체 삭제 절차는 아직 없습니다.`,
    ]),
    article(10, "dpo", "개인정보 보호책임자", [
      "별도로 지정·공개된 개인정보 보호책임자의 성명과 연락처는 현재 없습니다.",
      `개인정보 관련 문의는 고객센터 이메일 ${BUSINESS_CUSTOMER_SERVICE_EMAIL}로 받습니다.`,
      "보호책임자 지정과 고지는 이 방침에서 충족했다고 쓰지 않습니다.",
    ]),
    article(11, "cookies", "쿠키와 유사 기술", [
      "로그인하면 임의의 세션 토큰을 만들어 서버에 저장하고, 브라우저에는 session 쿠키로 둡니다.",
      "session 쿠키는 HttpOnly, SameSite=Lax, 경로 /, 최대 30일입니다. 운영 환경에서는 Secure입니다. 서버의 만료 시각도 세션을 만든 시점부터 30일이며, 요청마다 연장하지 않습니다.",
      "로그아웃하면 그 세션 토큰을 지우고 session 쿠키를 삭제합니다.",
      "이메일 인증 확인 중에는 email_verify 쿠키를 남은 인증 시간만큼 둡니다. 이 쿠키는 HttpOnly, SameSite=Lax, 경로 / 이며, 운영 환경에서는 Secure입니다. 확인이 끝나거나 실패하면 지웁니다.",
      "Google 로그인 진행 중에는 oauth_state, oauth_return_to, oauth_redirect_after 쿠키를 최대 10분 둡니다. 이 쿠키는 HttpOnly, SameSite=Lax, 경로 / 입니다.",
      "로그인하지 않은 방문자의 공지 읽음 표시는 notice_read_id, notice_read_ids 쿠키에 최대 1년 저장합니다.",
    ]),
    article(12, "security", "안전성 확보 조치", [
      "비밀번호와 이메일 인증 토큰은 해시로 저장합니다.",
      "크리에이터 출금 시 주민등록번호는 암호화해 저장합니다.",
      "세션 쿠키와 email_verify 쿠키는 HttpOnly이며, 운영 환경에서는 Secure입니다.",
      "이 조치는 현재 코드가 하는 일을 적은 것이며, 법령상 안전조치 전부를 갖추었다고 단정하지 않습니다.",
    ]),
    article(13, "adult-verify", "성인 확인", ADULT_ACCESS_PARAGRAPHS),
    article(14, "creator-withdraw", "크리에이터 출금과 주민등록번호", [
      "크리에이터가 출금을 신청하면 은행명, 계좌번호, 주민등록번호를 받습니다. 화면과 서버는 원천징수 신고 목적으로 이 정보를 받습니다.",
      "주민등록번호는 암호화해 저장합니다. 현재 예금주 확인은 외부 은행 조회가 아니라 서버 안의 형식 검사입니다.",
      "고유식별정보 수집의 법적 근거와 대체 수단 여부는 이 방침에서 확정하지 않습니다.",
    ]),
    article(15, "training", "학습·분석", [
      "서비스 코드에는 별도의 제3자 분석 추적기를 두지 않습니다.",
      "학습 동의(training_consent) 값과 내보내기 경로는 코드에 있으나, 이용자가 동의하는 화면은 없고 이 방침에서 학습 이용을 운영 중이라고 고지하지 않습니다.",
    ]),
    article(16, "changes", "방침의 변경", [
      `이 방침의 시행일은 ${LEGAL_DOCUMENT_AS_OF}입니다.`,
      "내용이 바뀌면 이 페이지에 시행일과 함께 다시 게시합니다.",
    ]),
  ],
} as const satisfies LegalPage;

export const PAYMENT_REFUND_PAGE = {
  title: "결제 및 환불 정책",
  href: "/refund",
  intro: [
    `${SITE_DISPLAY_NAME}의 포인트 상품, 유효기간, 선물, 결제 취소 조건을 ${LEGAL_DOCUMENT_AS_OF} 기준 구현에 맞춰 알립니다.`,
    "이 문서는 체크아웃 화면의 상품 정보와 같은 값을 사용합니다. 법정 청약철회와 같은 권리라고 쓰지 않습니다.",
  ],
  sections: [
    article(1, "scope", "적용 범위", [
      "이 정책은 일반 회원 포인트 충전, 충전 보너스, 출석 포인트, 가입 보너스, 포인트 선물, PortOne 결제 취소에 적용합니다.",
      "심사 전용 KG이니시스 테스트 결제는 포인트를 지급하지 않고 매출로 집계하지 않으므로, 이 문서의 지급·취소 대상이 아닙니다.",
      "대화 신고 후 포인트 복구 등 다른 정산 경로는 이 문서의 결제 취소와 다릅니다.",
    ]),
    article(2, "products", "포인트 상품", POINT_CHARGE_PRODUCT_PARAGRAPHS),
    article(3, "payment-status", "결제 수단과 현재 상태", [
      "일반 회원 충전 결제는 PortOne을 통해 진행하도록 연결되어 있습니다.",
      ...MEMBER_CHARGE_STATUS_PARAGRAPHS,
    ]),
    article(4, "grant-use", "지급과 사용", [
      `이메일 가입 보너스 ${SIGNUP_BONUS_LINE}는 인증 확인이 완료된 뒤에 한 번만 지급됩니다. 인증 메일을 보낸 시점이나 링크를 열어 확인만 한 시점에는 지급되지 않습니다.`,
      "일반 회원 충전이 완료되면 유료 포인트와 충전 보너스 무료 포인트가 해당 계정에 즉시 적립됩니다.",
      "심사 전용 테스트 결제는 포인트를 지급하지 않습니다.",
      "대화 등 서비스 이용 시 포인트가 차감됩니다. 사용 시 만료 임박·무료 순으로 차감됩니다.",
      "출석 포인트는 선물할 수 없습니다.",
    ]),
    article(5, "expiry", "유효기간", [
      `유료 포인트와 충전 보너스 무료 포인트의 유효기간은 지급일로부터 ${PAID_POINTS_VALID_YEARS}년입니다. 일반 무료 포인트의 유효기간도 ${FREE_POINTS_VALID_YEARS}년입니다.`,
      `출석 포인트의 유효기간은 지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일입니다. 주간 출석 보상은 ${ATTENDANCE_REWARD_LINE}입니다.`,
      `포인트 사용기간(${PAID_POINTS_VALID_YEARS}년)과 결제 취소 지원기간(${POINT_CHARGE_CANCEL_DAYS}일)은 다릅니다.`,
    ]),
    article(6, "gifts", "포인트 선물", [
      `포인트를 다른 이용자에게 선물할 수 있습니다. 최소 금액은 ${MIN_POINT_GIFT_AMOUNT.toLocaleString("ko-KR")}P입니다.`,
      `수수료는 유료 ${GIFT_FEE_PAID_PERCENT}%, 무료 ${GIFT_FEE_FREE_PERCENT}%이며, 받는 사람은 수수료를 제외한 금액을 받습니다.`,
      "출석 포인트는 선물할 수 없습니다.",
    ]),
    article(7, "cancel", "결제 취소", [
      `현재 코드가 지원하는 결제 취소는 일반 회원 충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내이고, 해당 충전으로 지급된 유료 포인트와 충전 보너스 무료 포인트를 사용하지 않은 경우에만 PortOne 결제 취소로 처리하는 것입니다.`,
      "이미 취소된 결제, 유료 또는 보너스 포인트를 일부라도 사용한 충전, PortOne 결제 정보가 연결되지 않은 충전은 자동 결제 취소를 지원하지 않습니다.",
      `포인트 사용기간(${PAID_POINTS_VALID_YEARS}년)과 결제 취소 지원기간(${POINT_CHARGE_CANCEL_DAYS}일)은 다릅니다.`,
    ]),
    article(8, "cancel-exclusions", "취소되지 않는 경우", [
      `충전 후 ${POINT_CHARGE_CANCEL_DAYS}일이 지난 결제는 이 경로로 취소할 수 없습니다.`,
      "해당 충전의 유료 포인트 또는 충전 보너스 무료 포인트를 일부라도 사용하면 취소할 수 없습니다.",
      "출석 포인트, 가입 보너스, 선물로 받은 포인트, 심사 전용 테스트 결제는 이 결제 취소 대상이 아닙니다.",
    ]),
    article(9, "cooling-off", "청약철회와의 관계", [
      `이 정책의 ${POINT_CHARGE_CANCEL_DAYS}일 미사용 결제 취소는 전자상거래법상 청약철회·계약해제와 같은 권리가 아닙니다.`,
      "디지털콘텐츠에 대한 법정 청약철회의 적용 여부, 예외, 범위는 이 문서에서 확정하지 않습니다.",
    ]),
    article(10, "inquiry", "문의", [
      `결제·취소 문의는 고객센터 이메일 ${BUSINESS_CUSTOMER_SERVICE_EMAIL}로 받습니다.`,
      `이 정책의 시행일은 ${LEGAL_DOCUMENT_AS_OF}입니다.`,
    ]),
  ],
} as const satisfies LegalPage;
