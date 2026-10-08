"use client";

import Link from "next/link";
import {
  useId,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import type { HomeStageCharacter } from "@/lib/homeStagePresentation";
import { cn } from "@/lib/studioDesign";

const STAGE_INDEX = "01";
const STAGE_EYEBROW = "FOR YOU";
const STAGE_TITLE = "추천 캐릭터";

type Mode = "selector" | "feature";

type Wipe = {
  token: number;
  wash: string;
};

type Props = {
  characters: HomeStageCharacter[];
};

function motionAllowed(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Glyphs on the widest line once the name wraps to at most two lines. */
function giantPerLine(name: string): number {
  const chars = Math.max([...name.trim()].length, 1);
  if (chars <= 6) return chars;
  const longestWord = Math.max(...name.trim().split(/\s+/).map((word) => [...word].length));
  return Math.max(Math.ceil(chars / 2), Math.min(longestWord, 8));
}

function PortraitFrame({
  character,
  priority,
  onExpand,
}: {
  character: HomeStageCharacter;
  priority: boolean;
  onExpand?: () => void;
}) {
  const image = character.imageUrl ? (
    <img
      src={character.imageUrl}
      alt=""
      className="h-full w-full object-cover object-top"
      fetchPriority={priority ? "high" : "auto"}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  ) : (
    <span
      aria-hidden
      className="flex h-full w-full items-center justify-center text-7xl"
      style={{ background: character.accent.ink, color: character.accent.wash }}
    >
      {character.emoji}
    </span>
  );

  const photoClass = "absolute inset-[8%] overflow-hidden rounded-full";
  const photo = onExpand ? (
    <button
      type="button"
      onClick={onExpand}
      className={photoClass}
      style={{ background: "#12141a" }}
      aria-label={`${character.name} 크게 보기`}
    >
      {image}
    </button>
  ) : (
    <div className={photoClass} style={{ background: "#12141a" }}>
      {image}
    </div>
  );

  return (
    <div className="relative aspect-square w-full" data-stage-art="selector">
      <div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ background: character.accent.wash }}
      />
      {photo}
    </div>
  );
}

function FeatureArtwork({ character }: { character: HomeStageCharacter }) {
  return (
    <div className="home-stage-feature-art" data-stage-art="feature">
      {character.imageUrl ? (
        <img
          src={character.imageUrl}
          alt=""
          className="home-stage-feature-figure"
          fetchPriority="high"
          decoding="async"
        />
      ) : (
        <span
          aria-hidden
          className="home-stage-feature-fallback"
          style={{ background: character.accent.ink, color: character.accent.wash }}
        >
          {character.emoji}
        </span>
      )}
    </div>
  );
}

function StageWipe({
  wipe,
  onDone,
}: {
  wipe: Wipe | null;
  onDone: (token: number) => void;
}) {
  if (!wipe) return null;
  return (
    <div
      key={wipe.token}
      aria-hidden
      className="home-stage-wipe"
      style={{ background: wipe.wash }}
      onAnimationEnd={(event: AnimationEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        onDone(wipe.token);
      }}
    />
  );
}

function StageThumbs({
  baseId,
  characters,
  activeIndex,
  onSelect,
}: {
  baseId: string;
  characters: HomeStageCharacter[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = characters.length - 1;
    if (last < 0) return;
    let next = activeIndex;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = activeIndex >= last ? 0 : activeIndex + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = activeIndex <= 0 ? last : activeIndex - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    onSelect(next);
    const id = characters[next]?.id;
    if (id == null) return;
    requestAnimationFrame(() => {
      document.getElementById(`${baseId}-tab-${id}`)?.focus();
    });
  }

  return (
    <div
      role="tablist"
      aria-label="추천 캐릭터 선택"
      className="flex gap-3 overflow-x-auto pb-1"
      onKeyDown={onKeyDown}
    >
      {characters.map((character, index) => {
        const selected = index === activeIndex;
        return (
          <button
            key={character.id}
            type="button"
            role="tab"
            id={`${baseId}-tab-${character.id}`}
            aria-selected={selected}
            aria-controls={`${baseId}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(index)}
            aria-label={`${character.name} 선택`}
            className={cn(
              "relative h-12 w-12 shrink-0 overflow-hidden rounded-full sm:h-16 sm:w-16",
              selected ? "opacity-100" : "opacity-55",
            )}
            style={{
              boxShadow: selected
                ? `0 0 0 3px ${character.accent.wash}`
                : "0 0 0 1px rgba(255,255,255,0.28)",
            }}
          >
            {character.imageUrl ? (
              <img
                src={character.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover object-top"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-full w-full items-center justify-center text-lg font-semibold"
                style={{ background: character.accent.wash, color: character.accent.ink }}
              >
                {[...character.name][0] ?? "·"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function IdentityMarks({ character }: { character: HomeStageCharacter }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {character.official ? (
        <span className="border border-white/10 bg-violet-600/90 px-1.5 py-1 text-[9px] font-bold leading-none text-white">
          공식
        </span>
      ) : null}
      {character.simulation ? (
        <span className="border border-white/10 bg-cyan-700/90 px-1.5 py-1 text-[9px] font-bold leading-none text-white">
          다인 시뮬
        </span>
      ) : null}
    </div>
  );
}

function CreatorLine({ character }: { character: HomeStageCharacter }) {
  if (!character.creatorName) return null;
  if (character.creatorHref) {
    return (
      <Link
        href={character.creatorHref}
        className="text-sm font-medium text-zinc-200 underline decoration-white/25 underline-offset-4 hover:text-white"
      >
        {character.creatorName}
      </Link>
    );
  }
  return <p className="text-sm font-medium text-zinc-200">{character.creatorName}</p>;
}

export default function HomeCharacterStage({ characters }: Props) {
  const baseId = useId();
  const [activeIndex, setActiveIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("selector");
  const [wipe, setWipe] = useState<Wipe | null>(null);

  if (characters.length === 0) return null;

  const index = Math.min(activeIndex, characters.length - 1);
  const character = characters[index];
  if (!character) return null;

  const panelId = `${baseId}-panel`;

  function playWipe(wash: string) {
    if (!motionAllowed()) return;
    setWipe((current) => ({ token: (current?.token ?? 0) + 1, wash }));
  }

  function finishWipe(token: number) {
    setWipe((current) => (current?.token === token ? null : current));
  }

  function selectCharacter(nextIndex: number) {
    if (nextIndex === index) return;
    const next = characters[nextIndex];
    if (!next) return;
    playWipe(next.accent.wash);
    setActiveIndex(nextIndex);
  }

  function openFeature() {
    playWipe(character.accent.wash);
    setMode("feature");
  }

  function closeFeature() {
    playWipe(character.accent.wash);
    setMode("selector");
  }

  switch (mode) {
    case "selector":
      return (
        <section
          className="home-stage relative overflow-hidden"
          data-stage-mode="selector"
          data-stage-active={character.id}
          style={{
            background: `radial-gradient(ellipse at 28% 42%, color-mix(in srgb, ${character.accent.wash} 38%, transparent), transparent 62%)`,
          }}
        >
          <div className="grid items-center gap-6 py-5 lg:min-h-[calc(100svh-9rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(16rem,0.9fr)] lg:gap-10 lg:py-8">
            <div className="mx-auto w-[min(52vw,30rem)]">
              <PortraitFrame character={character} priority onExpand={openFeature} />
            </div>
            <div className="flex min-w-0 flex-col gap-3 sm:gap-4">
              <div
                key={character.id}
                role="tabpanel"
                id={panelId}
                aria-labelledby={`${baseId}-tab-${character.id}`}
                className="flex min-w-0 flex-col gap-3 sm:gap-4"
              >
              <div>
                <p className="text-[10px] font-semibold tracking-[0.22em] text-zinc-400">
                  {STAGE_INDEX} / {STAGE_EYEBROW}
                </p>
                <p className="mt-1 text-xs text-zinc-500">{STAGE_TITLE}</p>
              </div>
              <p
                className="text-4xl font-semibold leading-none tracking-[-0.06em] sm:text-6xl"
                style={{ color: character.accent.wash }}
              >
                {character.indexLabel}
                <span className="ml-2 text-lg font-medium tracking-normal text-zinc-500">
                  / {character.totalLabel}
                </span>
              </p>
              <IdentityMarks character={character} />
              <h1 className="text-[2rem] font-semibold leading-[1.05] tracking-[-0.045em] text-white [overflow-wrap:anywhere] sm:text-5xl">
                {character.name}
              </h1>
              {character.genre ? (
                <p className="text-sm font-semibold tracking-[0.16em]" style={{ color: character.accent.wash }}>
                  {character.genre}
                </p>
              ) : null}
              <CreatorLine character={character} />
              <p className="max-w-md text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]">
                {character.tagline || "한 줄 소개 없음"}
              </p>
              </div>
              <StageThumbs
                baseId={baseId}
                characters={characters}
                activeIndex={index}
                onSelect={selectCharacter}
              />
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={openFeature}
                  className="inline-flex min-h-12 items-center px-5 text-sm font-semibold"
                  style={{ background: character.accent.wash, color: character.accent.ink }}
                >
                  펼쳐 보기
                </button>
                <Link
                  href="/tab/ranking"
                  className="inline-flex min-h-12 items-center text-sm font-semibold text-zinc-300 underline decoration-white/25 underline-offset-4 hover:text-white"
                >
                  전체보기
                </Link>
              </div>
            </div>
          </div>
          <StageWipe wipe={wipe} onDone={finishWipe} />
        </section>
      );
    case "feature":
      return (
        <section
          className="home-stage relative overflow-hidden"
          data-stage-mode="feature"
          data-stage-active={character.id}
          style={{
            background: `radial-gradient(ellipse at 18% 40%, color-mix(in srgb, ${character.accent.wash} 46%, transparent), transparent 60%)`,
          }}
        >
          <div className="home-stage-feature relative lg:min-h-[calc(100svh-9rem)]">
            <div
              aria-hidden
              className="home-stage-feature-field"
              style={{ background: character.accent.wash }}
            />
            <div className="relative z-[3] flex flex-col py-4 pb-24 lg:min-h-[calc(100svh-9rem)] lg:justify-between lg:py-6 lg:pb-28">
              <div className="relative z-[4] flex items-start justify-between gap-3">
                <p className="text-[10px] font-semibold tracking-[0.22em] text-zinc-300">
                  {STAGE_INDEX} / {STAGE_EYEBROW}
                  <span className="mx-2 text-zinc-600">·</span>
                  <span style={{ color: character.accent.wash }}>
                    {character.indexLabel} / {character.totalLabel}
                  </span>
                </p>
                <button
                  type="button"
                  onClick={closeFeature}
                  className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-zinc-100 underline decoration-white/30 underline-offset-4"
                >
                  선택으로
                </button>
              </div>
              <FeatureArtwork character={character} />
              <p
                aria-hidden
                className="home-stage-giant"
                style={
                  {
                    color: character.accent.wash,
                    "--giant-per-line": giantPerLine(character.name),
                  } as CSSProperties
                }
              >
                {character.name}
              </p>
              <div
                role="tabpanel"
                id={panelId}
                aria-labelledby={`${baseId}-tab-${character.id}`}
                className="relative z-[4] mt-4 flex w-full flex-col items-start gap-3 lg:ml-auto lg:mt-0 lg:mb-[4%] lg:w-[min(100%,22rem)]"
              >
                <IdentityMarks character={character} />
                <h1 className="text-3xl font-semibold leading-tight tracking-[-0.04em] text-white [overflow-wrap:anywhere]">
                  {character.name}
                </h1>
                {character.genre ? (
                  <p className="text-sm font-semibold tracking-[0.16em]" style={{ color: character.accent.wash }}>
                    {character.genre}
                  </p>
                ) : null}
                <CreatorLine character={character} />
                <p className="text-sm leading-6 text-zinc-200 [overflow-wrap:anywhere]">
                  {character.tagline || "한 줄 소개 없음"}
                </p>
                <Link
                  href={character.href}
                  className="inline-flex min-h-12 items-center px-5 text-sm font-semibold"
                  style={{ background: character.accent.wash, color: character.accent.ink }}
                >
                  이야기 열기
                  <span aria-hidden> →</span>
                </Link>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-4 z-[4]">
              <StageThumbs
                baseId={baseId}
                characters={characters}
                activeIndex={index}
                onSelect={selectCharacter}
              />
            </div>
            <StageWipe wipe={wipe} onDone={finishWipe} />
          </div>
        </section>
      );
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}
