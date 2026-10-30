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
const PER_SLOT_BUDGET = 0.08;
const TOTAL_BUDGET = 0.8;
const SIZE = "1536x1024";
const LEDGER = path.join(DOC, "remaining-10-f-ledger.json");
const ORDER = ["sig1", "sig2", "sig3", "emo1", "emo3", "emo4", "emo5", "scene1", "scene2", "scene3"] as const;

type SlotId = (typeof ORDER)[number];

const subjects = { foreground: "solo_character" as const, backgroundExtras: "none" as const };

const SLOTS: Record<SlotId, { prefix: string; slot: OfficialAssetSlotPlan }> = {
  sig1: {
    prefix: "sig1-map-f",
    slot: {
      slotKey: "sig1",
      kind: "signature",
      tag: "지도를 짚음",
      expression: "엄격하고 흔들림 없이 지도를 읽는 진지한 표정. 이를 보이지 않는다.",
      pose: "흑철 요새 지휘실 탁자 위 작전 지도의 한 지점을 장갑 낀 검지로 짚는다. 지도와 짚는 손이 프레임 안에 보인다. 부하는 그리지 않는다. 서류 더미는 두지 않는다.",
      outfit: "default",
      location: "흑철 요새 지휘실",
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: "진지함",
      imageSubjects: subjects,
    },
  },
  sig2: {
    prefix: "sig2-chin-f",
    slot: {
      slotKey: "sig2",
      kind: "signature",
      tag: "턱을 괴고 생각",
      expression: "말을 삼키며 턱을 괸 채 생각을 정리하는 눈빛. 흉터를 만지거나 보여 주지 않는다.",
      pose: "갑옷 장갑을 낀 손으로 턱을 괴고 앉는다. 괴고 있는 손과 얼굴이 한눈에 보인다. 서류·지도·열쇠는 두지 않는다. 흉터를 쓰다듬지 않는다.",
      outfit: "default",
      location: null,
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: "의심",
      imageSubjects: subjects,
    },
  },
  sig3: {
    prefix: "sig3-key-f",
    slot: {
      slotKey: "sig3",
      kind: "signature",
      tag: "열쇠를 확인함",
      expression: "위험을 가늠하며 열쇠를 확인하는 집중. 이를 보이지 않는다.",
      pose: "장갑 낀 손으로 방벽 열쇠 꾸러미를 들어 열쇠 이를 확인한다. 열쇠와 손이 프레임 안에 보인다. 상자를 열거나 문서를 펼치지 않는다.",
      outfit: "default",
      location: "흑철 요새 봉인고",
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: "진지함",
      imageSubjects: subjects,
    },
  },
  emo1: {
    prefix: "emo1-doubt-f",
    slot: {
      slotKey: "emo1",
      kind: "emotion",
      tag: "의심",
      expression: "상대를 바라보며 눈썹만 좁힌 의심. 입을 다문다. 서류를 보지 않는다.",
      pose: "상체를 상대(카메라) 쪽으로 두고 손을 비운다. 문서·편지·지도·열쇠는 없다. 유저는 그리지 않는다.",
      outfit: "default",
      location: null,
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: "의심",
      imageSubjects: subjects,
    },
  },
  emo3: {
    prefix: "emo3-serious-f",
    slot: {
      slotKey: "emo3",
      kind: "emotion",
      tag: "진지함",
      expression: "상대의 말을 끝까지 듣는 냉정한 진지함. 눈썹을 찌푸리거나 웃지 않는다.",
      pose: "손을 비운 채 상대(카메라)를 바라본다. 문서·지도·열쇠·주먹은 없다. 유저는 그리지 않는다.",
      outfit: "default",
      location: null,
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: "진지함",
      imageSubjects: subjects,
    },
  },
  emo4: {
    prefix: "emo4-fluster-f",
    slot: {
      slotKey: "emo4",
      kind: "emotion",
      tag: "당황",
      expression: "예상 밖의 말에 눈이 잠깐 커지고 입술이 살짝 벌어진 당황. 웃음이 아니다.",
      pose: "고개를 옆으로 돌렸다가 다시 상대(카메라)를 본다. 손이 보이면 소품을 쥐지 않는다. 서류는 없다. 유저는 그리지 않는다.",
      outfit: "default",
      location: null,
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: "당황",
      imageSubjects: subjects,
    },
  },
  emo5: {
    prefix: "emo5-ease-f",
    slot: {
      slotKey: "emo5",
      kind: "emotion",
      tag: "편안함",
      expression: "눈을 뜨고 눈가의 힘이 풀린 편안함. 입꼬리를 올리지 않는다. 눈을 감거나 길게 숨을 내쉬거나 웃지 않는다.",
      pose: "소품 없이 어깨를 내려 선다. 손은 몸 옆에 가볍게 둔다. 서류·검·열쇠·주먹은 없다. 창가에 앉아 웃지 않는다. 유저는 그리지 않는다.",
      outfit: "default",
      location: null,
      situation: null,
      characterPresence: "required",
      depiction: "standard",
      personTag: null,
      imageSubjects: subjects,
    },
  },
  scene1: {
    prefix: "scene1-docs-f",
    slot: {
      slotKey: "scene1",
      kind: "scene",
      tag: "문서를 대조함",
      expression: "서로 다른 인장의 문서를 대조하며 판단을 보류하는 의심. 이를 보이지 않는다.",
      pose: "장갑 낀 양손에 인장이 다른 문서 두 장을 들어 나란히 보여 준다. 두 문서와 손이 프레임 안에 보인다. 상대는 그리지 않는다.",
      outfit: "default",
      location: "발켄하임 혹한의 검은 방벽 (흑철 요새) 집무실",
      situation: "흑철 요새 집무실에서 황실 문장과 볼프강 인장이 찍힌 서로 다른 문서 두 장을 대조한다.",
      characterPresence: "required",
      depiction: "standard",
      personTag: "의심",
      imageSubjects: subjects,
    },
  },
  scene2: {
    prefix: "scene2-records-f",
    slot: {
      slotKey: "scene2",
      kind: "scene",
      tag: "기록을 맞춤",
      expression: "서로 다른 인계 기록을 맞춰 보며 놓치지 않는 집중. 이를 보이지 않는다.",
      pose: "판도라 아카이브 탁자 위 인계 기록과 증인 서류를 양손으로 나란히 맞춰 본다. 종이 두 종류와 손이 프레임 안에 보인다.",
      outfit: "default",
      location: "판도라 대도서관 심연의 아카이브",
      situation: "판도라 아카이브에서 서로 다른 인계 기록과 증인의 서류를 맞춰 본다.",
      characterPresence: "required",
      depiction: "standard",
      personTag: "진지함",
      imageSubjects: subjects,
    },
  },
  scene3: {
    prefix: "scene3-tense-f",
    slot: {
      slotKey: "scene3",
      kind: "scene",
      tag: "긴장",
      expression: "압박 앞에서 턱과 어깨에 힘이 들어간 단호한 긴장. 웃지 않고 이를 보이지 않는다. 눈을 감지 않는다.",
      pose: "솔라리스 유리온실의 유리와 조명 아래 갑옷을 입은 채 서서 상대(카메라)를 본다. 문서·열쇠·음식은 없다. 유혈이나 무기는 그리지 않는다.",
      outfit: "default",
      location: "솔라리스 유리온실 (태양궁 최상층)",
      situation: "솔라리스 유리온실의 유리와 조명 아래, 볼프강이 단호한 긴장으로 선다.",
      characterPresence: "required",
      depiction: "standard",
      personTag: "긴장",
      imageSubjects: subjects,
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
  if (computeAppearanceLockHash(characterFile.appearance) !== LOCK_HASH) {
    throw new Error("Appearance Lock drifted");
  }
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
  const candidate = { ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID), dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA };
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

function assertPrompt(slotId: SlotId, prompt: string, references: readonly string[]): void {
  const slot = SLOTS[slotId].slot;
  for (const token of ["MATURE MALE VISUAL AGE LOCK", "IDENTITY LOCK", "both the identity source and the style source", slot.expression]) {
    if (!prompt.includes(token)) throw new Error(`${slotId} missing ${token}`);
  }
  if (!prompt.includes(`Pose: ${slot.pose}`)) throw new Error(`${slotId} pose missing`);
  for (const token of ["STYLE ONLY", "ART STYLE (structured", "b7-black-gold-uniform", "철혈의 지휘관", "흉터의 맹세", "봉인고의 열쇠", "위조된 명령서", "봉인된 장부", "황실의 마지막 압박"]) {
    if (prompt.includes(token)) throw new Error(`${slotId} leaked ${token}`);
  }
  if (references.length !== 1 || references[0] !== F_REFERENCE) throw new Error(`${slotId} references`);
  if (slot.kind === "emotion" && /문서|서류|지도|열쇠/.test(slot.pose) && /없다|두지 않는다|쥐지 않는다/.test(slot.pose) === false) {
    throw new Error(`${slotId} emotion pose still stages documents`);
  }
  if (slotId === "emo5" && /눈을 감|길게 숨을 내쉬/.test(`${slot.expression} ${slot.pose}`) && !/눈을 감거나 길게 숨을 내쉬거나 웃지 않는다/.test(slot.expression)) {
    throw new Error("emo5 copies relief breath");
  }
}

function composeSlot(slotId: SlotId) {
  const ctx = loadContext();
  const { slot } = SLOTS[slotId];
  const plan: OfficialAssetPlan = {
    slots: ctx.assetPlan.slots.map((entry) => (entry.slotKey === slot.slotKey ? slot : entry)),
  };
  const composed = composeOfficialSlotGeneration({
    character: wolfgangCharacter(ctx.draft, ctx.appearance, plan),
    style: ctx.style,
    slotKey: slot.slotKey,
    representativeUrl: "https://hav.chat/uploads/official-pilot-rf-v4-02__rep-a1.webp",
    env: { OFFICIAL_ASSET_IMAGE_MODEL: MODEL },
    samePersonIdentityStyleUrl: F_REFERENCE,
  });
  if (!composed.ok) throw new Error(composed.error);
  if (composed.referenceRoleLayout !== "identity_and_style") throw new Error(composed.referenceRoleLayout);
  if (composed.profile.size !== SIZE) throw new Error(composed.profile.size);
  assertPrompt(slotId, composed.primaryPrompt, composed.references);
  return composed;
}

function pathsFor(slotId: SlotId) {
  const prefix = SLOTS[slotId].prefix;
  return {
    prompt: path.join(DOC, `${prefix}-owner-prompt.txt`),
    preflight: path.join(DOC, `${prefix}-preflight.json`),
    request: path.join(DOC, `${prefix}-owner-request.json`),
    raw: path.join(DOC, `${prefix}-raw.webp`),
    display: path.join(DOC, `${prefix}.webp`),
    actual: path.join(DOC, `${prefix}-actual.json`),
  };
}

type Ledger = {
  postsCompleted: number;
  spentUsd: number;
  haltedReason: string | null;
  slots: Record<string, { providerPosts?: number; costUsd?: number | null; status?: string }>;
};

function readLedger(): Ledger {
  if (!fs.existsSync(LEDGER)) return { postsCompleted: 0, spentUsd: 0, haltedReason: null, slots: {} };
  return JSON.parse(fs.readFileSync(LEDGER, "utf8")) as Ledger;
}

async function preflightAll(): Promise<void> {
  if (!isLucianSig4ProofSupportedImageModel(MODEL)) throw new Error("model unsupported");
  if (OFFICIAL_ASSET_OUTPUT_COMPRESSION !== 88) throw new Error("compression");
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Error("OPENAI_API_KEY is empty");
  const fBytes = fs.readFileSync(path.join(process.cwd(), F_RELATIVE));
  if (sha256(fBytes) !== F_SHA) throw new Error("F SHA mismatch");
  const inputs = [];
  for (const slotId of ORDER) {
    const composed = composeSlot(slotId);
    const paths = pathsFor(slotId);
    fs.writeFileSync(paths.prompt, `${composed.primaryPrompt}\n`);
    const references = await prepareOfficialImageReferences([...composed.references]);
    const prepared = Buffer.from(/^data:image\/webp;base64,([\s\S]+)$/.exec(references[0] ?? "")?.[1] ?? "", "base64");
    if (!prepared.length) throw new Error(`${slotId} prepare failed`);
    const row = {
      slotKey: slotId,
      tag: SLOTS[slotId].slot.tag,
      expression: SLOTS[slotId].slot.expression,
      pose: SLOTS[slotId].slot.pose,
      primaryPromptSha256: sha256(composed.primaryPrompt),
      preparedSha256: sha256(prepared),
      preparedBytes: prepared.length,
      reference: F_REFERENCE,
    };
    writeJson(paths.preflight, { status: "PREFLIGHT", providerPosts: 0, model: MODEL, size: SIZE, quality: "medium", n: 1, outputCompression: 88, background: "opaque", budgetUsd: PER_SLOT_BUDGET, ...row });
    writeJson(paths.request, { providerPosts: 0, assembly: "composeOfficialSlotGeneration + prepareOfficialImageReferences + callOpenAiImageEdit", ...row });
    inputs.push(row);
    console.log(JSON.stringify({ status: "PREFLIGHT", slotId, sha: row.primaryPromptSha256 }));
  }
  writeJson(path.join(DOC, "remaining-10-f-inputs.json"), {
    providerPosts: 0,
    count: inputs.length,
    totalBudgetUsd: TOTAL_BUDGET,
    perSlotBudgetUsd: PER_SLOT_BUDGET,
    kept: ["rep F", "sig4 옅은 미소", "emo2 분노", "emo6 r2"],
    inputs,
  });
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
  return { errorStatus: 0, errorMessage: error instanceof Error ? error.message.slice(0, 400) : "unknown", providerRequestId: null, costUsd: null };
}

async function postAll(): Promise<void> {
  for (const slotId of ORDER) {
    const ledger = readLedger();
    if (ledger.spentUsd > TOTAL_BUDGET) {
      writeJson(LEDGER, { ...ledger, haltedReason: "total budget already exceeded", state: "halted" });
      throw new Error("total budget already exceeded");
    }
    const paths = pathsFor(slotId);
    const prior = ledger.slots[slotId];
    if (fs.existsSync(paths.raw) || (prior?.providerPosts ?? 0) >= 1) {
      console.log(JSON.stringify({ status: "SKIP", slotId }));
      continue;
    }
    const pre = JSON.parse(fs.readFileSync(paths.preflight, "utf8")) as { primaryPromptSha256: string; preparedSha256: string; preparedBytes: number };
    const prompt = fs.readFileSync(paths.prompt, "utf8").replace(/\n$/, "");
    if (sha256(prompt) !== pre.primaryPromptSha256) throw new Error(`${slotId} prompt drifted`);
    const references = await prepareOfficialImageReferences([F_REFERENCE]);
    const prepared = Buffer.from(/^data:image\/webp;base64,([\s\S]+)$/.exec(references[0] ?? "")?.[1] ?? "", "base64");
    if (sha256(prepared) !== pre.preparedSha256) throw new Error(`${slotId} prepared drifted`);

    writeJson(LEDGER, { ...ledger, state: `starting-${slotId}`, startedAt: new Date().toISOString() });
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
        const meta = await sharp(fs.readFileSync(paths.raw)).metadata();
        fs.writeFileSync(paths.display, fs.readFileSync(paths.raw));
        fs.writeFileSync(path.join(ART, path.basename(paths.display)), fs.readFileSync(paths.raw));
        inspect = { width: meta.width ?? null, height: meta.height ?? null, format: meta.format ?? null, inspectedSha256: sha256(fs.readFileSync(paths.raw)) };
      } catch (inspectError) {
        fs.writeFileSync(paths.display, fs.readFileSync(paths.raw));
        inspect = { inspectError: inspectError instanceof Error ? inspectError.message.slice(0, 240) : "inspect failed", recoveredFromRaw: true };
      }
      const unknown = result.costUsd == null || !Number.isFinite(result.costUsd);
      const over = typeof result.costUsd === "number" && result.costUsd > PER_SLOT_BUDGET;
      const status = unknown ? "UNKNOWN_COST" : over ? "OVER_BUDGET" : "GENERATED";
      const actual = {
        status,
        slotKey: slotId,
        tag: SLOTS[slotId].slot.tag,
        providerPosts: 1,
        persistedToProduction: false,
        model: MODEL,
        reference: F_REFERENCE,
        sourceSha256: F_SHA,
        preparedSha256: pre.preparedSha256,
        sentPromptSha256: sha256(prompt),
        size: SIZE,
        quality: "medium",
        n: 1,
        outputCompression: 88,
        background: "opaque",
        providerRequestId: result.providerRequestId,
        usageEvidence: result.usageEvidence,
        costUsd: result.costUsd,
        budgetUsd: PER_SLOT_BUDGET,
        fallback: false,
        retry: false,
        vision: false,
        raw: { sha256: rawSha, bytes: result.buffer.length },
        inspect,
      };
      writeJson(paths.actual, actual);
      const next = readLedger();
      const slots = { ...next.slots, [slotId]: actual };
      const spentUsd = Object.values(slots).reduce((sum, entry) => sum + (typeof entry.costUsd === "number" ? entry.costUsd : 0), 0);
      const halt = unknown ? "unknown cost" : over ? "slot budget exceeded" : spentUsd > TOTAL_BUDGET ? "total budget exceeded" : null;
      writeJson(LEDGER, {
        postsCompleted: Object.values(slots).filter((entry) => (entry.providerPosts ?? 0) >= 1).length,
        spentUsd,
        haltedReason: halt,
        totalBudgetUsd: TOTAL_BUDGET,
        perSlotBudgetUsd: PER_SLOT_BUDGET,
        slots,
        state: halt ? "halted" : "saved",
        finishedAt: new Date().toISOString(),
      });
      console.log(JSON.stringify({ status, slotId, costUsd: result.costUsd, rawSha256: rawSha, providerRequestId: result.providerRequestId }));
      if (halt) throw new Error(`${slotId} halted: ${halt}`);
    } catch (error) {
      if (fs.existsSync(paths.actual)) throw error;
      const pub = publicError(error);
      writeJson(paths.actual, { status: "FAILED", slotKey: slotId, providerPosts: 1, fallback: false, retry: false, vision: false, ...pub });
      const next = readLedger();
      writeJson(LEDGER, {
        ...next,
        haltedReason: pub.errorMessage,
        slots: { ...next.slots, [slotId]: { providerPosts: 1, status: "FAILED", costUsd: pub.costUsd } },
        state: "halted",
        finishedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "preflight") return preflightAll();
  if (mode === "post") return postAll();
  throw new Error("usage: remaining-10 preflight|post");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message.slice(0, 500) : String(error));
  process.exit(1);
});
