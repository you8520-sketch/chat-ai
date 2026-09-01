import type { CSSProperties } from "react";
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
  /** Focal point X in [0, 1] for display-only framing. */
  image_focus_x: number;
  /** Focal point Y in [0, 1] for display-only framing. */
  image_focus_y: number;
  /** Canonical persona-owned status-widget selection. Null means no persona widget. */
  active_status_widget_preset_id: number | null;
  /** Latest definition resolved from the selected preset; empty when selection is invalid/none. */
  active_status_widget_json: string;
  created_at: string;
};

/** Safe for chat hydration, selectors, and all public persona lists. */
export type PublicPersonaListItem = Omit<DbUserPersona, "secret_description">;

/** Owner-management response only. Never use this type for chat hydration. */
export type OwnerPersonaEditorItem = PublicPersonaListItem & {
  secret_description: string;
};

/** @deprecated Use PublicPersonaListItem or OwnerPersonaEditorItem explicitly. */
export type PersonaListItem = PublicPersonaListItem;

/** Default focus ≈ upper-center (face-friendly) for portrait cover crops. */
export const PERSONA_IMAGE_FOCUS_DEFAULT = { x: 0.5, y: 0.28 } as const;
export const PERSONA_IMAGE_SCALE_MIN = 1;
export const PERSONA_IMAGE_SCALE_DEFAULT = 1.25;
export const PERSONA_IMAGE_SCALE_MAX = 4;

const PERSONA_IMAGE_BASE_URL_RE = /^\/uploads\/[A-Za-z0-9._-]+$/;
const PERSONA_IMAGE_ZOOM_FRAGMENT_RE = /^zoom=([0-9]+(?:\.[0-9]+)?)$/;

function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sanitizePersonaImageScale(
  raw: unknown,
  fallback = PERSONA_IMAGE_SCALE_MIN
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return roundScale(Math.min(PERSONA_IMAGE_SCALE_MAX, Math.max(PERSONA_IMAGE_SCALE_MIN, n)));
}

function splitPersonaImageUrl(raw: unknown): { baseUrl: string; scale: number } | null {
  const value = String(raw ?? "").trim();
  if (!value) return { baseUrl: "", scale: PERSONA_IMAGE_SCALE_MIN };

  const hashIndex = value.indexOf("#");
  const baseUrl = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  if (!PERSONA_IMAGE_BASE_URL_RE.test(baseUrl)) return null;
  if (hashIndex < 0) return { baseUrl, scale: PERSONA_IMAGE_SCALE_MIN };

  const fragment = value.slice(hashIndex + 1);
  const match = PERSONA_IMAGE_ZOOM_FRAGMENT_RE.exec(fragment);
  if (!match) return null;
  return {
    baseUrl,
    scale: sanitizePersonaImageScale(match[1], PERSONA_IMAGE_SCALE_MIN),
  };
}

/**
 * The uploaded file URL stays unchanged; zoom is display-only metadata in the
 * URL fragment. Browser requests never send the fragment to `/uploads`.
 */
export function sanitizePersonaImageUrl(raw: unknown): string {
  const parsed = splitPersonaImageUrl(raw);
  if (!parsed || !parsed.baseUrl) return "";
  return withPersonaImageScale(parsed.baseUrl, parsed.scale);
}

export function personaImageBaseUrl(raw: unknown): string {
  return splitPersonaImageUrl(raw)?.baseUrl ?? "";
}

export function personaImageScale(raw: unknown): number {
  return splitPersonaImageUrl(raw)?.scale ?? PERSONA_IMAGE_SCALE_MIN;
}

export function withPersonaImageScale(raw: unknown, scale: unknown): string {
  const parsed = splitPersonaImageUrl(raw);
  if (!parsed?.baseUrl) return "";
  const safeScale = sanitizePersonaImageScale(scale, PERSONA_IMAGE_SCALE_DEFAULT);
  if (safeScale === PERSONA_IMAGE_SCALE_MIN) return parsed.baseUrl;
  return `${parsed.baseUrl}#zoom=${safeScale.toFixed(2)}`;
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

export function personaImageRenderStyle(
  imageUrl: unknown,
  focusX: number | null | undefined,
  focusY: number | null | undefined
): CSSProperties {
  const x = sanitizePersonaImageFocus(focusX, PERSONA_IMAGE_FOCUS_DEFAULT.x);
  const y = sanitizePersonaImageFocus(focusY, PERSONA_IMAGE_FOCUS_DEFAULT.y);
  const scale = personaImageScale(imageUrl);
  return {
    objectPosition: personaImageObjectPosition(x, y),
    transform: `scale(${scale})`,
    transformOrigin: `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`,
  };
}
