/** 사이트 공통 캐릭터 프로필 타이포그래피 규격 */
export const profileTypography = {
  card: "relative overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121212] shadow-[0_0_48px_-12px_rgba(52,211,153,0.18)]",
  cardGlow:
    "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent",
  name: "bg-gradient-to-br from-white via-white to-emerald-100/90 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent",
  summaryCard:
    "mt-5 rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-transparent px-5 py-4",
  summaryLabel: "mb-1 text-[10px] font-bold uppercase tracking-[0.25em] text-violet-300/80",
  summary: "text-[15px] font-medium leading-relaxed tracking-wide text-gray-200",
  sectionH2:
    "mb-5 mt-10 border-b border-emerald-500/35 pb-3 text-sm font-extrabold uppercase tracking-[0.16em] text-emerald-200 first:mt-0 sm:text-[15px]",
  sectionH3: "mb-3 mt-7 text-lg font-bold tracking-wide text-cyan-100 sm:text-xl",
  paragraph: "mb-5 text-base leading-[1.85] tracking-[0.01em] text-zinc-100 last:mb-0 sm:text-[17px]",
  appearanceLabel: "mb-2 text-[10px] font-bold uppercase tracking-[0.25em] text-emerald-400/80",
  appearance:
    "mb-6 rounded-xl border border-emerald-500/15 bg-gradient-to-br from-emerald-500/10 to-transparent px-4 py-4 text-sm leading-relaxed text-emerald-50/90",
  blockquote:
    "my-5 border-l-2 border-cyan-400/50 bg-cyan-400/5 py-3 pl-4 pr-3 text-base italic leading-relaxed text-zinc-200 sm:text-[17px]",
  list: "mb-6 space-y-3",
  listItem: "text-base leading-[1.85] text-zinc-100 sm:text-[17px]",
  divider: "my-8 border-0 border-t border-white/10",
  bold: "font-semibold text-emerald-100/90",
  /** 목록·필드 라벨 (전투 스타일:, 신분: 등) */
  fieldLabel:
    "block text-[11px] font-extrabold uppercase tracking-[0.12em] text-emerald-400 sm:inline sm:text-[12px] sm:tracking-wide sm:normal-case sm:font-bold sm:text-amber-200/95",
  fieldValue:
    "block text-base font-normal leading-[1.85] text-zinc-200 sm:mt-0 sm:border-l sm:border-white/15 sm:pl-3 sm:text-[17px]",
  inlineImage:
    "profile-content-image mx-auto block w-full max-w-full h-auto max-h-[min(70vh,42rem)] rounded-xl object-contain shadow-lg shadow-black/40 ring-1 ring-white/10",
  tag: "rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-cyan-200 shadow-[0_0_12px_-4px_rgba(34,211,238,0.5)]",
} as const;

export type LayoutHint = "top" | "left" | "right" | "inline";
