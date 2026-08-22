import type { CharacterAsset } from "@/lib/characterAssets";
import type { CharacterGenre } from "@/lib/characterGenres";
import type { TrpgScenarioDraftField, TrpgScenarioDraftMode } from "./scenarioDraft";
import { previewDraftOverwrite, type TrpgScenarioDraftExisting } from "./scenarioDraft";
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

export function shouldConfirmScenarioDraftApply(opts: {
  mode: TrpgScenarioDraftMode;
  existing: TrpgScenarioDraftExisting;
  selectedFields?: TrpgScenarioDraftField[];
  lockedFields?: TrpgScenarioDraftField[];
  hasManualEdits: boolean;
}): boolean {
  if (opts.mode === "regenerate_all") return true;
  const overwriteFields = previewDraftOverwrite({
    mode: opts.mode,
    existing: opts.existing,
    selectedFields: opts.selectedFields,
    lockedFields: opts.lockedFields,
  });
  if (!opts.hasManualEdits || overwriteFields.length === 0) return false;
  return opts.mode === "regenerate_selected";
}

export function scrollToScenarioField(field: string): void {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(`[data-scenario-field="${field}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = el.querySelector<HTMLElement>("input,textarea,select,button");
  input?.focus();
}
