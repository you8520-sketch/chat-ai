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

export function artifactRolesToEpisodicFacts(
  roles: readonly ArtifactRoleEntry[]
): EpisodicExtractedFact[] {
  return withIdentityGuard(roles).map((entry) => {
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
 * Artifact-role facts are placed first so the per-turn fact cap never drops a
 * role in favor of a lower-priority ceremony gloss. The existing persistence
 * writer still verifies every quote and applies the ledger-owned filters.
 */
export function mergeArtifactRolesIntoEpisodic(
  episodic: EpisodicSectionParse | null | undefined,
  roles: ArtifactRolesParse | null | undefined
): EpisodicSectionParse | null {
  if (!roles?.valid || roles.roles.length === 0) return episodic ?? null;
  const roleFacts = artifactRolesToEpisodicFacts(roles.roles);
  if (roleFacts.length === 0) return episodic ?? null;
  const existing = episodic?.present && episodic.valid ? episodic.facts : [];
  const seen = new Set<string>();
  const merged: EpisodicExtractedFact[] = [];
  for (const fact of [...roleFacts, ...existing]) {
    const key = factKey(fact);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(fact);
    if (merged.length >= 5) break;
  }
  return {
    present: true,
    valid: true,
    facts: merged,
    rawFactCount: episodic?.rawFactCount ?? merged.length,
    factLimit: 5,
  };
}
