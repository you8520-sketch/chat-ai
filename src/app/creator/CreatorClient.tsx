"use client";

import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent } from "react";
import WithdrawalForm from "@/components/WithdrawalForm";
import CommentsEnabledToggle from "@/components/CommentsEnabledToggle";
import CreatorNotificationPrefs from "@/components/CreatorNotificationPrefs";
import {
  CharacterEarningShareChart,
  CreatorSummary,
  RecentEarningsList,
  TierLadder,
  UnitLegend,
} from "@/components/creator/CreatorDashboardParts";
import { ExchangeCard, NextActions } from "@/components/creator/CreatorActionParts";
import { ScopedNotice, type PageNotice } from "@/components/studio/PersonaPageParts";
import {
  CREATOR_NOTICE_CONTENT_MAX,
  CREATOR_NOTICE_TITLE_MAX,
  CREATOR_REWARD_RATE,
  CREATOR_REWARD_RATE_PRO,
  CREATOR_REWARD_RATE_SPROUT,
  type CreatorDashboard,
  type CreatorEarningPeriod,
} from "@/lib/creatorShared";
import { allTierConditions, creatorNextActions, type CreatorNextAction } from "@/lib/creatorDashboardView";
import { formatPoints } from "@/lib/billingDisplay";
import { CREATOR_PROFILE_HTML_MAX, sanitizeCreatorHtml } from "@/lib/creatorProfileHtml";
import StudioButton from "@/components/studio/StudioButton";
import { cn, studioInputClass, studioSurface, studioType } from "@/lib/studioDesign";

const fmt = formatPoints;

type TabId = "dashboard" | "profile" | "comments";
const TABS: ReadonlyArray<readonly [TabId, string]> = [
  ["dashboard", "대시보드"],
  ["profile", "소개/공지"],
  ["comments", "댓글·알림"],
];

const JUMP_LINKS = [
  ["creator-exchange", "교환"],
  ["creator-withdraw", "출금"],
  ["creator-share", "캐릭터별 비중"],
  ["creator-earnings", "적립 내역"],
] as const;

const tabDomId = (id: TabId) => `creator-tab-${id}`;
const panelDomId = (id: TabId) => `creator-panel-${id}`;

export default function CreatorClient({
  initial,
  creatorId,
}: {
  initial: CreatorDashboard;
  creatorId: number;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<TabId>("dashboard");
  const [earningPeriod, setEarningPeriod] = useState<CreatorEarningPeriod>("week");
  const [selectedEarningCharacterId, setSelectedEarningCharacterId] = useState<number | null>(null);
  const [profileHtml, setProfileHtml] = useState(initial.creatorProfileHtml);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeContent, setNoticeContent] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [noticeSaving, setNoticeSaving] = useState(false);
  const [exchangeAmount, setExchangeAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [exchangeNotice, setExchangeNotice] = useState<PageNotice | null>(null);
  const [profileNotice, setProfileNotice] = useState<PageNotice | null>(null);
  const [noticeBoardNotice, setNoticeBoardNotice] = useState<PageNotice | null>(null);
  const [withdrawMsg, setWithdrawMsg] = useState("");

  async function refresh() {
    try {
      const res = await fetch("/api/creator");
      const json = await res.json();
      if (res.ok) setData(json.dashboard);
    } catch {
      // 새로고침 실패는 화면의 기존 값을 유지한다.
    }
  }

  async function saveProfileContent() {
    if (profileHtml.length > CREATOR_PROFILE_HTML_MAX) {
      setProfileNotice({
        kind: "error",
        text: `크리에이터 소개는 ${CREATOR_PROFILE_HTML_MAX.toLocaleString()}자 이하여야 합니다.`,
      });
      return;
    }
    setProfileSaving(true);
    setProfileNotice(null);
    try {
      const res = await fetch("/api/creator", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator_profile_html: profileHtml,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setProfileNotice({ kind: "error", text: json.error || "소개/공지 저장에 실패했습니다." });
        return;
      }
      setProfileHtml(json.creator_profile_html ?? "");
      setProfileNotice({ kind: "ok", text: "크리에이터 소개를 저장했습니다." });
      await refresh();
      router.refresh();
    } catch {
      setProfileNotice({ kind: "error", text: "네트워크 오류로 저장하지 못했어요. 입력한 내용은 그대로 두었습니다." });
    } finally {
      setProfileSaving(false);
    }
  }

  async function createNotice() {
    setNoticeSaving(true);
    setNoticeBoardNotice(null);
    try {
      const res = await fetch("/api/creator/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: noticeTitle, content: noticeContent }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNoticeBoardNotice({ kind: "error", text: json.error || "공지 저장에 실패했습니다." });
        return;
      }
      setNoticeTitle("");
      setNoticeContent("");
      setNoticeBoardNotice({ kind: "ok", text: "공지를 등록했습니다." });
      await refresh();
      router.refresh();
    } catch {
      setNoticeBoardNotice({ kind: "error", text: "네트워크 오류로 공지를 등록하지 못했어요. 입력한 내용은 그대로 두었습니다." });
    } finally {
      setNoticeSaving(false);
    }
  }

  async function deleteNotice(id: number) {
    if (!confirm("이 공지를 삭제할까요?")) return;
    setNoticeBoardNotice(null);
    try {
      const res = await fetch("/api/creator/notices", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNoticeBoardNotice({ kind: "error", text: json.error || "공지 삭제에 실패했습니다." });
        return;
      }
      setNoticeBoardNotice({ kind: "ok", text: "공지를 삭제했습니다." });
      await refresh();
      router.refresh();
    } catch {
      setNoticeBoardNotice({ kind: "error", text: "네트워크 오류로 공지를 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요." });
    }
  }

  async function exchange() {
    const amount = Number(exchangeAmount);
    if (!amount || amount <= 0) {
      setExchangeNotice({ kind: "error", text: "교환할 CP를 입력하세요." });
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
    setExchangeNotice(null);
    try {
      const res = await fetch("/api/creator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const json = await res.json();
      if (!res.ok) {
        setExchangeNotice({ kind: "error", text: json.error || "교환에 실패했습니다." });
        return;
      }
      setExchangeNotice({ kind: "ok", text: `유료 포인트 ${fmt(json.exchanged)}P가 지급되었습니다.` });
      setExchangeAmount("");
      await refresh();
      router.refresh();
    } catch {
      setExchangeNotice({
        kind: "error",
        text: "네트워크 오류로 교환 결과를 확인하지 못했어요. 입력한 값은 그대로 두었습니다. 보유 CP를 확인한 뒤 다시 시도해 주세요.",
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function jumpTo(id: string) {
    const el = document.getElementById(id);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  function goTo(target: NonNullable<CreatorNextAction["target"]>) {
    if (target === "profile") {
      setTab("profile");
      return;
    }
    jumpTo(target === "exchange" ? "creator-exchange" : "creator-withdraw");
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const [id] = TABS[next];
    setTab(id);
    document.getElementById(tabDomId(id))?.focus();
  }

  const sproutPct = Math.round(CREATOR_REWARD_RATE_SPROUT * 100);
  const basePct = Math.round(CREATOR_REWARD_RATE * 100);
  const proPct = Math.round(CREATOR_REWARD_RATE_PRO * 100);
  const tierRows = allTierConditions(data.tier, sproutPct, basePct, proPct);
  const nextActions = creatorNextActions(data);
  const profilePreviewHtml = sanitizeCreatorHtml(profileHtml);
  const profileDirty = profileHtml !== data.creatorProfileHtml;
  const belowThreshold = data.tier.rewardRate <= 0;

  const summary = (
    <CreatorSummary
      tier={data.tier}
      creatorPoints={data.creatorPoints}
      totalReward={data.totalReward}
      totalSpentOnChars={data.totalSpentOnChars}
    >
      <UnitLegend className="mt-3 border-t border-white/10 pt-3" />
    </CreatorSummary>
  );
  const ladder = <TierLadder rows={tierRows} />;
  const nextCard = <NextActions actions={nextActions} onTarget={goTo} />;
  const exchangeCard = (
    <ExchangeCard
      creatorPoints={data.creatorPoints}
      amount={exchangeAmount}
      busy={busy}
      notice={exchangeNotice}
      onAmountChange={setExchangeAmount}
      onFillAll={() => setExchangeAmount(String(data.creatorPoints))}
      onSubmit={exchange}
    />
  );
  const withdrawCard = (
    <div className="space-y-3">
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
      <ScopedNotice notice={withdrawMsg ? { kind: "ok", text: withdrawMsg } : null} />
    </div>
  );
  const shareChart = (
    <div id="creator-share" className="scroll-mt-32">
      <CharacterEarningShareChart
        rows={data.characterEarningShares[earningPeriod]}
        period={earningPeriod}
        selectedId={selectedEarningCharacterId}
        onPeriodChange={(nextPeriod) => {
          setEarningPeriod(nextPeriod);
          setSelectedEarningCharacterId(null);
        }}
        onSelect={setSelectedEarningCharacterId}
      />
    </div>
  );
  const earningsList = (
    <div id="creator-earnings" className="scroll-mt-32">
      <RecentEarningsList rows={data.recentEarnings} />
    </div>
  );

  return (
    <div className="mx-auto mt-6 max-w-6xl space-y-5">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className={cn(studioType.heading, "text-xl")}>크리에이터</h1>
            <p className={cn(studioType.body, "mt-1")}>
              내 캐릭터 수익과 CP를 확인하고 교환·출금해요.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StudioButton href={`/creator/${creatorId}`} variant="secondary" size="sm">
              내 제작자 페이지
            </StudioButton>
            <StudioButton href="/studio" variant="secondary" size="sm">
              제작 스튜디오
            </StudioButton>
          </div>
        </div>
      </header>

      <div role="tablist" aria-label="크리에이터 메뉴" className={studioSurface.tabList}>
        {TABS.map(([id, label], index) => (
          <button
            key={id}
            id={tabDomId(id)}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={panelDomId(id)}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(e) => onTabKeyDown(e, index)}
            className={cn(
              "min-h-11 flex-1 rounded-lg px-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
              tab === id ? studioSurface.tabActive : studioSurface.tabIdle,
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <div
          role="tabpanel"
          id={panelDomId("profile")}
          aria-labelledby={tabDomId("profile")}
          className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0"
        >
          <section className={cn(studioSurface.card, "p-4 sm:p-5")}>
            <h2 className={studioType.sectionTitle}>크리에이터 소개</h2>
            <p className={cn(studioType.caption, "mt-1")}>
              소개는 내 제작자 페이지 상단에 노출돼요. HTML을 쓸 수 있고, 안전하지 않은 태그는 저장 시 제거돼요.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="creator-profile-html" className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-zinc-300">소개 내용</span>
                  <span className="text-xs text-zinc-400">HTML 사용 가능</span>
                </label>
                <textarea
                  id="creator-profile-html"
                  className={cn(studioInputClass, "mt-2 min-h-48 font-mono text-xs")}
                  value={profileHtml}
                  maxLength={CREATOR_PROFILE_HTML_MAX}
                  onChange={(e) => setProfileHtml(e.target.value.slice(0, CREATOR_PROFILE_HTML_MAX))}
                  placeholder="<h2>안녕하세요!</h2><p>제 캐릭터 세계관과 제작 방향을 소개해보세요.</p>"
                />
                <p className={cn(studioType.counter, "mt-1 text-right")}>
                  {profileHtml.length.toLocaleString()} / {CREATOR_PROFILE_HTML_MAX.toLocaleString()}자
                </p>
              </div>

              <div className="rounded-xl border border-white/[0.08] bg-[#090b14]/70 p-4">
                <p className="text-sm font-semibold text-zinc-300">미리보기</p>
                <div className="mt-3 rounded-xl border border-violet-400/15 bg-violet-500/[0.06] p-4">
                  <p className="mb-2 text-sm font-semibold text-violet-200">소개</p>
                  {profilePreviewHtml ? (
                    <div
                      className="creator-comment-html text-sm leading-6 text-zinc-200"
                      dangerouslySetInnerHTML={{ __html: profilePreviewHtml }}
                    />
                  ) : (
                    <p className={studioType.caption}>소개가 비어 있습니다.</p>
                  )}
                </div>
              </div>
            </div>
            <div
              data-testid="creator-profile-save-bar"
              className="sticky bottom-[calc(var(--mobile-nav-offset,0px)+var(--keyboard-inset,0px))] z-10 -mx-4 mt-4 space-y-2 border-t border-white/10 bg-[#0b0d14]/95 px-4 py-3 backdrop-blur-md sm:-mx-5 sm:px-5"
            >
              <ScopedNotice notice={profileNotice} />
              <div className="flex flex-wrap items-center gap-3">
                <StudioButton type="button" onClick={saveProfileContent} disabled={profileSaving || !profileDirty}>
                  {profileSaving ? "저장 중…" : "저장"}
                </StudioButton>
                <span className={studioType.caption}>
                  {profileDirty ? "저장하지 않은 변경사항이 있어요." : "변경사항이 없어요."}
                </span>
              </div>
            </div>
          </section>

          <section className={cn(studioSurface.card, "p-4 sm:p-5")}>
            <h2 className={studioType.sectionTitle}>공지 게시판</h2>
            <p className={cn(studioType.caption, "mt-1")}>
              제목과 본문으로 공지를 등록하면 제작자 페이지의 공지 게시판에 노출돼요. 이 칸은 HTML 입력칸이 아니에요.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="creator-notice-title" className={studioType.label}>
                  제목
                </label>
                <input
                  id="creator-notice-title"
                  className={studioInputClass}
                  maxLength={CREATOR_NOTICE_TITLE_MAX}
                  value={noticeTitle}
                  onChange={(e) => setNoticeTitle(e.target.value.slice(0, CREATOR_NOTICE_TITLE_MAX))}
                  placeholder="공지 제목"
                />
              </div>
              <div>
                <label htmlFor="creator-notice-content" className={studioType.label}>
                  내용
                </label>
                <textarea
                  id="creator-notice-content"
                  className={cn(studioInputClass, "min-h-32")}
                  maxLength={CREATOR_NOTICE_CONTENT_MAX}
                  value={noticeContent}
                  onChange={(e) => setNoticeContent(e.target.value.slice(0, CREATOR_NOTICE_CONTENT_MAX))}
                  placeholder="업데이트 일정, 캐릭터 공개 안내 등을 적어주세요."
                />
                <p className={cn(studioType.counter, "mt-1 text-right")}>
                  {noticeContent.length.toLocaleString()} / {CREATOR_NOTICE_CONTENT_MAX.toLocaleString()}자
                </p>
              </div>
              <StudioButton type="button" onClick={createNotice} disabled={noticeSaving}>
                {noticeSaving ? "등록 중…" : "공지 등록"}
              </StudioButton>
              <ScopedNotice notice={noticeBoardNotice} />
            </div>

            <h3 className="mt-6 text-sm font-semibold text-zinc-200">
              등록된 공지 <span className="text-zinc-400">{data.creatorNotices.length}개</span>
            </h3>
            <ul className="mt-2 space-y-2">
              {data.creatorNotices.length === 0 ? (
                <li className={studioType.caption}>등록된 공지가 없습니다.</li>
              ) : (
                data.creatorNotices.map((notice) => (
                  <li
                    key={notice.id}
                    className="rounded-xl border border-white/[0.08] bg-[#0e1120]/70 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-keep text-sm font-semibold text-zinc-100 [overflow-wrap:anywhere]">
                          {notice.title}
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-400">{notice.created_at.slice(0, 16)}</p>
                      </div>
                      <StudioButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={`공지 삭제: ${notice.title}`}
                        onClick={() => deleteNotice(notice.id)}
                        className="shrink-0 text-rose-200"
                      >
                        삭제
                      </StudioButton>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]">
                      {notice.content}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </section>
        </div>
      ) : tab === "comments" ? (
        <div
          role="tabpanel"
          id={panelDomId("comments")}
          aria-labelledby={tabDomId("comments")}
          className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0"
        >
          <section className={cn(studioSurface.card, "p-4 sm:p-5")}>
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
          <section className={cn(studioSurface.card, "p-4 sm:p-5")}>
            <h2 className={studioType.sectionTitle}>알림 받기</h2>
            <p className={cn(studioType.caption, "mt-1")}>
              좋아요·댓글이 달렸을 때 알림함으로 받을지 선택합니다. OFF해도 좋아요·댓글 기능 자체는
              유지됩니다. 앱 푸시로 받을지는 설정에서 따로 켤 수 있고, 기본은 꺼져 있습니다.
            </p>
            <div className="mt-4">
              <CreatorNotificationPrefs
                initialNotifyLikes={data.notifyCharacterLikes}
                initialNotifyComments={data.notifyProfileComments}
              />
            </div>
          </section>
        </div>
      ) : (
        <div
          role="tabpanel"
          id={panelDomId("dashboard")}
          aria-labelledby={tabDomId("dashboard")}
          className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start"
        >
          <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-start-1">
            {summary}
            {nextCard}
            <nav aria-label="대시보드 바로가기" className="grid grid-cols-2 gap-2 lg:hidden">
              {JUMP_LINKS.map(([id, label]) => (
                <StudioButton key={id} type="button" variant="secondary" size="sm" onClick={() => jumpTo(id)}>
                  {label}
                </StudioButton>
              ))}
            </nav>
          </div>
          <div
            className={cn(
              "min-w-0",
              belowThreshold ? "order-2" : "order-4",
              "lg:order-none lg:col-start-2 lg:row-start-1",
            )}
          >
            {ladder}
          </div>
          <div className="order-3 min-w-0 space-y-5 lg:col-span-2 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:space-y-0">
            <div className="min-w-0 space-y-5">
              {shareChart}
              {earningsList}
            </div>
            <div className="min-w-0 space-y-5">
              {exchangeCard}
              {withdrawCard}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
