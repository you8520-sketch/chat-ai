/**
 * Official character author prompts — part of the canonical author owner
 * (`author.ts`). Text-only builders: no network, no billing, no points.
 *
 * Generation order: WORLD BIBLE → PORTFOLIO MAP → CHARACTER BIBLE ×10
 * (part1 + voice + bonds) → deterministic compile to `OfficialCharacterDraft`.
 * World + character are never generated together in one call.
 *
 * Canonical hard limits respected here (not redefined):
 * - name ≤20, tagline ≤50, greeting ≤2000 (production band: OFFICIAL_AUTHOR_QUALITY_CONTRACT)
 * - speech.examples ≤500 total, speech.forbidden ≤500
 * - lorebook content ≤800, name ≤40, keywords ≤10
 */
import { ASSET_PERSON_TAGS } from "@/lib/assetPersonTags";
import { CREATOR_ASSET_TAG_MAX } from "@/lib/characterAssets";
import {
  formatMarketFitForPrompt,
  MARKET_FIT_SKELETON,
  NAMING_PROFILES,
  type MarketRole,
  type NamingProfileKey,
  type OfficialMarketFitBrief,
} from "@/lib/officialSupply/marketFit";
import type { OfficialCharacterSceneContext } from "@/lib/officialSupply/scenePortfolio";
import { DOMESTIC_ROFAN_STYLE_DIRECTION } from "@/lib/officialSupply/style";
import { buildRofanMatureMaleVisualAgeDirection } from "@/lib/officialSupply/appearance";

/**
 * Canonical official-supply author quality contract — the ONE source for both
 * the author prompts and the deterministic bible validator. These are
 * production-authoring bands, not runtime/storage ceilings (greeting ≤2000,
 * tagline ≤50 etc. stay owned by `characterFormLimits`). Length is only half
 * the gate: structural coverage (see `evaluateAuthorQualityContract`) is the
 * other half, so short-but-complete prose passes and padded prose fails.
 */
export const OFFICIAL_AUTHOR_QUALITY_CONTRACT = {
  greeting: { min: 700, max: 1400 },
  speechDescription: { min: 250, max: 600 },
  publicDescription: { min: 200, max: 500 },
  /** Core discovery tags: genre · relationship · personality · material · direction. */
  discoveryTags: { min: 4, max: 7 },
} as const;

const Q = OFFICIAL_AUTHOR_QUALITY_CONTRACT;

export const OFFICIAL_AUTHOR_TEMPLATE_VERSION = "pilot-rf-01/v3";
export const OFFICIAL_AUTHOR_SNAPSHOT_VERSION = "market-research-snapshot-2026-09.json";

export type OfficialAuthorTask =
  | "world_bible"
  | "character_bible_1"
  | "character_bible_voice"
  | "character_bible_bonds"
  | "character_npc_relation"
  | "appearance"
  | "asset_plan"
  | "adult_profile"
  | "style_board";

export const OFFICIAL_AUTHOR_MAX_TOKENS: Record<OfficialAuthorTask, number> = {
  world_bible: 14000,
  character_bible_1: 10000,
  character_bible_voice: 8000,
  character_bible_bonds: 8000,
  character_npc_relation: 2000,
  appearance: 3000,
  asset_plan: 5000,
  adult_profile: 4000,
  style_board: 9000,
};

export const OFFICIAL_AUTHOR_TEMPERATURE: Record<OfficialAuthorTask, number> = {
  world_bible: 0.75,
  character_bible_1: 0.75,
  character_bible_voice: 0.8,
  character_bible_bonds: 0.75,
  character_npc_relation: 0.6,
  appearance: 0.6,
  asset_plan: 0.6,
  adult_profile: 0.7,
  style_board: 0.7,
};

export type WorldBibleInput = {
  genre: string;
  worldKey: string;
  styleKey: string;
  /** Batch market target (manifest policy), e.g. ko-KR / domestic_first. */
  market: WorldMarketInput;
  /** Fixed manifest slots: exactly 10 for the pilot. */
  slots: number;
  /** Desired adult-candidate count for this manifest (not a global rule). */
  adultCandidates: number;
  /** Manifest-scoped gender plan (not a global rule), e.g. "남성 8명, 여성 1명, 기타 1명". */
  genderMix: string;
  /** Fixed gender per slot (index slot-1). */
  slotGenders: ("male" | "female" | "other")[];
  /** Batch cast intent in plain words (audience + romance-target profile). */
  castIntent?: string;
};

/** Market input for world/portfolio calls — trope-level signal lines only (`selectMarketSignals`). */
export type WorldMarketInput = {
  targetLocale: string;
  marketPriority: string;
  /** `formatMarketSignalLines` output: signalId-tagged, IP-eligible, locale-first. */
  signalLines: string[];
  namingProfile: NamingProfileKey;
  marketRoleMix: Record<MarketRole, { min: number; max: number }>;
  maxPrimaryTropeRepeat: number;
  coreTags: { min: number; max: number };
};

const WORLD_CORE_SKELETON = `{"name": "", "genre": "", "subgenre": "", "tone": "", "era": "", "techLevel": "", "regions": "", "societyForm": "", "premise": "", "centralPremise": "", "situation": {"biggestEvent": "", "beneficiaries": "", "threatened": "", "upcomingChange": ""}, "factions": [{"name": "", "purpose": "", "leadership": "", "means": "", "relations": "", "publicView": ""}], "powerSystem": {"capabilities": "", "users": "", "acquisition": "", "ranks": "", "limits": "", "costs": "", "socialImpact": "", "taboos": ""}, "society": {}, "culture": [{"name": "", "detail": ""}]}`;

const WORLD_ATLAS_SKELETON = `{"locations": [{"name": "", "purpose": "", "mood": "", "users": "", "rpEvents": ""}], "history": [{"event": "", "impact": ""}], "knowledge": {"common": [""], "faction": [""], "characterLocal": [""], "authorOnly": [""]}, "userEntry": {"allowedRoles": ["", ""], "note": ""}, "lorebook": [{"entryKey": "", "name": "", "keywords": [""], "content": ""}]}`;

const WORLD_PORTFOLIO_SKELETON = `{"portfolio": [{"slot": 1, "marketFit": ${MARKET_FIT_SKELETON}, "name": "", "gender": "", "age": 0, "archetype": "", "relationshipTrope": "", "occupation": "", "faction": "", "socialPosition": "", "personalityCore": "", "visualSilhouette": "", "rpHook": "", "adultCandidate": false, "speechDirection": "", "audience": ""}]}`;

export function buildWorldBibleSystem(): string {
  return [
    "너는 로맨스 판타지 세계관 아키텍트다.",
    "10명의 플레이어블 캐릭터가 서로 다른 관점에서 살아갈 수 있는, 구조적 갈등을 가진 하나의 세계 바이블을 쓴다.",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다.",
    "세계 바이블은 3회 호출로 나눠 작성한다(core → atlas → portfolio). 각 호출은 지정된 필드만 출력한다.",
  ].join("\n");
}

export function buildWorldCoreUser(input: WorldBibleInput): string {
  return [
    `장르: ${input.genre}`,
    `대상 시장: ${input.market.targetLocale} (${input.market.marketPriority})`,
    "",
    "시장 신호(트로프·훅 구조·장치 수준만 참고. 경쟁작 문장·이름·고유 설정 복제 금지):",
    ...input.market.signalLines,
    "세계관은 깊게 쓰되, 캐릭터 카드 첫 노출에서는 대상 시장 독자가 바로 아는 역할 어휘(황태자·기사단장·마탑주·북부 대공 등)로",
    "설명될 수 있어야 한다. 고유 신조어는 내부 깊이를 위해 쓴다.",
    "",
    "이번 호출(core) 출력 필드:",
    "- name(세계관 이름), genre, subgenre, tone, era, techLevel, regions, societyForm",
    "- premise 300~600자 + centralPremise 한 문장",
    "- situation: biggestEvent·beneficiaries·threatened·upcomingChange (합 500~1000자)",
    "- factions 3~6개: 이름·목적·지도층·수단·타 세력과의 관계·일반인의 시선",
    "- powerSystem: capabilities·users·acquisition·ranks·limits·costs·socialImpact·taboos (\"마법이 있다\" 수준 금지)",
    "- society: RP에 영향을 주는 영역 3개 이상(계급·법·결혼/가족·교육·직업·군사·차별/예절 중)",
    "- culture 3~6개: 이름·상세",
    "최상위 키는 정확히 name·genre·subgenre·tone·era·techLevel·regions·societyForm·premise·centralPremise·",
    "situation·factions·powerSystem·society·culture 이며 하나도 빠뜨리지 않는다.",
    "아래 빈 틀의 모든 값을 채워 JSON 한 개만 출력한다.",
    WORLD_CORE_SKELETON,
  ].join("\n");
}

export type WorldAtlasInput = {
  worldName: string;
  centralPremise: string;
  factionNames: string[];
};

export function buildWorldAtlasUser(input: WorldAtlasInput): string {
  return [
    `세계관: ${input.worldName} — ${input.centralPremise}`,
    `세력: ${input.factionNames.join(" / ")}`,
    "",
    "이번 호출(atlas) 출력 필드:",
    "- locations 5~10개: 이름·용도·분위기·이용자·RP에서 벌어질 사건(이후 스페셜 신 에셋의 재료)",
    "- history 3~6개: 현재에 영향을 주는 사건만(event·impact). 연대표 나열 금지",
    "- knowledge: common(대중 상식만, 비밀·정체·흑막·미래 표현 금지) / faction / characterLocal / authorOnly",
    "- userEntry: allowedRoles 2개 이상(귀족·고용인·방문자·계약 상대·신입 등, 단일 강제 금지) + note",
    "- lorebook: 실제 RP에서 반복적으로 필요한 세계 정보만 3~8개. 개수 채우기 금지. entryKey·name(40자 이내)·keywords(2~10개)·content(800자 이내)",
    "최상위 키는 정확히 locations·history·knowledge·userEntry·lorebook이며 하나도 빠뜨리지 않는다.",
    "아래 빈 틀의 모든 값을 채워 JSON 한 개만 출력한다.",
    WORLD_ATLAS_SKELETON,
  ].join("\n");
}

export type WorldPortfolioInput = {
  worldName: string;
  centralPremise: string;
  factionNames: string[];
  locationNames: string[];
  slots: number;
  adultCandidates: number;
  genderMix: string;
  /** Fixed gender per slot (index slot-1). The model must not change these. */
  slotGenders: ("male" | "female" | "other")[];
  market: WorldMarketInput;
  /** Batch cast intent in plain words (audience + romance-target profile). */
  castIntent?: string;
};

/** Market-fit authoring rules shared by the full portfolio call and slot replacement. */
function marketFitRuleLines(m: WorldMarketInput): string[] {
  const mix = (Object.entries(m.marketRoleMix) as [MarketRole, { min: number; max: number }][])
    .map(([role, band]) => `${role} ${band.min}~${band.max}`)
    .join(", ");
  return [
    `대상 시장: ${m.targetLocale} (${m.marketPriority})`,
    "시장 신호(PRIMARY 우선, 트로프·훅 구조만 참고):",
    ...m.signalLines,
    "",
    "상품 기획 순서(관계 우선): ① 캐릭터가 유저에게 누구인가 ② 둘 사이에 지금 무슨 문제가 있는가",
    "③ 유저가 왜 대화해야 하는가 ④ 기대할 감정 경험 ⑤ 그 뒤에 세계관 장치.",
    "각 브리프는 먼저 marketFit을 채운 뒤 나머지 필드를 marketFit에 맞춰 쓴다. marketFit 규칙:",
    `- targetLocale은 "${m.targetLocale}". provenMarketSignal은 위 목록의 [signalId]만 1~3개 인용.`,
    "- relationshipTrope.primary 1개 + secondary 0~2개(핵심 트로프는 1~3개로 선명하게, 나머지는 부가 맛).",
    `- 같은 primary 트로프는 최대 ${m.maxPrimaryTropeRepeat}명. 비슷한 트로프를 공유해도 유저와의 실제 역학은 달라야 한다.`,
    "- differentiationTwist: 인기 트로프 + 고유 차별점(역할 역전·직업 충돌·과거 사건·정치적 이해관계·특이 능력·유저와의 비대칭 정보 중 1개 이상).",
    `- marketRole은 proven·proven_twist·experimental 중 하나. 이번 배치 구성: ${mix}.`,
    "- userRelationship: 상품 기획용 관계 역학이다. 사전 관계를 반드시 고정하는 필드가 아니다. 오프닝이 특정 관계를 핵심 전제로 삼을 때만 고정하고, 그 외에는 현재 장면의 이해관계·긴장·거리로 쓴다.",
    "- oneLineConflict: '현재 유저-캐릭터 역학 + 지금의 갈등 + 대화할 이유'를 한 문장으로. persona-flexible 카드에서는 가족/연인/상관/초면 같은 사전 관계를 단정하지 않는다.",
    "  세계관 고유명사 없이 대상 시장 독자가 바로 아는 역할 어휘로 쓴다.",
    `- namingProfile은 "${m.namingProfile}" (${NAMING_PROFILES[m.namingProfile].guidance})`,
    `- discoveryTags ${m.coreTags.min}~${m.coreTags.max}개: 장르·관계·성격·소재·방향성을 섞되 캐릭터 핵심 경험만. 인기 키워드 억지 삽입 금지.`,
    "- adultDemandSignal: 성인 후보면 성인 수요가 있는 [signalId], 아니면 null. 성인 후보도 관계 훅·캐릭터성·직업·갈등·말투가 먼저다.",
    "- originalityExclusions: 닮지 말아야 할 경쟁작·원작 요소(이름·외형·설정) 목록.",
  ];
}

export function buildWorldPortfolioUser(input: WorldPortfolioInput): string {
  const m = input.market;
  return [
    `세계관: ${input.worldName} — ${input.centralPremise}`,
    `세력: ${input.factionNames.join(" / ")}`,
    `장소: ${input.locationNames.join(" / ")}`,
    `캐릭터 슬롯 수: ${input.slots} (정확히 이 수만큼 portfolio 브리프 생성)`,
    `성인 후보 수: ${input.adultCandidates}명 (이 수만큼 adultCandidate=true)`,
    `성별 구성: ${input.genderMix} (이 배치의 의도된 구성 — 반드시 준수)`,
    input.castIntent ? `캐스트 의도: ${input.castIntent}` : "",
    `슬롯별 성별 고정표(절대 변경 금지, 이름도 성별에 맞게): ${input.slotGenders.map((g, i) => `${i + 1}번 ${g}`).join(", ")}`,
    "",
    ...marketFitRuleLines(m),
    "",
    "이번 호출(portfolio) 출력 필드: portfolio 배열. 각 브리프는",
    "slot·marketFit·name(20자 이내, 서로 겹치지 않게)·gender·age(19세 이상)·archetype·relationshipTrope(=marketFit primary)·occupation·",
    "faction(위 목록에서)·socialPosition·personalityCore·visualSilhouette·rpHook·adultCandidate·speechDirection·audience.",
    `이름은 namingProfile을 따른다: ${NAMING_PROFILES[m.namingProfile].guidance}`,
    "같은 첫 음절·끝 음절이 3명 이상 반복되거나 한 음절만 다른 이름 쌍, 가족이 아닌데 같은 성/가문명을 쓰는 것 금지.",
    "10명 모두 역할·세력·신분·성격핵·관계 트로프·외형 실루엣·RP 훅이 달라야 한다.",
    "냉미남·집착남·황태자·계약관계·검은머리·190cm 클론 금지.",
    "연령·신분 분산. 경쟁작의 고유 명칭·문장·설정·캐릭터 이름을 복제하지 않는다.",
    "최상위 키는 정확히 portfolio 하나이며, 브리프 키도 빠뜨리지 않는다.",
    "아래 빈 틀을 복제·확장해 JSON 한 개만 출력한다.",
    WORLD_PORTFOLIO_SKELETON,
  ].join("\n");
}

/** Re-plan specific slots inside an existing world; every other brief stays fixed. */
export type PortfolioReplacementInput = {
  worldName: string;
  centralPremise: string;
  factionNames: string[];
  locationNames: string[];
  market: WorldMarketInput;
  castIntent: string;
  /** Kept siblings (name — gender, occupation, trope, hook) the new briefs must not overlap. */
  keptSiblings: string[];
  /** Manifest direction per replaced slot (role space + relationship experience + exclusions). */
  slots: { slot: number; gender: "male" | "female" | "other"; adultCandidate: boolean; direction: string }[];
  feedback?: string;
};

export function buildPortfolioReplacementUser(input: PortfolioReplacementInput): string {
  const m = input.market;
  return [
    `세계관: ${input.worldName} — ${input.centralPremise}`,
    `세력: ${input.factionNames.join(" / ")}`,
    `장소: ${input.locationNames.join(" / ")}`,
    `캐스트 의도: ${input.castIntent}`,
    "",
    "유지되는 캐릭터(절대 겹치지 않게 — 직업·신분·관계 훅·말투·외형 실루엣·트로프·이름 음절):",
    ...input.keptSiblings.map((s) => `- ${s}`),
    "",
    "이번에 새로 기획할 슬롯(이 슬롯만 출력):",
    ...input.slots.map(
      (s) => `- ${s.slot}번: gender=${s.gender}, adultCandidate=${s.adultCandidate} — ${s.direction}`
    ),
    "",
    ...marketFitRuleLines(m),
    "",
    "출력 필드: portfolio 배열(위 슬롯 수만큼, slot 번호 그대로). 각 브리프는",
    "slot·marketFit·name(20자 이내)·gender·age(19세 이상)·archetype·relationshipTrope(=marketFit primary)·occupation·",
    "faction(위 목록에서)·socialPosition·personalityCore·visualSilhouette·rpHook·adultCandidate·speechDirection·audience.",
    `이름은 namingProfile을 따른다: ${NAMING_PROFILES[m.namingProfile].guidance}`,
    "유지 캐릭터와 첫 음절·끝 음절이 겹치거나 한 음절만 다른 이름, 가족이 아닌데 같은 가문명 금지. 경쟁작 캐릭터 이름 금지.",
    "rpHook은 유저와의 첫 관계가 한 줄에 바로 읽히게 쓴다(세계관 설명으로 시작하지 않는다).",
    "최상위 키는 정확히 portfolio 하나이며, 브리프 키도 빠뜨리지 않는다. JSON 한 개만 출력한다.",
    WORLD_PORTFOLIO_SKELETON,
    input.feedback?.trim() ? `이전 시도 반려 사유(반드시 수정):\n${input.feedback.trim()}` : "",
  ].join("\n");
}

export function buildWorldBibleUser(input: WorldBibleInput): string {
  return buildWorldCoreUser(input);
}

export type PortfolioBriefInput = {
  slot: number;
  name: string;
  gender: "male" | "female" | "other";
  age: number;
  archetype: string;
  relationshipTrope: string;
  occupation: string;
  faction: string;
  socialPosition: string;
  personalityCore: string;
  visualSilhouette: string;
  rpHook: string;
  adultCandidate: boolean;
  speechDirection: string;
  audience: "all" | "female" | "male";
  /** Planned before the bible (`marketFit.ts`). Absent on briefs authored before the owner existed. */
  marketFit?: OfficialMarketFitBrief | null;
};

export type CharacterBible1Input = {
  brief: PortfolioBriefInput;
  worldName: string;
  /** Character-relevant slice of the world bible (not the whole bible). */
  worldContext: string;
  /** Names/hooks of already-planned siblings to stay distinct from. */
  siblingSketches: string[];
  /** Previous attempt rejection reasons (QA codes) — must be fixed this time. */
  feedback?: string;
};

export function buildCharacterBible1System(): string {
  return [
    "너는 로맨스 판타지 캐릭터 작가다. 플레이어블 캐릭터 바이블의 전반부(정체·외형·성격·과거·능력·일상·상황)를 쓴다.",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다.",
    "고정 골격 + 가변 밀도: 종족·소속이 무의미하면 짧게. 모든 필드를 억지로 채우지 않는다.",
    "",
    "분량(한국어 글자 수, filler 금지·밀도 우선):",
    "- part1 전체 분량은 반드시 5000자 이내로 쓴다(초과하면 반려되므로 각 필드를 간결하게).",
    "- identity: gender는 male·female·other 중 브리프 지정값 그대로, age는 브리프 나이 정수 그대로, heightCm은 140~220 정수.",
    "- appearance: 이미지/Appearance owner용 원본이다. 얼굴형·눈매·눈동자·머리색·헤어·길이·피부·키·체형·특징·표정·복장·소품을 250~500자로 기록하되, 이 장문을 RP 캐릭터 본문에 복제하지 않는다.",
    "- personality.keywords: 5~8개. personality.behavioral 450~700자:",
    "  키워드 나열로 끝내지 말고 평상시·낯선 사람·가까운 사람·분노·불안·당황·애정·갈등에서 실제로 무엇을 하는지 행동으로 쓴다.",
    "- contradiction: 내적 모순 1개 이상. 장점+단점 나열이 아니라 RP 갈등·변화의 원인이 되는 모순.",
    "- values: desires 1~2·fears 1~2·coreValues 2~3·nonNegotiable 1~2. 행동을 예측할 수 있을 만큼 구체적으로.",
    "- backstory: 현재 성격/행동을 만든 formative event 1~2개, 총 350~700자. 연대기 금지.",
    "  각 사건은 사건 → 당시 선택 → 현재 행동에 남은 흔적만 남긴다. 현재에 영향 없는 사건은 삭제.",
    "- abilities 2~4개: 캐릭터의 매력·권력·문제 해결 방식을 보여주는 능력만. 범위·한계/대가·대표 사용을 짧게 쓴다. 업무 매뉴얼처럼 장황하게 설명하지 않는다.",
    "- habits: hobbies는 짧은 명사/구 3~5개, habits는 반복 장면에 바로 쓸 행동 3~5개. likes/dislikes는 각 2~4개로 간결하게.",
    "- dailyLife 120~250자: 사건이 없을 때 무엇을 하며 시간을 보내는지 생활감만 남긴다.",
    "- situation: 세계 관련 맥락 350~650자 + 개인 현재 상황 300~600자 + 유저 진입 단서 120~250자. 세계 설정집을 캐릭터 본문으로 복사하지 않는다.",
    "- 캐릭터 runtime 핵심은 정체/성격/유저 인식/말투/관계 변화/과거 원인/습관·취미/가치관·금기/능력이다. 장문 외모·타 캐릭터 관계망·세계 설명은 각각 Appearance/Lorebook owner가 맡는다.",
    "- characterCore에 그대로 들어갈 문장으로 \"27세\"처럼 구조화된 나이와 같은 숫자를 반드시 명시한다(실제 나이로).",
    "",
    "품질 규칙:",
    "- 성인 시트라도 성적 요소로 채우지 않는다. 10대·학생·미성년 연상 표현을 현재 인물에게 쓰지 않는다.",
    "- 경쟁작 캐릭터의 이름·대사·문장·고유 설정을 복제하지 않는다.",
  ].join("\n");
}

export function buildCharacterBible1User(input: CharacterBible1Input): string {
  const b = input.brief;
  return [
    `세계관: ${input.worldName}`,
    `브리프: ${b.name} / ${b.gender} / ${b.age}세 / ${b.occupation} / ${b.faction} / ${b.socialPosition}`,
    `아키타입: ${b.archetype} / 트로프: ${b.relationshipTrope}`,
    `성격핵: ${b.personalityCore} / 외형: ${b.visualSilhouette}`,
    `RP 훅: ${b.rpHook}`,
    `성인 후보: ${b.adultCandidate ? "예" : "아니오"}`,
    ...(b.marketFit ? ["", ...formatMarketFitForPrompt(b.marketFit), "내부 설정은 깊게 유지하되 위 관계·갈등이 바이블 전체의 축이 되게 쓴다."] : []),
    "",
    "세계 맥락(모순 금지):",
    input.worldContext,
    "",
    input.siblingSketches.length
      ? `형제 캐릭터(이들과 이름·트로프·직업·말투·외형이 겹치지 않게):\n${input.siblingSketches.map((s) => `- ${s}`).join("\n")}\n`
      : "",
    "아래 빈 틀의 모든 값을 채워 JSON 한 개만 출력한다.",
    BIBLE_1_SKELETON,
    input.feedback?.trim() ? `이전 시도 반려 사유(반드시 수정):\n${input.feedback.trim()}` : "",
  ].join("\n");
}

export type CharacterVoiceInput = {
  name: string;
  age: number;
  adultCandidate: boolean;
  speechDirection: string;
  /** Part1 recap (identity + personality + backstory essence, ~600자). */
  part1Recap: string;
  /** 0~3; brief may demand specific NPCs. */
  npcDemand: string;
  /** Market fit brief — the public card is built on its relationship + conflict. */
  marketFit?: OfficialMarketFitBrief | null;
  /** Previous attempt rejection reasons (QA codes) — must be fixed this time. */
  feedback?: string;
};

export type NpcRelationRepairInput = {
  name: string;
  part1Recap: string;
  npcs: Array<{ index: number; name: string; role: string; personalityKeywords: string[]; appearance: string }>;
};

/** Relation-only repair: a separate task, never the full Voice contract. */
export function buildNpcRelationRepairSystem(): string {
  return [
    "너는 공식 캐릭터 바이블의 NPC 관계 한 줄만 채우는 보정자다.",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다: {\"npcs\":[{\"index\":번호,\"relationToChar\":\"...\"}]}",
    "요청된 index마다 relationToChar 한 개만 쓴다. 다른 필드·다른 NPC·캐릭터 본문은 쓰지 않는다.",
    "relationToChar는 본 캐릭터와 그 NPC의 관계를 한 문장(80자 이내)으로 쓴다.",
    "전반부 요약과 NPC의 이름·역할에서 직접 읽히는 관계만 쓴다. 새 인물·사건을 발명하지 않는다.",
    "관계를 특정할 수 없으면 relationToChar를 빈 문자열로 둔다.",
  ].join("\n");
}

export function buildNpcRelationRepairUser(input: NpcRelationRepairInput): string {
  return [
    `캐릭터: ${input.name}`,
    "",
    "전반부 요약:",
    input.part1Recap,
    "",
    "관계를 채울 NPC:",
    ...input.npcs.map(
      (npc) =>
        `- index ${npc.index}: 이름 ${npc.name} / 역할 ${npc.role} / 성격 ${npc.personalityKeywords.join(", ") || "없음"} / 외형 ${npc.appearance || "없음"}`
    ),
    "",
    "JSON 한 개만 출력한다.",
  ].join("\n");
}

export function buildCharacterVoiceSystem(): string {
  return [
    "너는 롤플레잉 말투·오프닝의 장인이다. 캐릭터 바이블의 목소리 부분(말투·규칙·그리팅·공개 프로필·NPC)만 쓴다.",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다.",
    "",
    "speech 규칙:",
    "- 존댓말/반말·문장 길이·속도감·어휘·자주/거의 안 쓰는 표현·욕설·농담·호칭·감정 은폐/분노/친밀 시 말투를 모두 설계.",
    `- keywords 4~8개. description은 반드시 ${Q.speechDescription.min}자 이상 ${Q.speechDescription.max}자 이하.`,
    "- register·tempo·vocabulary·humorStyle·angryStyle·intimateStyle·addressStyle·hiddenEmotionStyle은 하나도 비우지 않는다.",
    "- examples는 서로 다른 상황의 대사 4~6개를 각각 별도 줄로(줄바꿈 구분), 전체 합 500자 이내.",
    "  이름을 가려도 구별되는 목소리. 클론 말투 금지.",
    "- forbidden 500자 이내: 절대 하지 않을 말투.",
    "- behaviorRules 3~7개. 부정문 나열보다 캐릭터 고유 행동 논리. 유저 관계 메타규칙은 bonds의 userRelationship owner가 담당하므로 여기서 반복하지 않는다.",
    "",
    `greeting 규칙(실제 RP 첫 장면, 반드시 ${Q.greeting.min}자 이상 ${Q.greeting.max}자 이하):`,
    "- 장소·상황·분위기·캐릭터 행동·목소리·유저가 그 자리에 있는 최소 단서·반응 여지.",
    "- 캐릭터의 대사를 따옴표로 최소 1줄 넣고, 유저를 '당신'으로 지칭한다.",
    "- 유저 쪽 지칭은 성별 중립적으로 유지한다. 당신·상대·목격자·계약자·방문객·동행자·협상 상대처럼 역할과 상황으로 표현한다.",
    "- 캐릭터 본인의 성별 표현은 유지하되, 유저 페르소나의 성별·성정체성·연애 포지션은 런타임에서 정해지므로 생성 단계에서 고정하지 않는다.",
    "- 오프닝은 하나다. 에피소드/선택 시작을 만들지 않는다.",
    "- 유저 쪽 성별·호칭은 고정하지 않는다. 여자/남자/여성/남성/아가씨/도련님/왕자비/신부로 유저를 부르지 않는다.",
    "- 유저 지칭은 당신, 상대, 침입자, 목격자, 계약자, 방문객, 낯선 사람, 동행자, 협상 상대, 플레이어처럼 중성어만 쓴다. 캐릭터 본인 성별은 유지한다.",
    "- 소개문·자기소개·세계관 설명 덤프 금지. 이후 RP 문체의 스타일 앵커가 되는 웹소설형 출력.",
    "- 같은 문장·묘사를 반복해 분량을 채우지 않는다.",
    "",
    `공개 프로필: tagline은 반드시 50자 이내 훅 한 줄. description은 반드시 ${Q.publicDescription.min}자 이상 ${Q.publicDescription.max}자 이하`,
    "이 description은 카드용 짧은 pitch다. 상세 소개 본문은 컴파일러가 따로 만든다. 세계관 설정집이나 HTML을 쓰지 않는다.",
    "pitch(캐릭터·관계·경험·갈등 중 2개 이상, 비밀 노출 금지). 유저를 '당신'으로 부르며 어떤 관계/경험인지 드러낸다.",
    "- tagline은 분위기 문구가 아니라 '이 캐릭터가 당신에게 누구이고 지금 무슨 문제가 있는지'가 한눈에 보이는 관계 훅.",
    "  세계관 고유명사는 최대 2개, 장르 독자가 바로 아는 역할 어휘(황자·기사단장·청부업자 등)를 쓴다.",
    `- tags ${Q.discoveryTags.min}~${Q.discoveryTags.max}개: 장르·관계·성격·소재·방향성을 섞고, 바이블에 실제로 있는 경험만 쓴다(인기 키워드 억지 삽입 금지).`,
    "SFW 시트의 공개 텍스트(tagline·description·greeting·tags)에는 다음 음절을 어떤 단어의 일부로도 쓰지 않는다:",
    "섹스, 성교, 성행위, 자위, 사정, 삽입, 오르가즘, 포르노, 야설, 야동.",
    "'사정' 대신 사연/형편/경위를 쓴다.",
    "",
    "NPC: 실제 RP에서 반복 역할이 필요한 경우에만 1~2명. 필요하지 않으면 0명([])을 유지한다. NPC를 만들 때는 모든 필드를 실제 내용으로",
    "모두 교체하고 모든 키를 빈 문자열 없이 채운다(예시값 그대로 두기 금지). 한 줄 200자 이내.",
    "성인 시트의 NPC는 전원 나이 명시 + 19세 이상.",
  ].join("\n");
}

export function buildCharacterVoiceUser(input: CharacterVoiceInput): string {
  return [
    `캐릭터: ${input.name} (${input.age}세)`,
    `말투 방향: ${input.speechDirection}`,
    `성인 후보: ${input.adultCandidate ? "예" : "아니오"}`,
    `NPC 요구: ${input.npcDemand}`,
    ...(input.marketFit ? ["", ...formatMarketFitForPrompt(input.marketFit)] : []),
    "",
    "전반부 요약:",
    input.part1Recap,
    "",
    "아래 빈 틀의 필수 값을 채워 JSON 한 개만 출력한다. npcs는 실제 반복 역할이 필요할 때만 1~2명 추가하고, 필요 없으면 []를 유지한다.",
    characterVoiceSkeleton(input.adultCandidate),
    input.feedback?.trim() ? `이전 시도 반려 사유(반드시 수정):\n${input.feedback.trim()}` : "",
  ].join("\n");
}

export type CharacterBondsInput = {
  name: string;
  age: number;
  rpHook: string;
  adultCandidate: boolean;
  /** Other playable characters for relationship design (name — public role). */
  castList: string[];
  /** Part1 recap (identity + personality + backstory essence, ~600자). */
  part1Recap: string;
  /** Previous attempt rejection reasons (QA codes) — must be fixed this time. */
  feedback?: string;
};

export function buildCharacterBondsSystem(): string {
  return [
    "너는 롤플레잉 관계·갈등 설계자다. 캐릭터 바이블의 유대 부분(관계·비밀·RP 엔진·성인)만 쓴다.",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다.",
    "전체 분량은 반드시 2200자 이내로 쓴다(초과하면 반려되므로 각 필드를 간결하게).",
    "",
    "관계·비밀·엔진 규칙:",
    "- userRelationship: 기본은 persona-flexible이다. 도입부가 관계를 명시적으로 고정하지 않으면 유저의 이름·신분·성별·기존 관계를 임의로 확정하지 않는다.",
    "  유저 페르소나가 가족/동료/연인/상관/초면 등 기존 관계를 제시하면 그 설정을 우선한다. opening 자체가 특정 관계를 핵심 전제로 삼을 때만 최소 관계를 고정한다.",
    "  initialView/userRole/startingPoint는 현재 장면에서의 태도와 이해관계 중심으로 쓰고, 성별 고정 호칭을 쓰지 않는다.",
    "  progression은 최소 3단계지만 자동 사랑 빠짐 금지. 기존 관계가 있으면 그 관계에서 변화하고, 관계가 없으면 행동에 따라 신뢰/친밀/적대가 생기게 한다.",
    "- otherRelationships: 0~3명. 실제 RP에 반복 등장하거나 이 캐릭터의 행동을 바꾸는 인물만 기록한다. 출연진 전체를 채우지 않는다.",
    "  otherRelationships는 캐릭터 runtime 본문에 상시 주입하지 않는 lorebook 후보 메모다.",
    "- secrets 1~3개. 캐릭터 자신이 알고 있으나 공개하지 않는 핵심 사실만. RP progression·갈등·관계 변화에 실제 영향을 주는 것만 남기고 trivial 반전은 금지.",
    "- rpEngine: immediateHook + repeatable 반드시 3개 이상(비사건성 일상 포함) + mediumConflict + longTermChange.",
    "  엔딩 고정 금지.",
    "",
    "성인 섹션은 adultCandidate가 true일 때만 작성(허용값 그대로 사용):",
    "- dialogueProfile은 auto·none·suggestive·explicit_rare·explicit_frequent 중 하나.",
    "- consentModes는 standard·power_play·cnc_opt_in 중 1개 이상.",
    "- orientation·hookSummary(성인 관계 캐논 일부, 전체의 25% 이내).",
    "- tone은 반드시 200자 이상 300자 이하·preferenceKeywords 4~8개·boundaries 3~6개·",
    "  consentBehavior는 반드시 200자 이상 300자 이하·scenarioExamples 2~3개(짧고 행동 중심).",
    "- NSFW를 빼도 직업·성격·목표·과거·갈등·취미·관계가 살아 있어야 한다.",
  ].join("\n");
}

export function buildCharacterBondsUser(input: CharacterBondsInput): string {
  return [
    `캐릭터: ${input.name} (${input.age}세)`,
    `RP 훅: ${input.rpHook}`,
    `성인 후보: ${input.adultCandidate ? "예" : "아니오"}`,
    `출연진 참고 목록(관계 생성 의무 없음; 실제 직접 관련 0~3명만 otherRelationships 후보): ${input.castList.join(" / ")}`,
    "",
    "전반부 요약:",
    input.part1Recap,
    "",
    input.adultCandidate
      ? "아래 빈 틀의 필수 값을 채워 JSON 한 개만 출력한다. otherRelationships는 실제 반복 등장·행동 변화가 필요한 인물만 넣고 없으면 []; 성인 후보이므로 nsfw는 true, adultSection은 틀의 모든 키를 실제 내용으로 채운다."
      : "아래 빈 틀의 필수 값을 채워 JSON 한 개만 출력한다. otherRelationships는 실제 반복 등장·행동 변화가 필요한 인물만 넣고 없으면 []; 성인 후보가 아니면 adultSection은 null.",
    characterBondsSkeleton(input.adultCandidate),
    input.feedback?.trim() ? `이전 시도 반려 사유(반드시 수정):\n${input.feedback.trim()}` : "",
  ].join("\n");
}

const BIBLE_1_SKELETON = `{"identity": {"name": "", "gender": "male", "age": 27, "apparentAge": "", "heightCm": 184, "species": "인간", "occupation": "", "socialPosition": "", "affiliation": "", "worldRole": ""}, "appearance": {"faceShape": "", "eyes": "", "eyeColor": "", "hairColor": "", "hairstyle": "", "hairLength": "", "skin": "", "build": "", "musculature": "", "distinguishingFeatures": "", "usualExpression": "", "defaultOutfit": "", "accessories": "", "impression": ""}, "personality": {"keywords": ["", "", "", "", ""], "behavioral": ""}, "contradiction": "", "values": {"desires": ["", ""], "fears": ["", ""], "coreValues": ["", ""], "nonNegotiable": [""]}, "backstory": {"events": [{"event": "", "choice": "", "residue": ""}, {"event": "", "choice": "", "residue": ""}]}, "abilities": [{"name": "", "scope": "", "level": "", "limit": "", "cost": "", "usage": ""}, {"name": "", "scope": "", "level": "", "limit": "", "cost": "", "usage": ""}], "habits": {"hobbies": ["", "", ""], "habits": ["", "", ""], "likes": ["", ""], "dislikes": ["", ""]}, "dailyLife": "", "situation": {"worldContext": "", "personalSituation": "", "userEntry": ""}}`;

const VOICE_SKELETON_HEAD = `{"speech": {"register": "", "sentenceLength": "", "tempo": "", "vocabulary": "", "frequentPhrases": ["", ""], "rarePhrases": [""], "profanity": "", "humorStyle": "", "addressStyle": "", "hiddenEmotionStyle": "", "angryStyle": "", "intimateStyle": "", "keywords": ["", "", "", ""], "description": "", "examples": "대사1\\n대사2\\n대사3\\n대사4", "forbidden": ""}, "behaviorRules": ["", "", ""], "greeting": "", "publicProfile": {"tagline": "", "description": "", "tags": ["", "", "", ""]}, "npcs": [], "nsfw": `;

const BONDS_SKELETON_HEAD = `{"userRelationship": {"initialView": "", "userRole": "", "startingPoint": "", "progression": ["", "", ""]}, "otherRelationships": [], "secrets": ["", ""], "rpEngine": {"immediateHook": "", "repeatable": ["", "", ""], "mediumConflict": "", "longTermChange": ""}, "nsfw": `;

/** Shape mirrors the adult QA bands in `validateCharacterBible` (prefs 4-8, boundaries 3-6, scenarios 2-3). */
const ADULT_SECTION_SKELETON = `{"orientation": "", "hookSummary": "", "dialogueProfile": "", "consentModes": [""], "tone": "", "preferenceKeywords": ["", "", "", ""], "boundaries": ["", "", ""], "consentBehavior": "", "scenarioExamples": ["", ""]}`;

/** The manifest's adultCandidate owns the nsfw/adultSection defaults the model is shown. */
function characterVoiceSkeleton(adultCandidate: boolean): string {
  return `${VOICE_SKELETON_HEAD}${adultCandidate}}`;
}

function characterBondsSkeleton(adultCandidate: boolean): string {
  return `${BONDS_SKELETON_HEAD}${adultCandidate}, "adultSection": ${adultCandidate ? ADULT_SECTION_SKELETON : "null"}}`;
}

export type AppearanceInput = {
  name: string;
  age: number;
  gender: string;
  /** Compiled from the bible appearance section (source, not invented). */
  appearanceSource: string;
  /** Sibling identity locks to differentiate from (may be empty for the first). */
  siblingLooks: string[];
};

export function buildAppearanceSystem(): string {
  return [
    "너는 캐릭터 비주얼 아이덴티티 디자이너다. 바이블 외형을 OfficialAppearanceLock으로 옮긴다(창작이 아니라 락).",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다.",
    "",
    "- apparentAgeBand는 early_20s·mid_20s·late_20s·30s·40s·50_plus·ageless_adult 중 구조화된 나이와 모순되지 않는 값.",
    "- heightCm 120~230 정수. identifyingFeatures 1~3개.",
    "- defaultOutfit은 구체적으로, alternateOutfitPolicy는 장면별 변주 규칙.",
    "- forbiddenDrift는 절대 변하면 안 되는 요소 2개 이상.",
    "- 미성년 연상 표현(교복·학생 등) 금지. 특정 작가·작품 화풍 언급 금지.",
    "아래 빈 틀의 모든 값을 채워 JSON 한 개만 출력한다.",
    `{"identity": {"apparentAgeBand": "late_20s", "faceShape": "", "eyes": "", "eyeColor": "", "hair": "", "hairColor": "", "hairLength": "", "heightCm": 0, "build": "", "skinTone": "", "identifyingFeatures": [""]}, "outfit": {"defaultOutfit": "", "alternateOutfitPolicy": ""}, "forbiddenDrift": ["", ""]}`,
  ].join("\n");
}

export function buildAppearanceUser(input: AppearanceInput): string {
  return [
    `캐릭터: ${input.name} (${input.age}세, ${input.gender})`,
    "바이블 외형(source, 이 범위를 벗어나지 않는다):",
    input.appearanceSource,
    buildRofanMatureMaleVisualAgeDirection(input.age, input.gender) ?? "",
    input.siblingLooks.length
      ? `형제 외형(이들과 헤어·눈·체형·팔레트가 겹치지 않게):\n${input.siblingLooks.map((s) => `- ${s}`).join("\n")}`
      : "",
    "지정된 필드 구조의 JSON 한 개만 출력한다.",
  ].join("\n");
}

export type AssetPlanInput = {
  name: string;
  adult: boolean;
  defaultOutfit: string;
  /** Character-specific ranked locations + hooks (`resolveOfficialCharacterSceneContext`). */
  scene: OfficialCharacterSceneContext;
  /** Portfolio-aware avoid list from previously planned siblings (`buildSceneAvoidList`). */
  avoid: { combos: string[]; overusedMotifs: string[]; siblingScenesHere?: string[] };
  /** Previous attempt rejection reasons (QA codes) — must be fixed this time. */
  feedback?: string;
};

export function buildAssetPlanSystem(): string {
  return [
    "너는 롤플레잉 비주얼 에셋 플래너다. 캐릭터의 14슬롯 에셋 플랜을 짠다(이미지 생성 아님).",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다.",
    "",
    "슬롯 구성(정확히): representative 1 + signature 4 + emotion 6 + scene 3 = 14.",
    "- representative: 2:3 카드 초상 태그. 다른 슬롯과 태그가 겹치면 안 된다.",
    "- signature 4: 캐릭터 핵심 분위기. emotion 6: 캐릭터 맞춤형 감정(중복 허용).",
    "- 카메라/거리/얼굴 방향은 생성 단계의 고정 shot table이 담당한다. 플랜은 표정·포즈·상황을 슬롯마다 다르게 써서 bust 연속·같은 정면 상반신을 반복하지 않는다.",
    "- scene 3: 캐릭터+장면. location+situation 필수, 서로 다른 장소. 장면 자체가 RP 훅이어야 한다.",
    "  scene은 초상화 대용이 아니다. 장소와 사건이 한눈에 읽히게 쓰고, 상반신 정면 초상처럼 쓰지 않는다.",
    "  단순 침실/거리/정원 금지 — 이 캐릭터의 직업·소속·RP 훅·과거와 의미 있게 연결된 장소를 고른다.",
    "  scene1: PRIMARY 장소(또는 그 안의 캐릭터 고유 공간) + 첫 대화 훅이나 반복 일상에서 나온 사건.",
    "  scene2: PRIMARY 또는 SECONDARY 장소 + 중기 갈등에서 나온 사건(scene1과 다른 사건 유형).",
    "  scene3: 캐릭터 고유 장소(일상·과거에서 나온 구체적 공간) 또는 장기 변화와 직결될 때만 EXCEPTIONAL 장소.",
    "  세 장면은 사건·관계 설정·걸린 것·행동 선택이 서로 달라야 한다. 직업상 늘 하는 일(예: 기도, 거래)은 배경일 뿐,",
    "  세 장면이 모두 같은 종류의 사건(예: 셋 다 의식 중 발작)이 되어서는 안 된다.",
    "  '피해야 할 조합'에 있는 장소×사건 조합과 과다 사용 사건은 쓰지 않는다. 다른 캐릭터와 같은 장면을 만들지 않는다.",
    "- 모든 슬롯 characterPresence=required. 배경만(background-only) 금지.",
    "- imageSubjects는 모든 슬롯 필수. 누락하거나 잘못된 값은 반려된다.",
    "- imageSubjects.foreground는 슬롯이 혼자인지(solo_character) 전경 상호작용 상대가 필요한지(character_plus_required_partner) 명시한다. pose 문장에서 추정하지 말고 필드로 선언한다.",
    "- character_plus_required_partner면 partnerRole=user를 함께 선언한다. solo_character에는 partnerRole을 넣지 않는다.",
    "- 현재 지원되는 전경 상대는 외형이 정의되지 않은 RP user뿐이다. user는 Pose가 필요로 하는 최소 identity-neutral cropped body fragment만 보인다.",
    "- imageSubjects.backgroundExtras는 none 또는 optional_unnamed. 전경 상대와 군중 엑스트라는 다르다.",
    "- representative는 depiction=standard 고정. 성인 시트가 아니면 전 슬롯 standard.",
    `- personTag는 다음 목록 중 감정과 정확히 일치할 때만 쓰고, 아니면 null(목록 외 표현 절대 금지): ${ASSET_PERSON_TAGS.join(", ")}.`,
    "- slotKey는 rep/sig1..4/emo1..6/scene1..3 고정.",
    `- tag는 ${CREATOR_ASSET_TAG_MAX}자 이내의 짧은 의미 태그(대괄호·줄바꿈 금지). 긴 설명은 expression/situation에 쓴다.`,
  ].join("\n");
}

export function buildAssetPlanUser(input: AssetPlanInput): string {
  const s = input.scene;
  const tier = (t: "primary" | "secondary" | "exceptional") =>
    s.ranked
      .filter((r) => r.tier === t)
      .map((r) => `- ${r.name}: ${r.rpEvents}${r.why.length ? ` (연결: ${r.why.join("·")})` : ""}`)
      .join("\n") || "- (없음)";
  return [
    `캐릭터: ${input.name} (성인 시트: ${input.adult ? "예" : "아니오"})`,
    `직업/소속/신분: ${s.occupation} / ${s.faction} / ${s.socialPosition}`,
    `기본 의상: ${input.defaultOutfit}`,
    "",
    `PRIMARY 장소:\n${tier("primary")}`,
    `SECONDARY 장소:\n${tier("secondary")}`,
    `EXCEPTIONAL 장소(특수 사건에서만):\n${tier("exceptional")}`,
    "",
    "캐릭터 고유 재료:",
    `- 첫 대화 훅: ${s.hooks.immediateHook}`,
    `- 반복 일상: ${s.hooks.repeatable.join(" / ")}`,
    `- 중기 갈등: ${s.hooks.mediumConflict}`,
    `- 장기 변화: ${s.hooks.longTermChange}`,
    `- 현재 상황: ${s.hooks.personalSituation}`,
    `- 과거가 남긴 것: ${s.hooks.backstoryResidue.join(" / ")}`,
    `- 유저 첫인식: ${s.hooks.userInitialView}`,
    s.hooks.relationshipCues.length ? `- 관계 단서: ${s.hooks.relationshipCues.join(" / ")}` : "",
    "",
    input.avoid.combos.length
      ? `피해야 할 조합(이미 다른 캐릭터가 사용):\n${input.avoid.combos.map((c) => `- ${c}`).join("\n")}`
      : "",
    input.avoid.overusedMotifs.length ? `과다 사용 사건(쓰지 않는다): ${input.avoid.overusedMotifs.join(", ")}` : "",
    input.avoid.siblingScenesHere?.length
      ? `같은 장소에 이미 있는 다른 캐릭터 장면(같은 장소를 쓰려면 사건·목적·관계를 완전히 다르게, 아니면 캐릭터 고유 공간을 쓴다):\n${input.avoid.siblingScenesHere.map((s) => `- ${s}`).join("\n")}`
      : "",
    "",
    "슬롯 고정표(정확히 이 14슬롯, 키·종류 그대로):",
    "rep/representative, sig1/signature, sig2/signature, sig3/signature, sig4/signature,",
    "emo1/emotion, emo2/emotion, emo3/emotion, emo4/emotion, emo5/emotion, emo6/emotion,",
    "scene1/scene, scene2/scene, scene3/scene.",
    "슬롯 예시(모든 키를 채운다):",
    `{"slotKey": "sig1", "kind": "signature", "tag": "태그", "expression": "표정", "pose": "자세", "outfit": "default", "location": null, "situation": null, "characterPresence": "required", "imageSubjects": {"foreground": "solo_character", "backgroundExtras": "none"}, "depiction": "standard", "personTag": null}`,
    "위 구조의 slots 배열 JSON 한 개만 출력한다.",
    input.feedback?.trim() ? `이전 시도 반려 사유(반드시 수정):\n${input.feedback.trim()}` : "",
  ].join("\n");
}

/**
 * Pilot-scoped adult direction for one character (manifest config, not a
 * global ratio). Profile/consent values are canonical enums.
 */
export type AdultProfilePlan = {
  dialogueProfile: "suggestive" | "explicit_rare" | "explicit_frequent";
  consentModes: ("standard" | "power_play")[];
  /** Character-fit adult dynamics in plain words (e.g. "협상된 권력 교환, 명령과 칭찬"). */
  direction: string;
};

export type AdultProfileInput = {
  name: string;
  age: number;
  participantMinAge: number;
  orientation: string;
  /** Personality / contradiction / relationship recap so adult canon stays in character. */
  characterRecap: string;
  plan: AdultProfilePlan;
  /** Adult dynamics other adult sheets in this world already lean on (avoid repeating). */
  siblingDynamics: string[];
  feedback?: string;
};

export function buildAdultProfileSystem(): string {
  return [
    "너는 성인 롤플레잉 캐릭터의 성인 관계 캐논만 쓰는 작가다. 캐릭터 본체는 이미 완성되어 있고, adultSection만 다시 쓴다.",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다.",
    "",
    "불변 규칙(절대 변경 금지):",
    "- 모든 참여자는 19세 이상. 나이·participantMinAge를 바꾸지 않는다. 미성년 연상 표현 금지.",
    "- 합의가 기본값이다. 비합의를 기본 전제로 삼지 않으며 cnc 계열을 쓰지 않는다.",
    "- power_play가 있으면 사전 합의·중단 신호·사후 확인을 반드시 서술한다.",
    "- 노골적 행위 묘사 금지. 성격·말투·관계 역학·합의 방식이 성인 맥락에서도 유지되는지를 쓴다.",
    "- 캐릭터 고유의 성향으로 쓴다. 다른 성인 캐릭터가 이미 쓰는 역학은 반복하지 않는다.",
    "",
    "필드:",
    "- orientation(기존 값 유지)·hookSummary(성인 관계 캐논 요약 1~2문장).",
    "- dialogueProfile·consentModes는 지정값 그대로.",
    "- tone 200~300자·preferenceKeywords 4~8개(캐릭터 고유 역학)·boundaries 3~6개(캐릭터 성격과 연결)·",
    "  consentBehavior 200~300자(의사 확인·거절 반응·속도·권력관계 처리)·scenarioExamples 2~3개(짧고 행동 중심).",
  ].join("\n");
}

export function buildAdultProfileUser(input: AdultProfileInput): string {
  return [
    `캐릭터: ${input.name} (${input.age}세, participantMinAge ${input.participantMinAge})`,
    `orientation(유지): ${input.orientation}`,
    `지정 dialogueProfile: ${input.plan.dialogueProfile}`,
    `지정 consentModes: ${input.plan.consentModes.join(", ")}`,
    `성향 방향(캐릭터 적합성 기준): ${input.plan.direction}`,
    input.siblingDynamics.length ? `다른 성인 캐릭터가 쓰는 역학(반복 금지): ${input.siblingDynamics.join(" / ")}` : "",
    "",
    "캐릭터 요약:",
    input.characterRecap,
    "",
    "아래 빈 틀의 모든 값을 채워 JSON 한 개만 출력한다.",
    `{"adultSection": {"orientation": "", "hookSummary": "", "dialogueProfile": "${input.plan.dialogueProfile}", "consentModes": ${JSON.stringify(input.plan.consentModes)}, "tone": "", "preferenceKeywords": ["", "", "", ""], "boundaries": ["", "", ""], "consentBehavior": "", "scenarioExamples": ["", ""]}}`,
    input.feedback?.trim() ? `이전 시도 반려 사유(반드시 수정):\n${input.feedback.trim()}` : "",
  ].join("\n");
}

export type StyleBoardInput = {
  genre: string;
  /** Canonical style key (e.g. romance_fantasy_v1) — from manifest/config, never hardcoded. */
  styleKey: string;
  /** Only these URLs may appear as references (public trend observations). */
  allowedReferenceUrls: string[];
  candidateCount: number;
};

export function buildStyleBoardSystem(): string {
  return [
    "너는 로맨스 판타지 비주얼 디렉터다. 장르 그림체 후보 보드를 만든다(이미지 생성 아님).",
    "출력은 반드시 순수 JSON 한 개(코드펜스·설명 금지)다.",
    "",
    "- 후보마다 추상 Visual Style DNA(얼굴 비례·눈매·선 밀도·렌더링·팔레트·광원·분위기 등)만 기술.",
    "- 특정 작가 이름·작품명을 스타일 타깃으로 쓰지 않는다.",
    "",
    "[DOMESTIC ROFAN PRODUCT DIRECTION]",
    DOMESTIC_ROFAN_STYLE_DIRECTION,
    "- references는 허용된 공개 URL만, provenance는 external_public_observation 고정(이미지 생성용 전달 금지).",
    "- suitability 10개 항목은 1~5 정수. strengths 2~4개.",
    "- 남성·여성·로맨스·긴장·실내·의상 변주·감정폭을 서로 다르게 평가한다(전 항목 5점 금지).",
    "후보 스켈레톤(모든 키를 채운다):",
    `{"candidateId": "", "label": "", "dna": {"faceProportion": "", "eyeShape": "", "noseMouthDetail": "", "lineDensity": "", "rendering": "", "skinRendering": "", "hairRendering": "", "bodyProportion": "", "costumeComplexity": "", "palette": "", "lightSoftness": "", "contrast": "", "backgroundDensity": "", "framing": "", "atmosphere": ""}, "suitability": {"card": 0, "rpLandscape": 0, "maleCharacters": 0, "femaleCharacters": 0, "backgroundScene": 0, "romanticScene": 0, "tenseRelationshipScene": 0, "indoorBedroomScene": 0, "outfitVariation": 0, "emotionRange": 0, "identityConsistencyDifficulty": ""}, "strengths": ["", ""], "references": [{"url": "", "provenance": "external_public_observation", "note": ""}]}`,
  ].join("\n");
}

export function buildStyleBoardUser(input: StyleBoardInput): string {
  return [
    `장르: ${input.genre}`,
    `후보 수: ${input.candidateCount} (정확히)`,
    "허용된 reference URL(이 목록에서만 선택):",
    ...input.allowedReferenceUrls.map((u) => `- ${u}`),
    "지정된 필드 구조의 JSON 한 개만 출력한다.",
  ].join("\n");
}
