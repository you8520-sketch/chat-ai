import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  GithubAutomationProjection,
  GithubScheduledAutomationGroup,
  GithubScheduledAutomationRun,
  GithubSupplyAutoDraftProjection,
} from "@/lib/adminAutomationReports";
import {
  ATTENTION_KEY,
  buildAutomationAttention,
  type AttentionInput,
} from "@/lib/adminAutomationAttention";
import { buildAutomationCoverage } from "@/lib/adminAutomationCoverage";
import { MEMORY_RESEARCH_WORKFLOW_PATH } from "@/lib/adminMemoryResearchReports";
import { scanScheduledWorkflowDefinitions } from "@/lib/codeHealth/automationHealth";
import type { CodeHealthAdminCard } from "@/lib/codeHealth/reports";
import {
  CODE_HEALTH_MONTHLY_WORKFLOW_PATH,
  CODE_HEALTH_WEEKLY_WORKFLOW_PATH,
  emptyCodeHealthCounts,
} from "@/lib/codeHealth/types";
import { DECISION_RADAR_WORKFLOW_PATH } from "@/lib/decisionModelRadar";
import { DOMAIN_SSL_WORKFLOW_PATH } from "@/lib/domainSslMonitor";
import type { SchedulerRunOverview } from "@/lib/schedulerRunShared";

const NOW = new Date("2026-10-12T09:20:00Z");
const FRESH = "2026-10-12T04:00:00Z";
const OLD = "2026-08-01T04:00:00Z";
const DEFINITIONS = scanScheduledWorkflowDefinitions(process.cwd());

let nextId = 1000;
function run(
  def: { name: string; path: string },
  createdAt: string,
  conclusion: string | null,
  status = "completed"
): GithubScheduledAutomationRun {
  const id = nextId++;
  return {
    id,
    name: def.name,
    path: def.path,
    status,
    conclusion,
    runNumber: id,
    createdAt,
    updatedAt: createdAt,
    htmlUrl: `https://github.test/actions/runs/${id}`,
  };
}

function group(
  def: { name: string; path: string },
  history: GithubScheduledAutomationRun[]
): GithubScheduledAutomationGroup {
  return {
    key: `${def.name}::${def.path}`,
    name: def.name,
    path: def.path,
    latest: history[0]!,
    history,
  };
}

function githubFor(
  overrides: Record<string, GithubScheduledAutomationRun[] | null> = {},
  extra: GithubScheduledAutomationGroup[] = []
): GithubAutomationProjection {
  const groups: GithubScheduledAutomationGroup[] = [];
  for (const def of DEFINITIONS) {
    const history =
      def.path in overrides ? overrides[def.path] : [run(def, FRESH, "success")];
    if (history && history.length) groups.push(group(def, history));
  }
  return { status: "OK", error: null, groups: [...groups, ...extra] };
}

function ledgerCard(
  kind: "weekly" | "monthly",
  patch: Partial<CodeHealthAdminCard> = {}
): CodeHealthAdminCard {
  return {
    title: kind,
    kind,
    status: "SUCCESS",
    ranAt: FRESH,
    counts: null,
    delta: null,
    githubRunUrl: "https://github.test/ledger-run",
    reportUrl: null,
    notes: [],
    ...patch,
  };
}

function baseInput(
  overrides: {
    github?: GithubAutomationProjection;
    patch?: Partial<AttentionInput>;
  } = {}
): AttentionInput {
  const github = overrides.github ?? githubFor();
  const coverage = buildAutomationCoverage({ definitions: DEFINITIONS, github, now: NOW });
  const supplyDrafts: GithubSupplyAutoDraftProjection = {
    status: "OK",
    error: null,
    drafts: [],
  };
  const input: AttentionInput = {
    now: NOW,
    github,
    coverage,
    registryDefinitions: DEFINITIONS,
    codeHealth: {
      status: "OK",
      error: null,
      weekly: ledgerCard("weekly"),
      monthly: ledgerCard("monthly"),
    },
    decisionRadar: { status: "OK", error: null, run: null, githubRunUrl: null },
    memoryResearch: {
      status: "EMPTY",
      error: null,
      run: null,
      githubRunUrl: null,
      persistedReportUrl: null,
      freshnessStatus: "UNKNOWN",
      freshnessReason: null,
      pipeline: {},
    } as unknown as AttentionInput["memoryResearch"],
    domainSsl: { status: "OK", error: null, latest: null },
    postDeploy: { status: "OK", error: null, latest: null, superseded: null },
    supplyDrafts,
    schedulers: [],
    finance: {
      generatedAt: NOW.toISOString(),
      anomalies: [],
    } as unknown as AttentionInput["finance"],
    ...overrides.patch,
  };
  return input;
}

function schedulerRow(
  state: SchedulerRunOverview["state"],
  jobName = "payout_run"
): SchedulerRunOverview {
  return {
    jobName,
    label: "정산 작업",
    cronExpression: "0 * * * *",
    currentSlotKey: "slot-1",
    activated: true,
    state,
    latest: null,
    current: null,
  } as unknown as SchedulerRunOverview;
}

describe("automation attention dashboard", () => {
  it("registers every scheduled workflow and keeps healthy ones out of the action list", () => {
    const dashboard = buildAutomationAttention(baseInput());
    assert.equal(dashboard.action.length, 0);
    for (const def of DEFINITIONS) {
      assert.equal(
        dashboard.byKey.has(ATTENTION_KEY.workflow(def.path)),
        true,
        `missing ${def.path}`
      );
    }
    assert.ok(dashboard.ok.length > 0);
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.postDeploy)!.bucket, "UNKNOWN");
  });

  it("separates OK, failed, not-run and stale workflows into different buckets", () => {
    const github = githubFor({
      [DECISION_RADAR_WORKFLOW_PATH]: [
        run({ name: "Weekly Decision Model Radar", path: DECISION_RADAR_WORKFLOW_PATH }, FRESH, "failure"),
      ],
      [DOMAIN_SSL_WORKFLOW_PATH]: null,
      [CODE_HEALTH_WEEKLY_WORKFLOW_PATH]: [
        run(
          { name: "Weekly Code Health", path: CODE_HEALTH_WEEKLY_WORKFLOW_PATH },
          OLD,
          "success"
        ),
      ],
    });
    const dashboard = buildAutomationAttention(baseInput({ github }));
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.workflow(DECISION_RADAR_WORKFLOW_PATH))!.bucket, "ACTION");
    const ssl = dashboard.byKey.get(ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH))!;
    assert.equal(ssl.bucket, "UNKNOWN");
    assert.equal(ssl.statusLabel, "실행 기록 없음");
    const weekly = dashboard.byKey.get(ATTENTION_KEY.workflow(CODE_HEALTH_WEEKLY_WORKFLOW_PATH))!;
    assert.equal(weekly.bucket, "UNKNOWN");
    assert.equal(weekly.statusLabel, "최신 확인 필요");
  });

  it("does not present an old ledger finding as a current incident", () => {
    const input = baseInput({
      patch: {
        codeHealth: {
          status: "OK",
          error: null,
          weekly: ledgerCard("weekly", {
            status: "FAILED",
            ranAt: OLD,
            counts: { requiredCleanup: 8 } as CodeHealthAdminCard["counts"],
          }),
          monthly: ledgerCard("monthly"),
        },
      },
    });
    const item = buildAutomationAttention(input).byKey.get(
      ATTENTION_KEY.workflow(CODE_HEALTH_WEEKLY_WORKFLOW_PATH)
    )!;
    assert.equal(item.bucket, "UNKNOWN");
    assert.notEqual(item.severity, "critical");
  });

  it("counts the same cause once and labels a ledger finding as a finding, not a run failure", () => {
    const weeklyDef = { name: "Weekly Code Health audit", path: CODE_HEALTH_WEEKLY_WORKFLOW_PATH };
    const github = githubFor({
      [CODE_HEALTH_WEEKLY_WORKFLOW_PATH]: [run(weeklyDef, FRESH, "failure")],
    });
    const input = baseInput({
      github,
      patch: {
        codeHealth: {
          status: "OK",
          error: null,
          weekly: ledgerCard("weekly", {
            status: "FAILED",
            counts: { requiredCleanup: 8 } as CodeHealthAdminCard["counts"],
          }),
          monthly: ledgerCard("monthly"),
        },
      },
    });
    const dashboard = buildAutomationAttention(input);
    const matching = dashboard.action.filter(
      (item) => item.key === ATTENTION_KEY.workflow(CODE_HEALTH_WEEKLY_WORKFLOW_PATH)
    );
    assert.equal(matching.length, 1);
    assert.equal(matching[0]!.opsIncidentId?.startsWith("github_automation:"), true);
    assert.ok(matching[0]!.reasons.length >= 2);

    const findingOnly = buildAutomationAttention(
      baseInput({
        patch: {
          codeHealth: {
            status: "OK",
            error: null,
            weekly: ledgerCard("weekly", {
              status: "FAILED",
              counts: { requiredCleanup: 8 } as CodeHealthAdminCard["counts"],
            }),
            monthly: ledgerCard("monthly"),
          },
        },
      })
    ).byKey.get(ATTENTION_KEY.workflow(CODE_HEALTH_WEEKLY_WORKFLOW_PATH))!;
    assert.equal(findingOnly.bucket, "ACTION");
    assert.match(findingOnly.reasons.join(" "), /보안 사고로 확정된 것이 아닙니다/);
    assert.match(findingOnly.reasons.join(" "), /실행 실패와는 별개/);
    assert.equal(findingOnly.opsIncidentId, null);
  });

  it("collapses a global GitHub outage into one action item and never into normal", () => {
    const input = baseInput({
      github: { status: "UNAVAILABLE", error: "GitHub Actions API 403", groups: [] },
      patch: {
        codeHealth: {
          status: "UNAVAILABLE",
          error: "GitHub Actions API 403",
          weekly: ledgerCard("weekly", { status: "UNAVAILABLE", ranAt: null }),
          monthly: ledgerCard("monthly", { status: "UNAVAILABLE", ranAt: null }),
        },
      },
    });
    const dashboard = buildAutomationAttention(input);
    assert.deepEqual(
      dashboard.action.map((item) => item.key),
      [ATTENTION_KEY.githubLookup]
    );
    assert.equal(dashboard.ok.length, 0);
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.githubLookup)!.technical[0], "GitHub Actions API 403");
  });

  it("keeps a single-report lookup failure as unknown, never as normal", () => {
    const input = baseInput({
      patch: { domainSsl: { status: "UNAVAILABLE", error: "boom", latest: null } },
    });
    const dashboard = buildAutomationAttention(input);
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH))!.bucket, "UNKNOWN");
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH))!.statusLabel, "조회 불가");
  });

  it("does not count a REVIEW_CANDIDATE radar run or a blocked baseline promotion as an incident", () => {
    const radarInput = baseInput({
      patch: {
        decisionRadar: {
          status: "OK",
          error: null,
          githubRunUrl: null,
          run: { status: "REVIEW_CANDIDATE", ranAt: FRESH },
        } as unknown as AttentionInput["decisionRadar"],
        memoryResearch: {
          status: "OK",
          error: null,
          githubRunUrl: null,
          persistedReportUrl: null,
          freshnessStatus: "FRESH",
          freshnessReason: null,
          pipeline: {},
          run: {
            finishedAt: FRESH,
            baselinePromotionBlocked: true,
            productionTouched: false,
            promptPackingAudit: null,
          },
        } as unknown as AttentionInput["memoryResearch"],
      },
    });
    const dashboard = buildAutomationAttention(radarInput);
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.workflow(DECISION_RADAR_WORKFLOW_PATH))!.bucket, "OK");
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.workflow(MEMORY_RESEARCH_WORKFLOW_PATH))!.bucket, "OK");
    assert.equal(dashboard.action.length, 0);
  });

  it("moves workflows that are no longer scheduled to history", () => {
    const retired = { name: "Retired audit", path: ".github/workflows/retired.yml" };
    const github = githubFor({}, [group(retired, [run(retired, "2026-10-03T00:00:00Z", "failure")])]);
    const dashboard = buildAutomationAttention(baseInput({ github }));
    assert.equal(dashboard.action.length, 0);
    assert.equal(dashboard.history.length, 1);
    assert.equal(dashboard.history[0]!.latestRunFailed, true);
    assert.equal(dashboard.byKey.has(ATTENTION_KEY.workflow(retired.path)), false);
  });

  it("reports auto-processing only when a run is actually in progress", () => {
    const def = DEFINITIONS.find((d) => d.path === DOMAIN_SSL_WORKFLOW_PATH)!;
    const running = githubFor({
      [DOMAIN_SSL_WORKFLOW_PATH]: [
        run(def, "2026-10-12T09:10:00Z", null, "in_progress"),
        run(def, FRESH, "success"),
      ],
    });
    const dashboard = buildAutomationAttention(baseInput({ github: running }));
    const active = dashboard.byKey.get(ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH))!;
    assert.equal(active.bucket, "AUTO");
    assert.equal(active.statusLabel, "실행 중");
    const idle = buildAutomationAttention(baseInput());
    assert.equal(idle.auto.length, 0);
  });

  it("labels queued GitHub runs as waiting, not as actively running", () => {
    const def = DEFINITIONS.find((d) => d.path === DOMAIN_SSL_WORKFLOW_PATH)!;
    const queued = githubFor({
      [DOMAIN_SSL_WORKFLOW_PATH]: [
        run(def, "2026-10-12T09:10:00Z", null, "queued"),
        run(def, FRESH, "success"),
      ],
    });
    const item = buildAutomationAttention(baseInput({ github: queued })).byKey.get(
      ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH)
    )!;
    assert.equal(item.bucket, "AUTO");
    assert.equal(item.statusLabel, "대기 중");
    assert.match(item.reasons[0]!, /아직 실행이 시작되지 않았습니다/);
  });

  it("counts domain SSL and post-deploy with no result as unknown, not ok", () => {
    const dashboard = buildAutomationAttention(
      baseInput({
        patch: {
          domainSsl: { status: "OK", error: null, latest: null },
          postDeploy: { status: "OK", error: null, latest: null, superseded: null },
        },
      })
    );
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.postDeploy)!.bucket, "UNKNOWN");
    assert.equal(dashboard.byKey.get(ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH))!.bucket, "UNKNOWN");
    assert.ok(
      dashboard.unknown.some(
        (item) =>
          item.key === ATTENTION_KEY.postDeploy ||
          item.key === ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH)
      )
    );
  });

  it("keeps a fresh domain SSL failure actionable when the coverage join is unavailable", () => {
    const item = buildAutomationAttention(
      baseInput({
        patch: {
          coverage: {
            status: "UNAVAILABLE",
            error: "workflows dir missing",
            rows: [],
            unregistered: [],
            failedCount: 0,
            unverifiedCount: 0,
            attentionCount: 0,
          },
          domainSsl: {
            status: "OK",
            error: null,
            latest: {
              state: "FAIL",
              checkedAt: FRESH,
              reason: "TLS handshake failed",
              htmlUrl: "https://github.test/ssl-run",
              runConclusion: "failure",
              attempts: 1,
              dns: { kind: "ok", addressCount: 1 },
              tls: { kind: "error", retryable: false, reason: "bad cert" },
              health: { kind: "skipped" },
            },
          },
        },
      })
    ).byKey.get(ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH))!;
    assert.equal(item.bucket, "ACTION");
    assert.match(item.reasons[0]!, /TLS handshake failed/);
  });

  it("does not treat an old domain SSL failure as current when the workflow registry is empty", () => {
    const dashboard = buildAutomationAttention(
      baseInput({
        patch: {
          registryDefinitions: [],
          coverage: {
            status: "UNAVAILABLE",
            error: "등록된 schedule workflow 목록(.github/workflows)을 읽지 못했습니다.",
            rows: [],
            unregistered: [],
            failedCount: 0,
            unverifiedCount: 0,
            attentionCount: 0,
          },
          domainSsl: {
            status: "OK",
            error: null,
            latest: {
              state: "FAIL",
              checkedAt: OLD,
              reason: "TLS expired",
              htmlUrl: "https://github.test/ssl-run-old",
              runConclusion: "failure",
              attempts: 1,
              dns: { kind: "ok", addressCount: 1 },
              tls: { kind: "error", retryable: false, reason: "expired" },
              health: { kind: "skipped" },
            },
          },
        },
      })
    );
    const item = dashboard.byKey.get(ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH))!;
    assert.equal(item.bucket, "UNKNOWN");
    assert.equal(
      dashboard.action.some((row) => row.key === ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH)),
      false
    );
  });

  it("demotes an old domain SSL failure to unknown when the coverage join is unavailable", () => {
    const item = buildAutomationAttention(
      baseInput({
        patch: {
          coverage: {
            status: "UNAVAILABLE",
            error: "workflows dir missing",
            rows: [],
            unregistered: [],
            failedCount: 0,
            unverifiedCount: 0,
            attentionCount: 0,
          },
          domainSsl: {
            status: "OK",
            error: null,
            latest: {
              state: "FAIL",
              checkedAt: OLD,
              reason: "TLS expired",
              htmlUrl: "https://github.test/ssl-run-old",
              runConclusion: "failure",
              attempts: 1,
              dns: { kind: "ok", addressCount: 1 },
              tls: { kind: "error", retryable: false, reason: "expired" },
              health: { kind: "skipped" },
            },
          },
        },
      })
    ).byKey.get(ATTENTION_KEY.workflow(DOMAIN_SSL_WORKFLOW_PATH))!;
    assert.equal(item.bucket, "UNKNOWN");
    assert.equal(item.statusLabel, "최신 확인 필요");
  });

  it("does not promote an old ledger finding to action when the workflow registry is unreadable", () => {
    const dashboard = buildAutomationAttention(
      baseInput({
        patch: {
          coverage: {
            status: "UNAVAILABLE",
            error: "workflows dir missing",
            rows: [],
            unregistered: [],
            failedCount: 0,
            unverifiedCount: 0,
            attentionCount: 0,
          },
          codeHealth: {
            status: "OK",
            error: null,
            weekly: ledgerCard("weekly", {
              status: "FAILED",
              ranAt: OLD,
              counts: { requiredCleanup: 8 } as CodeHealthAdminCard["counts"],
            }),
            monthly: ledgerCard("monthly"),
          },
          decisionRadar: {
            status: "OK",
            error: null,
            githubRunUrl: null,
            run: { status: "PARTIAL", ranAt: OLD },
          } as unknown as AttentionInput["decisionRadar"],
        },
      })
    );
    const weekly = dashboard.byKey.get(ATTENTION_KEY.workflow(CODE_HEALTH_WEEKLY_WORKFLOW_PATH))!;
    const radar = dashboard.byKey.get(ATTENTION_KEY.workflow(DECISION_RADAR_WORKFLOW_PATH))!;
    assert.equal(weekly.bucket, "UNKNOWN");
    assert.equal(radar.bucket, "UNKNOWN");
    assert.equal(
      dashboard.action.some(
        (item) =>
          item.key === ATTENTION_KEY.workflow(CODE_HEALTH_WEEKLY_WORKFLOW_PATH) ||
          item.key === ATTENTION_KEY.workflow(DECISION_RADAR_WORKFLOW_PATH)
      ),
      false
    );
    assert.match(weekly.reasons[0]!, /schedule 목록을 확인하지 못해/);
  });

  it("describes Code Health WARNING from CI/runtime anomalies without a zero cleanup count", () => {
    const item = buildAutomationAttention(
      baseInput({
        patch: {
          codeHealth: {
            status: "OK",
            error: null,
            weekly: ledgerCard("weekly", {
              status: "WARNING",
              counts: {
                ...emptyCodeHealthCounts(),
                requiredCleanup: 0,
                runtimeCiAnomalies: 1,
              },
            }),
            monthly: ledgerCard("monthly"),
          },
        },
      })
    ).byKey.get(ATTENTION_KEY.workflow(CODE_HEALTH_WEEKLY_WORKFLOW_PATH))!;
    assert.equal(item.bucket, "ACTION");
    const text = item.reasons.join(" ");
    assert.match(text, /CI·런타임 이상 징후 1건/);
    assert.doesNotMatch(text, /정리·수정 검토 필요 0건/);
  });

  it("links a supply Draft PR for approval and keeps lookup failure unknown", () => {
    const withDraft = baseInput({
      patch: {
        supplyDrafts: {
          status: "OK",
          error: null,
          drafts: [
            {
              number: 42,
              title: "supply",
              htmlUrl: "https://github.test/pull/42",
              state: "open",
              draft: true,
              createdAt: FRESH,
              updatedAt: FRESH,
              modelId: "model-x",
              candidateProviderSlug: "provider-y",
            },
          ],
        },
      },
    });
    const item = buildAutomationAttention(withDraft).byKey.get("supply_pr:42")!;
    assert.equal(item.bucket, "ACTION");
    assert.equal(item.statusLabel, "승인 대기");
    assert.deepEqual(item.links, [{ label: "PR #42", href: "https://github.test/pull/42" }]);

    const unreadable = buildAutomationAttention(
      baseInput({ patch: { supplyDrafts: { status: "UNAVAILABLE", error: "x", drafts: [] } } })
    );
    assert.equal(unreadable.byKey.get("lookup:supply_drafts")!.bucket, "UNKNOWN");
  });

  it("shows a monthly cleanup Draft PR link only when the ledger recorded one", () => {
    const withoutUrl = buildAutomationAttention(
      baseInput({
        patch: {
          codeHealth: {
            status: "OK",
            error: null,
            weekly: ledgerCard("weekly"),
            monthly: ledgerCard("monthly", { status: "WARNING", draftPrUrl: null }),
          },
        },
      })
    ).byKey.get(ATTENTION_KEY.workflow(CODE_HEALTH_MONTHLY_WORKFLOW_PATH))!;
    assert.deepEqual(withoutUrl.links, []);

    const withUrl = buildAutomationAttention(
      baseInput({
        patch: {
          codeHealth: {
            status: "OK",
            error: null,
            weekly: ledgerCard("weekly"),
            monthly: ledgerCard("monthly", {
              status: "WARNING",
              draftPrUrl: "https://github.test/pull/7",
            }),
          },
        },
      })
    ).byKey.get(ATTENTION_KEY.workflow(CODE_HEALTH_MONTHLY_WORKFLOW_PATH))!;
    assert.deepEqual(withUrl.links, [{ label: "정리 Draft PR", href: "https://github.test/pull/7" }]);
  });

  it("treats a failed post-deploy check as action and a superseded one as unknown", () => {
    const headline = {
      state: "FAILED",
      targetSha: "a".repeat(40),
      observedGitCommit: null,
      checkedAt: FRESH,
      reason: "sha mismatch",
      htmlUrl: "https://github.test/pd",
      currentDeployment: true,
      publicSmoke: { state: "PASS" },
    };
    const failed = buildAutomationAttention(
      baseInput({
        patch: {
          postDeploy: {
            status: "OK",
            error: null,
            latest: headline,
            superseded: null,
          } as unknown as AttentionInput["postDeploy"],
        },
      })
    );
    assert.equal(failed.byKey.get(ATTENTION_KEY.postDeploy)!.bucket, "ACTION");

    const old = buildAutomationAttention(
      baseInput({
        patch: {
          postDeploy: {
            status: "OK",
            error: null,
            latest: { ...headline, currentDeployment: false },
            superseded: null,
          } as unknown as AttentionInput["postDeploy"],
        },
      })
    );
    assert.equal(old.byKey.get(ATTENTION_KEY.postDeploy)!.bucket, "UNKNOWN");
  });

  it("reuses the Ops Inbox incident id for scheduler and workflow failures", () => {
    const def = DEFINITIONS.find((d) => d.path === DECISION_RADAR_WORKFLOW_PATH)!;
    const failing = group(def, [run(def, FRESH, "failure")]);
    const dashboard = buildAutomationAttention(
      baseInput({
        github: githubFor({ [DECISION_RADAR_WORKFLOW_PATH]: failing.history }),
        patch: { schedulers: [schedulerRow("FAILED")] },
      })
    );
    const workflow = dashboard.byKey.get(ATTENTION_KEY.workflow(DECISION_RADAR_WORKFLOW_PATH))!;
    assert.equal(workflow.opsIncidentId, `github_automation:${def.name}::${def.path}`);
    const scheduler = dashboard.byKey.get("scheduler:payout_run")!;
    assert.equal(scheduler.opsIncidentId, "scheduler:payout_run:slot-1");
    assert.equal(scheduler.bucket, "ACTION");
  });
});
