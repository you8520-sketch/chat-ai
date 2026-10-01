import { buildJsxComponentManifestBlock } from "./manifest";
import type { JsxComponentManifestRecord } from "./types";

/**
 * Canonical AI-callable component instruction owner.
 * Injected only when the character catalog is non-empty.
 * Does not carry JSX source. Complements HTML_OUTPUT_OWNERSHIP_BLOCK
 * instead of adding a second general UI-instruction owner.
 */
export function resolveJsxComponentPromptBlock(catalog: JsxComponentManifestRecord[]): string | null {
  const block = buildJsxComponentManifestBlock(catalog);
  return block.trim() ? block : null;
}
