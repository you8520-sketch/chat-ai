import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { computeAppearanceLockHash } from "@/lib/officialSupply/appearance";
import {
  compileOfficialDraftFromBible,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import { OFFICIAL_ASSET_OUTPUT_COMPRESSION } from "@/lib/officialSupply/imageProfile";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import { isLucianSig4ProofSupportedImageModel } from "@/lib/officialSupply/qualityShotQa";
import {
  officialReviewCandidateReference,
  prepareOfficialImageReferences,
} from "@/lib/officialSupply/referencePreparation";
import { composeOfficialSlotGeneration } from "@/lib/officialSupply/runner";
import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import type {
  OfficialAppearanceLock,
  OfficialAssetPlan,
  OfficialAssetSlotPlan,
  OfficialCharacterDraft,
  OfficialCharacterRecord,
} from "@/lib/officialSupply/types";
import { buildClusterBRofanStyleSeed } from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { callOpenAiImageEdit, OpenAiImageError } from "@/lib/openAiImageEdit";

const DOC = path.join(process.cwd(), "docs/official-supply/reviews/assets/wolfgang-asset-redesign");
const ART = "/opt/cursor/artifacts";
const F_RELATIVE = "docs/official-supply/reviews/assets/wolfgang-asset-redesign/rep-f-raw.webp";
const F_SHA = "a95f9aca91a09a4bf1cd2e13bab5c0bd226f8972bb2bf60990a66891150f8032";
const F_REFERENCE = officialReviewCandidateReference(F_RELATIVE, F_SHA);
const LOCK_HASH = "1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3";
const MODEL = "gpt-image-2.5-sunburst";
const BUDGET = 0.08;
const SIZE = "1536x1024";
const LEDGER = path.join(DOC, "emo5-r2-ledger.json");
const PREFIX = "emo5-r2";
const PREVIOUS_PROMPT = path.join(DOC, "emo5-ease-f-owner-prompt.txt");
const PROTECTED = [
  "remaining-10-f-ledger.json",
  "emo5-ease-f-actual.json",
  "emo-f-candidates-ledger.json",
  "emo6-r2-ledger.json",
  "emo6-r2-actual.json",
  "sig4-smile-f-actual.json",
];

const slot: OfficialAssetSlotPlan = {
  slotKey: "emo5",
  kind: "emotion",
  tag: "편안함",
  expression: "눈꺼풀을 조금 낮추고 미간과 입술의 힘을 뺀 편안함. 눈은 뜨고 입술은 부드럽게 다문다.",
  pose: "돌벽에 등을 가볍게 기대고 한쪽 다리에 체중을 싣는다. 어깨와 팔꿈치와 손의 힘을 풀어 편하게 쉰다. 손은 비어 있다.",
  outfit: "default",
  location: null,
  situation: null,
  characterPresence: "required",
  depiction: "standard",
  personTag: null,
  imageSubjects: { foreground: "solo_character", backgroundExtras: "none" },
};

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function writeJson(file: string, payload: unknown): void {
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(ART, { recursive: true });
  fs.writeFileSync(file, text);
  fs.writeFileSync(path.join(ART, path.basename(file)), text);
}

function protectedHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of PROTECTED) {
    out[name] = sha256(fs.readFileSync(path.join(DOC, name)));
  }
  return out;
}

function assertProtected(before: Record<string, string>): void {
  const after = protectedHashes();
  for (const name of PROTECTED) {
    if (after[name] !== before[name]) throw new Error(`protected record changed: ${name}`);
  }
}

function wolfgangCharacter(
  draft: OfficialCharacterDraft,
  appearance: OfficialAppearanceLock,
  plan: OfficialAssetPlan
): OfficialCharacterRecord {
  return {
    draftKey: "pilot-rf-02",
    batchKey: "pilot-romance-fantasy-04-cluster-b",
    worldKey: draft.worldKey,
    styleKey: draft.styleKey,
    stage: "asset_plan_locked",
    draft,
    textLockHash: null,
    appearance,
    appearanceLockHash: null,
    assetPlan: plan,
    isStyleProof: false,
    stagedCharacterId: null,
  };
}

function loadContext() {
  const characterFile = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/pilot/characters/pilot-rf-02.json"), "utf8")
  ) as {
    slot: number;
    draftKey: string;
    bible: OfficialCharacterBible;
    appearance: OfficialAppearanceLock;
    assetPlan: OfficialAssetPlan;
    brief: { audience: OfficialCharacterDraft["audience"] };
  };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/pilot/manifest.json"), "utf8")
  ) as { worldKey: string; styleKey: string };
  const world = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "src/lib/officialSupply/pilot/world-bible.json"), "utf8")
  ) as { bible: OfficialWorldBible };
  const lockHash = computeAppearanceLockHash(characterFile.appearance);
  if (lockHash !== LOCK_HASH) throw new Error(`Appearance Lock drifted: ${lockHash}`);
  const brief = world.bible.portfolio.find((item) => item.slot === characterFile.slot);
  if (!brief) throw new Error("portfolio brief missing");
  const draft = compileOfficialDraftFromBible(characterFile.bible, {
    draftKey: characterFile.draftKey,
    worldKey: manifest.worldKey,
    styleKey: manifest.styleKey,
    genres: ["로맨스 판타지"],
    audience: characterFile.brief.audience,
    worldName: world.bible.name,
    worldBible: world.bible,
    hook: {
      archetype: brief.archetype,
      relationshipTrope: brief.relationshipTrope,
      occupation: brief.occupation,
      rpHook: brief.rpHook,
    },
  });
  const styleSeed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://hav.chat" });
  const candidate = {
    ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID),
    dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA,
  };
  return {
    draft,
    appearance: characterFile.appearance,
    assetPlan: characterFile.assetPlan,
    style: {
      styleKey: draft.styleKey,
      genre: "로맨스 판타지",
      stage: "style_locked" as const,
      candidates: [candidate],
      approvedCandidateId: candidate.candidateId,
      styleSeed,
      proofAssetLimit: 1,
    },
  };
}

function compose() {
  const ctx = loadContext();
  const plan: OfficialAssetPlan = {
    slots: ctx.assetPlan.slots.map((entry) => (entry.slotKey === slot.slotKey ? slot : entry)),
  };
  const composed = composeOfficialSlotGeneration({
    character: wolfgangCharacter(ctx.draft, ctx.appearance, plan),
    style: ctx.style,
    representativeUrl: "https://hav.chat/uploads/official-pilot-rf-v4-02__rep-a1.webp",
    env: { OFFICIAL_ASSET_IMAGE_MODEL: MODEL },
    samePersonIdentityStyleUrl: F_REFERENCE,
    slotKey: slot.slotKey,
  });
  if (!composed.ok) throw new Error(composed.error);
  if (composed.referenceRoleLayout !== "identity_and_style") {
    throw new Error(`layout ${composed.referenceRoleLayout}`);
  }
  if (composed.profile.size !== SIZE) throw new Error(`size ${composed.profile.size}`);
  if (!composed.primaryPrompt.includes("MATURE MALE VISUAL AGE LOCK")) throw new Error("missing age lock");
  if (!composed.primaryPrompt.includes("IDENTITY LOCK")) throw new Error("missing identity lock");
  if (!composed.primaryPrompt.includes("SHOT RESPONSIBILITY (emo5/emotion)")) {
    throw new Error("emo5 shot responsibility missing");
  }
  if (!composed.primaryPrompt.includes("both the identity source and the style source")) {
    throw new Error("missing identity_and_style rule");
  }
  if (
    composed.primaryPrompt.includes("STYLE ONLY") ||
    composed.primaryPrompt.includes("ART STYLE (structured attributes")
  ) {
    throw new Error("style-only or DNA reinserted");
  }
  if (composed.references.length !== 1 || composed.references[0] !== F_REFERENCE) {
    throw new Error(`unexpected references: ${JSON.stringify(composed.references)}`);
  }
  return composed;
}

function expressionAndPose(prompt: string): { expression: string; pose: string } {
  const expression = /Expression: (.*?)\. Pose: /.exec(prompt)?.[1];
  const pose = /Pose: (.*?)\. Outfit: /.exec(prompt)?.[1];
  if (!expression || !pose) throw new Error("expression or pose line missing");
  return { expression, pose };
}

function writePoseExpressionDiff(nextPrompt: string): void {
  const previous = fs.readFileSync(PREVIOUS_PROMPT, "utf8").replace(/\n$/, "");
  const previousParts = expressionAndPose(previous);
  const nextParts = expressionAndPose(nextPrompt);
  if (previousParts.expression === nextParts.expression) throw new Error("expression did not change");
  if (previousParts.pose === nextParts.pose) throw new Error("pose did not change");
  if (!nextParts.expression.includes("눈은 뜨고") || !nextParts.expression.includes("입술은 부드럽게 다문다")) {
    throw new Error("visible rest expression missing");
  }
  if (!nextParts.pose.includes("돌벽에 등을 가볍게 기대") || !nextParts.pose.includes("한쪽 다리에 체중")) {
    throw new Error("visible rest pose missing");
  }
  for (const banned of ["눈을 감거나", "웃지 않는다", "창가에 앉아"]) {
    if (nextParts.expression.includes(banned) || nextParts.pose.includes(banned)) {
      throw new Error(`prohibition list returned: ${banned}`);
    }
  }
  const previousLines = previous.split("\n");
  const nextLines = nextPrompt.split("\n");
  if (previousLines.length !== nextLines.length) throw new Error("prompt line count drifted");
  const changed = previousLines.flatMap((line, index) => (line === nextLines[index] ? [] : [index]));
  if (changed.length !== 1) throw new Error(`changed ${changed.length} lines`);
  const diff = [
    "--- emo5-ease-f-owner-prompt.txt",
    "+++ emo5-r2-owner-prompt.txt",
    `@@ expression and pose, line ${changed[0]! + 1} @@`,
    `-Expression: ${previousParts.expression}`,
    `+Expression: ${nextParts.expression}`,
    `-Pose: ${previousParts.pose}`,
    `+Pose: ${nextParts.pose}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(DOC, "emo5-r2-prompt.diff"), diff);
  fs.writeFileSync(path.join(ART, "emo5-r2-prompt.diff"), diff);
}

const paths = {
  prompt: path.join(DOC, `${PREFIX}-owner-prompt.txt`),
  preflight: path.join(DOC, `${PREFIX}-preflight.json`),
  request: path.join(DOC, `${PREFIX}-owner-request.json`),
  raw: path.join(DOC, `${PREFIX}-raw.webp`),
  display: path.join(DOC, `${PREFIX}.webp`),
  actual: path.join(DOC, `${PREFIX}-actual.json`),
};

async function preflight(): Promise<void> {
  const composed = compose();
  fs.writeFileSync(paths.prompt, `${composed.primaryPrompt}\n`);
  fs.writeFileSync(path.join(ART, path.basename(paths.prompt)), fs.readFileSync(paths.prompt));
  writePoseExpressionDiff(composed.primaryPrompt);

  const fBytes = fs.readFileSync(path.join(process.cwd(), F_RELATIVE));
  if (sha256(fBytes) !== F_SHA) throw new Error("F SHA mismatch");
  const references = await prepareOfficialImageReferences([...composed.references]);
  const preparedMatch = /^data:image\/webp;base64,([\s\S]+)$/.exec(references[0] ?? "");
  if (!preparedMatch) throw new Error("prepared reference missing");
  const preparedBytes = Buffer.from(preparedMatch[1], "base64");
  const preparedMeta = await sharp(preparedBytes).metadata();
  if (!isLucianSig4ProofSupportedImageModel(MODEL)) throw new Error("model unsupported");
  if (OFFICIAL_ASSET_OUTPUT_COMPRESSION !== 88) throw new Error("compression is not 88");
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is empty");

  writeJson(paths.preflight, {
    status: "PREFLIGHT",
    slotKey: "emo5",
    revision: "r2",
    tag: slot.tag,
    providerPosts: 0,
    reference: F_REFERENCE,
    sourceSha256: F_SHA,
    preparedSha256: sha256(preparedBytes),
    preparedBytes: preparedBytes.length,
    preparedWidth: preparedMeta.width,
    preparedHeight: preparedMeta.height,
    model: MODEL,
    size: SIZE,
    quality: "medium",
    n: 1,
    outputCompression: 88,
    background: "opaque",
    primaryPromptSha256: sha256(composed.primaryPrompt),
    referenceRoleLayout: composed.referenceRoleLayout,
    budgetUsd: BUDGET,
    fallback: false,
    retry: false,
    vision: false,
  });
  writeJson(paths.request, {
    providerPosts: 0,
    assembly: "composeOfficialSlotGeneration + prepareOfficialImageReferences + callOpenAiImageEdit",
    slotKey: "emo5",
    revision: "r2",
    tag: slot.tag,
    model: MODEL,
    size: SIZE,
    referenceRoleLayout: composed.referenceRoleLayout,
    references: [...composed.references],
    primaryPromptSha256: sha256(composed.primaryPrompt),
    hasAgeLock: true,
    hasEmo5Shot: true,
    appearanceLockHash: LOCK_HASH,
  });
  console.log(
    JSON.stringify({
      status: "PREFLIGHT",
      primaryPromptSha256: sha256(composed.primaryPrompt),
      preparedSha256: sha256(preparedBytes),
    })
  );
}

function publicError(error: unknown) {
  if (error instanceof OpenAiImageError) {
    return {
      errorStatus: error.status,
      errorMessage: error.message.slice(0, 400),
      providerRequestId: error.diagnostic?.providerRequestId ?? null,
      costUsd: error.diagnostic?.computedCostUsd ?? null,
    };
  }
  return {
    errorStatus: 0,
    errorMessage: error instanceof Error ? error.message.slice(0, 400) : "unknown",
    providerRequestId: null,
    costUsd: null,
  };
}

async function post(): Promise<void> {
  const before = protectedHashes();
  if (fs.existsSync(paths.raw)) throw new Error(`${paths.raw} already exists`);
  if (fs.existsSync(LEDGER)) {
    const existing = JSON.parse(fs.readFileSync(LEDGER, "utf8")) as {
      postsCompleted?: number;
      haltedReason?: string | null;
    };
    if ((existing.postsCompleted ?? 0) >= 1 || existing.haltedReason) {
      throw new Error("emo5-r2 already sent");
    }
  }
  const pre = JSON.parse(fs.readFileSync(paths.preflight, "utf8")) as {
    providerPosts: number;
    primaryPromptSha256: string;
    preparedSha256: string;
    preparedBytes: number;
  };
  if (pre.providerPosts !== 0) throw new Error("preflight is not zero-post");
  const prompt = fs.readFileSync(paths.prompt, "utf8").replace(/\n$/, "");
  if (sha256(prompt) !== pre.primaryPromptSha256) throw new Error("prompt SHA drifted");
  const references = await prepareOfficialImageReferences([F_REFERENCE]);
  const preparedMatch = /^data:image\/webp;base64,([\s\S]+)$/.exec(references[0] ?? "");
  if (!preparedMatch) throw new Error("prepared reference missing");
  const preparedBytes = Buffer.from(preparedMatch[1], "base64");
  if (sha256(preparedBytes) !== pre.preparedSha256 || preparedBytes.length !== pre.preparedBytes) {
    throw new Error("prepared bytes drifted");
  }

  try {
    const result = await callOpenAiImageEdit({
      model: MODEL,
      prompt,
      references,
      size: SIZE,
      quality: "medium",
      outputCompression: OFFICIAL_ASSET_OUTPUT_COMPRESSION,
      templateId: "official_character_asset",
      mode: "wolfgang_emo5_r2_f_candidate",
    });
    fs.writeFileSync(paths.raw, result.buffer);
    fs.writeFileSync(path.join(ART, path.basename(paths.raw)), result.buffer);
    const rawSha = sha256(result.buffer);
    let inspect: Record<string, unknown> = {};
    let recoveredFromRaw = false;
    try {
      const meta = await sharp(result.buffer).metadata();
      fs.writeFileSync(paths.display, result.buffer);
      fs.writeFileSync(path.join(ART, path.basename(paths.display)), result.buffer);
      inspect = {
        width: meta.width ?? null,
        height: meta.height ?? null,
        format: meta.format ?? null,
        inspectedSha256: sha256(fs.readFileSync(paths.raw)),
      };
    } catch (inspectError) {
      recoveredFromRaw = true;
      fs.copyFileSync(paths.raw, paths.display);
      inspect = {
        recoveredFromRaw: true,
        inspectError: inspectError instanceof Error ? inspectError.message.slice(0, 240) : "inspect failed",
      };
    }
    const costKnown = typeof result.costUsd === "number";
    const status = !costKnown ? "COST_UNKNOWN" : result.costUsd > BUDGET ? "OVER_BUDGET" : "GENERATED";
    const actual = {
      status,
      slotKey: "emo5",
      revision: "r2",
      tag: slot.tag,
      providerPosts: 1,
      persistedToProduction: false,
      model: MODEL,
      reference: F_REFERENCE,
      sourceSha256: F_SHA,
      preparedSha256: pre.preparedSha256,
      primaryPromptSha256: sha256(prompt),
      size: SIZE,
      quality: "medium",
      n: 1,
      outputCompression: 88,
      background: "opaque",
      providerRequestId: result.providerRequestId,
      usageEvidence: result.usageEvidence,
      costUsd: result.costUsd,
      budgetUsd: BUDGET,
      fallback: false,
      retry: false,
      vision: false,
      recoveredFromRaw,
      raw: { sha256: rawSha, bytes: result.buffer.length },
      inspect,
    };
    writeJson(paths.actual, actual);
    writeJson(LEDGER, {
      postsCompleted: 1,
      totalBudgetUsd: BUDGET,
      spentUsd: costKnown ? result.costUsd : null,
      haltedReason: status === "GENERATED" ? null : status,
      slots: { emo5r2: actual },
    });
    assertProtected(before);
    console.log(JSON.stringify({ status, providerRequestId: result.providerRequestId, costUsd: result.costUsd, rawSha256: rawSha }));
    if (status !== "GENERATED") process.exitCode = 2;
  } catch (error) {
    const pub = publicError(error);
    if (!fs.existsSync(paths.raw)) {
      writeJson(paths.actual, {
        status: "FAILED",
        slotKey: "emo5",
        revision: "r2",
        providerPosts: 1,
        fallback: false,
        retry: false,
        vision: false,
        ...pub,
      });
    }
    writeJson(LEDGER, {
      postsCompleted: 1,
      totalBudgetUsd: BUDGET,
      haltedReason: "provider_error",
      ...pub,
    });
    assertProtected(before);
    throw error;
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "preflight") return preflight();
  if (mode === "post") return post();
  throw new Error("usage: wolfgang-asset-redesign-emo5-r2.ts preflight|post");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.slice(0, 500) : String(error));
  process.exit(1);
});
