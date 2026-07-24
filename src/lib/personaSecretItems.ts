import { createHash } from "node:crypto";

export type PersonaSecretItem = {
  /** Stable hash of normalized secret unit text */
  secretKey: string;
  normalizedText: string;
};

export function hashPersonaSecretKey(normalizedText: string): string {
  return createHash("sha256").update(normalizedText.trim()).digest("hex").slice(0, 16);
}

/** Blank-line-separated secret units — deterministic, no AI, no regex classification. */
export function splitPersonaSecretItems(secretDescription: string): PersonaSecretItem[] {
  const trimmed = secretDescription.trim();
  if (!trimmed) return [];

  return trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((normalizedText) => ({
      normalizedText,
      secretKey: hashPersonaSecretKey(normalizedText),
    }));
}
