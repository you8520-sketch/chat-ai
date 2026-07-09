import { getDb } from "@/lib/db";
import type { CharacterAsset } from "@/lib/characterAssets";
import { publicAssetUrls } from "@/lib/characterAssets";
import { parseCharacterGender } from "@/lib/characterGender";
import { buildSaveAndTranslateCharacterChunks } from "@/lib/characterChunks";
import { moderatePublicAssets } from "@/lib/assetModeration";
import {
  primaryCharacterGenre,
  sanitizeCharacterGenres,
} from "@/lib/characterGenres";
import {
  generateShareSlug,
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
import { notifyFollowersOfNewCharacter } from "@/lib/userNotifications";
import {
  parseStatusWidgetJson,
  serializeStatusWidget,
} from "@/lib/statusWidget";
import {
  compiledPublicCanonText,
  compileCreatorDescriptionTriggers,
  mergeDescriptionTriggerCandidates,
  serializeCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import {
  listCharacterStatusWidgetTriggers,
  saveCharacterStatusWidgetTriggers,
  validateStatusWidgetTriggerInputs,
  type StatusWidgetTriggerInput,
} from "@/lib/statusWidgetTriggers";
import { countPublicDescriptionVisibleChars } from "@/lib/publicDescriptionText";

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
  commentsEnabled: number;
  creatorComment: string;
  emoji: string;
  hue: number;
  tagsJson: string;
};

export function parseCharacterFormBody(
  b: Record<string, unknown>,
  user: SessionUser
): { ok: true; data: ParsedCharacterForm } | { ok: false; error: string; status: number } {
  if (!user.is_adult) {
    return { ok: false, error: "캐릭터 제작·수정은 성인인증 완료 후 가능합니다.", status: 403 };
  }
  if (!b.name || !b.system_prompt) {
    return { ok: false, error: "이름과 캐릭터 설정은 필수입니다.", status: 400 };
  }

  const name = String(b.name).trim().slice(0, CHARACTER_NAME_LIMIT);
  const tagline = String(b.tagline || "").trim().slice(0, TAGLINE_LIMIT);
  if (!name) return { ok: false, error: "캐릭터 이름(또는 시뮬레이션명)을 입력해 주세요.", status: 400 };
  if (!tagline) return { ok: false, error: "한 줄 소개를 입력해 주세요.", status: 400 };

  const description = String(b.description || "");
  const systemPrompt = String(b.system_prompt || "");
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
      error: `말투 설정 + 세계관 + 캐릭터 설정은 합쳐서 ${AI_LEARNING_MIN.toLocaleString()}자 이상 작성해 주세요.`,
      status: 400,
    };
  }
  if (
    world.length + systemPrompt.length + speechCreatorCharCount(speechInput) >
    AI_LEARNING_LIMIT
  ) {
    return {
      ok: false,
      error: "세계관/배경 + 캐릭터 설정 + 말투 설정은 합쳐서 10,000자 이하여야 합니다.",
      status: 400,
    };
  }

  const speechErr = validateSpeechCreatorInput(speechInput);
  if (speechErr) return { ok: false, error: speechErr, status: 400 };
  if (!greeting.trim()) {
    return { ok: false, error: "첫 메세지를 입력해 주세요.", status: 400 };
  }
  if (greeting.length > GREETING_LIMIT) {
    return { ok: false, error: `첫 메세지는 ${GREETING_LIMIT.toLocaleString()}자 이하여야 합니다.`, status: 400 };
  }

  const gender = parseCharacterGender(b.gender);
  if (!gender) return { ok: false, error: "캐릭터 성별(남성/여성/기타)을 선택해 주세요.", status: 400 };

  const genres = sanitizeCharacterGenres(b.genres ?? b.genre);
  if (genres.length === 0) {
    return { ok: false, error: "장르를 1개 이상 선택해 주세요.", status: 400 };
  }

  const assets: CharacterAsset[] = Array.isArray(b.assets)
    ? b.assets
        .filter((a: unknown) => a && typeof a === "object" && "url" in (a as object) && "tag" in (a as object))
        .map((a: { url: string; tag: string; public?: boolean; chat?: boolean; viewerBlur?: boolean }) => ({
          url: String(a.url),
          tag: String(a.tag).slice(0, 32),
          public: Boolean(a.public),
          chat: a.chat !== false,
          viewerBlur: a.viewerBlur === true,
        }))
        .filter((a: CharacterAsset) => a.url.startsWith("/uploads/") || a.url.startsWith("http"))
        .slice(0, 100)
    : [];

  if (assets.length === 0) {
    return { ok: false, error: "감정 에셋 이미지를 1장 이상 업로드해 주세요.", status: 400 };
  }

  if (assets.length > 0 && !assets.some((a) => a.public)) {
    return { ok: false, error: "노출할 이미지를 1장 이상 선택해 주세요.", status: 400 };
  }

  return {
    ok: true,
    data: {
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
      images: publicAssetUrls(assets),
      audience: ["all", "female", "male"].includes(String(b.audience)) ? String(b.audience) : "all",
      requestedVisibility: parseVisibility(b.visibility),
      nsfw: !!b.nsfw,
      commentsEnabled: b.comments_enabled === false ? 0 : 1,
      creatorComment: String(b.creator_comment ?? b.creatorComment ?? "")
        .trim()
        .slice(0, CREATOR_COMMENT_LIMIT),
      emoji: String(b.emoji || "✨"),
      hue: Number(b.hue) || 260,
      tagsJson: JSON.stringify(parseCharacterTagsInput(b.tags)),
    },
  };
}

type CreatorDescriptionSaveInput = Pick<
  ParsedCharacterForm,
  "description" | "world" | "systemPrompt" | "statusWidgetJson" | "statusWidgetTriggers"
>;

function stripDisplayHtmlForRuntimeText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildCompiledCreatorDescriptionForSave(
  data: CreatorDescriptionSaveInput,
  existingTriggers: StatusWidgetTriggerInput[] = data.statusWidgetTriggers
) {
  const creatorRawDescription = [data.description, data.world, data.systemPrompt]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
  const compilerDescription = [
    stripDisplayHtmlForRuntimeText(data.description),
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
    compiledDescription,
    compiledDescriptionJson: serializeCreatorDescriptionCompiled(compiledDescription),
    safeRuntimeCanon: compiledPublicCanonText(compiledDescription),
  };
}

async function resolveVisibilityModeration(
  data: ParsedCharacterForm,
  existing?: {
    share_slug: string | null;
    visibility?: CharacterVisibility;
    moderation_status?: ModerationStatus;
    moderation_note?: string | null;
    images?: string | null;
    nsfw?: number | null;
  }
): Promise<{
  finalVisibility: CharacterVisibility;
  moderationStatus: ModerationStatus;
  moderationNote: string;
  shareSlug: string | null;
}> {
  let finalVisibility = data.requestedVisibility;
  let moderationStatus: ModerationStatus = "approved";
  let moderationNote = "";
  let shareSlug: string | null = existing?.share_slug ?? null;

  if (finalVisibility === "private") {
    moderationNote = "비공개 — 검수 생략";
    shareSlug = null;
  } else {
    const existingPublicImages =
      existing?.images && existing.visibility !== "private"
        ? (() => {
            try {
              const parsed = JSON.parse(existing.images || "[]");
              return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
            } catch {
              return [];
            }
          })()
        : null;
    const canReuseModeration =
      existing?.moderation_status === "approved" &&
      existingPublicImages !== null &&
      existingPublicImages.length === data.images.length &&
      existingPublicImages.every((url, i) => url === data.images[i]) &&
      Boolean(existing.nsfw) === data.nsfw;

    const mod = canReuseModeration
      ? {
          approved: true,
          reason: existing?.moderation_note || "기존 공개 이미지 검수 결과 재사용",
          details: [],
          estimated: true,
        }
      : await moderatePublicAssets(data.images, data.nsfw);
    if (mod.approved) {
      moderationStatus = "approved";
      moderationNote = mod.reason;
      if (finalVisibility === "link" && !shareSlug) {
        shareSlug = generateShareSlug();
      }
    } else {
      finalVisibility = "private";
      moderationStatus = "rejected";
      moderationNote = mod.reason;
      shareSlug = null;
    }
  }

  return { finalVisibility, moderationStatus, moderationNote, shareSlug };
}

export async function createCharacterFromForm(user: SessionUser, b: Record<string, unknown>) {
  const parsed = parseCharacterFormBody(b, user);
  if (!parsed.ok) return parsed;

  const data = parsed.data;
  const { finalVisibility, moderationStatus, moderationNote, shareSlug } =
    await resolveVisibilityModeration(data);
  const {
    creatorRawDescription,
    compiledDescription,
    compiledDescriptionJson,
    safeRuntimeCanon,
  } = buildCompiledCreatorDescriptionForSave(data);

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO characters
        (name, tagline, description, greeting, system_prompt, world, world_id, lorebook_id, example_dialog, status_window_prompt, status_widget_json, genre, genres, tags, nsfw, emoji, hue,
         creator_id, creator_name, audience, gender, images, assets, setting_chunks, visibility, moderation_status, moderation_note, share_slug,
         recommended_writing_style, comments_enabled, creator_comment, creator_raw_description, creator_compiled_description_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
      compiledDescriptionJson
    );

  const characterId = Number(info.lastInsertRowid);
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
    safeRuntimeCanon,
  });

  const listed = finalVisibility === "public" && moderationStatus === "approved";
  if (listed) {
    notifyFollowersOfNewCharacter(db, user.id, user.nickname, characterId, data.name);
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
  const parsed = parseCharacterFormBody(b, user);
  if (!parsed.ok) return parsed;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, creator_id, official, share_slug, visibility, moderation_status, moderation_note,
              name, gender, system_prompt, world, example_dialog, status_widget_json,
              creator_compiled_description_json, images, nsfw
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
        images: string | null;
        nsfw: number | null;
      }
    | undefined;

  if (!row) return { ok: false as const, error: "캐릭터를 찾을 수 없습니다.", status: 404 };
  if (row.creator_id !== user.id) {
    return { ok: false as const, error: "본인 캐릭터만 수정할 수 있습니다.", status: 403 };
  }
  if (row.official === 1) {
    return { ok: false as const, error: "공식 캐릭터는 수정할 수 없습니다.", status: 403 };
  }

  const data = parsed.data;
  const { finalVisibility, moderationStatus, moderationNote, shareSlug } =
    await resolveVisibilityModeration(data, {
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
  } = buildCompiledCreatorDescriptionForSave(data, [
      ...listCharacterStatusWidgetTriggers(db, characterId),
      ...data.statusWidgetTriggers,
    ]);

  db.prepare(
    `UPDATE characters SET
      name=?, tagline=?, description=?, greeting=?, system_prompt=?, world=?, world_id=?, lorebook_id=?,
      example_dialog=?, status_window_prompt=?, status_widget_json=?, genre=?, genres=?, tags=?, nsfw=?, emoji=?, hue=?,
      audience=?, gender=?, images=?, assets=?, visibility=?, moderation_status=?, moderation_note=?,
      share_slug=?, recommended_writing_style=?, comments_enabled=?, creator_comment=?, creator_name=?,
      creator_raw_description=?, creator_compiled_description_json=?
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
    characterId
  );
  saveCharacterStatusWidgetTriggers(
    db,
    characterId,
    mergeDescriptionTriggerCandidates(data.statusWidgetTriggers, compiledDescription)
  );

  const promptInputsChanged =
    row.name !== data.name ||
    (row.gender ?? "") !== data.gender ||
    (row.system_prompt ?? "") !== data.systemPrompt ||
    (row.world ?? "") !== data.world ||
    (row.example_dialog ?? "") !== data.exampleDialog ||
    (row.status_widget_json ?? "") !== data.statusWidgetJson ||
    (row.creator_compiled_description_json ?? "") !== compiledDescriptionJson;

  if (promptInputsChanged) {
    await buildSaveAndTranslateCharacterChunks(characterId, {
      name: data.name,
      gender: data.gender,
      systemPrompt: data.systemPrompt,
      world: data.world,
      exampleDialog: data.exampleDialog,
      statusWindowPrompt: data.statusWindowPrompt,
      speechInput: data.speechInput,
      safeRuntimeCanon,
    });
  } else if (process.env.NODE_ENV !== "production") {
    console.log(`[characterFormSave] skipped prompt chunk rebuild for asset-only update: ${characterId}`);
  }

  const wasListed = row.visibility === "public" && row.moderation_status === "approved";
  const listed = finalVisibility === "public" && moderationStatus === "approved";
  if (listed && !wasListed) {
    notifyFollowersOfNewCharacter(db, user.id, user.nickname, characterId, data.name);
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
