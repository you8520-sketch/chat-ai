/**
 * Canonical production clothing semantic writer — single owner for panel.clothingCoverage.
 * Runs on final reflowed ScenePlan; does not authorize, render, or persist state.
 */

import type {
  SceneEvent,
  ScenePanel,
  ScenePanelClothingCoverage,
  ScenePlan,
  SceneSpeakerContext,
} from "@/lib/chatImageScenePlan";

export type ComicClothingSemanticState = "DEFAULT_COVERED" | "SHIRTLESS_UPPER_TORSO";

export type ComicClothingTransitionKind =
  | "none"
  | "covered_to_shirtless"
  | "shirtless_to_covered"
  | "scene_reset";

export type ComicClothingReasonCategory =
  | "explicit_upper_garment_removal"
  | "explicit_shirtless_current_state"
  | "persona_removed_character_shirt"
  | "explicit_reclothing"
  | "negation"
  | "request_only"
  | "hypothetical"
  | "historical_only"
  | "partial_outerwear_only"
  | "partial_unbutton_loosen"
  | "wrong_target"
  | "ambiguous_target"
  | "incomplete_action"
  | "conflict_same_event"
  | "scene_time_boundary"
  | "dialogue_skipped"
  | "carry_forward";

export type ComicClothingPanelAudit = {
  panelIndex: number;
  resolvedCoverage: ScenePanelClothingCoverage | "omitted";
  sourceEventIds: string[];
  transition: ComicClothingTransitionKind;
  reasonCategory: ComicClothingReasonCategory;
};

export type ApplyCanonicalComicClothingCoverageResult = {
  plan: ScenePlan;
  audit: ComicClothingPanelAudit[];
};

export type ApplyCanonicalComicClothingCoverageContext = SceneSpeakerContext;

const KOREAN_NAME_PARTICLES = "[이가은는을를의에게한테도만]" as const;
const UPPER_GARMENT_PATTERN =
  "(?:셔츠|상의|윗옷|티셔츠|남방|블라우스|맨투맨|후드티)";
const CLOTHING_UNDRESS_ACTION =
  "벗(?:어(?:서)?|었다|었(?:다|음|어)?|겨(?:내(?:서)?)?|겼(?:다|어|음)?|기(?:내)?)";
const CLOTHING_DRESS_ACTION = "입(?:어(?:서)?|은|음|었다|었(?:다|음|어)?|는다)";
const CLOTHING_ACTION_PATTERN = new RegExp(
  `(?:${CLOTHING_UNDRESS_ACTION}|${CLOTHING_DRESS_ACTION})`,
  "u"
);

type NamedIdentity = "character" | "persona" | "supporting";
type ClothingTarget = "character" | "other" | "ambiguous";

function normalizeNameToken(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Boundary-safe canonical name match — no substring false positives (e.g. 렌 vs 렌즈). */
export function matchesCanonicalName(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?:${KOREAN_NAME_PARTICLES}|[^\\p{L}\\p{N}]|$)`,
    "iu"
  );
  return pattern.test(text);
}

function splitWriterClauses(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=다|자|고|며|서|음|함|것|점|았다|었다|였다|했다|냈다|냈|였|았|겠)[.!?。…]?\s+|[.!?。…]\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

const SCENE_TIME_BOUNDARY =
  /(?:^|\s)(?:다음\s*날|다음날|며칠\s*(?:뒤|후)|시간(?:이|은)?\s*(?:지나|흘러)|장면\s*(?:이|이\s*)?전환)/u;

const NEGATION =
  /(?:벗(?:지|지\s*않|지\s*말|지\s*못)|입(?:지|지\s*않)|벗지\s*않(?:았|는|을)|벗지\s*말|벗지\s*못)/u;

const REQUEST_ONLY =
  /(?:^|[.!?…\s])(?:옷|셔츠|상의)(?:\s*(?:좀|을|를))?\s*벗(?:어|어\s*줘|어\s*줄래|어봐|으라|어라)(?:\s*[.!?…]|$)/u;

const HYPOTHETICAL =
  /(?:벗(?:을까|을\s*까|으려(?:고|는)?|고\s*싶|을\s*뻔)|입(?:을까|을\s*까|으려(?:고|는)?|고\s*싶))/u;

const HISTORICAL_ONLY =
  /(?:어제|예전(?:에)?|그(?:때|저번)|한\s*참\s*전|옛날(?:에)?|과거(?:에)?|전에(?:는)?).{0,24}(?:벗|입)/u;

const PARTIAL_OUTERWEAR =
  /(?:재킷|자켓|코트|외투|가디건|후드|겉옷|아우터)(?:만|을|를)?\s*(?:벗|벗어|벗겨|벗기|벗겨내)/u;

const PARTIAL_UNBUTTON =
  /(?:단추|단추(?:를|만)?\s*(?:몇\s*개\s*)?(?:풀|풀어|해제)|깃(?:을|만)?\s*(?:풀|느슨)|옷(?:깃|단추))/u;

const INCOMPLETE_UNDRESS =
  /(?:벗(?:으려|으려고|으려\s*는|을\s*뻔|을\s*듯|을\s*것\s*같)|벗(?:기\s*시작|기\s*하려)|손(?:을|만)\s*(?:올|뻗|대).{0,12}벗)/u;

const UPPER_GARMENT = new RegExp(UPPER_GARMENT_PATTERN, "u");

const SHIRTLESS_STATE =
  /(?:맨(?:가슴|몸|상체|윗몸)|상(?:반신|체)(?:가|을|를)?\s*(?:드|노)|윗몸(?:이|을|를)?\s*(?:드|노)|shirtless|bare\s+(?:chest|torso|upper)|상의(?:를|가)?\s*(?:벗(?:은|어)|없)|셔츠(?:를|가)?\s*(?:벗(?:은|어)|없)|벗(?:은|어)\s*(?:상태|채))/u;

function hasCompletedUpperRemoval(clause: string): boolean {
  if (
    new RegExp(
      `(?:(?:[\\p{L}\\p{N}·]{1,24}|자신)의\\s*)?(?:${UPPER_GARMENT_PATTERN})(?:를|을|가)?\\s*(?:완전히\\s*)?${CLOTHING_UNDRESS_ACTION}`,
      "u"
    ).test(clause)
  ) {
    return true;
  }
  if (/벗(?:어|겨(?:내)?)\s*맨(?:가슴|상체|몸|윗몸)/u.test(clause)) {
    return true;
  }
  if (/벗(?:어|겨(?:내)?)[^.]{0,8}상(?:반신|체)(?:를|을)?\s*(?:드|노)/u.test(clause)) {
    return true;
  }
  return false;
}

function hasCompletedReclothing(clause: string): boolean {
  if (
    new RegExp(
      `(?:다시|새로)\\s*(?:(?:[\\p{L}\\p{N}·]{1,24}|자신)의\\s*)?(?:${UPPER_GARMENT_PATTERN}|옷)(?:를|을|가)?\\s*입`,
      "u"
    ).test(clause)
  ) {
    return true;
  }
  return new RegExp(
    `(?:(?:[\\p{L}\\p{N}·]{1,24}|자신)의\\s*)?(?:${UPPER_GARMENT_PATTERN}|옷)(?:를|을|가)?\\s*(?:다시\\s*)?입(?:어(?:서)?|은|음|었다|는다)`,
    "u"
  ).test(clause);
}

type ClauseClassification = {
  target: ClothingTarget;
  shirtless: boolean;
  covered: boolean;
  reason: ComicClothingReasonCategory;
};

function identityForCanonicalName(name: string, ctx: ApplyCanonicalComicClothingCoverageContext): NamedIdentity | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (normalizeNameToken(trimmed) === normalizeNameToken(ctx.characterName)) {
    return "character";
  }
  if (normalizeNameToken(trimmed) === normalizeNameToken(ctx.personaName)) {
    return "persona";
  }
  for (const known of ctx.knownSpeakerNames ?? []) {
    const knownTrimmed = known.trim();
    if (!knownTrimmed) continue;
    if (
      normalizeNameToken(knownTrimmed) !== normalizeNameToken(ctx.characterName) &&
      normalizeNameToken(knownTrimmed) !== normalizeNameToken(ctx.personaName) &&
      normalizeNameToken(trimmed) === normalizeNameToken(knownTrimmed)
    ) {
      return "supporting";
    }
  }
  return null;
}

/** Resolve grammatical subject at clause start (Name+particle). */
function resolveClauseGrammaticalSubject(
  clause: string,
  ctx: ApplyCanonicalComicClothingCoverageContext
): NamedIdentity | null {
  const trimmed = clause.trim();
  const candidates = [
    ctx.characterName,
    ctx.personaName,
    ...(ctx.knownSpeakerNames ?? []),
  ];
  for (const name of candidates) {
    const identity = identityForCanonicalName(name, ctx);
    if (!identity) continue;
    const pattern = new RegExp(
      `^${escapeRegExp(name.trim())}(?:${KOREAN_NAME_PARTICLES})`,
      "iu"
    );
    if (pattern.test(trimmed)) {
      return identity;
    }
  }
  return null;
}

/** Resolve possessive garment owner nearest to the clothing action verb. */
function resolveActionGarmentOwner(
  clause: string,
  ctx: ApplyCanonicalComicClothingCoverageContext
): NamedIdentity | "self" | null {
  const actionMatch = CLOTHING_ACTION_PATTERN.exec(clause);
  if (!actionMatch || actionMatch.index === undefined) {
    return null;
  }
  const beforeAction = clause.slice(0, actionMatch.index);
  const possessivePattern = new RegExp(
    `(자신|[\\p{L}\\p{N}·]{1,24})의\\s*${UPPER_GARMENT_PATTERN}`,
    "giu"
  );
  let lastOwner: string | null = null;
  for (const match of beforeAction.matchAll(possessivePattern)) {
    lastOwner = match[1] ?? null;
  }
  if (lastOwner === "자신") {
    return "self";
  }
  if (lastOwner) {
    return identityForCanonicalName(lastOwner, ctx);
  }
  return null;
}

function resolveClothingTarget(
  clause: string,
  event: SceneEvent,
  ctx: ApplyCanonicalComicClothingCoverageContext,
  inheritedSubject?: NamedIdentity | null
): ClothingTarget {
  const garmentOwner = resolveActionGarmentOwner(clause, ctx);

  if (garmentOwner === "character") {
    return "character";
  }
  if (garmentOwner === "persona" || garmentOwner === "supporting") {
    return "other";
  }
  if (garmentOwner === "self") {
    const subject = resolveClauseGrammaticalSubject(clause, ctx) ?? inheritedSubject ?? null;
    if (subject === "character") return "character";
    if (subject === "persona" || subject === "supporting") return "other";
    if (event.actor === "character") return "character";
    return "ambiguous";
  }

  const subject = resolveClauseGrammaticalSubject(clause, ctx) ?? inheritedSubject ?? null;
  if (subject === "persona" || subject === "supporting") {
    return "other";
  }
  if (subject === "character") {
    return "character";
  }

  if (event.actor === "character") {
    return "character";
  }

  return "ambiguous";
}

function classifyClause(
  clause: string,
  event: SceneEvent,
  ctx: ApplyCanonicalComicClothingCoverageContext,
  inheritedSubject?: NamedIdentity | null
): ClauseClassification | null {
  if (!clause.trim()) return null;
  if (NEGATION.test(clause)) {
    return { target: "ambiguous", shirtless: false, covered: false, reason: "negation" };
  }
  if (REQUEST_ONLY.test(clause)) {
    return { target: "ambiguous", shirtless: false, covered: false, reason: "request_only" };
  }
  if (HYPOTHETICAL.test(clause)) {
    return { target: "ambiguous", shirtless: false, covered: false, reason: "hypothetical" };
  }
  if (HISTORICAL_ONLY.test(clause)) {
    return { target: "ambiguous", shirtless: false, covered: false, reason: "historical_only" };
  }
  if (INCOMPLETE_UNDRESS.test(clause)) {
    return { target: "ambiguous", shirtless: false, covered: false, reason: "incomplete_action" };
  }

  const hasUpperGarment = UPPER_GARMENT.test(clause);
  const hasShirtlessCue = SHIRTLESS_STATE.test(clause);
  const hasRemoval = hasCompletedUpperRemoval(clause);
  const hasReclothing = hasCompletedReclothing(clause);
  const hasPartialOuterwear = PARTIAL_OUTERWEAR.test(clause);
  const hasPartialUnbutton = PARTIAL_UNBUTTON.test(clause);

  if (!hasUpperGarment && !hasShirtlessCue && !hasRemoval && !hasReclothing) {
    return null;
  }

  const target = resolveClothingTarget(clause, event, ctx, inheritedSubject);

  if (target === "other") {
    return { target, shirtless: false, covered: false, reason: "wrong_target" };
  }
  if (target === "ambiguous") {
    return { target, shirtless: false, covered: false, reason: "ambiguous_target" };
  }

  if (hasPartialOuterwear && !hasRemoval && !hasShirtlessCue) {
    return { target, shirtless: false, covered: false, reason: "partial_outerwear_only" };
  }
  if (hasPartialUnbutton && !hasRemoval && !hasShirtlessCue) {
    return { target, shirtless: false, covered: false, reason: "partial_unbutton_loosen" };
  }

  if (hasReclothing) {
    return { target, shirtless: false, covered: true, reason: "explicit_reclothing" };
  }

  if (hasRemoval || hasShirtlessCue) {
    const personaRemovedCharacterShirt =
      hasRemoval &&
      matchesCanonicalName(clause, ctx.personaName) &&
      resolveActionGarmentOwner(clause, ctx) === "character" &&
      /(?:벗(?:기|겨)|벗겨)/u.test(clause);
    return {
      target,
      shirtless: true,
      covered: false,
      reason: personaRemovedCharacterShirt
        ? "persona_removed_character_shirt"
        : hasRemoval
          ? "explicit_upper_garment_removal"
          : "explicit_shirtless_current_state",
    };
  }

  return null;
}

function transitionBetweenStates(
  from: ComicClothingSemanticState,
  to: ComicClothingSemanticState,
  reason: ComicClothingReasonCategory
): ComicClothingTransitionKind {
  if (from === to) return "none";
  if (to === "SHIRTLESS_UPPER_TORSO") return "covered_to_shirtless";
  if (to === "DEFAULT_COVERED" && from === "SHIRTLESS_UPPER_TORSO") {
    return reason === "scene_time_boundary" ? "scene_reset" : "shirtless_to_covered";
  }
  if (to === "DEFAULT_COVERED" && reason === "scene_time_boundary") {
    return "scene_reset";
  }
  return "none";
}

function processEventChronology(
  incomingState: ComicClothingSemanticState,
  event: SceneEvent,
  ctx: ApplyCanonicalComicClothingCoverageContext
): {
  nextState: ComicClothingSemanticState;
  conflict: boolean;
  transition: ComicClothingTransitionKind;
  reason: ComicClothingReasonCategory;
} {
  if (event.kind === "dialogue") {
    return {
      nextState: incomingState,
      conflict: false,
      transition: "none",
      reason: "dialogue_skipped",
    };
  }

  let state = incomingState;
  let reason: ComicClothingReasonCategory = "ambiguous_target";
  let sawShirtlessTransition = false;
  let sawReclothingTransition = false;
  let conflict = false;
  let eventSubject: NamedIdentity | null = null;

  for (const clause of splitWriterClauses(event.text)) {
    const clauseSubject = resolveClauseGrammaticalSubject(clause, ctx);
    if (clauseSubject) {
      eventSubject = clauseSubject;
    }

    if (SCENE_TIME_BOUNDARY.test(clause)) {
      state = "DEFAULT_COVERED";
      reason = "scene_time_boundary";
      sawShirtlessTransition = false;
      sawReclothingTransition = false;
      conflict = false;
      continue;
    }

    const classified = classifyClause(clause, event, ctx, eventSubject);
    if (!classified) continue;

    if (classified.shirtless) {
      if (sawReclothingTransition) {
        conflict = true;
        state = "DEFAULT_COVERED";
        reason = "conflict_same_event";
        continue;
      }
      sawShirtlessTransition = true;
      state = "SHIRTLESS_UPPER_TORSO";
      reason = classified.reason;
      continue;
    }

    if (classified.covered && classified.reason === "explicit_reclothing") {
      if (sawShirtlessTransition) {
        conflict = true;
        state = "DEFAULT_COVERED";
        reason = "conflict_same_event";
        continue;
      }
      sawReclothingTransition = true;
      state = "DEFAULT_COVERED";
      reason = "explicit_reclothing";
    }
  }

  if (conflict) {
    return {
      nextState: "DEFAULT_COVERED",
      conflict: true,
      transition: "none",
      reason: "conflict_same_event",
    };
  }

  return {
    nextState: state,
    conflict: false,
    transition: transitionBetweenStates(incomingState, state, reason),
    reason,
  };
}

function semanticStateToCoverage(
  state: ComicClothingSemanticState
): ScenePanelClothingCoverage | undefined {
  if (state === "SHIRTLESS_UPPER_TORSO") {
    return "adult_male_character_shirtless_upper_torso";
  }
  return undefined;
}

function eventsById(plan: ScenePlan): Map<string, SceneEvent> {
  return new Map(plan.events.map((event) => [event.id, event]));
}

function resolvePanelState(
  panel: ScenePanel,
  incomingState: ComicClothingSemanticState,
  eventMap: Map<string, SceneEvent>,
  ctx: ApplyCanonicalComicClothingCoverageContext
): {
  state: ComicClothingSemanticState;
  audit: ComicClothingPanelAudit;
} {
  let state = incomingState;
  let transition: ComicClothingTransitionKind = "none";
  let reasonCategory: ComicClothingReasonCategory =
    panel.sourceEventIds.length === 0 ? "carry_forward" : "ambiguous_target";
  let conflict = false;

  const orderedIds = [...panel.sourceEventIds].sort((left, right) => {
    const leftOrder = eventMap.get(left)?.order ?? 0;
    const rightOrder = eventMap.get(right)?.order ?? 0;
    return leftOrder - rightOrder;
  });

  for (const eventId of orderedIds) {
    const event = eventMap.get(eventId);
    if (!event) continue;
    const result = processEventChronology(state, event, ctx);
    state = result.nextState;
    if (result.conflict) {
      conflict = true;
      reasonCategory = "conflict_same_event";
      transition = "none";
      continue;
    }
    if (result.transition !== "none") {
      transition = result.transition;
      reasonCategory = result.reason;
    } else if (result.reason !== "ambiguous_target" && result.reason !== "dialogue_skipped") {
      reasonCategory = result.reason;
    }
  }

  if (panel.sourceEventIds.length === 0) {
    reasonCategory = "carry_forward";
  } else if (conflict) {
    state = "DEFAULT_COVERED";
    transition = "none";
    reasonCategory = "conflict_same_event";
  }

  const coverage = semanticStateToCoverage(state);
  return {
    state,
    audit: {
      panelIndex: panel.index,
      resolvedCoverage: coverage ?? "omitted",
      sourceEventIds: [...panel.sourceEventIds],
      transition,
      reasonCategory,
    },
  };
}

/** Canonical production clothing writer — sets server-derived panel.clothingCoverage. */
export function applyCanonicalComicClothingCoverage(
  plan: ScenePlan,
  ctx: ApplyCanonicalComicClothingCoverageContext
): ApplyCanonicalComicClothingCoverageResult {
  const eventMap = eventsById(plan);
  const audit: ComicClothingPanelAudit[] = [];
  let rollingState: ComicClothingSemanticState = "DEFAULT_COVERED";

  const panels: ScenePanel[] = plan.panels.map((panel) => {
    const resolved = resolvePanelState(panel, rollingState, eventMap, ctx);
    rollingState = resolved.state;
    audit.push(resolved.audit);

    const coverage = semanticStateToCoverage(resolved.state);
    const nextPanel: ScenePanel = { ...panel };
    if (coverage) {
      nextPanel.clothingCoverage = coverage;
    } else {
      delete nextPanel.clothingCoverage;
    }
    return nextPanel;
  });

  return {
    plan: { ...plan, panels },
    audit,
  };
}
