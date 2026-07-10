"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import WithdrawalForm from "@/components/WithdrawalForm";
import CommentsEnabledToggle from "@/components/CommentsEnabledToggle";
import {
  CREATOR_PARTNER_MIN_CHARACTERS,
  CREATOR_PARTNER_MIN_MONTHLY_SPENT,
  CREATOR_PARTNER_RENEWAL_MAINTENANCE_RATE,
  CREATOR_PARTNER_TERM_MONTHS,
  CREATOR_PLUS_MIN_CHARACTERS,
  CREATOR_PLUS_MIN_TOTAL_CHATS,
  CREATOR_PRO_MIN_CHARACTERS,
  CREATOR_PRO_MIN_TOTAL_CHATS,
  CREATOR_REWARD_RATE,
  CREATOR_REWARD_RATE_EXCLUSIVE,
  CREATOR_REWARD_RATE_PARTNER,
  CREATOR_REWARD_RATE_PLUS,
  CREATOR_REWARD_RATE_PRO,
  CREATOR_TIER_LABELS,
  type CreatorDashboard,
} from "@/lib/creatorShared";
import { CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT } from "@/lib/partnerTier";
import { formatPoints } from "@/lib/billingDisplay";
import { getCharacterRepresentativeImageUrl } from "@/lib/characterAssets";

function CharacterListAvatar({
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
        <img src={thumb} alt={name} className="h-full w-full object-cover object-top" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xl">{emoji}</span>
      )}
    </span>
  );
}

function fmt(n: number) {
  return formatPoints(n);
}

function partnerStatusHint(t: CreatorDashboard["tier"], exclusivePct: number): string | null {
  if (t.tierLevel !== "partner" && t.tierLevel !== "exclusive") return null;
  if (t.isExclusive) return null;
  const term = t.partnerTerm;
  if (term?.active && term.validUntil) {
    const metCount = term.termMonths.filter((m) => m.met).length;
    return `파트너 유지 ~${term.validUntil.slice(0, 10)} · 갱신 조건 월 ${term.maintenanceMinMonthly.toLocaleString()}P+ (${CREATOR_PARTNER_RENEWAL_MAINTENANCE_RATE * 100}% 기준) · ${metCount}/${term.termMonths.length}개월 충족 · 미달 시 프로로 강등`;
  }
  return `전속 ${exclusivePct}%: 파트너 등급 달성 후 운영팀에 문의해 전속 계약을 진행할 수 있습니다.`;
}

type TierConditionRow = {
  key: string;
  label: string;
  ratePct: number;
  condition: string;
  current?: string;
  met: boolean;
  isCurrent: boolean;
};

function allTierConditions(
  t: CreatorDashboard["tier"],
  basePct: number,
  plusPct: number,
  proPct: number,
  partnerPct: number,
  exclusivePct: number
): TierConditionRow[] {
  const plusMet =
    t.characterCount >= CREATOR_PLUS_MIN_CHARACTERS &&
    t.totalChats >= CREATOR_PLUS_MIN_TOTAL_CHATS;
  const proMet =
    t.characterCount >= CREATOR_PRO_MIN_CHARACTERS &&
    t.totalChats >= CREATOR_PRO_MIN_TOTAL_CHATS;
  const partnerMet =
    t.publicCharacterCount >= CREATOR_PARTNER_MIN_CHARACTERS &&
    t.monthlySpentOnChars >= CREATOR_PARTNER_MIN_MONTHLY_SPENT;

  return [
    {
      key: "standard",
      label: "기본",
      ratePct: basePct,
      condition: "캐릭터 제작 시 자동 적용",
      met: true,
      isCurrent: t.tierLevel === "standard",
    },
    {
      key: "plus",
      label: "플러스",
      ratePct: plusPct,
      condition: `캐릭터 ${CREATOR_PLUS_MIN_CHARACTERS}개+ & 통합 대화 ${CREATOR_PLUS_MIN_TOTAL_CHATS.toLocaleString()}회+`,
      current: `현재 ${t.characterCount}개 · ${t.totalChats.toLocaleString()}회`,
      met: plusMet,
      isCurrent: t.tierLevel === "plus",
    },
    {
      key: "pro",
      label: "프로",
      ratePct: proPct,
      condition: `캐릭터 ${CREATOR_PRO_MIN_CHARACTERS}개+ & 통합 대화 ${CREATOR_PRO_MIN_TOTAL_CHATS.toLocaleString()}회+`,
      current: `현재 ${t.characterCount}개 · ${t.totalChats.toLocaleString()}회`,
      met: proMet,
      isCurrent: t.tierLevel === "pro",
    },
    {
      key: "partner",
      label: "파트너",
      ratePct: partnerPct,
      condition: `공개 캐릭터 ${CREATOR_PARTNER_MIN_CHARACTERS}개+ & 월간 소비 ${CREATOR_PARTNER_MIN_MONTHLY_SPENT.toLocaleString()}P+ · 승급 후 ${CREATOR_PARTNER_TERM_MONTHS}개월 유지, 갱신 시 월 ${CREATOR_PARTNER_RENEWAL_MIN_MONTHLY_SPENT.toLocaleString()}P+ × ${CREATOR_PARTNER_TERM_MONTHS}개월`,
      current: `현재 공개 ${t.publicCharacterCount}개 · ${fmt(t.monthlySpentOnChars)}P`,
      met: partnerMet || t.tierLevel === "partner" || t.tierLevel === "exclusive",
      isCurrent: t.tierLevel === "partner",
    },
    {
      key: "exclusive",
      label: "전속",
      ratePct: exclusivePct,
      condition: "파트너 달성 후 운영팀 문의 · 전속 계약 체결",
      met: t.isExclusive,
      isCurrent: t.tierLevel === "exclusive",
    },
  ];
}

export default function CreatorClient({ initial }: { initial: CreatorDashboard }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"dashboard" | "comments">("dashboard");
  const [exchangeAmount, setExchangeAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [withdrawMsg, setWithdrawMsg] = useState("");

  async function refresh() {
    const res = await fetch("/api/creator");
    const json = await res.json();
    if (res.ok) setData(json.dashboard);
  }

  async function exchange() {
    const amount = Number(exchangeAmount);
    if (!amount || amount <= 0) {
      setError("교환할 CP를 입력하세요.");
      return;
    }
    if (
      !confirm(
        `크리에이터 포인트 ${fmt(amount)}CP를 유료 포인트 ${fmt(amount)}P로 1:1 교환할까요?`
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    const res = await fetch("/api/creator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    setBusy(false);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "교환에 실패했습니다.");
      return;
    }
    setMsg(`유료 포인트 ${fmt(json.exchanged)}P가 지급되었습니다.`);
    setExchangeAmount("");
    await refresh();
    router.refresh();
  }

  const rewardPct = Math.round(data.tier.rewardRate * 100);
  const basePct = Math.round(CREATOR_REWARD_RATE * 100);
  const plusPct = Math.round(CREATOR_REWARD_RATE_PLUS * 100);
  const proPct = Math.round(CREATOR_REWARD_RATE_PRO * 100);
  const partnerPct = Math.round(CREATOR_REWARD_RATE_PARTNER * 100);
  const exclusivePct = Math.round(CREATOR_REWARD_RATE_EXCLUSIVE * 100);
  const tier = data.tier.tierLevel;
  const tierLabel = CREATOR_TIER_LABELS[tier];
  const tierRows = allTierConditions(
    data.tier,
    basePct,
    plusPct,
    proPct,
    partnerPct,
    exclusivePct
  );
  const partnerHint = partnerStatusHint(data.tier, exclusivePct);

  const tierBorder =
    tier === "exclusive"
      ? "border-rose-500/40 bg-rose-500/10"
      : tier === "partner"
        ? "border-yellow-500/40 bg-yellow-500/10"
        : tier === "pro"
          ? "border-amber-500/40 bg-amber-500/10"
          : tier === "plus"
            ? "border-emerald-500/40 bg-emerald-500/10"
            : "border-white/10 bg-[#131626]";
  const tierText =
    tier === "exclusive"
      ? "text-rose-300"
      : tier === "partner"
        ? "text-yellow-300"
        : tier === "pro"
          ? "text-amber-300"
          : tier === "plus"
            ? "text-emerald-300"
            : "text-violet-300";

  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-black text-white">크리에이터</h1>
        <p className="mt-1 text-sm text-gray-300">
          내 캐릭터 이용 포인트 소비량의 <strong className="text-white">{rewardPct}%</strong>가
          크리에이터 포인트(CP)로 적립됩니다.{" "}
          <span className="text-gray-400">
            (기본 {basePct}% · 플러스 {plusPct}% · 프로 {proPct}% · 파트너 {partnerPct}%)
          </span>
        </p>
      </div>

      <div className="flex gap-1 rounded-xl border border-white/5 bg-[#0e1120] p-1">
        {(
          [
            ["dashboard", "대시보드"],
            ["comments", "댓글"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
              tab === id ? "bg-violet-600 text-white" : "text-gray-300 hover:text-gray-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "comments" ? (
        <section className="rounded-2xl border border-violet-500/25 bg-[#131626] p-5">
          <h2 className="text-sm font-bold text-violet-200">댓글 설정</h2>
          <p className="mt-1 text-xs text-gray-400">
            크리에이터 프로필과 내 캐릭터 페이지의 댓글 기본값입니다. OFF면 다른 사용자는 댓글을
            보거나 작성할 수 없습니다.
          </p>
          <div className="mt-4">
            <CommentsEnabledToggle
              scope="creator"
              initialEnabled={data.creatorCommentsEnabled}
              label="크리에이터 댓글 허용"
              description="OFF 시 내 프로필·캐릭터(개별 설정 ON이어도)에서 방문자에게 댓글이 숨겨집니다."
            />
          </div>
        </section>
      ) : (
        <>
      <section className={`rounded-2xl border p-4 ${tierBorder}`}>
        <p className="text-xs font-bold uppercase tracking-wider text-gray-400">적립 등급</p>
        <p className={`mt-0.5 text-lg font-black ${tierText}`}>
          {tierLabel} 크리에이터 · {rewardPct}%
          {data.tier.isExclusive && (
            <span className="ml-2 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-200">
              전속
            </span>
          )}
        </p>
        {partnerHint && (
          <p className="mt-2 text-[11px] leading-relaxed text-gray-400">{partnerHint}</p>
        )}
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold text-gray-300">등급업 조건</p>
          <ul className="space-y-2">
            {tierRows.map((row) => (
              <li
                key={row.key}
                className={`rounded-xl border px-3 py-2.5 ${
                  row.isCurrent
                    ? "border-white/20 bg-white/[0.06]"
                    : "border-white/[0.06] bg-[#0e1120]/60"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-white">
                    {row.label} · {row.ratePct}%
                  </span>
                  {row.isCurrent && (
                    <span className="rounded bg-violet-500/25 px-1.5 py-0.5 text-[10px] font-bold text-violet-200">
                      현재
                    </span>
                  )}
                  {row.met && !row.isCurrent && (
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      조건 충족
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{row.condition}</p>
                {row.current && (
                  <p className="mt-0.5 text-[11px] text-zinc-500">{row.current}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="보유 CP" value={`${fmt(data.creatorPoints)}CP`} accent="text-amber-300" />
        <StatCard label="누적 적립" value={`${fmt(data.totalReward)}CP`} accent="text-violet-300" />
        <StatCard
          label="캐릭터 이용 소비"
          value={`${fmt(data.totalSpentOnChars)}P`}
          accent="text-cyan-300"
        />
      </section>

      <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
        <h2 className="text-sm font-bold text-amber-200">CP → 유료 포인트 교환</h2>
        <p className="mt-1 text-xs text-gray-400">1CP = 1P (유료 포인트) · 동일 가치로 교환</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-gray-300">교환 CP</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={exchangeAmount}
              onChange={(e) => setExchangeAmount(e.target.value)}
              placeholder={`최대 ${fmt(data.creatorPoints)}`}
              className="w-full rounded-xl border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-amber-500"
            />
          </div>
          <button
            type="button"
            disabled={busy || data.creatorPoints <= 0}
            onClick={() => setExchangeAmount(String(data.creatorPoints))}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-40"
          >
            전액
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={exchange}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {busy ? "교환 중…" : "유료P 교환"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        {msg && <p className="mt-2 text-sm text-emerald-400">{msg}</p>}
      </section>

      <WithdrawalForm
        creatorPoints={data.creatorPoints}
        hasPendingWithdrawal={data.hasPendingWithdrawal}
        recentWithdrawals={data.recentWithdrawals}
        withdrawal={data.withdrawal}
        onSuccess={(message) => {
          setWithdrawMsg(message);
          router.refresh();
        }}
        onError={() => setWithdrawMsg("")}
        onRefresh={refresh}
      />
      {withdrawMsg && <p className="text-sm text-emerald-400">{withdrawMsg}</p>}

      <section className="rounded-2xl border border-violet-500/20 bg-[#131626] p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-violet-300">내 캐릭터 ({data.characters.length})</h2>
          <Link href="/studio" className="text-xs text-violet-400 hover:underline">
            + 새 캐릭터
          </Link>
        </div>
        {data.characters.length === 0 ? (
          <p className="text-sm text-gray-400">
            아직 제작한 캐릭터가 없습니다.{" "}
            <Link href="/studio" className="text-violet-400 hover:underline">
              캐릭터 제작하기
            </Link>
          </p>
        ) : (
          <ul className="space-y-2">
            {data.characters.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-xl border border-white/5 bg-[#0e1120] px-4 py-3"
              >
                <CharacterListAvatar
                  name={c.name}
                  emoji={c.emoji}
                  hue={c.hue}
                  assets={c.assets}
                  images={c.images}
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/character/${c.id}`}
                    className="font-semibold text-white hover:text-violet-300"
                  >
                    {c.name}
                  </Link>
                  <p className="text-[11px] text-gray-400">
                    💬 {(c.total_turns ?? 0).toLocaleString()}턴 · 👥 {c.chats_count}명 · ❤️ {c.likes} · 이용 {fmt(c.total_spent)}P · 적립{" "}
                    {fmt(c.total_reward)}CP
                  </p>
                </div>
                <Link
                  href={`/create?edit=${c.id}`}
                  className="shrink-0 rounded-lg border border-violet-500/40 px-3 py-1.5 text-xs font-bold text-violet-300 hover:bg-violet-500/10"
                >
                  수정
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-white/5 bg-[#131626] p-5">
        <h2 className="mb-3 text-sm font-bold text-gray-200">최근 적립 내역</h2>
        {data.recentEarnings.length === 0 ? (
          <p className="text-sm text-gray-400">아직 적립 내역이 없습니다.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {data.recentEarnings.map((e) => (
              <li
                key={e.id}
                className={`flex justify-between gap-2 rounded-lg px-2 py-1.5 ${
                  e.reversed ? "text-zinc-500 line-through" : "text-gray-200"
                }`}
              >
                <span className="truncate">
                  {e.character_name} · 소비 {fmt(e.points_spent)}P
                </span>
                <span className="shrink-0 font-semibold text-amber-300/90">
                  +{fmt(e.reward_amount)}CP
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.recentLogs.length > 0 && (
        <section className="rounded-2xl border border-white/5 bg-[#131626] p-5">
          <h2 className="mb-3 text-sm font-bold text-gray-200">CP 내역</h2>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-gray-300">
            {data.recentLogs.map((log, i) => (
              <li key={i} className="flex justify-between gap-2 px-2 py-1">
                <span className="truncate">{log.reason}</span>
                <span className={log.delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
                  {log.delta >= 0 ? "+" : ""}
                  {fmt(log.delta)}CP
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[#131626] p-4">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`mt-1 text-lg font-black ${accent}`}>{value}</p>
    </div>
  );
}
