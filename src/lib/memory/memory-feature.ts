/** true | 1 | yes (default) — long-term memory system. Set 0|false|no|off to disable entirely. */
export function isMemoryFeatureEnabled(): boolean {
  const raw = process.env.MEMORY_FEATURE_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    logMemoryFeatureDisabledOnce();
    return false;
  }
  logMemoryFeatureEnabledOnce();
  return true;
}

let disabledLogged = false;
let enabledLogged = false;

export function logMemoryFeatureEnabledOnce(): void {
  if (enabledLogged || process.env.NODE_ENV === "production") return;
  enabledLogged = true;
  console.info("[memory-feature] ENABLED — memory prompt + background jobs active");
}

export function logMemoryFeatureDisabledOnce(): void {
  if (disabledLogged) return;
  disabledLogged = true;
  console.warn("[memory-feature] DISABLED — all memory jobs skipped (MEMORY_FEATURE_ENABLED=0)", {
    skipped: [
      "buildMemoryContextForChat",
      "scheduleMemoryUpdate",
      "mergeRelationshipMetaFromTurn",
      "processRollingSummaryBatch",
      "ensureLorebookWithinBudget",
      "compactCurrentMemory",
      "syncMemoryFromChat",
    ],
  });
}

export function emptyMemoryInjection(
  tier: import("./memory-types").MemoryTier = "free"
): import("./memory-types").MemoryInjection {
  return {
    text: "",
    archiveText: "",
    pinnedChars: 0,
    recentChars: 0,
    archiveChars: 0,
    archiveIncluded: false,
    usedChars: 0,
    limit: 0,
    tier,
  };
}
