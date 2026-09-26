/** Site-managed official studio identity — not the partner creator badge. */
export default function OfficialStudioBadge({
  size = "sm",
}: {
  size?: "sm" | "md";
}) {
  const sizeCls = size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      title="사이트에서 운영하는 공식 스튜디오"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md border border-violet-400/30 bg-violet-500/15 font-bold text-violet-200 ${sizeCls}`}
    >
      공식 스튜디오
    </span>
  );
}
