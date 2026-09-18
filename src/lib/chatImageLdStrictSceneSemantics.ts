/**
 * LD strict fallback source semantics — deterministic current-event classifiers.
 * Reuses comic clothing primitives for shirtless target attribution.
 */

import type { ImagePromptGender } from "@/lib/chatImageGeneration";
import { matchesCanonicalName } from "@/lib/chatComicClothingWriter";
import {
  hasCurrentCharacterShirtlessUpperTorso,
  type LdStrictClothingContext,
} from "@/lib/chatComicClothingWriter";
import type { ChatImageVisualSubject } from "@/lib/chatImageVisualIdentity";

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
  /(?:키스(?:했다|한다|한|하며|하는|중)|(?:짧(?:게|은)?|가볍(?:게|게)?)\s*키스|입(?:을|술(?:을)?)\s*맞(?:추(?:었다|었(?:다|음)?|는다|였)|췄(?:다|음)?|(?:춘|췄))|kiss(?:ed|es|ing)?)/iu;

const UNBOUND_PRONOUN_LEAD = /^(?:그|그녀|그가|그는|그를|누군(?:가|는))(?:\s|$)/u;

const LEADING_SCENE_BOUNDARY =
  /^(?:다음\s*날|다음날|며칠\s*(?:뒤|후)|오늘(?:은|의)?|지금(?:은|의)?|현재|장면\s*(?:이|이\s*)?전환|시간(?:이|은)?\s*(?:지나|흘러))\s*/u;

type NameIdentity = "character" | "persona" | "supporting" | "unknown";

function stripLeadingSceneBoundary(clause: string): string {
  return clause.replace(LEADING_SCENE_BOUNDARY, "").trim();
}

function stripNameParticles(name: string): string {
  return name.replace(/(?:은|는|이|가|를|을|의|에게|한테|도|만)$/u, "").trim();
}

function splitSemanticClauses(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=다|자|고|며|서|음|함|것|점|았다|었다|였다|했다|냈다|냈|였|았|겠)[.!?。…]?\s+|[.!?。…]\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveNameIdentity(name: string, ctx: LdStrictSceneSemanticContext): NameIdentity {
  const trimmed = stripNameParticles(name.trim());
  if (!trimmed) return "unknown";
  if (matchesCanonicalName(trimmed, ctx.characterName)) return "character";
  if (matchesCanonicalName(trimmed, ctx.personaName)) return "persona";
  for (const known of ctx.knownSpeakerNames ?? []) {
    if (matchesCanonicalName(trimmed, known)) return "supporting";
  }
  return "unknown";
}

function findCanonicalSubjectInClause(
  clause: string,
  ctx: LdStrictSceneSemanticContext
): NameIdentity | null {
  const candidates: Array<{ name: string; identity: NameIdentity }> = [
    { name: ctx.characterName, identity: "character" },
    { name: ctx.personaName, identity: "persona" },
    ...(ctx.knownSpeakerNames ?? []).map((name) => ({
      name,
      identity: "supporting" as const,
    })),
  ];
  for (const candidate of candidates) {
    const trimmed = candidate.name.trim();
    if (!trimmed) continue;
    const pattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:은|는|이|가|를|을|의|에게|한테|과|와|도|만|[^\\p{L}\\p{N}]|$)`,
      "iu"
    );
    if (pattern.test(clause)) {
      return candidate.identity;
    }
  }
  return null;
}

function resolveCanonicalDuoKissParticipant(
  clause: string,
  sourceText: string,
  ctx: LdStrictSceneSemanticContext
): "canonical_duo" | "non_canonical" | "ambiguous" {
  const hasChar = matchesCanonicalName(clause, ctx.characterName);
  const hasPersona = matchesCanonicalName(clause, ctx.personaName);
  const supportingInClause = (ctx.knownSpeakerNames ?? []).filter((name) =>
    matchesCanonicalName(clause, name)
  );

  for (const conjPair of clause.matchAll(
    /([\p{L}\p{N}·]{1,24})\s*(?:과|와)\s*([\p{L}\p{N}·]{1,24})/gu
  )) {
    const leftId = resolveNameIdentity(conjPair[1] ?? "", ctx);
    const rightId = resolveNameIdentity(conjPair[2] ?? "", ctx);
    if (leftId === "unknown" && rightId === "unknown") {
      continue;
    }
    if (
      (leftId === "character" && rightId === "persona") ||
      (leftId === "persona" && rightId === "character")
    ) {
      return "canonical_duo";
    }
    if (
      (leftId === "character" && rightId === "supporting") ||
      (leftId === "persona" && rightId === "supporting") ||
      (leftId === "supporting" && (rightId === "character" || rightId === "persona"))
    ) {
      return "non_canonical";
    }
    if (
      (leftId === "character" || leftId === "persona") &&
      rightId === "unknown"
    ) {
      return "non_canonical";
    }
    if (
      (rightId === "character" || rightId === "persona") &&
      leftId === "unknown"
    ) {
      return "non_canonical";
    }
    if (leftId === "unknown" || rightId === "unknown") {
      return "ambiguous";
    }
  }

  if (hasChar && hasPersona) {
    return "canonical_duo";
  }

  const dative = clause.match(
    /([\p{L}\p{N}·]{1,24})(?:은|는|이|가)\s*([\p{L}\p{N}·]{1,24})(?:에게|한테)/u
  );
  if (dative) {
    const fromId = resolveNameIdentity(dative[1] ?? "", ctx);
    const toId = resolveNameIdentity(dative[2] ?? "", ctx);
    if (
      (fromId === "character" && toId === "persona") ||
      (fromId === "persona" && toId === "character")
    ) {
      return "canonical_duo";
    }
    if (fromId === "supporting" || toId === "supporting") {
      return "non_canonical";
    }
    if (fromId === "unknown" || toId === "unknown") {
      return "ambiguous";
    }
  }

  if (supportingInClause.length > 0 && (hasChar || hasPersona)) {
    return "non_canonical";
  }

  if (/둘(?:은|이)/u.test(clause)) {
    const thirdInSource = (ctx.knownSpeakerNames ?? []).some((name) =>
      matchesCanonicalName(sourceText, name)
    );
    if (thirdInSource) {
      return "ambiguous";
    }
    return "canonical_duo";
  }

  if (UNBOUND_PRONOUN_LEAD.test(stripLeadingSceneBoundary(clause))) {
    return "ambiguous";
  }

  const namedParticipantInClause =
    hasChar ||
    hasPersona ||
    supportingInClause.length > 0 ||
    /둘(?:은|이)/u.test(clause);
  if (!namedParticipantInClause) {
    return "canonical_duo";
  }

  return "ambiguous";
}

/** Collect supporting cast names from grounded visual subjects — excludes character/persona. */
export function collectLdKnownSpeakerNames(opts: {
  characterName: string;
  personaName: string;
  subjects?: readonly ChatImageVisualSubject[];
  knownSpeakerNames?: readonly string[];
}): string[] {
  const blocked = new Set(
    [opts.characterName, opts.personaName]
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );
  const out = new Set<string>();
  for (const name of opts.knownSpeakerNames ?? []) {
    const trimmed = name.trim();
    if (trimmed && !blocked.has(trimmed.toLowerCase())) {
      out.add(trimmed);
    }
  }
  for (const subject of opts.subjects ?? []) {
    if (subject.sourceKind === "main_character" || subject.sourceKind === "persona") {
      continue;
    }
    const name = subject.name.trim();
    if (name && !blocked.has(name.toLowerCase())) {
      out.add(name);
    }
    for (const alias of subject.aliases ?? []) {
      const trimmedAlias = alias.trim();
      if (trimmedAlias && !blocked.has(trimmedAlias.toLowerCase())) {
        out.add(trimmedAlias);
      }
    }
  }
  return [...out];
}

/** Current-scene canonical character/persona completed kiss — conservative; ambiguous → false. */
export function hasCurrentCanonicalDuoKiss(
  sourceText: string,
  ctx: LdStrictSceneSemanticContext
): boolean {
  let hasKiss = false;
  for (const clause of splitSemanticClauses(sourceText)) {
    if (SCENE_TIME_BOUNDARY.test(clause)) {
      hasKiss = false;
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
    if (!KISS_COMPLETED.test(clause)) {
      continue;
    }
    const participant = resolveCanonicalDuoKissParticipant(clause, sourceText, ctx);
    if (participant === "canonical_duo") {
      hasKiss = true;
    } else if (participant === "non_canonical") {
      hasKiss = false;
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
