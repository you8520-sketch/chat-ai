import {
  buildCanonicalRpQualificationCases,
  type RpQualificationExampleLiteralMode,
} from "./rpModelQualificationFixture";
import {
  RP_ACTIVE_MODEL_QUALITY_MODEL_IDS,
  executeRpActiveModelQualityProbe,
  type RpActiveModelQualityProvider,
  type RpActiveModelQualityTurnResult,
} from "./rpActiveModelQualityLive";

export const RP_EXAMPLE_LITERAL_AB_MAX_CALLS = 6;
export const RP_EXAMPLE_LITERAL_AB_CASE_ID = "production_midchat_t1" as const;
export const RP_EXAMPLE_LITERAL_AB_ARMS = [
  "raw",
  "strip_literals",
] as const satisfies readonly RpQualificationExampleLiteralMode[];

export type RpExampleLiteralBoundaryAbRow = RpActiveModelQualityTurnResult & {
  arm: RpQualificationExampleLiteralMode;
};

export type RpExampleLiteralBoundaryAbReport = {
  version: 1;
  generatedAt: string;
  caseId: typeof RP_EXAMPLE_LITERAL_AB_CASE_ID;
  providerCalls: number;
  maxProviderCalls: number;
  productionMutationEnabled: false;
  scoreGenerated: false;
  rows: RpExampleLiteralBoundaryAbRow[];
  notes: string[];
};

export function buildRpExampleLiteralBoundaryAbPlan() {
  const caseData = buildCanonicalRpQualificationCases().find(
    (entry) => entry.id === RP_EXAMPLE_LITERAL_AB_CASE_ID
  );
  if (!caseData) throw new Error("Missing production_midchat_t1 qualification case");

  const plan = RP_ACTIVE_MODEL_QUALITY_MODEL_IDS.flatMap((modelId) =>
    RP_EXAMPLE_LITERAL_AB_ARMS.map((arm) => ({
      modelId,
      arm,
      caseData,
      probe: {
        modelId,
        caseId: caseData.id,
        targetResponseChars: caseData.targetResponseChars,
        reviewFocus: [
          ...caseData.reviewFocus,
          "compare unsupported shared-history invention between raw vs stripped example literals",
          "compare character voice preservation between raw vs stripped example literals",
        ],
      },
    }))
  );

  if (plan.length !== RP_EXAMPLE_LITERAL_AB_MAX_CALLS) {
    throw new Error(
      `Unexpected example-literal A/B call budget: ${plan.length}/${RP_EXAMPLE_LITERAL_AB_MAX_CALLS}`
    );
  }
  return plan;
}

export async function runRpExampleLiteralBoundaryAb(input: {
  credentials: Record<RpActiveModelQualityProvider, string>;
  runId: string;
  fetchImpl?: typeof fetch;
}): Promise<RpExampleLiteralBoundaryAbReport> {
  const rows: RpExampleLiteralBoundaryAbRow[] = [];
  const plan = buildRpExampleLiteralBoundaryAbPlan();

  for (const item of plan) {
    const sessionId = [
      "rp-example-literal-ab",
      input.runId,
      item.arm,
      item.modelId.replace(/[^a-zA-Z0-9._-]+/g, "-"),
    ]
      .join("-")
      .slice(0, 256);

    const result = await executeRpActiveModelQualityProbe({
      credentials: input.credentials,
      probe: item.probe,
      caseData: item.caseData,
      sessionId,
      exampleLiteralMode: item.arm,
      fetchImpl: input.fetchImpl,
    });
    rows.push({ ...result, arm: item.arm });
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    caseId: RP_EXAMPLE_LITERAL_AB_CASE_ID,
    providerCalls: rows.length,
    maxProviderCalls: RP_EXAMPLE_LITERAL_AB_MAX_CALLS,
    productionMutationEnabled: false,
    scoreGenerated: false,
    rows,
    notes: [
      "Research-only fixture A/B. Production prompt behavior is unchanged.",
      "raw keeps current literal character/persona example utterances.",
      "strip_literals removes only literal example utterances while preserving surrounding canon/personality/preferences.",
      "One attempt per model/arm; no retry or fallback generation.",
      "GPT/user reviews shared-history fidelity and character voice from raw artifacts.",
    ],
  };
}

export function renderRpExampleLiteralBoundaryAbMarkdown(
  report: RpExampleLiteralBoundaryAbReport
): string {
  const lines = [
    "# Main RP example-literal provenance A/B",
    "",
    `- case: ${report.caseId}`,
    `- provider calls: **${report.providerCalls}/${report.maxProviderCalls}**`,
    "- production mutation: **false**",
    "- automatic score/ranking: **none**",
    "",
    "| Model | Arm | Provider | Status | chars | prompt tok | output tok | seconds |",
    "|---|---|---|---|---:|---:|---:|---:|",
  ];
  for (const row of report.rows) {
    lines.push(
      `| ${row.modelId} | ${row.arm} | ${row.provider} | ${row.status} | ${row.visibleChars} | ${row.promptTokens} | ${row.completionTokens} | ${row.totalSeconds.toFixed(2)} |`
    );
  }
  lines.push("", "## Review boundary", "");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  return lines.join("\n");
}
