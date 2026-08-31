import { calcUsedChars } from "./memory-used-chars";

export type LegacyPinnedFoldInput = {
  pinned_facts: string;
  recent_summary: string;
  archive_summary: string;
};

export type LegacyPinnedFoldResult = {
  pinned_facts: "";
  recent_summary: string;
  archive_summary: string;
  used_chars: number;
};

/** Deterministic equivalent of legacy foldLegacyPinnedIntoLorebook row transform. */
export function computeLegacyPinnedFold(
  input: LegacyPinnedFoldInput
): LegacyPinnedFoldResult | null {
  const pinnedTrimmed = input.pinned_facts?.trim() ?? "";
  const rawPinned = input.pinned_facts ?? "";

  if (pinnedTrimmed) {
    const merged = [pinnedTrimmed, input.recent_summary?.trim() ?? ""]
      .filter(Boolean)
      .join("\n\n");
    return {
      pinned_facts: "",
      recent_summary: merged,
      archive_summary: input.archive_summary,
      used_chars: calcUsedChars({
        recent_summary: merged,
        archive_summary: input.archive_summary,
      }),
    };
  }

  if (rawPinned !== "") {
    return {
      pinned_facts: "",
      recent_summary: input.recent_summary,
      archive_summary: input.archive_summary,
      used_chars: calcUsedChars({
        recent_summary: input.recent_summary,
        archive_summary: input.archive_summary,
      }),
    };
  }

  return null;
}
