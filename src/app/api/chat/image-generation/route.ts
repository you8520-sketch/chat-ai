import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import {
  CHAT_COMIC_TEMPLATE_ID,
  type ChatComicPanelCount,
} from "@/lib/chatComicGeneration";
import {
  findLatestChatImageGenerationJob,
} from "@/lib/chatImageGenerationJobs";
import { isAdminUser } from "@/lib/isAdminUser";
import {
  selectCharacterImageUrl,
  type SelectableCharacterImage,
} from "@/lib/chatCharacterImageSelection";
import { listSelectableCharacterImages, listCastSelectableAssets } from "@/lib/chatCharacterImageSelection.server";
import {
  type ImagePromptGender,
  resolveChatImageGenerationModel,
  resolveChatImageGenerationPrice,
} from "@/lib/chatImageGeneration";
import { extractAppearanceRawFromSetting } from "@/lib/appearanceCompiler";
import {
  buildChatImageCharacterAppearanceClientView,
  resolveCharacterSavedAppearance,
  resolvePersonaSavedAppearance,
  resolveRequestAppearanceModes,
} from "@/lib/chatImageVisualIdentity";
import { CHAT_LD_ILLUSTRATION_TEMPLATE_ID } from "@/lib/chatLdIllustrationGeneration";
import {
  personaImageReadiness,
} from "@/lib/chatPersonaImageGeneration";
import { getDb } from "@/lib/db";
import { parseAssets } from "@/lib/characterAssets";
import {
  buildClientScopedCastImageMetadata,
  parseVisualSubjectsJson,
  type ClientVisibleVisualSubject,
} from "@/lib/visualSubjects";
import { parseContentKind, type ContentKind } from "@/lib/simulationMode";
import { resolveChatImageSceneBuilderReadiness, type SelectableCastAsset } from "@/lib/chatImageCast";
import { resolveChatImageGenderPair } from "@/lib/chatImageGender";
import { getEffectiveKrwPerUsd } from "@/lib/exchangeRate";
import {
  getPointBalance,
} from "@/lib/points";
import {
  personaImageBaseUrl,
  sanitizePersonaImageUrl,
} from "@/lib/userPersonasClient";

export const runtime = "nodejs";
export const maxDuration = 300;

type CharacterRow = {
  id: number;
  name: string;
  gender: string;
  assets: string;
  images: string;
  creator_id: number | null;
  visibility: string;
  appearance_raw: string | null;
  appearance_compiled: string | null;
  system_prompt: string | null;
  content_kind: string | null;
  simulation_visual_subjects_json: string | null;
};

type PersonaRow = {
  id: number;
  name: string;
  gender: string;
  description: string;
  image_url: string;
};

type ChatRow = {
  id: number;
  character_id: number;
  selected_persona_id: number | null;
};

type GenerationContext = {
  chatId: number | null;
  contentKind: ContentKind;
  character: CharacterRow;
  persona: PersonaRow | null;
  characterGender: ImagePromptGender;
  personaGender: ImagePromptGender;
  characterImageUrl: string;
  characterImages: SelectableCharacterImage[];
  castSelectableAssets: SelectableCastAsset[];
  visualSubjects: ClientVisibleVisualSubject[];
  allVisualSubjects: ReturnType<typeof parseVisualSubjectsJson>["subjects"];
  characterAssets: ReturnType<typeof parseAssets>;
  personaImageUrl: string;
  characterSavedAppearance: string;
  personaSavedAppearance: string;
};

class RequestError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = "RequestError";
  }
}

function positiveInt(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function ensureGenerationTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_image_generations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER,
      character_id INTEGER NOT NULL,
      persona_id INTEGER NOT NULL,
      template_id TEXT NOT NULL,
      model TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '{}',
      result_url TEXT NOT NULL,
      upstream_cost_usd REAL,
      charged_points INTEGER NOT NULL,
      deduction_slices TEXT,
      exchange_rate_krw_per_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_image_generations_user_recent
      ON chat_image_generations(user_id, created_at DESC, id DESC);
  `);
  const columns = new Set(
    (
      db.prepare("PRAGMA table_info(chat_image_generations)").all() as {
        name: string;
      }[]
    ).map((column) => column.name)
  );
  if (!columns.has("deduction_slices")) {
    db.exec("ALTER TABLE chat_image_generations ADD COLUMN deduction_slices TEXT");
  }
  if (!columns.has("exchange_rate_krw_per_usd")) {
    db.exec("ALTER TABLE chat_image_generations ADD COLUMN exchange_rate_krw_per_usd REAL");
  }
}

function resolveGenerationContext(opts: {
  userId: number;
  characterId: number | null;
  chatId: number | null;
  personaId: number | null;
  requestedCharacterImageUrl?: unknown;
}): GenerationContext {
  const db = getDb();
  let characterId = opts.characterId;
  let selectedPersonaId = opts.personaId;
  let chatId: number | null = null;

  if (opts.chatId) {
    const chat = db
      .prepare(
        "SELECT id, character_id, selected_persona_id FROM chats WHERE id=? AND user_id=?"
      )
      .get(opts.chatId, opts.userId) as ChatRow | undefined;
    if (!chat) throw new RequestError("채팅방을 찾을 수 없습니다.", 404);
    chatId = chat.id;
    characterId = chat.character_id;
    selectedPersonaId = chat.selected_persona_id ?? selectedPersonaId;
  }

  if (!characterId) throw new RequestError("캐릭터 정보가 없습니다.");

  const character = db
    .prepare(
      "SELECT id, name, gender, assets, images, creator_id, visibility, COALESCE(appearance_raw, '') AS appearance_raw, COALESCE(appearance_compiled, '') AS appearance_compiled, COALESCE(system_prompt, '') AS system_prompt, COALESCE(content_kind, 'character') AS content_kind, COALESCE(simulation_visual_subjects_json, '') AS simulation_visual_subjects_json FROM characters WHERE id=?"
    )
    .get(characterId) as CharacterRow | undefined;
  if (!character) throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  if (character.visibility === "private" && character.creator_id !== opts.userId) {
    throw new RequestError("캐릭터를 찾을 수 없습니다.", 404);
  }

  let persona: PersonaRow | undefined;
  if (selectedPersonaId) {
    persona = db
      .prepare("SELECT id, name, gender, description, image_url FROM user_personas WHERE id=? AND user_id=?")
      .get(selectedPersonaId, opts.userId) as PersonaRow | undefined;
  }
  if (!persona) {
    persona = db
      .prepare(
        "SELECT id, name, gender, description, image_url FROM user_personas WHERE user_id=? ORDER BY created_at ASC, id ASC LIMIT 1"
      )
      .get(opts.userId) as PersonaRow | undefined;
  }

  const contentKind = parseContentKind(character.content_kind);
  const characterImages = listSelectableCharacterImages({
    userId: opts.userId,
    characterId: character.id,
    creatorId: character.creator_id,
    assetsRaw: character.assets,
    imagesRaw: character.images,
    contentKind,
  });
  const castSelectableAssets = listCastSelectableAssets({
    userId: opts.userId,
    characterId: character.id,
    creatorId: character.creator_id,
    assetsRaw: character.assets,
    imagesRaw: character.images,
    contentKind,
  });
  const characterImageUrl =
    selectCharacterImageUrl(characterImages, opts.requestedCharacterImageUrl) ?? "";
  if (opts.requestedCharacterImageUrl && !characterImageUrl) {
    throw new RequestError("선택할 수 없는 캐릭터 이미지입니다.", 403);
  }
  const personaImageUrl = persona
    ? personaImageBaseUrl(sanitizePersonaImageUrl(persona.image_url))
    : "";

  const genders = resolveChatImageGenderPair({
    characterName: character.name,
    characterGender: character.gender,
    personaName: persona?.name ?? "",
    personaGender: persona?.gender,
  });
  const characterAssets = parseAssets(character.assets);
  const allVisualSubjects = parseVisualSubjectsJson(
    character.simulation_visual_subjects_json ?? ""
  ).subjects;
  const isCreator = character.creator_id === opts.userId;
  const preflightCast = buildClientScopedCastImageMetadata({
    contentKind,
    isCreator,
    subjects: allVisualSubjects,
    assets: characterAssets,
    castSelectableAssets,
    visibleNames: [],
    scope: "preflight",
  });
  return {
    chatId,
    contentKind,
    character,
    persona: persona ?? null,
    characterGender: genders.characterGender,
    personaGender: genders.personaGender,
    characterImageUrl,
    characterImages,
    castSelectableAssets: [...preflightCast.castSelectableAssets],
    visualSubjects: preflightCast.visualSubjects,
    allVisualSubjects,
    characterAssets,
    personaImageUrl,
    characterSavedAppearance: resolveCharacterSavedAppearance({
      appearanceRaw: character.appearance_raw,
      appearanceSection: extractAppearanceRawFromSetting(character.system_prompt ?? ""),
      appearanceCompiled: character.appearance_compiled,
    }),
    personaSavedAppearance: resolvePersonaSavedAppearance(persona?.description),
  };
}

function readiness(context: GenerationContext) {
  return resolveChatImageSceneBuilderReadiness({
    contentKind: context.contentKind,
    characterImageUrl: context.characterImageUrl,
    hasPersona: Boolean(context.persona),
    personaImageUrl: context.personaImageUrl,
  });
}

function publicContextResponse(context: GenerationContext, viewerUserId: number) {
  const state = readiness(context);
  const personaState = personaImageReadiness(context.persona);
  const pricePoints = resolveChatImageGenerationPrice();
  const balance = getPointBalance(context.character.id ? 0 : 0);
  void balance;
  const characterAppearance = buildChatImageCharacterAppearanceClientView({
    savedAppearance: context.characterSavedAppearance,
    characterCreatorId: context.character.creator_id,
    viewerUserId,
  });
  const isSimulation = context.contentKind === "simulation";
  return {
    ...state,
    personaReady: isSimulation
      ? personaState.ready
      : personaState.ready && !!context.characterImageUrl,
    personaMissing: isSimulation
      ? [...personaState.missing]
      : [
          ...personaState.missing,
          ...(!context.characterImageUrl ? ["캐릭터 그림체 참조 이미지"] : []),
        ],
    pricePoints,
    modelId: resolveChatImageGenerationModel(),
    modelLabel: "GPT Image 2",
    character: {
      id: context.character.id,
      name: context.character.name,
      imageUrl: context.characterImageUrl,
      hasSavedAppearance: characterAppearance.hasSavedAppearance,
      appearancePreview: characterAppearance.appearancePreview,
    },
    contentKind: context.contentKind,
    characterImages: context.characterImages,
    castSelectableAssets: context.castSelectableAssets,
    visualSubjects: context.visualSubjects,
    persona: context.persona
      ? {
          id: context.persona.id,
          name: context.persona.name,
          imageUrl: context.personaImageUrl,
          gender: context.persona.gender,
          appearancePreview: personaState.appearance ?? "",
        }
      : null,
  };
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const url = new URL(req.url);
    const context = resolveGenerationContext({
      userId: user.id,
      characterId: positiveInt(url.searchParams.get("characterId")),
      chatId: positiveInt(url.searchParams.get("chatId")),
      personaId: positiveInt(url.searchParams.get("personaId")),
    });
    ensureGenerationTable();
    const db = getDb();
    const latest = db
      .prepare(
        `SELECT template_id, options_json, result_url, upstream_cost_usd,
                charged_points, created_at
         FROM chat_image_generations
         WHERE user_id=? AND character_id=? AND persona_id=?
           AND (chat_id IS ? OR chat_id=?)
         ORDER BY id DESC LIMIT 1`
      )
      .get(
        user.id,
        context.character.id,
        context.persona?.id ?? -1,
        context.chatId,
        context.chatId
      ) as
      | {
          template_id: string;
          options_json: string;
          result_url: string;
          upstream_cost_usd: number | null;
          charged_points: number;
          created_at: string;
        }
      | undefined;
    let latestOptions: {
      mode?: "sd" | "emoticon" | "couple_stamp" | "comic" | "illustration" | "persona";
      title?: string;
      panelCount?: ChatComicPanelCount;
    } = {};
    if (latest?.options_json) {
      try {
        latestOptions = JSON.parse(latest.options_json) as typeof latestOptions;
      } catch {
        latestOptions = {};
      }
    }
    // Legacy template IDs kept as literals for historical row classification only.
    // SD/persona generation modes are decommissioned; existing album/history rows
    // must still resolve to a display mode.
    const LEGACY_PERSONA_IMAGE_TEMPLATE_ID = "persona_portrait_ld";
    const latestMode:
      | "sd"
      | "emoticon"
      | "couple_stamp"
      | "comic"
      | "illustration"
      | "persona" =
      latest?.template_id === CHAT_COMIC_TEMPLATE_ID || latestOptions.mode === "comic"
        ? "comic"
        : latest?.template_id === LEGACY_PERSONA_IMAGE_TEMPLATE_ID ||
            latestOptions.mode === "persona"
          ? "persona"
        : latest?.template_id === CHAT_LD_ILLUSTRATION_TEMPLATE_ID ||
            latestOptions.mode === "illustration"
          ? "illustration"
        : latest?.template_id === "couple_stamps_4" ||
            latestOptions.mode === "couple_stamp"
          ? "couple_stamp"
        : latest?.template_id === "emoticon_grid_9" ||
            latestOptions.mode === "emoticon"
          ? "emoticon"
          : "sd";
    const canSeeCost = isAdminUser(user as typeof user & { is_admin?: number });
    const exchangeRateKrwPerUsd = getEffectiveKrwPerUsd();
    const currentImageModel = resolveChatImageGenerationModel();
    const upstreamCostUsd =
      latest?.upstream_cost_usd != null &&
      latest.upstream_cost_usd > 0 &&
      Number.isFinite(latest.upstream_cost_usd)
        ? latest.upstream_cost_usd
        : null;
    const averageRows = canSeeCost
      ? (db
          .prepare(
            `SELECT template_id,
                    CASE
                      WHEN template_id = ? AND json_valid(options_json)
                      THEN CAST(json_extract(options_json, '$.panelCount') AS INTEGER)
                      ELSE NULL
                    END AS panel_count,
                    AVG(upstream_cost_usd) AS average_cost_usd,
                    COUNT(*) AS sample_count
             FROM chat_image_generations
             WHERE upstream_cost_usd IS NOT NULL
               AND upstream_cost_usd > 0
               AND model = ?
               AND (
                 template_id = ?
                 OR (
                   json_valid(options_json)
                   AND json_extract(options_json, '$.quality') = 'medium'
                 )
               )
AND template_id IN (?, ?, ?)
              GROUP BY template_id, panel_count`
          )
          .all(
            CHAT_COMIC_TEMPLATE_ID,
            currentImageModel,
            CHAT_COMIC_TEMPLATE_ID,
            CHAT_LD_ILLUSTRATION_TEMPLATE_ID,
            CHAT_COMIC_TEMPLATE_ID
          ) as Array<{
          template_id: string;
          panel_count: number | null;
          average_cost_usd: number;
          sample_count: number;
        }>)
      : [];
    const averageCost = (templateId: string, panelCount?: ChatComicPanelCount) => {
      const row = averageRows.find(
        (item) =>
          item.template_id === templateId &&
          (panelCount == null || item.panel_count === panelCount)
      );
      const averageUsd =
        row && Number.isFinite(row.average_cost_usd) ? row.average_cost_usd : null;
      return {
        averageUsd,
        averageKrw:
          averageUsd == null
            ? null
            : Math.round(averageUsd * exchangeRateKrwPerUsd * 10) / 10,
        sampleCount: row?.sample_count ?? 0,
      };
    };
    return NextResponse.json({
      ...publicContextResponse(context, user.id),
      balance: getPointBalance(user.id),
      activeJob: findLatestChatImageGenerationJob({
        userId: user.id,
        characterId: context.character.id,
        chatId: context.chatId,
      }),
      averageCosts: canSeeCost
        ? {
            exchangeRateKrwPerUsd,
            illustration: averageCost(CHAT_LD_ILLUSTRATION_TEMPLATE_ID),
            comic: {
              2: averageCost(CHAT_COMIC_TEMPLATE_ID, 2),
              3: averageCost(CHAT_COMIC_TEMPLATE_ID, 3),
              4: averageCost(CHAT_COMIC_TEMPLATE_ID, 4),
            },
          }
        : undefined,
      latestResult: latest
        ? {
            imageUrl: latest.result_url,
            chargedPoints: latest.charged_points,
            createdAt: latest.created_at,
            mode: latestMode,
            title: latestOptions.title,
            panelCount: latestOptions.panelCount,
            upstreamCostUsd: canSeeCost ? upstreamCostUsd : undefined,
            upstreamCostKrw:
              canSeeCost && upstreamCostUsd != null
                ? Math.round(upstreamCostUsd * exchangeRateKrwPerUsd * 10) / 10
                : undefined,
          }
        : null,
    });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "이미지 생성 정보를 불러오지 못했습니다.";
    return NextResponse.json({ error: message }, { status });
  }
}
