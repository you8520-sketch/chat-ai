import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAdminUser } from "@/lib/adminAuth";
import { buildAdminFinanceSummary, currentKstMonthKey } from "@/lib/adminFinance";
import {
  fetchMemoryResearchAdminProjection,
  type MemoryResearchAdminProjection,
} from "@/lib/adminMemoryResearchReports";
import {
  buildAdminMemoryRuntimeStatus,
  type AdminMemoryRuntimeStatus,
} from "@/lib/adminMemoryRuntimeStatus";
import {
  fetchGithubScheduledAutomationProjection,
  fetchGithubSupplyAutoDraftProjection,
  fetchPostDeployVerificationProjection,
} from "@/lib/adminAutomationReports";
import {
  fetchCodeHealthAdminProjection,
  formatCodeHealthDeltaLines,
  type CodeHealthAdminCard,
} from "@/lib/codeHealth/reports";
import { getDb } from "@/lib/db";
import { fetchDecisionRadarAdminProjection } from "@/lib/decisionModelRadarReports";
import {
  buildFinanceAnomalyReport,
  type FinanceAnomalyReport,
} from "@/lib/financeAnomalyRadar";
import { listMainRpCacheTtlReports } from "@/lib/mainRpCacheTtlEconomics";
import { buildMainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";
import {
  type PostDeployVerificationState,
  type PostDeployVerificationView,
} from "@/lib/postDeployVerification";
import { listSchedulerRunOverview } from "@/lib/schedulerRunRegistry";
import {
  buildSupplierDiscoveryReport,
  type SupplierCandidateRecord,
} from "@/lib/supplierDiscovery/discoverSuppliers";

export const dynamic = "force-dynamic";

function fmtDate(value: string | null | undefined): string {
  if (!value) return "기록 없음";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function badgeClass(state: string): string {
  const normalized = state.toLowerCase();
  if (normalized === "success" || normalized === "succeeded" || normalized === "completed") {
    return "bg-emerald-500/15 text-emerald-300";
  }
  if (
    normalized === "failure" ||
    normalized === "failed" ||
    normalized === "stale" ||
    normalized === "stale_blocked"
  ) {
    return "bg-rose-500/15 text-rose-300";
  }
  if (normalized === "running" || normalized === "in_progress" || normalized === "queued") {
    return "bg-sky-500/15 text-sky-300";
  }
  return "bg-amber-500/15 text-amber-300";
}

function postDeployBadgeClass(state: PostDeployVerificationState): string {
  switch (state) {
    case "VERIFIED":
      return "bg-emerald-500/15 text-emerald-300";
    case "FAILED":
      return "bg-rose-500/15 text-rose-300";
    case "UNVERIFIED":
      return "bg-amber-500/15 text-amber-300";
    case "SUPERSEDED":
      return "bg-zinc-500/15 text-zinc-300";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

function PostDeployVerificationCard({ view }: { view: PostDeployVerificationView }) {
  const latest = view.latest;
  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-[#11131a] p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black">배포 검증</h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-zinc-500">
            Railway production 배포가 성공한 뒤 https://hav.chat 의 /health 와 /api/health 를
            읽어서 대상 커밋과 맞는지 확인한 결과입니다. GitHub workflow 성공만으로 VERIFIED가
            되지 않습니다.
          </p>
        </div>
        <span
          className={
            "rounded px-2 py-1 text-xs font-bold " +
            postDeployBadgeClass(view.status === "UNAVAILABLE" ? "UNVERIFIED" : (latest?.state ?? "UNVERIFIED"))
          }
        >
          {view.status === "UNAVAILABLE" ? "UNVERIFIED" : (latest?.state ?? "UNVERIFIED")}
        </span>
      </div>
      {view.status === "UNAVAILABLE" ? (
        <p className="mt-3 text-sm text-amber-200">GitHub 조회 실패 · {view.error}</p>
      ) : latest ? (
        <dl className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl bg-black/20 p-3">
            <dt className="text-[11px] text-zinc-500">검증 대상 SHA</dt>
            <dd className="mt-1 break-all font-mono text-xs text-zinc-100">
              {latest.targetSha || "없음"}
            </dd>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <dt className="text-[11px] text-zinc-500">검증 시각</dt>
            <dd className="mt-1 text-xs text-zinc-100">{fmtDate(latest.checkedAt)}</dd>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <dt className="text-[11px] text-zinc-500">응답 gitCommit</dt>
            <dd className="mt-1 font-mono text-xs text-zinc-100">
              {latest.observedGitCommit ?? "없음"}
            </dd>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <dt className="text-[11px] text-zinc-500">사유</dt>
            <dd className="mt-1 text-xs text-zinc-100">{latest.reason ?? "없음"}</dd>
          </div>
        </dl>
      ) : null}
      {latest && !latest.currentDeployment ? (
        <p className="mt-3 text-xs text-zinc-400">현재 배포 SHA와 다른 이전 검증 결과입니다.</p>
      ) : null}
      {latest?.htmlUrl ? (
        <a
          href={latest.htmlUrl}
          className="mt-3 inline-block text-xs text-sky-300 hover:text-sky-200"
          target="_blank"
          rel="noreferrer"
        >
          GitHub 실행
        </a>
      ) : null}
      {view.superseded ? (
        <p className="mt-3 break-all text-xs text-zinc-500">
          이전 검증 {view.superseded.targetSha} · SUPERSEDED · {view.superseded.reason}
          {view.superseded.htmlUrl ? (
            <>
              {" · "}
              <a href={view.superseded.htmlUrl} className="text-sky-400 hover:text-sky-200" target="_blank" rel="noreferrer">
                실행
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

function codeHealthStatusLabel(status: CodeHealthAdminCard["status"]): string {
  switch (status) {
    case "SUCCESS":
      return "SUCCESS";
    case "WARNING":
      return "WARNING";
    case "FAILED":
      return "FAILED";
    case "EMPTY":
      return "기록 없음";
    case "UNAVAILABLE":
      return "UNAVAILABLE";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

function CodeHealthCard({ card }: { card: CodeHealthAdminCard }) {
  const counts = card.counts;
  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-cyan-950/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-cyan-200">
            {card.kind === "weekly" ? "Weekly Code Health" : "Monthly Cleanup"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {card.kind === "weekly"
              ? "주 1회 read-only 코드 헬스 감사입니다. production 코드를 수정하지 않으며, 분석기 결과는 삭제 증거가 아닙니다."
              : "월 1회 이전 weekly 결과를 합쳐 cleanup candidate set만 만듭니다. 자동 merge하지 않습니다."}
          </p>
        </div>
        <span className={"rounded px-2 py-1 text-xs font-bold " + badgeClass(card.status)}>
          {codeHealthStatusLabel(card.status)}
        </span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">실행 시각 · {fmtDate(card.ranAt)}</p>
      {counts ? (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">신규 발견</p>
            <p className="mt-1 font-bold">{counts.newFindings}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">resolved</p>
            <p className="mt-1 font-bold">{counts.resolved}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">SAFE_TO_DELETE</p>
            <p className="mt-1 font-bold">{counts.safeToDelete}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">REQUIRED_CLEANUP</p>
            <p className="mt-1 font-bold">{counts.requiredCleanup}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">FOLLOW_UP</p>
            <p className="mt-1 font-bold">{counts.followUp}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">duplicate owner</p>
            <p className="mt-1 font-bold">{counts.duplicateOwners}</p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">unused file / export / dep</p>
            <p className="mt-1 font-bold">
              {counts.unusedFiles} / {counts.unusedExports} / {counts.unusedDependencies}
            </p>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <p className="text-[11px] text-zinc-500">obsolete flag/env · CI anomaly</p>
            <p className="mt-1 font-bold">
              {counts.obsoleteFlagsEnvs} · {counts.runtimeCiAnomalies}
            </p>
          </div>
        </div>
      ) : null}
      <div className="mt-3 rounded-xl border border-white/5 p-3 text-xs text-zinc-400">
        <p className="text-[11px] text-zinc-500">지난 실행 대비 delta</p>
        <ul className="mt-1 space-y-0.5">
          {formatCodeHealthDeltaLines(card.delta).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      {card.kind === "monthly" ? (
        <p className="mt-3 text-xs text-zinc-500">
          cleanup Draft PR: {card.draftPrCreated ? "생성됨" : "없음"}
          {card.eligibleCount != null ? ` · eligible ${card.eligibleCount}` : ""}
        </p>
      ) : null}
      {card.githubRunUrl ? (
        <div className="mt-3">
          <a
            href={card.githubRunUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-white/5"
          >
            상세 GitHub run / report ↗
          </a>
        </div>
      ) : null}
    </section>
  );
}

function FinanceAnomalyCard({ report }: { report: FinanceAnomalyReport }) {
  return (
    <section className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-950/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-amber-200">Finance / Billing Anomaly Radar</h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-zinc-500">
            canonical finance ledger, provider reconciliation, 실제 Main RP economics와 최소 margin
            floor를 read-only로 비교합니다. 이 radar는 가격·route·billing을 자동 변경하지
            않습니다.
          </p>
        </div>
        <span
          className={
            "rounded px-2 py-1 text-xs font-bold " +
            (report.status === "HEALTHY"
              ? "bg-emerald-500/15 text-emerald-300"
              : report.status === "CRITICAL"
                ? "bg-rose-500/15 text-rose-300"
                : "bg-amber-500/15 text-amber-300")
          }
        >
          {report.status}
        </span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">
        {report.monthKey} · 계산 {fmtDate(report.generatedAt)} · critical {report.criticalCount} ·
        warning {report.warningCount}
      </p>
      {report.anomalies.length === 0 ? (
        <div className="mt-4 rounded-xl border border-emerald-500/10 bg-emerald-950/10 p-3 text-sm text-emerald-300">
          deterministic finance/billing anomaly가 없습니다.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {report.anomalies.slice(0, 12).map((anomaly) => (
            <article key={anomaly.id} className="rounded-xl border border-white/5 bg-black/15 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-zinc-200">{anomaly.title}</p>
                <span
                  className={
                    "rounded px-2 py-0.5 text-[11px] font-bold " +
                    (anomaly.severity === "critical"
                      ? "bg-rose-500/15 text-rose-300"
                      : "bg-amber-500/15 text-amber-300")
                  }
                >
                  {anomaly.severity.toUpperCase()}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">{anomaly.summary}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-mono text-zinc-600">{anomaly.sourceRef}</span>
                <Link href={anomaly.href} className="font-semibold text-amber-300 hover:text-amber-200">
                  canonical owner 확인 →
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="mt-4">
        <Link
          href="/admin/ops"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-white/5"
        >
          운영 예외함에서 보기 →
        </Link>
      </div>
    </section>
  );
}

function MemoryResearchCard({
  projection,
  runtime,
}: {
  projection: MemoryResearchAdminProjection;
  runtime: AdminMemoryRuntimeStatus;
}) {
  const run = projection.run;
  const state = run?.status ?? projection.status;
  const readiness = run?.readiness;
  const promptPacking = run?.promptPackingAudit ?? null;
  const promptPackingTrend = run?.promptPackingTrend ?? null;
  const pipeline = projection.pipeline;
  const hasPipeline =
    pipeline.pendingLiveExperiments > 0 ||
    pipeline.recordedLiveExperiments > 0 ||
    pipeline.pendingImplementationPrs > 0 ||
    pipeline.implementationPrs > 0 ||
    pipeline.acceptedDraftPrs > 0;

  return (
    <section className="mt-6 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-950/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-fuchsia-200">
            Memory Research Cycle
          </h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-zinc-500">
            메모리 기술 탐색 → owner 충돌 검사 → deterministic benchmark → case-port 계획을
            수행하는 정기 연구 자동화입니다. 이 화면은 durable research ledger를 read-only로
            표시하며 production memory를 수정하지 않습니다.
          </p>
        </div>
        <span className={"rounded px-2 py-1 text-xs font-bold " + badgeClass(state)}>
          {state}
        </span>
      </div>

      {run ? (
        <>
          <p className="mt-3 text-xs text-zinc-500">
            {run.cycleKey} · {run.mode} · 완료 {fmtDate(run.finishedAt)}
            {run.mainSha ? ` · main ${run.mainSha.slice(0, 8)}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={
                "rounded px-2 py-1 font-bold " +
                (projection.freshnessStatus === "FRESH"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : projection.freshnessStatus === "UNKNOWN"
                    ? "bg-amber-500/15 text-amber-300"
                    : "bg-rose-500/15 text-rose-300")
              }
            >
              durable freshness · {projection.freshnessStatus}
            </span>
            {projection.freshnessReason ? (
              <span className="text-zinc-500">{projection.freshnessReason}</span>
            ) : null}
          </div>

          <div className="mt-3 rounded-xl border border-emerald-500/10 bg-emerald-950/5 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-emerald-200">Production memory runtime</span>
              <span
                className={
                  "rounded px-2 py-0.5 font-bold " +
                  (runtime.memoryFeatureEnabled
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-rose-500/15 text-rose-300")
                }
              >
                memory {runtime.memoryFeatureEnabled ? "ON" : "OFF"}
              </span>
              <span
                className={
                  "rounded px-2 py-0.5 font-bold " +
                  (runtime.episodicRecallEnabled
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-rose-500/15 text-rose-300")
                }
              >
                episodic recall {runtime.episodicRecallEnabled ? "ON" : "OFF"}
              </span>
              <span
                className={
                  "rounded px-2 py-0.5 font-bold " +
                  (runtime.semantic.enabled
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-amber-500/15 text-amber-300")
                }
              >
                semantic {runtime.semantic.enabled ? "ON" : "OFF"}
              </span>
            </div>
            <p className="mt-2 text-zinc-500">
              policy {runtime.policy.id} · {runtime.policy.rollingSummaryInterval}턴 요약 · RAW
              {runtime.policy.rawRecentExchanges}
            </p>
            <p className="mt-1 text-zinc-500">
              semantic model key {runtime.semantic.configuredModelKey ?? "미설정"}
              {runtime.semantic.activeModelId
                ? ` · active ${runtime.semantic.activeModelId}`
                : ` · reason ${runtime.semantic.reason}`}
            </p>
            {runtime.semantic.configVersion ? (
              <p className="mt-1 font-mono text-[11px] text-zinc-600">
                {runtime.semantic.configVersion}
              </p>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">sources / observations</p>
              <p className="mt-1 font-bold">
                {run.counts.sourcesChecked} / {run.counts.observations}
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                source 실패 {run.counts.sourcesFailed}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">evaluated</p>
              <p className="mt-1 font-bold">{run.counts.evaluated}</p>
              <p className="mt-1 text-[11px] text-zinc-600">
                신규 {run.counts.newCandidates}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">WATCH / REJECT / ACCEPT</p>
              <p className="mt-1 font-bold">
                {run.counts.watch} / {run.counts.reject} / {run.counts.accept}
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                benchmark {run.counts.benchmarked}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">provider calls / cost</p>
              <p className="mt-1 font-bold">
                {run.paidProviderCalls} / {"$"}{run.estimatedCostUsd.toFixed(4)}
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                source HTTP {run.httpCalls}/{run.httpBudget || "-"}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">companion / benchmark proposals</p>
              <p className="mt-1 font-bold">
                {run.companionExperimentProposals} / {run.benchmarkAdoptionProposals}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">case-port / harness 분석</p>
              <p className="mt-1 font-bold">
                {run.benchmarkCasePortPlans} / {run.benchmarkHarnessFeasibility}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">persistent gaps / local gold</p>
              <p className="mt-1 font-bold">
                {run.persistentMemoryGaps} / {run.localGoldAuthoringPackets}
              </p>
            </div>
            <div className="rounded-xl bg-black/20 p-3">
              <p className="text-[11px] text-zinc-500">Draft PR packets</p>
              <p className="mt-1 font-bold">{run.counts.draftPrPackets}</p>
              <p className="mt-1 text-[11px] text-zinc-600">
                productionTouched {String(run.productionTouched)}
              </p>
              <p className="mt-1 text-[11px] text-zinc-600">
                persistent gap {run.persistentMemoryGapStatus ?? "기록 없음"}
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-white/5 p-3 text-xs text-zinc-400">
            <p>
              baseline promotion gate ·{" "}
              <span className={run.baselinePromotionBlocked ? "text-amber-300" : "text-emerald-300"}>
                {run.baselinePromotionGateStatus ?? "기록 없음"}
                {run.baselinePromotionBlocked == null
                  ? ""
                  : run.baselinePromotionBlocked
                    ? " · BLOCKED"
                    : " · OPEN"}
              </span>
            </p>
            {readiness ? (
              <p className="mt-1 text-zinc-500">
                case readiness · deterministic {readiness.readyDeterministic} · durable ledger{" "}
                {readiness.readyDurableLedger} · mutation {readiness.readyMutationLifecycle} · mixed{" "}
                {readiness.mixedOwner} · harness 필요 {readiness.harnessExtensionRequired}
              </p>
            ) : null}
          </div>

          {promptPacking ? (
            <details className="mt-3 rounded-xl border border-cyan-500/10 bg-cyan-950/5 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-cyan-200">
                Prompt packing sentinel · {promptPacking.status} · invariant{" "}
                {promptPacking.invariantPasses}/{promptPacking.invariantTotal}
              </summary>
              <div className="mt-3 text-xs text-zinc-400">
                <p>
                  policy {promptPacking.policyId || "unknown"} · RAW{" "}
                  {promptPacking.rawRecentExchanges} · {promptPacking.rollingSummaryInterval}턴 요약 ·
                  Medium N{promptPacking.mediumTermBlockCount} · fixture T
                  {promptPacking.currentTurnFixture}
                </p>
                {promptPacking.generatedAt ? (
                  <p className="mt-1 text-zinc-600">
                    sentinel 생성 {fmtDate(promptPacking.generatedAt)}
                  </p>
                ) : null}
                {promptPacking.failedInvariants.length ? (
                  <p className="mt-2 text-rose-300">
                    실패 invariant: {promptPacking.failedInvariants.join(", ")}
                  </p>
                ) : (
                  <p className="mt-2 text-emerald-300">
                    prompt-packing invariant 전체 통과
                  </p>
                )}
                {promptPackingTrend ? (
                  <div className="mt-3 rounded-lg border border-white/5 bg-black/15 p-2">
                    <p className="font-semibold text-zinc-300">
                      이전 cycle 대비 · {promptPackingTrend.status}
                      {promptPackingTrend.previousCycleKey
                        ? ` · ${promptPackingTrend.previousCycleKey}`
                        : ""}
                    </p>
                    {promptPackingTrend.modelSetChanged ? (
                      <p className="mt-1 text-amber-300">
                        model set 변경 · 추가{" "}
                        {promptPackingTrend.addedModels.join(", ") || "-"} · 제거{" "}
                        {promptPackingTrend.removedModels.join(", ") || "-"}
                      </p>
                    ) : null}
                    {promptPackingTrend.modelDeltas.length ? (
                      <div className="mt-2 space-y-1">
                        {promptPackingTrend.modelDeltas.map((model) => (
                          <p key={model.modelId} className="font-mono text-[11px] text-zinc-500">
                            {model.modelId} · N15 Δ{" "}
                            {model.n15DeltaInputTokensDelta >= 0 ? "+" : ""}
                            {model.n15DeltaInputTokensDelta} · Medium{" "}
                            {model.mediumTokensDelta >= 0 ? "+" : ""}
                            {model.mediumTokensDelta} · {model.verdict}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    {promptPackingTrend.note ? (
                      <p className="mt-2 text-zinc-600">{promptPackingTrend.note}</p>
                    ) : null}
                  </div>
                ) : null}

                {promptPacking.models.length ? (
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-[11px]">
                      <thead className="text-zinc-600">
                        <tr>
                          <th className="pb-1 pr-3">model</th>
                          <th className="pb-1 pr-3">baseline</th>
                          <th className="pb-1 pr-3">N15 input</th>
                          <th className="pb-1 pr-3">N15 Δ</th>
                          <th className="pb-1 pr-3">Medium</th>
                          <th className="pb-1">safe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {promptPacking.models.map((model) => (
                          <tr key={model.modelId} className="border-t border-white/5">
                            <td className="py-1 pr-3 font-mono text-cyan-100">
                              {model.modelId}
                            </td>
                            <td className="py-1 pr-3">{model.baselineInputTokens}</td>
                            <td className="py-1 pr-3">{model.n15InputTokens}</td>
                            <td className="py-1 pr-3">+{model.n15DeltaInputTokens}</td>
                            <td className="py-1 pr-3">{model.n15MediumTokens}</td>
                            <td className="py-1">
                              {model.safeForPolicyConsideration ? "YES" : "NO"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}

          {run.effectiveness ? (
            <details className="mt-3 rounded-xl border border-cyan-500/10 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-cyan-200">
                연구 자동화 효과 / 병목
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-lg bg-black/15 p-2 text-xs">
                  <p className="text-[10px] text-zinc-500">후보 funnel</p>
                  <p className="mt-1 font-semibold text-zinc-300">
                    전체 {run.effectiveness.totalCandidates} · WATCH {run.effectiveness.watch} · REJECT{" "}
                    {run.effectiveness.rejected} · ACCEPT {run.effectiveness.accepted}
                  </p>
                </div>
                <div className="rounded-lg bg-black/15 p-2 text-xs">
                  <p className="text-[10px] text-zinc-500">검증 / PR</p>
                  <p className="mt-1 font-semibold text-zinc-300">
                    live {run.effectiveness.liveEvaluated} · accepted Draft{" "}
                    {run.effectiveness.acceptedDraftPrs} · implementation PR{" "}
                    {run.effectiveness.implementationPrs}
                  </p>
                </div>
                <div className="rounded-lg bg-black/15 p-2 text-xs">
                  <p className="text-[10px] text-zinc-500">재평가 대기</p>
                  <p className="mt-1 font-semibold text-zinc-300">
                    cooldown 만료 {run.effectiveness.dueForReevaluation}
                  </p>
                </div>
                <div className="rounded-lg bg-black/15 p-2 text-xs">
                  <p className="text-[10px] text-zinc-500">반복 WATCH</p>
                  <p className="mt-1 font-semibold text-zinc-300">
                    {run.effectiveness.repeatedWatch}
                  </p>
                </div>
              </div>

              {run.effectiveness.watchBottlenecks.length ? (
                <div className="mt-3 space-y-2">
                  <p className="text-[11px] font-bold text-zinc-400">WATCH 병목</p>
                  {run.effectiveness.watchBottlenecks.map((row) => (
                    <div key={row.decision} className="rounded-lg bg-black/15 p-2 text-xs">
                      <p className="font-semibold text-zinc-300">
                        {row.decision} · {row.candidates}건
                      </p>
                      {row.examples.length ? (
                        <p className="mt-1 font-mono text-[10px] text-zinc-600">
                          {row.examples.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {run.effectiveness.bySourceKind.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-[11px] text-zinc-400">
                    <thead className="text-zinc-600">
                      <tr>
                        <th className="py-1 pr-3">source</th>
                        <th className="py-1 pr-3">후보</th>
                        <th className="py-1 pr-3">WATCH</th>
                        <th className="py-1 pr-3">REJECT</th>
                        <th className="py-1 pr-3">ACCEPT</th>
                        <th className="py-1 pr-3">Draft</th>
                        <th className="py-1 pr-3">impl PR</th>
                        <th className="py-1">live</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.effectiveness.bySourceKind.map((row) => (
                        <tr key={row.sourceKind} className="border-t border-white/5">
                          <td className="py-1.5 pr-3 font-mono text-zinc-300">{row.sourceKind}</td>
                          <td className="py-1.5 pr-3">{row.candidates}</td>
                          <td className="py-1.5 pr-3">{row.watch}</td>
                          <td className="py-1.5 pr-3">{row.rejected}</td>
                          <td className="py-1.5 pr-3">{row.accepted}</td>
                          <td className="py-1.5 pr-3">{row.acceptedDraftPrs}</td>
                          <td className="py-1.5 pr-3">{row.implementationPrs}</td>
                          <td className="py-1.5">{row.liveEvaluated}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </details>
          ) : null}

          {run.insights.length ? (
            <details className="mt-3 rounded-xl border border-fuchsia-500/10 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-fuchsia-200">
                최신 자동 분석 상세 {run.insights.length}건
              </summary>
              <div className="mt-2 space-y-2">
                {run.insights.map((insight, index) => (
                  <div
                    key={insight.kind + insight.key + index}
                    className="rounded-lg bg-black/15 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-fuchsia-950/60 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-300">
                        {insight.kind}
                      </span>
                      <p className="font-mono text-fuchsia-100">{insight.key}</p>
                    </div>
                    <p className="mt-1 font-semibold text-zinc-300">{insight.status}</p>
                    {insight.summary ? (
                      <p className="mt-1 whitespace-pre-wrap text-zinc-500">
                        {insight.summary}
                      </p>
                    ) : null}
                    {insight.nextAction ? (
                      <p className="mt-1 whitespace-pre-wrap text-zinc-400">
                        다음: {insight.nextAction}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {run.decisions.length ? (
            <details className="mt-3 rounded-xl border border-white/5 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-zinc-300">
                최신 주요 decision {run.decisions.length}건
              </summary>
              <div className="mt-2 space-y-2">
                {run.decisions.map((decision) => (
                  <div
                    key={decision.candidateKey + decision.decision}
                    className="rounded-lg bg-black/15 p-2 text-xs"
                  >
                    <p className="font-mono text-fuchsia-200">{decision.candidateKey}</p>
                    <p className="mt-1 font-semibold text-zinc-300">{decision.decision}</p>
                    <p className="mt-1 text-zinc-500">{decision.reason}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          {projection.status === "UNAVAILABLE"
            ? "Memory Research durable report를 읽지 못했습니다."
            : "아직 persisted Memory Research cycle이 없습니다."}
        </p>
      )}

      {hasPipeline ? (
        <div className="mt-4 rounded-xl border border-fuchsia-500/10 bg-black/10 p-3">
          <p className="text-xs font-bold text-fuchsia-200">
            연구 → live 검증 → Draft PR 파이프라인
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="rounded-lg bg-black/20 p-2">
              <p className="text-[10px] text-zinc-500">live 대기</p>
              <p className="mt-1 font-bold">{pipeline.pendingLiveExperiments}</p>
            </div>
            <div className="rounded-lg bg-black/20 p-2">
              <p className="text-[10px] text-zinc-500">live 기록</p>
              <p className="mt-1 font-bold">{pipeline.recordedLiveExperiments}</p>
            </div>
            <div className="rounded-lg bg-black/20 p-2">
              <p className="text-[10px] text-zinc-500">implementation PR 대기</p>
              <p className="mt-1 font-bold">{pipeline.pendingImplementationPrs}</p>
            </div>
            <div className="rounded-lg bg-black/20 p-2">
              <p className="text-[10px] text-zinc-500">implementation PR 기록</p>
              <p className="mt-1 font-bold">{pipeline.implementationPrs}</p>
            </div>
            <div className="rounded-lg bg-black/20 p-2">
              <p className="text-[10px] text-zinc-500">ACCEPTED Draft 기록</p>
              <p className="mt-1 font-bold">{pipeline.acceptedDraftPrs}</p>
            </div>
          </div>

          {pipeline.items.length ? (
            <details className="mt-3 border-t border-white/5 pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-zinc-300">
                pipeline 후보 {pipeline.items.length}건
              </summary>
              <div className="mt-2 space-y-2">
                {pipeline.items.map((item) => (
                  <div
                    key={item.candidateKey}
                    className="rounded-lg border border-white/5 bg-black/15 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="break-all font-mono text-fuchsia-200">
                          {item.candidateKey}
                        </p>
                        <p className="mt-1 text-zinc-400">
                          {item.lastDecision || item.state || "상태 기록 없음"}
                        </p>
                        {item.liveCandidateModel ? (
                          <p className="mt-1 text-zinc-500">
                            live · {item.liveCandidateModel}
                            {item.liveGateDecision ? ` · ${item.liveGateDecision}` : ""}
                            {item.liveCostUsdPer1kTurns == null
                              ? ""
                              : ` · $ ${item.liveCostUsdPer1kTurns.toFixed(4)}/1k turns`}
                          </p>
                        ) : null}
                        {item.liveEvaluatedAt ? (
                          <p className="mt-1 text-zinc-600">
                            live 평가 {fmtDate(item.liveEvaluatedAt)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {item.draftPrUrl ? (
                          <a
                            href={item.draftPrUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-white/10 px-2 py-1 text-[11px] font-semibold text-fuchsia-300 hover:bg-white/5"
                          >
                            ACCEPTED Draft ↗
                          </a>
                        ) : null}
                        {item.implementationPrUrl ? (
                          <a
                            href={item.implementationPrUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-white/10 px-2 py-1 text-[11px] font-semibold text-fuchsia-300 hover:bg-white/5"
                          >
                            Implementation PR ↗
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-zinc-600">
          live experiment / implementation Draft 파이프라인 대기 항목이 없습니다.
        </p>
      )}

      {projection.error ? (
        <p className="mt-3 text-xs text-rose-300">{projection.error}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {projection.githubRunUrl ? (
          <a
            href={projection.githubRunUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-300 hover:bg-white/5"
          >
            최신 GitHub run / artifact ↗
          </a>
        ) : null}
        {projection.persistedReportUrl ? (
          <a
            href={projection.persistedReportUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-300 hover:bg-white/5"
          >
            persisted cycle JSON ↗
          </a>
        ) : null}
      </div>
    </section>
  );
}

function SupplierDiscoverySection({
  candidate,
}: {
  candidate: SupplierCandidateRecord;
}) {
  const rows: Array<[string, string]> = [
    ["product", `${candidate.productKind} · ${candidate.productId}`],
    ["canonical origin", candidate.canonicalOrigin],
    ["discovery source", candidate.discoverySource],
    ["public screening", `${candidate.publicScreenStatus} · ${candidate.publicScreenReasons.join(", ")}`],
    ["지원 active RP 모델", candidate.supportedActiveModelIds.join(", ") || "공개 정보 없음"],
    ["price advantage", `${candidate.priceAdvantage} · ${candidate.priceUnit}`],
    ["stability", candidate.publicStabilityEvidence ?? "unverified"],
    ["privacy / ZDR", candidate.privacyZdrStatus],
    ["credential", `${candidate.credentialRequirement} · ${candidate.credentialState}`],
    ["live qualification", `${candidate.liveQualification.status} · ${candidate.liveQualification.reason}`],
    ["promotion readiness", candidate.promotion.readiness],
    ["STOP reason", candidate.promotion.stopReason],
  ];
  return (
    <article className="rounded-xl border border-white/10 bg-black/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-zinc-100">
            {candidate.companyName}{" "}
            <span className="font-mono text-sm text-zinc-400">{candidate.supplierId}</span>
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            {candidate.canonicalOrigin}
            {candidate.advertisedApiBaseUrl ? ` · advertised API ${candidate.advertisedApiBaseUrl}` : ""}
          </p>
        </div>
        <span className={"rounded px-2 py-1 text-xs font-bold " + badgeClass(candidate.status)}>
          {candidate.status}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/5 px-3 py-2">
            <dt className="text-[11px] text-zinc-500">{label}</dt>
            <dd className="mt-1 break-words text-xs text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[11px] text-zinc-600">
        evidence {candidate.evidenceFreshness} · route Draft PR{" "}
        {candidate.promotion.draftRoutePrEligible ? "eligible" : "not eligible"} · automatic merge{" "}
        {candidate.promotion.automaticMergeEligible ? "eligible" : "0"}
      </p>
    </article>
  );
}

function ttlRecommendationLabel(value: string): string {
  if (value === "KEEP_5M") return "5분 TTL 유지가 유리";
  if (value === "ONE_HOUR_WOULD_BE_CHEAPER_IF_SUPPORTED") {
    return "1시간 TTL이 더 저렴할 가능성";
  }
  return "표본 부족 — 판단 보류";
}

export default async function AdminAutomationReportsPage() {
  const admin = await requireAdminUser();
  if (!admin) redirect("/login?next=/admin/automation-reports");

  const db = getDb();
  const [github, supplyDrafts, postDeploy] = await Promise.all([
    fetchGithubScheduledAutomationProjection(),
    fetchGithubSupplyAutoDraftProjection(),
    fetchPostDeployVerificationProjection(),
  ]);
  const memoryRuntime = buildAdminMemoryRuntimeStatus(process.env);
  const [codeHealth, decisionRadar, memoryResearch] = await Promise.all([
    fetchCodeHealthAdminProjection(github.groups),
    fetchDecisionRadarAdminProjection(github.groups),
    fetchMemoryResearchAdminProjection(github.groups),
  ]);
  const financeNow = new Date();
  const financeSummary = buildAdminFinanceSummary(
    db,
    currentKstMonthKey(financeNow.getTime())
  );
  const financePricing = buildMainRpPricingObservabilityProjection({
    db,
    now: financeNow,
  });
  const financeAnomalies = buildFinanceAnomalyReport({
    summary: financeSummary,
    pricing: financePricing,
    now: financeNow,
  });
  const supplierDiscovery = buildSupplierDiscoveryReport();
  const ttlReports = listMainRpCacheTtlReports(db, 12);
  const schedulers = listSchedulerRunOverview(db);
  const latestTtl = ttlReports[0] ?? null;
  const githubFailures = github.groups.filter(
    (group) => group.latest.conclusion && group.latest.conclusion !== "success"
  ).length;
  const schedulerProblems = schedulers.filter((row) =>
    ["FAILED", "STALE", "STALE_BLOCKED", "MISSING"].includes(row.state)
  ).length;
  const codeHealthProblems = [codeHealth.weekly.status, codeHealth.monthly.status].filter(
    (status) => status === "WARNING" || status === "FAILED" || status === "UNAVAILABLE"
  ).length;
  const decisionRadarProblems =
    decisionRadar.status === "UNAVAILABLE" ||
    ["FAILED", "PARTIAL", "REVIEW_CANDIDATE"].includes(
      decisionRadar.run?.status ?? ""
    )
      ? 1
      : 0;
  const memoryResearchProblems =
    memoryResearch.status === "UNAVAILABLE" ||
    memoryResearch.run?.baselinePromotionBlocked === true ||
    memoryResearch.run?.productionTouched === true ||
    memoryResearch.run?.promptPackingAudit?.status === "FAIL" ||
    memoryResearch.freshnessStatus === "STALE_CYCLE" ||
    memoryResearch.freshnessStatus === "PERSISTENCE_LAG"
      ? 1
      : 0;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 text-zinc-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/settings" className="text-sm text-zinc-500 hover:text-zinc-200">
            ← 설정
          </Link>
          <h1 className="mt-2 text-2xl font-black">자동화 보고서</h1>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-zinc-500">
            기존 GitHub 정기 감사와 사이트 내부 durable scheduler의 결과를 한곳에 모아 보는
            관리자 전용 read-only 화면입니다. 실행 owner나 자동화 정책은 이 화면에서 바꾸지 않습니다.
          </p>
        </div>
        <Link
          href="/admin/ops"
          className="rounded-xl border border-white/10 bg-[#11131a] px-4 py-2 text-sm font-semibold hover:bg-[#181b24]"
        >
          운영 예외함 →
        </Link>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
          <p className="text-xs text-zinc-500">GitHub 정기 자동화</p>
          <p className="mt-2 text-2xl font-black">{github.groups.length}개</p>
          <p className="mt-1 text-xs text-zinc-600">최근 scheduled run 기준</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
          <p className="text-xs text-zinc-500">사이트 내부 scheduler</p>
          <p className="mt-2 text-2xl font-black">{schedulers.length}개</p>
          <p className="mt-1 text-xs text-zinc-600">durable registry 기준</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#11131a] p-4">
          <p className="text-xs text-zinc-500">확인 필요</p>
          <p className="mt-2 text-2xl font-black text-amber-300">
            {githubFailures +
              schedulerProblems +
              codeHealthProblems +
              decisionRadarProblems +
              memoryResearchProblems +
              financeAnomalies.anomalies.length +
              supplyDrafts.drafts.length}건
          </p>
          <p className="mt-1 text-xs text-zinc-600">실패·누락·stale 최신 상태</p>
        </div>
      </section>

      <PostDeployVerificationCard view={postDeploy} />

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CodeHealthCard card={codeHealth.weekly} />
        <CodeHealthCard card={codeHealth.monthly} />
      </div>

      <FinanceAnomalyCard report={financeAnomalies} />

      <section className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-emerald-200">
              Weekly Decision Model Radar
            </h2>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-zinc-500">
              OpenRouter Decisions 신모델을 주 1회 자동 발견하고, 새/변경 후보만 현재 JEV 업무
              fixture로 비교합니다. 결과가 좋아도 production model pin은 자동 변경하지 않습니다.
            </p>
          </div>
          <span
            className={
              "rounded px-2 py-1 text-xs font-bold " +
              badgeClass(decisionRadar.run?.status ?? decisionRadar.status)
            }
          >
            {decisionRadar.run?.status ?? decisionRadar.status}
          </span>
        </div>

        {decisionRadar.run ? (
          <>
            <p className="mt-3 text-xs text-zinc-500">
              실행 시각 · {fmtDate(decisionRadar.run.ranAt)}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">발견 모델</p>
                <p className="mt-1 font-bold">{decisionRadar.run.discoveredModels}</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">신규/변경</p>
                <p className="mt-1 font-bold">
                  {decisionRadar.run.changedCandidates.length}
                </p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">이번 주 benchmark</p>
                <p className="mt-1 font-bold">
                  {decisionRadar.run.benchmarkedCandidates.length}
                </p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">provider calls</p>
                <p className="mt-1 font-bold">{decisionRadar.run.providerCalls}</p>
              </div>
            </div>

            {decisionRadar.run.baseline ? (
              <div className="mt-3 rounded-xl border border-white/5 p-3 text-xs text-zinc-400">
                기준 {decisionRadar.run.baseline.model} · accuracy{" "}
                {decisionRadar.run.baseline.accuracy == null
                  ? "n/a"
                  : (decisionRadar.run.baseline.accuracy * 100).toFixed(1) + "%"}
                {" · "}critical miss {decisionRadar.run.baseline.criticalMisses}
                {" · "}p50 {decisionRadar.run.baseline.latencyMs.p50 ?? "n/a"}ms
              </div>
            ) : null}

            {decisionRadar.run.evaluations.length ? (
              <div className="mt-4 space-y-2">
                {decisionRadar.run.evaluations.map((evaluation) => (
                  <div
                    key={evaluation.model}
                    className="rounded-xl border border-white/5 bg-black/10 p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-zinc-200">{evaluation.model}</span>
                      <span
                        className={
                          "rounded px-2 py-1 text-[11px] font-bold " +
                          (evaluation.globalReplacementCandidate ||
                          evaluation.suiteCandidates.length
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-white/5 text-zinc-500")
                        }
                      >
                        {evaluation.globalReplacementCandidate
                          ? "GLOBAL REVIEW"
                          : evaluation.suiteCandidates.length
                            ? "SUITE REVIEW"
                            : "NO CHANGE"}
                      </span>
                    </div>
                    <p className="mt-2 text-zinc-500">
                      accuracy{" "}
                      {evaluation.summary.accuracy == null
                        ? "n/a"
                        : (evaluation.summary.accuracy * 100).toFixed(1) + "%"}
                      {" · "}critical miss {evaluation.summary.criticalMisses}
                      {" · "}cost{" "}
                      {evaluation.summary.reportedCostUsd == null
                        ? "n/a"
                        : "$" + evaluation.summary.reportedCostUsd.toFixed(6)}
                      {" · "}p50 {evaluation.summary.latencyMs.p50 ?? "n/a"}ms
                    </p>
                    {evaluation.suiteCandidates.length ? (
                      <p className="mt-1 text-amber-300/90">
                        JEV보다 우수한 업무 후보: {evaluation.suiteCandidates.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-zinc-500">
                {decisionRadar.run.status === "NO_CHANGE"
                  ? "이번 주에는 새로 비교할 Decisions 모델이 없습니다."
                  : "비교 결과가 아직 없습니다."}
              </p>
            )}

            {decisionRadar.run.deferredCandidates.length ? (
              <p className="mt-3 text-xs text-zinc-500">
                다음 실행으로 이월: {decisionRadar.run.deferredCandidates.join(", ")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">
            아직 정기 실행 결과가 없습니다. 첫 scheduled run 이후 여기에 표시됩니다.
          </p>
        )}

        {decisionRadar.error ? (
          <p className="mt-3 text-xs text-rose-300">{decisionRadar.error}</p>
        ) : null}
        {decisionRadar.githubRunUrl ? (
          <div className="mt-4">
            <a
              href={decisionRadar.githubRunUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-white/5"
            >
              상세 GitHub benchmark / artifact ↗
            </a>
          </div>
        ) : null}
      </section>

      <MemoryResearchCard projection={memoryResearch} runtime={memoryRuntime} />

      <section className="mt-6 rounded-2xl border border-violet-500/20 bg-violet-950/10 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-violet-200">월간 Opus 5.5 캐시 TTL 경제성</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              실제 일반 사용자 턴의 요청 시작 간격을 월 단위로 집계합니다. 재생성 reuse는
              시작시각 증거가 달라 보수적으로 제외하며, 자동으로 TTL을 변경하지 않습니다.
            </p>
          </div>
          {latestTtl ? (
            <span
              className={
                "rounded px-2 py-1 text-xs font-bold " +
                badgeClass(latestTtl.recommendation === "INSUFFICIENT_SAMPLE" ? "warning" : "success")
              }
            >
              {ttlRecommendationLabel(latestTtl.recommendation)}
            </span>
          ) : null}
        </div>

        {latestTtl ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">대상 월</p>
                <p className="mt-1 font-bold">{latestTtl.yearMonth}</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">관측 전환</p>
                <p className="mt-1 font-bold">{latestTtl.transitionCount.toLocaleString()}회</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">5분 이내</p>
                <p className="mt-1 font-bold">{latestTtl.gapBuckets.within5Minutes.toLocaleString()}회</p>
              </div>
              <div className="rounded-xl bg-black/20 p-3">
                <p className="text-[11px] text-zinc-500">5~60분</p>
                <p className="mt-1 font-bold">{latestTtl.gapBuckets.over5Within60Minutes.toLocaleString()}회</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-white/5 p-3 text-sm">
                <p className="text-xs text-zinc-500">5분 TTL 정규화 비용</p>
                <p className="mt-1 font-mono">
                  {"$"}{latestTtl.normalizedCostUsdPerMillionPrefix.fiveMinuteTtl.toFixed(3)}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 p-3 text-sm">
                <p className="text-xs text-zinc-500">1시간 TTL 가정 비용</p>
                <p className="mt-1 font-mono">
                  {"$"}{latestTtl.normalizedCostUsdPerMillionPrefix.oneHourTtlHypothetical.toFixed(3)}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 p-3 text-sm">
                <p className="text-xs text-zinc-500">1시간 대비 차이</p>
                <p className="mt-1 font-mono">
                  {latestTtl.normalizedCostUsdPerMillionPrefix.oneHourDeltaPercentVsFiveMinute == null
                    ? "계산 불가"
                    : latestTtl.normalizedCostUsdPerMillionPrefix.oneHourDeltaPercentVsFiveMinute.toFixed(1) + "%"}
                </p>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-amber-200/80">
              1시간 TTL provider 지원 상태: {latestTtl.providerOneHourSupport}. 경제성이 좋아도
              provider 계약/호환성이 확인되기 전에는 자동 전환하지 않습니다.
            </p>
          </>
        ) : (
          <p className="mt-4 text-sm text-zinc-500">
            아직 월간 TTL 보고서가 없습니다. 첫 due slot 실행 후 여기에 누적됩니다.
          </p>
        )}

        {ttlReports.length > 1 ? (
          <details className="mt-4 rounded-xl border border-white/5 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-300">
              이전 월 보고서 {ttlReports.length - 1}개
            </summary>
            <div className="mt-3 space-y-2">
              {ttlReports.slice(1).map((report) => (
                <div
                  key={report.yearMonth}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400"
                >
                  <span>{report.yearMonth}</span>
                  <span>{ttlRecommendationLabel(report.recommendation)}</span>
                  <span>전환 {report.transitionCount.toLocaleString()}회</span>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>

      <section className="mt-6 rounded-2xl border border-teal-500/20 bg-teal-950/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-teal-200">독립 공급처 discovery</h2>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-zinc-500">
              신규 독립 inference supplier 후보의 공개 심사 결과입니다. 후보 기록은 production
              provider registry가 아니며, cross-provider route Draft PR을 만들지 않습니다.
              provider generation calls {supplierDiscovery.providerGenerationCalls}.
            </p>
          </div>
          <span className="rounded bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-300">
            후보 {supplierDiscovery.candidates.length}건
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {supplierDiscovery.candidates.map((candidate) => (
            <SupplierDiscoverySection key={candidate.supplierId} candidate={candidate} />
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          알려진 direct supplier: {supplierDiscovery.knownDirectSupplierIds.join(", ")}. 이 화면은
          OpenRouter를 다시 호출하지 않습니다. 월간 supply radar artifact가 기존 endpoint owner의
          provider 이름을 붙입니다. 유료 search API와 Artificial Analysis commercial API는
          호출하지 않습니다.
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-violet-500/20 bg-violet-950/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-black text-violet-200">Main RP 공급망 Draft 검토 대기</h2>
            <p className="mt-1 max-w-4xl text-xs leading-relaxed text-zinc-500">
              공급망 promotion gate를 통과해 자동 생성된 열린 PR을 GitHub 자체 상태에서
              직접 읽습니다. 별도 DB 상태를 만들지 않으며 PR이 닫히거나 머지되면 이 목록에서도
              자동으로 사라집니다.
            </p>
          </div>
          <span className={"rounded px-2 py-1 text-xs font-bold " + badgeClass(
            supplyDrafts.status === "OK" && supplyDrafts.drafts.length === 0 ? "success" : "warning"
          )}>
            {supplyDrafts.status === "OK"
              ? `검토 대기 ${supplyDrafts.drafts.length}건`
              : "UNAVAILABLE"}
          </span>
        </div>

        {supplyDrafts.status !== "OK" ? (
          <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 text-sm text-amber-200">
            자동 생성 공급망 Draft 목록을 읽지 못했습니다: {supplyDrafts.error ?? "unknown"}
          </div>
        ) : supplyDrafts.drafts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-950/10 p-4 text-sm text-emerald-200">
            현재 검토 대기 중인 자동 공급망 Draft PR이 없습니다.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {supplyDrafts.drafts.map((draft) => (
              <article
                key={draft.number}
                className="rounded-xl border border-white/10 bg-black/15 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-violet-300">PR #{draft.number}</p>
                    <h3 className="mt-1 font-bold text-zinc-100">{draft.title}</h3>
                    <p className="mt-2 text-xs text-zinc-400">
                      모델 <span className="font-mono text-zinc-200">{draft.modelId}</span>
                      {" · "}후보 provider{" "}
                      <span className="font-mono text-zinc-200">
                        {draft.candidateProviderSlug}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      생성 {fmtDate(draft.createdAt)} · {draft.draft ? "Draft" : "Ready"} ·{" "}
                      {draft.state}
                    </p>
                  </div>
                  <a
                    href={draft.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-white/5"
                  >
                    PR 검토하기 ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-black">GitHub 정기 자동감사</h2>
        <p className="mt-1 text-xs text-zinc-500">
          GitHub Actions의 schedule 이벤트 실행을 자동 수집합니다. 결과 원문은 각 실행 링크에서
          artifact와 job summary까지 확인할 수 있습니다.
        </p>
        {github.status !== "OK" ? (
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-950/10 p-4 text-sm text-amber-200">
            GitHub 자동감사 목록을 읽지 못했습니다: {github.error ?? "unknown"}
          </div>
        ) : github.groups.length === 0 ? (
          <div className="mt-3 rounded-xl border border-white/10 bg-[#11131a] p-4 text-sm text-zinc-500">
            최근 scheduled run이 없습니다.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {github.groups.map((group) => {
              const latestState = group.latest.conclusion ?? group.latest.status;
              return (
                <article
                  key={group.key}
                  className="rounded-2xl border border-white/10 bg-[#11131a] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-bold">{group.name}</h3>
                      <p className="mt-1 truncate font-mono text-[11px] text-zinc-600">
                        {group.path}
                      </p>
                    </div>
                    <span
                      className={
                        "shrink-0 rounded px-2 py-1 text-[11px] font-bold " +
                        badgeClass(latestState)
                      }
                    >
                      {latestState}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-zinc-500">
                    최근 실행 #{group.latest.runNumber} · {fmtDate(group.latest.createdAt)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={group.latest.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-300 hover:bg-white/5"
                    >
                      최신 보고서/실행 보기 ↗
                    </a>
                  </div>
                  <details className="mt-3 border-t border-white/5 pt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-zinc-400">
                      최근 실행 기록
                    </summary>
                    <div className="mt-2 space-y-1.5">
                      {group.history.slice(0, 6).map((run) => (
                        <a
                          key={run.id}
                          href={run.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                        >
                          <span>#{run.runNumber} · {fmtDate(run.createdAt)}</span>
                          <span>{run.conclusion ?? run.status}</span>
                        </a>
                      ))}
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-black">사이트 내부 자동 작업</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Railway 프로세스의 durable scheduler registry를 그대로 읽습니다. 실행 결과를 고치거나
          재실행하는 화면이 아닙니다.
        </p>
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-white/5 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-3">작업</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">cron</th>
                  <th className="px-4 py-3">latest</th>
                  <th className="px-4 py-3">current slot</th>
                </tr>
              </thead>
              <tbody>
                {schedulers.map((row) => (
                  <tr key={row.jobName} className="border-t border-white/5">
                    <td className="px-4 py-3">
                      <p className="font-semibold">{row.label}</p>
                      <p className="font-mono text-[11px] text-zinc-600">{row.jobName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "rounded px-2 py-1 text-[11px] font-bold " + badgeClass(row.state)
                        }
                      >
                        {row.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">
                      {row.cronExpression}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {row.latest?.finished_at
                        ? fmtDate(row.latest.finished_at)
                        : row.latest?.started_at
                          ? fmtDate(row.latest.started_at)
                          : "기록 없음"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">
                      {row.currentSlotKey}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
