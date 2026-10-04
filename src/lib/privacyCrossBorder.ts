/**
 * Canonical PIPA Art. 28-8 disclosure owner.
 *
 * Inventory is the current production personal-data transfer path only.
 * Public privacy copy may publish a row only when every Art. 28-8(2) field is
 * confirmed from official Privacy/DPA/subprocessor/region documents or the live
 * request path. Unused or unproven processors are not kept in this table.
 */

export type CrossBorderFieldStatus = "confirmed" | "unconfirmed";

export type CrossBorderField = {
  status: CrossBorderFieldStatus;
  publicValue: string;
  source: string | null;
};

export type ProductionCrossBorderProviderId =
  | "openrouter"
  | "cheaper-inference"
  | "openai"
  | "google"
  | "resend";

export type CrossBorderTransferRow = {
  id: ProductionCrossBorderProviderId;
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

export const DISCLOSURE_FIELDS = [
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

export function isCrossBorderRowComplete(row: CrossBorderTransferRow): boolean {
  return DISCLOSURE_FIELDS.every((fieldName) => row[fieldName].status === "confirmed");
}

/**
 * Processors reviewed and excluded from this 국외이전 table.
 * They are not unused-code leftovers kept as empty rows.
 *
 * - portone: 코리아포트원 결제 수탁. 일반 회원 충전은 꺼져 있고, 심사 계정
 *   테스트만 있다. 공식 자료로 국외 이전 국가를 확정하지 못해 국내 위탁으로만
 *   제7조에 적는다.
 * - vercel-blob: 새 캐릭터 매체는 로컬 저장이다. BLOB_READ_WRITE_TOKEN이 있을
 *   때만 일부 업로드가 Vercel Blob로 갈 수 있으나, 현재 production 사용이
 *   확인되지 않아 표에 두지 않는다.
 */
export const EXCLUDED_FROM_CROSS_BORDER_TABLE = ["portone", "vercel-blob"] as const;

const UNCONFIRMED_LEGAL_BASIS: CrossBorderField = {
  status: "unconfirmed",
  publicValue:
    "제28조의8 제2항 고지 항목이 모두 확인되지 않아, 계약 이행을 위한 처리위탁·보관 경로가 충족되었다고 쓰지 않습니다.",
  source: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334957",
};

const REQUEST_TIME_NETWORK: CrossBorderField = {
  status: "confirmed",
  publicValue: "해당 기능 요청 시 네트워크로 전송",
  source: null,
};

const REFUSAL_METHOD: CrossBorderField = {
  status: "confirmed",
  publicValue: "해당 기능을 이용하지 않으면 전송되지 않습니다. 이미 전송된 내용의 철회 절차는 없습니다.",
  source: null,
};

function refusalEffect(feature: string): CrossBorderField {
  return {
    status: "confirmed",
    publicValue: `${feature} 이용할 수 없습니다.`,
    source: null,
  };
}

/**
 * Live production personal-data paths that leave the service.
 *
 * OpenRouter Main-RP Gemini is pinned to google-ai-studio with
 * allow_fallbacks:false, but official OpenRouter/Google documents do not name
 * one processing country for that hop. Cheaper Inference has no region pin and
 * itself routes to model providers. Completing those rows would need a
 * provider+region pin or a replacement contract. That is an architecture
 * change, not a copy edit.
 */
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
      publicValue: "대화 메시지, 캐릭터·페르소나, 기억·요약, 기억 검색 문장",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue:
        "공식 방침은 미국 서버 또는 EEA·영국 밖 다른 나라로 이전될 수 있다고 적습니다. Main-RP Gemini는 google-ai-studio로만 보내지만, Google 처리 국가는 공식 자료로 한 나라로 특정되지 않습니다.",
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
        "공식 방침은 합리적으로 필요한 기간 동안 둔다고 적습니다. 대화 응답 요청에는 보관·수집 거부 설정이 없고, 임베딩 요청에만 있습니다.",
      source: "https://openrouter.ai/privacy",
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("대화 응답과 기억 검색을"),
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
      publicValue: "cheaperinference.com 개인정보 문의",
      source: "https://cheaperinference.com/legal/dpa",
    },
    items: {
      status: "confirmed",
      publicValue: "대화 메시지, 캐릭터·페르소나, 기억·요약",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue:
        "공식 자료는 미국·캐나다·유럽 및 그 밖의 운영 국가에서 처리할 수 있다고 적습니다. 요청에 국가·지역 고정이 없고, 모델 제공업체 처리 국가도 특정하지 않습니다.",
      source: "https://cheaperinference.com/privacy",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "대화 응답 생성",
      source: null,
    },
    retention: {
      status: "unconfirmed",
      publicValue:
        "공식 처리수탁 부속합의서는 프롬프트·응답 본문을 응용 데이터베이스에 저장하지 않고, 운영 로그는 보통 최대 12개월, 계정·청구 기록은 계약 기간에 더해 7년 둔다고 적습니다. 모델 제공업체 보유기간은 공식 자료로 확정하지 않습니다.",
      source: "https://cheaperinference.com/legal/dpa",
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("해당 모델의 대화 응답을"),
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
      publicValue: "이미지 생성·편집 프롬프트와 참조 이미지",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue:
        "공식 API 자료는 기본 처리 국가를 대한민국으로 단정하지 않습니다. 이 서비스에 별도 데이터 거주 설정이 켜져 있다는 확인도 없습니다.",
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
      publicValue: "최대 30일",
      source: "https://developers.openai.com/api/docs/guides/your-data",
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("이미지 생성·편집을"),
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
      publicValue: "Google 로그인 계정 식별자·이메일·표시 이름, 글꼴 요청, 피드백 내용",
      source: null,
    },
    countries: {
      status: "unconfirmed",
      publicValue: "Google이 어느 나라 서버에서 그 요청을 처리하는지는 공식 자료로 한 나라로 확정하지 않습니다.",
      source: "https://policies.google.com/privacy",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "로그인, 글꼴 표시, 피드백 전달",
      source: null,
    },
    retention: {
      status: "unconfirmed",
      publicValue: "보유·이용 기간은 공식 자료로 이 방침에서 확정하지 않습니다.",
      source: null,
    },
    legalBasis: UNCONFIRMED_LEGAL_BASIS,
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("Google 로그인, 해당 글꼴, 피드백을"),
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
      publicValue: "미국",
      source: "https://resend.com/security/gdpr",
    },
    timingMethod: REQUEST_TIME_NETWORK,
    purpose: {
      status: "confirmed",
      publicValue: "가입 인증 메일 발송",
      source: null,
    },
    retention: {
      status: "confirmed",
      publicValue: "서비스 제공 및 법적 의무 이행에 필요한 기간",
      source: "https://resend.com/legal/privacy-policy",
    },
    legalBasis: {
      status: "confirmed",
      publicValue: "개인정보 보호법 제28조의8 제1항 제3호 가목",
      source: "https://www.law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1029334957",
    },
    refusalMethod: REFUSAL_METHOD,
    refusalEffect: refusalEffect("이메일 가입을"),
  },
] as const satisfies readonly CrossBorderTransferRow[];

export const PRODUCTION_CROSS_BORDER_PROVIDER_IDS = CROSS_BORDER_TRANSFERS.map(
  (row) => row.id,
) as readonly ProductionCrossBorderProviderId[];

export const CONFIRMED_CROSS_BORDER_TRANSFERS = CROSS_BORDER_TRANSFERS.filter((row) =>
  isCrossBorderRowComplete(row),
);

export const CROSS_BORDER_ARTICLE_28_8_DISCLOSURE_COMPLETE =
  CROSS_BORDER_TRANSFERS.length > 0 &&
  CROSS_BORDER_TRANSFERS.every((row) => isCrossBorderRowComplete(row));

export const CROSS_BORDER_FINAL_COUNTRY_UNRESOLVABLE_PROVIDER_IDS = [
  "openrouter",
  "cheaper-inference",
] as const;

const UNCONFIRMED_PUBLIC_CELL = "확인되지 않음";

function publicCell(field: CrossBorderField): string {
  return field.status === "confirmed" ? field.publicValue : UNCONFIRMED_PUBLIC_CELL;
}

export const CROSS_BORDER_PUBLIC_TABLE_COLUMNS = [
  "이전받는 자",
  "연락처",
  "이전 국가",
  "시기 및 방법",
  "이전 항목",
  "이용 목적",
  "보유·이용 기간",
  "거부 방법",
  "거부 효과",
] as const;

export const CROSS_BORDER_PUBLIC_TABLE = {
  columns: CROSS_BORDER_PUBLIC_TABLE_COLUMNS,
  rows: CROSS_BORDER_TRANSFERS.map((row) => [
    publicCell(row.recipient),
    publicCell(row.recipientContact),
    publicCell(row.countries),
    publicCell(row.timingMethod),
    publicCell(row.items),
    publicCell(row.purpose),
    publicCell(row.retention),
    publicCell(row.refusalMethod),
    publicCell(row.refusalEffect),
  ]),
} as const;

/** User-facing 28-8 table. Live paths stay visible; unknown cells are not guessed. */
export function formatCrossBorderPrivacyParagraphs(): string[] {
  return [
    "서비스 이용을 위해 아래 업체에 개인정보를 국외로 이전합니다.",
    CROSS_BORDER_PUBLIC_TABLE.columns.join(" | "),
    ...CROSS_BORDER_PUBLIC_TABLE.rows.map((row) => row.join(" | ")),
  ];
}
