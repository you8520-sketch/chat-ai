import "server-only";

import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { compileOfficialDraftFromBible, type OfficialCharacterBible } from "@/lib/officialSupply/bible";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import {
  OFFICIAL_ASSET_OUTPUT_COMPRESSION,
  officialImageProfileForSlot,
  resolveOfficialAssetImageModel,
} from "@/lib/officialSupply/imageProfile";
import { resolveOfficialSlotShot } from "@/lib/officialSupply/shotPlan";
import type {
  OfficialAppearanceLock,
  OfficialAssetSlotPlan,
  OfficialCharacterDraft,
  VisualStyleDna,
} from "@/lib/officialSupply/types";
import {
  callOpenAiImageEditWithSafetyFallback,
  OpenAiImageGenerationError,
} from "@/lib/openAiImageSafetyFallback";
import { OpenAiImageError } from "@/lib/openAiImageEdit";
import {
  LUCIAN_SIG4_TRIAL_DRAFT_KEY,
  OFFICIAL_SHOT_QA_ARTIFACT_ENV,
  OFFICIAL_SHOT_QA_LIVE_ENV,
  OFFICIAL_SHOT_QA_MODE_ENV,
  OFFICIAL_SHOT_QA_REFERENCE_ENV,
  officialShotQaArtifactDir,
  pickDefaultOfficialShotQaSlots,
  pickLucianSig4TrialSlot,
  prepareLucianSig4Trial,
  resolveOfficialShotQaMode,
  type OfficialShotQaMode,
} from "@/lib/officialSupply/qualityShotQa";

const DEFAULT_MAX_SLOTS = 6;

function qaArtifactDir(mode: OfficialShotQaMode): string {
  return officialShotQaArtifactDir(mode, process.env[OFFICIAL_SHOT_QA_ARTIFACT_ENV]);
}

type PilotFile = {
  draftKey: string;
  brief: OfficialCharacterDraft["hook"] & { audience: OfficialCharacterDraft["audience"] };
  bible: OfficialCharacterBible;
  appearance: OfficialAppearanceLock;
  assetPlan: { slots: OfficialAssetSlotPlan[] };
};

type StyleFile = { candidates: Array<{ dna: VisualStyleDna }> };

function stop(reason: string, extra: Record<string, unknown> = {}, mode: OfficialShotQaMode = "default"): never {
  const artifactDir = qaArtifactDir(mode);
  fs.mkdirSync(artifactDir, { recursive: true });
  const payload = {
    status: "STOP",
    reason,
    draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
    providerCalls: extra.providerCalls ?? 0,
    persistedToProduction: false,
    ...extra,
  };
  fs.writeFileSync(path.join(artifactDir, "STOP.json"), JSON.stringify(payload, null, 2));
  fs.writeFileSync(
    path.join(artifactDir, "STOP.md"),
    `# Official shot QA STOP\n\n${reason}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`
  );
  throw new Error(`OFFICIAL_QUALITY_SHOT_QA STOP: ${reason}`);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

async function inspectReferenceAsync(filePath: string): Promise<{ width: number; height: number } | null> {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  try {
    const meta = await sharp(filePath, { failOn: "none" }).metadata();
    return meta.width && meta.height ? { width: meta.width, height: meta.height } : null;
  } catch {
    return null;
  }
}

function pickQaSlots(slots: OfficialAssetSlotPlan[], draftKey: string): OfficialAssetSlotPlan[] {
  const unique = pickDefaultOfficialShotQaSlots(slots, draftKey);
  if (unique.length < 4) stop("could not cover required shot axes from the canonical plan");
  return unique.slice(0, DEFAULT_MAX_SLOTS);
}

async function styleOnlyReference(): Promise<string> {
  const buffer = await sharp({
    create: { width: 1024, height: 1536, channels: 3, background: { r: 214, g: 196, b: 168 } },
  })
    .webp({ quality: 80 })
    .toBuffer();
  return `data:image/webp;base64,${buffer.toString("base64")}`;
}

async function resolveDefaultReference(): Promise<string> {
  const refPath = process.env[OFFICIAL_SHOT_QA_REFERENCE_ENV]?.trim();
  if (!refPath) return styleOnlyReference();
  if (!fs.existsSync(refPath) || !fs.statSync(refPath).isFile()) {
    stop(`${OFFICIAL_SHOT_QA_REFERENCE_ENV} is set but the file is missing: ${refPath}`);
  }
  const ext = path.extname(refPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/webp";
  return `data:${mime};base64,${fs.readFileSync(refPath).toString("base64")}`;
}

async function writeContactSheet(
  cells: Array<{ slotKey: string; shot: string; file: string }>,
  mode: OfficialShotQaMode
): Promise<string> {
  const tiles = await Promise.all(
    cells.map(async (cell) => {
      const image = sharp(cell.file).resize(512, 342, { fit: "cover" });
      const label = Buffer.from(
        `<svg width="512" height="48" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="48" fill="#121214"/><text x="12" y="30" fill="#f4f4f5" font-size="16">${cell.slotKey}: ${cell.shot}</text></svg>`
      );
      const labeled = await sharp({
        create: { width: 512, height: 390, channels: 3, background: { r: 18, g: 18, b: 20 } },
      })
        .composite([
          { input: await image.toBuffer(), top: 0, left: 0 },
          { input: label, top: 342, left: 0 },
        ])
        .png()
        .toBuffer();
      return labeled;
    })
  );
  const cols = Math.min(3, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const sheet = sharp({
    create: { width: cols * 512, height: rows * 390, channels: 3, background: { r: 8, g: 8, b: 10 } },
  }).composite(
    tiles.map((tile, index) => ({
      input: tile,
      left: (index % cols) * 512,
      top: Math.floor(index / cols) * 390,
    }))
  );
  const out = path.join(qaArtifactDir(mode), "contact-sheet.png");
  await sheet.png().toFile(out);
  const copyTo = process.env.OFFICIAL_QUALITY_SHOT_QA_CONTACT_SHEET_PATH?.trim();
  if (copyTo) {
    fs.mkdirSync(path.dirname(copyTo), { recursive: true });
    fs.copyFileSync(out, copyTo);
  }
  return copyTo || out;
}

function loadPilot(): {
  file: PilotFile;
  draft: OfficialCharacterDraft;
  styles: StyleFile;
} {
  const root = process.cwd();
  const file = readJson<PilotFile>(path.join(root, "src/lib/officialSupply/pilot/characters/pilot-rf-03.json"));
  const world = readJson<{ bible: { name: string } }>(path.join(root, "src/lib/officialSupply/pilot/world-bible.json"));
  const manifest = readJson<{ worldKey: string; styleKey: string }>(
    path.join(root, "src/lib/officialSupply/pilot/manifest.json")
  );
  const styles = readJson<StyleFile>(path.join(root, "src/lib/officialSupply/pilot/style-candidates.json"));
  const draft = compileOfficialDraftFromBible(file.bible, {
    draftKey: file.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"],
    audience: file.brief.audience,
    worldName: world.bible.name,
    hook: {
      archetype: file.brief.archetype,
      relationshipTrope: file.brief.relationshipTrope,
      occupation: file.brief.occupation,
      rpHook: file.brief.rpHook,
    },
  });
  return { file, draft, styles };
}

async function prepareLucianSig4(file: PilotFile, draft: OfficialCharacterDraft, styles: StyleFile) {
  const slotResult = pickLucianSig4TrialSlot(file.assetPlan.slots, draft.draftKey);
  if (!slotResult.ok) stop(slotResult.reason, {}, "lucian-sig4");
  const prompts = buildOfficialAssetPrompts({
    draft,
    appearance: file.appearance,
    style: styles.candidates[0]!.dna,
    slot: slotResult.slot,
  });
  const refPath = process.env[OFFICIAL_SHOT_QA_REFERENCE_ENV]?.trim() ?? "";
  const dims = refPath ? await inspectReferenceAsync(refPath) : null;
  const plan = prepareLucianSig4Trial({
    draftKey: draft.draftKey,
    slots: file.assetPlan.slots,
    appearance: file.appearance,
    referencePath: refPath,
    inspectImage: () => dims,
    artifactDir: process.env[OFFICIAL_SHOT_QA_ARTIFACT_ENV],
    identityAnchorPrompt: prompts.primaryPrompt,
  });
  const artifactDir = qaArtifactDir("lucian-sig4");
  fs.mkdirSync(artifactDir, { recursive: true });
  if (!plan.ok) stop(plan.reason, { model: resolveOfficialAssetImageModel() }, "lucian-sig4");
  fs.writeFileSync(path.join(artifactDir, "PREPARE.json"), JSON.stringify({ ...plan, model: resolveOfficialAssetImageModel() }, null, 2));
  return { plan, prompts, slot: slotResult.slot, shot: slotResult.shot };
}

async function generateSlots(input: {
  mode: OfficialShotQaMode;
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
  style: VisualStyleDna;
  slots: OfficialAssetSlotPlan[];
  reference: string;
}): Promise<void> {
  const artifactDir = qaArtifactDir(input.mode);
  fs.mkdirSync(artifactDir, { recursive: true });
  const calls: Array<Record<string, unknown>> = [];
  const cells: Array<{ slotKey: string; shot: string; file: string }> = [];
  let knownCost = 0;

  for (const slot of input.slots) {
    const shot = resolveOfficialSlotShot(slot, input.draft.draftKey);
    const profile = officialImageProfileForSlot(slot.kind);
    const prompts = buildOfficialAssetPrompts({
      draft: input.draft,
      appearance: input.appearance,
      style: input.style,
      slot,
    });
    try {
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: resolveOfficialAssetImageModel(),
        primaryPrompt: prompts.primaryPrompt,
        strictFallbackPrompt: prompts.strictFallbackPrompt,
        references: [input.reference],
        size: profile.size,
        quality: "medium",
        outputCompression: OFFICIAL_ASSET_OUTPUT_COMPRESSION,
        templateId: "official_character_asset",
        mode: "official_character_asset",
      });
      if (result.hasUnknownAttemptCost || result.knownProviderCostUsd == null) {
        stop("unknown provider cost on a live attempt", {
          slotKey: slot.slotKey,
          providerCalls: calls.length + 1,
        }, input.mode);
      }
      knownCost += result.knownProviderCostUsd;
      const filePath = path.join(artifactDir, `${slot.slotKey}.webp`);
      fs.writeFileSync(filePath, result.buffer);
      const shotLabel = `${shot.faceDirection} / ${shot.cameraAngle} / ${shot.distance} / ${shot.poseFamily}`;
      cells.push({ slotKey: slot.slotKey, shot: shotLabel, file: filePath });
      calls.push({
        slotKey: slot.slotKey,
        shot: shotLabel,
        costUsd: result.knownProviderCostUsd,
        safetyFallbackUsed: result.safetyFallbackUsed,
      });
    } catch (error) {
      if (error instanceof OpenAiImageGenerationError || error instanceof OpenAiImageError) {
        stop(`provider or moderation failure: ${error.message}`, {
          slotKey: slot.slotKey,
          providerCalls: calls.length + 1,
        }, input.mode);
      }
      throw error;
    }
  }

  const sheet = await writeContactSheet(cells, input.mode);
  const report = {
    status: "GENERATED",
    draftKey: LUCIAN_SIG4_TRIAL_DRAFT_KEY,
    persistedToProduction: false,
    providerCalls: calls.length,
    knownCostUsd: Number(knownCost.toFixed(6)),
    contactSheet: sheet,
    slots: calls,
  };
  fs.writeFileSync(path.join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function main(): Promise<void> {
  const modeResult = resolveOfficialShotQaMode(process.env[OFFICIAL_SHOT_QA_MODE_ENV]);
  if (!modeResult.ok) stop(modeResult.reason);
  const mode = modeResult.mode;
  const live = process.env[OFFICIAL_SHOT_QA_LIVE_ENV] === "1";

  if (mode === "lucian-sig4") {
    const { file, draft, styles } = loadPilot();
    const prepared = await prepareLucianSig4(file, draft, styles);
    if (!live) {
      console.log(
        `[official-shot-qa] PREPARE lucian-sig4: set ${OFFICIAL_SHOT_QA_LIVE_ENV}=1 after cost approval to generate one private review file`
      );
      console.log(JSON.stringify({ ...prepared.plan, model: resolveOfficialAssetImageModel() }, null, 2));
      return;
    }
    if (!process.env.OPENAI_API_KEY?.trim()) {
      stop("OPENAI_API_KEY is not configured; cannot call the canonical official image provider", {}, mode);
    }
    const refPath = prepared.plan.referencePath;
    const ext = path.extname(refPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/webp";
    const reference = `data:${mime};base64,${fs.readFileSync(refPath).toString("base64")}`;
    await generateSlots({
      mode,
      draft,
      appearance: file.appearance,
      style: styles.candidates[0]!.dna,
      slots: [prepared.slot],
      reference,
    });
    return;
  }

  if (!live) {
    console.log(`[official-shot-qa] NOT_RUN: set ${OFFICIAL_SHOT_QA_LIVE_ENV}=1 for the bounded QA-only live proof`);
    return;
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    stop("OPENAI_API_KEY is not configured; cannot call the canonical official image provider");
  }

  const { file, draft, styles } = loadPilot();
  const slots = pickQaSlots(file.assetPlan.slots, draft.draftKey);
  const reference = await resolveDefaultReference();
  await generateSlots({
    mode,
    draft,
    appearance: file.appearance,
    style: styles.candidates[0]!.dna,
    slots,
    reference,
  });
}

main().catch((error) => {
  if (error instanceof Error && error.message.startsWith("OFFICIAL_QUALITY_SHOT_QA STOP:")) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
