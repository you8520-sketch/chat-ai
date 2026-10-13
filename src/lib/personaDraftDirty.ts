import { PERSONA_IMAGE_FOCUS_DEFAULT, type PublicPersonaListItem } from "@/lib/userPersonasClient";

export type PersonaDraftSnapshot = {
  name: string;
  memo: string;
  gender: string;
  description: string;
  imageUrl: string;
  imageFocusX: number;
  imageFocusY: number;
  secretDescription: string;
  /** True only after the owner edited the secret field (never inferred from content). */
  secretDirty: boolean;
};

/**
 * Whether the open persona form holds edits that are not saved yet.
 * Comparison only — it never reads or stores secret source beyond the in-memory draft
 * the page already owns.
 */
export function isPersonaDraftDirty(
  draft: PersonaDraftSnapshot,
  saved: Pick<
    PublicPersonaListItem,
    "name" | "memo" | "gender" | "description" | "image_url" | "image_focus_x" | "image_focus_y"
  > | null
): boolean {
  if (!saved) {
    return Boolean(
      draft.name.trim() ||
        draft.memo.trim() ||
        draft.description.trim() ||
        draft.secretDescription.trim() ||
        draft.imageUrl.trim() ||
        draft.gender
    );
  }
  return (
    draft.name !== saved.name ||
    draft.memo !== (saved.memo ?? "") ||
    draft.gender !== (saved.gender ?? "other") ||
    draft.description !== saved.description ||
    draft.imageUrl !== (saved.image_url ?? "") ||
    draft.imageFocusX !== (saved.image_focus_x ?? PERSONA_IMAGE_FOCUS_DEFAULT.x) ||
    draft.imageFocusY !== (saved.image_focus_y ?? PERSONA_IMAGE_FOCUS_DEFAULT.y) ||
    draft.secretDirty
  );
}

export function isTitledDraftDirty(
  draft: { title: string; content: string },
  saved: { title: string; content: string } | null
): boolean {
  if (!saved) return Boolean(draft.title.trim() || draft.content.trim());
  return draft.title !== saved.title || draft.content !== saved.content;
}

export const UNSAVED_DRAFT_CONFIRM_MESSAGE =
  "저장하지 않은 변경 사항이 있어요. 버리고 계속할까요?";
