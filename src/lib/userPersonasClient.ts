import type { CharacterGender } from "./characterGender";

export type DbUserPersona = {
  id: number;
  user_id: number;
  name: string;
  memo: string;
  gender: CharacterGender;
  description: string;
  secret_description: string;
  speech_examples: string;
  /** Full uploaded image URL (`/uploads/…`). Empty when unset. */
  image_url: string;
  /** Focal point X in [0, 1] for CSS object-position (face framing). */
  image_focus_x: number;
  /** Focal point Y in [0, 1] for CSS object-position (face framing). */
  image_focus_y: number;
  created_at: string;
};

export type PersonaListItem = DbUserPersona;

/** Default focus ≈ upper-center (face-friendly) for portrait cover crops. */
export const PERSONA_IMAGE_FOCUS_DEFAULT = { x: 0.5, y: 0.28 } as const;

const PERSONA_IMAGE_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;

export function sanitizePersonaImageUrl(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return PERSONA_IMAGE_URL_RE.test(s) ? s : "";
}

export function sanitizePersonaImageFocus(
  raw: unknown,
  fallback: number
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(1, Math.max(0, n));
  return Math.round(clamped * 10000) / 10000;
}

export function personaImageObjectPosition(
  focusX: number | null | undefined,
  focusY: number | null | undefined
): string {
  const x = sanitizePersonaImageFocus(focusX, PERSONA_IMAGE_FOCUS_DEFAULT.x);
  const y = sanitizePersonaImageFocus(focusY, PERSONA_IMAGE_FOCUS_DEFAULT.y);
  return `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`;
}
