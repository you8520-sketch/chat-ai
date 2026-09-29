/**
 * Companion Memory Experiment Bridge.
 *
 * Converts official companion-product memory documentation into deterministic,
 * research-only experiment hypotheses. It never creates a production owner,
 * changes prompts, or treats product claims as benchmark evidence.
 */
import {
  isBenchmarkOwnerHooked,
  MEMORY_OWNER_MAP,
  type MemoryOwnerId,
} from "@/lib/memoryResearch/ownerMap";
import type { ResearchObservation } from "@/lib/memoryResearch/types";

export type CompanionBridgeClassification =
  | "ALREADY_HAVE"
  | "BENCHMARK_WORTHY"
  | "OWNER_CONFLICT"
  | "INSUFFICIENT_EVIDENCE"
  | "FOLLOW_UP";

export type CompanionTechniqueId =
  | "cascaded_summary_history"
  | "bounded_long_term_recall"
  | "identity_core"
  | "mind_map"
  | "pinned_memory"
  | "automatic_memory"
  | "unclassified";

export type CompanionExperimentProposal = {
  candidateKey: string;
  sourceUrl: string;
  sourceVersion: string | null;
  evidenceLevel: "OFFICIAL_PRODUCT_DOC_CLAIM_ONLY";
  technique: CompanionTechniqueId;
  classification: CompanionBridgeClassification;
  targetOwners: readonly MemoryOwnerId[];
  benchmarkHookReady: boolean;
  localCoverage: string;
  hypothesis: string | null;
  nextAction: string;
  evidenceExcerpt: string;
};

type TechniqueRule = {
  technique: Exclude<CompanionTechniqueId, "unclassified">;
  pattern: RegExp;
  classification: Exclude<CompanionBridgeClassification, "INSUFFICIENT_EVIDENCE">;
  targetOwners: readonly MemoryOwnerId[];
  localCoverage: string;
  hypothesis: string | null;
  nextAction: string;
};

const RULES: readonly TechniqueRule[] = [
  {
    technique: "cascaded_summary_history",
    pattern: /\bcascad(?:ed|ing)?\b|summari[sz]ed (?:older )?(?:conversation|history|context)/i,
    classification: "ALREADY_HAVE",
    targetOwners: ["rolling_summary", "medium_term", "global_current_memory"],
    localCoverage:
      "Responsibility-level equivalent exists: 5-turn rolling summaries → Medium N15 recent-detail ring → Global Current Memory compaction.",
    hypothesis: null,
    nextAction:
      "Do not create another summary/history owner. Re-open only if the official docs expose a measurable policy difference that current fixtures do not cover.",
  },
  {
    technique: "bounded_long_term_recall",
    pattern:
      /(?:bounded|limited|up to|top[- ]?k)?.{0,40}(?:long[- ]term memory|journal|memory).{0,40}recall|recall.{0,40}(?:journal|long[- ]term memory)/i,
    classification: "BENCHMARK_WORTHY",
    targetOwners: ["episodic_facts", "episodic_selection", "prompt_packing"],
    localCoverage:
      "Current episodic retrieval already performs bounded relevance-gated recall; exact recall count/budget policy can be compared without a new store.",
    hypothesis:
      "A different bounded recall count or packing policy may improve final recall/precision or reduce prompt tokens without increasing false/stale memory.",
    nextAction:
      "Generate a deterministic benchmark proposal against the existing episodic retrieval + prompt-packing owners. Add a benchmark hook before any runtime patch.",
  },
  {
    technique: "identity_core",
    pattern: /\bidentity core\b|dynamic (?:sense of )?self|identity memory/i,
    classification: "BENCHMARK_WORTHY",
    targetOwners: ["global_current_memory", "relationship_durable"],
    localCoverage:
      "Current owners already retain long-run narrative/relationship state, but there is no separate self-identity owner.",
    hypothesis:
      "Repeated, durable identity evidence could be consolidated inside an existing owner and improve role consistency without promoting one-turn emotions into permanent traits.",
    nextAction:
      "Prototype only as an experiment inside the existing Global/Relationship owners; benchmark role consistency, stale-state recall, and one-turn-emotion negatives.",
  },
  {
    technique: "mind_map",
    pattern: /\bmind map\b|(?:map|graph).{0,30}(?:memories|memory|people|places|topics)/i,
    classification: "OWNER_CONFLICT",
    targetOwners: ["global_current_memory", "relationship_durable", "episodic_facts"],
    localCoverage:
      "Entity/topic relationships are already represented across Global, Relationship, and Episodic owners; copying a separate graph/mind-map store wholesale would add a parallel owner.",
    hypothesis:
      "A read-only projection generated from existing canonical memory might improve multi-hop recall, but a second writable memory graph is not acceptable.",
    nextAction:
      "Only consider a benchmark-only projection that reads existing owners. Do not add a graph DB or second writable memory owner.",
  },
  {
    technique: "pinned_memory",
    pattern: /\bpinned memor(?:y|ies)\b|\bpin(?:ned)? (?:message|memory)\b|\bfixed (?:chat )?memory\b|\bchat memory\b/i,
    classification: "FOLLOW_UP",
    targetOwners: ["prompt_packing"],
    localCoverage:
      "This is primarily a user-control/product-surface pattern rather than an autonomous recall algorithm; current research owner map does not define a separate pinned-memory product owner.",
    hypothesis:
      "Explicit user-pinned facts may improve controllability, but value depends on product semantics and conflict priority rather than retrieval quality alone.",
    nextAction:
      "Keep out of automatic memory implementation. If pursued, first map it to the existing user-authored lore/persona owner and define conflict priority before benchmark work.",
  },
  {
    technique: "automatic_memory",
    pattern: /\bauto(?:matic)?[- ]memor(?:y|ies)\b|automatically (?:remember|store|save).{0,30}(?:memory|memories|details)/i,
    classification: "ALREADY_HAVE",
    targetOwners: ["episodic_facts", "rolling_summary", "global_current_memory"],
    localCoverage:
      "Automatic extraction/summarization already exists through Episodic Facts plus rolling/Global memory owners.",
    hypothesis: null,
    nextAction:
      "Do not create another auto-memory subsystem. Re-open only for a specific extraction/consolidation technique with reproducible evidence.",
  },
] as const;

function excerptFor(text: string, pattern: RegExp): string {
  const compact = text.replace(/\s+/g, " ").trim();
  const match = compact.match(pattern);
  if (!match || match.index == null) return compact.slice(0, 280);
  const start = Math.max(0, match.index - 100);
  return compact.slice(start, Math.min(compact.length, match.index + match[0].length + 180)).trim();
}

function hookReady(
  classification: CompanionBridgeClassification,
  owners: readonly MemoryOwnerId[]
): boolean {
  if (classification !== "BENCHMARK_WORTHY") return false;
  return owners.some((owner) => isBenchmarkOwnerHooked(owner));
}

export function buildCompanionExperimentProposals(
  observation: ResearchObservation
): CompanionExperimentProposal[] {
  if (
    observation.sourceKind !== "official_companion_docs" ||
    observation.category !== "companion_roleplay_memory"
  ) {
    return [];
  }

  const text = [
    observation.title,
    observation.summary,
    observation.claimedAdvantage,
  ]
    .filter(Boolean)
    .join("\n");

  const matched = RULES.filter((rule) => rule.pattern.test(text));
  if (matched.length === 0) {
    return [
      {
        candidateKey: observation.candidateKey,
        sourceUrl: observation.sourceUrl,
        sourceVersion: observation.version,
        evidenceLevel: "OFFICIAL_PRODUCT_DOC_CLAIM_ONLY",
        technique: "unclassified",
        classification: "INSUFFICIENT_EVIDENCE",
        targetOwners: [],
        benchmarkHookReady: false,
        localCoverage: "No deterministic mapping to a current canonical memory responsibility.",
        hypothesis: null,
        nextAction:
          "Keep as research evidence only. Wait for a more specific official architecture description, reproducible code, or benchmark evidence.",
        evidenceExcerpt: text.replace(/\s+/g, " ").trim().slice(0, 280),
      },
    ];
  }

  return matched.map((rule) => ({
    candidateKey: observation.candidateKey,
    sourceUrl: observation.sourceUrl,
    sourceVersion: observation.version,
    evidenceLevel: "OFFICIAL_PRODUCT_DOC_CLAIM_ONLY" as const,
    technique: rule.technique,
    classification: rule.classification,
    targetOwners: rule.targetOwners,
    benchmarkHookReady: hookReady(rule.classification, rule.targetOwners),
    localCoverage: rule.localCoverage,
    hypothesis: rule.hypothesis,
    nextAction: rule.nextAction,
    evidenceExcerpt: excerptFor(text, rule.pattern),
  }));
}

export function renderCompanionExperimentBridgeMarkdown(
  proposals: readonly CompanionExperimentProposal[]
): string {
  const lines = [
    "## Companion Memory Experiment Bridge",
    "",
    "Official product documentation is hypothesis evidence only. These rows do not change production, create an experiment adapter, or count as benchmark proof.",
    "",
  ];

  if (proposals.length === 0) {
    lines.push("- (no official companion-memory proposals this cycle)", "");
    return lines.join("\n");
  }

  lines.push(
    "| candidate | technique | classification | target owner(s) | benchmark hook | next action |",
    "|---|---|---|---|---|---|"
  );
  for (const proposal of proposals) {
    const owners =
      proposal.targetOwners.length > 0
        ? proposal.targetOwners
            .map((owner) => `${owner}: ${MEMORY_OWNER_MAP[owner].responsibility}`)
            .join("<br>")
        : "(none)";
    lines.push(
      `| ${proposal.candidateKey} | ${proposal.technique} | ${proposal.classification} | ${owners} | ${proposal.benchmarkHookReady ? "READY" : "NOT_HOOKED"} | ${proposal.nextAction.replace(/\|/g, "/")} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
