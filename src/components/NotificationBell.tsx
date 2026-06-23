import Link from "next/link";

type Props = {
  count: number;
};

export default function NotificationBell({ count }: Props) {
  return (
    <Link
      href="/notifications"
      className="relative flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-white/5 hover:text-white"
      title="알림"
      aria-label={count > 0 ? `알림 ${count}건` : "알림"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[9px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
