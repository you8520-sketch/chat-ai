import "server-only";

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { CharacterGenre } from "@/lib/characterGenres";
import { isCharacterGenre } from "@/lib/characterGenres";
import type { CharacterGender } from "@/lib/characterGender";
import { parseCharacterGender } from "@/lib/characterGender";
import { createCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { isAdminUser } from "@/lib/isAdminUser";
import {
  generateOfficialCharacterBible,
  generateOfficialPortfolioReplacement,
  generateOfficialWorldBible,
  liveOfficialAuthorTransport,
  resolveOfficialAuthorModelId,
  reviseOfficialCharacterVoice,
  validatePilotBible,
  validatePilotDraftForTextLock,
  validatePilotLorebook,
  withOfficialAuthorCallBudget,
  OfficialAuthorCallBudget,
  type OfficialAuthorTransport,
  type OfficialVoiceRevisionField,
} from "@/lib/officialSupply/author";
import { describeCastForPlanning, type PortfolioBriefInput, type WorldMarketInput } from "@/lib/officialSupply/authorPrompts";
import {
  compileOfficialDraftFromBible,
  evaluateRelationBibleContract,
  type OfficialCharacterBible,
  type OfficialWorldBible,
} from "@/lib/officialSupply/bible";
import { buildOfficialCharacterFormBody, computeTextLockHash } from "@/lib/officialSupply/characterText";
import {
  OFFICIAL_HUMOR_LEVELS,
  OFFICIAL_NAME_WORDPLAY,
  OFFICIAL_NARRATIVE_PACINGS,
  OFFICIAL_NARRATIVE_TONES,
  recommendOfficialCastIntent,
  resolveAdminAuthoringDirection,
  resolveOfficialAuthoringPlan,
  type OfficialAuthoringAxisChoice,
  type OfficialAuthoringPlan,
  type OfficialHumorLevel,
  type OfficialNameWordplay,
  type OfficialNarrativePacing,
  type OfficialNarrativeTone,
} from "@/lib/officialSupply/genreProfile";
import {
  evaluateBriefCastFit,
  evaluateDiscoveryTags,
  formatMarketSignalLines,
  selectMarketSignals,
  type OfficialBatchMarketPolicy,
} from "@/lib/officialSupply/marketFit";
import { validateResearchSnapshot, type ResearchSnapshot } from "@/lib/officialSupply/research";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import type { OfficialCharacterDraft, QaIssue } from "@/lib/officialSupply/types";
import { evaluateInternalRegionConsistency, internalWorldRegions } from "@/lib/officialSupply/worldQa";

/** World (3) + one brief replan + character (3) + two explicit voice repairs. */
export const ADMIN_AUTHOR_CALL_CAP = 12;
const MAX_EXPLICIT_VOICE_REPAIRS = 2;
const MAX_CAST_INTENT_CHARS = 500;
/** Max in-memory unsaved previews per process; saved holds are kept for save idempotency. */
const UNSAVED_HOLD_LIMIT = 20;

const MARKET_POLICY: OfficialBatchMarketPolicy = {
  targetLocale: "ko-KR",
  signalRegion: "KR",
  marketPriority: "domestic_first",
  maxSupportingSignals: 4,
  marketRoleMix: { proven: { min: 0, max: 1 }, proven_twist: { min: 0, max: 1 }, experimental: { min: 0, max: 1 } },
  maxPrimaryTropeRepeat: 1,
  coreTags: { min: 4, max: 7 },
  maxTaglineWorldTerms: 2,
};

export type AdminAuthorSelection = {
  genre: CharacterGenre;
  tone: OfficialAuthoringAxisChoice<OfficialNarrativeTone>;
  humor: OfficialAuthoringAxisChoice<OfficialHumorLevel>;
  pacing: OfficialAuthoringAxisChoice<OfficialNarrativePacing>;
  nameWordplay: OfficialAuthoringAxisChoice<OfficialNameWordplay>;
  gender: CharacterGender;
  castIntent: string;
};

export type AdminAuthorIssue = { code: string; message: string };

export type AdminAuthorManuscriptView = {
  name: string;
  tagline: string;
  description: string;
  greeting: string;
  genres: string[];
  tags: string[];
};

export type AdminAuthorResolvedView = {
  genre: string;
  tone: string;
  humor: string;
  pacing: string;
  nameWordplay: string;
  worldScale: string;
  namingProfile: string;
  castIntent: string;
};

export type AdminAuthorPreviewOk = {
  ok: true;
  previewId: string;
  qaOk: boolean;
  issues: AdminAuthorIssue[];
  repairable: boolean;
  voiceRepairs: number;
  textLock: string;
  manuscript: AdminAuthorManuscriptView;
  resolved: AdminAuthorResolvedView;
};

export type AdminAuthorPreviewResult = AdminAuthorPreviewOk | { ok: false; error: string; issues?: AdminAuthorIssue[] };

type Hold = {
  id: string;
  adminUserId: number;
  draftKey: string;
  plan: OfficialAuthoringPlan;
  world: OfficialWorldBible;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  draft: OfficialCharacterDraft;
  castIntent: string;
  issues: QaIssue[];
  voiceRepairs: number;
  savedCharacterId: number | null;
};

const holds = new Map<string, Hold>();

type SaveHeldResult =
  | { ok: true; characterId: number; alreadySaved: boolean }
  | { ok: false; status: number; error: string };

const saveInFlight = new Map<string, Promise<SaveHeldResult>>();
const repairInFlight = new Map<string, Promise<AdminAuthorPreviewResult>>();

function axisChoice<T extends string>(value: unknown, allowed: readonly T[]): T | "auto" | null {
  if (value == null || value === "" || value === "auto") return "auto";
  return allowed.includes(value as T) ? (value as T) : null;
}

export function parseAdminAuthorSelection(body: unknown): { ok: true; selection: AdminAuthorSelection } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "요청 형식이 올바르지 않습니다." };
  const raw = body as Record<string, unknown>;
  const genre = raw.genre;
  if (typeof genre !== "string" || !isCharacterGenre(genre)) return { ok: false, error: "장르를 선택해 주세요." };
  const tone = axisChoice(raw.tone, OFFICIAL_NARRATIVE_TONES);
  const humor = axisChoice(raw.humor, OFFICIAL_HUMOR_LEVELS);
  const pacing = axisChoice(raw.pacing, OFFICIAL_NARRATIVE_PACINGS);
  const nameWordplay = axisChoice(raw.nameWordplay, OFFICIAL_NAME_WORDPLAY);
  const gender = parseCharacterGender(raw.gender);
  if (!tone || !humor || !pacing || !nameWordplay || !gender) return { ok: false, error: "문체·유머·전개·작명·성별 값이 올바르지 않습니다." };
  const castIntent = typeof raw.castIntent === "string" ? raw.castIntent.trim() : "";
  if (castIntent.length > MAX_CAST_INTENT_CHARS) return { ok: false, error: "캐스트 의도가 너무 깁니다." };
  return { ok: true, selection: { genre, tone, humor, pacing, nameWordplay, gender, castIntent } };
}

function snapshotAndCast(): { snapshot: ResearchSnapshot; kept: PortfolioBriefInput[] } {
  const root = process.cwd();
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(root, "docs/official-supply/market-research-snapshot-2026-09.json"), "utf8")
  ) as ResearchSnapshot;
  const snapshotQa = validateResearchSnapshot(snapshot);
  if (!snapshotQa.ok) throw new OfficialSupplyGateError("research_snapshot_invalid", snapshotQa.errors.map((e) => e.message).join("; "), snapshotQa);
  const pilot = JSON.parse(
    fs.readFileSync(path.join(root, "src/lib/officialSupply/pilot/world-bible.json"), "utf8")
  ) as { bible: OfficialWorldBible };
  return { snapshot, kept: pilot.bible.portfolio };
}

function marketFor(snapshot: ResearchSnapshot, plan: OfficialAuthoringPlan): WorldMarketInput {
  const selection = selectMarketSignals(snapshot, MARKET_POLICY, plan.genre ?? "", {
    excludeRomanceLed: plan.profile.excludeRomanceLedSignals,
  });
  return {
    targetLocale: MARKET_POLICY.targetLocale,
    marketPriority: MARKET_POLICY.marketPriority,
    signalLines: formatMarketSignalLines(selection),
    namingProfile: plan.namingProfile,
    marketRoleMix: MARKET_POLICY.marketRoleMix,
    maxPrimaryTropeRepeat: MARKET_POLICY.maxPrimaryTropeRepeat,
    coreTags: MARKET_POLICY.coreTags,
  };
}

function worldContext(world: OfficialWorldBible, brief: PortfolioBriefInput): string {
  const faction = world.factions.find((item) => item.name === brief.faction);
  const locations = world.locations
    .slice(0, 4)
    .map((location) => `${location.name}(${location.purpose})`)
    .join(" / ");
  return [
    `세계: ${world.name} — ${world.centralPremise}`,
    `현재: ${world.situation.biggestEvent}`,
    brief.faction && faction ? `소속 세력 ${faction.name}: ${faction.purpose} / 일반 시선: ${faction.publicView}` : "",
    `능력 규칙(한계·대가·금기): ${world.powerSystem.limits} / ${world.powerSystem.costs} / ${world.powerSystem.taboos}`,
    `주요 장소: ${locations}`,
    `유저 진입: ${world.userEntry.allowedRoles.join("·")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function briefGate(
  brief: PortfolioBriefInput,
  world: OfficialWorldBible,
  kept: PortfolioBriefInput[],
  plan: OfficialAuthoringPlan,
  snapshot: ResearchSnapshot,
  gender: CharacterGender
): string[] {
  const errors = evaluateBriefCastFit({
    fresh: [brief],
    kept,
    snapshot,
    policy: MARKET_POLICY,
    namingProfile: plan.namingProfile,
  }).errors;
  if (brief.age < 19) errors.push(`age ${brief.age} < 19`);
  if (brief.adultCandidate) errors.push("adultCandidate must stay false");
  if (brief.gender !== gender) errors.push(`gender ${brief.gender} != ${gender}`);
  errors.push(
    ...evaluateInternalRegionConsistency(JSON.stringify(brief), internalWorldRegions(world.regions)).errors.map((e) => `region ${e.code}`)
  );
  return errors;
}

export function officialVoiceFieldsForQaCodes(codes: readonly string[]): OfficialVoiceRevisionField[] {
  const fields = new Set<OfficialVoiceRevisionField>();
  for (const code of codes) {
    if (code.startsWith("bible_greeting")) fields.add("greeting");
    if (code.startsWith("bible_pitch")) fields.add("publicDescription");
    if (code.startsWith("bible_speech")) fields.add("speech");
    if (code === "tag_bible_mismatch" || code === "bible_tags" || code === "tags_keyword_stuffing") fields.add("tags");
    if (code === "official_character_pronoun" || code === "bible_character_pronoun") fields.add("publicDescription");
  }
  return [...fields];
}

export function assessAdminAuthorManuscript(input: {
  draft: OfficialCharacterDraft;
  bible: OfficialCharacterBible;
  world: OfficialWorldBible;
  brief: PortfolioBriefInput;
}): QaIssue[] {
  const hook = {
    archetype: input.brief.archetype,
    relationshipTrope: input.brief.relationshipTrope,
    rpHook: input.brief.rpHook,
  };
  return [
    ...validatePilotBible(input.bible, { adultExpected: false }).errors,
    ...evaluateDiscoveryTags({ tags: input.bible.publicProfile.tags, bible: input.bible, hook }, MARKET_POLICY).errors,
    ...validatePilotDraftForTextLock(input.draft, []).errors,
    ...evaluateRelationBibleContract(input.bible).errors,
    ...validatePilotLorebook(input.world.lorebook, [input.draft]).errors,
  ];
}

function unsavedHoldCount(excludeId?: string): number {
  let count = 0;
  for (const [id, hold] of holds) {
    if (id === excludeId) continue;
    if (hold.savedCharacterId == null) count += 1;
  }
  return count;
}

function evictUnsavedHolds(excludeId: string): void {
  while (unsavedHoldCount(excludeId) >= UNSAVED_HOLD_LIMIT) {
    let removed = false;
    for (const [id, hold] of holds) {
      if (id === excludeId) continue;
      if (hold.savedCharacterId != null) continue;
      holds.delete(id);
      removed = true;
      break;
    }
    if (!removed) break;
  }
}

function resolvedView(plan: OfficialAuthoringPlan, castIntent: string): AdminAuthorResolvedView {
  return {
    genre: plan.genre ?? "",
    tone: plan.tone ?? "",
    humor: plan.humor ?? "",
    pacing: plan.pacing ?? "",
    nameWordplay: plan.nameWordplay ?? "",
    worldScale: plan.profile.worldScale,
    namingProfile: plan.namingProfile,
    castIntent,
  };
}

function publicPreview(hold: Hold): AdminAuthorPreviewOk {
  const repairFields = officialVoiceFieldsForQaCodes(hold.issues.map((issue) => issue.code));
  const repairable =
    hold.issues.length > 0 &&
    hold.voiceRepairs < MAX_EXPLICIT_VOICE_REPAIRS &&
    hold.issues.every((issue) => officialVoiceFieldsForQaCodes([issue.code]).length > 0) &&
    repairFields.length > 0;
  return {
    ok: true,
    previewId: hold.id,
    qaOk: hold.issues.length === 0,
    issues: hold.issues.map((issue) => ({ code: issue.code, message: issue.message })),
    repairable,
    voiceRepairs: hold.voiceRepairs,
    textLock: computeTextLockHash(hold.draft),
    manuscript: {
      name: hold.draft.name,
      tagline: hold.draft.tagline,
      description: hold.draft.description,
      greeting: hold.draft.greeting,
      genres: [...hold.draft.genres],
      tags: [...hold.draft.tags],
    },
    resolved: resolvedView(hold.plan, hold.castIntent),
  };
}

function holdManuscript(input: {
  adminUserId: number;
  draftKey: string;
  plan: OfficialAuthoringPlan;
  world: OfficialWorldBible;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  castIntent: string;
  voiceRepairs: number;
}): AdminAuthorPreviewOk {
  if (!input.plan.genre || !isCharacterGenre(input.plan.genre)) {
    throw new OfficialSupplyGateError("author_shape_invalid", "genre missing on authoring plan");
  }
  const draft = compileOfficialDraftFromBible(input.bible, {
    draftKey: input.draftKey,
    worldKey: "admin_private_v1",
    styleKey: "admin_draft_v1",
    genres: [input.plan.genre],
    audience: input.brief.audience,
    worldName: input.world.name,
    worldBible: input.world,
    hook: {
      archetype: input.brief.archetype,
      relationshipTrope: input.brief.relationshipTrope,
      occupation: input.brief.occupation,
      rpHook: input.brief.rpHook,
    },
  });
  const issues = assessAdminAuthorManuscript({ draft, bible: input.bible, world: input.world, brief: input.brief });
  const hold: Hold = {
    id: randomBytes(16).toString("hex"),
    adminUserId: input.adminUserId,
    draftKey: input.draftKey,
    plan: input.plan,
    world: input.world,
    brief: input.brief,
    bible: input.bible,
    draft,
    castIntent: input.castIntent,
    issues,
    voiceRepairs: input.voiceRepairs,
    savedCharacterId: null,
  };
  holds.set(hold.id, hold);
  evictUnsavedHolds(hold.id);
  return publicPreview(hold);
}

function fail(error: unknown): AdminAuthorPreviewResult {
  if (error instanceof OfficialSupplyGateError) {
    return {
      ok: false,
      error: error.message,
      ...(error.qa ? { issues: error.qa.errors.map((issue) => ({ code: issue.code, message: issue.message })) } : {}),
    };
  }
  return { ok: false, error: error instanceof Error ? error.message : "생성에 실패했습니다." };
}

function transportFor(inner: OfficialAuthorTransport | undefined, budget: OfficialAuthorCallBudget): OfficialAuthorTransport {
  return withOfficialAuthorCallBudget(inner ?? liveOfficialAuthorTransport, budget);
}

export async function previewAdminOfficialCharacter(input: {
  adminUserId: number;
  selection: AdminAuthorSelection;
  transport?: OfficialAuthorTransport;
}): Promise<AdminAuthorPreviewResult> {
  const direction = resolveAdminAuthoringDirection(input.selection);
  const plan = resolveOfficialAuthoringPlan(direction);
  const castIntent = input.selection.castIntent || recommendOfficialCastIntent(input.selection.genre);
  const gender = input.selection.gender;
  const budget = new OfficialAuthorCallBudget(ADMIN_AUTHOR_CALL_CAP);
  const transport = transportFor(input.transport, budget);
  const modelId = resolveOfficialAuthorModelId();
  try {
    const { snapshot, kept } = snapshotAndCast();
    const market = marketFor(snapshot, plan);
    const genderMix = gender === "female" ? "여성 1명" : gender === "male" ? "남성 1명" : "기타 1명";
    const generatedWorld = await generateOfficialWorldBible({
      transport,
      modelId,
      world: {
        genre: input.selection.genre,
        worldKey: "admin_private_v1",
        styleKey: "admin_draft_v1",
        market,
        slots: 1,
        adultCandidates: 0,
        genderMix,
        slotGenders: [gender],
        castIntent,
        authoring: plan,
      },
    });
    let world = generatedWorld.bible;
    let brief = world.portfolio[0];
    if (!brief) return { ok: false, error: "포트폴리오 브리프가 없습니다." };
    let gateErrors = briefGate(brief, world, kept, plan, snapshot, gender);
    if (gateErrors.length) {
      const replanned = await generateOfficialPortfolioReplacement({
        transport,
        modelId,
        replacement: {
          worldName: world.name,
          centralPremise: world.centralPremise,
          factionNames: world.factions.map((faction) => faction.name),
          locationNames: world.locations.map((location) => location.name),
          market,
          castIntent,
          keptSiblings: kept.map(describeCastForPlanning),
          slots: [{ slot: 1, gender, adultCandidate: false, direction: "브리프 게이트를 통과하는 한 명만 다시 계획한다." }],
          feedback: gateErrors.join("; "),
          authoring: plan,
        },
      });
      brief = replanned.briefs[0]!;
      world = { ...world, portfolio: [brief] };
      gateErrors = briefGate(brief, world, kept, plan, snapshot, gender);
      if (gateErrors.length) {
        return { ok: false, error: "브리프 검수를 통과하지 못했습니다.", issues: gateErrors.map((message) => ({ code: "brief_gate", message })) };
      }
    }
    const generated = await generateOfficialCharacterBible({
      transport,
      modelId,
      authoring: plan,
      part1: {
        brief,
        worldName: world.name,
        worldContext: worldContext(world, brief),
        siblingSketches: kept.map(describeCastForPlanning),
      },
      voice: {
        name: brief.name,
        age: brief.age,
        gender: brief.gender,
        adultCandidate: false,
        speechDirection: brief.speechDirection,
        npcDemand: "이야기에 반복 역할이 실제로 필요할 때만 1~2명. 필요 없으면 0명([]).",
        marketFit: brief.marketFit,
        userRelation: brief.userRelation,
      },
      bonds: {
        name: brief.name,
        age: brief.age,
        rpHook: brief.rpHook,
        adultCandidate: false,
        castList: [],
        userRelation: brief.userRelation,
      },
    });
    return holdManuscript({
      adminUserId: input.adminUserId,
      draftKey: `admin-${randomBytes(8).toString("hex")}`,
      plan,
      world,
      brief,
      bible: generated.bible,
      castIntent,
      voiceRepairs: 0,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function repairHeldAdminAuthorPreview(input: {
  adminUserId: number;
  previewId: string;
  transport?: OfficialAuthorTransport;
}): Promise<AdminAuthorPreviewResult> {
  const inFlight = repairInFlight.get(input.previewId);
  if (inFlight) return inFlight;

  const hold = holds.get(input.previewId);
  if (!hold || hold.adminUserId !== input.adminUserId) return { ok: false, error: "미리보기를 찾을 수 없습니다." };
  if (hold.savedCharacterId != null) return { ok: false, error: "이미 저장된 초안은 에디터에서 수정합니다." };
  if (hold.issues.length === 0) return { ok: false, error: "고칠 검수 오류가 없습니다." };
  if (hold.voiceRepairs >= MAX_EXPLICIT_VOICE_REPAIRS) return { ok: false, error: "선택 보정 횟수를 모두 사용했습니다." };
  const fields = officialVoiceFieldsForQaCodes(hold.issues.map((issue) => issue.code));
  const repairable = hold.issues.every((issue) => officialVoiceFieldsForQaCodes([issue.code]).length > 0) && fields.length > 0;
  if (!repairable) return { ok: false, error: "이 오류는 선택 보정으로 고칠 수 없습니다. 원고는 저장하지 않습니다." };

  const budget = new OfficialAuthorCallBudget(1);
  let resolveFlight!: (result: AdminAuthorPreviewResult) => void;
  const flight = new Promise<AdminAuthorPreviewResult>((resolve) => {
    resolveFlight = resolve;
  });
  repairInFlight.set(input.previewId, flight);

  void (async () => {
    try {
      const current = holds.get(input.previewId);
      if (!current || current.adminUserId !== input.adminUserId) {
        resolveFlight({ ok: false, error: "미리보기를 찾을 수 없습니다." });
        return;
      }
      if (current.savedCharacterId != null) {
        resolveFlight({ ok: false, error: "이미 저장된 초안은 에디터에서 수정합니다." });
        return;
      }
      if (current.voiceRepairs >= MAX_EXPLICIT_VOICE_REPAIRS) {
        resolveFlight({ ok: false, error: "선택 보정 횟수를 모두 사용했습니다." });
        return;
      }
      try {
        const revised = await reviseOfficialCharacterVoice({
          transport: transportFor(input.transport, budget),
          modelId: resolveOfficialAuthorModelId(),
          authoring: current.plan,
          bible: current.bible,
          voice: {
            name: current.brief.name,
            age: current.brief.age,
            gender: current.brief.gender,
            adultCandidate: false,
            speechDirection: current.brief.speechDirection,
            npcDemand: "기존 NPC를 유지한다(새로 만들지 않는다).",
            marketFit: current.brief.marketFit,
            userRelation: current.brief.userRelation,
          },
          fields,
          reasons: current.issues.map((issue) => `${issue.code}: ${issue.message}`),
        });
        const next = holdManuscript({
          adminUserId: current.adminUserId,
          draftKey: current.draftKey,
          plan: current.plan,
          world: current.world,
          brief: current.brief,
          bible: revised.bible,
          castIntent: current.castIntent,
          voiceRepairs: current.voiceRepairs + 1,
        });
        holds.delete(current.id);
        resolveFlight(next);
      } catch (error) {
        resolveFlight(fail(error));
      }
    } finally {
      if (repairInFlight.get(input.previewId) === flight) repairInFlight.delete(input.previewId);
    }
  })();

  return flight;
}

export function holdAdminAuthorManuscriptForTests(input: {
  adminUserId: number;
  plan: OfficialAuthoringPlan;
  world: OfficialWorldBible;
  brief: PortfolioBriefInput;
  bible: OfficialCharacterBible;
  castIntent?: string;
}): AdminAuthorPreviewOk {
  return holdManuscript({
    adminUserId: input.adminUserId,
    draftKey: `admin-test-${randomBytes(4).toString("hex")}`,
    plan: input.plan,
    world: input.world,
    brief: input.brief,
    bible: input.bible,
    castIntent: input.castIntent ?? "",
    voiceRepairs: 0,
  });
}

export function clearAdminAuthorPreviewsForTests(): void {
  holds.clear();
  saveInFlight.clear();
  repairInFlight.clear();
}

export function markAdminAuthorPreviewSavedForTests(previewId: string, characterId: number): void {
  const hold = holds.get(previewId);
  if (hold) hold.savedCharacterId = characterId;
}

export async function saveHeldAdminAuthorPreview(admin: SessionUser, previewId: string): Promise<SaveHeldResult> {
  if (!isAdminUser({ ...admin, email: admin.email ?? "" })) {
    return { ok: false, status: 403, error: "관리자 권한이 필요합니다." };
  }
  const existingFlight = saveInFlight.get(previewId);
  if (existingFlight) return existingFlight;

  const hold = holds.get(previewId);
  if (!hold || hold.adminUserId !== admin.id) return { ok: false, status: 404, error: "미리보기를 찾을 수 없습니다." };
  if (hold.savedCharacterId != null) return { ok: true, characterId: hold.savedCharacterId, alreadySaved: true };
  if (hold.issues.length > 0) {
    return { ok: false, status: 409, error: "검수를 통과하지 않은 원고는 저장하지 않습니다." };
  }

  let resolveFlight!: (result: SaveHeldResult) => void;
  const flight = new Promise<SaveHeldResult>((resolve) => {
    resolveFlight = resolve;
  });
  saveInFlight.set(previewId, flight);

  void (async () => {
    try {
      const current = holds.get(previewId);
      if (!current || current.adminUserId !== admin.id) {
        resolveFlight({ ok: false, status: 404, error: "미리보기를 찾을 수 없습니다." });
        return;
      }
      if (current.savedCharacterId != null) {
        resolveFlight({ ok: true, characterId: current.savedCharacterId, alreadySaved: true });
        return;
      }
      if (current.issues.length > 0) {
        resolveFlight({ ok: false, status: 409, error: "검수를 통과하지 않은 원고는 저장하지 않습니다." });
        return;
      }
      const created = await createCharacterFromForm(
        admin,
        buildOfficialCharacterFormBody({
          draft: current.draft,
          appearanceBlock: "",
          assets: [],
        })
      );
      if (!created.ok) {
        resolveFlight({ ok: false, status: created.status ?? 400, error: created.error });
        return;
      }
      current.savedCharacterId = created.id;
      resolveFlight({ ok: true, characterId: created.id, alreadySaved: false });
    } finally {
      if (saveInFlight.get(previewId) === flight) saveInFlight.delete(previewId);
    }
  })();

  return flight;
}
