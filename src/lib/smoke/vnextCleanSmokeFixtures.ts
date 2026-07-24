/**
 * Future VNext clean-smoke fixture identity helpers.
 * Harness-only — does not change production identity semantics.
 */

export const VNEXT_CLEAN_SMOKE_DISPLAY_NAMES = {
  quiet: "이준서",
  tactical: "에녹",
  locked: "카일",
} as const;

/** Internal marker prefix — must never be used as characters.name / charName. */
export const VNEXT_SMOKE_INTERNAL_MARKER_PREFIXES = [
  "PRC-QUIET-",
  "PRC-TAC-",
  "PRC-LOCKED-",
] as const;

export type VNextCleanSmokeFixtureKind = keyof typeof VNEXT_CLEAN_SMOKE_DISPLAY_NAMES;

/** Public display name for a smoke fixture character (goes into characters.name / charName). */
export function resolveVNextCleanSmokeDisplayName(kind: VNextCleanSmokeFixtureKind): string {
  return VNEXT_CLEAN_SMOKE_DISPLAY_NAMES[kind];
}

/** Non-prompt metadata id (chat title / local artifact only). */
export function buildVNextSmokeInternalMarker(
  kind: VNextCleanSmokeFixtureKind,
  marker: string
): string {
  const suffix = String(marker || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(-12) || "x";
  if (kind === "quiet") return `PRC-QUIET-${suffix}`;
  if (kind === "tactical") return `PRC-TAC-${suffix}`;
  return `PRC-LOCKED-${suffix}`;
}

/**
 * Fail if assembled prompt identity text contains synthetic PRC fixture IDs.
 * Checks common identity surfaces; does not require full prompt dump in logs.
 */
export function assertNoPrcSyntheticIdentityInPrompt(parts: {
  characterName?: string | null;
  charName?: string | null;
  systemPromptIdentity?: string | null;
  assembledSystemText?: string | null;
}): { ok: true } | { ok: false; hits: string[] } {
  const hits: string[] = [];
  const surfaces: Array<[string, string | null | undefined]> = [
    ["characterName", parts.characterName],
    ["charName", parts.charName],
    ["systemPromptIdentity", parts.systemPromptIdentity],
    ["assembledSystemText", parts.assembledSystemText],
  ];
  for (const [label, value] of surfaces) {
    const text = String(value ?? "");
    if (!text) continue;
    for (const prefix of VNEXT_SMOKE_INTERNAL_MARKER_PREFIXES) {
      if (text.includes(prefix)) hits.push(`${label}:${prefix}`);
    }
  }
  return hits.length ? { ok: false, hits } : { ok: true };
}

/** Future clean-smoke output ceiling (DeepSeek V4 Pro supports >>4096). */
export const VNEXT_CLEAN_SMOKE_MAX_TOKENS = 4096;

export const VNEXT_SMOKE_MAX_TOKENS_ENV = "VNEXT_SMOKE_MAX_TOKENS_ENABLED";

/**
 * Parse optional smoke-only max_tokens. Production default: undefined (omit max_tokens).
 * Only when env enabled AND value is a safe integer in [1024, 8192].
 * Caller must also gate on admin (`canShowFullBillingReceipt` / is_admin / ADMIN_EMAILS).
 */
export function resolveVNextSmokeMaxTokensOverride(opts: {
  envEnabled: boolean;
  smokeMaxTokens: unknown;
}): number | undefined {
  if (!opts.envEnabled) return undefined;
  const n =
    typeof opts.smokeMaxTokens === "number" ? opts.smokeMaxTokens : Number(opts.smokeMaxTokens);
  if (!Number.isFinite(n)) return undefined;
  const floored = Math.floor(n);
  if (floored < 1024 || floored > 8192) return undefined;
  return floored;
}

/** True when `VNEXT_SMOKE_MAX_TOKENS_ENABLED` is explicitly on. */
export function isVNextSmokeMaxTokensEnvEnabled(
  envValue: string | undefined = process.env[VNEXT_SMOKE_MAX_TOKENS_ENV]
): boolean {
  const v = envValue?.trim();
  return v === "1" || v?.toLowerCase() === "true";
}

/**
 * Future clean re-smoke cost accounting (prepare-only — do not execute).
 * Previous dirty smoke: official=4, additional=2, actualTotal=6.
 */
export type VNextSmokeCostAccounting = {
  officialBenchmarkCalls: number;
  additionalCalls: number;
  actualTotalModelCalls: number;
};

export const VNEXT_CLEAN_SMOKE_COST_ACCOUNTING_TEMPLATE: VNextSmokeCostAccounting = {
  officialBenchmarkCalls: 4,
  additionalCalls: 0,
  actualTotalModelCalls: 4,
};

/**
 * Future clean re-smoke spec — PREPARE ONLY, DO NOT EXECUTE.
 * CALL1 quiet 이준서, CALL2 tac 에녹, CALL3 mature 이준서, CALL4 locked 카일.
 */
export const VNEXT_CLEAN_SMOKE_SPEC = {
  prepared: true,
  execute: false as const,
  modelCallsExact: 4,
  noRerolls: true,
  requirements: [
    "no PRC-* in characters.name / charName / prompt identity",
    "PRC markers only in chat title / local artifact / internal test id",
    "explicit safe max_tokens (prefer 4096) via admin+env+body.smokeMaxTokens",
    "finishReason captured on Usage + SSE done",
    "full visible output retained",
    "evaluate VNext prose + ownership",
  ],
  calls: [
    { call: 1, kind: "quiet" as const, displayName: "이준서", role: "quiet baseline" },
    { call: 2, kind: "tactical" as const, displayName: "에녹", role: "event tactical" },
    { call: 3, kind: "quiet" as const, displayName: "이준서", role: "mature history" },
    { call: 4, kind: "locked" as const, displayName: "카일", role: "locked secret" },
  ],
  preferredMaxTokens: VNEXT_CLEAN_SMOKE_MAX_TOKENS,
  costAccounting: VNEXT_CLEAN_SMOKE_COST_ACCOUNTING_TEMPLATE,
} as const;
