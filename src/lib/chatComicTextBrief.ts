/**
 * COMIC TEXT BRIEF — bounded autopilot quality floor.
 *
 * Scene Planner still owns WHAT (anchor + contiguous highlight). GPT Image still
 * owns HOW (panels, camera, dialogue selection, narration, balloons, SFX).
 * This server layer adds ONLY lightweight, source-grounded text planning:
 *   - ranked source dialogue candidates (exact text, speaker-bound, anchor first)
 *   - source-grounded narration candidates (0-2, environment/action/reaction bridges)
 *   - separate SPOKEN-DIALOGUE / NARRATION / TOTAL text targets (soft floor)
 *   - a one-bubble = one-speaker contract
 *   - a real AUTO panel-mode recommendation that reaches the provider prompt
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

export type ComicNarrationPurpose =
  | "time_bridge"
  | "location_bridge"
  | "action_bridge"
  | "reaction_bridge"
  | "context";

export type ComicNarrationCandidate = {
  sourceEventId: string;
  text: string;
  purpose: ComicNarrationPurpose;
};

export type ComicTextDensity = {
  effectivePanelMode: 3 | 4;
  totalTextTarget: string;
  spokenDialogueTarget: string;
  narrationTarget: string;
  dialogueRichSource: boolean;
  sparse4Discouraged: boolean;
};

export type ComicTextBriefAudit = {
  eligibleDialogueCandidateCount: number;
  narrationCandidateCount: number;
  effectivePanelMode: 3 | 4;
  spokenDialogueTarget: string;
  narrationTarget: string;
  totalTextTarget: string;
  dialogueRichSource: boolean;
  sparse4Discouraged: boolean;
  sourceEventIdsUsed: string[];
  continuitySourceEventIds: string[];
  panelMode: ChatComicPanelMode;
  recommendedPanelMode: 3 | 4;
};

export type ComicDensityContext = {
  recommendation: { mode: 3 | 4; reason: string };
  effectivePanelMode: 3 | 4;
  density: ComicTextDensity;
};

const DIALOGUE_CANDIDATE_HINT =
  /(?:가자|같이|좋아|할래|해줘|데려가|도망가|남아줘|보고 싶어|좋아해|사랑|미안|고마워|안아줘|키스|입 맞춰|약속|믿어|부탁|그만|안 돼|결혼|싫어|기다려|오늘 밤|멈춰|어디|왜|언제|정말|진짜|그만둬)/u;

const ACTION_BRIDGE_HINT =
  /(?:다가|문(?:을|이)?\s*열|발견|잡아|안아|껴안|놀라|멈춰|멈추|돌아|떠나|고개(?:를)?\s*들|눈(?:을)?\s*마주|손(?:을)?\s*내밀|쓰러|기대|숨(?:을)?\s*죽|입을 열|돌아보|일어나|걸어가|뛰어)/u;

const CONTINUITY_STATE_HINT =
  /(?:갈아입|입(?:고|는다|어|은|은다|었다)|벗(?:고|는다|어)?|잠옷|재킷|코트|신발|목도리|장갑|뒤덮|쓰(?:고|었다)?|쥐고|들고|안고|메고|차고|두르고|끌어안)/u;

const CONTINUITY_PLACE_HINT =
  /(?:침실|거실|욕실|부엌|주방|테라스|베란다|밖|복도|현관|들어온다|들어간다|나간다|옮긴다|이동|내려온다|올라간다|도착)/u;

const CONTINUITY_TIME_HINT = /(?:밤|새벽|저녁|낮|다음 날|이튿날|한 시간 후|잠시 후|얼마 후|뒤에|후에|날이 밝)/u;

export const COMIC_DIALOGUE_CANDIDATE_MAX = 5;
export const COMIC_NARRATION_PAGE_MAX = 2;

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
 * COMIC_DIALOGUE_CANDIDATE_OWNER — RANKED_SOURCE_DIALOGUE_CANDIDATES.
 * Among spoken lines already inside the selected highlight, rank the most useful
 * for comic readability (anchor first, then reaction-causing / decision-bearing /
 * character-flavored). Not a second semantic planner — the Scene Planner chose
 * the scene/anchor. Bounded to COMIC_DIALOGUE_CANDIDATE_MAX, always retaining
 * the anchor and speaker diversity.
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

  // Bound while retaining the anchor and speaker diversity.
  const anchor = scored.find((candidate) => candidate.priority === 1);
  const others = scored.filter((candidate) => candidate !== anchor);
  const selected: typeof scored = [];
  if (anchor) selected.push(anchor);
  const otherSpeakers = new Set<string>();
  for (const candidate of others) {
    if (selected.length >= COMIC_DIALOGUE_CANDIDATE_MAX) break;
    if (candidate.speakerSubject !== anchor?.speakerSubject) otherSpeakers.add(candidate.speakerSubject);
  }
  for (const candidate of others) {
    if (selected.length >= COMIC_DIALOGUE_CANDIDATE_MAX) break;
    if (otherSpeakers.has(candidate.speakerSubject) && !selected.some((c) => c.speakerSubject === candidate.speakerSubject)) {
      selected.push(candidate);
    }
  }
  for (const candidate of others) {
    if (selected.length >= COMIC_DIALOGUE_CANDIDATE_MAX) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }

  return selected.map(({ score: _score, ...candidate }, index) => ({
    ...candidate,
    priority: index + 1,
  }));
}

/**
 * COMIC_NARRATION_CANDIDATE_OWNER — 0-2 source-grounded narration candidates.
 * Sources: environment/time/location transitions first, then concise action or
 * reaction bridges that meaningfully connect panels, then context. Never invents
 * story facts; never converts spoken dialogue into narration.
 */
export function selectComicNarrationCandidates(
  plan: ScenePlan,
  selection: ComicHighlightSelection,
  safety: ComicHighlightSafety = {},
  max = COMIC_NARRATION_PAGE_MAX
): ComicNarrationCandidate[] {
  const byId = new Map(plan.events.map((event) => [event.id, event]));
  const focus = selection.focusEventIds
    .map((id) => byId.get(id))
    .filter((event): event is SceneEvent => Boolean(event));
  const visualAdultGrounded = safety.visualProjectionAdultGrounded ?? false;
  const candidates: ComicNarrationCandidate[] = [];

  const push = (event: SceneEvent, purpose: ComicNarrationPurpose): boolean => {
    if (candidates.length >= max) return false;
    const projected = projectTextForSafeImagePrompt(event.text, { adultGrounded: visualAdultGrounded }).trim();
    if (!projected) return false;
    if (projected.length > 60) return false;
    candidates.push({ sourceEventId: event.id, text: projected, purpose });
    return true;
  };

  for (const event of focus) {
    if (event.kind === "environment") {
      push(event, event.text.match(/시간|후|뒤|다음|곧/iu) ? "time_bridge" : "location_bridge");
    }
  }
  for (const event of focus) {
    if (event.kind === "action" && ACTION_BRIDGE_HINT.test(event.text) && !event.text.match(/"(?:[^"]+)"/u)) {
      push(event, "action_bridge");
    }
  }
  for (const event of focus) {
    if (event.kind === "reaction" && ACTION_BRIDGE_HINT.test(event.text)) {
      push(event, "reaction_bridge");
    }
  }
  return candidates;
}

export type ComicContinuityContext = {
  /** Context lines — context only, never visible dialogue/narration. */
  lines: string[];
  /** Canonical event ids the context is grounded in. */
  sourceEventIds: string[];
};

export const COMIC_CONTINUITY_MAX_CONTEXT_LINES = 3;

/**
 * COMIC_CONTINUITY_CONTEXT_OWNER — bounded source-grounded current-state context.
 * The highlight excerpt carries only the selected focus window; state changes that
 * happened immediately BEFORE the focus (outfit change, location/time transition,
 * held object, physical state) can be lost. This owner surfaces the most recent
 * such state from the canonical timeline as CONTEXT ONLY — no invented facts, no
 * panel, no visible speech, no second model call.
 */
export function buildComicContinuityContext(
  plan: ScenePlan,
  selection: ComicHighlightSelection,
  binding: ComicSpeakerBinding,
  safety: ComicHighlightSafety = {}
): ComicContinuityContext {
  const visual = visualEvents(plan.events);
  const focusStartIndex = visual.findIndex((event) => event.id === selection.focusEventIds[0]);
  if (focusStartIndex <= 0) return { lines: [], sourceEventIds: [] };
  const before = visual.slice(Math.max(0, focusStartIndex - 3), focusStartIndex);
  const lines: string[] = [];
  const sourceEventIds: string[] = [];
  const visualAdultGrounded = safety.visualProjectionAdultGrounded ?? false;
  for (const event of before) {
    if (lines.length >= COMIC_CONTINUITY_MAX_CONTEXT_LINES) break;
    if (event.kind === "environment") {
      if (!CONTINUITY_PLACE_HINT.test(event.text) && !CONTINUITY_TIME_HINT.test(event.text)) {
        continue;
      }
      const text = projectTextForSafeImagePrompt(event.text, {
        adultGrounded: visualAdultGrounded,
      })
        .trim()
        .slice(0, 60);
      if (!text) continue;
      lines.push(`Current place/time: ${text}.`);
      sourceEventIds.push(event.id);
      continue;
    }
    if (
      (event.kind === "action" || event.kind === "reaction") &&
      CONTINUITY_STATE_HINT.test(event.text)
    ) {
      const text = projectTextForSafeImagePrompt(event.text, {
        adultGrounded: visualAdultGrounded,
      })
        .trim()
        .slice(0, 60);
      if (!text) continue;
      const subject =
        event.actor === "character"
          ? `${binding.characterLabel} (${binding.characterName})`
          : event.actor === "persona"
            ? `${binding.personaLabel} (${binding.personaName})`
            : event.actor;
      lines.push(`Current state (${subject}): ${text}.`);
      sourceEventIds.push(event.id);
    }
  }
  return { lines, sourceEventIds };
}

/**
 * PANEL_MODE_DECISION_OWNER — real AUTO 3 vs 4 recommendation. A single narration
 * candidate never makes a scene rich. 4 requires genuine content for four beats.
 */
export function recommendComicPanelModeByTextDensity(
  dialogueCandidateCount: number,
  narrationCandidateCount: number
): { mode: 3 | 4; reason: string } {
  if (dialogueCandidateCount >= 3) {
    return { mode: 4, reason: "rich highlight (3+ dialogue candidates)" };
  }
  if (dialogueCandidateCount >= 2 && narrationCandidateCount >= 1) {
    return { mode: 4, reason: "2 dialogue candidates plus a source-grounded narration bridge" };
  }
  return { mode: 3, reason: "sparse highlight (insufficient content for four distinct beats)" };
}

/**
 * EFFECTIVE_DENSITY_PANEL_MODE_OWNER — the AUTO recommendation drives text
 * density. AUTO is never itself a density context; it resolves to the
 * recommended 3 or 4. Manual 3/4 use their exact mode. This value is ONLY the
 * quality-contract context — never a claim of the provider's rendered count.
 */
export function resolveComicDensityContext(
  requestedPanelMode: ChatComicPanelMode,
  dialogueCandidateCount: number,
  narrationCandidateCount: number
): ComicDensityContext {
  const recommendation = recommendComicPanelModeByTextDensity(
    dialogueCandidateCount,
    narrationCandidateCount
  );
  const effectivePanelMode =
    requestedPanelMode === "auto" ? recommendation.mode : requestedPanelMode;
  const density = resolveComicTextDensity({
    effectivePanelMode,
    dialogueCandidateCount,
    narrationCandidateCount,
  });
  return { recommendation, effectivePanelMode, density };
}

/**
 * COMIC_TEXT_DENSITY_POLICY_OWNER — separate SPOKEN-DIALOGUE / NARRATION / TOTAL
 * soft targets keyed to the EFFECTIVE panel mode (3 or 4), never the raw AUTO
 * token. This is a provider quality contract / diagnostic target, not a server
 * post-render hard validator.
 */
export function resolveComicTextDensity(opts: {
  effectivePanelMode: 3 | 4;
  dialogueCandidateCount: number;
  narrationCandidateCount: number;
}): ComicTextDensity {
  const dialogueRichSource = opts.dialogueCandidateCount >= 3;
  const fourContext = opts.effectivePanelMode === 4;
  const totalTextTarget = fourContext ? "3-5" : "2-4";
  const spokenDialogueTarget =
    fourContext && dialogueRichSource
      ? "at least 3 distinct source dialogue beats across the page, across at least 2 dialogue-bearing panels, 1-2 bubbles per speaking panel"
      : "preserve 2-3 useful spoken beats when available";
  const sparse4Discouraged =
    fourContext && opts.dialogueCandidateCount < 3 && opts.narrationCandidateCount === 0;
  return {
    effectivePanelMode: opts.effectivePanelMode,
    totalTextTarget,
    spokenDialogueTarget,
    narrationTarget: "0-2",
    dialogueRichSource,
    sparse4Discouraged,
  };
}

export function buildComicTextBriefAudit(opts: {
  selection: ComicHighlightSelection;
  dialogueCandidates: ComicDialogueCandidate[];
  narrationCandidates: ComicNarrationCandidate[];
  panelMode: ChatComicPanelMode;
  densityContext?: ComicDensityContext;
  continuity?: ComicContinuityContext;
}): ComicTextBriefAudit {
  const context =
    opts.densityContext ??
    resolveComicDensityContext(
      opts.panelMode,
      opts.dialogueCandidates.length,
      opts.narrationCandidates.length
    );
  const density = context.density;
  return {
    eligibleDialogueCandidateCount: opts.dialogueCandidates.length,
    narrationCandidateCount: opts.narrationCandidates.length,
    effectivePanelMode: context.effectivePanelMode,
    spokenDialogueTarget: density.spokenDialogueTarget,
    narrationTarget: density.narrationTarget,
    totalTextTarget: density.totalTextTarget,
    dialogueRichSource: density.dialogueRichSource,
    sparse4Discouraged: density.sparse4Discouraged,
    sourceEventIdsUsed: [
      ...opts.dialogueCandidates.map((candidate) => candidate.sourceEventId),
      ...opts.narrationCandidates.map((candidate) => candidate.sourceEventId),
    ],
    continuitySourceEventIds: opts.continuity?.sourceEventIds ?? [],
    panelMode: opts.panelMode,
    recommendedPanelMode: context.recommendation.mode,
  };
}

/**
 * Compact comic brief — the bounded-autopilot prompt section. GPT still decides
 * HOW; the server guarantees a minimum text floor and speaker clarity. For AUTO
 * the server's panel recommendation actually reaches the provider.
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
  const continuity = buildComicContinuityContext(
    opts.plan,
    opts.selection,
    opts.binding,
    opts.safety
  );
  const densityContext = resolveComicDensityContext(
    opts.panelMode,
    dialogueCandidates.length,
    narrationCandidates.length
  );
  const audit = buildComicTextBriefAudit({
    selection: opts.selection,
    dialogueCandidates,
    narrationCandidates,
    panelMode: opts.panelMode,
    densityContext,
    continuity,
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
        .map((candidate) => `- "${candidate.text}"  [${candidate.purpose}]`)
        .join("\n")
    : "No preferred narration line is supplied. If the selected [action]/[context] source genuinely needs a transition, you may create up to 2 very short source-grounded narration bridges. Do not add new facts.";

  const density = densityContext.density;

  const autoRecommendation =
    opts.panelMode === "auto"
      ? densityContext.recommendation.mode === 3
        ? "Prefer a natural 3-panel page for this highlight. Use 4 only if the selected scene clearly contains four distinct useful beats."
        : "Prefer a natural 4-panel page because this highlight contains enough distinct conversational/transition beats. Do not add filler merely to reach four."
      : "";

  const lines = [
    "COMIC SCRIPT — SELECTED HIGHLIGHT",
    "SPEAKER BINDING:",
    bindingLines,
    "SELECTED HIGHLIGHT SOURCE (verbatim, chronologically ordered):",
    excerpt.text,
    ...(continuity.lines.length
      ? [
          "CURRENT SCENE CONTINUITY — CONTEXT ONLY, NOT VISIBLE TEXT:",
          ...continuity.lines,
          "This states how the characters currently look/are placed from the source before this highlight. Use it for consistency only — never render these lines as visible comic text.",
        ]
      : []),
    "DIALOGUE CANDIDATES (ranked source lines, exact text):",
    candidateLines,
    "NARRATION CANDIDATES (0-2, source-grounded):",
    narrationLines,
    ...(autoRecommendation ? ["AUTO PANEL RECOMMENDATION:", autoRecommendation] : []),
    "TEXT FLOOR:",
    `- Spoken dialogue: ${density.spokenDialogueTarget}.`,
    `- Narration: ${density.narrationTarget} short boxes.`,
    `- Total text units: ${density.totalTextTarget} for a ${density.effectivePanelMode}-panel layout.`,
    ...(density.sparse4Discouraged
      ? ["- This highlight is sparse in text: prefer 3 panels, or keep the page quiet rather than filling silent panels."]
      : []),
    "SPEAKER CLARITY:",
    "- One visible speech bubble = one speaker only. Never merge two different speakers into a single bubble.",
    "- Bubble tails and placement must make the speaker obvious from the speaker binding above.",
    "The [action]/[context] markers are prompt roles, not visible comic text.",
  ];
  return { text: lines.join("\n"), audit };
}