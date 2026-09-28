import "server-only";

import fs from "node:fs";
import path from "node:path";

import type { SessionUser } from "@/lib/characterFormSave";
import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import { stageOfficialCharacterPrivately } from "@/lib/officialSupply/staging";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import type {
  OfficialVariationQaReport,
  OfficialWorldLorebookEntry,
} from "@/lib/officialSupply/types";
import { PILOT_STYLE_PROOF_V4_STYLE_KEY } from "@/lib/officialSupply/userOwnedRofanStyleRefs";

const LIVE_ENV = "OFFICIAL_LUCIAN_FINALIZE_LIVE";
const STAGING_USER_ENV = "OFFICIAL_STAGING_USER_ID";
const DRAFT_KEY = "pilot-rf-v4-03";
const EXPECTED_REP_URL = "/uploads/official-pilot-rf-v4-03__rep-a1.webp";

const VARIATION_QA_NOTES: Record<string, string> = {
  sig1: "장부를 짚으며 숫자와 상대를 함께 재는 냉정한 시선이 계획과 일치한다.",
  sig2: "벽 가까이에서 출구 쪽을 살피는 경계 표정과 몸 방향이 계획과 일치한다.",
  sig3: "비스듬히 앉아 잔을 굴리며 농담 뒤 반응을 살피는 표정이 계획과 일치한다.",
  sig4: "장부를 몸 가까이 감추고 열쇠를 쥔 단호한 태도가 계획과 일치한다.",
  emo1: "경보 아래 눈빛이 날카로워지고 몸을 낮춘 긴장감이 계획과 일치한다.",
  emo2: "기록을 등 뒤로 숨기며 예상 밖 목격자를 마주한 당황과 긴장이 계획과 일치한다.",
  emo3: "팔짱을 끼고 상대를 의심스럽게 응시하는 표정이 계획과 일치한다.",
  emo4: "관자놀이를 누르며 계산이 어긋난 짜증을 억누르는 표정이 계획과 일치한다.",
  emo5: "열쇠를 내려놓으며 긴장이 풀린 안도감이 계획과 일치한다.",
  emo6: "장부를 상대에게 내밀며 조심스럽게 신뢰를 건네는 표정이 계획과 일치한다.",
  scene1: "금고 경보 아래 상대의 손목을 잡고 도주로로 이끄는 날 선 표정과 행동이 계획과 일치한다.",
  scene2: "장부와 기록을 두고 공개의 대가를 계산하는 굳은 표정과 장면이 계획과 일치한다.",
  scene3: "오래된 기록을 건네며 결심과 두려움이 교차하는 장면이 계획과 일치한다.",
};

const IDENTITY_NOTE =
  "승인된 대표 앵커와 동일한 적갈색 머리, 호박빛 눈, 금장 모노클, 얼굴 비율과 녹색·금장 복식 정체성이 유지된다.";
const STYLE_NOTE =
  "승인된 Cluster B의 선명한 웹툰형 선화, 고대비 광원, 금속·직물 디테일과 색 처리 방식이 대표 앵커와 일관된다.";
const PRESENT_NOTE = "루시안이 장면의 명확한 중심 피사체로 존재한다.";

function stop(message: string): never {
  throw new Error(`LUCIAN_FINALIZE STOP: ${message}`);
}

function qaFor(slotKey: string): OfficialVariationQaReport {
  const expression = VARIATION_QA_NOTES[slotKey];
  if (!expression) stop(`missing visual QA note for ${slotKey}`);
  return {
    identityMatchesAnchor: { ok: true, note: IDENTITY_NOTE },
    expressionMatchesPlan: { ok: true, note: expression },
    characterPresent: { ok: true, note: PRESENT_NOTE },
    artStyle: { ok: true, note: STYLE_NOTE },
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function snapshotOtherSupply(store: OfficialSupplyStore): string {
  const characters = store.database
    .prepare(
      `SELECT * FROM official_supply_characters
       WHERE style_key=? AND draft_key<>?
       ORDER BY draft_key`
    )
    .all(PILOT_STYLE_PROOF_V4_STYLE_KEY, DRAFT_KEY);
  const assets = store.database
    .prepare(
      `SELECT a.*
       FROM official_supply_assets a
       JOIN official_supply_characters c ON c.draft_key=a.draft_key
       WHERE c.style_key=? AND c.draft_key<>?
       ORDER BY c.draft_key, a.id`
    )
    .all(PILOT_STYLE_PROOF_V4_STYLE_KEY, DRAFT_KEY);
  return stable({ characters, assets });
}

function selectStagingUser(store: OfficialSupplyStore): SessionUser {
  const rows = store.database
    .prepare(
      `SELECT id, nickname, is_adult
       FROM users
       WHERE site_managed=1
       ORDER BY id`
    )
    .all() as Array<{ id: number; nickname: string; is_adult: number }>;

  const adultRows = rows.filter((row) => row.is_adult === 1);
  const requestedRaw = String(process.env[STAGING_USER_ENV] ?? "").trim();

  if (requestedRaw) {
    const requested = Number(requestedRaw);
    if (!Number.isInteger(requested) || requested <= 0) {
      stop(`${STAGING_USER_ENV} must be a positive integer`);
    }
    const match = adultRows.find((row) => row.id === requested);
    if (!match) {
      stop(
        `requested staging user ${requested} is not an adult site-managed account; available=${JSON.stringify(adultRows)}`
      );
    }
    return match;
  }

  if (adultRows.length !== 1) {
    stop(
      `expected exactly one adult site-managed account or explicit ${STAGING_USER_ENV}; available=${JSON.stringify(adultRows)}`
    );
  }
  return adultRows[0]!;
}

function loadSharedLorebook(): OfficialWorldLorebookEntry[] {
  const sourcePath = path.join(
    process.cwd(),
    "src/lib/officialSupply/pilot/world-bible.json"
  );
  const parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as {
    bible?: { lorebook?: OfficialWorldLorebookEntry[] };
  };
  const entries = parsed.bible?.lorebook ?? [];
  if (entries.length !== 8) {
    stop(`world lorebook entries=${entries.length}; expected canonical 8`);
  }
  return entries;
}

function assertAnchorAndVariationsReady(store: OfficialSupplyStore): string[] {
  const record = store.getCharacter(DRAFT_KEY);
  if (record.stage !== "anchor_approved") {
    stop(`character stage=${record.stage}; expected anchor_approved`);
  }
  if (!record.appearanceLockHash || !record.assetPlan) {
    stop("appearance lock or asset plan missing");
  }

  const rep = store.representativeAsset(DRAFT_KEY);
  if (
    rep.status !== "approved" ||
    rep.resultUrl !== EXPECTED_REP_URL ||
    rep.attempts !== 1 ||
    rep.appearanceLockHash !== record.appearanceLockHash
  ) {
    stop("representative is not the approved current Lucian anchor");
  }
  if (officialModerationVerdict(rep.moderation) !== "clean") {
    stop(`representative moderation=${officialModerationVerdict(rep.moderation)}`);
  }

  const variationSlots = record.assetPlan.slots
    .filter((slot) => slot.kind !== "representative")
    .map((slot) => slot.slotKey);
  const qaSlots = Object.keys(VARIATION_QA_NOTES).sort();
  if (
    variationSlots.length !== 13 ||
    stable([...variationSlots].sort()) !== stable(qaSlots)
  ) {
    stop(
      `variation plan mismatch: plan=${JSON.stringify(variationSlots)} qa=${JSON.stringify(qaSlots)}`
    );
  }

  for (const slotKey of variationSlots) {
    const asset = store.getAsset(DRAFT_KEY, slotKey);
    const plan = record.assetPlan.slots.find((slot) => slot.slotKey === slotKey);
    if (!plan) stop(`plan missing for ${slotKey}`);
    const profile = officialImageProfileForSlot(plan.kind);
    if (
      asset.status !== "generated" ||
      asset.attempts !== 1 ||
      !asset.resultUrl ||
      asset.qa !== null ||
      asset.appearanceLockHash !== record.appearanceLockHash ||
      asset.width !== profile.width ||
      asset.height !== profile.height ||
      asset.hasUnknownCost
    ) {
      stop(
        `${slotKey} not pristine generated/current: status=${asset.status}, attempts=${asset.attempts}, qa=${asset.qa ? "present" : "null"}, dims=${asset.width}x${asset.height}, unknownCost=${asset.hasUnknownCost}`
      );
    }
    if (officialModerationVerdict(asset.moderation) !== "clean") {
      stop(`${slotKey} moderation=${officialModerationVerdict(asset.moderation)}; Lucian is SFW`);
    }
  }
  return variationSlots;
}

async function main(): Promise<void> {
  if (process.env[LIVE_ENV] !== "1") {
    console.log(
      `[lucian-finalize] NOT_RUN: set ${LIVE_ENV}=1 after completed visual QA`
    );
    return;
  }

  const store = new OfficialSupplyStore();
  const initial = store.getCharacter(DRAFT_KEY);

  if (initial.stage === "staged_private" && initial.stagedCharacterId != null) {
    console.log(
      JSON.stringify({
        status: "LUCIAN_ALREADY_STAGED_PRIVATE",
        draftKey: DRAFT_KEY,
        characterId: initial.stagedCharacterId,
      })
    );
    return;
  }

  const stagingUser = selectStagingUser(store);
  const sharedLorebook = loadSharedLorebook();
  const otherBefore = snapshotOtherSupply(store);

  if (initial.stage === "anchor_approved") {
    const slots = assertAnchorAndVariationsReady(store);
    const approveAll = store.database.transaction(() => {
      for (const slotKey of slots) {
        const reviewed = store.reviewVariation(DRAFT_KEY, slotKey, qaFor(slotKey));
        if (!reviewed.approved) {
          stop(`${slotKey} canonical reviewVariation rejected the visually approved image`);
        }
      }
      const afterReviews = store.getCharacter(DRAFT_KEY);
      if (afterReviews.stage !== "assets_complete") {
        stop(`post-variation stage=${afterReviews.stage}; expected assets_complete`);
      }
      const finalQa = store.markQaPassed(DRAFT_KEY);
      if (!finalQa.ok) {
        stop(`final QA failed: ${JSON.stringify(finalQa.errors)}`);
      }
    });
    approveAll();
  } else if (initial.stage !== "qa_passed") {
    stop(`character stage=${initial.stage}; expected anchor_approved or qa_passed`);
  }

  const qaPassed = store.getCharacter(DRAFT_KEY);
  if (qaPassed.stage !== "qa_passed") {
    stop(`pre-staging stage=${qaPassed.stage}; expected qa_passed`);
  }

  const staged = await stageOfficialCharacterPrivately({
    store,
    draftKey: DRAFT_KEY,
    stagingUser,
    sharedLorebook,
  });

  const finalRecord = store.getCharacter(DRAFT_KEY);
  if (finalRecord.stage !== "staged_private" || finalRecord.stagedCharacterId == null) {
    stop(
      `staging post-condition failed: stage=${finalRecord.stage}, id=${finalRecord.stagedCharacterId}`
    );
  }
  if (staged.characterId !== finalRecord.stagedCharacterId) {
    stop("staging result id does not match official-supply record");
  }

  const row = store.database
    .prepare(
      `SELECT id, creator_id, name, description, greeting, system_prompt,
              assets, visibility, official, moderation_status, nsfw
       FROM characters WHERE id=?`
    )
    .get(finalRecord.stagedCharacterId) as
    | {
        id: number;
        creator_id: number | null;
        name: string;
        description: string;
        greeting: string;
        system_prompt: string;
        assets: string;
        visibility: string;
        official: number;
        moderation_status: string;
        nsfw: number;
      }
    | undefined;
  if (!row) stop("staged character row missing");
  const parsedAssets = JSON.parse(row.assets || "[]") as Array<{ url?: string }>;

  if (
    row.creator_id !== stagingUser.id ||
    row.name !== "루시안 바스케스" ||
    row.visibility !== "private" ||
    row.official !== 0 ||
    row.nsfw !== 0 ||
    parsedAssets.length !== 14 ||
    parsedAssets[0]?.url !== EXPECTED_REP_URL ||
    !row.description.includes("증권거래소 지하 금고") ||
    !row.greeting.includes("증권거래소 지하 금고") ||
    !row.system_prompt.includes("키: 184cm")
  ) {
    stop(
      `staged row invariant failed: ${JSON.stringify({
        creator_id: row.creator_id,
        name: row.name,
        visibility: row.visibility,
        official: row.official,
        nsfw: row.nsfw,
        assetCount: parsedAssets.length,
        firstAsset: parsedAssets[0]?.url,
        descriptionVault: row.description.includes("증권거래소 지하 금고"),
        greetingVault: row.greeting.includes("증권거래소 지하 금고"),
        height184: row.system_prompt.includes("키: 184cm"),
      })}`
    );
  }

  const lorebookRows = store.database
    .prepare(
      `SELECT entry_key FROM official_supply_world_lorebooks
       WHERE world_key=? AND creator_id=?
       ORDER BY entry_key`
    )
    .all(finalRecord.worldKey, stagingUser.id) as Array<{ entry_key: string }>;
  const expectedLorebookKeys = sharedLorebook.map((entry) => entry.entryKey).sort();
  if (stable(lorebookRows.map((row) => row.entry_key).sort()) !== stable(expectedLorebookKeys)) {
    stop(
      `staged lorebook mapping mismatch: actual=${JSON.stringify(lorebookRows)} expected=${JSON.stringify(expectedLorebookKeys)}`
    );
  }

  const otherAfter = snapshotOtherSupply(store);
  if (otherAfter !== otherBefore) {
    stop("another v4 supply character or asset changed during Lucian finalization");
  }

  const assets = store.listAssets(DRAFT_KEY);
  if (
    assets.length !== 14 ||
    assets.some((asset) => asset.status !== "approved" || asset.qa == null)
  ) {
    stop("not all 14 Lucian assets are approved with QA evidence");
  }

  console.log(
    JSON.stringify({
      status: "LUCIAN_COMPLETE_STAGED_PRIVATE",
      draftKey: DRAFT_KEY,
      characterId: finalRecord.stagedCharacterId,
      creatorId: stagingUser.id,
      creatorNickname: stagingUser.nickname,
      stage: finalRecord.stage,
      approvedAssetCount: assets.length,
      representativeUrl: assets.find((asset) => asset.kind === "representative")?.resultUrl,
      lorebookCount: lorebookRows.length,
      visibility: row.visibility,
      official: row.official,
      moderationStatus: row.moderation_status,
      publicPublishNotRun: true,
    })
  );
}

main().catch((error) => {
  console.error(
    "[lucian-finalize] STOP:",
    error instanceof Error ? error.stack ?? error.message : String(error)
  );
  process.exit(1);
});
