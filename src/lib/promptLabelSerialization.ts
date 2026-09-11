/**
 * Canonical serializer for untrusted label collections rendered into prompts.
 *
 * Creator-controlled asset tags are free-form semantic labels that the model is
 * intentionally told to read (they are candidate identifiers). When a collection
 * is rendered for the model it must preserve each label's boundary so a single
 * legal label such as "당황, 웃음" or "접근 | 시선 회피" cannot read as two
 * candidates, and quotes/backslashes cannot break out of the list.
 *
 * This is a PROMPT-RENDERING representation only — it is never a storage format.
 * The persisted asset tag remains a plain string.
 */

/** Trim, drop empties, and de-duplicate while keeping first-seen order. */
export function normalizePromptLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = String(raw ?? "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * Serialize a label collection as a JSON string array. JSON escaping guarantees
 * each label is exactly one element (commas, pipes, quotes and backslashes are
 * data, never delimiters) and the result round-trips via JSON.parse.
 */
export function serializePromptLabels(labels: readonly string[]): string {
  return JSON.stringify(normalizePromptLabels(labels));
}