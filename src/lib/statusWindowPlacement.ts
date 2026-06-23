export type StatusWindowPlacement = "top" | "bottom";

export const STATUS_WINDOW_BOTTOM_PLACEMENT_RE =
  /하단|맨\s*아래|bottom|본문\s*하단|아래에|아래로|RP\s*뒤|본문\s*뒤/i;

export const STATUS_WINDOW_TOP_PLACEMENT_RE =
  /상단|맨\s*위|top|본문\s*상단|위에|위로|RP\s*앞|본문\s*앞|맨\s*앞/i;

export type StatusWindowPlacementSources = {
  userMessage?: string;
  userNote?: string;
  userPersona?: string;
  characterSetting?: string;
};

function lastMatchIndex(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const globalRe = new RegExp(re.source, flags);
  let last = -1;
  for (const match of text.matchAll(globalRe)) {
    if (match.index != null) last = match.index;
  }
  return last;
}

/** 단일 텍스트에서 상·하단 힌트 해석 (둘 다 있으면 뒤에 나온 쪽) */
export function resolveStatusWindowPlacementInText(text: string): StatusWindowPlacement | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const topIdx = lastMatchIndex(trimmed, STATUS_WINDOW_TOP_PLACEMENT_RE);
  const bottomIdx = lastMatchIndex(trimmed, STATUS_WINDOW_BOTTOM_PLACEMENT_RE);
  if (topIdx < 0 && bottomIdx < 0) return null;
  if (topIdx >= 0 && bottomIdx < 0) return "top";
  if (bottomIdx >= 0 && topIdx < 0) return "bottom";
  return bottomIdx > topIdx ? "bottom" : "top";
}

/** 채팅 > 유저노트 > 페르소나 > 캐릭터 설정 순 — 지정 없으면 defaultPlacement */
export function resolveStatusWindowPlacementFromSources(
  sources: StatusWindowPlacementSources,
  defaultPlacement: StatusWindowPlacement
): StatusWindowPlacement {
  for (const text of [
    sources.userMessage,
    sources.userNote,
    sources.userPersona,
    sources.characterSetting,
  ]) {
    const placement = resolveStatusWindowPlacementInText(text ?? "");
    if (placement) return placement;
  }
  return defaultPlacement;
}
