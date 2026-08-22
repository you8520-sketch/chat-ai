import { catalogScenarioById, type TrpgCatalogPick } from "./catalogBrowse";
import type { TrpgCatalog } from "./catalog";
import type { TrpgScenarioTemplate } from "./scenarioTypes";

export const TRPG_SCENARIO_HANDOFF_PARAM = "scenarioId";

export function parseScenarioHandoffId(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const id = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export function trpgPlayHref(scenarioId: number): string {
  return `/trpg?${TRPG_SCENARIO_HANDOFF_PARAM}=${scenarioId}`;
}

export type ScenarioHandoffResult =
  | {
      ok: true;
      scenario: TrpgScenarioTemplate;
      viewerIsCreator: boolean;
      pick: TrpgCatalogPick;
    }
  | {
      ok: false;
      error: string;
      scenarioId: number | null;
    };

export function resolveScenarioHandoff(catalog: TrpgCatalog, rawId: unknown): ScenarioHandoffResult {
  const scenarioId = parseScenarioHandoffId(rawId);
  if (scenarioId == null) {
    return { ok: false, error: "시나리오를 찾을 수 없습니다.", scenarioId: null };
  }
  const found = catalogScenarioById(catalog, scenarioId);
  if (!found) {
    return {
      ok: false,
      error: "이 시나리오를 찾을 수 없거나 접근할 수 없습니다. 목록에서 다시 고르거나 제작 화면으로 돌아가 주세요.",
      scenarioId,
    };
  }
  return {
    ok: true,
    scenario: found.scenario,
    viewerIsCreator: found.viewerIsCreator,
    pick: { kind: "scenario", id: found.scenario.id },
  };
}

export function scenarioPersistDecision(opts: {
  dirty: boolean;
  canPlay: boolean;
  savedId: number | null;
}): "navigate" | "save_then_play" | "blocked" {
  if (!opts.canPlay) return "blocked";
  if (!opts.dirty && opts.savedId) return "navigate";
  return "save_then_play";
}

export function scenarioPlayCtaLabel(decision: ReturnType<typeof scenarioPersistDecision>): string {
  switch (decision) {
    case "navigate":
      return "이 시나리오로 플레이";
    case "save_then_play":
      return "저장 후 플레이";
    case "blocked":
      return "이 시나리오로 플레이";
    default: {
      const _exhaustive: never = decision;
      return _exhaustive;
    }
  }
}
