import { CHAT_ROOM_IMAGE_GENERATION_POINTS } from "@/lib/chatImagePricing";

export const CHAT_IMAGE_GENERATION_DEFAULT_MODEL = "gpt-image-2";

/**
 * Friendly display labels for known provider image models. Display labels
 * must always derive from the actual resolved model id (see
 * resolveChatImageGenerationModelLabel) so an OPENAI_IMAGE_MODEL override can
 * never be shown under the wrong label.
 */
const CHAT_IMAGE_GENERATION_MODEL_LABELS: Readonly<Record<string, string>> = {
  "gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
  "gpt-image-2.5-flare": "GPT Image 2.5 Flare",
  "gpt-image-2": "GPT Image 2",
};

/**
 * Canonical friendly display label derived from a resolved model id.
 *
 * - known ids map to their friendly label
 * - dated snapshots ("<known-id>-…") inherit the parent's friendly label
 * - unknown/custom ids are surfaced as-is (never borrowed a known label)
 */
export function resolveChatImageGenerationModelLabel(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  const known = CHAT_IMAGE_GENERATION_MODEL_LABELS[trimmed];
  if (known) return known;
  const snapshotBase = (
    ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"] as const
  ).find((base) => trimmed.startsWith(`${base}-`));
  return snapshotBase ? CHAT_IMAGE_GENERATION_MODEL_LABELS[snapshotBase] : trimmed;
}

export const CHAT_IMAGE_GENERATION_DEFAULT_POINTS = CHAT_ROOM_IMAGE_GENERATION_POINTS;

export type ImagePromptGender = "male" | "female" | "other";


export function buildImageGenderLockPrompt(
  subjects: readonly { label: string; name: string; gender: ImagePromptGender }[]
): string {
  const rules = subjects.map((subject) => {
    const name = subject.name.trim() || subject.label;
    if (subject.gender === "male") {
      return [
        `${subject.label} ${name}: confirmed MALE.`,
        "Keep him male in face, torso and body shape.",
        "Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female.",
        "Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.",
      ].join(" ");
    }
    if (subject.gender === "female") {
      return [
        `${subject.label} ${name}: confirmed FEMALE.`,
        "Keep her female in face, torso and body shape.",
        "Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male.",
        "Do not masculinize her body, jaw, torso or clothing beyond the reference identity.",
      ].join(" ");
    }
    return [
      `${subject.label} ${name}: gender is unspecified / non-binary.`,
      "Do not infer or change gender from hair length, cuteness, outfit, pose, blush, eyelashes or body size.",
      "Follow the reference identity without adding stereotyped male or female anatomy unless it is clearly present in the reference.",
    ].join(" ");
  });

  return [
    "GENDER LOCK — mandatory identity rule.",
    ...rules,
    "Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.",
  ].join("\n");
}

export function resolveChatImageGenerationPrice(
  _env: NodeJS.ProcessEnv = process.env
): number {
  return CHAT_IMAGE_GENERATION_DEFAULT_POINTS;
}

export function resolveChatImageGenerationModel(
  env: NodeJS.ProcessEnv = process.env
): string {
  return env.OPENAI_IMAGE_MODEL?.trim() || CHAT_IMAGE_GENERATION_DEFAULT_MODEL;
}
