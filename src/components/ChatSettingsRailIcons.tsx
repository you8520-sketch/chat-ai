type IconProps = { className?: string };

const base = "h-[18px] w-[18px] shrink-0";

export type ChatSettingsRailIconId = "persona" | "note" | "memory" | "display";

export function IconSettingsPersona({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 20v-1a7 7 0 0 1 14 0v1" />
    </svg>
  );
}

export function IconSettingsNote({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5-5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 4v5h5M8 13h8M8 17h5" />
    </svg>
  );
}

export function IconSettingsMemory({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  );
}

export function IconSettingsDisplay({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

const ICON_MAP = {
  persona: IconSettingsPersona,
  note: IconSettingsNote,
  memory: IconSettingsMemory,
  display: IconSettingsDisplay,
} as const;

export function ChatSettingsRailIcon({
  id,
  className,
}: {
  id: ChatSettingsRailIconId;
  className?: string;
}) {
  const Cmp = ICON_MAP[id];
  return <Cmp className={className} />;
}
