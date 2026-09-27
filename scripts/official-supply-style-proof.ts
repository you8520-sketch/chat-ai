import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SessionUser } from "@/lib/characterFormSave";
import { getDataDir } from "@/lib/dataDir";
import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import {
  fileOfficialAssetSpool,
  openAiOfficialImageTransport,
  sharpOfficialImageOps,
  uploadOfficialAssetStorage,
  visionOfficialAssetModerator,
} from "@/lib/officialSupply/productionAdapters";
import {
  moderateOfficialAssetSlot,
  runOfficialAssetSlot,
} from "@/lib/officialSupply/runner";
import {
  PILOT_STYLE_PROOF_ASSET_LIMIT,
  PILOT_STYLE_PROOF_BATCH_CONFIG,
  PILOT_STYLE_PROOF_BATCH_KEY,
  PILOT_STYLE_PROOF_CANDIDATE_ID,
  PILOT_STYLE_PROOF_DRAFT_KEYS,
  PILOT_STYLE_PROOF_SLOT_KEY,
  PILOT_STYLE_PROOF_STYLE_KEY,
  buildPilotStyleSeed,
  pilotStyleProofOptedIn,
} from "@/lib/officialSupply/pilotStyleProof";
import {
  OfficialSupplyGateError,
  OfficialSupplyStore,
} from "@/lib/officialSupply/store";
import type {
  OfficialAppearanceLock,
  OfficialAssetPlan,
  OfficialCharacterDraft,
  OfficialGenreStyle,
  VisualStyleCandidate,
} from "@/lib/officialSupply/types";

const ROOT = process.cwd();
const PILOT_DIR = path.join(ROOT, "src/lib/officialSupply/pilot");
const CHAR_DIR = path.join(PILOT_DIR, "characters");
const PACKET_DIR = path.join(getDataDir(), "official-supply-style-proof");
const PACKET_PATH = path.join(PACKET_DIR, `${PILOT_STYLE_PROOF_STYLE_KEY}.json`);
const STAGING_USER: SessionUser = {
  id: 0,
  nickname: "official-style-proof",
  is_adult: 1,
};
const REVIEWER = "project-owner";
const WORKER_ID = `official-style-proof-${process.pid}`;

type PilotCharacterFile = {
  draftKey: string;
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
  assetPlan: OfficialAssetPlan;
};

type PilotStyleFile = {
  styleKey: string;
  genre: OfficialGenreStyle["genre"];
  candidates: VisualStyleCandidate[];
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertSame(label: string, actual: unknown, expected: unknown): void {
  if (stable(actual) !== stable(expected)) {
    throw new Error(`${label} differs from the committed pilot artifact; STOP before provider calls`);
  }
}

function missing(error: unknown, code: string): boolean {
  return error instanceof OfficialSupplyGateError && error.code === code;
}

function loadCharacters(): PilotCharacterFile[] {
  return Array.from({ length: 10 }, (_, index) => {
    const draftKey = `pilot-rf-${String(index + 1).padStart(2, "0")}`;
    const file = readJson<PilotCharacterFile>(path.join(CHAR_DIR, `${draftKey}.json`));
    if (!file.draft || !file.appearance || !file.assetPlan) {
      throw new Error(`${draftKey} is not locked through asset plan`);
    }
    return file;
  });
}

function ensureBatch(store: OfficialSupplyStore): void {
  try {
    const existing = store.getBatch(PILOT_STYLE_PROOF_BATCH_KEY);
    assertSame("pilot batch config", existing.config, PILOT_STYLE_PROOF_BATCH_CONFIG);
    if (existing.status !== "active") {
      throw new Error(`pilot batch is ${existing.status}: ${existing.pauseReason ?? ""}`);
    }
  } catch (error) {
    if (!missing(error, "batch_not_found")) throw error;
    store.createBatch(PILOT_STYLE_PROOF_BATCH_KEY, PILOT_STYLE_PROOF_BATCH_CONFIG);
  }
}

function ensureStyle(store: OfficialSupplyStore, source: PilotStyleFile): void {
  if (source.styleKey !== PILOT_STYLE_PROOF_STYLE_KEY) {
    throw new Error(`unexpected pilot style key ${source.styleKey}`);
  }
  let style: OfficialGenreStyle;
  try {
    style = store.getStyle(PILOT_STYLE_PROOF_STYLE_KEY);
    assertSame("pilot style candidates", style.candidates, source.candidates);
    if (style.proofAssetLimit !== PILOT_STYLE_PROOF_ASSET_LIMIT) {
      throw new Error(
        `pilot style proof limit is ${style.proofAssetLimit}; expected ${PILOT_STYLE_PROOF_ASSET_LIMIT}`
      );
    }
  } catch (error) {
    if (!missing(error, "style_not_found")) throw error;
    style = store.proposeStyle({
      styleKey: source.styleKey,
      genre: source.genre,
      candidates: source.candidates,
      proofAssetLimit: PILOT_STYLE_PROOF_ASSET_LIMIT,
    });
  }

  const seed = buildPilotStyleSeed();
  if (style.stage === "candidates_proposed") {
    style = store.approveStyleCandidate(
      PILOT_STYLE_PROOF_STYLE_KEY,
      PILOT_STYLE_PROOF_CANDIDATE_ID,
      seed,
      REVIEWER
    );
  }

  if (style.stage !== "candidate_approved") {
    throw new Error(
      `style ${style.styleKey} is ${style.stage}; expected candidate_approved. STOP before provider calls`
    );
  }
  if (style.approvedCandidateId !== PILOT_STYLE_PROOF_CANDIDATE_ID) {
    throw new Error(
      `style approved candidate is ${style.approvedCandidateId}; expected ${PILOT_STYLE_PROOF_CANDIDATE_ID}`
    );
  }
  assertSame("pilot style seed", style.styleSeed, seed);
}

function ensureCharacter(
  store: OfficialSupplyStore,
  file: PilotCharacterFile,
  isStyleProof: boolean
): void {
  let record;
  try {
    record = store.getCharacter(file.draftKey);
    assertSame(`${file.draftKey} draft`, record.draft, file.draft);
    if (record.isStyleProof !== isStyleProof) {
      throw new Error(
        `${file.draftKey} isStyleProof=${record.isStyleProof}; expected ${isStyleProof}. STOP instead of rewriting ownership state`
      );
    }
  } catch (error) {
    if (!missing(error, "character_not_found")) throw error;
    record = store.addCharacterDraft(PILOT_STYLE_PROOF_BATCH_KEY, file.draft, {
      isStyleProof,
    });
  }

  if (record.stage === "draft") {
    const qa = store.lockText(file.draftKey, { stagingUser: STAGING_USER });
    if (!qa.ok) {
      throw new OfficialSupplyGateError(
        "pilot_text_lock_failed",
        `${file.draftKey} TEXT_LOCK failed`,
        qa
      );
    }
    record = store.getCharacter(file.draftKey);
  }
  if (record.stage === "text_locked") {
    const qa = store.lockAppearance(file.draftKey, file.appearance);
    if (!qa.ok) {
      throw new OfficialSupplyGateError(
        "pilot_appearance_lock_failed",
        `${file.draftKey} APPEARANCE_LOCK failed`,
        qa
      );
    }
    record = store.getCharacter(file.draftKey);
  }
  if (record.stage === "appearance_locked") {
    const qa = store.lockAssetPlan(file.draftKey, file.assetPlan);
    if (!qa.ok) {
      throw new OfficialSupplyGateError(
        "pilot_asset_plan_lock_failed",
        `${file.draftKey} ASSET_PLAN_LOCK failed`,
        qa
      );
    }
    record = store.getCharacter(file.draftKey);
  }

  if (record.stage !== "asset_plan_locked") {
    throw new Error(
      `${file.draftKey} is ${record.stage}; expected asset_plan_locked before human proof review`
    );
  }
  assertSame(`${file.draftKey} appearance`, record.appearance, file.appearance);
  assertSame(`${file.draftKey} asset plan`, record.assetPlan, file.assetPlan);
}

async function main(): Promise<void> {
  if (!pilotStyleProofOptedIn()) {
    console.log(
      `[official-style-proof] NOT_RUN: set OFFICIAL_STYLE_PROOF_LIVE=1 and OFFICIAL_STYLE_PROOF_CANDIDATE=${PILOT_STYLE_PROOF_CANDIDATE_ID}`
    );
    return;
  }

  const store = new OfficialSupplyStore();
  const styleSource = readJson<PilotStyleFile>(
    path.join(PILOT_DIR, "style-candidates.json")
  );
  const characters = loadCharacters();

  ensureBatch(store);
  ensureStyle(store, styleSource);

  const proofSet = new Set<string>(PILOT_STYLE_PROOF_DRAFT_KEYS);
  for (const file of characters) {
    ensureCharacter(store, file, proofSet.has(file.draftKey));
  }

  if (store.evaluateBatchPortfolio(PILOT_STYLE_PROOF_BATCH_KEY).ok !== true) {
    throw new Error("pilot portfolio QA failed after canonical hydration");
  }

  const deps = {
    store,
    transport: openAiOfficialImageTransport,
    imageOps: sharpOfficialImageOps,
    storage: uploadOfficialAssetStorage,
    spool: fileOfficialAssetSpool(),
    workerId: WORKER_ID,
    env: process.env,
  };

  const proofs: Array<Record<string, unknown>> = [];
  for (const draftKey of PILOT_STYLE_PROOF_DRAFT_KEYS) {
    const before = store.getAsset(draftKey, PILOT_STYLE_PROOF_SLOT_KEY);
    if (before.kind !== "representative") {
      throw new Error(`${draftKey}/${PILOT_STYLE_PROOF_SLOT_KEY} is not representative`);
    }

    const outcome = await runOfficialAssetSlot(
      deps,
      draftKey,
      PILOT_STYLE_PROOF_SLOT_KEY
    );
    if (
      outcome.status !== "generated" &&
      outcome.status !== "already_generated"
    ) {
      throw new Error(
        `${draftKey} proof generation stopped with ${outcome.status}: ${"error" in outcome ? outcome.error : ""}`
      );
    }

    let asset = store.getAsset(draftKey, PILOT_STYLE_PROOF_SLOT_KEY);
    if (!asset.resultUrl) {
      throw new Error(`${draftKey} has no proof result URL after generation`);
    }
    if (!asset.moderation) {
      await moderateOfficialAssetSlot(
        { store, moderator: visionOfficialAssetModerator },
        draftKey,
        PILOT_STYLE_PROOF_SLOT_KEY
      );
      asset = store.getAsset(draftKey, PILOT_STYLE_PROOF_SLOT_KEY);
    }

    const moderation = officialModerationVerdict(asset.moderation);
    if (
      moderation === "missing" ||
      moderation === "unavailable" ||
      moderation === "rejected"
    ) {
      throw new Error(
        `${draftKey} moderation is ${moderation}; STOP before generating another proof`
      );
    }

    proofs.push({
      draftKey,
      name: store.getCharacter(draftKey).draft.name,
      resultUrl: asset.resultUrl,
      width: asset.width,
      height: asset.height,
      model: asset.model,
      attempts: asset.attempts,
      spentUsd: asset.spentUsd,
      hasUnknownCost: asset.hasUnknownCost,
      moderation: asset.moderation,
    });
  }

  const started = store.countStyleProofSlotsStarted(PILOT_STYLE_PROOF_STYLE_KEY);
  if (started !== PILOT_STYLE_PROOF_ASSET_LIMIT) {
    throw new Error(
      `proof attempts started=${started}; expected exactly ${PILOT_STYLE_PROOF_ASSET_LIMIT}`
    );
  }

  for (const file of characters) {
    for (const asset of store.listAssets(file.draftKey)) {
      if (
        asset.attempts > 0 &&
        !(
          proofSet.has(file.draftKey) &&
          asset.slotKey === PILOT_STYLE_PROOF_SLOT_KEY
        )
      ) {
        throw new Error(
          `unexpected paid slot started: ${file.draftKey}/${asset.slotKey}`
        );
      }
    }
  }

  const style = store.getStyle(PILOT_STYLE_PROOF_STYLE_KEY);
  if (style.stage !== "candidate_approved") {
    throw new Error(
      `style became ${style.stage}; human review must happen before STYLE_LOCK`
    );
  }

  fs.mkdirSync(PACKET_DIR, { recursive: true });
  const packet = {
    status: "PROOFS_GENERATED_AWAITING_HUMAN_REVIEW",
    styleKey: style.styleKey,
    candidateId: style.approvedCandidateId,
    styleStage: style.stage,
    styleSeed: style.styleSeed,
    proofAssetLimit: style.proofAssetLimit,
    proofCount: proofs.length,
    proofs,
    styleLocked: false,
    humanReviewRequired: true,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(PACKET_PATH, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  console.log(`[official-style-proof] packet=${PACKET_PATH}`);
  console.log(JSON.stringify(packet));
}

main().catch((error) => {
  console.error(
    "[official-style-proof] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
});
