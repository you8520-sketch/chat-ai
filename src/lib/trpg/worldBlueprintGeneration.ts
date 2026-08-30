import {
  buildSandboxDirectorSystemPrompt,
  buildSandboxDirectorUserPrompt,
  makeDraftProvenance,
} from "./scenarioDraft";
import { completeTrpgAuthoringJson, type TrpgAuthoringComplete } from "./scenarioDraftCall";
import { evaluateSandboxBlueprint, parseTrpgScenarioPlan, type TrpgScenarioPlan } from "./scenarioPlan";

export type WorldSandboxBlueprintInput = {
  worldId: number;
  worldName: string;
  worldSummary: string;
  worldContent: string;
  worldUpdatedAt: string;
  worldHash: string;
};

export type WorldSandboxBlueprintResult =
  | { ok: true; plan: TrpgScenarioPlan }
  | { ok: false; error: string; retryable?: boolean };

/** Canonical world-only sandbox Blueprint generation owner. */
export async function generateWorldSandboxBlueprint(
  input: WorldSandboxBlueprintInput,
  deps?: { complete?: TrpgAuthoringComplete }
): Promise<WorldSandboxBlueprintResult> {
  try {
    const generated = await completeTrpgAuthoringJson({
      kind: "sandbox_blueprint",
      system: buildSandboxDirectorSystemPrompt(),
      user: buildSandboxDirectorUserPrompt({
        worldName: input.worldName,
        worldSummary: input.worldSummary,
        worldContent: input.worldContent,
      }),
      complete: deps?.complete,
    });
    const plan = parseTrpgScenarioPlan(generated.plan) ?? generated.plan;
    const accepted = evaluateSandboxBlueprint(plan);
    if (!accepted.ok) {
      return { ok: false, error: accepted.error, retryable: false };
    }
    plan.provenance = makeDraftProvenance({
      worldId: input.worldId,
      worldUpdatedAt: input.worldUpdatedAt,
      worldHash: input.worldHash,
    });
    return { ok: true, plan };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sandbox blueprint generation failed";
    const retryable = /timeout|timed out|aborted|503|502|429/i.test(message);
    return { ok: false, error: message, retryable };
  }
}
