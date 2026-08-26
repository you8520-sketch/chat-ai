export function isMemoryFeatureEnabledIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.MEMORY_FEATURE_ENABLED?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

/** true | 1 | yes (default) — long-term memory system. Set 0|false|no|off to disable entirely. */
export function isMemoryFeatureEnabled(): boolean {
  if (!isMemoryFeatureEnabledIn()) {
    logMemoryFeatureDisabledOnce();
    return false;
  }
  logMemoryFeatureEnabledOnce();
  return true;
}

/** Summary barrier follows MEMORY_FEATURE_ENABLED only — no 5+4 / 6+5 flag. */
export function isSummaryBarrierActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return isMemoryFeatureEnabledIn(env);
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
