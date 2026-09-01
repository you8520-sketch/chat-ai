import { displayVisibilityFromMode } from "./displayVisibilityToggles";
import {
  displayModeFromEngineMode,
  parseStatusWidgetDisplayMode,
  parseStatusWidgetJson,
  parseStatusWidgetMode,
  parseStatusWidgetStackOrder,
} from "./serialize";
import type {
  ResolvedStatusWidgetTurn,
  StatusWidget,
  StatusWidgetDisplayMode,
  StatusWidgetSourceMode,
} from "./types";

export function statusWidgetHasCreatorSource(mode: StatusWidgetSourceMode): boolean {
  return mode === "character_only" || mode === "both";
}

export function statusWidgetHasUserSource(mode: StatusWidgetSourceMode): boolean {
  return mode === "user_only" || mode === "both";
}

/** Canonical runtime engine owner: every available, allowed definition is tracked. */
export function statusWidgetModeForDefinitions(opts: {
  characterWidgetJson?: string | null;
  personaWidgetJson?: string | null;
  characterAllowUserOverride?: boolean;
}): StatusWidgetSourceMode {
  const creatorAvailable = Boolean(parseStatusWidgetJson(opts.characterWidgetJson));
  const personaAvailable =
    opts.characterAllowUserOverride !== false &&
    Boolean(parseStatusWidgetJson(opts.personaWidgetJson));
  if (creatorAvailable && personaAvailable) return "both";
  if (creatorAvailable) return "character_only";
  if (personaAvailable) return "user_only";
  return "off";
}

/**
 * Fail-closed effective engine mode.
 * Requested source never silently activates another source.
 */
export function resolveEffectiveStatusWidgetMode(opts: {
  requestedMode: StatusWidgetSourceMode;
  hasCreatorWidget: boolean;
  hasAllowedUserWidget: boolean;
}): StatusWidgetSourceMode {
  const { requestedMode, hasCreatorWidget, hasAllowedUserWidget } = opts;
  switch (requestedMode) {
    case "off":
      return "off";
    case "character_only":
      return hasCreatorWidget ? "character_only" : "off";
    case "user_only":
      return hasAllowedUserWidget ? "user_only" : "off";
    case "both":
      if (hasCreatorWidget && hasAllowedUserWidget) return "both";
      if (hasCreatorWidget) return "character_only";
      if (hasAllowedUserWidget) return "user_only";
      return "off";
    default: {
      const _exhaustive: never = requestedMode;
      return _exhaustive;
    }
  }
}

function clampDisplayMode(opts: {
  preference: StatusWidgetDisplayMode;
  hasCreatorWidget: boolean;
  hasAllowedUserWidget: boolean;
}): StatusWidgetDisplayMode {
  return displayModeFromUserChoice({
    hasCharacterWidget: opts.hasCreatorWidget,
    hasUserWidget: opts.hasAllowedUserWidget,
    preference: opts.preference,
  });
}

/**
 * Single runtime owner for status-widget engine + display.
 *
 * Engine (`mode`) is supplied by the canonical definition-derived owner.
 * Display is presentation-only and never changes engine / needs* / extract.
 */
export function resolveStatusWidgetTurn(opts: {
  characterWidgetJson?: string | null;
  chatMode?: string | null;
  userWidgetJson?: string | null;
  stackOrder?: string | null;
  characterAllowUserOverride?: boolean;
  /** Visual-only preference; never changes engine extraction */
  displayMode?: string | null;
}): ResolvedStatusWidgetTurn {
  const characterWidget = parseStatusWidgetJson(opts.characterWidgetJson);
  const userWidgetParsed = parseStatusWidgetJson(opts.userWidgetJson);
  const allowUserOverride = opts.characterAllowUserOverride !== false;
  const hasAllowedUserWidget = allowUserOverride && Boolean(userWidgetParsed);
  const userWidget = hasAllowedUserWidget ? userWidgetParsed : null;

  const requestedMode = parseStatusWidgetMode(opts.chatMode);
  const mode = resolveEffectiveStatusWidgetMode({
    requestedMode,
    hasCreatorWidget: Boolean(characterWidget),
    hasAllowedUserWidget,
  });

  const explicitDisplay = parseStatusWidgetDisplayMode(opts.displayMode);
  const displayMode = clampDisplayMode({
    preference: explicitDisplay ?? displayModeFromEngineMode(requestedMode),
    hasCreatorWidget: Boolean(characterWidget),
    hasAllowedUserWidget,
  });

  const stackOrder = parseStatusWidgetStackOrder(opts.stackOrder);
  const needsCharacterValues =
    Boolean(characterWidget) && statusWidgetHasCreatorSource(mode);
  const needsUserValues = Boolean(userWidget) && statusWidgetHasUserSource(mode);

  return {
    active: mode !== "off",
    requestedMode,
    mode,
    displayMode,
    stackOrder,
    characterWidget,
    userWidget,
    needsCharacterValues,
    needsUserValues,
  };
}

/** Single render-source owner: ACTIVE_ENGINE_SOURCES ∩ DISPLAY_REQUESTED_SOURCES */
export function orderedWidgetsForRender(
  resolved: ResolvedStatusWidgetTurn,
  values: { character?: Record<string, string> | null; user?: Record<string, string> | null }
): Array<{ source: "character" | "user"; widget: StatusWidget; values: Record<string, string> }> {
  if (!resolved.active) return [];
  if (resolved.displayMode === "hidden") return [];

  const displayCreator =
    resolved.displayMode === "creator" || resolved.displayMode === "both";
  const displayUser =
    resolved.displayMode === "user" || resolved.displayMode === "both";
  const showCreator =
    displayCreator &&
    statusWidgetHasCreatorSource(resolved.mode) &&
    Boolean(resolved.characterWidget);
  const showUser =
    displayUser &&
    statusWidgetHasUserSource(resolved.mode) &&
    Boolean(resolved.userWidget);

  const items: Array<{
    source: "character" | "user";
    widget: StatusWidget;
    values: Record<string, string>;
  }> = [];

  const pushCharacter = () => {
    if (showCreator && resolved.characterWidget) {
      items.push({
        source: "character",
        widget: resolved.characterWidget,
        values: values.character ?? {},
      });
    }
  };
  const pushUser = () => {
    if (showUser && resolved.userWidget) {
      items.push({
        source: "user",
        widget: resolved.userWidget,
        values: values.user ?? {},
      });
    }
  };

  if (resolved.stackOrder === "user_first") {
    pushUser();
    pushCharacter();
  } else {
    pushCharacter();
    pushUser();
  }

  return items;
}

/** Creator machine-trigger namespace only (STATUS_TRIGGER_OWNER=CREATOR_SOURCE_ONLY). */
export function resolveStatusWidgetEngineStatusKeys(
  resolved: ResolvedStatusWidgetTurn
): string[] {
  if (!resolved.needsCharacterValues || !resolved.characterWidget) return [];
  const keys = new Set<string>();
  for (const field of resolved.characterWidget.fields) {
    if (field.id?.trim()) keys.add(field.id.trim());
    const labelKey = field.label?.trim();
    if (labelKey) keys.add(labelKey);
  }
  return [...keys];
}

export function defaultChatStatusWidgetMode(characterHasWidget = false): StatusWidgetSourceMode {
  return characterHasWidget ? "character_only" : "off";
}

/**
 * @deprecated COMPATIBILITY_ONLY_OWNER — do not use for runtime engine.
 * Runtime engine mode is derived by statusWidgetModeForDefinitions.
 */
export function statusWidgetModeFromUserToggle(
  userOn: boolean,
  hasCharacterWidget: boolean
): StatusWidgetSourceMode {
  if (hasCharacterWidget) {
    return userOn ? "both" : "character_only";
  }
  return userOn ? "user_only" : "off";
}

/** Display-source clamp only. Never writes engine mode. */
export function displayModeFromUserChoice(opts: {
  hasCharacterWidget: boolean;
  hasUserWidget: boolean;
  preference: StatusWidgetDisplayMode;
}): StatusWidgetDisplayMode {
  const { hasCharacterWidget, hasUserWidget, preference } = opts;
  if (preference === "hidden") return "hidden";
  if (preference === "both") {
    if (hasCharacterWidget && hasUserWidget) return "both";
    if (hasCharacterWidget) return "creator";
    if (hasUserWidget) return "user";
    return "hidden";
  }
  if (preference === "user") {
    if (hasUserWidget) return "user";
    return "hidden";
  }
  if (hasCharacterWidget) return "creator";
  return "hidden";
}

/**
 * @deprecated COMPATIBILITY_ONLY_OWNER — delegate to displayVisibilityFromMode.
 * Must not be used to derive engine mode.
 */
export function statusWidgetTogglesFromDisplayMode(display: StatusWidgetDisplayMode): {
  creatorVisible: boolean;
  userVisible: boolean;
  uiHidden: boolean;
} {
  const { creatorVisible, userVisible } = displayVisibilityFromMode(display);
  return {
    creatorVisible,
    userVisible,
    uiHidden: !creatorVisible && !userVisible,
  };
}
