import {
  displayModeFromEngineMode,
  parseIncomingStatusWidgetDisplayMode,
  parseIncomingStatusWidgetMode,
  parseStatusWidgetDisplayMode,
  parseStatusWidgetMode,
} from "./serialize";
import type { StatusWidgetDisplayMode, StatusWidgetSourceMode } from "./types";

export type StatusWidgetSettingsWriteResult =
  | {
      ok: true;
      nextMode: StatusWidgetSourceMode;
      nextDisplay: StatusWidgetDisplayMode;
      writeMode: boolean;
      writeDisplay: boolean;
      legacyDisplayInit: boolean;
    }
  | {
      ok: false;
      error: string;
      field: "statusWidgetMode" | "statusWidgetDisplayMode";
    };

/**
 * Single settings-write owner for engine vs display.
 * Writes are independent. An omitted field keeps its stored value.
 * Legacy null display may one-way init from engine — never the reverse.
 * Incoming PATCH values use strict parsers; invalid explicit input → ok:false.
 */
export function resolveStatusWidgetSettingsWrite(input: {
  storedMode: StatusWidgetSourceMode;
  storedDisplay: StatusWidgetDisplayMode | null;
  incomingMode?: unknown;
  incomingDisplay?: unknown;
}): StatusWidgetSettingsWriteResult {
  const writeMode = input.incomingMode !== undefined;
  const writeDisplayExplicit = input.incomingDisplay !== undefined;

  let nextMode = input.storedMode;
  if (writeMode) {
    const parsed = parseIncomingStatusWidgetMode(input.incomingMode);
    if (!parsed) {
      return {
        ok: false,
        field: "statusWidgetMode",
        error: "statusWidgetMode must be off, character_only, user_only, or both.",
      };
    }
    nextMode = parsed;
  }

  let nextDisplay = input.storedDisplay;
  let legacyDisplayInit = false;

  if (writeDisplayExplicit) {
    const parsed = parseIncomingStatusWidgetDisplayMode(input.incomingDisplay);
    if (!parsed) {
      return {
        ok: false,
        field: "statusWidgetDisplayMode",
        error: "statusWidgetDisplayMode must be creator, user, both, or hidden.",
      };
    }
    nextDisplay = parsed;
  }

  if (nextDisplay == null) {
    nextDisplay = displayModeFromEngineMode(nextMode);
    legacyDisplayInit = !writeDisplayExplicit;
  }

  return {
    ok: true,
    nextMode,
    nextDisplay,
    writeMode,
    writeDisplay: writeDisplayExplicit || legacyDisplayInit,
    legacyDisplayInit,
  };
}

/** Forgiving read of stored rows — not for incoming PATCH. */
export { parseStatusWidgetMode, parseStatusWidgetDisplayMode };
