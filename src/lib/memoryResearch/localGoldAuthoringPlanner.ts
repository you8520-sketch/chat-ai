/**
 * Local Gold Authoring Planner.
 *
 * Converts benchmark-harness feasibility rows that require local gold into
 * human-reviewable deterministic fixture authoring packets.
 *
 * Research-only:
 * - no external dataset is copied
 * - no provider / LLM judge call
 * - no production memory or prompt mutation
 * - no benchmark file is edited automatically
 */
import type { HarnessFeasibilityEvidence } from "@/lib/memoryResearch/benchmarkHarnessFeasibility";

export type GoldAuthoringPacketStatus =
  | "HUMAN_REVIEW_REQUIRED"
  | "NO_PACKET_REQUIRED";

export type GoldAuthoringPacket = {
  packetKey: string;
  candidateKey: string;
  planKey: string;
  ability: HarnessFeasibilityEvidence["ability"];
  status: GoldAuthoringPacketStatus;
  targetHarness: string;
  proposedCaseIds: readonly string[];
  authoringTemplate: {
    personaPremises: readonly string[];
    sourceFacts: readonly string[];
    expectedSupportedInference: string;
    unsupportedInferenceNegative: string;
    mechanicalChecks: readonly string[];
  } | null;
  reviewerChecklist: readonly string[];
  forbidden: readonly string[];
  nextAction: string;
};

function noPacket(row: HarnessFeasibilityEvidence): GoldAuthoringPacket {
  return {
    packetKey: `${row.planKey}:no-gold-packet`,
    candidateKey: row.candidateKey,
    planKey: row.planKey,
    ability: row.ability,
    status: "NO_PACKET_REQUIRED",
    targetHarness: "-",
    proposedCaseIds: [],
    authoringTemplate: null,
    reviewerChecklist: [],
    forbidden: [
      "automatic semantic gold generation",
      "external hidden-test copying",
      "LLM judge as canonical truth",
    ],
    nextAction:
      "No local-gold authoring packet is justified by the current feasibility evidence.",
  };
}

export function buildLocalGoldAuthoringPacket(
  row: HarnessFeasibilityEvidence
): GoldAuthoringPacket {
  if (row.status !== "LOCAL_GOLD_AUTHORING_REQUIRED") {
    return noPacket(row);
  }

  if (row.ability !== "persona_conditioned_insight") {
    return noPacket(row);
  }

  return {
    packetKey: `${row.planKey}:local-gold-v1`,
    candidateKey: row.candidateKey,
    planKey: row.planKey,
    ability: row.ability,
    status: "HUMAN_REVIEW_REQUIRED",
    targetHarness:
      "research-only deterministic persona-conditioned insight fixture; canonical production memory owners unchanged",
    proposedCaseIds: [
      "persona-grounded-insight-01",
      "unsupported-persona-inference-negative-01",
    ],
    authoringTemplate: {
      personaPremises: [
        "2~4 explicit authored persona premises that are stable for this fixture",
        "include at least one premise relevant to interpretation and one distractor premise",
      ],
      sourceFacts: [
        "1~3 explicit conversation facts with objective provenance",
        "facts must not already contain the target insight wording",
      ],
      expectedSupportedInference:
        "One short inference mechanically supported by BOTH the explicit persona premise(s) and source fact(s).",
      unsupportedInferenceNegative:
        "One plausible-sounding psychological/relationship inference that is NOT entailed by the provided premises + facts.",
      mechanicalChecks: [
        "positive inference references only atoms present in the approved premise/fact vocabulary",
        "negative inference requires at least one unsupported atom and must be rejected",
        "removing the relevant persona premise makes the positive inference invalid",
        "removing the source fact makes the positive inference invalid",
        "no inferred insight is persisted into production memory",
      ],
    },
    reviewerChecklist: [
      "Ground truth is locally authored; no RoleMemo or other external test item is copied.",
      "Positive answer is objectively derivable from the written premises and facts.",
      "Negative answer is attractive/plausible but contains a clearly unsupported inference.",
      "No diagnosis, hidden motive, secret relationship, or personality trait is invented without explicit premise support.",
      "Fixture evaluates interpretation only; it does not create a new canonical insight-memory owner.",
      "Existing false-memory / role-consistency metrics remain unchanged unless a separate reviewed metric proposal proves necessity.",
    ],
    forbidden: [
      "free-form psychological inference as gold truth",
      "automatic acceptance of model-written gold",
      "external benchmark conversation/test item copying",
      "LLM-as-judge in scheduled research",
      "provider calls",
      "new insight memory store",
      "production prompt change",
    ],
    nextAction:
      "A human reviewer must author and approve the synthetic premise/fact/positive/negative pair before any benchmark fixture implementation PR can be proposed.",
  };
}

export function buildLocalGoldAuthoringPackets(
  rows: readonly HarnessFeasibilityEvidence[]
): GoldAuthoringPacket[] {
  return rows
    .map(buildLocalGoldAuthoringPacket)
    .filter((packet) => packet.status !== "NO_PACKET_REQUIRED");
}

export function renderLocalGoldAuthoringPacketsMarkdown(
  packets: readonly GoldAuthoringPacket[]
): string {
  const lines = [
    "## Local Gold Authoring Planner",
    "",
    "Packets are human-review requirements only. The automation does not write semantic gold, edit benchmark fixtures, call a judge, or modify production memory.",
    "",
  ];

  if (packets.length === 0) {
    lines.push("- (no local-gold authoring packet this cycle)", "");
    return lines.join("\n");
  }

  lines.push(
    "| packet | ability | status | proposed local cases | next action |",
    "|---|---|---|---|---|"
  );
  for (const packet of packets) {
    lines.push(
      `| ${packet.packetKey} | ${packet.ability} | ${packet.status} | ${packet.proposedCaseIds.join(", ") || "-"} | ${packet.nextAction.replace(/\|/g, "/")} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
