import { SITE_DESCRIPTION, SITE_DISPLAY_NAME } from "@/lib/siteBrand";

/** Single public set of legal links. Footer is the only renderer. */
export const PUBLIC_LEGAL_LINKS = [
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/terms", label: "이용약관" },
] as const;

export const LEGAL_DOCUMENT_AS_OF = "2026-09-29";

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
        "성인 확인을 생략하는 설정이 없으면, 이름·생년월일 8자리·통신사를 입력하는 화면을 사용합니다. 만 19세 미만은 거절합니다. 통과하면 성인 표시를 하고 이름을 저장합니다. 통신사는 저장하지 않습니다.",
        "이 화면은 외부 본인확인 기관과 연결되어 있지 않습니다. SKIP_ADULT_VERIFICATION이 켜져 있거나 결제 관련 설정이 꺼진 것으로 처리되면 성인 확인을 생략합니다.",
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
      heading: "포인트와 성인 콘텐츠",
      paragraphs: [
        "포인트 충전은 서버의 결제 설정이 켜져 있고 PortOne 설정이 있을 때만 진행됩니다. 설정이 꺼져 있으면 충전 요청은 거절됩니다.",
        "성인 확인이 필요한 환경에서는 앱 안의 입력 화면으로 나이를 확인합니다. 설정에 따라 이 확인은 생략될 수 있습니다.",
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
