import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  PILOT_STYLE_PROOF_ASSET_LIMIT,
  PILOT_STYLE_PROOF_BATCH_CONFIG,
  PILOT_STYLE_PROOF_CANDIDATE_ID,
  PILOT_STYLE_PROOF_DRAFT_KEYS,
  PILOT_STYLE_PROOF_SLOT_KEY,
  buildPilotStyleSeed,
  pilotStyleProofOptedIn,
} from "@/lib/officialSupply/pilotStyleProof";
import { validateStyleSeedForApproval } from "@/lib/officialSupply/style";

const ROOT = process.cwd();
const PILOT_DIR = path.join(ROOT, "src/lib/officialSupply/pilot");

describe("romance-fantasy rf-02 style proof gate", () => {
  it("requires explicit two-part live opt-in", () => {
    assert.equal(pilotStyleProofOptedIn({}), false);
    assert.equal(
      pilotStyleProofOptedIn({
        OFFICIAL_STYLE_PROOF_LIVE: "1",
        OFFICIAL_STYLE_PROOF_CANDIDATE: "rf-04",
      }),
      false
    );
    assert.equal(
      pilotStyleProofOptedIn({
        OFFICIAL_STYLE_PROOF_LIVE: "1",
        OFFICIAL_STYLE_PROOF_CANDIDATE: PILOT_STYLE_PROOF_CANDIDATE_ID,
      }),
      true
    );
  });

  it("uses exactly three representative proof characters and one attempt each", () => {
    assert.deepEqual([...PILOT_STYLE_PROOF_DRAFT_KEYS], [
      "pilot-rf-01",
      "pilot-rf-02",
      "pilot-rf-09",
    ]);
    assert.equal(new Set(PILOT_STYLE_PROOF_DRAFT_KEYS).size, 3);
    assert.equal(PILOT_STYLE_PROOF_SLOT_KEY, "rep");
    assert.equal(PILOT_STYLE_PROOF_ASSET_LIMIT, 3);
    assert.equal(PILOT_STYLE_PROOF_BATCH_CONFIG.maxAttemptsPerSlot, 1);
    assert.equal(PILOT_STYLE_PROOF_BATCH_CONFIG.reservePerImageUsd, 1);
    assert.equal(PILOT_STYLE_PROOF_BATCH_CONFIG.budgetUsd.batch, 3);
    assert.equal(PILOT_STYLE_PROOF_BATCH_CONFIG.budgetUsd.perCharacter, 1);
  });

  it("uses a platform-owned https seed, never an external observation reference", () => {
    const seed = buildPilotStyleSeed({
      NEXTAUTH_URL: "https://chat-ai-production-3e84.up.railway.app",
    });
    assert.equal(seed.provenance, "platform_owned");
    assert.match(seed.url, /^https:\/\//);
    assert.equal(validateStyleSeedForApproval(seed), null);
  });

  it("committed pilot data contains rf-02 and representative plans for all proof characters", () => {
    const style = JSON.parse(
      fs.readFileSync(path.join(PILOT_DIR, "style-candidates.json"), "utf8")
    ) as { candidates: Array<{ candidateId: string }> };
    assert.ok(style.candidates.some((candidate) => candidate.candidateId === "rf-02"));

    for (const draftKey of PILOT_STYLE_PROOF_DRAFT_KEYS) {
      const file = JSON.parse(
        fs.readFileSync(path.join(PILOT_DIR, "characters", `${draftKey}.json`), "utf8")
      ) as { draftKey: string; appearance?: unknown; assetPlan?: { slots?: Array<{ slotKey: string; kind: string }> } };
      assert.equal(file.draftKey, draftKey);
      assert.ok(file.appearance, `${draftKey}: appearance lock missing`);
      assert.ok(file.assetPlan, `${draftKey}: asset plan missing`);
      assert.ok(
        file.assetPlan?.slots?.some(
          (slot) => slot.slotKey === PILOT_STYLE_PROOF_SLOT_KEY && slot.kind === "representative"
        ),
        `${draftKey}: representative slot missing`
      );
    }
  });
});
