/**
 * App design tokens — shared by Studio and Home chrome.
 * Prefer these over ad-hoc violet/cyan/amber/emerald accents.
 */

export const studioTokens = {
  bg: "#0b0d14",
  surface: "#131626",
  surfaceRaised: "#181b2e",
  input: "#161922",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.16)",
  primary: "#7c3aed",
  primaryHover: "#8b5cf6",
  text: "#f4f4f5",
  textSecondary: "#a1a1aa",
  placeholder: "#71717a",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
} as const;

/** Alias for non-studio surfaces */
export const appTokens = studioTokens;

/** 8px grid spacing helpers (Tailwind) */
export const studioSpace = {
  pageX: "px-4",
  pageY: "py-6 sm:py-8",
  section: "space-y-6",
  stack: "space-y-4",
  gap: "gap-4",
  cardPad: "p-4 sm:p-5",
} as const;

/** Typography — 6 levels only */
export const studioType = {
  heading: "text-2xl font-semibold tracking-tight text-zinc-50",
  sectionTitle: "text-base font-semibold tracking-tight text-zinc-50",
  label: "mb-1.5 block text-sm font-medium text-zinc-300",
  body: "text-sm leading-relaxed text-zinc-300",
  caption: "text-xs leading-relaxed text-zinc-400",
  helper: "text-xs leading-relaxed text-zinc-400",
  counter: "text-xs tabular-nums text-zinc-500",
} as const;

export const studioSurface = {
  page: "mx-auto max-w-6xl px-4 py-6 sm:py-8",
  pageNarrow: "mx-auto max-w-2xl px-4 py-6 sm:py-8",
  card: "rounded-xl border border-white/10 bg-[#131626]",
  cardMuted: "rounded-xl border border-white/10 bg-[#131626]/80",
  cardDashed: "rounded-xl border border-dashed border-white/15 bg-[#131626]/60",
  section: "space-y-4 rounded-xl border border-white/10 bg-[#131626] p-4 sm:p-5",
  sectionAccent:
    "space-y-4 rounded-xl border border-white/10 border-l-[3px] border-l-violet-500/70 bg-[#131626] p-4 sm:p-5",
  tabList: "flex gap-1 rounded-xl border border-white/10 bg-[#0e1120] p-1",
  tabActive: "bg-violet-600 text-white",
  tabIdle: "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
  backLink: "text-sm text-zinc-400 transition hover:text-zinc-200",
  choiceActive:
    "border-violet-500 bg-violet-600/20 text-violet-100 ring-1 ring-violet-500/40",
  choiceIdle:
    "border-white/10 bg-[#161922] text-zinc-400 hover:border-white/20 hover:text-zinc-200",
  chip: "inline-flex min-h-11 items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-xs font-medium text-zinc-200 ring-1 ring-white/10",
  chipRemove:
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white",
  uploadZone:
    "w-full rounded-xl border border-dashed border-white/20 bg-white/[0.03] py-8 text-base font-semibold text-zinc-200 transition hover:border-violet-400/50 hover:bg-violet-500/10 hover:text-white disabled:opacity-40 sm:py-10",
  hit: "min-h-11 min-w-11",
  menu:
    "overflow-hidden rounded-xl border border-white/10 bg-[#131626] py-1 shadow-xl shadow-black/40",
  banner:
    "rounded-xl border border-white/10 bg-[#131626] p-4 sm:rounded-xl sm:p-5",
  linkQuiet: "text-xs font-medium text-zinc-400 transition hover:text-violet-300",
  navActive: "bg-violet-600/20 text-violet-100",
  navIdle: "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100",
} as const;

export const studioInputClass =
  "w-full rounded-xl border border-white/10 bg-[#161922] px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50";

export const studioSelectClass =
  "rounded-xl border border-white/10 bg-[#161922] px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50";

export const studioTextareaClass = `${studioInputClass} resize-y`;

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
