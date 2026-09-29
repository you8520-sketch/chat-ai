import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MainRpSupplyRadarReport } from "./lib/mainRpSupplyRadar";
import type { MainRpSupplyPromotionHistoryReport } from "./lib/mainRpSupplyPromotionHistory";
import {
  buildMainRpSupplyPromotionProposalPacket,
  renderMainRpSupplyPromotionProposalMarkdown,
} from "./lib/mainRpSupplyPromotionProposal";

const OUT_DIR =
  process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() ||
  "artifacts/main-rp-supply-radar";

function readJson<T>(path: string): T {
  if (!existsSync(path)) {
    throw new Error(`Missing promotion proposal input: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  const radar = readJson<MainRpSupplyRadarReport>(join(OUT_DIR, "report.json"));
  const history = readJson<MainRpSupplyPromotionHistoryReport>(
    join(OUT_DIR, "promotion-history.json")
  );

  const packet = buildMainRpSupplyPromotionProposalPacket({
    history,
    radar,
  });

  writeFileSync(
    join(OUT_DIR, "promotion-proposals.json"),
    JSON.stringify(
      {
        ...packet,
        providerGenerationCalls: 0,
        productionRouteMutations: 0,
      },
      null,
      2
    ),
    "utf8"
  );
  writeFileSync(
    join(OUT_DIR, "PROMOTION-PROPOSALS.md"),
    renderMainRpSupplyPromotionProposalMarkdown(packet) +
      "\n## Runtime boundary\n\n- provider generation calls: **0**\n- production route mutations: **0**\n- automatic merge eligible: **0**\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        proposals: packet.proposals.length,
        draft_route_pr_eligible: packet.draftRoutePrEligibleCount,
        cross_provider_review_required:
          packet.crossProviderReviewRequiredCount,
        automatic_merge_eligible: 0,
        provider_generation_calls: 0,
        production_route_mutations: 0,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
}
