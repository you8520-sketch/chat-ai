import type { TrpgActionType } from "./actionTypes";
import { contextualStatusTreatDraft } from "./mechanicsIntent";

/**
 * Play-surface view model for the canonical TRPG command dock.
 * Draft text, submit, and game state stay on their existing owners.
 * This module never fetches, never mutates sheets, and never submits.
 */

export const TRPG_COMMAND_DOCK_MODES = ["action", "self", "party", "ooc"] as const;
export type TrpgCommandDockMode = (typeof TRPG_COMMAND_DOCK_MODES)[number];

export type TrpgCommandDockView = {
  mode: TrpgCommandDockMode;
  expanded: boolean;
  /**
   * self/party/ooc: user explicitly opened that mode, so lifecycle updates keep it.
   * action: user opened ACTION during presentation, so narration does not collapse it.
   */
  explicitHold: TrpgCommandDockMode | null;
};

export type TrpgCommandDockOcclusion = {
  dockPx: number;
  keyboardPx: number;
  /** Tail clearance. Dock height plus the virtual-keyboard inset. */
  scrollMarginPx: number;
};

const TREATABLE_ONGOING_KINDS = new Set(["periodic_harm", "control"]);

function clampPx(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value);
}

function hangulObjectParticle(name: string): "을" | "를" {
  const last = Array.from(name).at(-1) ?? "";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "을";
  return (code - 0xac00) % 28 === 0 ? "를" : "을";
}

export function initialTrpgCommandDockView(opts: {
  actionInput: boolean;
  presentationBusy: boolean;
}): TrpgCommandDockView {
  return {
    mode: "action",
    expanded: opts.actionInput && !opts.presentationBusy,
    explicitHold: null,
  };
}

function explicitHoldFor(mode: TrpgCommandDockMode, presentationBusy: boolean): TrpgCommandDockMode | null {
  if (mode === "self" || mode === "party" || mode === "ooc") return mode;
  return presentationBusy ? "action" : null;
}

/** Tab press. The active expanded mode collapses; every other mode opens. */
export function selectTrpgCommandDockMode(
  current: TrpgCommandDockView,
  mode: TrpgCommandDockMode,
  presentationBusy: boolean
): TrpgCommandDockView {
  if (current.expanded && current.mode === mode) {
    return { mode, expanded: false, explicitHold: null };
  }
  return {
    mode,
    expanded: true,
    explicitHold: explicitHoldFor(mode, presentationBusy),
  };
}

/** Sheet interaction. Always reveals ACTION so the user can confirm the draft. */
export function openTrpgCommandDockMode(
  _current: TrpgCommandDockView,
  mode: TrpgCommandDockMode,
  presentationBusy: boolean
): TrpgCommandDockView {
  return {
    mode,
    expanded: true,
    explicitHold: explicitHoldFor(mode, presentationBusy),
  };
}

/**
 * Apply a round/presentation transition once.
 * Unchanged lifecycle keys return the current view so polling cannot close a
 * mode the user opened or wipe an in-progress collapse.
 */
export function reconcileTrpgCommandDockLifecycle(
  current: TrpgCommandDockView,
  opts: { presentationBusy: boolean; actionInput: boolean; lifecycleChanged: boolean }
): TrpgCommandDockView {
  if (!opts.lifecycleChanged) return current;
  const protectedHold =
    current.explicitHold === "self" ||
    current.explicitHold === "party" ||
    current.explicitHold === "ooc";
  if (opts.presentationBusy) {
    if (protectedHold && current.explicitHold) {
      return { ...current, mode: current.explicitHold, expanded: true };
    }
    if (current.explicitHold === "action") {
      return { ...current, mode: "action", expanded: true };
    }
    return { ...current, expanded: false, explicitHold: null };
  }
  if (protectedHold && current.explicitHold) {
    return { ...current, mode: current.explicitHold, expanded: true };
  }
  if (opts.actionInput) {
    return { mode: "action", expanded: true, explicitHold: null };
  }
  return { mode: current.mode, expanded: false, explicitHold: null };
}

export function trpgCommandDockPresentationBusy(opts: {
  cinematicMotion: boolean;
  generating: boolean;
  botGenerationInFlight: boolean;
  gmNarrationRevealing: boolean;
}): boolean {
  return (
    opts.cinematicMotion ||
    opts.generating ||
    opts.botGenerationInFlight ||
    opts.gmNarrationRevealing
  );
}

export function trpgCommandDockOcclusion(
  dockHeightPx: number,
  keyboardInsetPx = 0
): TrpgCommandDockOcclusion {
  const dockPx = clampPx(dockHeightPx);
  const keyboardPx = clampPx(keyboardInsetPx);
  return { dockPx, keyboardPx, scrollMarginPx: dockPx + keyboardPx };
}

/**
 * Scroll the existing command-dock overflow panel so `target` enters its
 * visible band. Returns the next panel scrollTop, or null when already visible
 * / no movement is possible. Never touches window scroll.
 */
export function nextOverflowPanelScrollTop(opts: {
  panelScrollTop: number;
  panelClientHeight: number;
  panelScrollHeight: number;
  panelTop: number;
  targetTop: number;
  targetHeight: number;
  paddingPx?: number;
}): number | null {
  const panelClientHeight = Number.isFinite(opts.panelClientHeight) ? opts.panelClientHeight : 0;
  const panelScrollHeight = Number.isFinite(opts.panelScrollHeight) ? opts.panelScrollHeight : 0;
  const panelScrollTop = Number.isFinite(opts.panelScrollTop) ? opts.panelScrollTop : 0;
  if (panelClientHeight <= 0 || panelScrollHeight <= panelClientHeight) return null;
  const padding = Number.isFinite(opts.paddingPx) ? Math.max(0, opts.paddingPx ?? 0) : 8;
  const targetHeight = Number.isFinite(opts.targetHeight) ? Math.max(0, opts.targetHeight) : 0;
  const targetOffset = panelScrollTop + (opts.targetTop - opts.panelTop);
  const visibleStart = panelScrollTop + padding;
  const visibleEnd = panelScrollTop + panelClientHeight - padding;
  const targetStart = targetOffset;
  const targetEnd = targetOffset + targetHeight;
  if (targetStart >= visibleStart && targetEnd <= visibleEnd) return null;
  const desired = Math.min(
    Math.max(0, panelScrollHeight - panelClientHeight),
    Math.max(0, targetOffset - padding)
  );
  if (Math.abs(desired - panelScrollTop) < 1) return null;
  return desired;
}

export function overflowPanelScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? "instant" : "smooth";
}

export function trpgCommandDockScrollMarginBottom(
  occlusion: Pick<TrpgCommandDockOcclusion, "scrollMarginPx">
): string {
  return `${occlusion.scrollMarginPx}px`;
}

/** Floating controls sit just above the dock, using the same clearance. */
export function trpgCommandDockOverlayBottom(
  occlusion: Pick<TrpgCommandDockOcclusion, "scrollMarginPx">
): string {
  return `calc(${occlusion.scrollMarginPx}px + 0.75rem)`;
}

export function trpgCommandDockLifecycleKey(opts: {
  presentationBusy: boolean;
  actionInput: boolean;
}): string {
  return `${opts.presentationBusy ? 1 : 0}:${opts.actionInput ? 1 : 0}`;
}

/** Inventory click fills the existing action draft. It does not submit or remove the item. */
export function useItemActionDraft(itemName: string): TrpgActionDraftFill | null {
  const name = itemName.trim();
  if (!name) return null;
  return { actionType: "use_item", body: `${name}${hangulObjectParticle(name)} 사용한다.` };
}

/**
 * Condition click reuses contextual status treatment.
 * Kinds that owner does not treat stay display-only.
 */
export function isTreatableOngoingKind(kind: string): boolean {
  return TREATABLE_ONGOING_KINDS.has(kind);
}

export function ongoingEffectActionDraft(effect: {
  kind: string;
  label: string;
}): TrpgActionDraftFill | null {
  if (!isTreatableOngoingKind(effect.kind)) return null;
  const draft = contextualStatusTreatDraft([effect.label]);
  return { actionType: draft.actionType, body: draft.body };
}

export function selectPartySheetParticipantId(
  cards: readonly { participantId: number }[],
  currentId: number | null
): number | null {
  if (currentId != null && cards.some((card) => card.participantId === currentId)) return currentId;
  return cards[0]?.participantId ?? null;
}

export function commandDockModeLabel(mode: TrpgCommandDockMode): string {
  switch (mode) {
    case "action":
      return "행동";
    case "self":
      return "내 시트";
    case "party":
      return "파티";
    case "ooc":
      return "유저 채팅";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export type TrpgActionDraftFill = {
  actionType: TrpgActionType;
  body: string;
};
