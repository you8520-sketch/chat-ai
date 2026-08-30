import { createHash } from "node:crypto";

/** Semantic world inputs that affect sandbox Blueprint generation (excludes updated_at). */
export type BlueprintSourceInput = {
  name?: string;
  summary?: string;
  content?: string;
};

/** Single canonical owner for Blueprint cache / job / artifact source identity. */
export function blueprintSourceFingerprint(opts: BlueprintSourceInput): string {
  return createHash("sha256")
    .update(`${opts.name ?? ""}\n${opts.summary ?? ""}\n${opts.content ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}
