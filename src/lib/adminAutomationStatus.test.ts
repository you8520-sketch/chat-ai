import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { emptyCodeHealthCounts } from "@/lib/codeHealth/types";
import {
  auditStatusLabel,
  automationDisplayName,
  codeHealthLedgerActionReason,
  coverageStateLabel,
  decisionRadarStatusLabel,
  formatKstDateTime,
  githubRunAutoAttentionCopy,
  githubRunConclusionLabel,
  githubRunSeverity,
  isGithubRunInProgress,
} from "@/lib/adminAutomationStatus";

describe("admin automation status wording", () => {
  it("names the three known workflows in Korean and keeps unknown names", () => {
    assert.equal(
      automationDisplayName(".github/workflows/code-health-weekly-audit.yml", "Weekly Code Health audit"),
      "주간 코드 상태 점검"
    );
    assert.equal(
      automationDisplayName(".github/workflows/decision-model-radar-weekly.yml", "x"),
      "주간 의사결정 모델 조사"
    );
    assert.equal(
      automationDisplayName(".github/workflows/memory-research-cycle.yml", "x"),
      "기억력 개선 연구"
    );
    assert.equal(automationDisplayName(".github/workflows/other.yml", "Other"), "Other");
  });

  it("keeps run failure severity unchanged: failures are critical, cancelled is a warning", () => {
    assert.equal(githubRunSeverity("failure"), "critical");
    assert.equal(githubRunSeverity("timed_out"), "critical");
    assert.equal(githubRunSeverity("startup_failure"), "critical");
    assert.equal(githubRunSeverity("action_required"), "critical");
    assert.equal(githubRunSeverity("cancelled"), "warning");
  });

  it("labels run outcomes and in-flight runs without calling them failures", () => {
    assert.equal(githubRunConclusionLabel("failure"), "실행 실패");
    assert.equal(githubRunConclusionLabel(null, "in_progress"), "실행 중");
    assert.equal(githubRunConclusionLabel(null, "queued"), "대기 중");
    assert.equal(githubRunConclusionLabel(null, null), "기록 없음");
    assert.equal(isGithubRunInProgress("in_progress"), true);
    assert.equal(isGithubRunInProgress("completed"), false);
  });

  it("distinguishes OK, FAILED, STALE, NOT_RUN and UNAVAILABLE by text", () => {
    const labels = (["OK", "FAILED", "STALE", "NOT_RUN", "UNAVAILABLE"] as const).map(
      coverageStateLabel
    );
    assert.deepEqual(labels, ["정상", "실행 실패", "최신 확인 필요", "실행 기록 없음", "조회 불가"]);
    assert.equal(new Set(labels).size, 5);
  });

  it("words an audit FAILED verdict as a finding and PARTIAL as partially complete", () => {
    assert.equal(auditStatusLabel("FAILED"), "점검 결과: 문제 발견");
    assert.equal(auditStatusLabel("UNAVAILABLE"), "조회 불가");
    assert.equal(decisionRadarStatusLabel("PARTIAL"), "일부 완료");
    assert.equal(decisionRadarStatusLabel("FAILED"), "실패");
  });

  it("formats times in KST", () => {
    assert.match(formatKstDateTime("2026-10-12T09:20:00Z"), /(18|06):20/);
  });

  it("words ledger action reasons from actual counts, not a zero cleanup placeholder", () => {
    assert.match(
      codeHealthLedgerActionReason({ ...emptyCodeHealthCounts(), runtimeCiAnomalies: 2 }),
      /CI·런타임 이상 징후 2건/
    );
    assert.doesNotMatch(
      codeHealthLedgerActionReason({ ...emptyCodeHealthCounts(), runtimeCiAnomalies: 1 }),
      /정리·수정 검토 필요 0건/
    );
  });

  it("distinguishes queued runs from actively running runs in auto copy", () => {
    assert.equal(githubRunAutoAttentionCopy("queued", 12).statusLabel, "대기 중");
    assert.match(githubRunAutoAttentionCopy("queued", 12).reason, /아직 실행이 시작되지 않았습니다/);
    assert.equal(githubRunAutoAttentionCopy("in_progress", 12).statusLabel, "실행 중");
  });
});
