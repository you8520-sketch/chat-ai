import { isTrpgActionType } from "./actionTypes";
import { ongoingEffectActionDraft, useItemActionDraft, type TrpgActionDraftFill } from "./commandDock";
import { inventoryFromUnits, isInventoryEntryEquipped } from "./inventory";
import { formatOngoingBadge, hpPercent, hpRiskLevel, type TrpgHpRisk } from "./sheetHud";
import type { TrpgSheetHudCard } from "./sheetView";
import type { TrpgMechanicsHudLine, TrpgPublicOngoingEffect } from "./snapshot";
import { defsFromKeys, statModifier } from "./stats";
import { TRPG_ACTION_MAX_CHARS, type TrpgStatDefinition } from "./types";

/**
 * Read-only presentation copy of one participant sheet. Native and sandboxed JSX
 * renderers both draw from this; the engine/snapshot stay the state owner.
 * Drafts are present only on the viewer's own (interactive) sheet.
 */
export type TrpgSheetSurface = {
  participantId: number;
  interactive: boolean;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  hpPercent: number;
  hpRisk: TrpgHpRisk;
  place: string;
  stats: { key: string; label: string; value: number; modifier: number }[];
  conditions: string[];
  effects: { key: string; label: string; badge: string; hint: string; draft: TrpgActionDraftFill | null }[];
  /** Structured inventory entries; name never carries the ×N suffix. key is the stable entry id. */
  inventory: { key: string; name: string; quantity: number; equipped: boolean; draft: TrpgActionDraftFill | null }[];
  mechanics: string[];
  modifiersNote: string;
};

export function buildTrpgSheetSurface(
  card: TrpgSheetHudCard,
  opts: {
    statDefs: readonly TrpgStatDefinition[];
    ongoingEffects: readonly TrpgPublicOngoingEffect[] | undefined;
    mechanicsLines: readonly TrpgMechanicsHudLine[] | undefined;
    interactive: boolean;
  }
): TrpgSheetSurface {
  const sheet = card.sheet;
  const participantId = card.participantId;
  return {
    participantId,
    interactive: opts.interactive,
    name: sheet.name,
    level: sheet.level,
    hp: sheet.hp,
    maxHp: sheet.maxHp,
    hpPercent: hpPercent(sheet.hp, sheet.maxHp),
    hpRisk: hpRiskLevel(sheet.hp, sheet.maxHp),
    place: sheet.location.trim(),
    stats: opts.statDefs.map((def) => {
      const raw = sheet.stats[def.key];
      const value = typeof raw === "number" ? raw : 5;
      return { key: def.key, label: def.label, value, modifier: statModifier(value) };
    }),
    conditions: sheet.conditions.map((item) => item.trim()).filter(Boolean),
    effects: (opts.ongoingEffects ?? [])
      .filter((effect) => effect.participantId === participantId)
      .map((effect) => ({
        key: `${effect.label}:${effect.severity}:${effect.kind}`,
        label: effect.label,
        badge: formatOngoingBadge(effect),
        hint: effect.recoveryHint,
        draft: opts.interactive ? ongoingEffectActionDraft(effect) : null,
      })),
    inventory: sheet.inventory.map((entry) => ({
      key: entry.id,
      name: entry.name,
      quantity: entry.quantity,
      equipped: isInventoryEntryEquipped(entry),
      draft: opts.interactive ? useItemActionDraft(entry.name) : null,
    })),
    mechanics: (opts.mechanicsLines ?? [])
      .filter((line) => line.participantId === participantId)
      .map((line) => line.text),
    modifiersNote: sheet.modifiersNote.trim(),
  };
}

/**
 * TRPG owner for sandbox setTrpgActionDraft: allowlisted type, normalized body
 * within the action length owner. Anything else is dropped (no truncation).
 */
export function acceptTrpgSheetActionDraft(request: { actionType: string; text: string }): TrpgActionDraftFill | null {
  if (!isTrpgActionType(request.actionType)) return null;
  const body = request.text.replace(/\r\n?/g, "\n").trim();
  if (!body) return null;
  if ([...body].length > TRPG_ACTION_MAX_CHARS) return null;
  return { actionType: request.actionType, body };
}

export type TrpgSheetRendererSource = "creator" | "site";

export type TrpgSheetRendererCandidate = { source: TrpgSheetRendererSource; compiled: string | null | undefined };

export type TrpgSheetRenderer = { kind: "jsx"; source: TrpgSheetRendererSource; compiled: string } | { kind: "native" };

/**
 * Fallback owner: the first JSX candidate whose compiled identity has not
 * failed, else native. Failures are remembered per compiled string, so one
 * broken creator sheet never disables another participant's sheet.
 */
export function pickTrpgSheetRenderer(
  candidates: readonly TrpgSheetRendererCandidate[],
  failedCompiled: ReadonlySet<string>
): TrpgSheetRenderer {
  for (const candidate of candidates) {
    if (candidate.compiled && !failedCompiled.has(candidate.compiled)) {
      return { kind: "jsx", source: candidate.source, compiled: candidate.compiled };
    }
  }
  return { kind: "native" };
}

/** Deterministic preview data for creator TRPG sheet authoring; same projection as the live Dock. */
export function sampleTrpgSheetSurface(): TrpgSheetSurface {
  return buildTrpgSheetSurface(
    {
      participantId: 1,
      isSelf: true,
      html: "",
      sheet: {
        participantId: 1,
        name: "백하율",
        playerName: "백하율",
        level: 3,
        hp: 9,
        maxHp: 20,
        stats: { str: 12, dex: 9, int: 14 },
        conditions: ["긴장"],
        inventory: inventoryFromUnits(["붕대", "낡은 지도", "붕대"]),
        location: "폐역 승강장",
        modifiersNote: "왼팔 부상: 근력 판정 -1",
      },
    },
    {
      statDefs: defsFromKeys(["str", "dex", "int"]),
      ongoingEffects: [
        { participantId: 1, label: "중독", kind: "periodic_harm", severity: "약", remainingTicks: 2, recoveryHint: "해독제" },
        { participantId: 1, label: "출혈", kind: "duration", severity: "중", remainingTicks: 1, recoveryHint: "" },
      ],
      mechanicsLines: [{ participantId: 1, text: "지능 판정 15 vs 12 성공" }],
      interactive: true,
    }
  );
}

/** Field guide for creator sheets. Keys mirror TrpgSheetSurface. */
export const TRPG_SHEET_SURFACE_FIELD_GUIDE: readonly { key: keyof TrpgSheetSurface; note: string }[] = [
  { key: "participantId", note: "참가자 번호" },
  { key: "interactive", note: "true면 내 시트(행동 초안 가능), false면 다른 파티원 시트" },
  { key: "name", note: "이름" },
  { key: "level", note: "레벨" },
  { key: "hp", note: "현재 HP" },
  { key: "maxHp", note: "최대 HP" },
  { key: "hpPercent", note: "HP 비율 0–100" },
  { key: "hpRisk", note: "safe | wounded | critical" },
  { key: "place", note: "현재 위치" },
  { key: "stats", note: "[{ key, label, value, modifier }]" },
  { key: "conditions", note: "서술 상태 문자열 목록" },
  { key: "effects", note: "[{ key, label, badge, hint, draft }] — draft는 내 시트에서만 있음" },
  {
    key: "inventory",
    note: "[{ key, name, quantity, equipped, draft }] — key는 안정적인 inventory id. quantity는 보유 개수(1 이상), equipped는 장착 여부, name에는 ×N이 붙지 않음. draft는 내 시트에서만 있음. equipped는 읽기 전용",
  },
  { key: "mechanics", note: "최근 판정 결과 문자열 목록" },
  { key: "modifiersNote", note: "보정 메모" },
];
