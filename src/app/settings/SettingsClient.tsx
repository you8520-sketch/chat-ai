"use client";

import { useId, useState, type ReactNode } from "react";
import { TasteFilterButtonRow, type TastePref } from "@/components/UserPreferenceControls";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import PointsBalanceTooltip from "@/components/PointsBalanceTooltip";
import PushNotificationManager from "@/components/PushNotificationManager";
import { AppPageShell } from "@/components/AppPageShell";
import { cn, studioInputClass, studioSurface, studioType } from "@/lib/studioDesign";
import { ADMIN_LINK_GROUPS, adminLinkLabel, safetyFilterView } from "@/lib/settingsView";

type Props = {
  user: {
    email: string;
    nickname: string;
    isAdult: boolean;
    canDisableSafetyFilter?: boolean;
    nsfwOn: boolean;
    pref: "female" | "male" | null;
    google: boolean;
    points: number;
    paidPoints: number;
    freePoints: number;
    isAdmin?: boolean;
    isCreator?: boolean;
  };
  pendingCommentReviews?: number;
};

type NoticeScope = "nickname" | "pref" | "safety";
type Notice = { scope: NoticeScope; kind: "ok" | "error"; text: string };

const SETTINGS_ACTION_LINK_CLASS =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-[#11131a] px-4 py-2.5 text-center text-sm font-semibold text-zinc-100 transition hover:border-violet-400/30 hover:bg-[#181b24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70";

const SHORTCUT_LINK_CLASS =
  "group flex min-h-14 items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#11131a] px-4 py-3 transition hover:border-violet-400/30 hover:bg-[#181b24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70";

function GroupHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3 px-1">
      <h2 className="break-keep text-[13px] font-semibold uppercase tracking-wide text-violet-300">
        {title}
      </h2>
      {description ? <p className={cn(studioType.helper, "mt-0.5")}>{description}</p> : null}
    </div>
  );
}

function InlineNotice({ notice, scope }: { notice: Notice | null; scope: NoticeScope }) {
  if (!notice || notice.scope !== scope) return null;
  const error = notice.kind === "error";
  return (
    <p
      role={error ? "alert" : "status"}
      className={cn(
        "mt-3 rounded-xl border px-3 py-2.5 text-sm leading-relaxed",
        error
          ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
          : "border-violet-400/30 bg-violet-500/10 text-violet-100",
      )}
    >
      {notice.text}
    </p>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-t border-white/[0.06] py-2 first:border-t-0">
      <dt className="shrink-0 text-sm text-zinc-400">{label}</dt>
      <dd className="min-w-0 break-all text-right text-sm text-zinc-100">{children}</dd>
    </div>
  );
}

export default function SettingsClient({ user, pendingCommentReviews = 0 }: Props) {
  const router = useRouter();
  const nicknameId = useId();
  const nicknameHintId = useId();
  const [nickname, setNickname] = useState(user.nickname);
  const [pref, setPref] = useState(user.pref);
  const [nsfwOn, setNsfwOn] = useState(user.nsfwOn);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<NoticeScope | null>(null);
  const busy = pending !== null;

  async function patch(body: object, success: string, scope: NoticeScope) {
    setPending(scope);
    setNotice(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice({
          scope,
          kind: "error",
          text: data.error || "잠시 후 다시 시도해 주세요.",
        });
        return false;
      }
      setNotice({ scope, kind: "ok", text: success });
      router.refresh();
      return true;
    } catch {
      setNotice({ scope, kind: "error", text: "네트워크 연결을 확인하고 다시 시도해 주세요." });
      return false;
    } finally {
      setPending(null);
    }
  }

  const nicknameChanged = nickname.trim() !== user.nickname;
  const safety = safetyFilterView({
    nsfwOn,
    isAdult: user.isAdult,
    canDisableSafetyFilter: !!user.canDisableSafetyFilter,
  });
  const safetyOn = safety.filterOn;

  const navItems = [
    { id: "settings-account", label: "계정" },
    { id: "settings-prefs", label: "내 설정" },
    { id: "settings-notifications", label: "알림" },
    { id: "settings-shortcuts", label: "바로가기" },
    ...(user.isAdmin ? [{ id: "settings-admin", label: "관리자" }] : []),
  ];
  const adminLinkCount = ADMIN_LINK_GROUPS.reduce((sum, group) => sum + group.links.length, 0);
  const initial = (user.nickname.trim()[0] || "?").toUpperCase();

  return (
    <AppPageShell
      title="내 정보 · 설정"
      description="계정 정보와 취향·안전 설정을 한곳에서 관리합니다."
      className="mx-auto mt-4 max-w-2xl lg:mx-0 lg:max-w-5xl"
    >
      <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="설정 바로 이동" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:mb-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
            {navItems.map((item) => (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-white/10 bg-[#131626] px-4 text-sm font-medium text-zinc-200 transition hover:border-violet-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 lg:w-full lg:rounded-xl lg:border-transparent lg:bg-transparent lg:px-3 lg:text-zinc-400 lg:hover:bg-white/[0.04]"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-8 lg:max-w-2xl">
          <section id="settings-account" aria-labelledby="settings-account-title" className="scroll-mt-28 lg:scroll-mt-20">
            <GroupHeading title="계정" description="로그인 정보와 보유 포인트를 확인합니다." />
            <div className={cn(studioSurface.card, "p-4 sm:p-5")}>
              <div className="flex items-center gap-4">
                <span
                  aria-hidden="true"
                  className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xl font-bold text-violet-100"
                >
                  {initial}
                </span>
                <div className="min-w-0">
                  <h2 id="settings-account-title" className="break-all text-xl font-bold leading-snug text-zinc-50">
                    {user.nickname}
                  </h2>
                  <p className="break-all text-sm text-zinc-400">{user.email}</p>
                </div>
              </div>
              <dl className="mt-4">
                <InfoRow label="로그인 방식">
                  {user.google ? "Google 간편 로그인" : "이메일 / 비밀번호"}
                </InfoRow>
                <InfoRow label="성인인증">
                  {user.isAdult ? (
                    <span className="font-medium text-emerald-300">인증 완료</span>
                  ) : (
                    <Link
                      href="/verify"
                      className="inline-flex min-h-11 items-center font-medium text-violet-300 underline-offset-2 hover:underline"
                    >
                      미완료 — 인증하기
                    </Link>
                  )}
                </InfoRow>
                <InfoRow label="보유 포인트">
                  <PointsBalanceTooltip
                    total={user.points}
                    paid={user.paidPoints}
                    free={user.freePoints}
                  >
                    <Link
                      href="/points"
                      className="inline-flex min-h-11 items-center text-base font-bold text-violet-300 hover:underline"
                    >
                      {user.points.toLocaleString()}P
                    </Link>
                  </PointsBalanceTooltip>
                </InfoRow>
              </dl>
              <div className="mt-2 border-t border-white/[0.06] pt-3">
                <LogoutButton className="inline-flex min-h-11 items-center rounded-xl border border-white/10 px-4 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:text-zinc-50" />
              </div>
            </div>
          </section>

          <section id="settings-prefs" aria-labelledby="settings-prefs-title" className="scroll-mt-28 lg:scroll-mt-20">
            <GroupHeading
              title="내 설정"
              description="저장하면 홈·목록 화면에 바로 반영됩니다. 각 항목은 따로 저장돼요."
            />
            <h2 id="settings-prefs-title" className="sr-only">
              내 설정
            </h2>
            <div className="space-y-4">
              <form
                className={cn(studioSurface.card, "p-4 sm:p-5")}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy || !nickname.trim() || !nicknameChanged) return;
                  void patch({ nickname }, "닉네임이 변경되었습니다.", "nickname");
                }}
              >
                <p className={studioType.sectionTitle}>
                  <label htmlFor={nicknameId}>닉네임</label>
                </p>
                <p id={nicknameHintId} className={cn(studioType.helper, "mt-1")}>
                  채팅과 프로필에 표시되는 이름입니다. 최대 20자까지 입력할 수 있어요.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    id={nicknameId}
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    maxLength={20}
                    aria-describedby={nicknameHintId}
                    autoComplete="nickname"
                    className={cn(studioInputClass, "min-h-11 flex-1 py-2.5")}
                  />
                  <button
                    type="submit"
                    disabled={busy || !nickname.trim() || !nicknameChanged}
                    className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
                  >
                    {pending === "nickname" ? "저장 중…" : "저장"}
                  </button>
                </div>
                <p className={cn(studioType.counter, "mt-2 text-right")}>{nickname.length} / 20자</p>
                {!nicknameChanged ? (
                  <p className={cn(studioType.caption, "mt-1")}>
                    닉네임을 바꾸면 저장 버튼이 켜집니다.
                  </p>
                ) : null}
                <InlineNotice notice={notice} scope="nickname" />
              </form>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className={cn(studioSurface.card, "p-4 sm:p-5")}>
                  <h3 className={studioType.sectionTitle}>취향 필터</h3>
                  <p className={cn(studioType.helper, "mt-1")}>
                    홈과 목록에서 어떤 취향의 캐릭터를 볼지 선택합니다. 선택하면 바로 저장돼요.
                  </p>
                  <div className="mt-3">
                    <TasteFilterButtonRow
                      pref={pref}
                      busy={busy}
                      onSelect={async (value: TastePref) => {
                        setPref(value);
                        await patch({ pref: value }, "취향 설정이 변경되었습니다.", "pref");
                      }}
                    />
                  </div>
                  <InlineNotice notice={notice} scope="pref" />
                </div>

                <div className={cn(studioSurface.card, "p-4 sm:p-5")}>
                  <h3 className={studioType.sectionTitle}>세이프티 필터</h3>
                  <p id="settings-safety-help" className={cn(studioType.helper, "mt-1")}>
                    {safety.help}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-400">현재 상태</span>
                    <button
                      onClick={async () => {
                        if (!user.canDisableSafetyFilter) return;
                        const nextSafetyOn = nsfwOn;
                        setNsfwOn(!nextSafetyOn);
                        if (
                          !(await patch(
                            { nsfw_on: nextSafetyOn ? 0 : 1 },
                            nextSafetyOn
                              ? "세이프티 필터가 켜졌습니다."
                              : "세이프티 필터가 꺼졌습니다.",
                            "safety",
                          ))
                        ) {
                          setNsfwOn(nextSafetyOn);
                        }
                      }}
                      disabled={!user.canDisableSafetyFilter}
                      role="switch"
                      aria-checked={safetyOn}
                      aria-label="세이프티 필터"
                      aria-describedby="settings-safety-help"
                      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[#11131a] py-1 pl-2 pr-3 text-sm font-semibold text-zinc-100 transition hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 disabled:opacity-60"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "relative h-7 w-[52px] rounded-full transition-colors",
                          safetyOn ? "bg-violet-500" : "bg-zinc-700",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all",
                            safetyOn ? "left-[26px]" : "left-0.5",
                          )}
                        />
                      </span>
                      <span className="w-8 text-left">{safety.stateLabel}</span>
                    </button>
                  </div>
                  {safety.lockedNote ? (
                    <p className={cn(studioType.caption, "mt-2")}>{safety.lockedNote}</p>
                  ) : null}
                  <InlineNotice notice={notice} scope="safety" />
                </div>
              </div>
            </div>
          </section>

          <div id="settings-notifications" className="scroll-mt-28 lg:scroll-mt-20">
            <PushNotificationManager />
          </div>

          <section id="settings-shortcuts" aria-labelledby="settings-shortcuts-title" className="scroll-mt-28 lg:scroll-mt-20">
            <GroupHeading title="바로가기" description="자주 쓰는 화면으로 이동합니다." />
            <h2 id="settings-shortcuts-title" className="sr-only">
              바로가기
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Link href="/persona" className={SHORTCUT_LINK_CLASS}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-100">페르소나 · 유저노트</span>
                  <span className={cn(studioType.caption, "block")}>
                    채팅에서 내가 연기할 인물과 기억할 내용
                  </span>
                </span>
                <span aria-hidden="true" className="text-zinc-500 group-hover:text-violet-300">
                  ›
                </span>
              </Link>
              <Link href="/albums" className={SHORTCUT_LINK_CLASS}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-100">생성 이미지 앨범</span>
                  <span className={cn(studioType.caption, "block")}>채팅·TRPG 일러스트 보기</span>
                </span>
                <span aria-hidden="true" className="text-zinc-500 group-hover:text-violet-300">
                  ›
                </span>
              </Link>
              <Link href="/creator" className={SHORTCUT_LINK_CLASS}>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-100">크리에이터 페이지</span>
                  <span className={cn(studioType.caption, "block")}>
                    {user.isCreator ? "내 캐릭터와 수익 확인" : "수익·정산·등급 조건 확인"}
                  </span>
                </span>
                <span aria-hidden="true" className="text-zinc-500 group-hover:text-violet-300">
                  ›
                </span>
              </Link>
            </div>
            {!user.isCreator ? (
              <p className={cn(studioType.helper, "mt-2 px-1")}>
                캐릭터를 만들고 공개하면 수익·정산·등급 조건을 확인할 수 있습니다. 캐릭터 제작은 하단
                「제작」탭을 이용하세요.
              </p>
            ) : null}
          </section>

          {user.isAdmin && (
            <section id="settings-admin" aria-labelledby="settings-admin-title" className="scroll-mt-28 lg:scroll-mt-20">
              <details className="group rounded-xl border border-violet-500/30 bg-violet-950/30">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span id="settings-admin-title" className="block font-semibold tracking-tight text-violet-200">
                      관리자 도구 · {adminLinkCount}개
                    </span>
                    <span className={cn(studioType.caption, "block")}>
                      이벤트 승인·포인트 지급·공지 관리·정산 조회
                      {pendingCommentReviews > 0 ? ` · 신고 댓글 ${pendingCommentReviews}건 대기` : ""}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-sm text-violet-300 group-open:hidden">
                    펼치기
                  </span>
                  <span aria-hidden="true" className="hidden text-sm text-violet-300 group-open:inline">
                    접기
                  </span>
                </summary>
                <div className="space-y-4 border-t border-violet-500/20 px-4 py-4 sm:px-5">
                  {ADMIN_LINK_GROUPS.map((group) => (
                    <div key={group.title}>
                      <h3 className="mb-2 text-xs font-semibold text-violet-300/90">{group.title}</h3>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {group.links.map((link) => (
                          <Link key={link.href} href={link.href} className={SETTINGS_ACTION_LINK_CLASS}>
                            {adminLinkLabel(link, pendingCommentReviews)}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          )}
        </div>
      </div>
    </AppPageShell>
  );
}
