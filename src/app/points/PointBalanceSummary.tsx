import { ATTENDANCE_POINTS_VALID_DAYS } from "@/lib/attendanceConstants";
import { FREE_POINTS_VALID_YEARS, PAID_POINTS_VALID_YEARS } from "@/lib/plans";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type Props = {
  total: number;
  paid: number;
  free: number;
  attendance: number;
};

function formatP(value: number): string {
  return `${value.toLocaleString("ko-KR")}P`;
}

export default function PointBalanceSummary({ total, paid, free, attendance }: Props) {
  const rows = [
    { key: "paid", label: "유료 포인트", note: `충전한 포인트 · ${PAID_POINTS_VALID_YEARS}년 유효`, value: paid },
    { key: "free", label: "무료 포인트", note: `이벤트·충전 보너스 · ${FREE_POINTS_VALID_YEARS}년 유효`, value: free },
    {
      key: "attendance",
      label: "출석 포인트",
      note: `출석 보상 · ${ATTENDANCE_POINTS_VALID_DAYS}일 유효 · 선물 불가`,
      value: attendance,
    },
  ] as const;

  return (
    <section aria-labelledby="points-balance-title" data-testid="points-balance" className={studioSurface.section}>
      <div>
        <h2 id="points-balance-title" className={studioType.sectionTitle}>
          보유 포인트
        </h2>
        <p
          className="mt-1 break-all text-3xl font-semibold tabular-nums leading-tight tracking-tight text-zinc-50"
          data-testid="points-balance-total"
        >
          {formatP(total)}
        </p>
      </div>
      <dl className="divide-y divide-white/5 rounded-xl border border-white/10 bg-[#0e1120]">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`points-balance-${row.key}`}>
            <dt className="min-w-0">
              <span className="block text-sm font-medium text-zinc-100">{row.label}</span>
              <span className={cn(studioType.caption, "block")}>{row.note}</span>
            </dt>
            <dd className="max-w-[55%] shrink-0 break-all text-right text-base font-semibold tabular-nums text-zinc-50">
              {formatP(row.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
