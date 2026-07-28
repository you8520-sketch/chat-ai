import type { PersonaSecretRow } from "@/lib/personaSecretDiscoveryTypes";
import type {
  CompiledPersonaSecret,
  SecretDiffAction,
  SecretStableDiff,
} from "@/lib/personaSecretCompilerTypes";

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function quoteOverlap(a: string[], b: string): number {
  const bn = norm(b);
  let best = 0;
  for (const q of a) {
    const qn = norm(q);
    if (!qn) continue;
    if (bn.includes(qn) || qn.includes(bn)) {
      best = Math.max(best, Math.min(qn.length, bn.length));
    }
  }
  return best;
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(norm(a).split(/[^a-z0-9가-힣]+/).filter((t) => t.length >= 2));
  const tb = new Set(norm(b).split(/[^a-z0-9가-힣]+/).filter((t) => t.length >= 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Match compiled secrets to existing rows without wipe/recreate.
 * Priority: semanticKey → source quote → category+fact → jaccard → new.
 */
export function diffCompiledPersonaSecrets(
  existing: PersonaSecretRow[],
  compiled: CompiledPersonaSecret[]
): SecretStableDiff {
  const actions: SecretDiffAction[] = [];
  const warnings: string[] = [];
  const usedExisting = new Set<string>();

  for (const c of compiled) {
    // 1. semanticKey
    let match = existing.find(
      (e) => !usedExisting.has(e.id) && e.secret_key === c.semanticKey
    );

    // 2. prior source quote (canonical often equals prior quote)
    if (!match) {
      let best: { row: PersonaSecretRow; score: number } | null = null;
      for (const e of existing) {
        if (usedExisting.has(e.id)) continue;
        const score = Math.max(
          quoteOverlap(c.sourceQuotes, e.canonical_secret_text),
          quoteOverlap(c.sourceQuotes, e.confirmed_fact_text)
        );
        if (score >= 8 && (!best || score > best.score)) best = { row: e, score };
      }
      if (best) match = best.row;
    }

    // 3. category + normalized confirmed fact
    if (!match) {
      match = existing.find(
        (e) =>
          !usedExisting.has(e.id) &&
          e.category === c.category &&
          norm(e.confirmed_fact_text) === norm(c.confirmedFactText)
      );
    }

    // 4. high-confidence semantic jaccard
    if (!match) {
      let best: { row: PersonaSecretRow; score: number } | null = null;
      for (const e of existing) {
        if (usedExisting.has(e.id)) continue;
        if (e.category !== c.category && e.category !== "OTHER" && c.category !== "OTHER") {
          continue;
        }
        const score = Math.max(
          tokenJaccard(e.canonical_secret_text, c.canonicalSecretText),
          tokenJaccard(e.confirmed_fact_text, c.confirmedFactText)
        );
        if (score >= 0.72 && (!best || score > best.score)) best = { row: e, score };
      }
      if (best) {
        match = best.row;
        warnings.push(`semantic_match:${match.secret_key}->${c.semanticKey}`);
      }
    }

    if (!match) {
      actions.push({ kind: "create", compiled: c });
      continue;
    }

    usedExisting.add(match.id);
    const unchanged =
      match.secret_key === c.semanticKey &&
      match.canonical_secret_text === c.canonicalSecretText &&
      match.confirmed_fact_text === c.confirmedFactText &&
      match.suspected_fact_text === c.suspectedFactText &&
      match.owner_title === c.title &&
      match.category === c.category &&
      match.importance === c.importance &&
      match.is_active === 1;

    if (unchanged) {
      actions.push({ kind: "keep", existingId: match.id, compiled: c });
    } else {
      if (match.secret_key !== c.semanticKey) {
        warnings.push(`key_remap:${match.secret_key}->${c.semanticKey}`);
      }
      actions.push({ kind: "update", existingId: match.id, compiled: c });
    }
  }

  for (const e of existing) {
    if (usedExisting.has(e.id)) continue;
    if (e.is_active !== 1) continue;
    actions.push({
      kind: "inactivate",
      existingId: e.id,
      reason: "missing_from_compilation",
    });
    warnings.push(`inactivate:${e.secret_key}`);
  }

  // Split/merge heuristic warnings
  const created = actions.filter((a) => a.kind === "create").length;
  const inactivated = actions.filter((a) => a.kind === "inactivate").length;
  if (created > 0 && inactivated > 0) {
    warnings.push("possible_split_or_merge");
  }

  return { actions, warnings };
}
