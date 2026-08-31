import type { TrpgAiFocusDiagnostics } from "@/lib/trpg/trpgAiFocusSelection";
import type { TrpgImageSceneMode } from "@/lib/trpg/trpgImageSceneMode";

export type TrpgImageSceneDiagnosticsPayload = TrpgAiFocusDiagnostics & {
  mode: TrpgImageSceneMode;
};

export type TrpgImageSceneDiagnosticsDisplayRow = {
  key: string;
  label: string;
  value: string;
};

/** Canonical cleared state — diagnostics must not survive mode/source/generation boundaries. */
export function clearedTrpgImageSceneDiagnostics(): undefined {
  return undefined;
}

/** DISPLAYED_DIAGNOSTICS = DIAGNOSTICS_FROM_CURRENT_GENERATION_ONLY */
export function resolveTrpgImageSceneDiagnosticsFromResponse(
  response: { trpgImageSceneDiagnostics?: TrpgImageSceneDiagnosticsPayload } | null | undefined
): TrpgImageSceneDiagnosticsPayload | undefined {
  return response?.trpgImageSceneDiagnostics ?? clearedTrpgImageSceneDiagnostics();
}

/** Server response visibility owner — reuses existing admin canSeeCost gate. */
export function resolveTrpgImageSceneDiagnosticsForResponse(opts: {
  canSeeCost: boolean;
  campaignId: number | null | undefined;
  payload: TrpgImageSceneDiagnosticsPayload | null;
}): TrpgImageSceneDiagnosticsPayload | undefined {
  if (!opts.canSeeCost || !opts.campaignId || !opts.payload) {
    return undefined;
  }
  return opts.payload;
}

/** Server response owner helper — builds payload for admin-gated TRPG diagnostics. */
export function buildTrpgImageSceneDiagnosticsPayload(opts: {
  requestedMode: TrpgImageSceneMode;
  modeApplied: TrpgImageSceneMode;
  canonicalLocation: string;
  focusDiagnostics: TrpgAiFocusDiagnostics | null;
}): TrpgImageSceneDiagnosticsPayload {
  if (opts.focusDiagnostics) {
    return {
      mode: opts.modeApplied,
      ...opts.focusDiagnostics,
      modeRequested: opts.requestedMode,
      modeApplied: opts.modeApplied,
    };
  }

  return {
    mode: opts.modeApplied,
    modeRequested: opts.requestedMode,
    modeApplied: opts.modeApplied,
    aiModel: "",
    aiAttempts: 0,
    aiUsedFallback: false,
    aiDeterministicFallback: false,
    aiLatencyMs: 0,
    canonicalLocation: opts.canonicalLocation,
    selectedHeroScene: "",
    heroEventIds: [],
    overSelectionRejected: false,
  };
}

export function formatTrpgDiagnosticsBoolean(value: boolean | undefined): string {
  if (value === undefined) return "—";
  return value ? "yes" : "no";
}

export function formatTrpgDiagnosticsText(value: string | undefined | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

export function formatTrpgDiagnosticsIds(ids: readonly string[] | undefined): string {
  if (!ids?.length) return "(none)";
  return ids.join(", ");
}

export function isTrpgAiFocusRawFallback(
  diagnostics: TrpgImageSceneDiagnosticsPayload
): boolean {
  return diagnostics.modeRequested === "AI_FOCUS" && diagnostics.modeApplied === "RAW";
}

export function buildTrpgImageSceneDiagnosticsDisplayRows(
  diagnostics: TrpgImageSceneDiagnosticsPayload | undefined
): TrpgImageSceneDiagnosticsDisplayRow[] {
  if (!diagnostics) return [];

  return [
    { key: "modeRequested", label: "요청 모드", value: diagnostics.modeRequested },
    { key: "modeApplied", label: "실제 적용 모드", value: diagnostics.modeApplied },
    { key: "mode", label: "mode", value: diagnostics.mode },
    {
      key: "fallback",
      label: "RAW fallback",
      value: isTrpgAiFocusRawFallback(diagnostics) ? "yes" : "no",
    },
    {
      key: "fallbackReason",
      label: "fallback reason",
      value: formatTrpgDiagnosticsText(diagnostics.fallbackReason),
    },
    { key: "aiModel", label: "planner model", value: formatTrpgDiagnosticsText(diagnostics.aiModel) },
    { key: "aiAttempts", label: "planner attempts", value: String(diagnostics.aiAttempts) },
    { key: "aiLatencyMs", label: "planner latency", value: `${diagnostics.aiLatencyMs}ms` },
    {
      key: "aiUsedFallback",
      label: "aiUsedFallback",
      value: formatTrpgDiagnosticsBoolean(diagnostics.aiUsedFallback),
    },
    {
      key: "aiDeterministicFallback",
      label: "deterministic fallback",
      value: formatTrpgDiagnosticsBoolean(diagnostics.aiDeterministicFallback),
    },
    {
      key: "overSelectionRejected",
      label: "over-selection reject",
      value: formatTrpgDiagnosticsBoolean(diagnostics.overSelectionRejected),
    },
    {
      key: "canonicalLocation",
      label: "canonical location",
      value: formatTrpgDiagnosticsText(diagnostics.canonicalLocation),
    },
    {
      key: "selectedHeroScene",
      label: "selected hero scene",
      value: formatTrpgDiagnosticsText(diagnostics.selectedHeroScene),
    },
    {
      key: "heroEventIds",
      label: "hero event ids",
      value: formatTrpgDiagnosticsIds(diagnostics.heroEventIds),
    },
  ];
}
