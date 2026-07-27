import {
  COMPILER_CATEGORIES,
  COMPILER_EVIDENCE_KINDS,
  COMPILER_IMPORTANCE,
  COMPILER_MAX_ALIASES_PER_SECRET,
  COMPILER_MAX_DISCOVERY_RULES_PER_SECRET,
  COMPILER_MAX_SECRETS,
  COMPILER_METHODS,
  COMPILER_MIN_ALIAS_CHARS,
  PERSONA_SECRET_COMPILER_VERSION,
  PERSONA_SECRET_OUTPUT_SCHEMA_VERSION,
} from "@/lib/personaSecretCompilerCatalog";
import type {
  CompiledDiscoveryRule,
  CompiledPersonaSecret,
  CompilerValidationResult,
  PersonaSecretCompilerResult,
} from "@/lib/personaSecretCompilerTypes";
import { sanitizeRevealedFactForPrompt } from "@/lib/personaSecretReveal";

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function includesQuote(source: string, quote: string): boolean {
  const q = quote.trim();
  if (!q) return false;
  if (source.includes(q)) return true;
  // Allow quote with collapsed whitespace against normalized source.
  return normalizeWs(source).includes(normalizeWs(q));
}

function isAllowedEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function validateDiscoveryRule(
  raw: unknown,
  source: string
): CompiledDiscoveryRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isAllowedEnum(o.method, COMPILER_METHODS)) return null;
  const ruleKey = String(o.ruleKey ?? o.rule_key ?? "").trim();
  if (!ruleKey) return null;
  const resultState = o.resultState === "SUSPECTED" ? "SUSPECTED" : "CONFIRMED";
  const revealedFactText = sanitizeRevealedFactForPrompt(
    String(o.revealedFactText ?? o.revealed_fact_text ?? "")
  );
  if (!revealedFactText) return null;
  const kindsRaw = Array.isArray(o.evidenceKinds)
    ? o.evidenceKinds
    : Array.isArray(o.evidence_kinds)
      ? o.evidence_kinds
      : [];
  const evidenceKinds = kindsRaw
    .map((k) => String(k))
    .filter((k): k is (typeof COMPILER_EVIDENCE_KINDS)[number] =>
      isAllowedEnum(k, COMPILER_EVIDENCE_KINDS)
    );
  if (evidenceKinds.length === 0) return null;
  if (evidenceKinds.length !== kindsRaw.length) return null;
  const dormant =
    o.method === "DIRECT_DISCLOSURE" ? false : o.dormant !== false;
  return {
    method: o.method,
    ruleKey,
    resultState,
    revealedFactText,
    evidenceKinds,
    dormant,
    conditions:
      o.conditions && typeof o.conditions === "object" && !Array.isArray(o.conditions)
        ? (o.conditions as Record<string, unknown>)
        : {},
  };
}

function validateSecret(
  raw: unknown,
  source: string
): CompiledPersonaSecret | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const sourceQuotes = Array.isArray(o.sourceQuotes)
    ? o.sourceQuotes.map((q) => String(q ?? "").trim()).filter(Boolean)
    : Array.isArray(o.source_quotes)
      ? o.source_quotes.map((q) => String(q ?? "").trim()).filter(Boolean)
      : [];
  if (sourceQuotes.length === 0) return null;
  if (!sourceQuotes.every((q) => includesQuote(source, q))) return null;

  const semanticKey = String(o.semanticKey ?? o.semantic_key ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(semanticKey)) return null;
  if (!isAllowedEnum(o.category, COMPILER_CATEGORIES)) return null;
  if (!isAllowedEnum(o.importance ?? "NORMAL", COMPILER_IMPORTANCE)) return null;

  const canonicalSecretText = String(
    o.canonicalSecretText ?? o.canonical_secret_text ?? ""
  ).trim();
  const confirmedFactText = sanitizeRevealedFactForPrompt(
    String(o.confirmedFactText ?? o.confirmed_fact_text ?? "")
  );
  const suspectedFactText = sanitizeRevealedFactForPrompt(
    String(o.suspectedFactText ?? o.suspected_fact_text ?? "")
  );
  if (!canonicalSecretText || !confirmedFactText) return null;

  // Facts must not introduce text absent from quotes/source (grounding).
  // Soft check: confirmed fact tokens should largely appear in joined quotes.
  const quoteBlob = sourceQuotes.join(" ");
  if (
    confirmedFactText.length > 0 &&
    !includesQuote(source, confirmedFactText) &&
    !normalizeWs(quoteBlob).includes(normalizeWs(confirmedFactText).slice(0, 12))
  ) {
    // Allow paraphrased confirmed facts that still use quote substrings of length >= 4
    const significant = confirmedFactText
      .split(/[\s,./·]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    const grounded = significant.filter(
      (t) => quoteBlob.includes(t) || source.includes(t)
    );
    if (grounded.length < Math.min(2, significant.length)) return null;
  }

  const aliasesRaw = Array.isArray(o.directDisclosureAliases)
    ? o.directDisclosureAliases
    : Array.isArray(o.direct_disclosure_aliases)
      ? o.direct_disclosure_aliases
      : [];
  const directDisclosureAliases = aliasesRaw
    .map((a) => String(a ?? "").trim())
    .filter((a) => a.length >= COMPILER_MIN_ALIAS_CHARS)
    .slice(0, COMPILER_MAX_ALIASES_PER_SECRET);

  const rulesRaw = Array.isArray(o.discoveryRules)
    ? o.discoveryRules
    : Array.isArray(o.discovery_rules)
      ? o.discovery_rules
      : [];
  const discoveryRules: CompiledDiscoveryRule[] = [];
  for (const r of rulesRaw.slice(0, COMPILER_MAX_DISCOVERY_RULES_PER_SECRET)) {
    const rule = validateDiscoveryRule(r, source);
    if (!rule) return null;
    discoveryRules.push(rule);
  }
  if (!discoveryRules.some((r) => r.method === "DIRECT_DISCLOSURE")) {
    discoveryRules.unshift({
      method: "DIRECT_DISCLOSURE",
      ruleKey: "default",
      resultState: "CONFIRMED",
      revealedFactText: confirmedFactText,
      evidenceKinds: ["USER_EXPLICIT_DISCLOSURE"],
      dormant: false,
      conditions: {},
    });
  }

  return {
    sourceQuotes,
    semanticKey,
    title: String(o.title ?? "").trim().slice(0, 80) || semanticKey,
    category: o.category,
    canonicalSecretText: canonicalSecretText.slice(0, 800),
    suspectedFactText: suspectedFactText.slice(0, 400),
    confirmedFactText: confirmedFactText.slice(0, 400),
    importance: (o.importance as CompiledPersonaSecret["importance"]) || "NORMAL",
    directDisclosureAliases,
    discoveryRules: discoveryRules.slice(0, COMPILER_MAX_DISCOVERY_RULES_PER_SECRET),
    dependencies: Array.isArray(o.dependencies)
      ? o.dependencies.map((d) => String(d)).filter(Boolean).slice(0, 8)
      : [],
    confidence: Math.max(0, Math.min(1, Number(o.confidence ?? 0.7))),
    needsReview: Boolean(o.needsReview ?? o.needs_review ?? false),
    warnings: Array.isArray(o.warnings)
      ? o.warnings.map((w) => String(w)).filter(Boolean).slice(0, 12)
      : [],
  };
}

/**
 * Deterministic schema + grounding validator.
 * Rejects invented evidence kinds, missing quotes, invalid enums, empty non-empty-source results.
 */
export function validatePersonaSecretCompilerResult(
  value: unknown,
  sourceRaw: string
): CompilerValidationResult {
  const source = sourceRaw.replace(/\r\n?/g, "\n").trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errorCode: "INVALID_JSON", message: "compiler result must be an object" };
  }
  const o = value as Record<string, unknown>;
  const secretsRaw = Array.isArray(o.secrets) ? o.secrets : null;
  if (!secretsRaw) {
    return { ok: false, errorCode: "MISSING_SECRETS", message: "secrets array required" };
  }
  if (source && secretsRaw.length === 0) {
    return {
      ok: false,
      errorCode: "EMPTY_RESULT",
      message: "non-empty source must not compile to zero secrets",
    };
  }
  if (secretsRaw.length > COMPILER_MAX_SECRETS) {
    return {
      ok: false,
      errorCode: "TOO_MANY_SECRETS",
      message: `secrets exceed ${COMPILER_MAX_SECRETS}`,
    };
  }

  const secrets: CompiledPersonaSecret[] = [];
  const seenKeys = new Set<string>();
  for (const raw of secretsRaw) {
    const secret = validateSecret(raw, source);
    if (!secret) {
      return {
        ok: false,
        errorCode: "SECRET_VALIDATION_FAILED",
        message: "a compiled secret failed grounding/schema validation",
      };
    }
    if (seenKeys.has(secret.semanticKey)) {
      return {
        ok: false,
        errorCode: "DUPLICATE_SEMANTIC_KEY",
        message: `duplicate semanticKey: ${secret.semanticKey}`,
      };
    }
    seenKeys.add(secret.semanticKey);
    secrets.push(secret);
  }

  const unresolvedFragments = Array.isArray(o.unresolvedFragments)
    ? o.unresolvedFragments.map((f) => String(f)).filter(Boolean).slice(0, 20)
    : Array.isArray(o.unresolved_fragments)
      ? o.unresolved_fragments.map((f) => String(f)).filter(Boolean).slice(0, 20)
      : [];

  const result: PersonaSecretCompilerResult = {
    schemaVersion:
      Number(o.schemaVersion ?? o.schema_version) || PERSONA_SECRET_OUTPUT_SCHEMA_VERSION,
    compilerVersion:
      Number(o.compilerVersion ?? o.compiler_version) || PERSONA_SECRET_COMPILER_VERSION,
    secrets,
    unresolvedFragments,
    warnings: Array.isArray(o.warnings)
      ? o.warnings.map((w) => String(w)).filter(Boolean).slice(0, 30)
      : [],
  };

  return { ok: true, result };
}
