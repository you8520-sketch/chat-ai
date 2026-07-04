export const BOARD_CONFIG = {
  inquiry: {
    title: "문의 게시판",
    writable: true,
    private: true,
    comments: true,
    desc: "문의 내용은 작성자 본인만 볼 수 있습니다. 운영팀 답변은 문의 글 아래에 표시됩니다.",
  },
  notice: { title: "공지사항", writable: false },
  faq: { title: "FAQ", writable: false },
} as const;

export type BoardSlug = keyof typeof BOARD_CONFIG;

export const ADMIN_MANAGED_BOARDS = ["notice", "faq"] as const;
export type AdminManagedBoard = (typeof ADMIN_MANAGED_BOARDS)[number];

export function isAdminManagedBoard(board: string): board is AdminManagedBoard {
  return (ADMIN_MANAGED_BOARDS as readonly string[]).includes(board);
}
