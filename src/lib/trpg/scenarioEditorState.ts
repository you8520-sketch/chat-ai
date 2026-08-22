import type { CharacterAsset } from "@/lib/characterAssets";
import type { CharacterGenre } from "@/lib/characterGenres";
import type { TrpgScenarioDraftField, TrpgScenarioDraftMode } from "./scenarioDraft";
import type { TrpgScenarioPlan } from "./scenarioPlan";
import type { TrpgScenarioNpc, TrpgScenarioTemplateInput } from "./scenarioTypes";
import type { TrpgVisibility } from "./types";

export type ScenarioEditorSnapshot = {
  title: string;
  summary: string;
  content: string;
  secretContent: string;
  worldId: number | "";
  visibility: TrpgVisibility;
  startLocation: string;
  inventoryText: string;
  statKeys: string[];
  npcs: TrpgScenarioNpc[];
  genres: CharacterGenre[];
  assets: CharacterAsset[];
  plan: TrpgScenarioPlan;
  characterIds: number[];
};

export function scenarioEditorSnapshot(fields: ScenarioEditorSnapshot): string {
  return JSON.stringify(fields);
}

export function isScenarioEditorDirty(current: ScenarioEditorSnapshot, saved: string): boolean {
  return scenarioEditorSnapshot(current) !== saved;
}

export function scenarioEditorSavePayload(
  fields: ScenarioEditorSnapshot
): TrpgScenarioTemplateInput {
  return {
    title: fields.title,
    summary: fields.summary,
    content: fields.content,
    secretContent: fields.secretContent,
    worldId: fields.worldId === "" ? null : fields.worldId,
    visibility: fields.visibility,
    startLocation: fields.startLocation,
    startInventory: fields.inventoryText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    defaultPcStats: null,
    statKeys: fields.statKeys,
    npcs: fields.npcs.filter((npc) => npc.name.trim()),
    characterIds: fields.characterIds,
    genres: fields.genres,
    assets: fields.assets,
    scenarioPlan: fields.plan,
  };
}

export function optionalDepthFilled(fields: {
  summary: string;
  content: string;
  secretContent: string;
  worldId: number | "";
  startLocation: string;
  inventoryText: string;
  npcs: TrpgScenarioNpc[];
  genres: CharacterGenre[];
  assets: CharacterAsset[];
  visibility: TrpgVisibility;
  plan: TrpgScenarioPlan;
}): boolean {
  return Boolean(
    fields.summary.trim() ||
      fields.content.trim() ||
      fields.secretContent.trim() ||
      fields.worldId !== "" ||
      fields.startLocation.trim() ||
      fields.inventoryText.trim() ||
      fields.npcs.some((npc) => npc.name.trim()) ||
      fields.genres.length > 0 ||
      fields.assets.length > 0 ||
      fields.visibility === "public" ||
      fields.plan.secret.trim() ||
      fields.plan.majorEvents.some((item) => item.trim()) ||
      fields.plan.clues.some((item) => item.trim()) ||
      fields.plan.forbiddenEvents.some((item) => item.trim()) ||
      fields.plan.boss.trim() ||
      fields.plan.specialRules.some((item) => item.trim()) ||
      fields.plan.climax.trim() ||
      fields.plan.endingCandidates.some((item) => item.trim()) ||
      fields.plan.factionChanges.some((item) => item.trim()) ||
      fields.plan.gmDirection.trim()
  );
}

export function confirmLeaveEditor(opts: {
  dirty: boolean;
  confirm: () => boolean;
}): boolean {
  if (!opts.dirty) return true;
  return opts.confirm();
}

export function shouldConfirmScenarioDraftApply(opts: {
  mode: TrpgScenarioDraftMode;
  selectedFields?: TrpgScenarioDraftField[];
  lockedFields?: TrpgScenarioDraftField[];
  hasManualEdits: boolean;
}): boolean {
  if (opts.mode === "regenerate_all") return true;
  if (opts.mode !== "regenerate_selected") return false;
  if (!opts.hasManualEdits) return false;
  const locked = new Set(opts.lockedFields ?? []);
  return (opts.selectedFields ?? []).some((field) => !locked.has(field));
}

export function scenarioEditorPersistedSnapshot(
  submittedFields: ScenarioEditorSnapshot,
  persistedCharacterIds: number[]
): string {
  return scenarioEditorSnapshot({
    ...submittedFields,
    characterIds: persistedCharacterIds,
  });
}

export const SCENARIO_STORY_FIELD_COPY = {
  title: {
    label: "제목",
    helper: "",
  },
  startingSituation: {
    label: "시작 장면",
    helper: "어디에서, 어떤 상황으로 이야기가 시작하나요?",
  },
  centralConflict: {
    label: "핵심 문제",
    helper: "플레이 중 맞서거나 해결하게 될 가장 큰 문제는 무엇인가요?",
  },
  goal: {
    label: "플레이어 목표",
    helper: "플레이어들이 무엇을 이루려고 하는 이야기인가요?",
  },
  endingConditions: {
    label: "마무리 기준",
    helper: "어떤 결과가 나오면 이 시나리오를 마무리할 수 있나요? 여러 개 적어도 됩니다.",
  },
} as const;

export function scenarioHasAiDraftOrigin(plan: {
  provenance?: { generatorModel?: string | null } | null;
}): boolean {
  return Boolean(plan.provenance?.generatorModel?.trim());
}

export function shouldOfferScenarioAiEditingTools(opts: {
  hasSessionDraft: boolean;
  hasPersistedAiOrigin: boolean;
  isEditingSaved: boolean;
}): boolean {
  return opts.hasSessionDraft || opts.hasPersistedAiOrigin || opts.isEditingSaved;
}

export function scrollToScenarioField(field: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(`[data-scenario-field="${field}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = el.querySelector<HTMLElement>("input,textarea,select,button");
  input?.focus();
}
