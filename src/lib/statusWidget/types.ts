export type StatusWidgetFieldId = "time" | "place" | "inner_thought" | "situation" | string;

/**
 * Phase B1-A — explicit opt-in server_meter numeric definition.
 * Absent / invalid → field stays legacy (no numeric activation by name alone).
 */
export type ServerMeterNumericStateDefinitionV1 = {
  version: 1;
  mode: "server_meter";
  min: number;
  max: number;
  initial: number;
  integer: boolean;
  maxIncreasePerTurn?: number;
  maxDecreasePerTurn?: number;
  manualEditable?: boolean;
};

export type StatusWidgetField = {
  id: StatusWidgetFieldId;
  label: string;
  instruction: string;
  previewValue?: string;
  /**
   * Optional creator-set starting value for first-turn extraction
   * (e.g. date "3월 18일", clock "14:30"). Omitted on legacy widgets.
   */
  initialValue?: string;
  /**
   * Explicit opt-in only. Valid server_meter definition required to activate
   * numeric state. Legacy affection/trust/corruption names alone do nothing.
   */
  numericState?: ServerMeterNumericStateDefinitionV1;
};

export type StatusWidgetPlacement = "bottom" | "top";

export type StatusWidget = {
  version: 1;
  name: string;
  htmlTemplate: string;
  fields: StatusWidgetField[];
  placement: StatusWidgetPlacement;
};

export type StatusWidgetSourceMode =
  | "off"
  | "character_only"
  | "user_only"
  | "both";

/**
 * Visual-only preference. Must not determine engine mode, extraction,
 * persistence, triggers, numeric state, or memory behavior.
 */
export type StatusWidgetDisplayMode =
  | "creator"
  | "user"
  | "both"
  | "hidden";

export type StatusWidgetStackOrder = "character_first" | "user_first";

/** Protected creator machine keys — user display values must not overwrite these. */
export const CREATOR_PROTECTED_STATUS_KEYS = [
  "d_day",
  "affection",
  "trust",
  "corruption",
] as const;

export type StatusWidgetValues = Record<string, string>;

import type { EpisodicExtractedFact } from "@/lib/memory/memory-episodic-types";

export type {
  EpisodicFactCategory as ExtractedStatusFactCategory,
  EpisodicFactImportance as ExtractedStatusFactImportance,
  EpisodicFactEvidenceType as ExtractedStatusFactEvidenceType,
  EpisodicExtractedFact as ExtractedStatusFact,
} from "@/lib/memory/memory-episodic-types";

export type ParsedStatusWidgetTurnValues = {
  character?: StatusWidgetValues | null;
  user?: StatusWidgetValues | null;
  extracted_facts?: EpisodicExtractedFact[];
};

export type ResolvedStatusWidgetTurn = {
  /** Engine active — true when effective mode is not off */
  active: boolean;
  /** Stored/requested engine mode before fail-closed availability */
  requestedMode: StatusWidgetSourceMode;
  /** Effective engine source-of-truth after fail-closed availability */
  mode: StatusWidgetSourceMode;
  /** Visual-only; does not affect needsCharacterValues / triggers / storage */
  displayMode: StatusWidgetDisplayMode;
  stackOrder: StatusWidgetStackOrder;
  characterWidget: StatusWidget | null;
  userWidget: StatusWidget | null;
  /** Derived only from effective engine mode + source availability */
  needsCharacterValues: boolean;
  needsUserValues: boolean;
};

export type RenderedStatusWidget = {
  source: "character" | "user";
  html: string;
  widget: StatusWidget;
  values: StatusWidgetValues;
};
