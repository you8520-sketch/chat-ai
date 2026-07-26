type Props = {
  className?: string;
};

/** User-facing maturity label. Internal NSFW routing remains separate. */
export default function AdultContentBadge({ className = "" }: Props) {
  return (
    <span
      title="성인용 콘텐츠"
      className={`inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-semibold leading-none text-zinc-200 ${className}`}
    >
      성인
    </span>
  );
}
