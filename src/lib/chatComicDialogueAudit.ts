/**
 * Comic dialogue whitelist / overlay parity audits — test, script, and server audit only.
 * Must not be imported by `"use client"` components (transitively reaches Sharp via overlay).
 */

import type { ChatImageCastGroundedManifest } from "@/lib/chatImageCastManifest";
import { collectFinalOverlayRenderedTexts } from "@/lib/chatComicTextOverlay";
import type { ContentKind } from "@/lib/simulationMode";
import {
  collectApprovedComicText,
  normalizeDialogueTextForOutput,
  resolveScenePresentationVisibility,
  type ScenePlan,
} from "@/lib/chatImageScenePlan";
import {
  bindChatImageReferencePack,
  buildChatDuoVisualSubjects,
} from "@/lib/chatImageVisualIdentity";

function normalizePromptAuditText(text: string): string {
  return normalizeDialogueTextForOutput(text);
}

/** Counts user-edited dialogue lines whose rendered visible text mismatches final overlay. */
export function countUserEditDialogueMismatch(
  plan: ScenePlan,
  finalRenderedTexts: Iterable<string>
): number {
  const renderedSet = new Set(
    [...finalRenderedTexts].map((text) => normalizePromptAuditText(text))
  );
  let count = 0;
  for (const panel of plan.panels) {
    for (const line of panel.dialogue) {
      if (line.provenance !== "user_edit" || !line.text.trim()) continue;
      if (!renderedSet.has(normalizePromptAuditText(line.text))) count += 1;
    }
  }
  return count;
}

/** Overlay-boundary audit: approved plan text vs final overlay bubble owner. */
export function auditComicDialogueWhitelist(opts: {
  plan: ScenePlan;
  personaName: string;
  characterName: string;
  contentKind?: ContentKind;
  castManifest?: ChatImageCastGroundedManifest | null;
  panelCount?: number;
  width?: number;
  height?: number;
}): {
  panelTextWhitelistMismatchCount: number;
  userEditDialogueMismatchCount: number;
} {
  const visibility = resolveScenePresentationVisibility({
    contentKind: opts.contentKind,
    castManifest: opts.castManifest,
  });
  const whitelist = collectApprovedComicText(opts.plan, visibility);
  const whitelistSet = new Set(whitelist);
  const panelCount = opts.panelCount ?? opts.plan.panels.length;
  const width = opts.width ?? 1008;
  const height = opts.height ?? (panelCount === 4 ? 1824 : 1408);
  const subjects = bindChatImageReferencePack({
    subjectsInImageOrder: buildChatDuoVisualSubjects({
      characterName: opts.characterName,
      characterGender: "male",
      characterImageUrl: "/character-ref",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaName: opts.personaName,
      personaGender: "female",
      personaImageUrl: "/persona-ref",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
    }),
  }).subjects;
  const overlayTexts = collectFinalOverlayRenderedTexts({
    width,
    height,
    panelCount,
    plan: opts.plan,
    visibility,
    subjects,
  });
  const overlaySet = new Set(overlayTexts);
  let panelTextWhitelistMismatchCount = 0;
  for (const text of overlaySet) {
    if (!whitelistSet.has(text)) panelTextWhitelistMismatchCount += 1;
  }
  for (const text of whitelistSet) {
    if (!overlaySet.has(text)) panelTextWhitelistMismatchCount += 1;
  }
  const userEditDialogueMismatchCount = countUserEditDialogueMismatch(
    opts.plan,
    overlayTexts
  );
  return { panelTextWhitelistMismatchCount, userEditDialogueMismatchCount };
}
