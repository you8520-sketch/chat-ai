import { createHash } from "node:crypto";
import {
  COMPILER_MAX_SECRETS,
  COMPILER_MIN_ALIAS_CHARS,
  PERSONA_SECRET_COMPILER_VERSION,
  PERSONA_SECRET_OUTPUT_SCHEMA_VERSION,
  suggestedDiscoveryMethodsForCategory,
  suggestedEvidenceKinds,
  type CompilerCategory,
} from "@/lib/personaSecretCompilerCatalog";
import type {
  CompiledDiscoveryRule,
  CompiledPersonaSecret,
  PersonaSecretCompilerResult,
} from "@/lib/personaSecretCompilerTypes";

function slugify(text: string): string {
  const hangulHint = /이계|출신|문신|능력|부작용|빚|질병|정체|과거|조직|독|저주|계약/;
  const map: Record<string, string> = {
    이계: "otherworld",
    출신: "origin",
    문신: "tattoo",
    능력: "ability",
    부작용: "ability_cost",
    대가: "ability_cost",
    빚: "debt",
    질병: "illness",
    증상: "symptom",
    정체: "identity",
    과거: "past",
    조직: "affiliation",
    독: "poison",
    저주: "curse",
    계약: "pact",
  };
  for (const [k, v] of Object.entries(map)) {
    if (text.includes(k)) return v;
  }
  void hangulHint;
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return ascii || "secret";
}

function shortHash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 6);
}

function inferCategory(text: string): CompilerCategory {
  // Meaning / affiliation of a mark — keep distinct from mere mark existence.
  if (
    /(?:문신|흉터|표식|번호).{0,24}(?:의미|뜻|상징)/.test(text) ||
    /(?:의미|뜻|상징).{0,24}(?:문신|흉터|표식|번호)/.test(text) ||
    /연구소|피험자\s*번호/.test(text)
  ) {
    return "AFFILIATION";
  }
  if (/문신|흉터|점|낙인|낙서|신체\s*표시/.test(text)) return "BODY_MARK";
  if (/부작용|대가|반동|후유증/.test(text)) return "ABILITY_COST";
  if (/(?:정식\s*명칭|기술명|엘리시온|천공의\s*권능)/.test(text)) return "ABILITY";
  if (/능력|마법|권능|힘|초능력|중력|염력|순간\s*이동|텔레포트|화염|치유\s*능력/.test(text)) {
    return "ABILITY";
  }
  if (/빚|부채|돈|채무|사채/.test(text)) return "FINANCIAL";
  if (/병|질병|감염|독|증상|아픈/.test(text)) return "HEALTH";
  if (/범죄|살인|절도|불법/.test(text)) return "CRIME";
  if (/조직|소속|단원|세력/.test(text)) return "AFFILIATION";
  if (/가짜|위장|신분|정체/.test(text)) return "IDENTITY";
  if (/과거|예전에|그때|사건/.test(text)) return "PAST_EVENT";
  if (/이계|출신|고향|차원|다른\s*세계/.test(text)) return "ORIGIN";
  if (/가방|물건|아이템|유물|문서/.test(text)) return "ITEM";
  return "OTHER";
}

function inferImportance(category: CompilerCategory, text: string): CompiledPersonaSecret["importance"] {
  if (/정체|이계|출신|살인|계약/.test(text)) return "CRITICAL";
  if (category === "IDENTITY" || category === "ORIGIN" || category === "ABILITY") {
    return "IMPORTANT";
  }
  return "NORMAL";
}

/** Split free-form secret source into atomic candidate fragments. */
export function splitSecretSourceAtoms(source: string): string[] {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const atoms: string[] = [];
  for (const para of paragraphs) {
    // Sentence / clause boundaries that often mark separately discoverable facts.
    const parts = para
      .split(/(?<=[.!?。…])\s+|(?:\s*(?:하지만|또한|그리고|게다가|한편|다만)\s+)/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 4);

    if (parts.length <= 1) {
      atoms.push(...splitCompoundAtom(para));
      continue;
    }
    for (const part of parts) {
      atoms.push(...splitCompoundAtom(part));
    }
  }

  // Dedupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of atoms) {
    const key = a.replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.slice(0, COMPILER_MAX_SECRETS * 2);
}

/**
 * Further split known compound patterns into separately discoverable facts.
 */
function splitCompoundAtom(text: string): string[] {
  const t = text.trim();
  if (!t) return [];

  // Ability + cost/side-effect
  const abilityCost = t.match(
    /^(.+?(?:능력|권능|힘|마법).+?)(?:[,，]|\s+)(.+?(?:부작용|대가|반동|후유증).+)$/
  );
  if (abilityCost?.[1] && abilityCost[2]) {
    return [abilityCost[1].trim(), abilityCost[2].trim()];
  }

  // Mark existence + meaning
  const tattooMeaning = t.match(
    /^(.+?(?:문신|흉터|낙인).+?)(?:[,，]|\s+)(.+?(?:의미|뜻|상징|증거).+)$/
  );
  if (tattooMeaning?.[1] && tattooMeaning[2]) {
    return [tattooMeaning[1].trim(), tattooMeaning[2].trim()];
  }

  // Fake identity + true identity
  const fakeTrue = t.match(
    /^(.+?(?:가짜|위장|행세).+?)(?:[,，]|\s+)(.+?(?:진짜|실제|본래).+)$/
  );
  if (fakeTrue?.[1] && fakeTrue[2]) {
    return [fakeTrue[1].trim(), fakeTrue[2].trim()];
  }

  // Debt + cause
  const debtCause = t.match(
    /^(.+?(?:빚|부채|채무).+?)(?:[,，]|\s+)(.+?(?:때문|원인|이유로).+)$/
  );
  if (debtCause?.[1] && debtCause[2]) {
    return [debtCause[1].trim(), debtCause[2].trim()];
  }

  // Illness + symptom / cause
  const illness = t.match(
    /^(.+?(?:병|질병|감염).+?)(?:[,，]|\s+)(.+?(?:증상|원인|때문에).+)$/
  );
  if (illness?.[1] && illness[2]) {
    return [illness[1].trim(), illness[2].trim()];
  }

  return [t];
}

function buildAliases(quote: string): string[] {
  const compact = quote.replace(/\s+/g, " ").trim();
  const aliases = new Set<string>();
  if (compact.length >= COMPILER_MIN_ALIAS_CHARS) aliases.add(compact);
  // First-person variants when statement-like
  if (!/^(?:나|난|내가|나는|저|제가|저는)/.test(compact) && compact.length >= 8) {
    aliases.add(`나 사실 ${compact}`);
    aliases.add(`나는 ${compact}`);
  }
  return [...aliases]
    .filter((a) => a.length >= COMPILER_MIN_ALIAS_CHARS && a.length <= 80)
    .slice(0, 6);
}

function inferBodyRegionFromText(text: string): string | null {
  const t = text.replace(/\s+/g, "");
  if (/아랫등|허리뒤|등아래/.test(t)) return "lower_back";
  if (/등|등판|등쪽/.test(t)) return "upper_back";
  if (/팔뚝|아래팔/.test(t)) return "forearm";
  if (/손목|손/.test(t)) return "hand";
  if (/팔/.test(t)) return "forearm";
  if (/목|쇄골/.test(t)) return "neck";
  if (/어깨/.test(t)) return "shoulder";
  if (/가슴/.test(t)) return "chest";
  if (/허벅지/.test(t)) return "thigh";
  if (/다리/.test(t)) return "leg";
  return null;
}

function inferManifestationTags(text: string): string[] {
  const tags: string[] = [];
  if (/중력/.test(text)) tags.push("gravity_alteration");
  if (/치유|회복/.test(text)) tags.push("healing_manifestation");
  if (/불|화염/.test(text)) tags.push("fire_manifestation");
  if (/순간\s*이동|텔레포트/.test(text)) tags.push("teleportation");
  if (/투시/.test(text)) tags.push("clairvoyance");
  if (tags.length === 0 && /능력|권능|힘|마법/.test(text)) tags.push("ability_use");
  return tags.slice(0, 4);
}

function inferSymptomTags(text: string): string[] {
  const tags: string[] = [];
  if (/피|토혈|내상|출혈/.test(text)) tags.push("coughing_blood");
  if (/코피/.test(text)) tags.push("nosebleed");
  if (/열|발열/.test(text)) tags.push("fever");
  if (/떨|경련/.test(text)) tags.push("tremor");
  if (/쓰러|의식/.test(text)) tags.push("collapse");
  if (tags.length === 0) tags.push("coughing_blood");
  return tags.slice(0, 4);
}

function isInterpretiveSecret(text: string, category: CompilerCategory): boolean {
  if (category === "ABILITY_COST") return true;
  if (category === "AFFILIATION" && /문신|표식|번호|연구소/.test(text)) return true;
  if (/의미|뜻|상징|소속|연구소|정식|명칭|원인|때문|피험자/.test(text)) return true;
  return false;
}

function buildVisualConditions(
  category: CompilerCategory,
  evidenceKind: string,
  quote: string
): Record<string, unknown> {
  if (evidenceKind === "BODY_REGION_EXPOSED") {
    const region = inferBodyRegionFromText(quote);
    if (!region) return {};
    return {
      evidenceKind: "BODY_REGION_EXPOSED",
      region,
      minimumExposure: "CLEAR",
      resultState: isInterpretiveSecret(quote, category) ? "SUSPECTED" : "CONFIRMED",
    };
  }
  if (evidenceKind === "VISIBLE_MARK_SHOWN") {
    return {
      evidenceKind: "VISIBLE_MARK_SHOWN",
      markTags: [/문신/.test(quote) ? "문신" : /흉터/.test(quote) ? "흉터" : "표식"].filter(
        Boolean
      ),
      matchMode: "ANY",
      resultState: isInterpretiveSecret(quote, category) ? "SUSPECTED" : "CONFIRMED",
    };
  }
  if (evidenceKind === "ABILITY_MANIFESTED") {
    return {
      evidenceKind: "ABILITY_MANIFESTED",
      manifestationTags: inferManifestationTags(quote),
      matchMode: "ANY",
      resultState: "CONFIRMED",
    };
  }
  if (
    evidenceKind === "PHYSICAL_SYMPTOM_DISPLAYED" ||
    evidenceKind === "PHYSICAL_SYMPTOM_OBSERVED"
  ) {
    return {
      evidenceKind: "PHYSICAL_SYMPTOM_DISPLAYED",
      symptomTags: inferSymptomTags(quote),
      matchMode: "ANY",
      resultState: "SUSPECTED",
    };
  }
  if (
    evidenceKind === "VISIBLE_ITEM_PRESENTED" ||
    evidenceKind === "VISIBLE_ITEM_EXPOSED"
  ) {
    const item =
      quote.match(/(독촉장|편지|목걸이|반지|사진|열쇠|상자|지갑)/)?.[1] ?? "item";
    return {
      evidenceKind,
      itemTags: [item],
      matchMode: "ANY",
      resultState: isInterpretiveSecret(quote, category) ? "SUSPECTED" : "CONFIRMED",
    };
  }
  if (
    evidenceKind === "DOCUMENT_PRESENTED" ||
    evidenceKind === "IDENTITY_DOCUMENT_PRESENTED"
  ) {
    const doc =
      quote.match(/(계약서|결과지|진단서|서류|문서|처방전|신분증|여권)/)?.[1] ?? "문서";
    return {
      evidenceKind,
      documentTags: [doc],
      matchMode: "ANY",
      // Document presence only — content/meaning stays suspected or investigation.
      resultState: "SUSPECTED",
    };
  }
  return { evidenceKind };
}

function buildDiscoveryRules(
  category: CompilerCategory,
  quote: string,
  confirmedFactText: string,
  suspectedFactText: string
): CompiledDiscoveryRule[] {
  const methods = suggestedDiscoveryMethodsForCategory(category);
  const rules: CompiledDiscoveryRule[] = [];
  for (const method of methods.slice(0, 4)) {
    if (method === "DIRECT_DISCLOSURE") {
      rules.push({
        method,
        ruleKey: "default",
        resultState: "CONFIRMED",
        revealedFactText: confirmedFactText,
        evidenceKinds: suggestedEvidenceKinds(method, category),
        dormant: false,
        conditions: {},
      });
      continue;
    }

    if (method === "VISUAL_DISCOVERY") {
      // Interpretive secrets (meaning/cause/formal name) — no automatic visual unlock.
      if (
        isInterpretiveSecret(quote, category) &&
        category !== "ABILITY_COST" &&
        category !== "HEALTH"
      ) {
        continue;
      }
      const kinds = suggestedEvidenceKinds(method, category);
      for (const evidenceKind of kinds.slice(0, 2)) {
        const conditions = buildVisualConditions(category, evidenceKind, quote);
        if (!conditions.evidenceKind) continue;
        if (evidenceKind === "BODY_REGION_EXPOSED" && !conditions.region) continue;
        const resultState =
          conditions.resultState === "CONFIRMED" ? "CONFIRMED" : "SUSPECTED";
        const revealed =
          resultState === "SUSPECTED" && suspectedFactText
            ? suspectedFactText
            : confirmedFactText;
        rules.push({
          method,
          ruleKey: `visual_${evidenceKind.toLowerCase()}`,
          resultState,
          revealedFactText: revealed,
          evidenceKinds: [evidenceKind as (typeof kinds)[number]],
          dormant: true,
          conditions,
        });
      }
      continue;
    }

    // INVESTIGATION — dormant storage; runtime eligibility activates.
    const invList = buildInvestigationConditionVariants(category, quote);
    for (const inv of invList) {
      const resultState =
        inv.resultState === "SUSPECTED" ? "SUSPECTED" : "CONFIRMED";
      const revealed =
        resultState === "SUSPECTED" && suspectedFactText
          ? suspectedFactText
          : confirmedFactText;
      rules.push({
        method,
        ruleKey: `investigation_${String(inv.evidenceKind).toLowerCase()}`,
        resultState,
        revealedFactText: revealed,
        evidenceKinds: suggestedEvidenceKinds(method, category),
        dormant: true,
        conditions: inv,
      });
    }
  }
  return rules.slice(0, 4);
}

/**
 * Typed INVESTIGATION conditions. Never invents concrete targets/NPCs —
 * only resultType + tags derived from source quote atoms.
 */
function buildInvestigationConditionVariants(
  category: CompilerCategory,
  quote: string
): Record<string, unknown>[] {
  if (category === "FINANCIAL" || /빚|부채|채무|독촉/.test(quote)) {
    return [
      {
        evidenceKind: "DOCUMENT_CONTENT_VERIFIED",
        requiredTags: ["debt_notice", "debtor_identity_match"],
        matchMode: "ALL",
        minimumResultState: "PARTIAL",
        resultState: "CONFIRMED",
      },
      {
        evidenceKind: "DEBT_RECORD_CONFIRMED",
        requiredTags: ["debtor_identity_match"],
        matchMode: "ALL",
        minimumResultState: "VERIFIED",
        resultState: "CONFIRMED",
      },
    ];
  }

  // Mark *meaning* (often AFFILIATION via 연구소/피험자) — not mere mark presence.
  const isMarkMeaning =
    category === "BODY_MARK" ||
    ((category === "AFFILIATION" || category === "IDENTITY") &&
      /(?:문신|표식|번호|피험자)/.test(quote) &&
      /(?:의미|뜻|연구소|식별)/.test(quote)) ||
    (/(?:문신|표식)/.test(quote) && /(?:의미|피험자|연구소)/.test(quote));
  if (isMarkMeaning) {
    if (!isInterpretiveSecret(quote, category) && category === "BODY_MARK") {
      return [];
    }
    const markNum = quote.match(/0\d{2}/)?.[0] ?? quote.match(/\b\d{2,3}\b/)?.[0];
    if (!markNum) {
      // Fall through to generic affiliation/investigation below when no mark digits.
    } else {
      const normalizedMark = `mark_${markNum.padStart(3, "0").slice(-3)}`;
      return [
        {
          evidenceKind: "MARK_MEANING_IDENTIFIED",
          requiredTags: [normalizedMark, "subject_identifier"],
          matchMode: "ALL",
          minimumResultState: "VERIFIED",
          resultState: "CONFIRMED",
        },
      ];
    }
  }

  if (category === "ABILITY_COST" || category === "HEALTH") {
    return [
      {
        evidenceKind: "ABILITY_COST_CONFIRMED",
        requiredTags: ["internal_injury_after_manifestation"],
        matchMode: "ALL",
        minimumResultState: "VERIFIED",
        resultState: "CONFIRMED",
      },
    ];
  }

  if (category === "ORIGIN" || /다른\s*세계|이계|차원/.test(quote)) {
    return [
      {
        evidenceKind: "IDENTITY_RECORD_MISMATCH",
        requiredTags: ["no_birth_record"],
        matchMode: "ALL",
        minimumResultState: "PARTIAL",
        resultState: "SUSPECTED",
      },
      {
        evidenceKind: "IDENTITY_ORIGIN_CONFIRMED",
        requiredTags: ["nonlocal_origin_confirmed"],
        matchMode: "ALL",
        minimumResultState: "VERIFIED",
        resultState: "CONFIRMED",
      },
    ];
  }

  if (category === "IDENTITY" || /위조|가짜\s*신분|신분\s*위조/.test(quote)) {
    return [
      {
        evidenceKind: "IDENTITY_RECORD_MISMATCH",
        requiredTags: ["identity_forged"],
        matchMode: "ALL",
        minimumResultState: "PARTIAL",
        resultState: "SUSPECTED",
      },
    ];
  }

  if (category === "AFFILIATION") {
    return [
      {
        evidenceKind: "ORGANIZATION_AFFILIATION_CONFIRMED",
        requiredTags: ["org_record_match"],
        matchMode: "ALL",
        minimumResultState: "VERIFIED",
        resultState: "CONFIRMED",
      },
    ];
  }

  if (category === "PAST_EVENT") {
    return [
      {
        evidenceKind: "PAST_EVENT_RECORD_FOUND",
        requiredTags: ["event_record_match"],
        matchMode: "ALL",
        minimumResultState: "PARTIAL",
        resultState: "SUSPECTED",
      },
    ];
  }

  if (category === "ITEM") {
    return [
      {
        evidenceKind: "ITEM_IDENTITY_CONFIRMED",
        requiredTags: ["item_identity_match"],
        matchMode: "ALL",
        minimumResultState: "VERIFIED",
        resultState: "CONFIRMED",
      },
    ];
  }

  if (category === "CRIME") {
    return [
      {
        evidenceKind: "DOCUMENT_CONTENT_VERIFIED",
        requiredTags: ["crime_record"],
        matchMode: "ALL",
        minimumResultState: "VERIFIED",
        resultState: "CONFIRMED",
      },
    ];
  }

  return [
    {
      evidenceKind: "DOCUMENT_CONTENT_VERIFIED",
      requiredTags: [],
      matchMode: "ALL",
      minimumResultState: "PARTIAL",
      resultState: "SUSPECTED",
    },
  ];
}

function titleFromQuote(quote: string, category: CompilerCategory): string {
  const short = quote.replace(/\s+/g, " ").trim().slice(0, 24);
  return short || category;
}

/**
 * Deterministic owner-side compiler — never invents names/orgs/items absent from source.
 * Each atom's quote IS the source; facts are trimmed paraphrases of that quote only.
 */
export function compilePersonaSecretsDeterministic(
  sourceRaw: string
): PersonaSecretCompilerResult {
  const source = sourceRaw.replace(/\r\n?/g, "\n").trim();
  const atoms = splitSecretSourceAtoms(source);
  const secrets: CompiledPersonaSecret[] = [];
  const usedKeys = new Set<string>();
  const unresolved: string[] = [];

  for (const atom of atoms) {
    if (secrets.length >= COMPILER_MAX_SECRETS) {
      unresolved.push(atom);
      continue;
    }
    const category = inferCategory(atom);
    const baseKey = slugify(atom).replace(/^[^a-z]+/, "") || "secret";
    let semanticKey = `${baseKey}_${shortHash(atom)}`;
    // Validator requires /^[a-z][a-z0-9_]{1,63}$/
    if (!/^[a-z]/.test(semanticKey)) semanticKey = `s_${semanticKey}`;
    semanticKey = semanticKey.slice(0, 64);
    let n = 2;
    while (usedKeys.has(semanticKey)) {
      semanticKey = `${baseKey}_${shortHash(atom)}_${n++}`.slice(0, 64);
      if (!/^[a-z]/.test(semanticKey)) semanticKey = `s_${semanticKey}`.slice(0, 64);
    }
    usedKeys.add(semanticKey);

    const confirmedFactText = atom.length > 120 ? `${atom.slice(0, 117).trim()}…` : atom;
    const interpretive = isInterpretiveSecret(atom, category);
    const suspectedFactText =
      category === "ABILITY_COST" || category === "HEALTH"
        ? atom
        : category === "BODY_MARK" && !interpretive
          ? atom
          : interpretive
            ? atom
            : "";
    secrets.push({
      sourceQuotes: [atom],
      semanticKey,
      title: titleFromQuote(atom, category),
      category,
      canonicalSecretText: atom,
      suspectedFactText,
      confirmedFactText,
      importance: inferImportance(category, atom),
      directDisclosureAliases: buildAliases(atom),
      discoveryRules: buildDiscoveryRules(
        category,
        atom,
        confirmedFactText,
        suspectedFactText
      ),
      dependencies: [],
      // Deterministic compiler: high confidence except OTHER.
      // ABILITY_COST/HEALTH stay eligible for visual SUSPECTED even when interpretive.
      confidence:
        category === "OTHER"
          ? 0.55
          : category === "ABILITY_COST" || category === "HEALTH"
            ? 0.92
            : interpretive
              ? 0.9
              : 0.93,
      needsReview: category === "OTHER",
      warnings: category === "OTHER" ? ["category_fallback_other"] : [],
    });
  }

  return {
    schemaVersion: PERSONA_SECRET_OUTPUT_SCHEMA_VERSION,
    compilerVersion: PERSONA_SECRET_COMPILER_VERSION,
    secrets,
    unresolvedFragments: unresolved,
    warnings: unresolved.length
      ? [`truncated_to_unresolved:${unresolved.length}`]
      : [],
  };
}
