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

/**
 * Resolve engine + display for a status-widget turn.
 *
 * Engine (canonical): when a creator widget exists it is ALWAYS included —
 * needsCharacterValues stays true regardless of display preference (including hidden).
 * Display: visual-only filter for orderedWidgetsForRender.
 */
export function resolveStatusWidgetTurn(opts: {
  characterWidgetJson?: string | null;
  chatMode?: string | null;
  userWidgetJson?: string | null;
  stackOrder?: string | null;
  characterAllowUserOverride?: boolean;
  /** Visual-only preference; never disables creator engine status */
  displayMode?: string | null;
}): ResolvedStatusWidgetTurn {
  const characterWidget = parseStatusWidgetJson(opts.characterWidgetJson);
  const userWidgetParsed = parseStatusWidgetJson(opts.userWidgetJson);
  const allowUser =
    opts.characterAllowUserOverride !== false && Boolean(userWidgetParsed);
  const userWidget = allowUser ? userWidgetParsed : null;

  const storedMode = parseStatusWidgetMode(opts.chatMode);
  const explicitDisplay = parseStatusWidgetDisplayMode(opts.displayMode);
  let displayMode: StatusWidgetDisplayMode =
    explicitDisplay ?? displayModeFromEngineMode(storedMode);

  // Clamp display when widgets missing
  if (displayMode === "user" && !userWidget) {
    displayMode = characterWidget ? "creator" : "hidden";
  }
  if (displayMode === "both" && !userWidget) {
    displayMode = characterWidget ? "creator" : "hidden";
  }
  if ((displayMode === "creator" || displayMode === "both") && !characterWidget) {
    displayMode = userWidget ? "user" : "hidden";
  }

  // ── Engine mode ──────────────────────────────────────────────────────────
  // Creator widget present → always character_only or both (never off / user_only).
  let mode: StatusWidgetSourceMode;
  if (characterWidget) {
    const wantUserValues =
      Boolean(userWidget) &&
      (displayMode === "user" || displayMode === "both" || storedMode === "both");
    mode = wantUserValues ? "both" : "character_only";
  } else if (userWidget && displayMode !== "hidden") {
    mode = "user_only";
  } else {
    mode = "off";
  }

  const stackOrder = parseStatusWidgetStackOrder(opts.stackOrder);
  const active = mode !== "off";

  return {
    active,
    mode,
    displayMode,
    stackOrder,
    // Always keep creator widget reference for engine when it exists
    characterWidget,
    // Keep user widget when engine needs user values OR display shows user overlay
    userWidget:
      userWidget &&
      (mode === "both" ||
        mode === "user_only" ||
        displayMode === "user" ||
        displayMode === "both")
        ? userWidget
        : null,
    needsCharacterValues: Boolean(characterWidget),
    needsUserValues:
      Boolean(userWidget) &&
      (mode === "both" || mode === "user_only") &&
      displayMode !== "hidden",
  };
}

/** Widgets to paint in the chat UI — respects displayMode only. */
export function orderedWidgetsForRender(
  resolved: ResolvedStatusWidgetTurn,
  values: { character?: Record<string, string> | null; user?: Record<string, string> | null }
): Array<{ source: "character" | "user"; widget: StatusWidget; values: Record<string, string> }> {
  if (!resolved.active) return [];
  if (resolved.displayMode === "hidden") return [];

  const showCreator =
    resolved.displayMode === "creator" || resolved.displayMode === "both";
  const showUser =
    resolved.displayMode === "user" || resolved.displayMode === "both";

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

export function defaultChatStatusWidgetMode(characterHasWidget = false): StatusWidgetSourceMode {
  return characterHasWidget ? "character_only" : "off";
}

export function statusWidgetModeFromToggles(
  creatorOn: boolean,
  userOn: boolean
): StatusWidgetSourceMode {
  if (!creatorOn && !userOn) return "off";
  if (creatorOn && userOn) return "both";
  if (creatorOn) return "character_only";
  return "user_only";
}

/** @deprecated Prefer displayModeFromUserChoice — engine mode is derived from display. */
export function statusWidgetModeFromUserToggle(
  userOn: boolean,
  hasCharacterWidget: boolean
): StatusWidgetSourceMode {
  if (hasCharacterWidget) {
    return userOn ? "both" : "character_only";
  }
  return userOn ? "user_only" : "off";
}

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
    return hasCharacterWidget ? "creator" : "hidden";
  }
  // creator
  if (hasCharacterWidget) return "creator";
  return hasUserWidget ? "user" : "hidden";
}

export function statusWidgetTogglesFromMode(mode: StatusWidgetSourceMode): {
  creatorOn: boolean;
  userOn: boolean;
} {
  switch (mode) {
    case "character_only":
      return { creatorOn: true, userOn: false };
    case "user_only":
      return { creatorOn: false, userOn: true };
    case "both":
      return { creatorOn: true, userOn: true };
    default:
      return { creatorOn: false, userOn: false };
  }
}

export function statusWidgetTogglesFromDisplayMode(display: StatusWidgetDisplayMode): {
  creatorVisible: boolean;
  userVisible: boolean;
  uiHidden: boolean;
} {
  switch (display) {
    case "creator":
      return { creatorVisible: true, userVisible: false, uiHidden: false };
    case "user":
      return { creatorVisible: false, userVisible: true, uiHidden: false };
    case "both":
      return { creatorVisible: true, userVisible: true, uiHidden: false };
    case "hidden":
      return { creatorVisible: false, userVisible: false, uiHidden: true };
  }
}
