/** 가입 후 댓글/신고 가능 최소 일수 */
export const COMMENT_MIN_ACCOUNT_AGE_DAYS = 3;

/** 캐릭터 댓글 — 해당 캐릭터 대화 누적 포인트 하한 */
export const COMMENT_MIN_CHARACTER_POINTS = 500;

/** 크리에이터 프로필 댓글 — 사이트 전체 사용 포인트 하한 */
export const COMMENT_MIN_SITE_POINTS = 500;

/** 신고 누적 시 임시 블라인드 + AI 검수 */
export const COMMENT_REPORT_BLIND_THRESHOLD = 10;

/** 신고자 초기 신뢰도 (0–100) */
export const COMMENT_REPORT_TRUST_INITIAL = 100;

/** AI가 정상 판정 시 신고자 신뢰도 감소 */
export const COMMENT_REPORT_TRUST_PENALTY = 12;

/** 신뢰도 하한 — 미만이면 신고 제한 */
export const COMMENT_REPORT_TRUST_MIN = 30;

/** 신뢰도 부족 시 신고 제한 일수 */
export const COMMENT_REPORT_RESTRICT_DAYS = 7;

/** AI BLOCK 누적 시 작성자 댓글 금지 */
export const COMMENT_AUTHOR_BLOCK_STRIKES = 3;

export const COMMENT_BANNED_WORD_CATEGORIES = [
  "profanity",
  "insult",
  "ai_attack",
  "politics",
  "adult",
  "other",
] as const;

export type CommentBannedWordCategory = (typeof COMMENT_BANNED_WORD_CATEGORIES)[number];

export const COMMENT_BANNED_WORD_CATEGORY_LABELS: Record<CommentBannedWordCategory, string> = {
  profanity: "욕설",
  insult: "비방",
  ai_attack: "AI공격",
  politics: "정치",
  adult: "성인",
  other: "기타",
};
