export const BOARD_CONFIG = {
  notice: { title: "공지사항", writable: false },
} as const;

export type BoardSlug = keyof typeof BOARD_CONFIG;

export const ADMIN_MANAGED_BOARDS = ["notice"] as const;
export type AdminManagedBoard = (typeof ADMIN_MANAGED_BOARDS)[number];

export function isAdminManagedBoard(board: string): board is AdminManagedBoard {
  return (ADMIN_MANAGED_BOARDS as readonly string[]).includes(board);
}
