import Link from "next/link";
import type { CreatorNextAction } from "@/lib/creatorDashboardView";
import { formatPoints } from "@/lib/billingDisplay";
import StudioButton from "@/components/studio/StudioButton";
import { ScopedNotice, type PageNotice } from "@/components/studio/PersonaPageParts";
import { cn, studioInputClass, studioSurface, studioType } from "@/lib/studioDesign";

const fmt = (n: number) => formatPoints(n);

export function NextActions({
  actions,
  onTarget,
  className,
}: {
  actions: CreatorNextAction[];
  onTarget: (target: NonNullable<CreatorNextAction["target"]>) => void;
  className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <section aria-labelledby="creator-next-title" className={cn(studioSurface.card, "p-4 sm:p-5", className)}>
      <h2 id="creator-next-title" className={studioType.sectionTitle}>
        지금 할 일
      </h2>
      <ul className="mt-2 space-y-1">
        {actions.map((action) => (
          <li key={action.key} className="flex items-center justify-between gap-3 text-sm text-zinc-200">
            <span className="min-w-0 break-keep py-2 leading-relaxed">{action.text}</span>
            {action.href ? (
              <Link
                href={action.href}
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-2 text-sm font-semibold text-violet-300 hover:text-violet-200"
              >
                스튜디오
              </Link>
            ) : action.target ? (
              <button
                type="button"
                onClick={() => onTarget(action.target!)}
                className="inline-flex min-h-11 shrink-0 items-center rounded-xl px-2 text-sm font-semibold text-violet-300 hover:text-violet-200"
              >
                바로가기
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExchangeCard({
  creatorPoints,
  amount,
  busy,
  notice,
  onAmountChange,
  onFillAll,
  onSubmit,
}: {
  creatorPoints: number;
  amount: string;
  busy: boolean;
  notice: PageNotice | null;
  onAmountChange: (value: string) => void;
  onFillAll: () => void;
  onSubmit: () => void;
}) {
  const parsed = Number(amount);
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  return (
    <section
      id="creator-exchange"
      aria-labelledby="creator-exchange-title"
      className={cn(studioSurface.card, "scroll-mt-24 p-4 sm:p-5")}
    >
      <h2 id="creator-exchange-title" className={studioType.sectionTitle}>
        CP → 유료 포인트 교환
      </h2>
      <p className={cn(studioType.caption, "mt-1")}>
        1CP = 1P (유료 포인트) · 동일 가치로 교환 · 현금 출금은 아래 출금 신청에서 따로 해요.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[10rem] flex-1">
          <label htmlFor="creator-exchange-amount" className={studioType.label}>
            교환 CP
          </label>
          <input
            id="creator-exchange-amount"
            type="number"
            inputMode="decimal"
            min={0.1}
            step={0.1}
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            placeholder={`최대 ${fmt(creatorPoints)}`}
            className={studioInputClass}
          />
        </div>
        <StudioButton type="button" variant="secondary" disabled={busy || creatorPoints <= 0} onClick={onFillAll}>
          전액
        </StudioButton>
        <StudioButton type="button" disabled={busy} aria-busy={busy} onClick={onSubmit}>
          {busy ? "교환 중…" : "유료P 교환"}
        </StudioButton>
      </div>
      <p className={cn(studioType.helper, "mt-2")} aria-live="polite">
        {hasAmount ? (
          <>
            교환하면 <strong className="text-zinc-100">{fmt(parsed)}P</strong>를 받아요. 보유{" "}
            {fmt(creatorPoints)}CP
          </>
        ) : (
          <>보유 {fmt(creatorPoints)}CP</>
        )}
      </p>
      <ScopedNotice notice={notice} className="mt-3" />
    </section>
  );
}
