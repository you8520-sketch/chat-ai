import type { ReactNode } from "react";
import {
  CREATOR_TIER_LABELS,
  type CreatorCharacterEarningShare,
  type CreatorDashboard,
  type CreatorEarningPeriod,
  type CreatorEarningRow,
} from "@/lib/creatorShared";
import {
  earningSharePercent,
  type TierConditionRow,
  type WithdrawalGate,
} from "@/lib/creatorDashboardView";
import { formatPoints } from "@/lib/billingDisplay";
import { getCharacterRepresentativeImageUrl } from "@/lib/characterAssets";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

const fmt = (n: number) => formatPoints(n);

export const EARNING_PERIOD_LABELS: Record<CreatorEarningPeriod, string> = {
  day: "하루",
  week: "일주일",
  month: "한달",
};

/** Rows shown before the rest folds into a "show more" disclosure. */
export const EARNING_SHARE_VISIBLE_ROWS = 6;

export function CharacterListAvatar({
  name,
  emoji,
  hue,
  assets,
  images,
}: {
  name: string;
  emoji: string;
  hue: number;
  assets: string;
  images: string;
}) {
  const thumb = getCharacterRepresentativeImageUrl(assets, images);
  return (
    <span
      className="flex h-10 w-10 shrink-0 overflow-hidden rounded-lg"
      style={{ background: `hsl(${hue} 60% 22%)` }}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="h-full w-full object-cover object-top" />
      ) : (
        <span aria-hidden className="flex h-full w-full items-center justify-center text-xl">
          {emoji}
        </span>
      )}
    </span>
  );
}

export function UnitLegend({ className }: { className?: string }) {
  return (
    <dl
      className={cn(
        "grid gap-x-4 gap-y-1 text-[13px] leading-relaxed text-zinc-400 sm:grid-cols-3",
        className,
      )}
      aria-label="단위 안내"
    >
      <div className="flex gap-1.5">
        <dt className="font-semibold text-zinc-200">CP</dt>
        <dd>크리에이터 포인트 · 적립</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="font-semibold text-zinc-200">P</dt>
        <dd>유료 포인트 · 교환 시 지급</dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="font-semibold text-zinc-200">₩</dt>
        <dd>출금 실수령 금액</dd>
      </div>
    </dl>
  );
}

export function CreatorSummary({
  tier,
  creatorPoints,
  totalReward,
  totalSpentOnChars,
  statsClassName,
  className,
  children,
}: {
  tier: CreatorDashboard["tier"];
  creatorPoints: number;
  totalReward: number;
  totalSpentOnChars: number;
  statsClassName?: string;
  className?: string;
  children?: ReactNode;
}) {
  const rewardPct = Math.round(tier.rewardRate * 100);
  const belowThreshold = tier.rewardRate <= 0;
  return (
    <section aria-labelledby="creator-summary-title" className={cn(studioSurface.card, "p-4 sm:p-5", className)}>
      <p id="creator-summary-title" className="text-xs font-semibold tracking-wider text-zinc-400">
        적립 등급
      </p>
      <p className="mt-1 break-keep text-xl font-semibold text-zinc-50">
        {belowThreshold ? (
          <>
            등급 조건 미달 · <span className="text-violet-200">0%</span>
          </>
        ) : (
          <>
            {CREATOR_TIER_LABELS[tier.tierLevel]} 크리에이터 ·{" "}
            <span className="text-violet-200">{rewardPct}%</span>
          </>
        )}
      </p>
      <p className={cn(studioType.helper, "mt-1")}>
        {belowThreshold
          ? "지금은 CP가 적립되지 않아요. 아래 조건을 채우면 적립이 시작돼요."
          : `내 캐릭터 이용 포인트 소비량의 ${rewardPct}%가 크리에이터 포인트(CP)로 적립돼요.`}
      </p>
      <dl className={cn("mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3", statsClassName)}>
        <SummaryStat label="보유 CP" value={fmt(creatorPoints)} unit="CP" emphasis className="col-span-2 sm:col-span-1" />
        <SummaryStat label="누적 적립" value={fmt(totalReward)} unit="CP" />
        <SummaryStat label="캐릭터 이용 소비" value={fmt(totalSpentOnChars)} unit="P" />
      </dl>
      {children}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  unit,
  emphasis,
  className,
}: {
  label: string;
  value: string;
  unit: string;
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2.5",
        emphasis ? "border-violet-400/30 bg-violet-500/[0.08]" : "border-white/[0.08] bg-[#0e1120]/70",
        className,
      )}
    >
      <dt className="text-[13px] text-zinc-400">{label}</dt>
      <dd className="mt-0.5 break-all text-lg font-semibold tabular-nums text-zinc-50">
        {value}
        <span className="ml-0.5 text-sm font-medium text-zinc-300">{unit}</span>
      </dd>
    </div>
  );
}

export function TierLadder({ rows }: { rows: TierConditionRow[] }) {
  return (
    <section aria-labelledby="creator-tier-ladder-title" className={cn(studioSurface.card, "p-4 sm:p-5")}>
      <h2 id="creator-tier-ladder-title" className={studioType.sectionTitle}>
        등급업 조건
      </h2>
      <p className={cn(studioType.caption, "mt-1")}>
        등급과 적립률은 서버가 판정해요. 조건 충족 표시는 현재 수치 기준 안내입니다.
      </p>
      <ol className="mt-3 space-y-2">
        {rows.map((row) => (
          <li
            key={row.key}
            aria-current={row.isCurrent ? "true" : undefined}
            className={cn(
              "rounded-xl border px-3 py-2.5",
              row.isCurrent ? "border-violet-400/40 bg-violet-500/[0.08]" : "border-white/[0.08] bg-[#0e1120]/60",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-keep text-sm font-semibold text-zinc-50">
                {row.label} · {row.ratePct}%
              </span>
              {row.isCurrent && (
                <span className="rounded bg-violet-500/25 px-1.5 py-0.5 text-xs font-semibold text-violet-100">
                  현재 등급
                </span>
              )}
              {row.met && !row.isCurrent && (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs font-semibold text-zinc-200">
                  조건 충족
                </span>
              )}
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {row.requirements.map((req) => {
                const done = req.current >= req.target;
                return (
                  <li key={req.label} className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-zinc-400">
                    <span>{req.label}</span>
                    <span className="font-medium tabular-nums text-zinc-200">
                      {req.current.toLocaleString()} / {req.target.toLocaleString()}
                      {req.unit}
                    </span>
                    <span className={done ? "text-emerald-300" : "text-zinc-400"}>
                      {done ? "충족" : "미충족"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {row.key === "pro" && (
              <p className="mt-1 text-[13px] text-zinc-400">그 밖의 조건은 충족하면 자동으로 등업돼요.</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const GATE_TONE: Record<WithdrawalGate["state"], string> = {
  ready: "border-emerald-400/30 bg-emerald-500/[0.07] text-emerald-100",
  short: "border-white/15 bg-white/[0.04] text-zinc-100",
  pending: "border-amber-400/30 bg-amber-500/[0.07] text-amber-100",
  blocked: "border-rose-400/30 bg-rose-500/[0.07] text-rose-100",
};

const GATE_BADGE: Record<WithdrawalGate["state"], string> = {
  ready: "신청 가능",
  short: "금액 부족",
  pending: "처리 중",
  blocked: "신청 불가",
};

export function WithdrawalGateBanner({ gate, children }: { gate: WithdrawalGate; children?: ReactNode }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", GATE_TONE[gate.state])}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <span className="rounded border border-current/30 px-1.5 py-0.5 text-xs">{GATE_BADGE[gate.state]}</span>
        <span className="break-keep">{gate.title}</span>
      </p>
      <p className="mt-1 break-keep text-[13px] leading-relaxed opacity-90">{gate.detail}</p>
      {children}
    </div>
  );
}

function ShareRow({
  row,
  percent,
  selected,
  onSelect,
}: {
  row: CreatorCharacterEarningShare;
  percent: number;
  selected: boolean;
  onSelect: (id: number) => void;
}) {
  const barWidth = `${Math.max(0, Math.min(100, percent))}%`;
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(row.id)}
        className={cn(
          "block min-h-11 w-full rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
          selected
            ? "border-violet-300/50 bg-violet-500/[0.1]"
            : "border-white/[0.08] bg-[#0e1120]/70 hover:border-white/20 hover:bg-white/[0.04]",
        )}
      >
        <span className="flex items-center gap-3">
          <CharacterListAvatar
            name={row.name}
            emoji={row.emoji}
            hue={row.hue}
            assets={row.assets}
            images={row.images}
          />
          <span className="min-w-0 flex-1 break-keep text-sm font-semibold leading-snug text-zinc-100 [overflow-wrap:anywhere]">
            {row.name}
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-semibold tabular-nums text-zinc-50">{percent}%</span>
            <span className="block text-xs tabular-nums text-zinc-400">{fmt(row.period_reward)}CP</span>
          </span>
        </span>
        <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-black/40">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
            style={{ width: barWidth }}
          />
        </span>
      </button>
    </li>
  );
}

export function CharacterEarningShareChart({
  rows,
  period,
  selectedId,
  onPeriodChange,
  onSelect,
}: {
  rows: CreatorDashboard["characterEarningShares"][CreatorEarningPeriod];
  period: CreatorEarningPeriod;
  selectedId: number | null;
  onPeriodChange: (period: CreatorEarningPeriod) => void;
  onSelect: (id: number) => void;
}) {
  const totalReward = rows.reduce((sum, row) => sum + Number(row.period_reward ?? 0), 0);
  const activeRow = rows.find((row) => row.id === selectedId) ?? rows.find((row) => row.period_reward > 0);
  const visible = rows.slice(0, EARNING_SHARE_VISIBLE_ROWS);
  const rest = rows.slice(EARNING_SHARE_VISIBLE_ROWS);
  const renderRow = (row: CreatorCharacterEarningShare) => (
    <ShareRow
      key={row.id}
      row={row}
      percent={earningSharePercent(totalReward, row.share_ratio)}
      selected={selectedId === row.id}
      onSelect={onSelect}
    />
  );

  return (
    <section aria-labelledby="creator-share-title" className={cn(studioSurface.card, "p-4 sm:p-5")}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="creator-share-title" className={studioType.sectionTitle}>
            캐릭터별 적립비중
          </h2>
          <p className={cn(studioType.caption, "mt-1")} aria-live="polite">
            {EARNING_PERIOD_LABELS[period]} 동안 합계 <strong className="text-zinc-100">{fmt(totalReward)}CP</strong>
          </p>
        </div>
        <div role="group" aria-label="집계 기간" className="flex rounded-xl border border-white/10 bg-[#090b14]/70 p-1">
          {(Object.keys(EARNING_PERIOD_LABELS) as CreatorEarningPeriod[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              onClick={() => onPeriodChange(id)}
              className={cn(
                "min-h-11 min-w-14 rounded-lg px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
                period === id ? "bg-violet-600 text-white" : "text-zinc-300 hover:text-white",
              )}
            >
              {EARNING_PERIOD_LABELS[id]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={studioType.body}>아직 제작한 캐릭터가 없습니다.</p>
      ) : (
        <>
          {totalReward <= 0 && (
            <p className={cn(studioType.helper, "mb-2")}>이 기간에는 적립된 CP가 없어요.</p>
          )}
          <ul className="space-y-2">{visible.map(renderRow)}</ul>
          {rest.length > 0 && (
            <details className="group mt-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center rounded-xl border border-white/10 text-sm font-semibold text-zinc-300 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">나머지 캐릭터 {rest.length}개 더 보기</span>
                <span className="hidden group-open:inline">접기</span>
              </summary>
              <ul className="mt-2 space-y-2">{rest.map(renderRow)}</ul>
            </details>
          )}
        </>
      )}

      {activeRow && (
        <p className="mt-3 break-keep text-[13px] leading-relaxed text-zinc-400">
          {activeRow.name}: <span className="font-semibold text-violet-200">{fmt(activeRow.period_reward)}CP</span>{" "}
          적립 · 이용 {fmt(activeRow.period_spent)}P
        </p>
      )}
    </section>
  );
}

export function RecentEarningsList({ rows }: { rows: CreatorEarningRow[] }) {
  return (
    <section aria-labelledby="creator-earnings-title" className={cn(studioSurface.card, "p-4 sm:p-5")}>
      <h2 id="creator-earnings-title" className={cn(studioType.sectionTitle, "mb-3")}>
        최근 적립 내역
      </h2>
      {rows.length === 0 ? (
        <p className={studioType.body}>아직 적립 내역이 없습니다. 내 캐릭터가 이용되면 여기에 쌓여요.</p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {rows.map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-3 rounded-lg px-2 py-2 text-sm odd:bg-white/[0.025]"
            >
              <span className="min-w-0">
                <span
                  className={cn(
                    "block break-keep [overflow-wrap:anywhere]",
                    e.reversed ? "text-zinc-400 line-through" : "text-zinc-100",
                  )}
                >
                  {e.character_name}
                </span>
                <span className="block text-xs text-zinc-400">
                  {e.created_at.slice(5, 16)} · 소비 {fmt(e.points_spent)}P
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={cn(
                    "block font-semibold tabular-nums",
                    e.reversed ? "text-zinc-400 line-through" : "text-violet-200",
                  )}
                >
                  +{fmt(e.reward_amount)}CP
                </span>
                {e.reversed ? (
                  <span className="mt-0.5 inline-block rounded bg-rose-500/15 px-1.5 py-0.5 text-xs font-semibold text-rose-200">
                    적립 취소
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
