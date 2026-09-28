import "server-only";

import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { compileOfficialDraftFromBible } from "@/lib/officialSupply/bible";
import { buildOfficialAssetPrompts } from "@/lib/officialSupply/imagePrompt";
import {
  OFFICIAL_ASSET_OUTPUT_COMPRESSION,
  officialImageProfileForSlot,
  resolveOfficialAssetImageModel,
} from "@/lib/officialSupply/imageProfile";
import { resolveOfficialSlotShot } from "@/lib/officialSupply/shotPlan";
import type { OfficialCharacterBible } from "@/lib/officialSupply/bible";
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

const LIVE_ENV = "OFFICIAL_QUALITY_SHOT_QA_LIVE";
const DRAFT_KEY = "pilot-rf-03";
const DEFAULT_ARTIFACT_DIR = "/opt/cursor/artifacts/official-shot-qa";
const MAX_SLOTS = 6;

function qaArtifactDir(): string {
  return process.env.OFFICIAL_QUALITY_SHOT_QA_ARTIFACT_DIR?.trim() || DEFAULT_ARTIFACT_DIR;
}

type PilotFile = {
  draftKey: string;
  brief: OfficialCharacterDraft["hook"] & { audience: OfficialCharacterDraft["audience"] };
  bible: OfficialCharacterBible;
  appearance: OfficialAppearanceLock;
  assetPlan: { slots: OfficialAssetSlotPlan[] };
};

type StyleFile = { candidates: Array<{ dna: VisualStyleDna }> };

function stop(reason: string, extra: Record<string, unknown> = {}): never {
  const artifactDir = qaArtifactDir();
  fs.mkdirSync(artifactDir, { recursive: true });
  const payload = { status: "STOP", reason, draftKey: DRAFT_KEY, providerCalls: extra.providerCalls ?? 0, ...extra };
  fs.writeFileSync(path.join(artifactDir, "STOP.json"), JSON.stringify(payload, null, 2));
  fs.writeFileSync(path.join(artifactDir, "STOP.md"), `# Official shot QA STOP\n\n${reason}\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n`);
  throw new Error(`OFFICIAL_QUALITY_SHOT_QA STOP: ${reason}`);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function pickQaSlots(slots: OfficialAssetSlotPlan[], draftKey: string): OfficialAssetSlotPlan[] {
  const scored = slots
    .filter((slot) => slot.kind !== "representative")
    .map((slot) => ({ slot, shot: resolveOfficialSlotShot(slot, draftKey) }));
  const pick = (pred: (row: (typeof scored)[number]) => boolean) => scored.find(pred)?.slot;
  const chosen = [
    pick((row) => row.shot.faceDirection.includes("three_quarter")),
    pick((row) => row.shot.faceDirection === "profile"),
    pick((row) => row.shot.cameraAngle === "high_angle"),
    pick((row) => row.shot.cameraAngle === "low_angle"),
    pick((row) => row.shot.distance === "medium" || row.shot.distance === "knee_or_full"),
    pick((row) => row.slot.kind === "scene"),
  ].filter((slot): slot is OfficialAssetSlotPlan => Boolean(slot));
  const unique = [...new Map(chosen.map((slot) => [slot.slotKey, slot])).values()];
  if (unique.length < 4) stop("could not cover required shot axes from the canonical plan");
  return unique.slice(0, MAX_SLOTS);
}

async function styleOnlyReference(): Promise<string> {
  const buffer = await sharp({
    create: { width: 1024, height: 1536, channels: 3, background: { r: 214, g: 196, b: 168 } },
  })
    .webp({ quality: 80 })
    .toBuffer();
  return `data:image/webp;base64,${buffer.toString("base64")}`;
}

async function resolveReference(): Promise<string> {
  const refPath = process.env.OFFICIAL_QUALITY_SHOT_QA_REFERENCE_PATH?.trim();
  if (!refPath) return styleOnlyReference();
  if (!fs.existsSync(refPath) || !fs.statSync(refPath).isFile()) {
    stop(`OFFICIAL_QUALITY_SHOT_QA_REFERENCE_PATH is set but the file is missing: ${refPath}`);
  }
  const ext = path.extname(refPath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/webp";
  return `data:${mime};base64,${fs.readFileSync(refPath).toString("base64")}`;
}

async function writeContactSheet(
  cells: Array<{ slotKey: string; shot: string; file: string }>
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
  const out = path.join(qaArtifactDir(), "contact-sheet.png");
  await sheet.png().toFile(out);
  const copyTo = process.env.OFFICIAL_QUALITY_SHOT_QA_CONTACT_SHEET_PATH?.trim();
  if (copyTo) {
    fs.mkdirSync(path.dirname(copyTo), { recursive: true });
    fs.copyFileSync(out, copyTo);
  }
  return copyTo || out;
}

async function main(): Promise<void> {
  if (process.env[LIVE_ENV] !== "1") {
    console.log(`[official-shot-qa] NOT_RUN: set ${LIVE_ENV}=1 for the bounded QA-only live proof`);
    return;
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    stop("OPENAI_API_KEY is not configured; cannot call the canonical official image provider");
  }

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
  const slots = pickQaSlots(file.assetPlan.slots, draft.draftKey);
  const reference = await resolveReference();
  const artifactDir = qaArtifactDir();
  fs.mkdirSync(artifactDir, { recursive: true });

  const calls: Array<Record<string, unknown>> = [];
  const cells: Array<{ slotKey: string; shot: string; file: string }> = [];
  let knownCost = 0;

  for (const slot of slots) {
    const shot = resolveOfficialSlotShot(slot, draft.draftKey);
    const profile = officialImageProfileForSlot(slot.kind);
    const prompts = buildOfficialAssetPrompts({
      draft,
      appearance: file.appearance,
      style: styles.candidates[0]!.dna,
      slot,
    });
    try {
      const result = await callOpenAiImageEditWithSafetyFallback({
        model: resolveOfficialAssetImageModel(),
        primaryPrompt: prompts.primaryPrompt,
        strictFallbackPrompt: prompts.strictFallbackPrompt,
        references: [reference],
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
        });
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
        });
      }
      throw error;
    }
  }

  const sheet = await writeContactSheet(cells);
  const report = {
    status: "GENERATED",
    draftKey: DRAFT_KEY,
    persistedToProduction: false,
    providerCalls: calls.length,
    knownCostUsd: Number(knownCost.toFixed(6)),
    contactSheet: sheet,
    slots: calls,
  };
  fs.writeFileSync(path.join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  if (error instanceof Error && error.message.startsWith("OFFICIAL_QUALITY_SHOT_QA STOP:")) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
