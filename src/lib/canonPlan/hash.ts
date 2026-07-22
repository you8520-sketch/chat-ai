import crypto from "crypto";

import { CANON_COMPILER_VERSION } from "@/lib/canonPlan/types";

export function normalizeCanonSource(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function hashCanonSource(raw: string, compilerVersion = CANON_COMPILER_VERSION): string {
  return crypto
    .createHash("sha256")
    .update(`canon-plan-v${compilerVersion}\n${normalizeCanonSource(raw)}`)
    .digest("hex");
}

export function stableCanonChunkId(input: {
  bucket: string;
  sectionTitle: string;
  paragraphIndex: number;
  text: string;
}): string {
  const payload = [
    "canon-chunk-v1",
    input.bucket,
    input.sectionTitle.trim().toLowerCase(),
    String(input.paragraphIndex),
    normalizeCanonSource(input.text),
  ].join("\n");
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
