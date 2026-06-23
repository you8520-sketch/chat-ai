type IconProps = { className?: string };

const base = "h-[18px] w-[18px] shrink-0";

export type SidebarNavIconId = "chat" | "persona" | "studio" | "creator" | "verify" | "user";

export function IconSidebarChat({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 3.866-3.582 7-8 7a8.9 8.9 0 0 1-3.5-.7L3 20l1.3-4.2A7.9 7.9 0 0 1 3 12c0-3.866 3.582-7 8-7s8 3.134 8 7z"
      />
    </svg>
  );
}

export function IconSidebarPersona({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 20v-1a7 7 0 0 1 14 0v1" />
      <path strokeLinecap="round" d="M9 8.5c.5-1.5 2-2 3-2s2.5.5 3 2" />
    </svg>
  );
}

export function IconSidebarStudio({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m15 4 2 2-9 9H6v-2l9-9z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 5.5 18 10" />
      <path strokeLinecap="round" d="M4 20h16" />
    </svg>
  );
}

export function IconSidebarCreator({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l1.4 4.3L18 9l-4.6 1.7L12 15l-1.4-4.3L6 9l4.6-1.7L12 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 19l1.5-1.5M19 19l-1.5-1.5" />
    </svg>
  );
}

export function IconSidebarVerify({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3 4 7v5c0 5 3.5 7.7 8 9 4.5-1.3 8-4 8-9V7l-8-4z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function IconSidebarUser({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 20v-1a7 7 0 0 1 14 0v1" />
    </svg>
  );
}

export function IconSidebarMenu({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function IconSidebarChevronLeft({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14 6-6 6 6 6" />
    </svg>
  );
}

export function IconSidebarChevronRight({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m10 6 6 6-6 6" />
    </svg>
  );
}

/** 제작 메뉴 — 세계관 */
export function IconStudioWorld({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M3 12h18" />
      <path strokeLinecap="round" d="M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9" />
      <path strokeLinecap="round" d="M12 3c-2.5 2.5-4 5.5-4 9s1.5 6.5 4 9" />
    </svg>
  );
}

/** 제작 메뉴 — 로어북 */
export function IconStudioLorebook({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5.5A2.5 2.5 0 0 1 7.5 3H18v18H7.5A2.5 2.5 0 0 1 5 18.5V5.5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5.5A2.5 2.5 0 0 0 7.5 8H18" />
      <path strokeLinecap="round" d="M9 12h6M9 16h4" />
    </svg>
  );
}

const ICON_MAP = {
  chat: IconSidebarChat,
  persona: IconSidebarPersona,
  studio: IconSidebarStudio,
  creator: IconSidebarCreator,
  verify: IconSidebarVerify,
  user: IconSidebarUser,
} as const;

export function SidebarNavIcon({
  id,
  className,
}: {
  id: SidebarNavIconId;
  className?: string;
}) {
  const Cmp = ICON_MAP[id];
  return <Cmp className={className} />;
}
