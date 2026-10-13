import type { ReactNode } from "react";

import { cn, studioType } from "@/lib/studioDesign";

export type FieldRequirement = "required" | "recommended" | "optional";

const REQUIREMENT_LABEL: Record<FieldRequirement, string> = {
  required: "필수",
  recommended: "권장",
  optional: "선택",
};

const REQUIREMENT_CLASS: Record<FieldRequirement, string> = {
  required: "bg-violet-500/15 text-violet-200 ring-violet-400/30",
  recommended: "bg-white/[0.06] text-zinc-200 ring-white/15",
  optional: "bg-transparent text-zinc-400 ring-white/10",
};

export function RequirementBadge({ kind }: { kind: FieldRequirement }) {
  return (
    <span
      className={cn(
        "ml-2 inline-flex items-center rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold leading-none ring-1",
        REQUIREMENT_CLASS[kind],
      )}
    >
      {REQUIREMENT_LABEL[kind]}
    </span>
  );
}

export function FieldCounter({ now, max }: { now: number; max: number }) {
  const over = now > max;
  const near = !over && now >= max * 0.9;
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap text-xs tabular-nums",
        over ? "font-bold text-rose-300" : near ? "font-semibold text-amber-300" : "text-zinc-400",
      )}
    >
      {now.toLocaleString()} / {max.toLocaleString()}자
    </span>
  );
}

export function FieldCount({ now }: { now: number }) {
  return <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-zinc-400">{now.toLocaleString()}자</span>;
}

export function FieldLabel({
  htmlFor,
  requirement,
  aside,
  children,
}: {
  htmlFor?: string;
  requirement?: FieldRequirement;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const className = "min-w-0 text-sm font-medium leading-snug text-zinc-200";
  const content = (
    <>
      {children}
      {requirement ? <RequirementBadge kind={requirement} /> : null}
    </>
  );
  return (
    <div className="mb-1.5 flex items-center justify-between gap-3">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={className}>
          {content}
        </label>
      ) : (
        <span className={className}>{content}</span>
      )}
      {aside}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-sm font-medium text-rose-300">
      {message}
    </p>
  );
}

export type SectionVisibility = "public" | "private";

const VISIBILITY_LABEL: Record<SectionVisibility, string> = {
  public: "공개",
  private: "비공개",
};

export function SectionHeader({
  id,
  title,
  requirement,
  visibility,
  description,
  aside,
  step,
}: {
  id?: string;
  title: string;
  requirement?: FieldRequirement;
  visibility?: SectionVisibility;
  description?: ReactNode;
  aside?: ReactNode;
  step?: number;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-56">
        <h2 id={id} className={cn(studioType.sectionTitle, "flex flex-wrap items-center gap-x-1")}>
          {step ? (
            <span
              aria-hidden
              className="mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/20 text-xs font-bold tabular-nums text-violet-100 ring-1 ring-violet-400/30"
            >
              {step}
            </span>
          ) : null}
          <span>{title}</span>
          {requirement ? <RequirementBadge kind={requirement} /> : null}
        </h2>
        {description ? <p className={cn(studioType.helper, "mt-1")}>{description}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {aside}
        {visibility ? (
          <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold text-zinc-300 ring-1 ring-white/10">
            {VISIBILITY_LABEL[visibility]}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export type RequirementEntry<K extends string = string> = {
  id: K;
  label: string;
  done: boolean;
  tabLabel: string;
};

export function RequirementSummary<K extends string>({
  entries,
  onJump,
  expanded,
  onToggleExpanded,
}: {
  entries: readonly RequirementEntry<K>[];
  onJump: (id: K) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const doneCount = entries.filter((entry) => entry.done).length;
  const missing = entries.filter((entry) => !entry.done);
  const next = missing[0];
  if (!next) {
    return (
      <div
        data-testid="creator-requirements"
        className="flex items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.07] px-4 py-3 text-sm text-emerald-100"
      >
        <span aria-hidden>✓</span>
        <span>
          필수 항목은 모두 입력했어요. 저장 전 분량과 다른 조건도 확인해 주세요.
          <span className="sr-only">
            {" "}
            {doneCount}/{entries.length}
          </span>
        </span>
      </div>
    );
  }
  return (
    <section
      data-testid="creator-requirements"
      aria-label="저장 전 필수 항목"
      className="space-y-3 rounded-xl border border-white/10 bg-[#131626] px-4 py-3.5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-100">저장 전 필수 항목</h2>
        <span className="text-xs font-semibold tabular-nums text-zinc-300">
          {doneCount} / {entries.length} 완료
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={entries.length}
        aria-valuenow={doneCount}
        aria-label="필수 항목 진행"
        className="h-1.5 overflow-hidden rounded-full bg-white/10"
      >
        <div
          className="h-full rounded-full bg-violet-400 transition-[width]"
          style={{ width: `${(doneCount / entries.length) * 100}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onJump(next.id)}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-300/35 bg-amber-300/[0.08] px-4 text-sm font-medium text-amber-100 transition hover:bg-amber-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
        >
          <span className="text-xs font-normal text-amber-200/70">다음</span>
          <span>{next.label}</span>
          <span aria-hidden>→</span>
        </button>
        {missing.length > 1 ? (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={onToggleExpanded}
            className="inline-flex min-h-11 items-center rounded-full px-3 text-sm text-zinc-300 underline decoration-white/25 underline-offset-4 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
          >
            {expanded ? "접기" : `남은 ${missing.length}개 보기`}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <ul className="flex flex-wrap gap-2">
          {missing.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => onJump(entry.id)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3.5 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
              >
                <span>{entry.label}</span>
                <span className="text-xs font-normal text-zinc-400">{entry.tabLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export type AiLearningMeterState = "short" | "ok" | "near" | "over";

export function aiLearningMeterState({
  total,
  substantive,
  limit,
  min,
}: {
  total: number;
  substantive: number;
  limit: number;
  min: number;
}): AiLearningMeterState {
  if (total > limit) return "over";
  if (substantive < min) return "short";
  if (total >= limit * 0.9) return "near";
  return "ok";
}

export function AiLearningMeter({
  id,
  total,
  substantive,
  limit,
  min,
  minHint,
  breakdown,
}: {
  id: string;
  total: number;
  substantive: number;
  limit: number;
  min: number;
  minHint: string;
  breakdown: string;
}) {
  const state = aiLearningMeterState({ total, substantive, limit, min });
  const pct = Math.min(100, (total / limit) * 100);
  const minPct = (min / limit) * 100;
  const message: Record<AiLearningMeterState, string> = {
    short: `최소 ${min.toLocaleString()}자까지 ${(min - substantive).toLocaleString()}자 더 필요해요`,
    ok: `${(limit - total).toLocaleString()}자 더 쓸 수 있어요`,
    near: `한도에 가까워요 · ${(limit - total).toLocaleString()}자 남음`,
    over: `${(total - limit).toLocaleString()}자 초과 · 줄여야 저장돼요`,
  };
  const tone: Record<AiLearningMeterState, string> = {
    short: "text-amber-300",
    ok: "text-zinc-300",
    near: "text-amber-300",
    over: "font-semibold text-rose-300",
  };
  const bar: Record<AiLearningMeterState, string> = {
    short: "bg-amber-300",
    ok: "bg-violet-400",
    near: "bg-amber-300",
    over: "bg-rose-400",
  };
  return (
    <div
      id={id}
      tabIndex={-1}
      data-testid="ai-learning-meter"
      data-state={state}
      className="space-y-2 rounded-xl border border-white/10 bg-[#0e1120] px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-zinc-100">AI 설정 분량</span>
        <span className="text-sm font-semibold tabular-nums text-zinc-100">
          {total.toLocaleString()}
          <span className="font-normal text-zinc-400"> / {limit.toLocaleString()}자</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label="AI 설정 분량"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(total, limit)}
        aria-valuetext={`${total.toLocaleString()}자 / ${limit.toLocaleString()}자`}
        className="relative h-2 overflow-hidden rounded-full bg-white/10"
      >
        <div className={cn("h-full rounded-full transition-[width]", bar[state])} style={{ width: `${pct}%` }} />
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-white/50"
          style={{ left: `${minPct}%` }}
        />
      </div>
      <p className={cn("text-sm", tone[state])} role={state === "over" ? "alert" : undefined}>
        {message[state]}
      </p>
      <p className={studioType.helper}>
        {breakdown} · {minHint}
      </p>
    </div>
  );
}

export type GuideStep<K extends string = string> = {
  id: K;
  n: number;
  label: string;
  done: boolean;
};

export function CreatorGuideRail<K extends string, P extends string>({
  steps,
  onJumpStep,
  preview,
  previewJumps,
  onJumpPreview,
}: {
  steps: readonly GuideStep<K>[];
  onJumpStep: (id: K) => void;
  preview: ReactNode;
  previewJumps: readonly { id: P; label: string }[];
  onJumpPreview: (id: P) => void;
}) {
  const doneCount = steps.filter((step) => step.done).length;
  return (
    <aside
      aria-label="제작 가이드"
      data-testid="creator-guide-rail"
      className="hidden lg:sticky lg:top-[calc(var(--site-header-height,44px)+4.75rem)] lg:block lg:self-start"
    >
      <div className="space-y-4 lg:max-h-[calc(100dvh-var(--site-header-height,44px)-10rem)] lg:overflow-y-auto lg:pr-1">
        <nav aria-label="제작 순서" className="rounded-xl border border-white/10 bg-[#131626] p-3.5">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-100">제작 순서</h2>
            <span className="text-xs tabular-nums text-zinc-400">
              {doneCount} / {steps.length}
            </span>
          </div>
          <ol className="space-y-1">
            {steps.map((step) => (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => onJumpStep(step.id)}
                  className="flex min-h-9 w-full items-center gap-3 rounded-lg px-2 text-left text-sm text-zinc-200 transition hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-1",
                      step.done
                        ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30"
                        : "bg-violet-500/20 text-violet-100 ring-violet-400/30",
                    )}
                  >
                    {step.done ? "✓" : step.n}
                  </span>
                  <span className="min-w-0 flex-1">{step.label}</span>
                  <span className="sr-only">{step.done ? "완료" : "필요"}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <section aria-label="홈 카드 미리보기" className="rounded-xl border border-white/10 bg-[#131626] p-3.5">
          <h2 className="text-sm font-semibold text-zinc-100">홈 카드 미리보기</h2>
          <p className={cn(studioType.helper, "mb-3 mt-1")}>입력한 내용이 카드에 이렇게 보여요.</p>
          <div inert aria-hidden="true" className="pointer-events-none mx-auto w-40 select-none">
            {preview}
          </div>
          <ul className="mt-3 flex flex-wrap justify-center gap-1.5">
            {previewJumps.map((jump) => (
              <li key={jump.id}>
                <button
                  type="button"
                  onClick={() => onJumpPreview(jump.id)}
                  className="inline-flex min-h-9 items-center rounded-full border border-white/12 px-3 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                >
                  {jump.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </aside>
  );
}
