/** 파트너(전속 포함) 등급 크리에이터 이름 옆에 붙는 공식 뱃지 */
export default function OfficialCreatorBadge({
  size = "sm",
}: {
  size?: "sm" | "md";
}) {
  const sizeCls = size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      title="공식 크리에이터 — 파트너 등급 이상 달성"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-400 to-yellow-300 font-bold text-black ${sizeCls}`}
    >
      ✓ 공식 크리에이터
    </span>
  );
}
