/**
 * Official author genre policy — the ONE owner of "what genre-specific voice the
 * author prompts use". `authorPrompts.ts` reads a resolved plan; there is no
 * per-genre engine, prompt copy, or schema field.
 *
 * Four independent axes (never inferred from each other):
 *   - genre          → profile (`romance_fantasy` parity profile or genre-neutral fallback)
 *   - narrative tone → `tone`, `humor`, `pacing` (authoring input, optional)
 *   - naming         → `namingProfile` (existing `marketFit` owner) + `nameWordplay`
 *   - visual style   → rofan profile only (`style.ts`); other genres add none here
 *
 * Absent plan === rofan parity: legacy callers keep byte-identical prompts.
 */
import { CHARACTER_GENRES, isCharacterGenre, type CharacterGenre } from "@/lib/characterGenres";
import { resolveNamingProfile, type NamingProfileKey } from "@/lib/officialSupply/marketFit";
import { DOMESTIC_ROFAN_STYLE_DIRECTION } from "@/lib/officialSupply/style";

export const OFFICIAL_ROFAN_GENRE = "로맨스 판타지";

export const OFFICIAL_MODERN_DAILY_GENRE = "현대/일상";

export const OFFICIAL_WORLD_SCALES = ["full", "scene"] as const;
export type OfficialWorldScale = (typeof OFFICIAL_WORLD_SCALES)[number];

/** Count floors for world core/atlas prompts and `validateWorldBible`. */
export const OFFICIAL_WORLD_SCALE_LIMITS = {
  full: {
    factions: { min: 3, max: 6 },
    societyAreas: { min: 3 },
    culture: { min: 3, max: 6 },
    locations: { min: 5, max: 10 },
    history: { min: 3, max: 6 },
    lorebook: { min: 3, max: 8 },
  },
  scene: {
    factions: { min: 1, max: 2 },
    societyAreas: { min: 1 },
    culture: { min: 1, max: 3 },
    locations: { min: 2, max: 6 },
    history: { min: 1, max: 3 },
    lorebook: { min: 1, max: 4 },
  },
} as const satisfies Record<
  OfficialWorldScale,
  {
    factions: { min: number; max: number };
    societyAreas: { min: number };
    culture: { min: number; max: number };
    locations: { min: number; max: number };
    history: { min: number; max: number };
    lorebook: { min: number; max: number };
  }
>;

/** Genres whose default user relationship may be romantic. Everything else gets the open-relation frame. */
const ROMANCE_FRAME_GENRES: ReadonlySet<string> = new Set(["로맨스", "로맨스 판타지", "BL", "GL", "HL"]);

export const OFFICIAL_NARRATIVE_TONES = ["serious", "lyrical", "light", "dry", "satirical", "tragic"] as const;
export type OfficialNarrativeTone = (typeof OFFICIAL_NARRATIVE_TONES)[number];

export const OFFICIAL_HUMOR_LEVELS = ["none", "light", "central"] as const;
export type OfficialHumorLevel = (typeof OFFICIAL_HUMOR_LEVELS)[number];

export const OFFICIAL_NARRATIVE_PACINGS = ["narration", "balanced", "dialogue"] as const;
export type OfficialNarrativePacing = (typeof OFFICIAL_NARRATIVE_PACINGS)[number];

export const OFFICIAL_NAME_WORDPLAY = ["none", "nickname", "pun"] as const;
export type OfficialNameWordplay = (typeof OFFICIAL_NAME_WORDPLAY)[number];

export type OfficialGenreProfile = {
  key: "rofan_parity" | "genre_neutral";
  worldArchitectLine: string;
  characterWriterLine: string;
  styleDirectorLine: string;
  /** "10명의 …" in the world system line. */
  systemCastPhrase: string;
  /** Lead-in of the "everyone must differ" portfolio line. */
  portfolioAllPhrase: string;
  /** Parenthetical role-vocabulary example in world core. */
  worldRoleVocabulary: string;
  /** Parenthetical role-vocabulary example for the tagline rule. */
  taglineRoleVocabulary: string;
  portfolioClicheLine: string | null;
  /** Fragment: what the contradiction is shown against in `personality.behavioral`. */
  contradictionExposure: string;
  /** Extra world-core line when the world may have no supernatural power system. */
  worldPowerNote: string | null;
  /** Default user relation is open (not romance / salvation / nobility). */
  openRelationLine: string | null;
  visualDirectionLines: readonly string[];
  /** Drop romance-led market signals (`isRomanceLedSignal`) from this genre's market input. */
  excludeRomanceLedSignals: boolean;
  /** World bible depth: scene-scale only for `현대/일상`; rofan and other genres stay full. */
  worldScale: OfficialWorldScale;
};

export type OfficialAuthoringDirection = {
  genre?: string;
  tone?: OfficialNarrativeTone;
  humor?: OfficialHumorLevel;
  pacing?: OfficialNarrativePacing;
  nameWordplay?: OfficialNameWordplay;
  /** Override of the genre default (`resolveNamingProfile`) — e.g. a codename school drama. */
  namingProfile?: NamingProfileKey;
};

export type OfficialAuthoringPlan = {
  profile: OfficialGenreProfile;
  /** Resolved genre label; null when the input was not one of the 19 site genres. */
  genre: string | null;
  namingProfile: NamingProfileKey;
  tone?: OfficialNarrativeTone;
  humor?: OfficialHumorLevel;
  pacing?: OfficialNarrativePacing;
  nameWordplay?: OfficialNameWordplay;
};

export const ROFAN_GENRE_PROFILE: OfficialGenreProfile = {
  key: "rofan_parity",
  worldArchitectLine: "너는 로맨스 판타지 세계관 아키텍트다.",
  characterWriterLine: "너는 로맨스 판타지 캐릭터 작가다.",
  styleDirectorLine: "너는 로맨스 판타지 비주얼 디렉터다.",
  systemCastPhrase: "10명의 플레이어블 캐릭터가",
  portfolioAllPhrase: "10명 모두",
  worldRoleVocabulary: "(황태자·기사단장·마탑주·북부 대공 등)",
  taglineRoleVocabulary: "(황자·기사단장·청부업자 등)",
  portfolioClicheLine: "냉미남·집착남·황태자·계약관계·검은머리·190cm 클론 금지.",
  contradictionExposure: "개인적 관심·애정 앞에서",
  worldPowerNote: null,
  openRelationLine: null,
  visualDirectionLines: ["[DOMESTIC ROFAN PRODUCT DIRECTION]", DOMESTIC_ROFAN_STYLE_DIRECTION],
  excludeRomanceLedSignals: false,
  worldScale: "full",
};

const OPEN_RELATION_LINE =
  "유저와의 관계는 연애로 한정하지 않는다. 로맨스·구원·귀족 구도를 전제로 깔지 않고, 이 장르에서 자연스러운 관계(동료·라이벌·의뢰인·이웃·동행 등)와 사건으로 시작한다. 인물은 유저가 없어도 자기 일과 목표로 움직인다.";

const NEUTRAL_POWER_NOTE =
  "  초자연 능력이 없는 세계라면 powerSystem은 이 세계에서 사람들이 영향력·자격·자원을 얻고 잃는 방식(규칙·평판·기술·권한)으로 채운다. 마법을 만들어 넣지 않는다.";

const NEUTRAL_SCENE_POWER_NOTE =
  "  초자연 능력이 없는 세계라면 powerSystem은 이 장면에서 인물이 실제로 할 수 있는 행동·선택·한계·대가로 채운다. 제도·권한·행정 체계 전체를 설명하는 문장을 쓰지 않는다. 마법을 만들어 넣지 않는다.";

function neutralProfile(label: string | null, romanceFrame: boolean): OfficialGenreProfile {
  const lead = label ? `${label} ` : "";
  const worldScale: OfficialWorldScale = label === OFFICIAL_MODERN_DAILY_GENRE ? "scene" : "full";
  return {
    key: "genre_neutral",
    worldArchitectLine: `너는 ${lead}세계관 아키텍트다.`,
    characterWriterLine: `너는 ${lead}캐릭터 작가다.`,
    styleDirectorLine: `너는 ${lead}비주얼 디렉터다.`,
    systemCastPhrase: "플레이어블 캐릭터가",
    portfolioAllPhrase: "모든 캐릭터는",
    worldRoleVocabulary: "(이 장르 독자가 바로 아는 직업·역할·소속 어휘)",
    taglineRoleVocabulary: "(이 장르 독자가 바로 아는 직업·역할 어휘)",
    portfolioClicheLine: null,
    contradictionExposure: romanceFrame ? "개인적 관심·애정 앞에서" : "누군가 다가오거나 도움·호의를 건넬 때",
    worldPowerNote: worldScale === "scene" ? NEUTRAL_SCENE_POWER_NOTE : NEUTRAL_POWER_NOTE,
    openRelationLine: romanceFrame ? null : OPEN_RELATION_LINE,
    visualDirectionLines: [],
    excludeRomanceLedSignals: !romanceFrame,
    worldScale,
  };
}

export function officialWorldScaleForPlan(plan: OfficialAuthoringPlan = ROFAN_PARITY_PLAN): OfficialWorldScale {
  return plan.profile.worldScale;
}

/** Rofan keeps its explicit parity profile; every other input (including unknown) gets the neutral fallback. */
export function resolveOfficialGenreProfile(genre: string | undefined): OfficialGenreProfile {
  if (genre === OFFICIAL_ROFAN_GENRE) return ROFAN_GENRE_PROFILE;
  const known = genre !== undefined && isCharacterGenre(genre);
  return neutralProfile(known ? genre : null, known && ROMANCE_FRAME_GENRES.has(genre));
}

export function resolveOfficialAuthoringPlan(direction: OfficialAuthoringDirection): OfficialAuthoringPlan {
  const genre = direction.genre !== undefined && isCharacterGenre(direction.genre) ? direction.genre : null;
  return {
    profile: resolveOfficialGenreProfile(direction.genre),
    genre,
    namingProfile: direction.namingProfile ?? resolveNamingProfile(genre ?? ""),
    ...(direction.tone ? { tone: direction.tone } : {}),
    ...(direction.humor ? { humor: direction.humor } : {}),
    ...(direction.pacing ? { pacing: direction.pacing } : {}),
    ...(direction.nameWordplay ? { nameWordplay: direction.nameWordplay } : {}),
  };
}

/** Plan used when a caller supplies none: the pre-G5 rofan prompts, byte for byte. */
export const ROFAN_PARITY_PLAN: OfficialAuthoringPlan = resolveOfficialAuthoringPlan({ genre: OFFICIAL_ROFAN_GENRE });

type RecommendedAuthoringAxes = Required<Pick<OfficialAuthoringDirection, "tone" | "humor" | "pacing" | "nameWordplay">>;

const RECOMMENDED_LIGHT_COMEDY: RecommendedAuthoringAxes = {
  tone: "light",
  humor: "central",
  pacing: "dialogue",
  nameWordplay: "nickname",
};
const RECOMMENDED_DRY: RecommendedAuthoringAxes = {
  tone: "dry",
  humor: "light",
  pacing: "narration",
  nameWordplay: "none",
};
const RECOMMENDED_LYRICAL: RecommendedAuthoringAxes = {
  tone: "lyrical",
  humor: "light",
  pacing: "balanced",
  nameWordplay: "none",
};
const RECOMMENDED_SERIOUS: RecommendedAuthoringAxes = {
  tone: "serious",
  humor: "light",
  pacing: "balanced",
  nameWordplay: "none",
};
const RECOMMENDED_SIMULATION: RecommendedAuthoringAxes = {
  tone: "light",
  humor: "light",
  pacing: "dialogue",
  nameWordplay: "none",
};

function recommendedAxes(genre: CharacterGenre): RecommendedAuthoringAxes {
  switch (genre) {
    case "현대/일상":
    case "학원":
    case "스포츠":
      return RECOMMENDED_LIGHT_COMEDY;
    case "공포/추리":
    case "SF":
    case "아포칼립스":
      return RECOMMENDED_DRY;
    case "로맨스":
    case "로맨스 판타지":
    case "BL":
    case "GL":
    case "HL":
      return RECOMMENDED_LYRICAL;
    case "시뮬레이션":
      return RECOMMENDED_SIMULATION;
    case "무협":
    case "동양풍":
    case "현대 판타지":
    case "판타지":
    case "인외":
    case "센티넬버스":
    case "기타":
      return RECOMMENDED_SERIOUS;
    default: {
      const unreachable: never = genre;
      throw new Error(`unknown genre for authoring recommendation: ${String(unreachable)}`);
    }
  }
}

/**
 * Admin UI default. Callers that omit tone/humor/pacing stay on `ROFAN_PARITY_PLAN`
 * byte parity; this recommendation is applied only when the admin leaves an axis on auto.
 */
export function recommendOfficialAuthoringDirection(
  genre: CharacterGenre
): OfficialAuthoringDirection & RecommendedAuthoringAxes {
  return { genre, ...recommendedAxes(genre) };
}

export function recommendOfficialCastIntent(genre: CharacterGenre): string {
  const profile = resolveOfficialGenreProfile(genre);
  if (profile.openRelationLine) {
    return `전체 이용자 대상 ${genre} 캐릭터 1명. 연애로 시작하지 않고, 이 장르에서 자연스러운 일과 관계로 첫 장면을 만든다.`;
  }
  return `전체 이용자 대상 ${genre} 캐릭터 1명. 유저의 성별·직업·과거는 고정하지 않고, 이 장르의 관계와 사건으로 첫 장면을 만든다.`;
}

export type OfficialAuthoringAxisChoice<T extends string> = T | "auto";

export function resolveAdminAuthoringDirection(input: {
  genre: CharacterGenre;
  tone?: OfficialAuthoringAxisChoice<OfficialNarrativeTone>;
  humor?: OfficialAuthoringAxisChoice<OfficialHumorLevel>;
  pacing?: OfficialAuthoringAxisChoice<OfficialNarrativePacing>;
  nameWordplay?: OfficialAuthoringAxisChoice<OfficialNameWordplay>;
}): OfficialAuthoringDirection & RecommendedAuthoringAxes {
  const recommended = recommendOfficialAuthoringDirection(input.genre);
  const pick = <T extends string>(choice: T | "auto" | undefined, fallback: T): T =>
    choice && choice !== "auto" ? choice : fallback;
  return {
    genre: input.genre,
    tone: pick(input.tone, recommended.tone),
    humor: pick(input.humor, recommended.humor),
    pacing: pick(input.pacing, recommended.pacing),
    nameWordplay: pick(input.nameWordplay, recommended.nameWordplay),
  };
}

export const OFFICIAL_SUPPORTED_GENRES: readonly string[] = CHARACTER_GENRES;

const TONE_LINES: Record<OfficialNarrativeTone, string> = {
  serious: "문체: 진지하게 쓴다. 갈등의 무게를 농담으로 덜지 않는다.",
  lyrical: "문체: 서정적이고 감각적으로 쓴다. 분위기를 설명으로 덮지 않고 구체적 장면으로 만든다.",
  light: "문체: 경쾌하게 쓴다. 가벼워도 인물의 목표와 대가는 실제로 있어야 한다.",
  dry: "문체: 건조하게 쓴다. 인물은 상황의 부조리를 과장 없이 담담하게 말하고, 웃음은 그 간극에서 나온다.",
  satirical:
    "문체: 풍자로 쓴다. 조롱의 대상은 사람이 아니라 제도·관습·허세이며, 인물이 그 안에서 실제로 곤란을 겪는다.",
  tragic: "문체: 비극적 무게를 유지한다. 상실과 선택의 대가를 감정 과장 없이 구체적 행동으로 쓴다.",
};

const HUMOR_LINES: Record<OfficialHumorLevel, string> = {
  none: "유머 비중: 없음. 농담·말장난을 넣지 않는다.",
  light: "유머 비중: 가벼움. 인물의 말투와 상황에서 자연스럽게 나오는 정도로만 쓴다.",
  central:
    "유머 비중: 핵심. 웃기는 상황과 인물의 행동이 다음 사건을 만든다. 농담으로 목표·약점·대가를 가리지 않고, 그 행동이 이야기를 앞으로 민다.",
};

const PACING_LINES: Record<OfficialNarrativePacing, string> = {
  narration: "전개 비중: 서술 중심. 장면 묘사와 내면 서술이 오프닝의 주축이다.",
  balanced: "전개 비중: 서술과 대사를 균형 있게 쓴다.",
  dialogue:
    "전개 비중: 대사 중심. 오프닝과 말투 예시에서 대사 비중을 높이고 서술은 짧게 유지한다(길이 band·따옴표 규칙은 그대로).",
};

export type AuthoringWordplayRole = "choose" | "keep" | "use";

const WORDPLAY_CHOOSE_LINES: Record<OfficialNameWordplay, string> = {
  none: "",
  nickname:
    "이름 방식: 본명은 namingProfile에 맞추고, 주변이 부르는 별명은 name의 괄호 별칭('본명 (별명)')으로 정한다. 별명에는 그 인물의 행동·사건에서 생긴 이유가 있어야 한다.",
  pun: "이름 방식: 이름 자체를 말장난으로 지을 수 있다(소리·뜻 중첩, 직업·성격과의 반어). 이 지정이 namingProfile의 조어 금지 문구보다 우선하되 실제로 읽히는 이름이어야 한다. 이 세계에서 그 이름이 왜 불리는지 근거가 있어야 하고, 세계의 시대·문화권에 맞는 말장난만 쓴다(현대 인터넷 유행어를 이세계·시대 배경에 섞지 않는다). 현실 인물·경쟁작 이름은 쓰지 않는다.",
};

const WORDPLAY_KEEP_LINE =
  "이름 방식: identity.name은 브리프 name을 그대로 유지한다. 괄호 별칭이 있으면 이미 정해진 사실로만 쓰고, 새 본명이나 새 별명을 만들지 않는다.";

const WORDPLAY_USE_LINE =
  "이름 방식: 주어진 이름(괄호 별칭이 있으면 포함)을 공개 소개와 첫 장면에 자연스럽게 한 번 드러낸다. 이름을 새로 정하거나 바꾸지 않으며, 대사마다 별명을 반복하지 않는다.";

function wordplayLine(kind: OfficialNameWordplay, role: AuthoringWordplayRole): string {
  switch (role) {
    case "choose":
      return WORDPLAY_CHOOSE_LINES[kind];
    case "keep":
      return WORDPLAY_KEEP_LINE;
    case "use":
      return WORDPLAY_USE_LINE;
    default: {
      const unreachable: never = role;
      throw new Error(`unknown wordplay role: ${String(unreachable)}`);
    }
  }
}

export type AuthoringDirectionKey = "tone" | "humor" | "pacing" | "wordplay" | "relation";

/**
 * The one `[창작 방향]` block. Empty for the default rofan plan so legacy
 * prompts are unchanged; each call passes only the keys it can act on, so a
 * genre/tone instruction appears at most once per provider call.
 * Wordplay is choose (portfolio), keep (part1), or use (voice).
 */
export function formatAuthoringDirection(
  plan: OfficialAuthoringPlan,
  keys: readonly AuthoringDirectionKey[],
  wordplayRole: AuthoringWordplayRole = "choose"
): string[] {
  const lines: string[] = [];
  for (const key of keys) {
    switch (key) {
      case "tone":
        if (plan.tone) lines.push(TONE_LINES[plan.tone]);
        break;
      case "humor":
        if (plan.humor) lines.push(HUMOR_LINES[plan.humor]);
        break;
      case "pacing":
        if (plan.pacing) lines.push(PACING_LINES[plan.pacing]);
        break;
      case "wordplay":
        if (plan.nameWordplay && plan.nameWordplay !== "none") {
          const line = wordplayLine(plan.nameWordplay, wordplayRole);
          if (line) lines.push(line);
        }
        break;
      case "relation":
        if (plan.profile.openRelationLine) lines.push(plan.profile.openRelationLine);
        break;
      default: {
        const unreachable: never = key;
        throw new Error(`unknown authoring direction key: ${String(unreachable)}`);
      }
    }
  }
  return lines.length ? ["", "창작 방향(장르·문체·유머·작명은 서로 독립 — 지정된 축만 따른다):", ...lines.map((l) => `- ${l}`)] : [];
}
