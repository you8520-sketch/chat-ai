import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyOwnerEditorCacheUpdate,
  resolveSecretDraftOnStartEdit,
  shouldHydrateSecretDraftFromEditor,
} from "@/lib/personaSecretEditHydration";
import type { OwnerPersonaEditorItem } from "@/lib/userPersonasClient";

function editor(id: number, secret: string): OwnerPersonaEditorItem {
  return {
    id,
    user_id: 1,
    name: "테스트",
    memo: "",
    gender: "other",
    description: "공개",
    secret_description: secret,
    speech_examples: "",
    image_url: "",
    image_focus_x: 0.5,
    image_focus_y: 0.5,
    created_at: "2026-07-28",
  };
}

describe("persona secret edit hydration race", () => {
  it("startEdit before capability/editor arrives keeps loaded=false", () => {
    const draft = resolveSecretDraftOnStartEdit(undefined);
    assert.equal(draft.draftSecretDescriptionLoaded, false);
    assert.equal(draft.draftSecretDescription, "");
  });

  it("hydrates authoritative secret only after editor data arrives", () => {
    assert.equal(
      shouldHydrateSecretDraftFromEditor({
        canEdit: true,
        draftSecretDescriptionLoaded: false,
        draftSecretDescriptionDirty: false,
        hasEditor: true,
      }),
      true
    );
    assert.equal(
      shouldHydrateSecretDraftFromEditor({
        canEdit: false,
        draftSecretDescriptionLoaded: false,
        draftSecretDescriptionDirty: false,
        hasEditor: true,
      }),
      false
    );
    assert.equal(
      shouldHydrateSecretDraftFromEditor({
        canEdit: true,
        draftSecretDescriptionLoaded: false,
        draftSecretDescriptionDirty: true,
        hasEditor: true,
      }),
      false
    );
  });

  it("owner cache refresh keeps latest secret after save/reopen", () => {
    const first = editor(10, "secret A");
    const second = editor(10, "secret B");
    let cache = applyOwnerEditorCacheUpdate({}, first);
    assert.equal(cache[10]?.secret_description, "secret A");
    cache = applyOwnerEditorCacheUpdate(cache, second);
    assert.equal(cache[10]?.secret_description, "secret B");

    const reopen = resolveSecretDraftOnStartEdit(cache[10]);
    assert.equal(reopen.draftSecretDescriptionLoaded, true);
    assert.equal(reopen.draftSecretDescription, "secret B");
  });
});
