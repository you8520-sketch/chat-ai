import { TRPG_FORK_FORBIDDEN_MESSAGE } from "./types";

const FORK_REQUEST_KEYS = [
  "parentCampaignId",
  "parent_campaign_id",
  "forkCampaignId",
  "fork_campaign_id",
  "sourceCampaignId",
  "source_campaign_id",
  "forkFromRound",
  "fork_from_round",
  "forkRound",
  "fork_round",
  "branchFrom",
  "branch_from",
  "forkFrom",
  "fork_from",
] as const;

export function rejectTrpgFork(): never {
  throw new Error(TRPG_FORK_FORBIDDEN_MESSAGE);
}

/** Create/join bodies must not carry a parent campaign or round to split from. */
export function assertNoTrpgForkRequest(body: Record<string, unknown> | null | undefined): void {
  if (!body) return;
  for (const key of FORK_REQUEST_KEYS) {
    const value = body[key];
    if (value == null || value === false || value === "") continue;
    rejectTrpgFork();
  }
}
