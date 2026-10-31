import type { EpisodicExtractedFact } from "@/lib/memory/memory-episodic-types";
import type { EpisodicSectionParse } from "@/lib/memory/memory-episodic-shared";

/**
 * Optional artifact-role section. It carries the historical role chain
 * (created/presented/took/wore/later_wore) separately from the free-form
 * episodic facts, because the free-form section reliably loses the role when it
 * competes with the surrounding ceremony. It is persisted as ordinary episodic
 * facts through the existing writer; there is no new table or owner.
 */

export type ArtifactRoleName = "created" | "presented" | "took" | "wore" | "later_wore";

export type ArtifactRoleEntry = {
  role: ArtifactRoleName;
  actor: string;
  actorKey: string;
  item: string;
  itemKey: string;
  quote: string;
  sameObject: "confirmed" | "unconfirmed" | "not_applicable";
};

export type ArtifactRolesParse = {
  present: boolean;
  valid: boolean;
  roles: ArtifactRoleEntry[];
};

const ROLE_NAMES = new Set<ArtifactRoleName>([
  "created",
  "presented",
  "took",
  "wore",
  "later_wore",
]);
const SAME_OBJECT = new Set(["confirmed", "unconfirmed", "not_applicable"]);
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

const ROLE_ATTRIBUTE: Record<ArtifactRoleName, string> = {
  created: "created_item",
  presented: "presented_item",
  took: "took_item",
  wore: "wearing",
  later_wore: "later_wearing",
};

const ROLE_IMPORTANCE: Record<ArtifactRoleName, EpisodicExtractedFact["importance"]> = {
  created: "important",
  presented: "important",
  took: "important",
  wore: "important",
  later_wore: "normal",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Keyword locator only: the model still decides whether a role actually occurred. */
export function hasArtifactLifecycleCandidate(prose: string): boolean {
  const artifact = /(?:반지|목걸이|팔찌|귀걸이|브로치|수류탄|안전\s*핀|벨벳\s*상자)/;
  const roleAction = /(?:만들|제작|제시|건네|받아|집어|착용|끼워|끼고|열어|내밀)/;
  return artifact.test(prose) && roleAction.test(prose);
}

export function parseArtifactRolesSection(raw: unknown): ArtifactRolesParse {
  if (raw === undefined || raw === null) {
    return { present: false, valid: false, roles: [] };
  }
  if (!Array.isArray(raw)) {
    return { present: true, valid: false, roles: [] };
  }
  const roles: ArtifactRoleEntry[] = [];
  for (const item of raw) {
    const obj = asRecord(item);
    if (!obj) continue;
    const role = clean(obj.role) as ArtifactRoleName;
    const actor = clean(obj.actor);
    const actorKey = clean(obj.actor_key);
    const itemName = clean(obj.item);
    const itemKey = clean(obj.item_key);
    const quote = typeof obj.quote === "string" ? obj.quote.trim() : "";
    const sameObject = clean(obj.same_object) as ArtifactRoleEntry["sameObject"];
    if (
      !ROLE_NAMES.has(role) ||
      !actor ||
      !itemName ||
      !SNAKE_CASE.test(actorKey) ||
      !SNAKE_CASE.test(itemKey) ||
      quote.length < 6 ||
      !SAME_OBJECT.has(sameObject)
    ) {
      continue;
    }
    roles.push({ role, actor, actorKey, item: itemName, itemKey, quote, sameObject });
  }
  return { present: true, valid: true, roles };
}

function hasFinalConsonant(item: string): boolean {
  const last = item.trim().charCodeAt(item.trim().length - 1);
  if (last < 0xac00 || last > 0xd7a3) return false;
  return (last - 0xac00) % 28 !== 0;
}

function objectParticle(item: string): string {
  return hasFinalConsonant(item) ? "을" : "를";
}

function subjectParticle(item: string): string {
  return hasFinalConsonant(item) ? "이" : "가";
}

function roleSentence(role: ArtifactRoleName, actor: string, item: string): string {
  const particle = objectParticle(item);
  switch (role) {
    case "created":
      return `${actor}가 ${item}${particle} 만들었다.`;
    case "presented":
      return `${actor}가 ${item}${particle} 제시했다.`;
    case "took":
      return `${actor}가 ${item}${particle} 받아 들었다.`;
    case "wore":
      return `${actor}가 ${item}${particle} 착용했다.`;
    case "later_wore":
      return `${actor}가 다음 장면에서 ${item}${particle} 착용하고 있었다.`;
  }
}

const EXPLICIT_IDENTITY_QUOTE =
  /(?:같은|동일한|그 반지|그것과 같은|돌려|반환|건네받은 그|바로 그)/;

/**
 * A later wearer of the same display-name item is not proof of the same physical
 * object. If the prose never states identity, downgrade every over-confident
 * `confirmed` flag to `unconfirmed`; the ledger still owns current possession.
 */
function withIdentityGuard(roles: readonly ArtifactRoleEntry[]): ArtifactRoleEntry[] {
  const wearersByItem = new Map<string, Set<string>>();
  for (const entry of roles) {
    if (entry.role !== "wore" && entry.role !== "later_wore") continue;
    const set = wearersByItem.get(entry.itemKey) ?? new Set<string>();
    set.add(entry.actorKey);
    wearersByItem.set(entry.itemKey, set);
  }
  return roles.map((entry) => {
    const multipleWearers = (wearersByItem.get(entry.itemKey)?.size ?? 0) > 1;
    if (
      entry.role === "later_wore" &&
      (multipleWearers || entry.sameObject === "confirmed") &&
      !EXPLICIT_IDENTITY_QUOTE.test(entry.quote)
    ) {
      return { ...entry, sameObject: "unconfirmed" };
    }
    return entry;
  });
}

const ROLE_ACTION: Record<ArtifactRoleName, RegExp> = {
  created: /만들|만든|제작|가공|벼려|벼린|forge|forged|made|make/i,
  presented: /열어|열었|꺼내|내밀|건네|보여|제시|present|offer|showed|show/i,
  took: /집어\s*들|집어들|받아|받았|가져|took|take|received|receive/i,
  wore: /끼워|끼웠|끼었|착용|걸었|wore|wearing|put\s*on/i,
  later_wore: /끼고\s*있|끼고있|끼워져|착용하고\s*있|착용하고있|걸고\s*있|wore|wearing/i,
};

/**
 * Acceptance must be quoted, not inferred. A wearing quote proves the ring is
 * on a finger; it does not prove a proposal was accepted. A proposal itself
 * ("will you marry me", "결혼해 달라고 청했다") is not an acceptance.
 */
const ACCEPTANCE_FIELDS =
  /(?:proposal_outcome|proposal_result|relationship_response|response_to_proposal|acceptance|accepted)/i;
const ACCEPTANCE_CLAIM =
  /(?:수락|받아들|동의|승낙|허락|응했|응낙|결혼을\s*승낙|accepted|accepts|said\s+yes)/i;
const ACCEPTANCE_QUOTE =
  /(?:수락|받아들|동의|승낙|허락|응했|응낙|결혼하자|결혼해\s*주|고개를\s*끄덕|끄덕였|끄덕인|그래|좋아|Yes|I do|I will|accept|agreed)/i;

const PROPOSAL_CLAIM =
  /(?:proposal|propose|프러포즈|청혼|결혼해\s*달|결혼하자|사귀자|연인이\s*되|marry\s+me)/i;
const PROPOSAL_QUOTE =
  /(?:프러포즈|청혼|결혼해\s*달|결혼하자|결혼해\s*줄|사귀자|사귀어|연인이\s*되|marry\s+me|propose|proposal|무릎을\s*꿇|반지를\s*내밀|상을\s*열)/i;

const CONTAINER_ITEM = /^(?:상자|박스|케이스|box|case)$/i;
const SUBJECT_PARTICLE = /^(?:은|는|이|가|께서|와|과)/;
const PRONOUN_START = /^(?:그는|그녀는|그가|그녀가|그것은|그것이|그|그녀)/;

function normalizeQuote(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

const LOCAL_CONTEXT_CHARS = 700;

function sentenceStartBefore(text: string, idx: number): number {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (/[.!?。！？\n]/.test(text[i]!)) return i + 1;
  }
  return 0;
}

function sentenceEndAfter(text: string, idx: number): number {
  const rest = text.slice(idx);
  const match = rest.match(/[.!?。！？\n]/);
  return match && match.index != null ? idx + match.index + 1 : text.length;
}

function skipWhitespace(text: string, idx: number): number {
  let i = idx;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  return i;
}

/**
 * The quote's own sentence plus the adjacent next sentence. T80 separates the
 * presentation sentence from the ring reveal with a blank line, so paragraph
 * boundaries are not a hard stop here. The character cap keeps an unrelated
 * later ring from satisfying the window.
 */
function quoteItemWindow(prose: string, quote: string): string | null {
  const idx = prose.indexOf(quote);
  if (idx < 0) return null;
  const start = sentenceStartBefore(prose, idx);
  const sentenceEnd = sentenceEndAfter(prose, idx + quote.length);
  const nextStart = skipWhitespace(prose, sentenceEnd);
  const nextEnd = nextStart >= prose.length ? sentenceEnd : sentenceEndAfter(prose, nextStart);
  const end = Math.min(prose.length, idx + quote.length + LOCAL_CONTEXT_CHARS, Math.max(nextEnd, sentenceEnd));
  return prose.slice(start, end);
}

function actorFirstToken(actor: string): string {
  return actor.trim().split(/\s+/)[0] ?? actor.trim();
}

function collectActorNames(
  roles: readonly ArtifactRoleEntry[],
  extraActorNames: readonly string[] = []
): string[] {
  const names = new Set<string>();
  const add = (value: string) => {
    const full = value.replace(/\s+/g, " ").trim();
    if (!full) return;
    names.add(full);
    names.add(actorFirstToken(full));
  };
  for (const role of roles) add(role.actor);
  for (const name of extraActorNames) add(name);
  return [...names].sort((a, b) => b.length - a.length);
}

function firstKnownActor(text: string, names: readonly string[]): string | null {
  let best: { name: string; index: number } | null = null;
  for (const name of names) {
    const index = text.indexOf(name);
    if (index < 0) continue;
    if (!best || index < best.index) best = { name, index };
  }
  return best?.name ?? null;
}

/**
 * Resolve the antecedent of a pronoun quote. Korean topic/subject continuity is
 * used: the nearest preceding sentence with a unique subject-marked actor wins.
 * Two subject-marked actors ("오스카와 제이는 ...") or no named antecedent are
 * ambiguous and are rejected rather than guessed.
 */
function resolvePronounActor(
  prose: string,
  quoteIndex: number,
  names: readonly string[]
): string | null {
  const preceding = prose.slice(
    Math.max(0, quoteIndex - LOCAL_CONTEXT_CHARS),
    quoteIndex
  );
  const sentences = preceding
    .split(/(?<=[.!?。！？\n])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .reverse();
  for (const sentence of sentences.slice(0, 4)) {
    const subjects = new Set<string>();
    const mentioned = new Set<string>();
    for (const name of names) {
      let from = 0;
      while (from <= sentence.length) {
        const index = sentence.indexOf(name, from);
        if (index < 0) break;
        from = index + name.length;
        const key = actorFirstToken(name);
        mentioned.add(key);
        if (SUBJECT_PARTICLE.test(sentence.slice(index + name.length))) {
          subjects.add(key);
        }
      }
    }
    if (subjects.size === 1) return [...subjects][0] ?? null;
    if (subjects.size > 1) return null;
    if (mentioned.size === 1) return [...mentioned][0] ?? null;
    if (mentioned.size > 1) return null;
  }
  return null;
}

export type ArtifactRoleQuoteValidation = {
  ok: boolean;
  reason:
    | "ok"
    | "quote_not_in_prose"
    | "role_action_missing"
    | "actor_missing"
    | "actor_mismatch"
    | "ambiguous_pronoun"
    | "item_missing"
    | "container_not_artifact";
};

/**
 * A verbatim quote proves only that the text exists. For an artifact role it
 * must also contain the role action, the item, and an actor that the quote (or
 * its local antecedent) actually attributes the action to. This rejects a real
 * quote used for the wrong actor, an unresolvable pronoun, a box opening with
 * no artifact, and a container used as the artifact.
 */
export function validateArtifactRoleQuote(
  entry: ArtifactRoleEntry,
  prose: string,
  actorNames: readonly string[]
): ArtifactRoleQuoteValidation {
  // The evidence verifier matches normalized whitespace; a quote may legally
  // span a paragraph break. Validate against the same normalized form.
  const normalizedProse = prose.replace(/\s+/g, " ").trim();
  const normalizedQuote = normalizeQuote(entry.quote);
  const quoteIndex = normalizedProse.indexOf(normalizedQuote);
  if (quoteIndex < 0) {
    return { ok: false, reason: "quote_not_in_prose" };
  }
  if (!ROLE_ACTION[entry.role].test(entry.quote)) {
    return { ok: false, reason: "role_action_missing" };
  }
  const itemHead =
    entry.item.trim().split(/\s+/).pop()?.replace(/[^\p{L}\p{N}]/gu, "") ?? "";
  if (!itemHead || CONTAINER_ITEM.test(itemHead)) {
    return { ok: false, reason: "container_not_artifact" };
  }
  const itemWindow = quoteItemWindow(normalizedProse, normalizedQuote);
  if (!itemWindow || !itemWindow.includes(itemHead)) {
    return { ok: false, reason: "item_missing" };
  }
  const namedInQuote = firstKnownActor(normalizedQuote, actorNames);
  if (namedInQuote) {
    if (actorFirstToken(namedInQuote) !== actorFirstToken(entry.actor)) {
      return { ok: false, reason: "actor_mismatch" };
    }
    return { ok: true, reason: "ok" };
  }
  if (!PRONOUN_START.test(normalizedQuote)) {
    // A passive item description ("...만든 은빛 반지가 반짝이고 있었다") has no
    // grammatical subject; the nearest scene actor still has to match.
    const antecedent = resolvePronounActor(normalizedProse, quoteIndex, actorNames);
    if (!antecedent) return { ok: false, reason: "actor_missing" };
    return actorFirstToken(antecedent) === actorFirstToken(entry.actor)
      ? { ok: true, reason: "ok" }
      : { ok: false, reason: "actor_mismatch" };
  }
  const antecedent = resolvePronounActor(normalizedProse, quoteIndex, actorNames);
  if (!antecedent) return { ok: false, reason: "ambiguous_pronoun" };
  return actorFirstToken(antecedent) === actorFirstToken(entry.actor)
    ? { ok: true, reason: "ok" }
    : { ok: false, reason: "actor_mismatch" };
}

export function isValidArtifactRoleQuote(
  entry: ArtifactRoleEntry,
  prose: string,
  actorNames: readonly string[]
): boolean {
  return validateArtifactRoleQuote(entry, prose, actorNames).ok;
}

function unsupportedAcceptanceFact(fact: EpisodicExtractedFact): boolean {
  const quote = fact.evidence?.source_quote ?? "";
  if (ACCEPTANCE_QUOTE.test(quote)) return false;
  if (ACCEPTANCE_FIELDS.test(`${fact.attribute ?? ""} ${fact.value ?? ""}`)) return true;
  return ACCEPTANCE_CLAIM.test(fact.fact_text ?? "");
}

/**
 * A proposal fact must quote the proposal itself (or its immediate action), not
 * a venue or mood sentence. Without this, a real but unrelated quote can carry
 * a proposal claim into the ledger.
 */
function unsupportedProposalFact(fact: EpisodicExtractedFact): boolean {
  const quote = fact.evidence?.source_quote ?? "";
  // An explicitly quoted acceptance already proves the proposal's outcome.
  if (ACCEPTANCE_QUOTE.test(quote)) return false;
  if (
    !PROPOSAL_CLAIM.test(
      `${fact.attribute ?? ""} ${fact.value ?? ""} ${fact.fact_text ?? ""}`
    )
  ) {
    return false;
  }
  return !PROPOSAL_QUOTE.test(quote);
}

function importanceRank(fact: EpisodicExtractedFact): number {
  return fact.importance === "critical" ? 3 : fact.importance === "important" ? 2 : 1;
}

function freeFactPriority(fact: EpisodicExtractedFact): number {
  if (fact.category === "relationship" || fact.category === "character" || fact.category === "quest" || fact.category === "rule") return 0;
  if (fact.category === "item") return 2;
  return 1;
}

export function artifactRolesToEpisodicFacts(
  roles: readonly ArtifactRoleEntry[],
  prose?: string,
  extraActorNames: readonly string[] = []
): EpisodicExtractedFact[] {
  const actorNames = collectActorNames(roles, extraActorNames);
  const validRoles = prose
    ? roles.filter((entry) => isValidArtifactRoleQuote(entry, prose, actorNames))
    : roles;
  // Only a later-scene wearer can create same-name ambiguity. Normalize earlier
  // roles so a model's blanket `unconfirmed` does not add noise to every fact.
  const scopedRoles = validRoles.map((entry) =>
    entry.role === "later_wore" ? entry : { ...entry, sameObject: "not_applicable" as const }
  );
  return withIdentityGuard(scopedRoles).map((entry) => {
    const uncertainty =
      entry.sameObject === "unconfirmed"
        ? ` 두 장면의 ${entry.item}${subjectParticle(entry.item)} 같은 물건인지는 확인되지 않는다.`
        : "";
    return {
      category: "item",
      subject: entry.actorKey,
      attribute: ROLE_ATTRIBUTE[entry.role],
      value: entry.itemKey,
      importance: ROLE_IMPORTANCE[entry.role],
      fact_text: `${roleSentence(entry.role, entry.actor, entry.item)}${uncertainty}`,
      evidence_type: "explicit_scene_event",
      evidence: { source_role: "assistant", source_quote: entry.quote },
    };
  });
}

function factKey(fact: EpisodicExtractedFact): string {
  return `${fact.category}:${fact.subject}:${fact.attribute}:${fact.value}`;
}

/**
 * Artifact roles are preserved, but important non-item events (proposal,
 * acceptance when explicitly quoted, relationship progress) must not be
 * crowded out. The artifact path has a bounded seven-fact allowance: five
 * roles plus up to two important free-form facts. Normal episodic turns keep
 * the three-fact cap.
 */
export function mergeArtifactRolesIntoEpisodic(
  episodic: EpisodicSectionParse | null | undefined,
  roles: ArtifactRolesParse | null | undefined,
  prose?: string,
  extraActorNames: readonly string[] = []
): EpisodicSectionParse | null {
  if (!roles?.valid || roles.roles.length === 0) return episodic ?? null;
  const roleFacts = artifactRolesToEpisodicFacts(roles.roles, prose, extraActorNames);
  if (roleFacts.length === 0) return episodic ?? null;
  const existing = episodic?.present && episodic.valid ? episodic.facts : [];
  const roleQuotes = new Set(
    roleFacts.map((fact) => normalizeQuote(fact.evidence?.source_quote))
  );
  const freeFacts = existing
    .filter((fact) => {
      const quote = normalizeQuote(fact.evidence?.source_quote);
      if (quote && roleQuotes.has(quote)) return false;
      if (unsupportedAcceptanceFact(fact)) return false;
      return !unsupportedProposalFact(fact);
    })
    .sort(
      (a, b) =>
        freeFactPriority(a) - freeFactPriority(b) ||
        importanceRank(b) - importanceRank(a)
    );
  const seen = new Set<string>();
  const merged: EpisodicExtractedFact[] = [];
  for (const fact of [...roleFacts, ...freeFacts]) {
    const key = factKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(fact);
    if (merged.length >= 7) break;
  }
  return {
    present: true,
    valid: true,
    facts: merged,
    rawFactCount: episodic?.rawFactCount ?? merged.length,
    factLimit: 7,
  };
}
