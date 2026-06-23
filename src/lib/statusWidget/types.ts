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

export type StatusWidgetStackOrder = "character_first" | "user_first";

export type StatusWidgetValues = Record<string, string>;

export type ParsedStatusWidgetTurnValues = {
  character?: StatusWidgetValues | null;
  user?: StatusWidgetValues | null;
};

export type ResolvedStatusWidgetTurn = {
  active: boolean;
  mode: StatusWidgetSourceMode;
  stackOrder: StatusWidgetStackOrder;
  characterWidget: StatusWidget | null;
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
