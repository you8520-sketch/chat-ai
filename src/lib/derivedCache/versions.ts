import crypto from "crypto";

/** Bump when translation protocol / system prompt / output schema changes — not on model-only swaps. */
export const TRANSLATION_DERIVATION_VERSION = 1;

export function translationSourceFingerprint(sourceHash: string): string {
  return `${sourceHash}:v${TRANSLATION_DERIVATION_VERSION}`;
}

export function hashWorldContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function worldContentFingerprint(content: string): string {
  return translationSourceFingerprint(hashWorldContent(content));
}
