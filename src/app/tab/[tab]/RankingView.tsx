import Link from "next/link";
import AdultContentBadge from "@/components/AdultContentBadge";
import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import { getCharacterRepresentativeImageUrl } from "@/lib/characterAssets";
import { readPublicDossier } from "@/lib/characterPublicDossier";
import { characterRevealAttrs } from "@/lib/characterReveal";
import {
  RANKING_PERIODS,
  rankingMetric,
  type RankedCharacter,
  type RankingPeriod,
} from "@/lib/characterRanking";
import { characterCardHref } from "@/lib/chatLinks";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

const TOP_COUNT = 3;

/** Period switch (links keep the existing `?p=` contract) plus a plain statement of what the numbers count. */
export function RankingPeriodNav({ period }: { period: RankingPeriod }) {
  const metric = rankingMetric(period);
  const label = RANKING_PERIODS.find((p) => p.id === period)?.label ?? "";
  return (
    <>
      <nav aria-label="랭킹 기간" className={cn(studioSurface.tabList, "mt-4 grid grid-cols-5 gap-1")}>
        {RANKING_PERIODS.map((p) => {
          const active = p.id === period;
          return (
            <Link
              key={p.id}
              href={`/tab/ranking?p=${p.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center justify-center rounded-lg px-1 text-sm transition motion-reduce:transition-none",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-300",
                active ? cn(studioSurface.tabActive, "font-bold") : cn(studioSurface.tabIdle, "font-medium"),
              )}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-4 border-l-2 border-violet-400/50 py-0.5 pl-3" data-testid="ranking-basis">
        <p className="text-sm font-semibold text-zinc-100">
          <span className="text-violet-300">{label} 랭킹</span> · {metric.basis}
        </p>
        <p className={cn(studioType.helper, "mt-0.5")}>
          {period === "all"
            ? "실시간·일간·주간·월간 랭킹은 같은 기간 안에 대화가 시작된 횟수로 순위를 매겨요."
            : "전체 랭킹의 누적 대화 턴과는 다른 지표예요. 숫자를 서로 비교하지 마세요."}
        </p>
      </div>
    </>
  );
}

function RankBadges({ c, hidden }: { c: RankedCharacter; hidden: boolean }) {
  return (
    <>
      {c.official === 1 && (
        <span className="ml-1.5 inline-flex items-center rounded bg-violet-500/20 px-1.5 py-0.5 align-middle text-xs font-semibold text-violet-200">
          공식
        </span>
      )}
      {c.content_kind === "simulation" && (
        <span className="ml-1.5 inline-flex items-center rounded bg-white/10 px-1.5 py-0.5 align-middle text-xs font-semibold text-zinc-200">
          시뮬레이션
        </span>
      )}
      {c.nsfw === 1 && <AdultContentBadge className={cn("ml-1.5 align-middle", hidden && "opacity-90")} />}
    </>
  );
}

function RankRow({
  c,
  index,
  period,
  blurNsfw,
  loggedIn,
}: {
  c: RankedCharacter;
  index: number;
  period: RankingPeriod;
  blurNsfw: boolean;
  loggedIn: boolean;
}) {
  const metric = rankingMetric(period);
  const rank = index + 1;
  const top = index < TOP_COUNT;
  const thumb = getCharacterRepresentativeImageUrl(c.assets, c.images);
  const hidden = c.nsfw === 1 && blurNsfw;
  const href = characterCardHref({ characterId: c.id, nsfw: c.nsfw === 1, blurNsfw, loggedIn });
  const tagline = hidden
    ? loggedIn
      ? "성인인증 후 확인할 수 있습니다."
      : "로그인 후 성인인증이 필요합니다."
    : c.tagline;
  const genre = c.genre?.trim() || "";
  const creator = c.creator_name?.trim() || "";

  return (
    <li
      className={cn(top && "mb-2.5", index === TOP_COUNT && "mt-5")}
      data-rank={rank}
      {...characterRevealAttrs({
        id: c.id,
        name: c.name,
        genre,
        tagline: c.tagline,
        href,
        hidden,
        hasThumb: Boolean(thumb),
        dossier: readPublicDossier(c),
      })}
    >
      <Link
        href={href}
        className={cn(
          "flex items-center gap-2.5 transition motion-reduce:transition-none sm:gap-4",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-300",
          top
            ? cn(studioSurface.card, "border-violet-300/20 bg-gradient-to-r from-violet-500/[0.09] to-[#131626] p-3 hover:border-violet-300/35 sm:p-4")
            : "rounded-xl border-b border-white/[0.07] px-1 py-3 hover:bg-white/[0.03] sm:px-2",
        )}
      >
        <span
          className={cn(
            "w-8 shrink-0 text-center font-semibold tabular-nums sm:w-10",
            top ? "text-4xl text-violet-200" : "text-lg text-zinc-500",
          )}
        >
          {rank}
        </span>
        <div
          className={cn(
            "relative shrink-0 overflow-hidden rounded-lg",
            CHARACTER_THUMB_ASPECT,
            top ? "w-24 ring-1 ring-violet-300/25 sm:w-28" : "w-[4.5rem] sm:w-20",
          )}
          style={{ background: `hsl(${c.hue} 60% 20%)` }}
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt=""
              loading={index < 6 ? "eager" : "lazy"}
              decoding="async"
              className={cn("h-full w-full object-cover object-top", hidden && "blur-md")}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-3xl" aria-hidden="true">
              {c.emoji}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            title={c.name}
            className={cn(
              "line-clamp-2 break-keep font-semibold leading-snug text-zinc-50 [overflow-wrap:anywhere]",
              top ? "text-lg" : "text-base",
            )}
          >
            {c.name}
            <RankBadges c={c} hidden={hidden} />
          </p>
          <p className={cn(studioType.caption, "mt-0.5 break-keep [overflow-wrap:anywhere]", top ? "line-clamp-2" : "line-clamp-1")}>
            {tagline}
          </p>
          {!hidden && (creator || genre) ? (
            <p className="mt-1 truncate text-xs text-zinc-400">
              {creator ? `by ${creator}` : ""}
              {creator && genre ? " · " : ""}
              {genre}
            </p>
          ) : null}
          <p className="mt-1.5 flex items-baseline gap-1.5 text-sm text-zinc-300" data-testid="ranking-metric">
            <span className="text-xs text-zinc-400">{metric.label}</span>
            <span>
              <span className={cn("font-semibold tabular-nums text-zinc-50", top && "text-base")}>{c.period_chats.toLocaleString()}</span>
              <span className="text-xs text-zinc-400">{metric.unit}</span>
            </span>
          </p>
        </div>
      </Link>
    </li>
  );
}

export function RankingList({
  ranked,
  period,
  blurNsfw,
  loggedIn,
}: {
  ranked: RankedCharacter[];
  period: RankingPeriod;
  blurNsfw: boolean;
  loggedIn: boolean;
}) {
  return (
    <ol className="mt-5 flex list-none flex-col" aria-label={`${RANKING_PERIODS.find((p) => p.id === period)?.label ?? ""} 랭킹`}>
      {ranked.map((c, i) => (
        <RankRow key={c.id} c={c} index={i} period={period} blurNsfw={blurNsfw} loggedIn={loggedIn} />
      ))}
    </ol>
  );
}
