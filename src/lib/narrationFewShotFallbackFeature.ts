/** Platform narration few-shot when example_dialog is empty. Default OFF — opt-in via env or test helper. */

const ENV_KEY = "NARRATION_FEWSHOT_FALLBACK_ENABLED";

function parseEnabled(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function isNarrationFewShotFallbackEnabled(): boolean {
  return parseEnabled(process.env[ENV_KEY]);
}

/** Validation scripts / unit tests — enable fallback in-process without touching .env.local. */
export function enableNarrationFewShotFallbackForTests(): void {
  process.env[ENV_KEY] = "1";
}

export function disableNarrationFewShotFallbackForTests(): void {
  delete process.env[ENV_KEY];
}
