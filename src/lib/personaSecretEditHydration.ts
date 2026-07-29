import type { OwnerPersonaEditorItem } from "@/lib/userPersonasClient";

/** startEdit: never treat missing capability/editor as an empty loaded secret. */
export function resolveSecretDraftLoadedOnStartEdit(
  editor: Pick<OwnerPersonaEditorItem, "secret_description"> | undefined | null
): boolean {
  return Boolean(editor);
}

export function resolveSecretDraftOnStartEdit(
  editor: Pick<OwnerPersonaEditorItem, "secret_description"> | undefined | null
): { draftSecretDescription: string; draftSecretDescriptionLoaded: boolean } {
  return {
    draftSecretDescription: editor?.secret_description ?? "",
    draftSecretDescriptionLoaded: resolveSecretDraftLoadedOnStartEdit(editor),
  };
}

/** Capability arrived after edit opened — hydrate only when still unloaded and not dirty. */
export function shouldHydrateSecretDraftFromEditor(opts: {
  canEdit: boolean;
  draftSecretDescriptionLoaded: boolean;
  draftSecretDescriptionDirty: boolean;
  hasEditor: boolean;
}): boolean {
  return (
    opts.canEdit &&
    !opts.draftSecretDescriptionLoaded &&
    !opts.draftSecretDescriptionDirty &&
    opts.hasEditor
  );
}

/** Merge one authoritative owner editor row into the local cache. */
export function applyOwnerEditorCacheUpdate(
  prev: Record<number, OwnerPersonaEditorItem>,
  persona: OwnerPersonaEditorItem
): Record<number, OwnerPersonaEditorItem> {
  return { ...prev, [persona.id]: persona };
}
