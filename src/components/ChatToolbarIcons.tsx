type IconProps = { className?: string };

const base = "h-[18px] w-[18px]";

export function IconRegenerate({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 20v-6h-6" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 19a9 9 0 0 0 14-2.5M19 5a9 9 0 0 0-14 2.5"
      />
    </svg>
  );
}

export function IconEdit({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

export function IconTrash({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 6V4h8v2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l1 14h10l1-14" />
      <path strokeLinecap="round" d="M10 11v5M14 11v5" />
    </svg>
  );
}

export function IconPlus({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconInfo({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 10v6" />
      <circle cx="12" cy="7.25" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconBookmark({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 4h12v16l-6-4-6 4V4z" />
    </svg>
  );
}

export function IconFork({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <circle cx="6" cy="18" r="2" />
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path strokeLinecap="round" d="M6 8v8M8 12h8" />
    </svg>
  );
}

export function IconThumbUp({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 11v8a1 1 0 0 0 1 1h2.5l3.5-9H7zM7 11l-2-2V8a1 1 0 0 1 1-1h3"
      />
      <rect x="14" y="11" width="3" height="9" rx="1" />
    </svg>
  );
}

export function IconThumbDown({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 13V5a1 1 0 0 0-1-1h-2.5l-3.5 9H17zM17 13l2 2v1a1 1 0 0 1-1 1h-3"
      />
      <rect x="7" y="4" width="3" height="9" rx="1" />
    </svg>
  );
}

export function IconErrorBeacon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" d="M12 5v2M8.5 7.5l1.2 1.2M15.5 7.5l-1.2 1.2" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.5 13h5l1-4.5a3 3 0 0 0-7 0L9.5 13z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 13v2.5h7V13" />
    </svg>
  );
}
