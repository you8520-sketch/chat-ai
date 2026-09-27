import "server-only";

import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import {
  PILOT_CLUSTER_B_PROOF_ASSET_LIMIT,
  PILOT_CLUSTER_B_PROOF_DRAFT_KEYS,
  PILOT_CLUSTER_B_PROOF_SLOT_KEY,
} from "@/lib/officialSupply/pilotClusterBStyleProof";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import {
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";

const REVIEWER = "project-owner";

function stop(message: string): never {
  throw new Error(`STYLE_LOCK STOP: ${message}`);
}

function main(): void {
  const store = new OfficialSupplyStore();
  const style = store.getStyle(PILOT_STYLE_PROOF_V4_STYLE_KEY);

  if (style.stage === "style_locked") {
    console.log(JSON.stringify({
      status: "ALREADY_STYLE_LOCKED",
      styleKey: style.styleKey,
      candidateId: style.approvedCandidateId,
      styleStage: style.stage,
    }));
    return;
  }

  if (style.stage !== "candidate_approved") {
    stop(`style stage is ${style.stage}, expected candidate_approved`);
  }
  if (style.approvedCandidateId !== PILOT_STYLE_PROOF_CANDIDATE_ID) {
    stop(`approved candidate is ${style.approvedCandidateId}, expected ${PILOT_STYLE_PROOF_CANDIDATE_ID}`);
  }
  if (style.proofAssetLimit !== PILOT_CLUSTER_B_PROOF_ASSET_LIMIT) {
    stop(`proofAssetLimit=${style.proofAssetLimit}, expected ${PILOT_CLUSTER_B_PROOF_ASSET_LIMIT}`);
  }

  const db = store.database;
  const rows = db.prepare(
    `SELECT c.draft_key, c.is_style_proof,
            a.slot_key, a.kind, a.status, a.attempts, a.result_url,
            a.spent_usd, a.has_unknown_cost, a.moderation_json
       FROM official_supply_characters c
       JOIN official_supply_assets a ON a.draft_key = c.draft_key
      WHERE c.style_key = ? AND a.attempts > 0
      ORDER BY c.draft_key, a.slot_key`
  ).all(PILOT_STYLE_PROOF_V4_STYLE_KEY) as Array<{
    draft_key: string;
    is_style_proof: number;
    slot_key: string;
    kind: string;
    status: string;
    attempts: number;
    result_url: string | null;
    spent_usd: number;
    has_unknown_cost: number;
    moderation_json: string | null;
  }>;

  if (rows.length !== PILOT_CLUSTER_B_PROOF_ASSET_LIMIT) {
    stop(`started asset count=${rows.length}, expected ${PILOT_CLUSTER_B_PROOF_ASSET_LIMIT}`);
  }

  const expected = new Set<string>(PILOT_CLUSTER_B_PROOF_DRAFT_KEYS);
  for (const row of rows) {
    if (!expected.has(row.draft_key)) stop(`unexpected paid draft ${row.draft_key}`);
    if (row.is_style_proof !== 1) stop(`${row.draft_key} is not marked style proof`);
    if (row.slot_key !== PILOT_CLUSTER_B_PROOF_SLOT_KEY) {
      stop(`${row.draft_key} paid slot ${row.slot_key} is not ${PILOT_CLUSTER_B_PROOF_SLOT_KEY}`);
    }
    if (row.kind !== "representative") stop(`${row.draft_key} kind=${row.kind}`);
    if (row.status !== "generated" && row.status !== "approved") {
      stop(`${row.draft_key} status=${row.status}`);
    }
    if (row.attempts !== 1) stop(`${row.draft_key} attempts=${row.attempts}`);
    if (!row.result_url) stop(`${row.draft_key} missing result_url`);
    if (row.has_unknown_cost !== 0) stop(`${row.draft_key} has unknown cost`);
    if (!row.moderation_json) stop(`${row.draft_key} missing moderation`);
    const moderation = officialModerationVerdict(JSON.parse(row.moderation_json));
    if (moderation !== "clean" && moderation !== "adult_flagged") {
      stop(`${row.draft_key} moderation=${moderation}`);
    }
  }

  for (const draftKey of expected) {
    if (!rows.some((row) => row.draft_key === draftKey)) {
      stop(`missing proof row ${draftKey}`);
    }
  }

  if (store.countStyleProofSlotsStarted(PILOT_STYLE_PROOF_V4_STYLE_KEY) !== PILOT_CLUSTER_B_PROOF_ASSET_LIMIT) {
    stop("canonical started-proof count does not equal proof limit");
  }

  const locked = store.decideStyleProof(
    PILOT_STYLE_PROOF_V4_STYLE_KEY,
    "approve",
    REVIEWER
  );

  if (locked.stage !== "style_locked") {
    stop(`post-condition stage=${locked.stage}`);
  }

  console.log(JSON.stringify({
    status: "STYLE_LOCKED_AFTER_HUMAN_APPROVAL",
    styleKey: locked.styleKey,
    candidateId: locked.approvedCandidateId,
    styleStage: locked.stage,
    proofCount: rows.length,
    totalSpentUsd: rows.reduce((sum, row) => sum + row.spent_usd, 0),
    reviewer: REVIEWER,
  }));
}

try {
  main();
} catch (error) {
  console.error(
    "[rofan-v4-style-lock]",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
}
