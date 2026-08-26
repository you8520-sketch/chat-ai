import {
  displayModeFromEngineMode,
  parseStatusWidgetDisplayMode,
  parseStatusWidgetMode,
} from "./serialize";
import type { StatusWidgetDisplayMode, StatusWidgetSourceMode } from "./types";

/**
 * Single settings-write owner for engine vs display.
 * Writes are independent. An omitted field keeps its stored value.
 * Legacy null display may one-way init from engine — never the reverse.
 */
export function resolveStatusWidgetSettingsWrite(input: {
  storedMode: StatusWidgetSourceMode;
  storedDisplay: StatusWidgetDisplayMode | null;
  incomingMode?: unknown;
  incomingDisplay?: unknown;
}): {
  nextMode: StatusWidgetSourceMode;
  nextDisplay: StatusWidgetDisplayMode | null;
  writeMode: boolean;
  writeDisplay: boolean;
  legacyDisplayInit: boolean;
} {
  const writeMode = input.incomingMode !== undefined;
  const writeDisplayExplicit = input.incomingDisplay !== undefined;
  const nextMode = writeMode
    ? parseStatusWidgetMode(String(input.incomingMode))
    : input.storedMode;

  let nextDisplay = input.storedDisplay;
  let legacyDisplayInit = false;

  if (writeDisplayExplicit) {
    nextDisplay = parseStatusWidgetDisplayMode(String(input.incomingDisplay));
  }

  if (nextDisplay == null) {
    nextDisplay = displayModeFromEngineMode(nextMode);
    legacyDisplayInit = !writeDisplayExplicit;
  }

  return {
    nextMode,
    nextDisplay,
    writeMode,
    writeDisplay: writeDisplayExplicit || legacyDisplayInit,
    legacyDisplayInit,
  };
}
