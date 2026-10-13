export type AdminLinkGroup = {
  title: string;
  links: ReadonlyArray<{ href: string; label: string; reviewBadge?: boolean }>;
};

/** Admin shortcuts shown on /settings. Visibility is decided by the server-provided isAdmin flag. */
export const ADMIN_LINK_GROUPS: ReadonlyArray<AdminLinkGroup> = [
  {
    title: "포인트 · 정산",
    links: [
      { href: "/admin/point-grant", label: "무료 포인트 지급" },
      { href: "/admin/create-migration", label: "캐릭터 제작 포인트 신청 관리" },
      { href: "/admin/report-refunds", label: "오류 신고 환불" },
      { href: "/admin/payout", label: "크리에이터 정산" },
      { href: "/admin/finance", label: "유지비 · 실제 수익률" },
    ],
  },
  {
    title: "캐릭터 · 댓글",
    links: [
      { href: "/admin/character-moderation", label: "성인 캐릭터 홈 노출 검수" },
      { href: "/admin/official-characters", label: "공식 캐릭터 관리" },
      { href: "/admin/comment-banned-words", label: "댓글 금지어 관리" },
      { href: "/admin/comment-reports", label: "신고 댓글 관리", reviewBadge: true },
    ],
  },
  {
    title: "운영 · 공지",
    links: [
      { href: "/admin/ops", label: "운영 예외함" },
      { href: "/admin/automation-reports", label: "자동화 보고서" },
      { href: "/admin/boards", label: "공지사항 관리" },
      { href: "/admin/home-popup-notice", label: "홈 팝업 공지" },
    ],
  },
];

export function adminLinkLabel(
  link: { label: string; reviewBadge?: boolean },
  pendingCommentReviews: number
): string {
  return link.reviewBadge && pendingCommentReviews > 0
    ? `${link.label} (${pendingCommentReviews})`
    : link.label;
}

export type SafetyFilterView = {
  /** Stored `nsfw_on` is 0 while the safety filter is ON — the meaning is unchanged. */
  filterOn: boolean;
  stateLabel: "켜짐" | "꺼짐";
  help: string;
  lockedNote: string | null;
};

export function safetyFilterView(input: {
  nsfwOn: boolean;
  isAdult: boolean;
  canDisableSafetyFilter: boolean;
}): SafetyFilterView {
  const filterOn = !input.nsfwOn;
  const help = input.canDisableSafetyFilter
    ? input.isAdult
      ? "켜면 성인 캐릭터를 숨기고, 끄면 목록에 표시합니다."
      : "관리자 베타 테스트 접근입니다. 성인인증 완료로 기록되지 않습니다."
    : "기본으로 켜져 있으며, 일반 회원은 끌 수 없습니다.";
  return {
    filterOn,
    stateLabel: filterOn ? "켜짐" : "꺼짐",
    help,
    lockedNote: input.canDisableSafetyFilter
      ? null
      : "현재는 관리자 베타 테스트 계정에서만 세이프티 필터를 끌 수 있어요.",
  };
}
