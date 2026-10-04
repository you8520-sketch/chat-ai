import { ATTENDANCE_DAY_REWARDS, ATTENDANCE_POINTS_VALID_DAYS } from "@/lib/attendanceConstants";
import {
  BUSINESS_CUSTOMER_SERVICE_EMAIL,
  BUSINESS_CUSTOMER_SERVICE_PHONE,
  BUSINESS_PUBLIC_LINES,
  BUSINESS_REPRESENTATIVE_NAME,
  BUSINESS_TRADE_NAME,
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
  "포인트 상품은 아래 5종입니다. 상품 정보는 일반 회원 결제 제공 여부와 관계없이 공개합니다.",
  ...POINT_CHARGE_PACKAGES.map(formatPointChargePackagePublicLine),
  "일반 회원 충전이 완료되면 해당 계정에 유료 포인트와 충전 보너스 무료 포인트를 즉시 적립하고, 대화 등 서비스 이용 시 포인트를 차감합니다.",
  `유료 포인트와 충전 보너스 무료 포인트의 유효기간은 지급일로부터 ${PAID_POINTS_VALID_YEARS}년입니다. 일반 무료 포인트의 유효기간도 ${FREE_POINTS_VALID_YEARS}년입니다.`,
  `출석 포인트의 유효기간은 지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일입니다. 주간 출석 보상은 ${ATTENDANCE_REWARD_LINE}입니다.`,
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
      "가입 및 로그인 화면에는 이용약관, 개인정보처리방침, 결제 및 환불 정책의 링크를 둡니다. 현재 가입 화면에서 각 문서를 읽었거나 동의했음을 확인하는 체크박스나 별도 기록은 없습니다.",
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
      ...SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS,
      `일반 회원 충전의 결제 취소 지원은 충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내 미사용인 경우이며, 자세한 조건은 결제 및 환불 정책에 있습니다.`,
    ]),
    article(10, "adult", "미성년자 및 성인 콘텐츠", [
      "일부 캐릭터와 기능은 성인 콘텐츠로 표시됩니다. 성인 콘텐츠는 성인 이용자에게만 제공되는 기능이며, 외부 본인확인 연동 전까지 일반 회원에게는 제공하지 않습니다.",
      "외부 본인확인 제공업체는 현재 연결되어 있지 않습니다. 앱 안의 입력 화면, 모의 인증, 저장된 성인 표시만으로는 성인 콘텐츠 열람이 열리지 않습니다.",
      "기존 관리자 권한의 베타 테스트 접근만 성인 목록·상세·채팅을 볼 수 있으며, 그 접근은 성인 인증 기록으로 바뀌지 않습니다.",
    ]),
    article(11, "liability", "회사와 이용자의 책임", [
      "회사는 안정적인 서비스 제공을 위해 노력합니다. 다만 AI 응답, 이용자가 만든 콘텐츠, 외부 제공업체의 처리 결과는 사실이나 특정 목적을 보장하지 않습니다.",
      "회원은 자신의 계정 사용과 게시한 콘텐츠에 책임을 집니다.",
      "이 조항은 법령이 허용하지 않는 책임 제한을 주장하지 않습니다.",
    ]),
    article(12, "termination", "계약 해지와 회원 탈퇴", [
      "회원은 고객센터를 통해 이용계약 해지를 요청할 수 있습니다.",
      "계정 전체를 한 번에 삭제하는 기능은 현재 없습니다. 회사는 요청을 받은 뒤 처리 가능 범위와 일정을 안내합니다.",
      "회사는 이 약관을 중대하게 위반한 회원에 대해 이용을 제한하거나 이용계약을 해지할 수 있습니다.",
    ]),
    article(13, "business", "사업자 정보", [
      `${SERVICE_PUBLIC_NAME}는 서비스 브랜드명이고, 법적 상호는 ${BUSINESS_TRADE_NAME}입니다.`,
      ...BUSINESS_PUBLIC_LINES,
      "통신판매업 신고번호는 확인되지 않아 기재하지 않습니다.",
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
    ...SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS,
    "아직 구현되지 않은 절차나 확인되지 않은 법적 근거는 있는 것처럼 쓰지 않습니다.",
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
      "성인 콘텐츠 접근 제한, 문의·피드백 처리, 설정된 경우 웹 푸시 알림에 사용합니다.",
      "광고성 이메일·문자 발송 기능은 현재 없습니다.",
    ]),
    article(3, "items", "처리 항목", [
      "Google 로그인은 계정 인증, 이메일, 기본 프로필 권한을 요청합니다. 회사는 Google 계정 식별자, 이메일, 표시 이름을 읽습니다. 그 밖의 프로필 항목은 저장하지 않습니다.",
      "새 계정에는 이메일과 Google 계정 식별자를 저장합니다. 표시 이름이 있으면 그 이름을 닉네임으로 쓰고, 없으면 이메일 앞부분을 닉네임으로 씁니다.",
      "같은 Google 계정 식별자의 계정이 있으면 그 계정으로 로그인합니다. 식별자는 없고 이메일이 같은 계정이 있으면 그 계정에 Google 계정 식별자를 연결합니다. 이때 기존 이메일과 닉네임은 바꾸지 않습니다.",
      "이메일로 가입을 요청하면 이메일, 닉네임, 비밀번호 해시, 취향, 인증용 토큰 해시, 만료 시각, 발송 횟수, 최근 발송 시각을 가입 완료 전까지 보관합니다. 비밀번호 원문과 인증 링크 원문은 저장하지 않습니다.",
      "확인을 완료하면 이메일, 닉네임, 비밀번호 해시를 계정으로 저장합니다.",
      "로그인한 계정의 대화, 메시지, 페르소나, 캐릭터, 업로드 이미지, 대화에서 만든 기억과 요약을 저장합니다.",
      "앱 안의 성인 확인 화면은 이름·생년월일·통신사를 받을 수 있으나, 저장된 성인 표시와 모의 인증은 성인 콘텐츠 열람을 열지 않습니다. 생년월일과 통신사는 저장하지 않습니다.",
      "크리에이터 출금 신청 시 은행명, 계좌번호, 주민등록번호를 받습니다. 일반 회원 결제 기록에는 이용자, 상품, 결제 식별자, 금액, 상태가 저장됩니다. 심사 전용 테스트 결제는 포인트를 지급하지 않고 매출로 집계하지 않습니다.",
      "웹 푸시가 켜진 환경에서는 브라우저 알림 구독 정보와 키를 저장합니다.",
    ]),
    article(4, "collection", "수집 방법", [
      "회원이 가입, 로그인, 프로필 작성, 대화, 업로드, 결제, 출금, 피드백을 요청할 때 직접 입력하거나 선택한 정보를 받습니다.",
      "Google 로그인 과정에서 Google이 제공하는 계정 식별자, 이메일, 표시 이름을 받습니다.",
      "서비스 이용 과정에서 로그인 세션, 공지 읽음 상태, 브라우저 알림 구독 정보가 생성될 수 있습니다.",
    ]),
    article(5, "retention", "보유 및 이용 기간", [
      "정한 기간이 지나면 자동으로 지우는 보관 기간은 현재 없습니다.",
      `이메일 가입 대기는 인증 링크 유효기간 ${EMAIL_TOKEN_MINUTES}분이 지나면 사용할 수 없습니다. 만료된 대기 정보를 자동으로 지우는 별도 절차는 없습니다.`,
      `로그인 세션은 만든 시점부터 ${SESSION_DAYS}일이며, 이용할 때마다 연장되지 않습니다. 로그아웃하면 그 세션은 지워집니다.`,
      "이메일 인증 진행 중 쿠키는 남은 인증 시간만큼만 둡니다. Google 로그인 진행 중 쿠키는 최대 10분, 로그인하지 않은 방문자의 공지 읽음 쿠키는 최대 1년입니다.",
      "계정 데이터를 이용자가 한 번에 파기하는 기능이 없어, 보유 기간을 목적 달성 후로 단정하지 않습니다.",
    ]),
    article(6, "destruction", "파기", [
      "로그아웃은 현재 세션만 지웁니다.",
      "이용자는 자신의 대화방을 삭제할 수 있습니다. 그때 그 대화의 메시지와 연결된 기억 등이 함께 지워집니다. 자신이 만든 캐릭터와 페르소나 등 일부 콘텐츠도 삭제할 수 있습니다.",
      "계정 전체를 삭제하는 기능은 없습니다. 회원 탈퇴·계정 파기 절차는 이 방침에서 있는 것처럼 쓰지 않습니다.",
    ]),
    article(7, "processors", "외부 처리와 위탁", [
      "대화 응답을 만들 때 이용자 메시지, 캐릭터 설정, 페르소나, 대화에 연결된 기억과 요약이 선택한 모델에 따라 OpenRouter 또는 Cheaper Inference로 전송됩니다. 일부 Gemini 모델은 OpenRouter를 거쳐 Google AI Studio로만 전달됩니다.",
      "이미지 생성·편집을 요청하면 프롬프트와 참조 이미지가 OpenAI 이미지 처리로 전송됩니다.",
      "대화에서 추출한 기억 문장을 검색용으로 변환할 때 그 문장을 OpenRouter 임베딩 처리로 보냅니다. 이 요청에는 해당 문장의 보관과 데이터 수집을 거부하는 설정이 포함됩니다. 대화 응답 요청에는 같은 설정이 없습니다.",
      "이메일 가입 인증 메일은 Resend로 보냅니다. 수신 이메일, 제목, 본문이 전송됩니다. 발신 설정이 없으면 인증 메일을 보내지 않고 가입 요청을 거절합니다.",
      "피드백을 보내면 이용자 식별 정보, 닉네임, 피드백 내용이 Google Apps Script 주소로 전송됩니다.",
      "대화 글꼴 옵션을 쓰면 브라우저가 Google Fonts에 글꼴 정보를 요청합니다.",
      "웹 푸시가 켜진 환경에서는 브라우저 알림 구독 정보를 저장하고, 알림 제목·본문·이동 링크를 그 구독으로 보냅니다.",
      "일반 회원 충전이 진행되면 이용자, 상품, 결제 식별자, 금액, 상태가 PortOne과 서버 결제 기록에 남습니다.",
      "업로드 이미지는 서버 저장소에 둡니다. 별도의 클라우드 저장 설정이 있는 경우에는 Vercel Blob에 저장할 수 있습니다.",
      "별도의 제3자 분석 추적기는 사용하지 않습니다.",
    ]),
    article(8, "third-party", "제3자 제공", [
      "마케팅·광고를 위한 제3자 제공 기능은 현재 없습니다.",
      "위 외부 처리는 요청한 기능을 수행하기 위해 해당 제공업체로 전송하는 것이며, 별도의 판매·중개 제공 목록은 두지 않습니다.",
    ]),
    article(9, "cross-border", "국외 이전", [
      "아래는 실제 전송 경로와 해당 업체의 공식 자료에서 확인한 내용입니다. 확인되지 않은 국가, 보유 기간, 법적 근거는 채우지 않습니다.",
      "대화 응답을 요청하면 이용자 메시지, 캐릭터 설정, 페르소나, 대화에 연결된 기억과 요약이 OpenRouter, Inc. 또는 Keak AI, Inc.(Cheaper Inference)로 전송됩니다. OpenRouter의 공식 개인정보처리방침은 서버가 미국에 있거나 EEA·영국 밖 다른 나라로 이전될 수 있다고 적습니다. 공식 수탁 목록에는 Cloudflare, Google Cloud 등이 미국 또는 전 세계로 적혀 있습니다. 대화 응답 요청에는 보관·수집 거부 설정이 없어, 선택된 모델 제공업체의 보관·학습 정책이 추가로 적용될 수 있습니다. 모델 제공업체별 이전 국가와 보유 기간은 이 방침에서 확정하지 않습니다.",
      "Cheaper Inference의 공식 처리수탁 부속합의서는 수입자를 미국 델라웨어의 Keak AI, Inc.로 적고, 미국·캐나다·유럽 및 그 밖의 운영 국가에서 처리할 수 있다고 적습니다. 같은 문서는 프롬프트·응답 본문을 응용 데이터베이스에 저장하지 않고, 운영 로그는 보통 최대 12개월, 계정·청구 기록은 계약 기간에 더해 7년 둔다고 적습니다. 선택된 모델 제공업체로 내용이 전달되며, 그 업체의 이전 국가와 보유 기간은 이 방침에서 확정하지 않습니다.",
      "이미지 생성·편집을 요청하면 프롬프트와 참조 이미지가 OpenAI로 전송됩니다. OpenAI의 공식 API 자료는 해당 이미지 생성·편집 경로의 입력을 남용 모니터링을 위해 최대 30일 둔다고 적습니다. 기본 처리 국가는 이 방침에서 대한민국으로 단정하지 않으며, 별도 데이터 거주 설정이 켜져 있다는 확인도 없습니다.",
      "Google 로그인, 글꼴 요청, 피드백 전송, OpenRouter를 거친 일부 Gemini 전달은 Google이 운영하는 서비스로 나갑니다. Google이 어느 나라 서버에서 그 요청을 처리하는지는 이 방침에서 확정하지 않습니다.",
      "이메일 가입 인증 메일은 Resend로 보냅니다. Resend의 공식 GDPR 안내는 메시지 내용, 발송 기록, 계정 기록을 미국에 저장한다고 적습니다.",
      "일반 회원 충전이 진행되면 이용자, 상품, 결제 식별자, 금액, 상태가 코리아포트원과 서버 결제 기록에 남습니다. 포트원 도움말은 포트원을 결제 연동 수탁자로 안내합니다. 하브 결제 기록이 어느 나라 서버에 저장되는지는 이 방침에서 확정하지 않습니다.",
      "업로드 이미지는 기본적으로 서버 저장소에 둡니다. 별도의 클라우드 저장 설정이 있는 경우에는 Vercel Blob에 둘 수 있으나, 그 경우의 저장 국가는 이 방침에서 확정하지 않습니다.",
      "해당 기능을 요청하지 않으면 그 경로로 전송되지 않습니다. 이미 전송된 내용의 국외 이전을 나중에 철회하는 별도 절차는 현재 없습니다.",
      "개인정보 보호법 제28조의8 제2항이 정한 이전 항목, 이전 국가, 시기·방법, 이전받는 자, 이용 목적과 보유 기간, 거부 방법·절차·효과는 위와 같이 일부만 확인되었습니다. 이 조항만으로 그 고지가 완료되었다고 쓰지 않습니다.",
    ]),
    article(10, "rights", "이용자 권리와 행사 방법", [
      "이용자는 로그인 후 자신의 프로필, 대화, 캐릭터, 페르소나, 포인트 내역을 서비스 화면에서 볼 수 있습니다.",
      "이용자는 자신의 대화와 일부 콘텐츠를 삭제할 수 있습니다.",
      "계정 열람·정정·삭제를 한 번에 처리하는 창구와 회원 탈퇴 기능은 없습니다.",
      `그 밖의 요청은 ${CUSTOMER_SERVICE_LINE}로 받을 수 있으나, 계정 전체 삭제 절차는 아직 없습니다.`,
    ]),
    article(11, "cookies", "쿠키와 유사 기술", [
      "로그인을 유지하기 위해 브라우저에 로그인 세션 쿠키를 둡니다. 이 쿠키는 서버에서만 읽을 수 있도록 설정되며, 같은 사이트 이동에 사용되고, 최대 기간은 30일입니다. 운영 환경에서는 암호화된 연결에서만 전송됩니다.",
      `서버에 저장된 세션 만료도 만든 시점부터 ${SESSION_DAYS}일이며, 이용할 때마다 연장되지 않습니다. 로그아웃하면 그 세션과 쿠키를 삭제합니다.`,
      "이메일 인증 진행 중에는 남은 인증 시간만큼 인증 진행 쿠키를 둡니다. 확인이 끝나거나 실패하면 지웁니다.",
      "Google 로그인 진행 중에는 로그인 절차가 끝나는 동안만 필요한 진행 쿠키를 최대 10분 둡니다.",
      "로그인하지 않은 방문자의 공지 읽음 표시는 브라우저 쿠키에 최대 1년 저장합니다.",
      "브라우저 설정에서 쿠키를 차단할 수 있습니다. 다만 로그인 등 일부 기능이 동작하지 않을 수 있습니다.",
    ]),
    article(12, "security", "안전성 확보조치", [
      "비밀번호와 이메일 인증 토큰은 원문이 아닌 해시로 저장합니다.",
      "크리에이터 출금 시 주민등록번호는 암호화해 저장합니다.",
      "로그인 세션 쿠키와 이메일 인증 진행 쿠키는 서버에서만 읽을 수 있도록 두며, 운영 환경에서는 암호화된 연결에서만 전송됩니다.",
      "이 조치는 현재 적용 중인 보호를 적은 것이며, 법령상 안전조치 전부를 갖추었다고 단정하지 않습니다.",
    ]),
    article(13, "adult-verify", "성인 확인", [
      "외부 본인확인 제공업체는 현재 연결되어 있지 않습니다. 앱 안의 입력 화면, 모의 인증, 저장된 성인 표시만으로는 성인 콘텐츠 열람이 열리지 않습니다.",
      "기존 관리자 권한의 베타 테스트 접근만 성인 목록·상세·채팅을 볼 수 있으며, 그 접근은 성인 인증 기록으로 바뀌지 않습니다.",
    ]),
    article(14, "creator-withdraw", "크리에이터 출금과 주민등록번호", [
      "크리에이터가 출금을 신청하면 은행명, 계좌번호, 주민등록번호를 받습니다. 화면과 서버는 원천징수 신고 목적으로 이 정보를 받습니다.",
      "주민등록번호는 암호화해 저장합니다. 현재 예금주 확인은 외부 은행 조회가 아니라 서버 안의 형식 검사입니다.",
      "고유식별정보 수집의 법적 근거와 대체 수단 여부는 이 방침에서 확정하지 않습니다.",
    ]),
    article(15, "dpo", "개인정보 문의", [
      "별도로 지정·공개된 개인정보 보호책임자는 현재 없습니다.",
      `개인정보 관련 문의 창구는 대표자 ${BUSINESS_REPRESENTATIVE_NAME}, ${CUSTOMER_SERVICE_LINE}입니다.`,
      "개인정보 보호법 제31조 제1항 단서의 소상공인 예외에 해당하는지는 상시 근로자 수와 매출 기준을 이 문서에서 확인하지 못해 확정하지 않습니다. 따라서 같은 조 제2항에 따라 대표자가 보호책임자가 된다고 쓰지 않습니다.",
      "보호책임자 지정과 고지는 이 방침에서 충족했다고 쓰지 않습니다.",
    ]),
    article(16, "changes", "변경 고지", [
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
    "이 문서는 체크아웃 화면에 공개된 상품 정보와 같은 값을 사용합니다.",
    ...SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS,
  ],
  sections: [
    article(1, "scope", "적용 범위", [
      "이 정책은 일반 회원 포인트 충전, 충전 보너스, 출석 포인트, 가입 보너스, 포인트 선물, 회사가 제공하는 결제 취소 지원에 적용합니다.",
      "심사 전용 테스트 결제는 포인트를 지급하지 않고 매출로 집계하지 않으므로, 이 문서의 지급·취소 대상이 아닙니다.",
      "대화 신고 후 포인트 복구 등 다른 정산 경로는 이 문서의 결제 취소와 다릅니다.",
    ]),
    article(2, "current-status", "현재 제공 상태", [...SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS]),
    article(3, "products", "포인트 상품", POINT_CHARGE_PRODUCT_PARAGRAPHS),
    article(4, "grant-use", "지급 시점과 사용", [
      `이메일 가입 보너스 ${SIGNUP_BONUS_LINE}는 인증 확인이 완료된 뒤에 한 번만 지급됩니다. 인증 메일을 보낸 시점이나 링크를 열어 확인만 한 시점에는 지급되지 않습니다.`,
      "일반 회원 충전이 완료되면 유료 포인트와 충전 보너스 무료 포인트가 해당 계정에 즉시 적립됩니다.",
      "심사 전용 테스트 결제는 포인트를 지급하지 않습니다.",
      "대화 등 서비스 이용 시 포인트가 차감됩니다. 사용 시 만료가 가까운 포인트부터, 같은 만료라면 무료 포인트부터 차감됩니다.",
      "출석 포인트는 선물할 수 없습니다.",
    ]),
    article(5, "expiry", "유효기간", [
      `유료 포인트와 충전 보너스 무료 포인트의 유효기간은 지급일로부터 ${PAID_POINTS_VALID_YEARS}년입니다. 일반 무료 포인트의 유효기간도 ${FREE_POINTS_VALID_YEARS}년입니다.`,
      `출석 포인트의 유효기간은 지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일입니다. 주간 출석 보상은 ${ATTENDANCE_REWARD_LINE}입니다.`,
      `포인트 사용기간(${PAID_POINTS_VALID_YEARS}년)과 아래 결제 취소 지원기간(${POINT_CHARGE_CANCEL_DAYS}일)은 다릅니다.`,
    ]),
    article(6, "gifts", "선물과 수수료", [
      `포인트를 다른 이용자에게 선물할 수 있습니다. 최소 금액은 ${MIN_POINT_GIFT_AMOUNT.toLocaleString("ko-KR")}P입니다.`,
      `수수료는 유료 ${GIFT_FEE_PAID_PERCENT}%, 무료 ${GIFT_FEE_FREE_PERCENT}%이며, 받는 사람은 수수료를 제외한 금액을 받습니다.`,
      "출석 포인트는 선물할 수 없습니다.",
    ]),
    article(7, "cancel-support", "하브가 제공하는 결제 취소 지원", [
      `회사는 일반 회원 충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내이고, 해당 충전으로 지급된 유료 포인트와 충전 보너스 무료 포인트를 사용하지 않은 경우 PortOne을 통해 결제를 취소하는 지원 경로를 제공합니다.`,
      "이미 취소된 결제, 유료 또는 보너스 포인트를 일부라도 사용한 충전, 결제 정보가 연결되지 않은 충전은 이 자동 취소 지원 대상이 아닙니다.",
      `충전 후 ${POINT_CHARGE_CANCEL_DAYS}일이 지난 결제, 출석 포인트, 가입 보너스, 선물로 받은 포인트, 심사 전용 테스트 결제도 이 경로의 대상이 아닙니다.`,
      "취소를 요청하면 해당 충전의 포인트 사용이 보류되고, 결제 취소가 확인된 뒤에 취소가 확정됩니다.",
    ]),
    article(8, "cooling-off", "법정 청약철회와의 관계", [
      `위 ${POINT_CHARGE_CANCEL_DAYS}일 미사용 결제 취소는 하브가 제공하는 지원 경로이며, 전자상거래법상 청약철회·계약해제와 같은 권리가 아닙니다.`,
      "디지털콘텐츠에 대한 법정 청약철회 제한을 적용하려면 관련 고지, 동의, 시험 사용 등 요건을 갖춰야 합니다. 현재 결제 화면에는 그 제한을 적용하기 위한 고지·동의·시험 사용이 없어, 이 문서는 법정 권리가 제한된다고 쓰지 않습니다.",
    ]),
    article(9, "refund-method", "환급 방법과 처리", [
      "자동 취소 지원 조건에 맞는 요청은 원래 결제에 사용한 수단으로 PortOne 취소가 진행됩니다.",
      "처리 완료 시점은 결제 수단과 카드사·결제대행사 처리에 따릅니다.",
      `조건에 맞지 않거나 자동 경로로 처리할 수 없는 경우 ${CUSTOMER_SERVICE_LINE}로 문의해 주세요.`,
    ]),
    article(10, "errors", "오류·중복 결제", [
      "진행 중인 결제 요청이 있으면 같은 계정에서 추가 결제 요청이 받아들여지지 않을 수 있습니다.",
      "오류 표시, 중복 결제, 금액 오기가 확인되면 회사는 해당 결제를 취소하거나 정정할 수 있습니다. 이미 결제된 금액은 확인 후 원래 결제 수단으로 돌려드립니다.",
      `자동 취소 지원 조건 밖인 경우에는 ${CUSTOMER_SERVICE_LINE}로 접수해 주세요.`,
    ]),
    article(11, "inquiry", "문의", [
      `결제·취소 문의는 ${CUSTOMER_SERVICE_LINE}로 받습니다.`,
      `이 정책의 시행일은 ${LEGAL_DOCUMENT_AS_OF}입니다.`,
    ]),
  ],
} as const satisfies LegalPage;
