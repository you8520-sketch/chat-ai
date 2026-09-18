/**
 * LD strict fallback source semantics — deterministic current-event classifiers.
 * Reuses comic clothing primitives for shirtless target attribution.
 */

import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import {
  hasCurrentCharacterShirtlessUpperTorso,
  type LdStrictClothingContext,
} from "@/lib/chatComicClothingWriter";

export type LdStrictSceneSemanticContext = LdStrictClothingContext & {
  characterGender?: ImagePromptGender;
  personaGender?: ImagePromptGender;
};

const SCENE_TIME_BOUNDARY =
  /(?:^|\s)(?:다음\s*날|다음날|며칠\s*(?:뒤|후)|오늘(?:은|의)?|지금(?:은|의)?|현재|장면\s*(?:이|이\s*)?전환|시간(?:이|은)?\s*(?:지나|흘러))/u;

const KISS_LEXICAL = /(?:키스|kiss|입(?:을|술(?:을)?)\s*맞)/iu;

const KISS_NEGATION =
  /(?:키스(?:하)?(?:지\s*않|안(?:\s*(?:했|하|함|해|한다|했(?:다|음)?))?)|(?:did\s+not|without)\s+kiss|no\s+kiss)/iu;

const KISS_HYPOTHETICAL =
  /(?:키스(?:할(?:까|래|까요)?|하고\s*싶|(?:하)?(?:으)?(?:려|을)\s*(?:고|는|뻔|듯|것\s*같))|kiss(?:\s+\w+){0,2}\?)/iu;

const KISS_INCOMPLETE =
  /(?:키스(?:하)?(?:려(?:다|고)|하다\s*멈|을\s*뻔)|입(?:을|술(?:을)?)\s*맞(?:추(?:려(?:다|고)?|다\s*멈)|을\s*뻔))/iu;

const KISS_HISTORICAL =
  /(?:어제|예전(?:에)?|그(?:때|저번)|한\s*참\s*전|옛날(?:에)?|과거(?:에)?|전에(?:는)?).{0,40}(?:키스|입(?:을|술(?:을)?)\s*맞)/iu;

const KISS_PLUPERFECT_OR_PAST_REFERENCE =
  /(?:키스(?:했(?:었(?:다|음)?|던)|한\s*적)|입(?:을|술(?:을)?)\s*맞(?:춘|췄(?:었(?:다|음)?|던)|(?:춘|췄)\s*적))/iu;

const KISS_COMPLETED =
  /(?:키스(?:했다|한다|한|하며|하는|중)|(?:짧(?:게|은)?|가볍(?:게|게)?)\s*키스|입(?:을|술(?:을)?)\s*맞(?:추(?:었다|었(?:다|음)?|는다|였)|(?:춘|췄))|kiss(?:ed|es|ing)?)/iu;

function splitSemanticClauses(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=다|자|고|며|서|음|함|것|점|았다|었다|였다|했다|냈다|냈|였|았|겠)[.!?。…]?\s+|[.!?。…]\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Current-scene completed non-explicit kiss — conservative; ambiguous → false. */
export function hasCurrentCompletedKiss(sourceText: string): boolean {
  let hasKiss = false;
  for (const clause of splitSemanticClauses(sourceText)) {
    if (SCENE_TIME_BOUNDARY.test(clause)) {
      hasKiss = false;
      continue;
    }
    if (!KISS_LEXICAL.test(clause)) {
      continue;
    }
    if (KISS_NEGATION.test(clause)) {
      hasKiss = false;
      continue;
    }
    if (KISS_HYPOTHETICAL.test(clause) || KISS_INCOMPLETE.test(clause)) {
      continue;
    }
    if (KISS_HISTORICAL.test(clause) || KISS_PLUPERFECT_OR_PAST_REFERENCE.test(clause)) {
      continue;
    }
    if (KISS_COMPLETED.test(clause)) {
      hasKiss = true;
    }
  }
  return hasKiss;
}

/** Character shirtless upper torso in the current scene — uses canonical clothing attribution. */
export function hasCharacterShirtlessUpperTorso(
  sourceText: string,
  ctx: LdStrictSceneSemanticContext
): boolean {
  if (ctx.characterGender !== "male") {
    return false;
  }
  return hasCurrentCharacterShirtlessUpperTorso(sourceText, ctx);
}
