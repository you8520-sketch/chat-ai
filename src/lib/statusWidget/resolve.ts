import { parseStatusWidgetJson, parseStatusWidgetMode, parseStatusWidgetStackOrder } from "./serialize";
import type { ResolvedStatusWidgetTurn, StatusWidget, StatusWidgetSourceMode } from "./types";

export function resolveStatusWidgetTurn(opts: {
  characterWidgetJson?: string | null;
  chatMode?: string | null;
  userWidgetJson?: string | null;
  stackOrder?: string | null;
  characterAllowUserOverride?: boolean;
}): ResolvedStatusWidgetTurn {
  const characterWidget = parseStatusWidgetJson(opts.characterWidgetJson);
  const userWidget = parseStatusWidgetJson(opts.userWidgetJson);
  let mode = parseStatusWidgetMode(opts.chatMode);

  // 제작자 위젯이 있으면 매 턴 필수 — off / user_only 로 끌 수 없음
  if (characterWidget) {
    if (mode === "off") mode = "character_only";
    if (mode === "user_only") mode = userWidget ? "both" : "character_only";
  }

  if (opts.characterAllowUserOverride === false && mode !== "off") {
    mode = "character_only";
  }

  if (mode === "user_only" && !userWidget) {
    mode = characterWidget ? "character_only" : "off";
  }
  if (mode === "both" && !userWidget) {
    mode = "character_only";
  }
  if (mode === "character_only" && !characterWidget) {
    mode = userWidget ? "user_only" : "off";
  }

  const stackOrder = parseStatusWidgetStackOrder(opts.stackOrder);
  const active = mode !== "off";

  return {
    active,
    mode,
    stackOrder,
    characterWidget: mode === "user_only" ? null : characterWidget,
    userWidget: mode === "character_only" ? null : userWidget,
    needsCharacterValues: active && (mode === "character_only" || mode === "both"),
    needsUserValues: active && (mode === "user_only" || mode === "both") && Boolean(userWidget),
  };
}

export function orderedWidgetsForRender(
  resolved: ResolvedStatusWidgetTurn,
  values: { character?: Record<string, string> | null; user?: Record<string, string> | null }
): Array<{ source: "character" | "user"; widget: StatusWidget; values: Record<string, string> }> {
  if (!resolved.active) return [];

  const items: Array<{ source: "character" | "user"; widget: StatusWidget; values: Record<string, string> }> = [];

  const pushCharacter = () => {
    if (resolved.characterWidget) {
      items.push({
        source: "character",
        widget: resolved.characterWidget,
        values: values.character ?? {},
      });
    }
  };
  const pushUser = () => {
    if (resolved.userWidget) {
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

/** 제작자 위젯 필수일 때 — 유저 위젯 토글만으로 mode 결정 */
export function statusWidgetModeFromUserToggle(
  userOn: boolean,
  hasCharacterWidget: boolean
): StatusWidgetSourceMode {
  if (hasCharacterWidget) {
    return userOn ? "both" : "character_only";
  }
  return userOn ? "user_only" : "off";
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
