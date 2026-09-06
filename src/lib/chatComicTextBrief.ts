/**
 * COMIC TEXT BRIEF — bounded autopilot quality floor.
 *
 * Scene Planner still owns WHAT (anchor + contiguous highlight). GPT Image still
 * owns HOW (panels, camera, dialogue selection, narration, balloons, SFX).
 * This server layer adds ONLY lightweight, source-grounded text planning:
 *   - dialogue candidates (priority ordered, exact source text, speaker-bound)
 *   - narration candidates (0-2, source-grounded)
 *   - a page-level text-density contract (soft, not a hard quota)
 *   - a one-bubble = one-speaker contract
 *   - an AUTO panel-mode recommendation (3 when sparse, 4 when rich)
 *
 * No panel-by-panel storyboard, no camera/balloon planning, no extra model call.
 */

import type { ChatComicPanelMode } from "@/lib/chatComicGenerationConstants";
import type {
  ComicHighlightSelection,
  SceneEvent,
  ScenePlan,
} from "@/lib/chatImageScenePlan";
import { visualEvents } from "@/lib/chatImageScenePlan";
import { projectTextForSafeImagePrompt } from "@/lib/chatImageSafeVisualProjection";
import { resolveComicProviderReadableTextEligibility } from "@/lib/chatComicPanelSpec";
import {
  buildComicHighlightSourceExcerpt,
  type ComicHighlightSafety,
  type ComicSpeakerBinding,
} from "@/lib/chatComicHighlightExcerpt";

export type ComicDialogueCandidatePurpose =
  | "anchor"
  | "setup"
  | "reaction"
  | "tease"
  | "reveal"
  | "payoff";

export type ComicDialogueCandidate = {
  sourceEventId: string;
  speakerSubject: string;
  exactText: string;
  priority: number;
  purpose: ComicDialogueCandidatePurpose;
};

export type ComicNarrationCandidate = {
  sourceEventId: string;
  text: string;
};

export type ComicTextDensity = {
  target: string;
  sparse4Discouraged: boolean;
};

export type ComicTextBriefAudit = {
  dialogueCandidateCount: number;
  narrationCandidateCount: number;
  densityTarget: string;
  sparse4Discouraged: boolean;
  sourceEventIdsUsed: string[];
  panelMode: ChatComicPanelMode;
  recommendedPanelMode: 3 | 4;
};

const DIALOGUE_CANDIDATE_HINT =
  /(?:가자|같이|좋아|할래|해줘|데려가|도망가|남아줘|보고 싶어|좋아해|사랑|미안|고마워|안아줘|키스|입 맞춰|약속|믿어|부탁|그만|안 돼|결혼|싫어|기다려|오늘 밤|멈춰|어디|왜|언제|정말|진짜|그만둬)/u;

function isEligibleDialogueEvent(event: SceneEvent): boolean {
  return event.kind === "dialogue" && event.actor !== "environment";
}

function isProviderReadableDialogue(text: string, eligible: boolean, realPerson: boolean): boolean {
  return resolveComicProviderReadableTextEligibility({ text, adultGrounded: eligible, realPersonRestricted: realPerson });
}

function speakerSubjectFor(event: SceneEvent, binding: ComicSpeakerBinding): string {
  if (event.actor === "character") return binding.characterLabel;
  if (event.actor === "persona") return binding.personaLabel;
  return event.speakerName?.trim() || event.actor;
}

/**
 * COMIC_DIALOGUE_CANDIDATE_OWNER — semantic, non-positional selection of the
 * most comic-worthy spoken lines inside the highlight. Anchor first, then
 * reaction-causing / decision-bearing / character-flavored lines.
 */
export function selectComicDialogueCandidates(
  plan: ScenePlan,
  selection: ComicHighlightSelection,
  binding: ComicSpeakerBinding,
  safety: ComicHighlightSafety = {}
): ComicDialogueCandidate[] {
  const byId = new Map(plan.events.map((event) => [event.id, event]));
  const focus = selection.focusEventIds
    .map((id) => byId.get(id))
    .filter((event): event is SceneEvent => Boolean(event));
  const dialogueEligible = safety.providerReadableDialogueAdultEligible ?? false;
  const realPerson = safety.realPersonRestricted ?? false;

  const scored: Array<ComicDialogueCandidate & { score: number }> = [];
  for (let index = 0; index < focus.length; index += 1) {
    const event = focus[index]!;
    if (!isEligibleDialogueEvent(event)) continue;
    if (!isProviderReadableDialogue(event.text, dialogueEligible, realPerson)) continue;
    const isAnchor = event.id === selection.anchorEventId;
    const next = focus[index + 1];
    const nextReaction =
      next && (next.kind === "reaction" || next.kind === "action") && next.actor !== event.actor;
    let score = 0;
    if (isAnchor) score += 10;
    if (nextReaction) score += 2;
    if (DIALOGUE_CANDIDATE_HINT.test(event.text)) score += 1;
    if (event.text.length >= 4 && event.text.length <= 40) score += 1;
    scored.push({
      sourceEventId: event.id,
      speakerSubject: speakerSubjectFor(event, binding),
      exactText: event.text,
      priority: isAnchor ? 1 : 0,
      purpose: isAnchor ? "anchor" : nextReaction ? "reaction" : "setup",
      score,
    });
  }
  scored.sort(
    (left, right) =>
      (left.priority === 1 ? 0 : 1) - (right.priority === 1 ? 0 : 1) ||
      right.score - left.score ||
      Number(left.sourceEventId.replace(/\D/g, "")) - Number(right.sourceEventId.replace(/\D/g, ""))
  );
  return scored.map(({ score: _score, ...candidate }, index) => ({
    ...candidate,
    priority: index + 1,
  }));
}

/**
 * COMIC_NARRATION_CANDIDATE_OWNER — 0-2 source-grounded narration candidates from
 * context/transition events in the highlight (never invented prose, never meta).
 */
export function selectComicNarrationCandidates(
  plan: ScenePlan,
  selection: ComicHighlightSelection,
  safety: ComicHighlightSafety = {},
  max = 2
): ComicNarrationCandidate[] {
  const byId = new Map(plan.events.map((event) => [event.id, event]));
  const focus = selection.focusEventIds
    .map((id) => byId.get(id))
    .filter((event): event is SceneEvent => Boolean(event));
  const visualAdultGrounded = safety.visualProjectionAdultGrounded ?? false;
  const candidates: ComicNarrationCandidate[] = [];
  for (const event of focus) {
    if (event.kind !== "environment") continue;
    const projected = projectTextForSafeImagePrompt(event.text, { adultGrounded: visualAdultGrounded }).trim();
    if (!projected) continue;
    if (projected.length > 60) continue;
    candidates.push({ sourceEventId: event.id, text: projected });
    if (candidates.length >= max) break;
  }
  return candidates;
}

/**
 * COMIC_TEXT_DENSITY_POLICY_OWNER — page-level soft quality floor, not a quota.
 */
export function resolveComicTextDensity(
  panelMode: ChatComicPanelMode,
  dialogueCandidateCount: number,
  narrationCandidateCount: number
): ComicTextDensity {
  const fourTarget = dialogueCandidateCount >= 3 ? "3-5" : "2-4";
  const threeTarget = "2-4";
  const target = panelMode === 3 ? threeTarget : panelMode === 4 ? fourTarget : dialogueCandidateCount >= 3 ? "3-5" : "2-4";
  // A 4-panel page with almost no text is discouraged when the scene is sparse.
  const sparse4Discouraged =
    (panelMode === "auto" || panelMode === 4) &&
    dialogueCandidateCount < 3 &&
    narrationCandidateCount === 0;
  return { target, sparse4Discouraged };
}

/**
 * PANEL_MODE_DECISION_OWNER — AUTO 3 vs 4 recommendation from excerpt text
 * density (never 'longer is better'; never raw source length).
 */
export function recommendComicPanelModeByTextDensity(
  dialogueCandidateCount: number,
  narrationCandidateCount: number
): { mode: 3 | 4; reason: string } {
  if (dialogueCandidateCount >= 3 || narrationCandidateCount >= 1) {
    return { mode: 4, reason: "rich highlight (3+ dialogue candidates or a narration bridge)" };
  }
  return { mode: 3, reason: "sparse highlight (few dialogue candidates, low text density)" };
}

export function buildComicTextBriefAudit(opts: {
  selection: ComicHighlightSelection;
  dialogueCandidates: ComicDialogueCandidate[];
  narrationCandidates: ComicNarrationCandidate[];
  panelMode: ChatComicPanelMode;
}): ComicTextBriefAudit {
  const density = resolveComicTextDensity(
    opts.panelMode,
    opts.dialogueCandidates.length,
    opts.narrationCandidates.length
  );
  return {
    dialogueCandidateCount: opts.dialogueCandidates.length,
    narrationCandidateCount: opts.narrationCandidates.length,
    densityTarget: density.target,
    sparse4Discouraged: density.sparse4Discouraged,
    sourceEventIdsUsed: [
      ...opts.dialogueCandidates.map((candidate) => candidate.sourceEventId),
      ...opts.narrationCandidates.map((candidate) => candidate.sourceEventId),
    ],
    panelMode: opts.panelMode,
    recommendedPanelMode: recommendComicPanelModeByTextDensity(
      opts.dialogueCandidates.length,
      opts.narrationCandidates.length
    ).mode,
  };
}

/**
 * Compact comic brief — the bounded-autopilot prompt section. GPT still decides
 * HOW; the server guarantees a minimum text floor and speaker clarity.
 */
export function renderComicTextBrief(opts: {
  plan: ScenePlan;
  selection: ComicHighlightSelection;
  binding: ComicSpeakerBinding;
  safety: ComicHighlightSafety;
  panelMode: ChatComicPanelMode;
}): { text: string; audit: ComicTextBriefAudit } {
  const excerpt = buildComicHighlightSourceExcerpt(opts.plan, opts.selection, opts.binding, opts.safety);
  const dialogueCandidates = selectComicDialogueCandidates(
    opts.plan,
    opts.selection,
    opts.binding,
    opts.safety
  );
  const narrationCandidates = selectComicNarrationCandidates(
    opts.plan,
    opts.selection,
    opts.safety
  );
  const audit = buildComicTextBriefAudit({
    selection: opts.selection,
    dialogueCandidates,
    narrationCandidates,
    panelMode: opts.panelMode,
  });

  const bindingLines = [
    `- ${opts.binding.characterLabel} = ${opts.binding.characterName} (chat character)`,
    `- ${opts.binding.personaLabel} = ${opts.binding.personaName} (user persona)`,
  ].join("\n");
  const candidateLines = dialogueCandidates.length
    ? dialogueCandidates
        .map(
          (candidate) =>
            `${candidate.priority}. ${candidate.speakerSubject}: "${candidate.exactText}"  [${candidate.purpose}]`
        )
        .join("\n")
    : "(no dialogue candidates — prefer a quiet/silent scene)";
  const narrationLines = narrationCandidates.length
    ? narrationCandidates
        .map((candidate) => `- "${candidate.text}"`)
        .join("\n")
    : "(none)";

  const density = resolveComicTextDensity(
    opts.panelMode,
    dialogueCandidates.length,
    narrationCandidates.length
  );

  const lines = [
    "COMIC SCRIPT — SELECTED HIGHLIGHT",
    "SPEAKER BINDING:",
    bindingLines,
    "SELECTED HIGHLIGHT SOURCE (verbatim, chronologically ordered):",
    excerpt.text,
    "DIALOGUE CANDIDATES (priority ordered, exact source text):",
    candidateLines,
    "NARRATION CANDIDATES (0-2, source-grounded):",
    narrationLines,
    "TEXT DENSITY:",
    `- Target ${audit.densityTarget} visible text units for this ${opts.panelMode === "auto" ? "3- or 4-panel" : `${opts.panelMode}-panel`} page.`,
    "- Prefer 1 speech bubble in most speaking panels; occasionally 2 if needed. Preserve the key spoken beats from the source scene.",
    ...(density.sparse4Discouraged
      ? ["- This highlight is sparse in text: prefer 3 panels, or keep the page quiet rather than filling silent panels."]
      : []),
    "SPEAKER CLARITY:",
    "- One visible speech bubble = one speaker only. Never merge two different speakers into a single bubble.",
    "- Bubble tails and placement must make the speaker obvious from the speaker binding above.",
    "NARRATION:",
    "- At most 0-2 short narration boxes, only when they improve time/context flow. Never a long prose paragraph.",
    "The [action]/[context] markers are prompt roles, not visible comic text.",
  ];
  return { text: lines.join("\n"), audit };
}