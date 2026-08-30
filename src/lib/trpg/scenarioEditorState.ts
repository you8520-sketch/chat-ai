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
    label: "시나리오 제목",
    helper: "",
  },
  summary: {
    label: "플레이어 공개 소개",
    helper:
      "TRPG 목록과 시작 전 화면에 표시됩니다. 스포일러 없이 현재 상황과 어떤 플레이를 하게 되는지 소개하세요.",
  },
  startingSituation: {
    label: "시작 상황",
    helper: "GM이 첫 장면을 어디서, 어떤 상황으로 시작할지 짧게 적어 주세요.",
  },
  goal: {
    label: "플레이어 목표",
    helper: "플레이어들이 무엇을 하려는 이야기인지 적어 주세요. 복잡한 퀘스트 설계는 필요 없습니다.",
  },
  gmNotes: {
    label: "GM 추가 설정 (선택)",
    helper:
      "플레이어에게 공개되지 않습니다. 숨겨진 진실, 반전, 등장했으면 하는 사건이나 단서, 원하는 분위기, 피하고 싶은 전개, 엔딩 아이디어 등 GM이 참고했으면 하는 내용을 자유롭게 적으세요.",
  },
  content: {
    label: "플레이어 공개 추가 설정",
    helper: "TRPG 목록 미리보기에 표시되는 추가 세계관/배경 설정입니다.",
  },
  worldExtra: {
    label: "플레이어 공개 추가 설정",
    helper: "불러온 세계관에 더해, TRPG 목록 미리보기에 표시할 추가 배경을 적을 수 있습니다.",
  },
  centralConflict: {
    label: "중심 갈등",
    helper: "플레이 중 맞서거나 해결하게 될 가장 큰 문제입니다.",
  },
  endingConditions: {
    label: "종료 조건",
    helper: "어떤 결과가 나오면 이 시나리오를 마무리할 수 있나요? 비워 두면 GM이 기본 마무리 기준을 사용합니다.",
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
