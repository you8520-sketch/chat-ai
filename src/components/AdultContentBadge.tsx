type Props = {
  className?: string;
};

/** User-facing maturity label. Internal NSFW routing remains separate. */
export default function AdultContentBadge({ className = "" }: Props) {
  return (
    <span
      title="성인용 콘텐츠"
      className={`inline-flex items-center rounded-md border border-white/15 bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-zinc-200 backdrop-blur-sm ${className}`}
    >
      성인
    </span>
  );
}
