/**
 * Canonical owner for cast relationship targets (`bible.otherRelationships`).
 *
 * - Every persisted target is the canonical full name of exactly one current
 *   cast member. Aliases (given name, spacing variants) resolve only when they
 *   point at a single member; a shared alias is ambiguous and rejected.
 * - Self links, removed characters, unknown names and duplicate links to the
 *   same person (alias + full name) are rejected.
 * - After a slot replacement, kept characters gain a minimal PUBLIC awareness
 *   of a new character that publicly declared a tie to them. privateOpinion /
 *   hidden are never invented and never forced to be reciprocal.
 */
import type { OfficialCharacterBible } from "@/lib/officialSupply/bible";
import { qaResult, type QaIssue, type QaResult } from "@/lib/officialSupply/types";

export type CastIdentity = { draftKey: string; name: string };
export type CastRelationship = OfficialCharacterBible["otherRelationships"][number];

export type RelationshipIssueCode =
  | "relationship_self"
  | "relationship_unknown_target"
  | "relationship_removed_target"
  | "relationship_ambiguous_alias"
  | "relationship_duplicate_target"
  | "relationship_not_canonical"
  | "relationship_replacement_one_way";

export type ResolvedRelationshipTarget =
  | { ok: true; draftKey: string; canonical: string; viaAlias: boolean }
  | { ok: false; code: Exclude<RelationshipIssueCode, "relationship_duplicate_target" | "relationship_not_canonical" | "relationship_replacement_one_way">; message: string };

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const compact = (s: string) => s.replace(/\s+/g, "");

/**
 * Aliases a sheet may use for a cast member: the full name, the full name
 * without spaces, and the given name (first token) of a multi-token name.
 * Resolution checks each alias against EVERY member, so a given name shared by
 * two members never resolves.
 */
export function castAliases(name: string): string[] {
  const full = normalize(name);
  const tokens = full.split(" ");
  const aliases = new Set([full, compact(full)]);
  if (tokens.length > 1) aliases.add(tokens[0]!);
  return [...aliases];
}

export function resolveOfficialCastRelationshipTarget(
  target: string,
  ctx: { cast: readonly CastIdentity[]; selfDraftKey: string; removedNames?: readonly string[] }
): ResolvedRelationshipTarget {
  const t = normalize(target);
  const exact = ctx.cast.filter((m) => normalize(m.name) === t || compact(m.name) === compact(t));
  const byAlias = exact.length ? exact : ctx.cast.filter((m) => castAliases(m.name).includes(t));
  const removedHit = (ctx.removedNames ?? []).some((n) => castAliases(n).includes(t) || compact(n) === compact(t));
  if (byAlias.length === 0) {
    return removedHit
      ? { ok: false, code: "relationship_removed_target", message: `"${t}" is no longer in the cast` }
      : { ok: false, code: "relationship_unknown_target", message: `"${t}" matches no cast member` };
  }
  if (byAlias.length > 1 || (!exact.length && removedHit)) {
    const who = [...byAlias.map((m) => m.name), ...(removedHit ? ["(removed member)"] : [])];
    return { ok: false, code: "relationship_ambiguous_alias", message: `"${t}" could mean ${who.join(" / ")}` };
  }
  const member = byAlias[0]!;
  if (member.draftKey === ctx.selfDraftKey) {
    return { ok: false, code: "relationship_self", message: `"${t}" is the character itself` };
  }
  return { ok: true, draftKey: member.draftKey, canonical: normalize(member.name), viaAlias: exact.length === 0 };
}

export type RelationshipNormalization = {
  relationships: CastRelationship[];
  issues: (QaIssue & { code: RelationshipIssueCode })[];
  renamed: { from: string; to: string }[];
  dropped: { target: string; code: RelationshipIssueCode }[];
};

/**
 * Canonicalize one sheet's relationships. Self links and removed members are
 * dropped (deterministic cleanup); unknown / ambiguous / duplicate targets are
 * reported and kept out — the caller must refuse to persist when `issues` is
 * non-empty.
 */
export function normalizeOfficialCastRelationships(
  relationships: readonly CastRelationship[],
  ctx: { cast: readonly CastIdentity[]; selfDraftKey: string; removedNames?: readonly string[] }
): RelationshipNormalization {
  const out: CastRelationship[] = [];
  const issues: RelationshipNormalization["issues"] = [];
  const renamed: RelationshipNormalization["renamed"] = [];
  const dropped: RelationshipNormalization["dropped"] = [];
  const seen = new Map<string, string>();
  for (const rel of relationships) {
    const resolved = resolveOfficialCastRelationshipTarget(rel.target, ctx);
    if (!resolved.ok) {
      if (resolved.code === "relationship_self" || resolved.code === "relationship_removed_target") {
        dropped.push({ target: rel.target, code: resolved.code });
      } else {
        issues.push({ code: resolved.code, message: `${ctx.selfDraftKey}: ${resolved.message}` });
      }
      continue;
    }
    const previous = seen.get(resolved.draftKey);
    if (previous !== undefined) {
      issues.push({
        code: "relationship_duplicate_target",
        message: `${ctx.selfDraftKey}: "${previous}" and "${rel.target}" are both ${resolved.canonical}`,
      });
      continue;
    }
    seen.set(resolved.draftKey, rel.target);
    if (rel.target !== resolved.canonical) renamed.push({ from: rel.target, to: resolved.canonical });
    out.push({ ...rel, target: resolved.canonical });
  }
  return { relationships: out, issues, renamed, dropped };
}

export type CastRelationshipEntry = CastIdentity & { relationships: readonly CastRelationship[] };

export type CastRelationshipGraphStats = {
  edges: number;
  oneWay: [string, string][];
  oneWayPublicFromReplaced: [string, string][];
};

/**
 * Portfolio relationship QA over persisted data: every target canonical and
 * valid, and no replaced character left publicly tied to a kept one that does
 * not know them. General asymmetry is reported, never forced.
 */
export function evaluateCastRelationshipGraph(
  entries: readonly CastRelationshipEntry[],
  opts: { removedNames?: readonly string[]; replacedDraftKeys?: readonly string[] } = {}
): QaResult & { stats: CastRelationshipGraphStats } {
  const errors: QaIssue[] = [];
  const cast = entries.map((e) => ({ draftKey: e.draftKey, name: e.name }));
  const edges = new Set<string>();
  const byKey = new Map(entries.map((e) => [e.draftKey, e] as const));
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const rel of entry.relationships) {
      const resolved = resolveOfficialCastRelationshipTarget(rel.target, {
        cast,
        selfDraftKey: entry.draftKey,
        removedNames: opts.removedNames,
      });
      if (!resolved.ok) {
        errors.push({ code: resolved.code, message: `${entry.draftKey}: ${resolved.message}` });
        continue;
      }
      if (rel.target !== resolved.canonical) {
        errors.push({ code: "relationship_not_canonical", message: `${entry.draftKey}: "${rel.target}" should be "${resolved.canonical}"` });
      }
      if (seen.has(resolved.draftKey)) {
        errors.push({ code: "relationship_duplicate_target", message: `${entry.draftKey}: two links to ${resolved.canonical}` });
      }
      seen.add(resolved.draftKey);
      edges.add(`${entry.draftKey}>${resolved.draftKey}`);
    }
  }
  const oneWay: [string, string][] = [];
  for (const edge of edges) {
    const [from, to] = edge.split(">") as [string, string];
    if (!edges.has(`${to}>${from}`)) oneWay.push([from, to]);
  }
  const replaced = new Set(opts.replacedDraftKeys ?? []);
  const oneWayPublicFromReplaced = oneWay.filter(([from, to]) => {
    if (!replaced.has(from) || replaced.has(to)) return false;
    const rel = byKey.get(from)!.relationships.find((r) => normalize(r.target) === normalize(byKey.get(to)!.name));
    return Boolean(rel?.public.trim());
  });
  for (const [from, to] of oneWayPublicFromReplaced) {
    errors.push({
      code: "relationship_replacement_one_way",
      message: `${to} does not know replaced ${from}, although ${from} declares a public tie`,
    });
  }
  return { ...qaResult(errors), stats: { edges: edges.size, oneWay, oneWayPublicFromReplaced } };
}

/**
 * Minimal public awareness for kept characters of a replaced character that
 * publicly declared a tie to them. Built only from the replaced character's own
 * public role and its declared public tie; privateOpinion/hidden stay empty.
 */
export function reconcileReplacementPublicRelationships(
  entries: readonly (CastRelationshipEntry & { publicRole: string })[],
  replacedDraftKeys: readonly string[]
): Map<string, CastRelationship[]> {
  const replaced = new Set(replacedDraftKeys);
  const byKey = new Map(entries.map((e) => [e.draftKey, e] as const));
  const additions = new Map<string, CastRelationship[]>();
  for (const source of entries.filter((e) => replaced.has(e.draftKey))) {
    for (const rel of source.relationships) {
      const target = entries.find((e) => normalize(e.name) === normalize(rel.target));
      if (!target || replaced.has(target.draftKey) || !rel.public.trim()) continue;
      const knows = byKey
        .get(target.draftKey)!
        .relationships.some((r) => normalize(r.target) === normalize(source.name));
      if (knows) continue;
      const list = additions.get(target.draftKey) ?? [];
      list.push({
        target: normalize(source.name),
        public: `${source.publicRole}. 공개된 접점(${normalize(source.name)} 측): ${rel.public.trim()}`,
        privateOpinion: "",
        hidden: "",
      });
      additions.set(target.draftKey, list);
    }
  }
  return additions;
}
