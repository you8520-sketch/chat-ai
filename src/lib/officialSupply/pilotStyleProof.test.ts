import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  PILOT_STYLE_PROOF_ASSET_LIMIT,
  PILOT_STYLE_PROOF_BATCH_CONFIG,
  PILOT_STYLE_PROOF_CANDIDATE_ID,
  PILOT_STYLE_PROOF_DRAFT_KEYS,
  PILOT_STYLE_PROOF_SOURCE_DRAFT_KEYS,
  PILOT_STYLE_PROOF_SOURCE_STYLE_KEY,
  PILOT_STYLE_PROOF_STYLE_KEY,
  PILOT_STYLE_PROOF_SLOT_KEY,
  PILOT_STYLE_SEED_PATH,
  buildPilotStyleProofDraft,
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
      "pilot-rf-v2-01",
      "pilot-rf-v2-02",
      "pilot-rf-v2-09",
    ]);
    assert.equal(new Set(PILOT_STYLE_PROOF_DRAFT_KEYS).size, 3);
    assert.equal(PILOT_STYLE_PROOF_SLOT_KEY, "rep");
    assert.equal(PILOT_STYLE_PROOF_ASSET_LIMIT, 3);
    assert.equal(PILOT_STYLE_PROOF_BATCH_CONFIG.maxAttemptsPerSlot, 1);
    assert.equal(PILOT_STYLE_PROOF_BATCH_CONFIG.reservePerImageUsd, 1);
    assert.equal(PILOT_STYLE_PROOF_BATCH_CONFIG.budgetUsd.batch, 3);
    assert.equal(PILOT_STYLE_PROOF_BATCH_CONFIG.budgetUsd.perCharacter, 1);
    assert.equal(PILOT_STYLE_PROOF_STYLE_KEY, "romance_fantasy_v2");
    assert.equal(PILOT_STYLE_PROOF_SOURCE_STYLE_KEY, "romance_fantasy_v1");
  });

  it("uses a platform-owned https seed, never an external observation reference", () => {
    const seed = buildPilotStyleSeed({
      NEXTAUTH_URL: "https://chat-ai-production-3e84.up.railway.app",
    });
    assert.equal(seed.provenance, "platform_owned");
    assert.match(seed.url, /^https:\/\//);
    assert.equal(validateStyleSeedForApproval(seed), null);
    assert.equal(PILOT_STYLE_SEED_PATH, "/official-supply/style-seeds/romance-fantasy-rf-02-v2.svg");
    assert.match(seed.url, /romance-fantasy-rf-02-v2\.svg$/);
  });

  it("derives v2 execution identities without cloning committed pilot content", () => {
    const style = JSON.parse(
      fs.readFileSync(path.join(PILOT_DIR, "style-candidates.json"), "utf8")
    ) as { styleKey: string; candidates: Array<{ candidateId: string }> };
    assert.equal(style.styleKey, PILOT_STYLE_PROOF_SOURCE_STYLE_KEY);
    assert.ok(style.candidates.some((candidate) => candidate.candidateId === "rf-02"));

    assert.equal(PILOT_STYLE_PROOF_SOURCE_DRAFT_KEYS.length, 10);
    for (const sourceDraftKey of PILOT_STYLE_PROOF_SOURCE_DRAFT_KEYS) {
      const file = JSON.parse(
        fs.readFileSync(path.join(PILOT_DIR, "characters", `${sourceDraftKey}.json`), "utf8")
      ) as {
        draftKey: string;
        draft: import("@/lib/officialSupply/types").OfficialCharacterDraft;
        appearance?: unknown;
        assetPlan?: { slots?: Array<{ slotKey: string; kind: string }> };
      };
      assert.equal(file.draftKey, sourceDraftKey);
      const versioned = buildPilotStyleProofDraft(file.draft);
      assert.equal(versioned.draftKey, sourceDraftKey.replace("pilot-rf-", "pilot-rf-v2-"));
      assert.equal(versioned.styleKey, PILOT_STYLE_PROOF_STYLE_KEY);
      assert.equal(file.draft.draftKey, sourceDraftKey);
      assert.equal(file.draft.styleKey, PILOT_STYLE_PROOF_SOURCE_STYLE_KEY);
    }

    for (const [index, runtimeDraftKey] of PILOT_STYLE_PROOF_DRAFT_KEYS.entries()) {
      const sourceDraftKey = ["pilot-rf-01", "pilot-rf-02", "pilot-rf-09"][index]!;
      const file = JSON.parse(
        fs.readFileSync(path.join(PILOT_DIR, "characters", `${sourceDraftKey}.json`), "utf8")
      ) as { appearance?: unknown; assetPlan?: { slots?: Array<{ slotKey: string; kind: string }> } };
      assert.ok(file.appearance, `${runtimeDraftKey}: appearance lock missing`);
      assert.ok(file.assetPlan, `${runtimeDraftKey}: asset plan missing`);
      assert.ok(
        file.assetPlan?.slots?.some(
          (slot) => slot.slotKey === PILOT_STYLE_PROOF_SLOT_KEY && slot.kind === "representative"
        ),
        `${runtimeDraftKey}: representative slot missing`
      );
    }
  });

  it("the current proof operator contains no persisted-state recovery or quota reset", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/official-supply-style-proof.ts"),
      "utf8"
    );
    assert.doesNotMatch(source, /LEGACY_PRE_PROVIDER_ERROR|LEGACY_PHANTOM_PAUSE|recoverKnownPreProviderSeedBootstrap/);
    assert.doesNotMatch(source, /SET status='planned', attempts=0/);
  });
});
