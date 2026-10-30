import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { computeAppearanceLockHash } from "@/lib/officialSupply/appearance";
import { OFFICIAL_ASSET_DEFAULT_QUALITY, OFFICIAL_ASSET_OUTPUT_COMPRESSION } from "@/lib/officialSupply/imageProfile";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import {
  officialReviewCandidateReference,
  prepareOfficialImageReferences,
} from "@/lib/officialSupply/referencePreparation";
import { composeOfficialSlotGeneration } from "@/lib/officialSupply/runner";
import { resolveOfficialSlotShot } from "@/lib/officialSupply/shotPlan";
import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import type {
  OfficialAssetPlan,
  OfficialCharacterRecord,
  StyleReference,
} from "@/lib/officialSupply/types";
import { callOpenAiImageEdit, OpenAiImageError } from "@/lib/openAiImageEdit";

/**
 * Wolfgang #51 NEW representative, one call per model, nothing else.
 *
 * Isolation: reads repo files only. No database, no storage, no upload, no deploy; the provider key stays
 * in process.env and is never printed or written. Raw bytes and the ledger go to --out (default
 * $TMPDIR). `preflight` makes zero provider calls and is safe anywhere. Outside tests the Wolfgang
 * source is read from the approved private file on the data volume (read only); a checkout without it
 * stops at `approved_source_missing`, and NODE_TEST_CONTEXT=1 uses the public sheet for a dry run only. `post` needs
 * WOLFGANG_REP_AB_LIVE=1 and refuses to run twice into the same --out.
 *
 * The same composed prompt, reference list, order, size and API settings are sent to both models.
 * The reference subset is chosen once from the user's 8 Wolfgang style references and rides the
 * existing style-seed owner (url + styleOnlyVisualReferences, max 3). The 2.0 apocalypse examples
 * are never inputs.
 */
const WOLFGANG_KEY = "pilot-rf-02";
const REFERENCE_ROOT = "docs/official-supply/reviews/assets/wolfgang-asset-redesign/reattach-2026-10-17";
const MODELS = [
  { arm: "A", model: "gpt-image-2" },
  { arm: "B", model: "gpt-image-2.5-sunburst" },
] as const;
const APPEARANCE_LOCK_HASH = "1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3";
const APPROVED_ASSET_PLAN_PATH = "src/lib/officialSupply/pilot/fixtures/pilot-rf-02-approved-asset-plan-f.json";
/**
 * The one canonical primary-prompt SHA for this experiment. Every source of the Wolfgang manuscript
 * (public sheet, frozen approved c91ba66a fixture, the private approved file on the data volume) feeds
 * the image prompt through the same fields (name, age, Appearance Lock, rep expression/pose/outfit),
 * so the SHA must be identical on any machine; a mismatch stops the run before any provider call.
 */
const EXPECTED_PRIMARY_PROMPT_SHA256 = "4245452eb05dc13608927efd0fafd8ceac80678d80daee4d14fe2f85d6ce1269";

/**
 * The approved rep pose carries no facing direction: the shot owner decides the head direction
 * (left_three_quarter for this identity). The run stops if the approved plan's pose ever changes, so the
 * canonical primary prompt SHA keeps meaning the same prompt.
 */
const APPROVED_REP_POSE = "갑옷을 입은 채 서서 한 손을 검 손잡이에 얹는다";

/**
 * Files whose PR revision must be the code that actually runs. On Railway the repo is an overlay over
 * the deployed main tree; these markers prove the overlay, not main, produced the prompt.
 */
const OWNER_FILES = [
  "src/lib/officialSupply/imagePrompt.ts",
  "src/lib/officialSupply/shotPlan.ts",
  "src/lib/officialSupply/style.ts",
  "src/lib/officialSupply/runner.ts",
  "src/lib/officialSupply/referencePreparation.ts",
  "src/lib/officialSupply/imageProfile.ts",
  "src/lib/openAiImageEdit.ts",
] as const;
const PR_ONLY_PROMPT_MARKERS = [
  "head turned left three-quarter view",
  "Do not inherit any reference image's camera, head angle, gaze, crop, or hand position.",
  "Match the supplied style image's own line weight, coloring, and detail density.",
  "큰 덩어리 단위로 묶인 머리칼",
] as const;

/** Conservative FX so the KRW cap holds even if the real rate is above the planning rate. */
const KRW_PER_USD = 1500;
const HARD_CAP_KRW = 1000;
const CAP_SAFETY_FRACTION = 0.9;
const DEFAULT_BUDGET_USD = 0.35;
const RESERVE_PER_CALL_USD = 0.12;
/**
 * callOpenAiImageEdit prices usage at gpt-image-2 token rates for every model, so the 2.5 arm's real
 * provider price is not known to the code. Observed sunburst calls were 0.027-0.058 USD; the second
 * call is only allowed when spent + max(floor, measured first call x multiplier) stays under the cap.
 */
const SECOND_CALL_FLOOR_USD = 0.06;
const SECOND_CALL_PRICE_UNCERTAINTY = 2;

/**
 * Purpose-picked subset. ref_03 is excluded on purpose: the earlier representative was an in-place
 * edit of it, so it carries exactly the composition this experiment must not reproduce.
 */
const REFERENCE_SELECTION = [
  {
    file: "07-eval_style.webp",
    sha256: "a16790562b7b785fe3bac7d2bd33146d949a35c536e3ccb53627a25ed3481c5d",
    purpose: "face, skin, hair and dense gold embroidery rendering; line weight",
  },
  {
    file: "04-eval_style.webp",
    sha256: "3c0326588b3a0942dacaa15526a894f1d88b823976b5396e96f33a55c22441a8",
    purpose: "fur, chain and metal highlight rendering",
  },
  {
    file: "08-eval_style.webp",
    sha256: "587b71baf0a90df413c35ceeed5dbc256e61f90b497b8800d700fb212f75159b",
    purpose: "constant line weight and jacket ornament next to the face",
  },
] as const;

function sha256(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function styleSeed(): StyleReference {
  const [primary, ...companions] = REFERENCE_SELECTION.map((item) => ({
    url: officialReviewCandidateReference(`${REFERENCE_ROOT}/${item.file}`, item.sha256),
    provenance: "platform_owned" as const,
    note: `STYLE ONLY — ${item.purpose}`,
  }));
  return {
    ...primary!,
    styleCluster: "cluster_b_graphic",
    note: "STYLE ONLY — user-provided Wolfgang style references (selected subset). Never copy reference identity; Appearance Lock wins.",
    styleOnlyVisualReferences: companions,
  };
}

function compose(model: string) {
  const compiled = loadCompiledOfficialCharacterSource(WOLFGANG_KEY);
  const lockHash = computeAppearanceLockHash(compiled.appearanceLock);
  if (lockHash !== APPEARANCE_LOCK_HASH) throw new Error(`Appearance Lock drifted: ${lockHash}`);
  const approvedPlan = JSON.parse(fs.readFileSync(path.join(process.cwd(), APPROVED_ASSET_PLAN_PATH), "utf8")) as {
    assetPlan: OfficialAssetPlan;
  };
  const approvedRep = approvedPlan.assetPlan.slots.find((slot) => slot.slotKey === "rep");
  if (approvedRep?.pose !== APPROVED_REP_POSE) throw new Error("approved rep pose changed; re-check the canonical prompt SHA");
  const pilot = { assetPlan: approvedPlan.assetPlan };
  const character: OfficialCharacterRecord = {
    draftKey: WOLFGANG_KEY,
    batchKey: "pilot-romance-fantasy-04-cluster-b",
    worldKey: compiled.worldKey,
    styleKey: compiled.draft.styleKey,
    stage: "asset_plan_locked",
    draft: compiled.draft,
    textLockHash: null,
    appearance: compiled.appearanceLock,
    appearanceLockHash: null,
    assetPlan: pilot.assetPlan,
    isStyleProof: false,
    stagedCharacterId: null,
  };
  const candidate = { ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID), dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA };
  const composed = composeOfficialSlotGeneration({
    character,
    style: {
      styleKey: compiled.draft.styleKey,
      genre: "로맨스 판타지",
      stage: "style_locked",
      candidates: [candidate],
      approvedCandidateId: candidate.candidateId,
      styleSeed: styleSeed(),
      proofAssetLimit: 1,
    },
    slotKey: "rep",
    representativeUrl: null,
    env: { OFFICIAL_ASSET_IMAGE_MODEL: model },
  });
  if (!composed.ok) throw new Error(composed.error);
  if (composed.referenceRoleLayout !== "slot_default") throw new Error(`layout ${composed.referenceRoleLayout}`);
  if (composed.model !== model) throw new Error(`model ${composed.model}`);
  const repSlot = pilot.assetPlan.slots.find((slot) => slot.slotKey === "rep")!;
  return { composed, shot: resolveOfficialSlotShot(repSlot, WOLFGANG_KEY) };
}

async function preparedEvidence(references: readonly string[]) {
  const prepared = await prepareOfficialImageReferences([...references], {});
  return Promise.all(
    prepared.map(async (dataUrl, index) => {
      const bytes = Buffer.from(/^data:[^;]+;base64,([\s\S]+)$/.exec(dataUrl)![1]!, "base64");
      const meta = await sharp(bytes).metadata();
      return {
        imageIndex: index + 1,
        token: references[index],
        purpose: REFERENCE_SELECTION[index]?.purpose,
        preparedSha256: sha256(bytes),
        preparedBytes: bytes.length,
        width: meta.width ?? null,
        height: meta.height ?? null,
      };
    })
  );
}

function assertCostCap(budgetUsd: number): void {
  const reserveKrw = RESERVE_PER_CALL_USD * MODELS.length * KRW_PER_USD;
  if (budgetUsd * KRW_PER_USD >= HARD_CAP_KRW * CAP_SAFETY_FRACTION) throw new Error("budget is too close to the 1,000 KRW cap");
  if (reserveKrw >= HARD_CAP_KRW * CAP_SAFETY_FRACTION) throw new Error("reserved cost is too close to the 1,000 KRW cap");
}

/** Decides whether the next call may start, from what the previous calls actually cost. */
export function nextCallDecision(input: { budgetUsd: number; spentUsd: number; previousCostUsd: number | null }) {
  const worstCaseUsd =
    input.previousCostUsd == null
      ? RESERVE_PER_CALL_USD
      : Math.max(SECOND_CALL_FLOOR_USD, input.previousCostUsd * SECOND_CALL_PRICE_UNCERTAINTY);
  const projectedKrw = (input.spentUsd + worstCaseUsd) * KRW_PER_USD;
  const safe =
    input.spentUsd + worstCaseUsd <= input.budgetUsd && projectedKrw < HARD_CAP_KRW * CAP_SAFETY_FRACTION;
  return { safe, worstCaseUsd, projectedKrw: Math.round(projectedKrw) };
}

function ownerFingerprints(): Record<string, string> {
  return Object.fromEntries(
    OWNER_FILES.map((file) => [file, sha256(fs.readFileSync(path.join(process.cwd(), file)))])
  );
}

function assertPrOwnersRan(prompt: string): void {
  const missing = PR_ONLY_PROMPT_MARKERS.filter((marker) => !prompt.includes(marker));
  if (missing.length) throw new Error(`prompt lacks PR owner markers (stale main modules?): ${missing.length} missing`);
  const manifestIndex = process.argv.indexOf("--owners-manifest");
  if (manifestIndex < 0) return;
  const expected = JSON.parse(fs.readFileSync(process.argv[manifestIndex + 1]!, "utf8")) as Record<string, string>;
  const actual = ownerFingerprints();
  for (const file of OWNER_FILES) {
    if (expected[file] !== actual[file]) throw new Error(`owner file differs from the PR head: ${file}`);
  }
}

async function buildRequestEvidence() {
  const arms = MODELS.map((arm) => ({ ...arm, ...compose(arm.model) }));
  const [first] = arms;
  for (const arm of arms) {
    if (arm.composed.primaryPrompt !== first!.composed.primaryPrompt) throw new Error("prompt differs between arms");
    if (JSON.stringify(arm.composed.references) !== JSON.stringify(first!.composed.references)) {
      throw new Error("references differ between arms");
    }
    if (arm.composed.profile.size !== first!.composed.profile.size) throw new Error("size differs between arms");
  }
  const primaryPromptSha256 = sha256(first!.composed.primaryPrompt);
  assertPrOwnersRan(first!.composed.primaryPrompt);
  if (EXPECTED_PRIMARY_PROMPT_SHA256 && primaryPromptSha256 !== EXPECTED_PRIMARY_PROMPT_SHA256) {
    throw new Error(`primary prompt SHA ${primaryPromptSha256} is not the canonical ${EXPECTED_PRIMARY_PROMPT_SHA256}`);
  }
  const references = await preparedEvidence(first!.composed.references);
  return {
    arms,
    evidence: {
      providerPosts: 0,
      appearanceLockHash: APPEARANCE_LOCK_HASH,
      slotKey: "rep",
      referenceRoleLayout: first!.composed.referenceRoleLayout,
      shot: first!.shot,
      size: first!.composed.profile.size,
      quality: OFFICIAL_ASSET_DEFAULT_QUALITY,
      outputCompression: OFFICIAL_ASSET_OUTPUT_COMPRESSION,
      background: "opaque",
      n: 1,
      endpoint: "POST /v1/images/edits (multipart image[] in listed order)",
      models: MODELS.map((m) => ({ arm: m.arm, model: m.model })),
      primaryPromptSha256,
      canonicalPrimaryPromptSha256: EXPECTED_PRIMARY_PROMPT_SHA256 || null,
      ownerFingerprints: ownerFingerprints(),
      approvedRepPose: APPROVED_REP_POSE,
      strictFallbackPromptSha256: sha256(first!.composed.strictFallbackPrompt),
      references,
      excludedFromInputs: ["apocalypse 2.0 examples (reattach manifest items 09-11)", "reference 03 (clone origin)"],
      reservePerCallUsd: RESERVE_PER_CALL_USD,
      fallback: false,
      retry: false,
    },
  };
}

function outDir(): string {
  const index = process.argv.indexOf("--out");
  const dir = index >= 0 ? process.argv[index + 1] : path.join(process.env.TMPDIR ?? "/tmp", "wolfgang-rep-model-ab");
  if (!dir) throw new Error("--out needs a directory");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function preflight(): Promise<void> {
  const out = outDir();
  const { arms, evidence } = await buildRequestEvidence();
  fs.writeFileSync(path.join(out, "rep-prompt.txt"), `${arms[0]!.composed.primaryPrompt}\n`);
  fs.writeFileSync(path.join(out, "preflight.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ status: "PREFLIGHT", providerPosts: 0, out, primaryPromptSha256: evidence.primaryPromptSha256 }));
}

function publicError(error: unknown) {
  if (error instanceof OpenAiImageError) {
    return { errorStatus: error.status, errorMessage: error.message.slice(0, 300), costUsd: error.diagnostic?.computedCostUsd ?? null };
  }
  return { errorStatus: 0, errorMessage: error instanceof Error ? error.message.slice(0, 300) : "unknown", costUsd: null };
}

async function post(): Promise<void> {
  if (process.env.WOLFGANG_REP_AB_LIVE !== "1") throw new Error("set WOLFGANG_REP_AB_LIVE=1 for the paid run");
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is empty in this process");
  const budgetUsd = Number(process.env.WOLFGANG_REP_AB_BUDGET_USD ?? DEFAULT_BUDGET_USD);
  assertCostCap(budgetUsd);
  const out = outDir();
  const ledgerPath = path.join(out, "ledger.json");
  if (fs.existsSync(ledgerPath)) throw new Error("ledger exists: this A/B was already sent; no re-draw");
  const { arms, evidence } = await buildRequestEvidence();
  const prompt = arms[0]!.composed.primaryPrompt;
  const prepared = await prepareOfficialImageReferences([...arms[0]!.composed.references], {});
  const ledger: { budgetUsd: number; spentUsd: number; haltedReason: string | null; arms: Record<string, unknown> } = {
    budgetUsd,
    spentUsd: 0,
    haltedReason: null,
    arms: {},
  };
  fs.writeFileSync(path.join(out, "request.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  let previousCostUsd: number | null = null;
  for (const [index, arm] of arms.entries()) {
    const decision = nextCallDecision({ budgetUsd, spentUsd: ledger.spentUsd, previousCostUsd: index === 0 ? null : previousCostUsd });
    if (!decision.safe || (index > 0 && previousCostUsd == null)) {
      ledger.haltedReason = "budget_reserve";
      ledger.arms[arm.arm] = { model: arm.model, skipped: true, ...decision };
      break;
    }
    const startedAt = Date.now();
    try {
      const result = await callOpenAiImageEdit({
        model: arm.model,
        prompt,
        references: prepared,
        size: arm.composed.profile.size,
        quality: OFFICIAL_ASSET_DEFAULT_QUALITY,
        outputCompression: OFFICIAL_ASSET_OUTPUT_COMPRESSION,
        templateId: "official_character_asset",
        mode: "wolfgang_rep_model_ab",
      });
      const file = path.join(out, `rep-${arm.arm}-${arm.model}.webp`);
      fs.writeFileSync(file, result.buffer);
      previousCostUsd = result.costUsd;
      ledger.spentUsd += result.costUsd ?? RESERVE_PER_CALL_USD;
      ledger.arms[arm.arm] = {
        model: arm.model,
        durationMs: Date.now() - startedAt,
        costUsd: result.costUsd,
        costKrwApprox: result.costUsd == null ? null : Math.round(result.costUsd * KRW_PER_USD),
        providerRequestId: result.providerRequestId,
        usageEvidence: result.usageEvidence,
        raw: { file: path.basename(file), sha256: sha256(result.buffer), bytes: result.buffer.length },
      };
    } catch (error) {
      ledger.arms[arm.arm] = { model: arm.model, durationMs: Date.now() - startedAt, ...publicError(error) };
      ledger.haltedReason = "provider_error";
      break;
    }
  }
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(JSON.stringify({ status: ledger.haltedReason ?? "DONE", spentUsd: ledger.spentUsd, out }));
  if (ledger.haltedReason) process.exitCode = 2;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "preflight") return preflight();
  if (mode === "post") return post();
  throw new Error("usage: wolfgang-rep-model-ab.ts preflight|post [--out DIR]");
}

if (process.argv[1]?.endsWith("wolfgang-rep-model-ab.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message.slice(0, 400) : String(error));
    process.exit(1);
  });
}
