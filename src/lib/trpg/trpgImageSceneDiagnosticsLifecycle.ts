import type { TrpgAiFocusDiagnostics } from "@/lib/trpg/trpgAiFocusSelection";
import type { TrpgImageSceneMode } from "@/lib/trpg/trpgImageSceneMode";

export type TrpgImageSceneDiagnosticsPayload = TrpgAiFocusDiagnostics & {
  mode: TrpgImageSceneMode;
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
