import { EARLY_RELATIONSHIP_TURN_LIMIT } from "@/lib/narrativeRules";

export { EARLY_RELATIONSHIP_TURN_LIMIT };

/** First ~N turns: extra realism / anti-trope layer */
export const FIRST_TURN_REALISM_LIMIT = 5;

export type ControlledPossessionContext = {
  charName: string;
  personaName: string;
  completedTurns: number;
};

function label(ctx: ControlledPossessionContext): { char: string; persona: string } {
  return {
    char: ctx.charName.trim() || "the AI character",
    persona: ctx.personaName.trim() || "the user character",
  };
}

export function buildBelievableUserNarrationRules(ctx: ControlledPossessionContext): string {
  const { char, persona } = label(ctx);
  return `[POSSESSION — BELIEVABLE USER NARRATION]
Minimal co-narration for "${persona}" ONLY within user-input intent.
- Mirror user tone — NO upgrade to confessions/vows/멜로드라마.
- Proportional reactions only — NO instant devotion.
- NO invented intimacy/tears/kneeling/soul-bond unless user wrote it.
- NO copy-paste user input. One turn = next few minutes only.

[CRITICAL] NEW reactions from "${char}" — NO repeat past user/persona lines.`;
}

export function buildForbiddenEmotionalLeapRules(ctx: ControlledPossessionContext): string {
  const { char, persona } = label(ctx);
  const early = ctx.completedTurns < EARLY_RELATIONSHIP_TURN_LIMIT;
  const lines = [
    `[FORBIDDEN EMOTIONAL LEAPS]
"${char}" ↔ "${persona}": NO single-turn stage jumps.
Forbidden until earned: instant trust, love confessions, obsession, fate/soulmate, spouse terms, worship, kneeling vows.
Scale affection with completed turns (${ctx.completedTurns}) + lore.`,
  ];
  if (early) {
    lines.push(
      `[EARLY CAP t=${ctx.completedTurns}/${EARLY_RELATIONSHIP_TURN_LIMIT}]
Distance/formality/guarded curiosity only. NO crying, begging, kneeling, clinging.`
    );
  }
  return lines.join("\n\n");
}

export function buildFirstTurnRealismRules(ctx: ControlledPossessionContext): string | null {
  if (ctx.completedTurns >= FIRST_TURN_REALISM_LIMIT) return null;
  const { char, persona } = label(ctx);
  return `[FIRST-TURN REALISM ${ctx.completedTurns + 1}/${FIRST_TURN_REALISM_LIMIT}]
Real people, real setting — NO web-novel cold open tropes.
FORBIDDEN unless in setting/user input: fate monologues, time stop, stranger intimacy, instant love, weather 멜로드라마.
First meetings: awkward, brief, socially appropriate.`;
}

export function buildUserPossessionQualityRules(ctx: ControlledPossessionContext): string {
  const { persona } = label(ctx);
  return `[USER POSSESSION QC]
When narrating "${persona}": preserve user intent/register; NO overacting; NO self Q&A; minimal possession (one short beat max if user wrote dialogue only).`;
}

export function buildWorldHierarchyRules(ctx: ControlledPossessionContext): string {
  const { char, persona } = label(ctx);
  return `[WORLD HIERARCHY]
Honor rank, era, honorifics, faction lore for "${char}" ↔ "${persona}".
NO modern casual unless setting allows. NO invented shared past without lore/history.`;
}

export function buildAntiOverdramatizationRules(ctx: ControlledPossessionContext): string {
  const { char } = label(ctx);
  return `[ANTI-MELODRAMA]
Grounded RP — one physical tell, not cliché stacks. "${char}" stays temperament from settings. Humor/mundane friction OK.`;
}

export function buildPossessionPacingControlRules(ctx: ControlledPossessionContext): string {
  const { persona } = label(ctx);
  return `[POSSESSION PACING]
Co-narrate "${persona}" minimally. NO conflict resolution or climax for user. Slow burn — next few minutes only.
Turn-end handoff: obey <TURN_HANDOFF_AND_PACING>.`;
}

export function buildEarlySlowBurnRules(ctx: ControlledPossessionContext): string | null {
  if (ctx.completedTurns >= EARLY_RELATIONSHIP_TURN_LIMIT) return null;
  const { char, persona } = label(ctx);
  return `[SLOW BURN EARLY]
"${char}": restrained reactions; internalize confusion. Show don't tell. End returning agency to "${persona}".`;
}

export function buildControlledPossessionRules(ctx: ControlledPossessionContext): string {
  const { char, persona } = label(ctx);
  const sections = [
    `[CONTROLLED POSSESSION MODE — ACTIVE]
3rd-person co-narration ON for "${char}" + "${persona}". Strict believability — NOT unlimited romance possession.`,
    buildBelievableUserNarrationRules(ctx),
    buildForbiddenEmotionalLeapRules(ctx),
    buildUserPossessionQualityRules(ctx),
    buildWorldHierarchyRules(ctx),
    buildAntiOverdramatizationRules(ctx),
    buildPossessionPacingControlRules(ctx),
  ];

  const firstTurn = buildFirstTurnRealismRules(ctx);
  if (firstTurn) sections.push(firstTurn);

  const slowBurn = buildEarlySlowBurnRules(ctx);
  if (slowBurn) sections.push(slowBurn);

  return sections.join("\n\n");
}
