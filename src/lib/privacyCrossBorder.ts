/**
 * Canonical PIPA Art. 28-8 disclosure owner.
 * Privacy copy must read these rows. Unconfirmed fields stay unconfirmed.
 * Do not invent country, retention, legal basis, or contacts.
 */

export type CrossBorderFieldStatus = "confirmed" | "unconfirmed";

export type CrossBorderField = {
  status: CrossBorderFieldStatus;
  publicValue: string;
  source: string | null;
};

export type CrossBorderTransferRow = {
  id: "openrouter" | "cheaper-inference" | "openai" | "google" | "resend" | "portone" | "vercel-blob";
  recipient: CrossBorderField;
  recipientContact: CrossBorderField;
  items: CrossBorderField;
  countries: CrossBorderField;
  timingMethod: CrossBorderField;
  purpose: CrossBorderField;
  retention: CrossBorderField;
  legalBasis: CrossBorderField;
  refusalMethod: CrossBorderField;
  refusalEffect: CrossBorderField;
};

const UNCONFIRMED_LEGAL_BASIS: CrossBorderField = {
  status: "unconfirmed",
  publicValue:
    "미확정. 제28조의8 제2항 고지 항목이 모두 확인되지 않아, 계약 이행을 위한 처리위탁·보관 경로가 충족되었다고 쓰지 않습니다.",
  source: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334957",
};

const REQUEST_TIME_NETWORK: CrossBorderField = {
  status: "confirmed",
  publicValue: "해당 기능을 요청한 시점에 네트워크로 전송합니다.",
  source: null,
};

const REFUSAL_METHOD: CrossBorderField = {
  status: "confirmed",
  publicValue:
    "해당 기능을 요청하지 않으면 그 경로로 전송되지 않습니다. 이미 전송된 내용의 국외 이전을 나중에 철회하는 별도 절차는 현재 없습니다.",
  source: null,
};

function refusalEffect(feature: string): CrossBorderField {
  return {
    status: "confirmed",
    publicValue: `${feature}를 이용할 수 없습니다.`,
    source: null,
  };
}

export const CROSS_BORDER_TRANSFERS = [
  {
    id: "openrouter",
    recipient: {
      status: "confirmed",
      publicValue: "OpenRouter, Inc.",
      source: "https://openrouter.ai/privacy",
    },
    recipientContact: {
      status: "confirmed",
      publicValue: "privacy@openrouter.ai",
      source: "https://openrouter.ai/privacy",
    },
    items: {
      status: "confirmed",
      publicValue:
        "대화 응답: 이용자 메시지, 캐릭터 설정, 페르소나, 대화에 연결된 기억과 요약. 기억 검색용 임베딩: 추출한 기억 문장.",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue:
        "공식 방침은 미국 서버 또는 EEA·영국 밖 다른 나라로 이전될 수 있다고 적습니다. 공식 수탁 목록에는 Cloudflare, Google Cloud가 미국 또는 전 세계로 적혀 있습니다. 선택된 모델 제공업체의 이전 국가는 미확정입니다.",
      source: "https://openrouter.ai/privacy",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "대화 응답 생성, 기억 문장 검색용 변환",
      source: null,
    },
    retention: {
      status: "unconfirmed",
      publicValue:
        "공식 방침은 합리적으로 필요한 기간 동안 둔다고 적습니다. 고정 보유기간과 모델 제공업체 보유기간은 미확정입니다. 대화 응답 요청에는 보관·수집 거부 설정이 없고, 임베딩 요청에만 있습니다.",
      source: "https://openrouter.ai/privacy",
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("대화 응답과 기억 검색"),
  },
  {
    id: "cheaper-inference",
    recipient: {
      status: "confirmed",
      publicValue: "Keak AI, Inc.(Cheaper Inference), 미국 델라웨어",
      source: "https://cheaperinference.com/legal/dpa",
    },
    recipientContact: {
      status: "confirmed",
      publicValue: "공식 처리수탁 부속합의서의 개인정보 문의 양식",
      source: "https://cheaperinference.com/legal/dpa",
    },
    items: {
      status: "confirmed",
      publicValue: "선택한 모델로 대화 응답을 만들 때 보내는 이용자 메시지, 캐릭터 설정, 페르소나, 기억과 요약",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue:
        "공식 자료는 미국·캐나다·유럽 및 그 밖의 운영 국가에서 처리할 수 있다고 적습니다. 선택된 모델 제공업체의 이전 국가는 미확정입니다.",
      source: "https://cheaperinference.com/privacy",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "선택한 모델로 대화 응답을 생성",
      source: null,
    },
    retention: {
      status: "unconfirmed",
      publicValue:
        "공식 처리수탁 부속합의서는 프롬프트·응답 본문을 응용 데이터베이스에 저장하지 않고, 운영 로그는 보통 최대 12개월, 계정·청구 기록은 계약 기간에 더해 7년 둔다고 적습니다. 선택된 모델 제공업체의 보유기간은 미확정입니다.",
      source: "https://cheaperinference.com/legal/dpa",
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("해당 모델의 대화 응답"),
  },
  {
    id: "openai",
    recipient: {
      status: "confirmed",
      publicValue: "OpenAI",
      source: "https://developers.openai.com/api/docs/guides/your-data",
    },
    recipientContact: {
      status: "confirmed",
      publicValue: "dsar@openai.com",
      source: "https://openai.com/policies/privacy-policy/",
    },
    items: {
      status: "confirmed",
      publicValue: "이미지 생성·편집 요청 시의 프롬프트와 참조 이미지",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue:
        "기본 처리 국가는 대한민국으로 단정하지 않습니다. 별도 데이터 거주 설정이 켜져 있다는 확인도 없습니다.",
      source: "https://developers.openai.com/api/docs/guides/your-data",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "이미지 생성·편집",
      source: null,
    },
    retention: {
      status: "confirmed",
      publicValue:
        "공식 API 자료는 이미지 생성·편집 경로의 입력을 남용 모니터링을 위해 최대 30일 둔다고 적습니다.",
      source: "https://developers.openai.com/api/docs/guides/your-data",
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("이미지 생성·편집"),
  },
  {
    id: "google",
    recipient: {
      status: "confirmed",
      publicValue: "Google",
      source: "https://policies.google.com/privacy",
    },
    recipientContact: {
      status: "unconfirmed",
      publicValue: "이 방침에서 확정한 전용 연락처는 없습니다.",
      source: "https://policies.google.com/privacy",
    },
    items: {
      status: "confirmed",
      publicValue:
        "Google 로그인: 계정 식별자, 이메일, 표시 이름. 글꼴 옵션: 브라우저의 글꼴 요청. 피드백: 이용자 식별 정보, 닉네임, 내용. 일부 Gemini: OpenRouter를 거쳐 Google AI Studio로 전달되는 대화 내용.",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue: "Google이 어느 나라 서버에서 그 요청을 처리하는지는 이 방침에서 확정하지 않습니다.",
      source: "https://policies.google.com/privacy",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "로그인, 글꼴 표시, 피드백 전달, 일부 대화 응답",
      source: null,
    },
    retention: {
      status: "unconfirmed",
      publicValue: "보유·이용 기간은 이 방침에서 확정하지 않습니다.",
      source: null,
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("Google 로그인, 해당 글꼴, 피드백, 해당 Gemini 응답"),
  },
  {
    id: "resend",
    recipient: {
      status: "confirmed",
      publicValue: "Plus Five Five, Inc.(Resend)",
      source: "https://resend.com/legal/privacy-policy",
    },
    recipientContact: {
      status: "confirmed",
      publicValue: "support@resend.com",
      source: "https://resend.com/legal/privacy-policy",
    },
    items: {
      status: "confirmed",
      publicValue: "이메일 가입 인증 메일의 수신 이메일, 제목, 본문",
      source: null,
    },
    countries: {
      status: "confirmed",
      publicValue: "미국. 공식 GDPR 안내는 메시지 내용, 발송 기록, 계정 기록을 미국에 저장한다고 적습니다.",
      source: "https://resend.com/security/gdpr",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "가입 인증 메일 발송",
      source: null,
    },
    retention: {
      status: "unconfirmed",
      publicValue:
        "공식 방침은 목적 달성과 법적 의무에 필요한 기간 동안 둔다고 적습니다. 고정 보유기간은 미확정입니다.",
      source: "https://resend.com/legal/privacy-policy",
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("이메일 가입"),
  },
  {
    id: "portone",
    recipient: {
      status: "confirmed",
      publicValue: "코리아포트원",
      source: "https://help.portone.io/content/portone-security",
    },
    recipientContact: {
      status: "unconfirmed",
      publicValue: "이 방침에서 확정한 전용 연락처는 없습니다.",
      source: "https://privacy.portone.io/",
    },
    items: {
      status: "confirmed",
      publicValue: "일반 회원 충전 시의 이용자, 상품, 결제 식별자, 금액, 상태",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue:
        "포트원 도움말은 포트원을 결제 연동 수탁자로 안내합니다. 하브 결제 기록이 어느 나라 서버에 저장되는지는 이 방침에서 확정하지 않습니다.",
      source: "https://help.portone.io/content/portone-security",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "결제 연동",
      source: null,
    },
    retention: {
      status: "unconfirmed",
      publicValue: "보유·이용 기간은 이 방침에서 확정하지 않습니다.",
      source: null,
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("일반 회원 포인트 충전"),
  },
  {
    id: "vercel-blob",
    recipient: {
      status: "confirmed",
      publicValue: "Vercel Inc.(설정된 경우 Vercel Blob)",
      source: "https://vercel.com/legal/dpa",
    },
    recipientContact: {
      status: "unconfirmed",
      publicValue: "이 방침에서 확정한 전용 연락처는 없습니다.",
      source: "https://vercel.com/legal/privacy-notice",
    },
    items: {
      status: "confirmed",
      publicValue: "별도의 클라우드 저장 설정이 있는 경우에 한한 업로드 이미지",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue:
        "공식 처리수탁 부속합의서는 주된 처리 시설이 미국이라고 적습니다. 이 서비스가 쓰는 저장 지역은 확인하지 못해 저장 국가를 확정하지 않습니다.",
      source: "https://vercel.com/legal/dpa",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "업로드 이미지 저장",
      source: null,
    },
    retention: {
      status: "unconfirmed",
      publicValue: "보유·이용 기간은 이 방침에서 확정하지 않습니다.",
      source: null,
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("해당 클라우드 저장이 켜진 업로드"),
  },
] as const satisfies readonly CrossBorderTransferRow[];

const DISCLOSURE_FIELDS = [
  "recipient",
  "recipientContact",
  "items",
  "countries",
  "timingMethod",
  "purpose",
  "retention",
  "legalBasis",
  "refusalMethod",
  "refusalEffect",
] as const;

export const CROSS_BORDER_ARTICLE_28_8_DISCLOSURE_COMPLETE = CROSS_BORDER_TRANSFERS.every((row) =>
  DISCLOSURE_FIELDS.every((fieldName) => row[fieldName].status === "confirmed"),
);

export function formatCrossBorderPrivacyParagraphs(): string[] {
  const rows = CROSS_BORDER_TRANSFERS.map((row) =>
    [
      `이전받는 자: ${row.recipient.publicValue}.`,
      `연락처: ${row.recipientContact.publicValue}.`,
      `이전 항목: ${row.items.publicValue}.`,
      `이전 국가: ${row.countries.publicValue}.`,
      `시기 및 방법: ${row.timingMethod.publicValue}`,
      `이용 목적: ${row.purpose.publicValue}.`,
      `보유·이용 기간: ${row.retention.publicValue}`,
      `법적 근거: ${row.legalBasis.publicValue}`,
      `거부 방법: ${row.refusalMethod.publicValue}`,
      `거부 효과: ${row.refusalEffect.publicValue}`,
    ].join(" "),
  );
  return [
    "아래는 실제 전송 경로와 해당 업체의 공식 자료에서 확인한 내용입니다. 확인되지 않은 항목은 채우지 않습니다.",
    ...rows,
    "개인정보 보호법 제28조의8 제2항이 정한 이전 항목, 이전 국가, 시기·방법, 이전받는 자, 이용 목적과 보유 기간, 거부 방법·절차·효과는 위와 같이 일부만 확인되었습니다. 이 조항만으로 그 고지가 완료되었다고 쓰지 않습니다.",
  ];
}
