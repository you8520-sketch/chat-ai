"use client";

import Link from "next/link";

type BoardLink = {
  href: "/board/notice" | "/board/inquiry" | "/board/faq";
  label: string;
  noticeBadge?: boolean;
};

const BOARD_LINKS: BoardLink[] = [
  { href: "/board/notice", label: "공지사항", noticeBadge: true },
  { href: "/board/inquiry", label: "문의게시판" },
  { href: "/board/faq", label: "FAQ" },
];

type Props = {
  unreadNotice: boolean;
};

/** Desktop only — mobile board links live under Settings → 고객지원. */
export default function HeaderBoardLinks({ unreadNotice }: Props) {
  return (
    <nav className="hidden items-center gap-4 md:flex" aria-label="게시판">
      {BOARD_LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="shrink-0 font-medium text-zinc-300 transition hover:text-white"
        >
          {l.label}
          {l.noticeBadge && unreadNotice && (
            <sup className="ml-0.5 text-[9px] font-bold text-red-400">N</sup>
          )}
        </Link>
      ))}
    </nav>
  );
}
