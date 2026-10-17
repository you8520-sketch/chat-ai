"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import StudioButton from "@/components/studio/StudioButton";
import { cn, studioSelectClass, studioTextareaClass, studioType } from "@/lib/studioDesign";
import type { TrpgCatalog } from "@/lib/trpg/catalog";
import {
  advanceSimpleCreate,
  createSingleFlight,
  newSimpleCreateSession,
  parseSimpleCreateSession,
  sameSimpleCreateInput,
  serializeSimpleCreateSession,
  SIMPLE_CREATE_STORAGE_KEY,
  simpleCreatedHref,
  simpleCreateInputProblem,
  type SimpleCreatePreview,
  type SimpleCreateSession,
  type SimpleCreateStep,
} from "@/lib/trpg/simpleCreate";
import { trpgPlayHref } from "@/lib/trpg/scenarioHandoff";
import {
  countScenarioBundleChars,
  remainingScenarioFieldMax,
  TRPG_SCENARIO_CONTENT_LIMIT,
} from "@/lib/trpg/scenarioTypes";

type Phase = "input" | "working" | "save_failed";

function writeStoredSession(session: SimpleCreateSession | null) {
  try {
    if (!session || (!session.input.description.trim() && session.input.worldId == null && !session.composed)) {
      sessionStorage.removeItem(SIMPLE_CREATE_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(SIMPLE_CREATE_STORAGE_KEY, serializeSimpleCreateSession(session));
  } catch {
    /* storage is only a refresh safety net */
  }
}

export default function TrpgSimpleCreate({
  catalog,
  createdId,
}: {
  catalog: TrpgCatalog;
  createdId: number | null;
}) {
  const router = useRouter();
  const worlds = catalog.myWorlds;
  const [description, setDescription] = useState("");
  const [worldId, setWorldId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [step, setStep] = useState<SimpleCreateStep>("draft");
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [savedPreview, setSavedPreview] = useState<{ id: number; preview: SimpleCreatePreview } | null>(null);
  const sessionRef = useRef<SimpleCreateSession | null>(null);
  const flightRef = useRef(createSingleFlight());

  const linkedWorld = worldId == null ? null : (worlds.find((world) => world.id === worldId) ?? null);
  const descriptionChars = description.trim().length;
  const bundleUsed = countScenarioBundleChars({
    worldSummary: linkedWorld?.summary,
    worldContent: linkedWorld?.content,
    content: description,
  });
  const descriptionMax = remainingScenarioFieldMax(bundleUsed, descriptionChars, TRPG_SCENARIO_CONTENT_LIMIT);
  const nearLimit = descriptionChars > descriptionMax * 0.8;

  const catalogRow = createdId == null ? null : (catalog.myScenarios.find((row) => row.id === createdId) ?? null);
  const result: { id: number; preview: SimpleCreatePreview } | null = catalogRow
    ? {
        id: catalogRow.id,
        preview: {
          title: catalogRow.title,
          summary: catalogRow.summary,
          startingSituation: catalogRow.scenarioPlan?.startingSituation ?? "",
        },
      }
    : createdId != null && savedPreview?.id === createdId
      ? savedPreview
      : null;
  const resultId = result?.id ?? null;

  useEffect(() => {
    const restored = parseSimpleCreateSession(
      (() => {
        try {
          return sessionStorage.getItem(SIMPLE_CREATE_STORAGE_KEY);
        } catch {
          return null;
        }
      })(),
      worlds.map((world) => world.id)
    );
    if (restored) {
      if (restored.savedId != null && createdId == null) {
        router.replace(simpleCreatedHref(restored.savedId));
      } else if (restored.savedId == null) {
        setDescription(restored.input.description);
        setWorldId(restored.input.worldId);
        if (restored.composed) {
          sessionRef.current = restored;
          setPhase("save_failed");
        }
      }
    }
    setHydrated(true);
    // Runs once on mount: restore what survived a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated || resultId != null || phase === "working") return;
    writeStoredSession(sessionRef.current ?? newSimpleCreateSession({ description, worldId }));
  }, [hydrated, description, worldId, phase, resultId]);

  useEffect(() => {
    if (resultId == null) return;
    sessionRef.current = null;
    writeStoredSession(null);
    setDescription("");
    setWorldId(null);
    setPhase("input");
    setError("");
  }, [resultId]);

  useEffect(() => {
    if (phase !== "working") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  function run(session: SimpleCreateSession) {
    const world = linkedWorld
      ? { id: linkedWorld.id, summary: linkedWorld.summary, content: linkedWorld.content }
      : null;
    void flightRef.current.run(async () => {
      setPhase("working");
      setStep(session.composed ? "save" : "draft");
      setError("");
      const outcome = await advanceSimpleCreate({
        session,
        world,
        fetchImpl: (input, init) => fetch(input, init),
        onStep: setStep,
      });
      if (outcome.status === "draft_failed") {
        sessionRef.current = null;
        setError(outcome.message);
        setPhase("input");
        return;
      }
      sessionRef.current = outcome.session;
      if (outcome.status === "save_failed") {
        writeStoredSession(outcome.session);
        setError(outcome.message);
        setPhase("save_failed");
        return;
      }
      writeStoredSession(outcome.session);
      const savedId = outcome.session.savedId!;
      const preview = outcome.session.composed?.preview ?? null;
      if (preview) setSavedPreview({ id: savedId, preview });
      setPhase("input");
      router.push(simpleCreatedHref(savedId), { scroll: false });
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (flightRef.current.busy || phase === "working") return;
    const input = { description, worldId };
    const problem = simpleCreateInputProblem(
      input,
      linkedWorld ? { id: linkedWorld.id, summary: linkedWorld.summary, content: linkedWorld.content } : null
    );
    if (problem) {
      setError(problem);
      return;
    }
    const existing = sessionRef.current;
    run(existing && sameSimpleCreateInput(existing.input, input) ? existing : newSimpleCreateSession(input));
  }

  function retrySave() {
    const existing = sessionRef.current;
    if (!existing || flightRef.current.busy) return;
    run(existing);
  }

  function discardGenerated() {
    sessionRef.current = null;
    setError("");
    setPhase("input");
  }

  function startAnother() {
    router.push("/world/create?tab=scenario", { scroll: false });
  }

  if (result) {
    const { id, preview } = result;
    return (
      <section data-trpg-simple-result aria-labelledby="trpg-simple-result-title" className="space-y-5">
        <div className="rounded-xl border border-white/10 bg-[#131626] p-4 sm:p-5">
          <p className="text-xs font-semibold text-emerald-300">모험이 만들어졌어요 · 비공개로 저장됨</p>
          <h2 id="trpg-simple-result-title" className="mt-2 break-keep text-xl font-semibold text-zinc-50">
            {preview.title}
          </h2>
          {preview.summary ? <p className={cn(studioType.body, "mt-2")}>{preview.summary}</p> : null}
          {preview.startingSituation ? (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-xs font-semibold text-zinc-400">시작 상황</p>
              <p className={cn(studioType.body, "mt-1 whitespace-pre-wrap")}>{preview.startingSituation}</p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <StudioButton href={trpgPlayHref(id)} size="lg" className="sm:flex-1">
            이 모험 시작
          </StudioButton>
          <StudioButton href={`/trpg/scenarios/${id}`} variant="secondary" size="lg" className="sm:flex-1">
            내용 보기·수정
          </StudioButton>
        </div>
        <p className={studioType.helper}>
          시작하면 참가자와 AI 동료를 고르는 준비 화면으로 이동합니다. 수정하지 않아도 바로 플레이할 수 있어요.
        </p>
        <button
          type="button"
          onClick={startAnother}
          className="min-h-11 text-sm font-medium text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline"
        >
          새 모험 만들기
        </button>
      </section>
    );
  }

  const working = phase === "working";
  const locked = working || phase === "save_failed";
  const generatedTitle = sessionRef.current?.composed?.preview.title ?? "";

  return (
    <form
      data-trpg-simple-create
      onSubmit={submit}
      noValidate
      className="space-y-5"
      aria-busy={working}
    >
      <div>
        <label htmlFor="trpg-simple-description" className="block text-lg font-semibold text-zinc-50">
          어떤 모험을 만들고 싶나요?
        </label>
        <p className={cn(studioType.helper, "mt-1")}>
          {linkedWorld
            ? "고른 세계관은 그대로 쓰고, 여기에 적은 내용은 모험 설정으로 덧붙여요. 비워 둬도 됩니다."
            : "한두 문장이면 충분해요. 제목과 시작 상황, 목표는 AI가 채웁니다."}
        </p>
        <textarea
          id="trpg-simple-description"
          data-trpg-simple-description
          value={description}
          rows={6}
          maxLength={descriptionMax}
          disabled={locked}
          onChange={(event) => {
            setDescription(event.target.value);
            if (error) setError("");
          }}
          placeholder="예: 폭풍에 갇힌 등대섬에서 사라진 선원들의 비밀을 파헤치는 추리극"
          className={cn(studioTextareaClass, "mt-3 min-h-40")}
        />
        {nearLimit ? (
          <p className={cn(studioType.counter, "mt-1 text-right")}>
            {descriptionChars.toLocaleString()} / {descriptionMax.toLocaleString()}자
          </p>
        ) : null}
      </div>

      {worlds.length > 0 ? (
        <div>
          <label htmlFor="trpg-simple-world" className="block text-sm font-medium text-zinc-300">
            기존 세계관 불러오기 <span className="font-normal text-zinc-500">(선택)</span>
          </label>
          <select
            id="trpg-simple-world"
            data-trpg-simple-world
            value={worldId ?? ""}
            disabled={locked}
            onChange={(event) => {
              setWorldId(event.target.value ? Number(event.target.value) : null);
              if (error) setError("");
            }}
            className={cn(studioSelectClass, "mt-1.5 w-full")}
          >
            <option value="">선택 안 함</option>
            {worlds.map((world) => (
              <option key={world.id} value={world.id}>
                {world.name}
              </option>
            ))}
          </select>
          {linkedWorld?.summary.trim() ? (
            <p className={cn(studioType.helper, "mt-2 line-clamp-2")}>{linkedWorld.summary}</p>
          ) : null}
        </div>
      ) : null}

      {phase === "save_failed" ? (
        <div
          data-trpg-simple-save-failed
          role="alert"
          className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4"
        >
          <p className="text-sm font-semibold text-amber-100">
            {generatedTitle ? `「${generatedTitle}」` : "모험"}은 만들어졌지만 아직 저장되지 않았어요.
          </p>
          <p className="text-xs text-amber-100/80">{error}</p>
          <p className="text-xs text-amber-100/80">AI를 다시 부르지 않고 저장만 다시 시도합니다.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <StudioButton type="button" size="lg" onClick={retrySave} className="sm:flex-1">
              저장 다시 시도
            </StudioButton>
            <StudioButton type="button" size="lg" variant="secondary" onClick={discardGenerated} className="sm:flex-1">
              버리고 다시 쓰기
            </StudioButton>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {error ? (
            <p
              data-trpg-simple-error
              role="alert"
              className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
            >
              {error}
            </p>
          ) : null}
          <StudioButton type="submit" size="lg" disabled={working} className="w-full" data-trpg-simple-submit>
            {working ? (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                {step === "draft" ? "모험을 만드는 중…" : "저장하는 중…"}
              </>
            ) : (
              "모험 만들기"
            )}
          </StudioButton>
          <p className={cn(studioType.helper, "text-center")} role="status">
            {working
              ? step === "draft"
                ? "AI가 모험을 구성하고 있어요. 1~2분쯤 걸릴 수 있어요. 이 화면을 닫지 마세요."
                : "비공개로 저장하고 있어요."
              : "비공개로 저장되고, 나중에 얼마든지 고칠 수 있어요."}
          </p>
        </div>
      )}
    </form>
  );
}
