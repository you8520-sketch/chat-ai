import crypto from "crypto";
import { translationSourceFingerprint } from "@/lib/derivedCache/versions";

export type CharacterCanonicalSourceInput = {
  name: string;
  gender: string;
  systemPrompt: string;
  world: string;
  exampleDialog: string;
  appearanceRaw: string;
  creatorCompiledDescriptionJson: string;
  contentKind?: string;
};

/** User-editable canonical source — durable job identity, not derived chunk hash. */
export function characterCanonicalSourceFingerprint(input: CharacterCanonicalSourceInput): string {
  const payload = [
    input.name,
    input.gender,
    input.systemPrompt,
    input.world,
    input.exampleDialog,
    input.appearanceRaw,
    input.creatorCompiledDescriptionJson,
    input.contentKind ?? "character",
  ].join("\u0001");
  const hash = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  return translationSourceFingerprint(hash);
}

export function characterCanonicalSourceFingerprintFromRow(row: {
  name: string;
  gender?: string | null;
  system_prompt?: string | null;
  world?: string | null;
  example_dialog?: string | null;
  appearance_raw?: string | null;
  creator_compiled_description_json?: string | null;
  content_kind?: string | null;
}): string {
  return characterCanonicalSourceFingerprint({
    name: row.name,
    gender: row.gender ?? "other",
    systemPrompt: row.system_prompt ?? "",
    world: row.world ?? "",
    exampleDialog: row.example_dialog ?? "",
    appearanceRaw: row.appearance_raw ?? "",
    creatorCompiledDescriptionJson: row.creator_compiled_description_json ?? "",
    contentKind: row.content_kind ?? "character",
  });
}
