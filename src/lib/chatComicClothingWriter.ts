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

const UPPER_GARMENT =
  /(?:셔츠|상의|윗옷|티셔츠|남방|블라우스|맨투맨|후드티)/u;

const SHIRTLESS_STATE =
  /(?:맨(?:가슴|몸|상체|윗몸)|상(?:반신|체)(?:가|을|를)?\s*(?:드|노)|윗몸(?:이|을|를)?\s*(?:드|노)|shirtless|bare\s+(?:chest|torso|upper)|상의(?:를|가)?\s*(?:벗(?:은|어)|없)|셔츠(?:를|가)?\s*(?:벗(?:은|어)|없)|벗(?:은|어)\s*(?:상태|채))/u;

function hasCompletedUpperRemoval(clause: string): boolean {
  if (
    /(?:셔츠|상의|윗옷|티셔츠|남방)(?:를|을|가)?\s*(?:완전히\s*)?벗(?:어(?:서)?|겨(?:내(?:서)?)?|겼(?:다|어|음)?|기(?:내)?)/u.test(
      clause
    )
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
  if (/(?:다시|새로)\s*(?:셔츠|상의|윗옷|티셔츠|남방|옷)(?:를|을|가)?\s*입/u.test(clause)) {
    return true;
  }
  return /(?:셔츠|상의|윗옷|티셔츠|남방|옷)(?:를|을|가)?\s*(?:다시\s*)?입(?:어(?:서)?|은|음|었다|는다)/u.test(
    clause
  );
}

type ClothingTarget = "character" | "other" | "ambiguous";

type ClauseClassification = {
  target: ClothingTarget;
  shirtless: boolean;
  covered: boolean;
  reason: ComicClothingReasonCategory;
};

function resolveClothingTarget(
  clause: string,
  event: SceneEvent,
  ctx: ApplyCanonicalComicClothingCoverageContext
): ClothingTarget {
  const characterNamed = matchesCanonicalName(clause, ctx.characterName);
  const personaNamed = matchesCanonicalName(clause, ctx.personaName);

  const otherNamed = (ctx.knownSpeakerNames ?? []).some(
    (name) =>
      name.trim() &&
      normalizeNameToken(name) !== normalizeNameToken(ctx.characterName) &&
      normalizeNameToken(name) !== normalizeNameToken(ctx.personaName) &&
      matchesCanonicalName(clause, name)
  );

  if (personaNamed && !characterNamed) return "other";
  if (otherNamed && !characterNamed) return "other";

  if (characterNamed) return "character";

  if (personaNamed && characterNamed) return "ambiguous";

  if (event.actor === "character") return "character";

  if (personaNamed || otherNamed) return "other";

  return "ambiguous";
}

function classifyClause(
  clause: string,
  event: SceneEvent,
  ctx: ApplyCanonicalComicClothingCoverageContext
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

  const target = resolveClothingTarget(clause, event, ctx);

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
      matchesCanonicalName(clause, ctx.characterName) &&
      /(?:벗(?:기|겨)|벗겨)/u.test(clause);
    const reason = personaRemovedCharacterShirt
      ? "persona_removed_character_shirt"
      : hasRemoval
        ? "explicit_upper_garment_removal"
        : "explicit_shirtless_current_state";
    return { target, shirtless: true, covered: false, reason };
  }

  return null;
}

function classifyEvent(
  event: SceneEvent,
  ctx: ApplyCanonicalComicClothingCoverageContext
): {
  shirtless: boolean;
  covered: boolean;
  conflict: boolean;
  reason: ComicClothingReasonCategory;
} {
  if (event.kind === "dialogue") {
    return { shirtless: false, covered: false, conflict: false, reason: "dialogue_skipped" };
  }

  if (SCENE_TIME_BOUNDARY.test(event.text)) {
    return { shirtless: false, covered: true, conflict: false, reason: "scene_time_boundary" };
  }

  const clauses = splitWriterClauses(event.text);
  let sawShirtless = false;
  let sawCovered = false;
  let lastReason: ComicClothingReasonCategory = "ambiguous_target";

  for (const clause of clauses) {
    const classified = classifyClause(clause, event, ctx);
    if (!classified) continue;
    if (classified.shirtless) sawShirtless = true;
    if (classified.covered) sawCovered = true;
    lastReason = classified.reason;
  }

  if (sawShirtless && sawCovered) {
    return {
      shirtless: false,
      covered: false,
      conflict: true,
      reason: "conflict_same_event",
    };
  }
  if (sawShirtless) {
    return { shirtless: true, covered: false, conflict: false, reason: lastReason };
  }
  if (sawCovered) {
    return { shirtless: false, covered: true, conflict: false, reason: lastReason };
  }

  return { shirtless: false, covered: false, conflict: false, reason: "ambiguous_target" };
}

function semanticStateToCoverage(
  state: ComicClothingSemanticState
): ScenePanelClothingCoverage | undefined {
  if (state === "SHIRTLESS_UPPER_TORSO") {
    return "adult_male_character_shirtless_upper_torso";
  }
  return undefined;
}

function applyEventToState(
  state: ComicClothingSemanticState,
  eventResult: ReturnType<typeof classifyEvent>
): {
  nextState: ComicClothingSemanticState;
  transition: ComicClothingTransitionKind;
} {
  if (eventResult.conflict) {
    return { nextState: "DEFAULT_COVERED", transition: "none" };
  }
  if (eventResult.reason === "scene_time_boundary") {
    return { nextState: "DEFAULT_COVERED", transition: "scene_reset" };
  }
  if (eventResult.shirtless) {
    return {
      nextState: "SHIRTLESS_UPPER_TORSO",
      transition: state === "SHIRTLESS_UPPER_TORSO" ? "none" : "covered_to_shirtless",
    };
  }
  if (eventResult.covered) {
    return {
      nextState: "DEFAULT_COVERED",
      transition: state === "DEFAULT_COVERED" ? "none" : "shirtless_to_covered",
    };
  }
  return { nextState: state, transition: "none" };
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
    const result = classifyEvent(event, ctx);
    if (result.conflict) {
      conflict = true;
      reasonCategory = "conflict_same_event";
      state = "DEFAULT_COVERED";
      transition = "none";
      continue;
    }
    const applied = applyEventToState(state, result);
    state = applied.nextState;
    if (applied.transition !== "none") {
      transition = applied.transition;
      reasonCategory = result.reason;
    } else if (result.reason !== "ambiguous_target" || result.shirtless || result.covered) {
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
