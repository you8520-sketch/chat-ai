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
const LEDGER = path.join(DOC, "emo-f-candidates-ledger.json");

type SlotId = "emo2" | "emo6";

const SLOTS: Record<
  SlotId,
  {
    prefix: string;
    slot: OfficialAssetSlotPlan;
  }
> = {
  emo2: {
    prefix: "emo2-anger-f",
    slot: {
      slotKey: "emo2",
      kind: "emotion",
      tag: "분노",
      expression:
        "턱을 굳게 다문 채 억제된 분노를 누른다. 눈썹과 턱 근육에 긴장이 남는다. 이를 보이지 않는다.",
      pose: "주먹을 쥐되 집무실 책상 위에 내려놓는다. 서류·열쇠·음식 같은 소품은 두지 않는다. 유저는 그리지 않는다.",
      outfit: "default",
      location: null,
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: "분노",
      imageSubjects: { foreground: "solo_character", backgroundExtras: "none" },
    },
  },
  emo6: {
    prefix: "emo6-relief-f",
    slot: {
      slotKey: "emo6",
      kind: "emotion",
      tag: "안도",
      expression:
        "상대의 무사 귀환을 확인한 뒤 긴장이 풀리며 숨을 내쉰다. 눈가와 어깨의 경직이 풀린다. 크게 웃지 않는다.",
      pose: "갑옷을 벗지 않은 채 상체를 상대(카메라) 쪽으로 돌리고 어깨를 낮춘다. 손은 허벅지 위에 가볍게 두고 소품을 건네지 않는다. 유저는 그리지 않는다.",
      outfit: "default",
      location: null,
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: null,
      imageSubjects: { foreground: "solo_character", backgroundExtras: "none" },
    },
  },
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

function loadWolfgangContext(): {
  draft: OfficialCharacterDraft;
  appearance: OfficialAppearanceLock;
  assetPlan: OfficialAssetPlan;
  style: ReturnType<typeof buildStyle>;
} {
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
  return {
    draft,
    appearance: characterFile.appearance,
    assetPlan: characterFile.assetPlan,
    style: buildStyle(draft.styleKey),
  };
}

function buildStyle(styleKey: string) {
  const styleSeed = buildClusterBRofanStyleSeed({ NEXTAUTH_URL: "https://hav.chat" });
  const candidate = {
    ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID),
    dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA,
  };
  return {
    styleKey,
    genre: "로맨스 판타지",
    stage: "style_locked" as const,
    candidates: [candidate],
    approvedCandidateId: candidate.candidateId,
    styleSeed,
    proofAssetLimit: 1,
  };
}

function assertCompose(prompt: string, references: readonly string[]): void {
  if (!prompt.includes("MATURE MALE VISUAL AGE LOCK")) throw new Error("missing age lock");
  if (!prompt.includes("IDENTITY LOCK")) throw new Error("missing identity lock");
  if (!prompt.includes("both the identity source and the style source")) {
    throw new Error("missing identity_and_style rule");
  }
  if (prompt.includes("STYLE ONLY") || prompt.includes("ART STYLE (structured attributes")) {
    throw new Error("style-only or DNA reinserted");
  }
  if (references.length !== 1 || references[0] !== F_REFERENCE) {
    throw new Error(`unexpected references: ${JSON.stringify(references)}`);
  }
  for (const token of ["b7-black-gold-uniform", "official-pilot-rf-v4-02__rep-a1"]) {
    if (prompt.includes(token) || references.some((ref) => ref.includes(token))) {
      throw new Error(`production ref leaked: ${token}`);
    }
  }
}

function composeSlot(slotId: SlotId) {
  const ctx = loadWolfgangContext();
  const { slot } = SLOTS[slotId];
  const plan: OfficialAssetPlan = {
    slots: ctx.assetPlan.slots.map((entry) => (entry.slotKey === slotId ? slot : entry)),
  };
  const composed = composeOfficialSlotGeneration({
    character: wolfgangCharacter(ctx.draft, ctx.appearance, plan),
    style: ctx.style,
    slotKey: slotId,
    representativeUrl: "https://hav.chat/uploads/official-pilot-rf-v4-02__rep-a1.webp",
    env: { OPENAI_IMAGE_MODEL: MODEL },
    samePersonIdentityStyleUrl: F_REFERENCE,
  });
  if (!composed.ok) throw new Error(composed.error);
  if (composed.referenceRoleLayout !== "identity_and_style") {
    throw new Error(`layout ${composed.referenceRoleLayout}`);
  }
  if (composed.profile.size !== SIZE) throw new Error(`size ${composed.profile.size}`);
  assertCompose(composed.primaryPrompt, composed.references);
  return composed;
}

function pathsFor(slotId: SlotId) {
  const prefix = SLOTS[slotId].prefix;
  return {
    prefix,
    prompt: path.join(DOC, `${prefix}-owner-prompt.txt`),
    preflight: path.join(DOC, `${prefix}-preflight.json`),
    request: path.join(DOC, `${prefix}-owner-request.json`),
    raw: path.join(DOC, `${prefix}-raw.webp`),
    display: path.join(DOC, `${prefix}.webp`),
    actual: path.join(DOC, `${prefix}-actual.json`),
  };
}

async function preflightSlot(slotId: SlotId): Promise<void> {
  const composed = composeSlot(slotId);
  const paths = pathsFor(slotId);
  fs.writeFileSync(paths.prompt, `${composed.primaryPrompt}\n`);
  fs.writeFileSync(path.join(ART, path.basename(paths.prompt)), fs.readFileSync(paths.prompt));

  const fBytes = fs.readFileSync(path.join(process.cwd(), F_RELATIVE));
  if (sha256(fBytes) !== F_SHA) throw new Error("F SHA mismatch");

  const references = await prepareOfficialImageReferences([...composed.references]);
  if (references.length !== 1 || !references[0]?.startsWith("data:image/webp;base64,")) {
    throw new Error("prepared reference missing");
  }
  const preparedBytes = Buffer.from(/^data:image\/webp;base64,([\s\S]+)$/.exec(references[0])![1], "base64");
  const preparedMeta = await sharp(preparedBytes).metadata();

  for (const dir of [DOC, ART]) {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".emo-write-probe");
    fs.writeFileSync(probe, preparedBytes.subarray(0, Math.min(32, preparedBytes.length)));
    fs.rmSync(probe);
  }

  if (!isLucianSig4ProofSupportedImageModel(MODEL)) throw new Error("model unsupported");
  if (OFFICIAL_ASSET_OUTPUT_COMPRESSION !== 88) throw new Error("compression is not 88");
  const key = process.env.OPENAI_API_KEY?.trim() || "";
  if (!key) throw new Error("OPENAI_API_KEY is empty");

  writeJson(paths.preflight, {
    status: "PREFLIGHT",
    slotKey: slotId,
    tag: SLOTS[slotId].slot.tag,
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
    strictFallbackPromptSha256: sha256(composed.strictFallbackPrompt),
    referenceRoleLayout: composed.referenceRoleLayout,
    budgetUsd: BUDGET,
    fallback: false,
    retry: false,
    vision: false,
  });

  writeJson(paths.request, {
    providerPosts: 0,
    assembly: "composeOfficialSlotGeneration + prepareOfficialImageReferences + callOpenAiImageEdit",
    slotKey: slotId,
    tag: SLOTS[slotId].slot.tag,
    model: MODEL,
    size: SIZE,
    referenceRoleLayout: composed.referenceRoleLayout,
    references: [...composed.references],
    primaryPromptSha256: sha256(composed.primaryPrompt),
    strictFallbackPromptSha256: sha256(composed.strictFallbackPrompt),
    hasStyleOnly: false,
    hasStyleDna: false,
    hasAgeLock: true,
    appearanceLockHash: LOCK_HASH,
  });

  console.log(
    JSON.stringify({
      status: "PREFLIGHT",
      slotId,
      preparedSha256: sha256(preparedBytes),
      primaryPromptSha256: sha256(composed.primaryPrompt),
    })
  );
}

function readLedger(): { postsCompleted: number; slots: Record<string, unknown> } {
  if (!fs.existsSync(LEDGER)) return { postsCompleted: 0, slots: {} };
  return JSON.parse(fs.readFileSync(LEDGER, "utf8")) as { postsCompleted: number; slots: Record<string, unknown> };
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

async function postSlot(slotId: SlotId): Promise<void> {
  const paths = pathsFor(slotId);
  if (fs.existsSync(paths.raw)) throw new Error(`${paths.raw} already exists`);
  const ledger = readLedger();
  if (ledger.slots[slotId]) throw new Error(`${slotId} already posted in ledger`);
  if (ledger.postsCompleted >= 2) throw new Error("post budget exhausted");

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

  writeJson(LEDGER, {
    ...ledger,
    postsStarted: (ledger.postsCompleted ?? 0) + 1,
    state: `starting-${slotId}`,
    startedAt: new Date().toISOString(),
  });

  try {
    const result = await callOpenAiImageEdit({
      model: MODEL,
      prompt,
      references,
      size: SIZE,
      quality: "medium",
      outputCompression: OFFICIAL_ASSET_OUTPUT_COMPRESSION,
      templateId: "official_character_asset",
      mode: `wolfgang_${slotId}_f_candidate`,
    });

    fs.writeFileSync(paths.raw, result.buffer);
    fs.writeFileSync(path.join(ART, path.basename(paths.raw)), result.buffer);
    const rawSha = sha256(result.buffer);

    let inspect: Record<string, unknown> = {};
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
      inspect = {
        inspectError: inspectError instanceof Error ? inspectError.message.slice(0, 240) : "inspect failed",
      };
    }

    const actual = {
      status:
        typeof result.costUsd === "number" && result.costUsd > BUDGET ? "OVER_BUDGET" : "GENERATED",
      slotKey: slotId,
      tag: SLOTS[slotId].slot.tag,
      providerPosts: 1,
      persistedToProduction: false,
      model: MODEL,
      reference: F_REFERENCE,
      sourceSha256: F_SHA,
      preparedSha256: pre.preparedSha256,
      primaryPromptSha256: pre.primaryPromptSha256,
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
      raw: { sha256: rawSha, bytes: result.buffer.length },
      inspect,
    };
    writeJson(paths.actual, actual);

    const nextLedger = readLedger();
    const slots = { ...nextLedger.slots, [slotId]: actual };
    const spentUsd = (["emo2", "emo6"] as const).reduce((sum, key) => {
      const entry = slots[key] as { costUsd?: number | null } | undefined;
      return sum + (typeof entry?.costUsd === "number" ? entry.costUsd : 0);
    }, 0);
    writeJson(LEDGER, {
      postsCompleted: Object.keys(slots).length,
      totalBudgetUsd: 0.16,
      spentUsd,
      slots,
      state: "saved",
      finishedAt: new Date().toISOString(),
    });

    console.log(
      JSON.stringify({
        status: actual.status,
        slotId,
        providerRequestId: result.providerRequestId,
        costUsd: result.costUsd,
        rawSha256: rawSha,
      })
    );
  } catch (error) {
    const pub = publicError(error);
    writeJson(paths.actual, {
      status: "FAILED",
      slotKey: slotId,
      providerPosts: 1,
      fallback: false,
      retry: false,
      vision: false,
      ...pub,
    });
    writeJson(LEDGER, { ...readLedger(), state: `failed-${slotId}`, ...pub });
    throw error;
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const slot = process.argv[3] as SlotId | undefined;
  if (mode === "preflight") {
    if (slot === "emo2" || slot === "emo6") return preflightSlot(slot);
    if (!slot) {
      await preflightSlot("emo2");
      await preflightSlot("emo6");
      return;
    }
  }
  if (mode === "post") {
    if (slot !== "emo2" && slot !== "emo6") throw new Error("post requires emo2 or emo6");
    return postSlot(slot);
  }
  throw new Error("usage: wolfgang-asset-redesign-emo-f-candidates.ts preflight [emo2|emo6] | post emo2|emo6");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.slice(0, 500) : String(error));
  process.exit(1);
});
