import { ATTENDANCE_POINTS_VALID_DAYS } from "@/lib/attendanceConstants";
import {
  BUSINESS_OPERATING_STATUS,
  BUSINESS_PUBLIC_LINES,
  BUSINESS_TRADE_NAME,
  SERVICE_PUBLIC_NAME,
} from "@/lib/businessIdentity";
import {
  formatPointChargePackagePublicLine,
  FREE_POINTS_VALID_YEARS,
  PAID_POINTS_VALID_YEARS,
  POINT_CHARGE_CANCEL_DAYS,
  POINT_CHARGE_PACKAGES,
} from "@/lib/plans";
import { SITE_DESCRIPTION, SITE_DISPLAY_NAME } from "@/lib/siteBrand";

/** Single public set of legal links. Footer is the only renderer. */
export const PUBLIC_LEGAL_LINKS = [
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/terms", label: "이용약관" },
] as const;

export const LEGAL_DOCUMENT_AS_OF = "2026-10-02";

const POINT_CHARGE_PRODUCT_PARAGRAPHS = [
  "포인트 상품은 아래 5종입니다. 결제 기능이 꺼져 있어도 상품 정보는 공개합니다.",
  ...POINT_CHARGE_PACKAGES.map(formatPointChargePackagePublicLine),
  "서비스 제공 방식: 결제가 완료되면 해당 계정에 유료 포인트와 충전 보너스 무료 포인트를 즉시 적립하고, 대화 등 서비스 이용 시 포인트를 차감합니다.",
  `유료 포인트와 충전 보너스 무료 포인트의 유효기간은 지급일로부터 ${PAID_POINTS_VALID_YEARS}년입니다. 일반 무료 포인트의 유효기간도 ${FREE_POINTS_VALID_YEARS}년입니다.`,
  `출석 포인트의 유효기간은 지급일로부터 ${ATTENDANCE_POINTS_VALID_DAYS}일입니다. 그 밖의 출석 보상 금액은 현재 정책을 유지합니다.`,
] as const;

export type LegalSection = {
  heading: string;
  paragraphs: readonly string[];
};

export const PRIVACY_PAGE = {
  title: "개인정보처리방침",
  intro: [
    `${SITE_DISPLAY_NAME}는 ${SITE_DESCRIPTION}입니다.`,
    `이 방침은 ${LEGAL_DOCUMENT_AS_OF} 기준 서비스 코드가 처리하는 내용만 설명합니다.`,
  ],
  sections: [
    {
      heading: "Google 로그인",
      paragraphs: [
        "Google 로그인은 openid, email, profile 권한을 요청합니다.",
        "Google 사용자 정보에서 계정 식별자(sub), 이메일, 표시 이름(name)을 읽습니다. 그 밖의 프로필 항목은 저장하지 않습니다.",
        "새 계정에는 이메일과 Google 계정 식별자를 저장합니다. 표시 이름이 있으면 그 이름을 닉네임으로 쓰고, 없으면 이메일 앞부분을 닉네임으로 씁니다.",
        "같은 Google 계정 식별자의 계정이 있으면 그 계정으로 로그인합니다. 식별자는 없고 이메일이 같은 계정이 있으면 그 계정에 Google 계정 식별자를 연결합니다. 이때 기존 이메일과 닉네임은 바꾸지 않습니다.",
        "이 정보의 목적은 로그인, 계정 만들기, 기존 계정 연결입니다.",
      ],
    },
    {
      heading: "이메일 계정",
      paragraphs: [
        "이메일로 가입하면 이메일, 닉네임, 비밀번호를 받습니다. 비밀번호는 원문이 아니라 해시만 저장합니다.",
      ],
    },
    {
      heading: "세션과 쿠키",
      paragraphs: [
        "로그인하면 임의의 세션 토큰을 만들어 서버에 저장하고, 브라우저에는 session 쿠키로 둡니다.",
        "session 쿠키는 HttpOnly, SameSite=Lax, 경로 /, 최대 30일입니다. 운영 환경에서는 Secure입니다. 서버의 만료 시각도 세션을 만든 시점부터 30일이며, 요청마다 연장하지 않습니다.",
        "로그아웃하면 그 세션 토큰을 지우고 session 쿠키를 삭제합니다.",
        "Google 로그인 진행 중에는 oauth_state, oauth_return_to, oauth_redirect_after 쿠키를 최대 10분 둡니다. 이 쿠키는 HttpOnly, SameSite=Lax, 경로 / 입니다.",
        "로그인하지 않은 방문자의 공지 읽음 표시는 notice_read_id, notice_read_ids 쿠키에 최대 1년 저장합니다.",
      ],
    },
    {
      heading: "이용자가 만드는 데이터",
      paragraphs: [
        "로그인한 계정의 대화, 메시지, 페르소나, 캐릭터, 업로드 이미지, 대화에서 만든 기억과 요약을 저장합니다.",
        "업로드 이미지는 서버 저장소에 둡니다. 블롭 저장 토큰이 설정된 경우에는 Vercel Blob에 저장할 수 있습니다.",
      ],
    },
    {
      heading: "외부 처리",
      paragraphs: [
        "대화 응답을 만들 때 이용자 메시지, 캐릭터 설정, 페르소나, 대화에 연결된 기억과 요약이 선택한 모델에 따라 OpenRouter 또는 Cheaper Inference로 전송됩니다. 일부 Gemini 모델은 OpenRouter를 거쳐 Google AI Studio로만 전달됩니다.",
        "이미지 생성·편집을 요청하면 프롬프트와 참조 이미지가 OpenAI 이미지 API로 전송됩니다.",
        "대화에서 추출한 기억 문장을 검색용 임베딩으로 만들 때 그 문장을 OpenRouter 임베딩 API로 보냅니다. 이 요청에는 해당 문장의 보관과 데이터 수집을 거부하는 설정이 포함됩니다. 대화 응답 요청에는 같은 설정이 없습니다.",
        "피드백을 보내면 이용자 아이디, 닉네임, 피드백 내용이 Google Apps Script 주소로 전송됩니다.",
        "대화 글꼴 옵션을 쓰면 브라우저가 Google Fonts에 스타일시트를 요청합니다.",
        "웹 푸시는 서버에 VAPID 설정이 있을 때만 동작합니다. 그때 브라우저 구독 주소와 키를 저장하고, 알림 제목·본문·이동 링크를 그 구독 주소로 보냅니다.",
        "포인트 충전은 PORTONE_CHARGE_ENABLED가 0이 아니고 PortOne 상점, 채널, 서버 검증 값이 있을 때 PortOne으로 진행합니다. 그 값이 0이면 충전 요청은 거절됩니다. 결제 기록에는 이용자, 상품, 결제 식별자, 금액, 상태가 저장됩니다.",
        "서비스 코드에는 별도의 제3자 분석 추적기를 두지 않습니다.",
      ],
    },
    {
      heading: "성인 확인",
      paragraphs: [
        "외부 본인확인 제공업체가 연동되기 전까지 모의 인증과 저장된 성인 표시는 성인 콘텐츠 열람을 열지 않습니다. 기존 관리자 권한의 베타 테스트 접근만 성인 목록·상세·채팅을 볼 수 있으며, 그 접근은 성인 인증 기록으로 승격되지 않습니다.",
        "SKIP_ADULT_VERIFICATION이나 결제 비활성 설정은 진단 플래그로 남을 수 있지만 일반 회원의 성인 접근을 부여하지 않습니다.",
      ],
    },
    {
      heading: "크리에이터 출금",
      paragraphs: [
        "크리에이터가 출금을 신청하면 은행명, 계좌번호, 주민등록번호를 받습니다. 주민등록번호는 암호화해 저장합니다.",
        "현재 예금주 확인은 외부 은행 조회가 아니라 서버 안의 형식 검사입니다.",
      ],
    },
    {
      heading: "삭제",
      paragraphs: [
        "로그아웃은 현재 세션만 지웁니다.",
        "이용자는 자신의 대화방을 삭제할 수 있습니다. 그때 그 대화의 메시지와 연결된 기억 등이 함께 지워집니다. 자신이 만든 캐릭터 등 일부 콘텐츠도 삭제할 수 있습니다.",
        "계정 전체를 삭제하는 기능은 없습니다. 정한 기간이 지나면 자동으로 지우는 보관 기간도 없습니다.",
      ],
    },
  ] satisfies readonly LegalSection[],
} as const;

export const TERMS_PAGE = {
  title: "이용약관",
  intro: [
    `${SITE_DISPLAY_NAME}는 ${SITE_DESCRIPTION}입니다. 현재 개발·시험 단계의 서비스입니다.`,
    `이 약관은 ${LEGAL_DOCUMENT_AS_OF} 기준 구현에 맞춘 짧은 이용 조건입니다.`,
  ],
  sections: [
    {
      heading: "계정과 대화",
      paragraphs: [
        "Google 또는 이메일로 계정을 만들 수 있습니다. 대화 응답은 로그인한 계정에서 제공됩니다.",
      ],
    },
    {
      heading: "이용",
      paragraphs: [
        "이용자는 입력한 내용과 직접 만든 캐릭터·페르소나에 주의해야 합니다. AI가 만든 답변은 사실이나 조언을 보장하지 않습니다.",
        "서비스 내용과 제공 여부는 개발·시험 과정에서 바뀔 수 있고, 일시적으로 끊길 수 있습니다.",
      ],
    },
    {
      heading: "사업자 정보",
      paragraphs: [
        `${SERVICE_PUBLIC_NAME}는 서비스 브랜드명이고, 법적 상호는 ${BUSINESS_TRADE_NAME}입니다.`,
        ...BUSINESS_PUBLIC_LINES,
      ],
    },
    {
      heading: "포인트 상품",
      paragraphs: POINT_CHARGE_PRODUCT_PARAGRAPHS,
    },
    {
      heading: "포인트와 성인 콘텐츠",
      paragraphs: [
        `포인트 충전은 서버의 결제 설정이 켜져 있고 PortOne 설정이 있을 때만 진행됩니다. 설정이 꺼져 있으면 충전 요청은 거절됩니다. 상품 공개와 실제 결제 활성화는 별개입니다. 현재 사업자 상태가 ${BUSINESS_OPERATING_STATUS}이므로 결제를 활성화하지 않습니다.`,
        "외부 본인확인 제공업체가 연동되기 전까지 앱 안의 입력 화면과 저장된 성인 표시는 성인 콘텐츠 열람을 열지 않습니다. 결제 비활성이나 SKIP_ADULT_VERIFICATION은 이 확인을 생략하지 않습니다.",
      ],
    },
    {
      heading: "결제 취소",
      paragraphs: [
        `결제 취소는 충전 후 ${POINT_CHARGE_CANCEL_DAYS}일 이내이고, 해당 충전으로 지급된 유료 포인트와 충전 보너스 무료 포인트를 사용하지 않은 경우에만 PortOne 결제 취소로 처리합니다.`,
        `포인트 사용기간(${PAID_POINTS_VALID_YEARS}년)과 결제 취소 지원기간(${POINT_CHARGE_CANCEL_DAYS}일)은 다릅니다.`,
      ],
    },
    {
      heading: "데이터",
      paragraphs: [
        "개인정보 처리 내용은 개인정보처리방침에 따릅니다.",
        "계정 전체를 삭제하는 기능과, 정한 기간 뒤 자동으로 지우는 보관 기간은 현재 없습니다. 이용자는 자신의 대화와 캐릭터 등 일부 콘텐츠를 삭제할 수 있습니다.",
      ],
    },
  ] satisfies readonly LegalSection[],
} as const;
