import { getDb } from "@/lib/db";
import type { CharacterAsset } from "@/lib/characterAssets";
import { assetUrls } from "@/lib/characterAssets";
import { parseCharacterGender } from "@/lib/characterGender";
import { buildSaveAndTranslateCharacterChunks } from "@/lib/characterChunks";
import {
  characterAdultTextBlob,
  findAdultTermsInText,
} from "@/lib/characterAdultText";
import {
  allAgesListingBlockReason,
  decideCharacterListing,
} from "@/lib/characterListingModeration";
import {
  primaryCharacterGenre,
  sanitizeCharacterGenres,
} from "@/lib/characterGenres";
import {
  canImportCharacterIntoSimulation,
  parseVisibility,
  sharePath,
  type CharacterVisibility,
  type ModerationStatus,
} from "@/lib/characterVisibility";
import { CHARACTER_NAME_LIMIT, CREATOR_COMMENT_LIMIT } from "@/lib/characters";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { normalizeCreatorRecommendedStyle } from "@/lib/writingStylePreset";
import {
  composeExampleDialog,
  parseSpeechCreatorFromBody,
  speechCreatorCharCount,
  validateSpeechCreatorInput,
} from "@/lib/speechCreatorFields";
import { parseCharacterTagsInput } from "@/lib/characterTags";
import {
  notifyCharacterReviewResult,
  notifyFollowersOfNewCharacter,
} from "@/lib/userNotifications";
import {
  parseStatusWidgetJson,
  serializeStatusWidget,
} from "@/lib/statusWidget/serialize";
import {
  compiledPublicCanonText,
  compileCreatorDescriptionTriggers,
  mergeDescriptionTriggerCandidates,
  serializeCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import { buildCanonPlanForSave } from "@/lib/canonPlan/compileForSave";
import {
  listCharacterStatusWidgetTriggers,
  saveCharacterStatusWidgetTriggers,
  validateStatusWidgetTriggerInputs,
  type StatusWidgetTriggerInput,
} from "@/lib/statusWidgetTriggers";
import { countPublicDescriptionVisibleChars } from "@/lib/publicDescriptionText";
import {
  APPEARANCE_COMPILED_VERSION,
  appearancePromptText,
  compileAppearanceForChat,
  extractAppearanceRawFromSetting,
  hashAppearanceRaw,
  replaceAppearanceInSetting,
  serializeAppearanceCompiledJson,
} from "@/lib/appearanceCompiler";
import {
  buildSimulationSystemPrompt,
  parseContentKind,
  type ContentKind,
  type SimulationImportSnapshot,
} from "@/lib/simulationMode";
import {
  prepareSimulationVisualSubjectsForSave,
  sanitizeAssetVisualSubjectKeys,
  serializeSimulationVisualSubjectsJson,
  SimulationVisualSubjectsInputError,
  validateSimulationVisualSubjectsDocument,
} from "@/lib/simulationVisualSubjects";
import {
  normalizeAdultDialogueProfile,
  type AdultConsentMode,
  type AdultDialogueProfile,
  type AdultStatus,
} from "@/lib/adultSceneRouting";
import {
  deriveAdultStatusFromParticipantMinAge,
  resolveParticipantMinAgeForSave,
  validateNsfwParticipantAgeContract,
} from "@/lib/participantMinAge";

import {
  AI_LEARNING_LIMIT,
  AI_LEARNING_MIN,
  GREETING_LIMIT,
  TAGLINE_LIMIT,
} from "./characterFormLimits";

export {
  AI_LEARNING_LIMIT,
  AI_LEARNING_MIN,
  GREETING_LIMIT,
  TAGLINE_LIMIT,
} from "./characterFormLimits";


export type SessionUser = { id: number; nickname: string; is_adult: number };

export type ParsedCharacterForm = {
  contentKind: ContentKind;
  simulationCast: string;
  simulationRules: string;
  simulationImportsJson: string;
  name: string;
  tagline: string;
  description: string;
  greeting: string;
  systemPrompt: string;
  world: string;
  worldId: number | null;
  lorebookId: number | null;
  statusWindowPrompt: string;
  statusWidgetJson: string;
  statusWidgetTriggers: StatusWidgetTriggerInput[];
  exampleDialog: string;
  speechInput: ReturnType<typeof parseSpeechCreatorFromBody>;
  gender: NonNullable<ReturnType<typeof parseCharacterGender>>;
  genres: ReturnType<typeof sanitizeCharacterGenres>;
  primaryGenre: string;
  recommendedWritingStyle: ReturnType<typeof normalizeCreatorRecommendedStyle>;
  assets: CharacterAsset[];
  images: string[];
  audience: string;
  requestedVisibility: CharacterVisibility;
  nsfw: boolean;
  participantMinAge: number | null;
  adultDialogueProfile: AdultDialogueProfile;
  adultStatus: AdultStatus;
  adultConsentModesAllowed: AdultConsentMode[];
  commentsEnabled: number;
  creatorComment: string;
  simulationReuseAllowed: number;
  simulationNsfwAllowed: number;
  trpgReuseAllowed: number;
  simulationVisualSubjectsJson: string;
  emoji: string;
  hue: number;
  tagsJson: string;
};

function parseAssetsFromFormBody(rawAssets: unknown): CharacterAsset[] {
  const parsed = Array.isArray(rawAssets)
    ? rawAssets
        .filter((a: unknown) => a && typeof a === "object" && "url" in (a as object) && "tag" in (a as object))
        .map((a: {
          url: string;
          tag: string;
          visualSubjectKey?: string;
          public?: boolean;
          chat?: boolean;
          viewerBlur?: boolean;
          adultFlagged?: boolean;
          moderationReject?: boolean;
          moderationReason?: string;
          width?: number;
          height?: number;
          orientation?: "landscape" | "portrait" | "square";
        }, index: number) => ({
          url: String(a.url),
          tag: String(a.tag).slice(0, 32),
          public: true,
          chat: true,
          // 1번 대표 이미지는 항상 공개
          viewerBlur: index === 0 ? false : a.viewerBlur === true,
          ...(typeof a.adultFlagged === "boolean" ? { adultFlagged: a.adultFlagged } : {}),
          ...(typeof a.moderationReject === "boolean" ? { moderationReject: a.moderationReject } : {}),
          ...(typeof a.moderationReason === "string" && a.moderationReason.trim()
            ? { moderationReason: a.moderationReason.trim().slice(0, 200) }
            : {}),
          ...(Number(a.width) > 0 ? { width: Math.round(Number(a.width)) } : {}),
          ...(Number(a.height) > 0 ? { height: Math.round(Number(a.height)) } : {}),
          ...(a.orientation === "landscape" || a.orientation === "portrait" || a.orientation === "square"
            ? { orientation: a.orientation }
            : {}),
          ...(typeof a.visualSubjectKey === "string" && a.visualSubjectKey.trim()
            ? { visualSubjectKey: a.visualSubjectKey.trim() }
            : {}),
        }))
        .filter((a: CharacterAsset) => a.url.startsWith("/uploads/") || a.url.startsWith("http"))
        .slice(0, 100)
    : [];
  if (parsed[0]) parsed[0] = { ...parsed[0], viewerBlur: false };
  return parsed;
}

function parseAdultConsentModes(value: unknown): AdultConsentMode[] {
  const source = Array.isArray(value) ? value : [];
  const allowed = source.filter(
    (item): item is AdultConsentMode =>
      item === "standard" || item === "power_play" || item === "cnc_opt_in"
  );
  return Array.from(new Set<AdultConsentMode>(["standard", ...allowed]));
}

function parseExplicitAdultStatus(value: unknown): AdultStatus | null {
  return value === "confirmed" ||
    value === "minor" ||
    value === "conflict" ||
    value === "unknown"
    ? value
    : null;
}

function deriveAdultStatusForSave(input: {
  participantMinAge: number | null;
  legacyExplicitStatus?: AdultStatus | null;
}): AdultStatus {
  if (input.participantMinAge != null) {
    return deriveAdultStatusFromParticipantMinAge(input.participantMinAge);
  }
  return input.legacyExplicitStatus ?? "unknown";
}

function parseSimulationImportIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ).slice(0, 12);
}

function resolveSimulationImports(
  db: ReturnType<typeof getDb>,
  input: { ids: number[]; creatorId: number; simulationNsfw: boolean },
): { ok: true; snapshots: SimulationImportSnapshot[] } | { ok: false; error: string; status: number } {
  if (input.ids.length === 0) return { ok: true, snapshots: [] };
  const placeholders = input.ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, name, creator_id, creator_name, system_prompt, world, example_dialog,
              visibility, moderation_status, nsfw, content_kind
       FROM characters WHERE id IN (${placeholders})`,
    )
    .all(...input.ids) as Array<{
      id: number;
      name: string;
      creator_id: number | null;
      creator_name: string;
      system_prompt: string;
      world: string;
      example_dialog: string;
      visibility: string;
      moderation_status: string;
      nsfw: number;
      content_kind: string;
    }>;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const snapshots: SimulationImportSnapshot[] = [];
  for (const id of input.ids) {
    const row = byId.get(id);
    if (!row || row.content_kind === "simulation") {
      return { ok: false, error: "불러올 캐릭터를 찾을 수 없습니다.", status: 404 };
    }
    const owned = canImportCharacterIntoSimulation(row.creator_id, input.creatorId);
    if (!owned) {
      return { ok: false, error: `${row.name}: 다른 제작자의 캐릭터는 시뮬레이션에 불러올 수 없습니다.`, status: 403 };
    }
    if (row.nsfw === 1 && !input.simulationNsfw) {
      return { ok: false, error: `${row.name}: 성인용 캐릭터를 사용하려면 시뮬레이션도 성인용으로 설정해 주세요.`, status: 400 };
    }
    snapshots.push({
      characterId: row.id,
      name: row.name,
      creatorId: row.creator_id,
      creatorName: row.creator_name,
      systemPrompt: row.system_prompt,
      world: row.world,
      exampleDialog: row.example_dialog,
    });
  }
  return { ok: true, snapshots };
}

export function parseCharacterFormBody(
  b: Record<string, unknown>,
  user: SessionUser,
  options?: {
    existingParticipantMinAge?: number | null;
    requireStructuredAge?: boolean;
  }
): { ok: true; data: ParsedCharacterForm } | { ok: false; error: string; status: number } {
  if (!user.is_adult) {
    return { ok: false, error: "캐릭터 제작·수정은 성인인증 완료 후 가능합니다.", status: 403 };
  }
  const contentKind = parseContentKind(b.content_kind ?? b.contentKind);
  const simulationCast =
    contentKind === "simulation"
      ? String(b.simulation_cast ?? b.simulationCast ?? b.system_prompt ?? "").trim()
      : "";
  const simulationRules =
    contentKind === "simulation"
      ? String(b.simulation_rules ?? b.simulationRules ?? "").trim()
      : "";
  if (!b.name || (contentKind === "simulation" ? !simulationCast : !b.system_prompt)) {
    return { ok: false, error: "이름과 캐릭터 설정은 필수입니다.", status: 400 };
  }

  const name = String(b.name).trim().slice(0, CHARACTER_NAME_LIMIT);
  const tagline = String(b.tagline || "").trim().slice(0, TAGLINE_LIMIT);
  if (!name) return { ok: false, error: "캐릭터 이름(또는 시뮬레이션명)을 입력해 주세요.", status: 400 };
  if (!tagline) return { ok: false, error: "한 줄 소개를 입력해 주세요.", status: 400 };

  const description = String(b.description || "");
  let systemPrompt =
    contentKind === "simulation"
      ? buildSimulationSystemPrompt({ cast: simulationCast, rules: simulationRules })
      : String(b.system_prompt || "");
  const statusWindowPrompt = "";
  const rawWidget = b.status_widget_json ?? b.status_widget;
  const parsedWidget =
    typeof rawWidget === "string"
      ? parseStatusWidgetJson(rawWidget)
      : rawWidget && typeof rawWidget === "object"
        ? parseStatusWidgetJson(JSON.stringify(rawWidget))
        : null;
  const statusWidgetJson = parsedWidget ? serializeStatusWidget(parsedWidget) : "";
  const parsedTriggers = validateStatusWidgetTriggerInputs(b.status_widget_triggers);
  if (!parsedTriggers.ok) {
    return { ok: false, error: parsedTriggers.error, status: 400 };
  }
  let world = String(b.world || "");
  const speechInput = parseSpeechCreatorFromBody(b);
  const exampleDialog = composeExampleDialog(speechInput);
  const greeting = String(b.greeting || "");
  const nsfw = b.nsfw === true;
  const adultDialogueProfile = normalizeAdultDialogueProfile(
    b.adult_dialogue_profile ?? b.adultDialogueProfile
  );
  const participantMinAgeResult = resolveParticipantMinAgeForSave({
    bodyValue: b.participant_min_age ?? b.participantMinAge,
    existingValue: options?.existingParticipantMinAge ?? null,
    requireStructuredAge: options?.requireStructuredAge ?? true,
  });
  if (!participantMinAgeResult.ok) {
    return { ok: false, error: participantMinAgeResult.error, status: 400 };
  }
  const participantMinAge = participantMinAgeResult.value;
  const nsfwAgeError = validateNsfwParticipantAgeContract({
    nsfw,
    participantMinAge,
  });
  if (nsfwAgeError) {
    return { ok: false, error: nsfwAgeError, status: 400 };
  }
  const adultStatus = deriveAdultStatusForSave({
    participantMinAge,
    legacyExplicitStatus: parseExplicitAdultStatus(b.adult_status ?? b.adultStatus),
  });
  const adultConsentModesAllowed = parseAdultConsentModes(
    b.adult_consent_modes_allowed ?? b.adultConsentModesAllowed
  );

  let worldId: number | null = null;
  const rawWorldId = b.world_id ?? b.worldId;
  if (rawWorldId != null && rawWorldId !== "") {
    worldId = Number(rawWorldId);
    if (!Number.isFinite(worldId) || worldId <= 0) {
      return { ok: false, error: "잘못된 세계관 ID입니다.", status: 400 };
    }
  }

  let lorebookId: number | null = null;
  const rawLorebookId = b.lorebook_id ?? b.lorebookId;
  if (rawLorebookId != null && rawLorebookId !== "") {
    lorebookId = Number(rawLorebookId);
    if (!Number.isFinite(lorebookId) || lorebookId <= 0) {
      return { ok: false, error: "잘못된 로어북 ID입니다.", status: 400 };
    }
  }

  const db = getDb();
  if (worldId != null) {
    const worldRow = db
      .prepare("SELECT id, content FROM worlds WHERE id = ? AND creator_id = ?")
      .get(worldId, user.id) as { id: number; content: string } | undefined;
    if (!worldRow) {
      return { ok: false, error: "선택한 세계관을 찾을 수 없습니다.", status: 404 };
    }
    if (!world.trim()) world = worldRow.content;
  }

  if (lorebookId != null) {
    const lorebookRow = db
      .prepare("SELECT id FROM keyword_lorebooks WHERE id = ? AND creator_id = ?")
      .get(lorebookId, user.id) as { id: number } | undefined;
    if (!lorebookRow) {
      return { ok: false, error: "선택한 로어북을 찾을 수 없습니다.", status: 404 };
    }
  }

  if (contentKind === "simulation" && !world.trim()) {
    return { ok: false, error: "시뮬레이션 세계관을 입력해 주세요.", status: 400 };
  }

  let simulationImportsJson = "[]";
  if (contentKind === "simulation") {
    const imported = resolveSimulationImports(db, {
      ids: parseSimulationImportIds(b.simulation_import_ids ?? b.simulationImportIds),
      creatorId: user.id,
      simulationNsfw: nsfw,
    });
    if (!imported.ok) return imported;
    simulationImportsJson = JSON.stringify(imported.snapshots);
    systemPrompt = buildSimulationSystemPrompt({
      cast: simulationCast,
      rules: simulationRules,
      imports: imported.snapshots,
    });
  }

  if (countPublicDescriptionVisibleChars(description) > PROFILE_BIOGRAPHY_LIMIT) {
    return {
      ok: false,
      error: `공개 캐릭터/세계관 정보는 ${PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자 이하여야 합니다.`,
      status: 400,
    };
  }
  if (
    world.length + systemPrompt.length + speechCreatorCharCount(speechInput) <
    AI_LEARNING_MIN
  ) {
    return {
      ok: false,
      error: `세계관 + 캐릭터 설정 + 기본 말투는 합쳐서 ${AI_LEARNING_MIN.toLocaleString()}자 이상 작성해 주세요.`,
      status: 400,
    };
  }
  if (
    world.length + systemPrompt.length + speechCreatorCharCount(speechInput) >
    AI_LEARNING_LIMIT
  ) {
    return {
      ok: false,
      error: "세계관/배경 + 캐릭터 설정 + 기본 말투는 합쳐서 10,000자 이하여야 합니다.",
      status: 400,
    };
  }

  if (contentKind === "character") {
    const speechErr = validateSpeechCreatorInput(speechInput);
    if (speechErr) return { ok: false, error: speechErr, status: 400 };
  }
  if (!greeting.trim()) {
    return { ok: false, error: "첫 메세지를 입력해 주세요.", status: 400 };
  }
  if (greeting.length > GREETING_LIMIT) {
    return { ok: false, error: `첫 메세지는 ${GREETING_LIMIT.toLocaleString()}자 이하여야 합니다.`, status: 400 };
  }

  const gender =
    contentKind === "simulation" ? "other" : parseCharacterGender(b.gender);
  if (!gender) return { ok: false, error: "캐릭터 성별(남성/여성/기타)을 선택해 주세요.", status: 400 };

  const genres = sanitizeCharacterGenres(b.genres ?? b.genre);
  if (genres.length === 0) {
    return { ok: false, error: "장르를 1개 이상 선택해 주세요.", status: 400 };
  }

  const assetsRaw = parseAssetsFromFormBody(b.assets);
  let assets = assetsRaw;
  let simulationVisualSubjectsJson = "";
  if (contentKind === "simulation") {
    const submittedSubjectsRaw =
      typeof b.simulation_visual_subjects_json === "string"
        ? b.simulation_visual_subjects_json
        : b.simulation_visual_subjects != null
          ? JSON.stringify(b.simulation_visual_subjects)
          : "";
    let prepared;
    try {
      prepared = prepareSimulationVisualSubjectsForSave({
        simulationCast,
        simulationTitle: name,
        submittedRaw: submittedSubjectsRaw,
        storedRaw:
          typeof b._stored_simulation_visual_subjects_json === "string"
            ? b._stored_simulation_visual_subjects_json
            : typeof b.stored_simulation_visual_subjects_json === "string"
              ? b.stored_simulation_visual_subjects_json
              : "",
        assets: assetsRaw,
      });
    } catch (error) {
      if (error instanceof SimulationVisualSubjectsInputError) {
        return { ok: false, error: error.message, status: 400 };
      }
      throw error;
    }
    assets = sanitizeAssetVisualSubjectKeys(assetsRaw, prepared.subjects);
    const validated = validateSimulationVisualSubjectsDocument(prepared, assets);
    if (!validated.ok) {
      return { ok: false, error: validated.reason, status: 400 };
    }
    simulationVisualSubjectsJson = serializeSimulationVisualSubjectsJson(prepared);
  }

  if (assets.length === 0) {
    return { ok: false, error: "감정 에셋 이미지를 1장 이상 업로드해 주세요.", status: 400 };
  }

  return {
    ok: true,
    data: {
      contentKind,
      simulationCast,
      simulationRules,
      simulationImportsJson,
      name,
      tagline,
      description,
      greeting,
      systemPrompt,
      world,
      worldId,
      lorebookId,
      statusWindowPrompt,
      statusWidgetJson,
      statusWidgetTriggers: parsedTriggers.triggers,
      exampleDialog,
      speechInput,
      gender,
      genres,
      primaryGenre: primaryCharacterGenre(genres),
      recommendedWritingStyle: normalizeCreatorRecommendedStyle(
        b.recommended_writing_style ?? b.recommendedWritingStyle
      ),
      assets,
      images: assetUrls(assets),
      audience: ["all", "female", "male"].includes(String(b.audience)) ? String(b.audience) : "all",
      requestedVisibility: parseVisibility(b.visibility),
      nsfw,
      participantMinAge,
      adultDialogueProfile,
      adultStatus,
      adultConsentModesAllowed,
      commentsEnabled: b.comments_enabled === false ? 0 : 1,
      creatorComment: String(b.creator_comment ?? b.creatorComment ?? "")
        .trim()
        .slice(0, CREATOR_COMMENT_LIMIT),
      simulationReuseAllowed: 0,
      simulationNsfwAllowed: 0,
      trpgReuseAllowed: b.trpg_reuse_allowed === true ? 1 : 0,
      simulationVisualSubjectsJson,
      emoji: String(b.emoji || "✨"),
      hue: Number(b.hue) || 260,
      tagsJson: JSON.stringify(parseCharacterTagsInput(b.tags)),
    },
  };
}

type CreatorDescriptionSaveInput = Pick<
  ParsedCharacterForm,
  "description" | "world" | "systemPrompt" | "statusWidgetJson" | "statusWidgetTriggers"
> & { contentKind?: ContentKind };

export function buildCompiledCreatorDescriptionForSave(
  data: CreatorDescriptionSaveInput,
  existingTriggers: StatusWidgetTriggerInput[] = data.statusWidgetTriggers
) {
  const creatorRawDescription = [data.description, data.world, data.systemPrompt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  const compilerDescription = [
    data.world,
    data.systemPrompt,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  const compiledDescription = compileCreatorDescriptionTriggers({
    description: compilerDescription,
    statusWidget: parseStatusWidgetJson(data.statusWidgetJson),
    existingTriggers,
  });
  return {
    creatorRawDescription,
    compilerDescription,
    compiledDescription,
    compiledDescriptionJson: serializeCreatorDescriptionCompiled(compiledDescription),
    safeRuntimeCanon: compiledPublicCanonText(compiledDescription),
    // An ensemble can contain many incompatible appearances; the single-character
    // appearance compiler must not collapse them into one identity.
    appearanceRaw:
      data.contentKind === "simulation" ? "" : extractAppearanceRawFromSetting(data.systemPrompt),
  };
}

export function buildCanonPlanJsonForSave(
  data: Pick<CreatorDescriptionSaveInput, "description" | "world" | "systemPrompt">,
  existingPlanJson?: string | null
) {
  const creatorRawDescription = [data.description, data.world, data.systemPrompt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  const compilerDescription = [data.world, data.systemPrompt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  return buildCanonPlanForSave({
    creatorRawDescription,
    compilerDescription,
    existingPlanJson,
  });
}


async function buildAppearanceForSave(
  raw: string,
  existing?: { appearance_raw?: string | null; appearance_compiled?: string | null; appearance_compiled_source_hash?: string | null; appearance_compiled_version?: number | null },
  force = false
) {
  const sourceHash = hashAppearanceRaw(raw);
  const canReuse =
    !force &&
    (existing?.appearance_raw ?? "") === raw &&
    existing?.appearance_compiled_source_hash === sourceHash &&
    existing?.appearance_compiled_version === APPEARANCE_COMPILED_VERSION;
  if (canReuse) {
    return { raw, compiled: existing?.appearance_compiled ?? "", sourceHash, version: APPEARANCE_COMPILED_VERSION, called: false };
  }
  const compiledJson = await compileAppearanceForChat(raw);
  const compiled = serializeAppearanceCompiledJson(compiledJson);
  return {
    raw,
    // Compile failure must not wipe a previously good compiled cache.
    compiled: compiled || (existing?.appearance_compiled ?? ""),
    sourceHash,
    version: APPEARANCE_COMPILED_VERSION,
    called: Boolean(raw.trim()),
  };
}

function applyCompiledAppearanceToCanon(safeRuntimeCanon: string, appearanceRaw: string, appearanceCompiled: string): string {
  const promptAppearance = appearancePromptText({ raw: appearanceRaw, compiledJson: appearanceCompiled });
  return replaceAppearanceInSetting(safeRuntimeCanon, promptAppearance);
}

export function characterPromptInputsChanged(
  row: {
    name: string;
    gender: string | null;
    system_prompt: string | null;
    world: string | null;
    example_dialog: string | null;
  },
  data: Pick<ParsedCharacterForm, "name" | "gender" | "systemPrompt" | "world" | "exampleDialog">
): boolean {
  return (
    row.name !== data.name ||
    (row.gender ?? "") !== data.gender ||
    (row.system_prompt ?? "") !== data.systemPrompt ||
    (row.world ?? "") !== data.world ||
    (row.example_dialog ?? "") !== data.exampleDialog
  );
}


export function characterPromptRowStillCurrent(
  row: { name: string; gender: string | null; system_prompt: string | null; world: string | null; example_dialog: string | null },
  current: { name: string; gender: string | null; system_prompt: string | null; world: string | null; example_dialog: string | null } | undefined
): boolean {
  return Boolean(
    current &&
      current.name === row.name &&
      (current.gender ?? "") === (row.gender ?? "") &&
      (current.system_prompt ?? "") === (row.system_prompt ?? "") &&
      (current.world ?? "") === (row.world ?? "") &&
      (current.example_dialog ?? "") === (row.example_dialog ?? "")
  );
}

function parseStoredImageUrls(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function resolveVisibilityModeration(
  data: {
    requestedVisibility: CharacterVisibility;
    nsfw: boolean;
    assets: CharacterAsset[];
  },
  existing?: {
    share_slug: string | null;
    visibility?: CharacterVisibility;
    moderation_status?: ModerationStatus;
    moderation_note?: string | null;
    images?: string | null;
    nsfw?: number | null;
  }
): {
  finalVisibility: CharacterVisibility;
  moderationStatus: ModerationStatus;
  moderationNote: string;
  shareSlug: string | null;
  awaitingAdmin: boolean;
} {
  return decideCharacterListing({
    requestedVisibility: data.requestedVisibility,
    nsfw: data.nsfw,
    assets: data.assets,
    existing: existing
      ? {
          shareSlug: existing.share_slug,
          visibility: existing.visibility,
          moderationStatus: existing.moderation_status,
          moderationNote: existing.moderation_note,
          imageUrls: parseStoredImageUrls(existing.images),
          nsfw: Boolean(existing.nsfw),
        }
      : undefined,
  });
}

function listingBlockForForm(input: {
  nsfw: boolean;
  visibility: CharacterVisibility;
  assets: CharacterAsset[];
  name?: string;
  tagline?: string;
  description?: string;
  greeting?: string;
  creatorComment?: string;
  tags?: string[] | string;
}): { ok: false; error: string; status: 400 } | { ok: true } {
  if (input.nsfw || input.visibility === "private") return { ok: true };
  const adultTextHits = findAdultTermsInText(characterAdultTextBlob(input));
  const error = allAgesListingBlockReason({
    nsfw: false,
    visibility: input.visibility,
    adultTextHits,
    assets: input.assets,
  });
  if (error) return { ok: false, error, status: 400 };
  return { ok: true };
}

export async function createCharacterFromForm(user: SessionUser, b: Record<string, unknown>) {
  const parsed = parseCharacterFormBody(b, user);
  if (!parsed.ok) return parsed;

  const data = parsed.data;
  const listingBlock = listingBlockForForm({
    nsfw: data.nsfw,
    visibility: data.requestedVisibility,
    assets: data.assets,
    name: data.name,
    tagline: data.tagline,
    description: data.description,
    greeting: data.greeting,
    creatorComment: data.creatorComment,
    tags: data.tagsJson,
  });
  if (!listingBlock.ok) return listingBlock;
  const { finalVisibility, moderationStatus, moderationNote, shareSlug } =
    resolveVisibilityModeration(data);
  const {
    creatorRawDescription,
    compiledDescription,
    compiledDescriptionJson,
    safeRuntimeCanon,
    appearanceRaw,
  } = buildCompiledCreatorDescriptionForSave(data);
  const canonPlanSave = buildCanonPlanJsonForSave(data);
  const appearance = await buildAppearanceForSave(appearanceRaw);
  const runtimeCanonWithAppearance = applyCompiledAppearanceToCanon(safeRuntimeCanon, appearanceRaw, appearance.compiled);

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO characters
        (name, tagline, description, greeting, system_prompt, world, world_id, lorebook_id, example_dialog, status_window_prompt, status_widget_json, genre, genres, tags, nsfw, emoji, hue,
         creator_id, creator_name, audience, gender, images, assets, setting_chunks, visibility, moderation_status, moderation_note, share_slug,
         recommended_writing_style, comments_enabled, creator_comment, creator_raw_description, creator_compiled_description_json, creator_canon_plan_json, appearance_raw, appearance_compiled, appearance_compiled_source_hash, appearance_compiled_version,
         content_kind, simulation_cast, simulation_rules, simulation_imports_json, simulation_reuse_allowed, simulation_nsfw_allowed, trpg_reuse_allowed, simulation_visual_subjects_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      data.name,
      data.tagline,
      data.description,
      data.greeting,
      data.systemPrompt,
      data.world,
      data.worldId,
      data.lorebookId,
      data.exampleDialog,
      data.statusWindowPrompt,
      data.statusWidgetJson,
      data.primaryGenre,
      JSON.stringify(data.genres),
      data.tagsJson,
      data.nsfw ? 1 : 0,
      data.emoji,
      data.hue,
      user.id,
      user.nickname,
      data.audience,
      data.gender,
      JSON.stringify(data.images),
      JSON.stringify(data.assets),
      "[]",
      finalVisibility,
      moderationStatus,
      moderationNote,
      shareSlug,
      data.recommendedWritingStyle,
      data.commentsEnabled,
      data.creatorComment,
      creatorRawDescription,
      compiledDescriptionJson,
      canonPlanSave.planJson,
      appearance.raw,
      appearance.compiled,
      appearance.sourceHash,
      appearance.version,
      data.contentKind,
      data.simulationCast,
      data.simulationRules,
      data.simulationImportsJson,
      data.simulationReuseAllowed,
      data.simulationNsfwAllowed,
      data.trpgReuseAllowed,
      data.simulationVisualSubjectsJson
    );

  const characterId = Number(info.lastInsertRowid);
  db.prepare(
    `UPDATE characters
     SET adult_dialogue_profile=?, adult_status=?, adult_consent_modes_json=?, participant_min_age=?
     WHERE id=?`
  ).run(
    data.adultDialogueProfile,
    data.adultStatus,
    JSON.stringify(data.adultConsentModesAllowed),
    data.participantMinAge,
    characterId
  );
  saveCharacterStatusWidgetTriggers(
    db,
    characterId,
    mergeDescriptionTriggerCandidates(data.statusWidgetTriggers, compiledDescription)
  );
  await buildSaveAndTranslateCharacterChunks(characterId, {
    name: data.name,
    gender: data.gender,
    systemPrompt: data.systemPrompt,
    world: data.world,
    exampleDialog: data.exampleDialog,
    statusWindowPrompt: data.statusWindowPrompt,
    speechInput: data.speechInput,
    safeRuntimeCanon: runtimeCanonWithAppearance,
  });

  const listed = finalVisibility === "public" && moderationStatus === "approved";
  if (listed) {
    notifyFollowersOfNewCharacter(db, user.id, user.nickname, characterId, data.name);
  }
  if (moderationStatus === "rejected") {
    notifyCharacterReviewResult(db, {
      userId: user.id,
      characterId,
      characterName: data.name,
      approved: false,
      note: moderationNote,
    });
  }

  return {
    ok: true as const,
    id: characterId,
    visibility: finalVisibility,
    requestedVisibility: data.requestedVisibility,
    moderationStatus,
    moderationNote,
    sharePath: sharePath({ id: characterId, share_slug: shareSlug }),
    listed,
  };
}

export async function updateCharacterFromForm(
  user: SessionUser,
  characterId: number,
  b: Record<string, unknown>
) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, creator_id, official, share_slug, visibility, moderation_status, moderation_note,
              name, gender, system_prompt, world, example_dialog, status_widget_json,
              creator_compiled_description_json, creator_canon_plan_json, appearance_raw, appearance_compiled, appearance_compiled_source_hash, appearance_compiled_version, images, nsfw,
              content_kind, adult_dialogue_profile, adult_status, adult_consent_modes_json, participant_min_age,
              COALESCE(simulation_visual_subjects_json, '') AS simulation_visual_subjects_json
       FROM characters WHERE id=?`
    )
    .get(characterId) as
    | {
        id: number;
        creator_id: number | null;
        official: number;
        share_slug: string | null;
        visibility: CharacterVisibility;
        moderation_status: ModerationStatus;
        moderation_note: string | null;
        name: string;
        gender: string | null;
        system_prompt: string | null;
        world: string | null;
        example_dialog: string | null;
        status_widget_json: string | null;
        creator_compiled_description_json: string | null;
        creator_canon_plan_json: string | null;
        appearance_raw: string | null;
        appearance_compiled: string | null;
        appearance_compiled_source_hash: string | null;
        appearance_compiled_version: number | null;
        images: string | null;
        nsfw: number | null;
        content_kind: string | null;
        adult_dialogue_profile: string | null;
        adult_status: string | null;
        adult_consent_modes_json: string | null;
        participant_min_age: number | null;
        simulation_visual_subjects_json: string;
      }
    | undefined;

  if (!row) return { ok: false as const, error: "캐릭터를 찾을 수 없습니다.", status: 404 };
  if (row.creator_id !== user.id) {
    return { ok: false as const, error: "본인 캐릭터만 수정할 수 있습니다.", status: 403 };
  }
  if (row.official === 1) {
    return { ok: false as const, error: "공식 캐릭터는 수정할 수 없습니다.", status: 403 };
  }

  const parsed = parseCharacterFormBody(
    {
      ...b,
      stored_simulation_visual_subjects_json: row.simulation_visual_subjects_json,
    },
    user,
    {
    existingParticipantMinAge: row.participant_min_age,
    requireStructuredAge: false,
  });
  if (!parsed.ok) return parsed;

  const data = parsed.data;
  if ((row.content_kind ?? "character") !== data.contentKind) {
    return {
      ok: false as const,
      error: data.contentKind === "simulation" ? "시뮬레이션 제작 페이지에서 수정해 주세요." : "캐릭터 제작 페이지에서 수정해 주세요.",
      status: 400,
    };
  }
  const listingBlock = listingBlockForForm({
    nsfw: data.nsfw,
    visibility: data.requestedVisibility,
    assets: data.assets,
    name: data.name,
    tagline: data.tagline,
    description: data.description,
    greeting: data.greeting,
    creatorComment: data.creatorComment,
    tags: data.tagsJson,
  });
  if (!listingBlock.ok) return listingBlock;
  const { finalVisibility, moderationStatus, moderationNote, shareSlug } =
    resolveVisibilityModeration(data, {
      share_slug: row.share_slug,
      visibility: row.visibility,
      moderation_status: row.moderation_status,
      moderation_note: row.moderation_note,
      images: row.images,
      nsfw: row.nsfw,
    });
  const {
    creatorRawDescription,
    compiledDescription,
    compiledDescriptionJson,
    safeRuntimeCanon,
    appearanceRaw,
  } = buildCompiledCreatorDescriptionForSave(data, [
      ...listCharacterStatusWidgetTriggers(db, characterId),
      ...data.statusWidgetTriggers,
    ]);
  const canonPlanSave = buildCanonPlanJsonForSave(data, row.creator_canon_plan_json);
  const forceAppearanceCompile = b.regenerate_appearance === true || b.regenerateAppearance === true;
  const appearance = await buildAppearanceForSave(appearanceRaw, row, forceAppearanceCompile);
  const runtimeCanonWithAppearance = applyCompiledAppearanceToCanon(safeRuntimeCanon, appearanceRaw, appearance.compiled);
  const currentPromptRow = db
    .prepare("SELECT name, gender, system_prompt, world, example_dialog FROM characters WHERE id=?")
    .get(characterId) as
    | { name: string; gender: string | null; system_prompt: string | null; world: string | null; example_dialog: string | null }
    | undefined;
  if (!characterPromptRowStillCurrent(row, currentPromptRow)) {
    return { ok: false as const, error: "다른 저장 요청이 먼저 반영되었습니다. 새로고침 후 다시 저장해 주세요.", status: 409 };
  }

  db.prepare(
    `UPDATE characters SET
      name=?, tagline=?, description=?, greeting=?, system_prompt=?, world=?, world_id=?, lorebook_id=?,
      example_dialog=?, status_window_prompt=?, status_widget_json=?, genre=?, genres=?, tags=?, nsfw=?, emoji=?, hue=?,
      audience=?, gender=?, images=?, assets=?, visibility=?, moderation_status=?, moderation_note=?,
      share_slug=?, recommended_writing_style=?, comments_enabled=?, creator_comment=?, creator_name=?,
      creator_raw_description=?, creator_compiled_description_json=?, creator_canon_plan_json=?, appearance_raw=?, appearance_compiled=?, appearance_compiled_source_hash=?, appearance_compiled_version=?,
      content_kind=?, simulation_cast=?, simulation_rules=?, simulation_imports_json=?, simulation_reuse_allowed=?, simulation_nsfw_allowed=?, trpg_reuse_allowed=?, simulation_visual_subjects_json=?
     WHERE id=?`
  ).run(
    data.name,
    data.tagline,
    data.description,
    data.greeting,
    data.systemPrompt,
    data.world,
    data.worldId,
    data.lorebookId,
    data.exampleDialog,
    data.statusWindowPrompt,
    data.statusWidgetJson,
    data.primaryGenre,
    JSON.stringify(data.genres),
    data.tagsJson,
    data.nsfw ? 1 : 0,
    data.emoji,
    data.hue,
    data.audience,
    data.gender,
    JSON.stringify(data.images),
    JSON.stringify(data.assets),
    finalVisibility,
    moderationStatus,
    moderationNote,
    shareSlug,
    data.recommendedWritingStyle,
    data.commentsEnabled,
    data.creatorComment,
    user.nickname,
    creatorRawDescription,
    compiledDescriptionJson,
    canonPlanSave.planJson,
    appearance.raw,
    appearance.compiled,
    appearance.sourceHash,
    appearance.version,
    data.contentKind,
    data.simulationCast,
    data.simulationRules,
    data.simulationImportsJson,
    data.simulationReuseAllowed,
    data.simulationNsfwAllowed,
    data.trpgReuseAllowed,
    data.simulationVisualSubjectsJson,
    characterId
  );
  const adultProfileWasProvided =
    b.adult_dialogue_profile != null || b.adultDialogueProfile != null;
  const adultConsentModesWereProvided =
    b.adult_consent_modes_allowed != null || b.adultConsentModesAllowed != null;
  db.prepare(
    `UPDATE characters
     SET adult_dialogue_profile=?, adult_status=?, adult_consent_modes_json=?, participant_min_age=?
     WHERE id=?`
  ).run(
    adultProfileWasProvided
      ? data.adultDialogueProfile
      : normalizeAdultDialogueProfile(row.adult_dialogue_profile),
    data.adultStatus,
    adultConsentModesWereProvided
      ? JSON.stringify(data.adultConsentModesAllowed)
      : row.adult_consent_modes_json || JSON.stringify(["standard"]),
    data.participantMinAge,
    characterId
  );
  saveCharacterStatusWidgetTriggers(
    db,
    characterId,
    mergeDescriptionTriggerCandidates(data.statusWidgetTriggers, compiledDescription)
  );

  const promptInputsChanged = characterPromptInputsChanged(row, data);

  if (promptInputsChanged || forceAppearanceCompile) {
    await buildSaveAndTranslateCharacterChunks(characterId, {
      name: data.name,
      gender: data.gender,
      systemPrompt: data.systemPrompt,
      world: data.world,
      exampleDialog: data.exampleDialog,
      statusWindowPrompt: data.statusWindowPrompt,
      speechInput: data.speechInput,
      safeRuntimeCanon: runtimeCanonWithAppearance,
    });
  } else if (process.env.NODE_ENV !== "production") {
    console.log(`[characterFormSave] skipped prompt chunk rebuild for asset-only update: ${characterId}`);
  }

  const wasListed = row.visibility === "public" && row.moderation_status === "approved";
  const listed = finalVisibility === "public" && moderationStatus === "approved";
  if (listed && !wasListed) {
    notifyFollowersOfNewCharacter(db, user.id, user.nickname, characterId, data.name);
  }
  if (moderationStatus === "rejected") {
    notifyCharacterReviewResult(db, {
      userId: user.id,
      characterId,
      characterName: data.name,
      approved: false,
      note: moderationNote,
    });
  }

  return {
    ok: true as const,
    id: characterId,
    visibility: finalVisibility,
    requestedVisibility: data.requestedVisibility,
    moderationStatus,
    moderationNote,
    sharePath: sharePath({ id: characterId, share_slug: shareSlug }),
    listed,
  };
}

export async function updateCharacterPublicProfileFromForm(
  user: SessionUser,
  characterId: number,
  b: Record<string, unknown>
) {
  if (!user.is_adult) {
    return { ok: false as const, error: "캐릭터 수정은 성인인증 완료 후 가능합니다.", status: 403 };
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, creator_id, official, share_slug, visibility, moderation_status, moderation_note,
              images, nsfw, name, greeting, creator_comment, tags, participant_min_age, adult_status
       FROM characters WHERE id=?`
    )
    .get(characterId) as
    | {
        id: number;
        creator_id: number | null;
        official: number;
        share_slug: string | null;
        visibility: CharacterVisibility;
        moderation_status: ModerationStatus;
        moderation_note: string | null;
        images: string | null;
        nsfw: number | null;
        name: string;
        greeting: string;
        creator_comment: string | null;
        tags: string | null;
        participant_min_age: number | null;
        adult_status: string | null;
      }
    | undefined;

  if (!row) return { ok: false as const, error: "캐릭터를 찾을 수 없습니다.", status: 404 };
  if (row.creator_id !== user.id) {
    return { ok: false as const, error: "본인 캐릭터만 수정할 수 있습니다.", status: 403 };
  }
  if (row.official === 1) {
    return { ok: false as const, error: "공식 캐릭터는 수정할 수 없습니다.", status: 403 };
  }

  const tagline = String(b.tagline || "").trim().slice(0, TAGLINE_LIMIT);
  if (!tagline) return { ok: false as const, error: "한 줄 소개를 입력해 주세요.", status: 400 };

  const description = String(b.description || "");
  if (countPublicDescriptionVisibleChars(description) > PROFILE_BIOGRAPHY_LIMIT) {
    return {
      ok: false as const,
      error: `공개 캐릭터/세계관 정보는 ${PROFILE_BIOGRAPHY_LIMIT.toLocaleString()}자 이하여야 합니다.`,
      status: 400,
    };
  }

  const genres = sanitizeCharacterGenres(b.genres ?? b.genre);
  if (genres.length === 0) {
    return { ok: false as const, error: "장르를 1개 이상 선택해 주세요.", status: 400 };
  }

  const assets = parseAssetsFromFormBody(b.assets);
  if (assets.length === 0) {
    return { ok: false as const, error: "감정 에셋 이미지를 1장 이상 업로드해 주세요.", status: 400 };
  }

  const nsfw = !!b.nsfw;
  const participantMinAgeResult = resolveParticipantMinAgeForSave({
    bodyValue: b.participant_min_age ?? b.participantMinAge,
    existingValue: row.participant_min_age,
    requireStructuredAge: false,
  });
  if (!participantMinAgeResult.ok) {
    return { ok: false as const, error: participantMinAgeResult.error, status: 400 };
  }
  const nsfwAgeError = validateNsfwParticipantAgeContract({
    nsfw,
    participantMinAge: participantMinAgeResult.value,
  });
  if (nsfwAgeError) {
    return { ok: false as const, error: nsfwAgeError, status: 400 };
  }
  const participantMinAge = participantMinAgeResult.value;
  const adultStatus = deriveAdultStatusForSave({
    participantMinAge,
    legacyExplicitStatus: parseExplicitAdultStatus(row.adult_status),
  });
  const images = assetUrls(assets);
  const requestedVisibility = parseVisibility(b.visibility);
  const creatorComment = String(b.creator_comment ?? b.creatorComment ?? "").trim().slice(0, CREATOR_COMMENT_LIMIT);
  const listingBlock = listingBlockForForm({
    nsfw,
    visibility: requestedVisibility,
    assets,
    name: row.name,
    tagline,
    description,
    greeting: row.greeting,
    creatorComment,
    tags: Array.isArray(b.tags) ? b.tags.map(String) : row.tags ?? "",
  });
  if (!listingBlock.ok) return listingBlock;
  const rawWidget = b.status_widget_json ?? b.status_widget;
  const parsedWidget =
    typeof rawWidget === "string"
      ? parseStatusWidgetJson(rawWidget)
      : rawWidget && typeof rawWidget === "object"
        ? parseStatusWidgetJson(JSON.stringify(rawWidget))
        : null;
  const statusWidgetJson = parsedWidget ? serializeStatusWidget(parsedWidget) : "";
  const parsedTriggers = validateStatusWidgetTriggerInputs(b.status_widget_triggers);
  if (!parsedTriggers.ok) {
    return { ok: false as const, error: parsedTriggers.error, status: 400 };
  }
  const { finalVisibility, moderationStatus, moderationNote, shareSlug } =
    resolveVisibilityModeration(
      { requestedVisibility, nsfw, assets },
      {
        share_slug: row.share_slug,
        visibility: row.visibility,
        moderation_status: row.moderation_status,
        moderation_note: row.moderation_note,
        images: row.images,
        nsfw: row.nsfw,
      }
    );

  db.prepare(
    `UPDATE characters SET
      tagline=?, description=?, genre=?, genres=?, tags=?, nsfw=?, emoji=?, hue=?,
      audience=?, images=?, assets=?, visibility=?, moderation_status=?, moderation_note=?,
      share_slug=?, comments_enabled=?, creator_comment=?, creator_name=?, status_widget_json=?,
      simulation_reuse_allowed=?, simulation_nsfw_allowed=?, trpg_reuse_allowed=?,
      participant_min_age=?, adult_status=?
     WHERE id=?`
  ).run(
    tagline,
    description,
    primaryCharacterGenre(genres),
    JSON.stringify(genres),
    JSON.stringify(parseCharacterTagsInput(b.tags)),
    nsfw ? 1 : 0,
    String(b.emoji || "✨"),
    Number(b.hue) || 260,
    ["all", "female", "male"].includes(String(b.audience)) ? String(b.audience) : "all",
    JSON.stringify(images),
    JSON.stringify(assets),
    finalVisibility,
    moderationStatus,
    moderationNote,
    shareSlug,
    b.comments_enabled === false ? 0 : 1,
    String(b.creator_comment ?? b.creatorComment ?? "").trim().slice(0, CREATOR_COMMENT_LIMIT),
    user.nickname,
    statusWidgetJson,
    0,
    0,
    b.trpg_reuse_allowed === true ? 1 : 0,
    participantMinAge,
    adultStatus,
    characterId
  );
  saveCharacterStatusWidgetTriggers(db, characterId, parsedTriggers.triggers);

  if (moderationStatus === "rejected") {
    notifyCharacterReviewResult(db, {
      userId: user.id,
      characterId,
      characterName: row.name,
      approved: false,
      note: moderationNote,
    });
  }

  const listed = finalVisibility === "public" && moderationStatus === "approved";
  return {
    ok: true as const,
    id: characterId,
    visibility: finalVisibility,
    requestedVisibility,
    moderationStatus,
    moderationNote,
    sharePath: sharePath({ id: characterId, share_slug: shareSlug }),
    listed,
    profileOnly: true,
  };
}
