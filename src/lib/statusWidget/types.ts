export type StatusWidgetFieldId = "time" | "place" | "inner_thought" | "situation" | string;

export type StatusWidgetField = {
  id: StatusWidgetFieldId;
  label: string;
  instruction: string;
  previewValue?: string;
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
 * Visual-only preference. Never disables canonical creator status generation,
 * parsing, storage, triggers, or memory/state logic.
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

export type ExtractedStatusFactCategory =
  | "relationship"
  | "character"
  | "setting"
  | "item"
  | "preference"
  | "rule"
  | "quest"
  | "location"
  | "organization";

export type ExtractedStatusFactImportance = "critical" | "important" | "normal";

export type ExtractedStatusFact = {
  category: ExtractedStatusFactCategory;
  subject: string;
  attribute: string;
  value: string;
  importance: ExtractedStatusFactImportance;
  fact_text: string;
};

export type ParsedStatusWidgetTurnValues = {
  character?: StatusWidgetValues | null;
  user?: StatusWidgetValues | null;
  extracted_facts?: ExtractedStatusFact[];
};

export type ResolvedStatusWidgetTurn = {
  /** Engine active — true when any status values must be generated this turn */
  active: boolean;
  /** Engine source mode (canonical creator always included when character widget exists) */
  mode: StatusWidgetSourceMode;
  /** Visual-only; does not affect needsCharacterValues / triggers / storage */
  displayMode: StatusWidgetDisplayMode;
  stackOrder: StatusWidgetStackOrder;
  /** Canonical creator widget for engine (always present when character has a widget) */
  characterWidget: StatusWidget | null;
  /** User display overlay widget (optional) */
  userWidget: StatusWidget | null;
  /** Which sources need AI value blocks this turn */
  needsCharacterValues: boolean;
  needsUserValues: boolean;
};

export type RenderedStatusWidget = {
  source: "character" | "user";
  html: string;
  widget: StatusWidget;
  values: StatusWidgetValues;
};
