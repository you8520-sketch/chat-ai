"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import WithdrawalForm from "@/components/WithdrawalForm";
import CommentsEnabledToggle from "@/components/CommentsEnabledToggle";
import {
  CREATOR_PARTNER_MIN_CHARACTERS,
  CREATOR_PLUS_MIN_CHARACTERS,
  CREATOR_PLUS_MIN_TOTAL_CHATS,
  CREATOR_PRO_MIN_CHARACTERS,
  CREATOR_PRO_MIN_MONTHLY_SPENT,
  CREATOR_PRO_MIN_TOTAL_CHATS,
  CREATOR_REWARD_RATE,
  CREATOR_REWARD_RATE_PARTNER,
  CREATOR_REWARD_RATE_PLUS,
  CREATOR_REWARD_RATE_PRO,
  CREATOR_STANDARD_MIN_CHARACTERS,
  CREATOR_TIER_LABELS,
  type CreatorDashboard,
} from "@/lib/creatorShared";
import { formatPoints } from "@/lib/billingDisplay";
import { sanitizeCreatorHtml } from "@/lib/creatorProfileHtml";
import { getCharacterRepresentativeImageUrl } from "@/lib/characterAssets";
import StudioButton from "@/components/studio/StudioButton";
import { cn, studioInputClass, studioSurface, studioType } from "@/lib/studioDesign";

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

function partnerStatusHint(t: CreatorDashboard["tier"]): string | null {
  if (t.tierLevel !== "partner" && t.tierLevel !== "exclusive") return null;
  const term = t.partnerTerm;
  if (term?.active && term.validUntil) {
    return `파트너 등급 유지 중 · ${term.validUntil.slice(0, 10)}까지`;
  }
  return null;
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
  partnerPct: number
): TierConditionRow[] {
  const plusMet =
    t.characterCount >= CREATOR_PLUS_MIN_CHARACTERS &&
    t.totalChats >= CREATOR_PLUS_MIN_TOTAL_CHATS;
  const proMet =
    t.publicCharacterCount >= CREATOR_PRO_MIN_CHARACTERS &&
    t.monthlySpentOnChars >= CREATOR_PRO_MIN_MONTHLY_SPENT;
  const isPartnerOrAbove = t.tierLevel === "partner" || t.tierLevel === "exclusive";

  return [
    {
      key: "standard",
      label: "일반 크리에이터",
      ratePct: basePct,
      condition: `캐릭터 ${CREATOR_STANDARD_MIN_CHARACTERS}개 제작`,
      current: `현재 ${t.characterCount}개`,
      met: t.characterCount >= CREATOR_STANDARD_MIN_CHARACTERS,
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
      condition: `캐릭터 ${CREATOR_PRO_MIN_CHARACTERS}개+ & 통합 대화 ${CREATOR_PRO_MIN_TOTAL_CHATS.toLocaleString()}회+ 기타 조건 만족 시 자동 승급`,
      current: `현재 ${t.characterCount}개 · ${t.totalChats.toLocaleString()}회`,
      met: proMet,
      isCurrent: t.tierLevel === "pro",
    },
    {
      key: "partner",
      label: "파트너",
      ratePct: partnerPct,
      condition: `공개 캐릭터 ${CREATOR_PARTNER_MIN_CHARACTERS}개+ · 기타 조건 만족 시 자동 승급`,
      current: `현재 공개 ${t.publicCharacterCount}개`,
      met: isPartnerOrAbove || t.publicCharacterCount >= CREATOR_PARTNER_MIN_CHARACTERS,
      isCurrent: isPartnerOrAbove,
    },
  ];
}

export default function CreatorClient({ initial }: { initial: CreatorDashboard }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"dashboard" | "profile" | "comments">("dashboard");
  const [profileHtml, setProfileHtml] = useState(initial.creatorProfileHtml);
  const [noticeHtml, setNoticeHtml] = useState(initial.creatorNoticeHtml);
  const [profileSaving, setProfileSaving] = useState(false);
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

  async function saveProfileContent() {
    setProfileSaving(true);
    setError("");
    setMsg("");
    const res = await fetch("/api/creator", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creator_profile_html: profileHtml,
        creator_notice_html: noticeHtml,
      }),
    });
    setProfileSaving(false);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "소개/공지 저장에 실패했습니다.");
      return;
    }
    setProfileHtml(json.creator_profile_html ?? "");
    setNoticeHtml(json.creator_notice_html ?? "");
    setMsg("크리에이터 소개와 공지를 저장했습니다.");
    await refresh();
    router.refresh();
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
  const tier = data.tier.tierLevel;
  /** 전속은 UI에서 숨기고 파트너로 표시 (요율은 서버 값 유지) */
  const tierLabel =
    tier === "exclusive" ? CREATOR_TIER_LABELS.partner : CREATOR_TIER_LABELS[tier];
  const tierRows = allTierConditions(data.tier, basePct, plusPct, proPct, partnerPct);
  const partnerHint = partnerStatusHint(data.tier);
  const profilePreviewHtml = sanitizeCreatorHtml(profileHtml);
  const noticePreviewHtml = sanitizeCreatorHtml(noticeHtml);

  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-6">
      <div>
        <h1 className={cn(studioType.heading, "text-xl")}>크리에이터</h1>
        <p className={cn(studioType.body, "mt-1")}>
          내 캐릭터 이용 포인트 소비량의 <strong className="text-zinc-50">{rewardPct}%</strong>가
          크리에이터 포인트(CP)로 적립됩니다.{" "}
          <span className="text-zinc-400">
            (기본 {basePct}% · 플러스 {plusPct}% · 프로 {proPct}% · 파트너 {partnerPct}%)
          </span>
        </p>
      </div>

      <div className={studioSurface.tabList}>
        {(
          [
            ["dashboard", "대시보드"],
            ["profile", "소개/공지"],
            ["comments", "댓글"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 rounded-lg py-2 text-sm font-semibold transition",
              tab === id ? studioSurface.tabActive : studioSurface.tabIdle,
            )}
          >
            {label}
          </button>
        ))}
      </div>


      {tab === "profile" ? (
        <section className={cn(studioSurface.card, "p-5")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className={studioType.sectionTitle}>크리에이터 소개 · 공지</h2>
              <p className={cn(studioType.caption, "mt-1")}>
                제작자 페이지에 노출되는 소개와 공지입니다. HTML 태그를 사용할 수 있습니다.
              </p>
            </div>
            <StudioButton type="button" onClick={saveProfileContent} disabled={profileSaving}>
              {profileSaving ? "저장 중..." : "저장"}
            </StudioButton>
          </div>

          <div className="mt-5 space-y-5">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">소개 HTML</span>
              <textarea
                className={cn(studioInputClass, "mt-2 min-h-48 font-mono text-xs")}
                value={profileHtml}
                onChange={(e) => setProfileHtml(e.target.value)}
                placeholder="<h2>안녕하세요!</h2><p>제 캐릭터 세계관과 제작 방향을 소개해보세요.</p>"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-zinc-300">공지 HTML</span>
              <textarea
                className={cn(studioInputClass, "mt-2 min-h-36 font-mono text-xs")}
                value={noticeHtml}
                onChange={(e) => setNoticeHtml(e.target.value)}
                placeholder="<p><strong>업데이트 안내</strong> 새 캐릭터 공개 일정이나 이용 안내를 적어주세요.</p>"
              />
            </label>

            <div className="rounded-2xl border border-white/[0.08] bg-[#090b14]/70 p-4">
              <p className="text-xs font-semibold text-zinc-400">미리보기</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-violet-400/15 bg-violet-500/[0.06] p-4">
                  <p className="mb-2 text-xs font-bold text-violet-200">소개</p>
                  {profilePreviewHtml ? (
                    <div
                      className="creator-comment-html text-sm leading-6 text-zinc-200"
                      dangerouslySetInnerHTML={{ __html: profilePreviewHtml }}
                    />
                  ) : (
                    <p className={studioType.caption}>소개가 비어 있습니다.</p>
                  )}
                </div>
                <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-4">
                  <p className="mb-2 text-xs font-bold text-amber-100">공지</p>
                  {noticePreviewHtml ? (
                    <div
                      className="creator-comment-html text-sm leading-6 text-zinc-200"
                      dangerouslySetInnerHTML={{ __html: noticePreviewHtml }}
                    />
                  ) : (
                    <p className={studioType.caption}>공지사항이 비어 있습니다.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : tab === "comments" ? (
        <section className={cn(studioSurface.card, "p-5")}>
          <h2 className={studioType.sectionTitle}>댓글 설정</h2>
          <p className={cn(studioType.caption, "mt-1")}>
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
      <section className={cn(studioSurface.card, "p-4")}>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">적립 등급</p>
        <p className="mt-0.5 text-lg font-semibold text-zinc-50">
          {tierLabel} 크리에이터 · <span className="text-violet-300">{rewardPct}%</span>
        </p>
        {partnerHint && (
          <p className={cn(studioType.caption, "mt-2")}>{partnerHint}</p>
        )}
        <div className="mt-4 space-y-2">
          <p className="text-[11px] font-semibold text-zinc-300">등급업 조건</p>
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
                  <span className="text-sm font-semibold text-zinc-50">
                    {row.label} · {row.ratePct}%
                  </span>
                  {row.isCurrent && (
                    <span className="rounded bg-violet-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                      현재
                    </span>
                  )}
                  {row.met && !row.isCurrent && (
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                      조건 충족
                    </span>
                  )}
                </div>
                <p className={cn(studioType.caption, "mt-1")}>{row.condition}</p>
                {row.current && (
                  <p className="mt-0.5 text-[11px] text-zinc-500">{row.current}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="보유 CP" value={`${fmt(data.creatorPoints)}CP`} />
        <StatCard label="누적 적립" value={`${fmt(data.totalReward)}CP`} />
        <StatCard label="캐릭터 이용 소비" value={`${fmt(data.totalSpentOnChars)}P`} />
      </section>

      <section className={cn(studioSurface.card, "p-5")}>
        <h2 className={studioType.sectionTitle}>CP → 유료 포인트 교환</h2>
        <p className={cn(studioType.caption, "mt-1")}>1CP = 1P (유료 포인트) · 동일 가치로 교환</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[140px] flex-1">
            <label className={studioType.label}>교환 CP</label>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={exchangeAmount}
              onChange={(e) => setExchangeAmount(e.target.value)}
              placeholder={`최대 ${fmt(data.creatorPoints)}`}
              className={studioInputClass}
            />
          </div>
          <StudioButton
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || data.creatorPoints <= 0}
            onClick={() => setExchangeAmount(String(data.creatorPoints))}
          >
            전액
          </StudioButton>
          <StudioButton type="button" disabled={busy} onClick={exchange}>
            {busy ? "교환 중…" : "유료P 교환"}
          </StudioButton>
        </div>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
        {msg && <p className="mt-2 text-sm text-violet-300">{msg}</p>}
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
      {withdrawMsg && <p className="text-sm text-violet-300">{withdrawMsg}</p>}

      <section className={cn(studioSurface.card, "p-5")}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className={studioType.sectionTitle}>내 캐릭터 ({data.characters.length})</h2>
          <Link href="/studio" className="text-xs text-violet-400 hover:underline">
            + 새 캐릭터
          </Link>
        </div>
        {data.characters.length === 0 ? (
          <p className={studioType.body}>
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
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0e1120] px-4 py-3"
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
                  <p className="text-[11px] text-zinc-400">
                    💬 {(c.total_turns ?? 0).toLocaleString()}턴 · 👥 {c.chats_count}명 · ❤️ {c.likes} · 이용 {fmt(c.total_spent)}P · 적립{" "}
                    {fmt(c.total_reward)}CP
                  </p>
                </div>
                <Link
                  href={`/create?edit=${c.id}`}
                  className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-500/10"
                >
                  수정
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(studioSurface.card, "p-5")}>
        <h2 className={cn(studioType.sectionTitle, "mb-3")}>최근 적립 내역</h2>
        {data.recentEarnings.length === 0 ? (
          <p className={studioType.body}>아직 적립 내역이 없습니다.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {data.recentEarnings.map((e) => (
              <li
                key={e.id}
                className={`flex justify-between gap-2 rounded-lg px-2 py-1.5 ${
                  e.reversed ? "text-zinc-500 line-through" : "text-zinc-200"
                }`}
              >
                <span className="truncate">
                  {e.character_name} · 소비 {fmt(e.points_spent)}P
                </span>
                <span className="shrink-0 font-semibold text-violet-300">
                  +{fmt(e.reward_amount)}CP
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.recentLogs.length > 0 && (
        <section className={cn(studioSurface.card, "p-5")}>
          <h2 className={cn(studioType.sectionTitle, "mb-3")}>CP 내역</h2>
          <ul className="max-h-48 space-y-1 overflow-y-auto text-xs text-zinc-300">
            {data.recentLogs.map((log, i) => (
              <li key={i} className="flex justify-between gap-2 px-2 py-1">
                <span className="truncate">{log.reason}</span>
                <span className={log.delta >= 0 ? "text-violet-300" : "text-rose-400"}>
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn(studioSurface.card, "p-4")}>
      <p className="text-[11px] text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-50">{value}</p>
    </div>
  );
}
