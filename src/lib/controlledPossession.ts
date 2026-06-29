export type ControlledPossessionContext = {
  charName: string;
  personaName: string;
  completedTurns: number;
};

const MINIMAL_CO_NARRATION = `[POSSESSION — MINIMAL CO-NARRATION]
Minimal co-narration for [B] ONLY within user-input intent.
- Mirror user tone — NO upgrade to confessions/vows/멜로드라마.
- Proportional reactions only — NO instant devotion.
- NO invented intimacy/tears/kneeling/soul-bond unless user wrote it.
- NO copy-paste user input. One turn = next few minutes only.`;

const FORBIDDEN_EMOTIONAL_LEAPS = `[FORBIDDEN EMOTIONAL LEAPS]
[A] ↔ [B]: NO single-turn stage jumps.
Forbidden until earned: instant trust, love confessions, obsession, fate/soulmate, spouse terms, worship, kneeling vows.
Scale affection with accumulated interaction + lore.`;

const SLOW_BURN = `[SLOW BURN]
[A]: restrained reactions; internalize confusion. Show don't tell. End returning agency to [B].`;

const ANTI_MELODRAMA = `[ANTI-MELODRAMA]
Grounded RP — one physical tell, not cliché stacks. [A] stays temperament from settings. Humor/mundane friction OK.`;

const RELATIONSHIP_PROGRESSION = `[RELATIONSHIP PROGRESSION]
Relationship changes only through accumulated interaction.
Never skip emotional stages.
Trust, affection, intimacy, dependency must emerge gradually.`;

const CHARACTER_CONSISTENCY = `[CHARACTER CONSISTENCY]
Do not soften, romanticize, or exaggerate personalities.
Every emotional change must be justified by the current scene.`;

export function buildControlledPossessionRules(_ctx: ControlledPossessionContext): string {
  return [
    `[CONTROLLED POSSESSION MODE — ACTIVE]
3rd-person co-narration ON for [A] + [B]. Strict believability — NOT unlimited romance possession.`,
    MINIMAL_CO_NARRATION,
    FORBIDDEN_EMOTIONAL_LEAPS,
    SLOW_BURN,
    ANTI_MELODRAMA,
    RELATIONSHIP_PROGRESSION,
    CHARACTER_CONSISTENCY,
  ].join("\n\n");
}

/** @deprecated Use buildControlledPossessionRules — kept for import compatibility */
export const EARLY_RELATIONSHIP_TURN_LIMIT = 15;

/** @deprecated Use buildControlledPossessionRules */
export const FIRST_TURN_REALISM_LIMIT = 5;

/** @deprecated Merged into buildControlledPossessionRules */
export function buildBelievableUserNarrationRules(ctx: ControlledPossessionContext): string {
  return buildControlledPossessionRules(ctx);
}

/** @deprecated Merged into buildControlledPossessionRules */
export function buildForbiddenEmotionalLeapRules(ctx: ControlledPossessionContext): string {
  return FORBIDDEN_EMOTIONAL_LEAPS;
}

/** @deprecated Removed — slow burn in buildControlledPossessionRules */
export function buildFirstTurnRealismRules(_ctx: ControlledPossessionContext): string | null {
  return null;
}

/** @deprecated Merged into buildControlledPossessionRules */
export function buildUserPossessionQualityRules(_ctx: ControlledPossessionContext): string {
  return MINIMAL_CO_NARRATION;
}

/** @deprecated Moved to CORE IDENTITY — not injected here */
export function buildWorldHierarchyRules(_ctx: ControlledPossessionContext): string {
  return "";
}

/** @deprecated Merged into buildControlledPossessionRules */
export function buildAntiOverdramatizationRules(_ctx: ControlledPossessionContext): string {
  return ANTI_MELODRAMA;
}

/** @deprecated Merged into buildControlledPossessionRules */
export function buildPossessionPacingControlRules(_ctx: ControlledPossessionContext): string {
  return SLOW_BURN;
}

/** @deprecated Merged into buildControlledPossessionRules */
export function buildEarlySlowBurnRules(_ctx: ControlledPossessionContext): string | null {
  return SLOW_BURN;
}
