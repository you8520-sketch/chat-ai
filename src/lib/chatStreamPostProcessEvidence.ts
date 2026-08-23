/**
 * Client-side evidence that the server entered post-stream / post-process work.
 * Used to gate extended EOF reconcile (secondary safety net only).
 */

export type PostProcessPhaseEvidence = {
  mainGenerationComplete: boolean;
  postprocessStarted: boolean;
  statusWidgetProcessing: boolean;
  finalizing: boolean;
};

export function createEmptyPostProcessPhaseEvidence(): PostProcessPhaseEvidence {
  return {
    mainGenerationComplete: false,
    postprocessStarted: false,
    statusWidgetProcessing: false,
    finalizing: false,
  };
}

export function hasPostProcessPhaseEvidence(
  evidence: PostProcessPhaseEvidence | null | undefined
): boolean {
  if (!evidence) return false;
  return (
    evidence.mainGenerationComplete ||
    evidence.postprocessStarted ||
    evidence.statusWidgetProcessing ||
    evidence.finalizing
  );
}

const POSTPROCESS_STATUS_RE =
  /마무리|분량 보강|HTML 생성|상태창 생성/i;

const STATUS_WIDGET_STATUS_RE = /상태창 생성|HTML 생성/i;

export function applyStreamHeartbeatEvidence(
  evidence: PostProcessPhaseEvidence,
  phase: string | null | undefined
): void {
  if (!phase) return;
  evidence.postprocessStarted = true;
  if (phase === "status_widget") {
    evidence.statusWidgetProcessing = true;
  }
  if (phase === "finalizing") {
    evidence.finalizing = true;
  }
}

export function applyStatusMessageEvidence(
  evidence: PostProcessPhaseEvidence,
  message: string | null | undefined
): void {
  if (!message) return;
  if (POSTPROCESS_STATUS_RE.test(message)) {
    evidence.postprocessStarted = true;
    evidence.mainGenerationComplete = true;
  }
  if (STATUS_WIDGET_STATUS_RE.test(message)) {
    evidence.statusWidgetProcessing = true;
  }
  if (/마무리|분량 보강/i.test(message)) {
    evidence.mainGenerationComplete = true;
  }
}
