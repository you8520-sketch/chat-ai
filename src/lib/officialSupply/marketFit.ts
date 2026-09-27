/**
 * Official-supply market fit owner.
 *
 * One path from the committed research snapshot to portfolio planning:
 *   snapshot signals → `selectMarketSignals` (locale-first, IP-eligible only)
 *   → world/portfolio prompts → per-character `OfficialMarketFitBrief`
 *   → Portfolio Brief → Character Bible.
 *
 * Locale/priority come from the batch manifest (`OfficialBatchMarketPolicy`),
 * never from a global runtime constant. Everything here is deterministic —
 * no LLM judge, no scores: review rows carry observable facts for a human.
 */
import type { OfficialCharacterBible, OfficialWorldBible } from "@/lib/officialSupply/bible";
import type { ResearchSignal, ResearchSnapshot } from "@/lib/officialSupply/research";
import { sceneTokens } from "@/lib/officialSupply/scenePortfolio";
import { qaResult, type QaIssue, type QaResult } from "@/lib/officialSupply/types";

// ── Batch policy ─────────────────────────────────────────────────────────────

export type OfficialMarketPriority = "domestic_first" | "global_first";
export type MarketRole = "proven" | "proven_twist" | "experimental";

/** Batch/pilot product policy. Supplied by each manifest; other locales add their own. */
export type OfficialBatchMarketPolicy = {
  targetLocale: string;
  /** Snapshot region treated as PRIMARY source for this batch. */
  signalRegion: ResearchSignal["region"];
  marketPriority: OfficialMarketPriority;
  /** Cap on other-region signals kept as supporting context. */
  maxSupportingSignals: number;
  /** Pilot planning mix (per batch, not a product constant). */
  marketRoleMix: Record<MarketRole, { min: number; max: number }>;
  /** Max characters sharing one primary relationship trope. */
  maxPrimaryTropeRepeat: number;
  coreTags: { min: number; max: number };
  /** World proper nouns tolerated in a tagline before it needs a lore primer. */
  maxTaglineWorldTerms: number;
};

// ── Signal selection (REQUIRED CLEANUP: replaces hand-written inspiration lists) ─

export type MarketSignalDigest = {
  signalId: string;
  tier: "primary" | "supporting";
  region: ResearchSignal["region"];
  genre: string;
  relationshipTrope: string | null;
  archetype: string | null;
  worldMechanic: string | null;
  scenarioHook: string;
  popularitySignal: ResearchSignal["popularitySignal"];
  adultDemand: boolean;
};

export type MarketSignalSelection = {
  primary: MarketSignalDigest[];
  supporting: MarketSignalDigest[];
  /** IP/derivative rows: kept for popularity analysis, never generation input. */
  excluded: { signalId: string; reason: string }[];
};

const POPULARITY_RANK: Record<ResearchSignal["popularitySignal"], number> = { top: 0, mid: 1, niche: 2 };

function digest(signal: ResearchSignal, tier: MarketSignalDigest["tier"]): MarketSignalDigest {
  return {
    signalId: signal.signalId,
    tier,
    region: signal.region,
    genre: signal.genre,
    relationshipTrope: signal.relationshipTrope,
    archetype: signal.archetype,
    worldMechanic: signal.worldMechanic,
    scenarioHook: signal.scenarioHook,
    popularitySignal: signal.popularitySignal,
    adultDemand: signal.adultDemand,
  };
}

/** Same-genre first, then by popularity; stable within ties. */
function rankSignals(signals: ResearchSignal[], genre: string): ResearchSignal[] {
  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => {
      const g = Number(b.signal.genre === genre) - Number(a.signal.genre === genre);
      if (g !== 0) return g;
      const p = POPULARITY_RANK[a.signal.popularitySignal] - POPULARITY_RANK[b.signal.popularitySignal];
      return p !== 0 ? p : a.index - b.index;
    })
    .map((x) => x.signal);
}

export function selectMarketSignals(
  snapshot: ResearchSnapshot,
  policy: OfficialBatchMarketPolicy,
  genre: string
): MarketSignalSelection {
  const excluded = snapshot.signals
    .filter((s) => !s.originalityEligible)
    .map((s) => ({ signalId: s.signalId, reason: s.ipExclusionReason ?? "ip_excluded" }));
  const eligible = snapshot.signals.filter((s) => s.originalityEligible);
  const local = eligible.filter((s) => s.region === policy.signalRegion);
  const other = eligible.filter((s) => s.region !== policy.signalRegion);
  const [primarySet, supportingSet] = policy.marketPriority === "domestic_first" ? [local, other] : [other, local];
  return {
    primary: rankSignals(primarySet, genre).map((s) => digest(s, "primary")),
    supporting: rankSignals(supportingSet, genre)
      .slice(0, policy.maxSupportingSignals)
      .map((s) => digest(s, "supporting")),
    excluded,
  };
}

/** Trope-level prompt lines (signalId-tagged so briefs can cite them). */
export function formatMarketSignalLines(selection: MarketSignalSelection): string[] {
  const line = (s: MarketSignalDigest) =>
    [
      `[${s.signalId}]`,
      s.genre,
      s.relationshipTrope ? `트로프 ${s.relationshipTrope}` : "",
      s.archetype ? `원형 ${s.archetype}` : "",
      s.worldMechanic ? `장치 ${s.worldMechanic}` : "",
      `훅 구조 "${s.scenarioHook}"`,
      `(${s.popularitySignal}${s.adultDemand ? ", 성인 수요" : ""})`,
    ]
      .filter(Boolean)
      .join(" · ");
  return [
    "PRIMARY(대상 시장 신호, 우선 사용):",
    ...selection.primary.map((s) => `- ${line(s)}`),
    selection.supporting.length ? "SUPPORTING(보조 참고, 대상 시장 신호와 충돌하면 버린다):" : "",
    ...selection.supporting.map((s) => `- ${line(s)}`),
  ].filter(Boolean);
}

// ── Domestic trope lexicon ──────────────────────────────────────────────────

type TropeKind = "relationship" | "archetype" | "setting";

/** Korean character-chat trope vocabulary (label = discovery wording). */
export const DOMESTIC_TROPES = {
  enemies: { label: "혐관", kind: "relationship", re: /(혐관|혐오|적대|앙숙|원수|애증)/ },
  pure_love: { label: "순애", kind: "relationship", re: /(순애|일편단심|첫사랑)/ },
  obsession: { label: "집착", kind: "relationship", re: /(집착|맹목)/ },
  possessive: { label: "소유욕", kind: "relationship", re: /(소유욕|독점욕)/ },
  regret: { label: "후회", kind: "relationship", re: /(후회|참회)/ },
  salvation: { label: "구원", kind: "relationship", re: /(구원|속죄|치유)/ },
  crush: { label: "짝사랑", kind: "relationship", re: /(짝사랑|외사랑)/ },
  reunion: { label: "재회", kind: "relationship", re: /(재회|다시\s*만난)/ },
  contract: { label: "계약·정략", kind: "relationship", re: /(계약|정략|혼약|약혼|거래)/ },
  exclusive: { label: "전담", kind: "relationship", re: /(전담|전속|각인)/ },
  status_gap: { label: "신분차", kind: "relationship", re: /(신분\s*차|신분을\s*넘)/ },
  master_servant: { label: "주종", kind: "relationship", re: /(주종|지배|굴복|종속|길들)/ },
  rival: { label: "라이벌", kind: "relationship", re: /(라이벌|맞수|경쟁자)/ },
  forbidden: { label: "금단", kind: "relationship", re: /(금단|배덕|신성모독|금지된\s*사랑)/ },
  accomplice: { label: "공범", kind: "relationship", re: /(공범|공모자|비밀\s*공유)/ },
  mentor: { label: "사제", kind: "relationship", re: /(스승|제자|사제\s*관계)/ },
  chase: { label: "추적·도주", kind: "relationship", re: /(추적자|도망자|용의자)/ },
  protector: { label: "보호자", kind: "relationship", re: /(보호자|호위|수호자)/ },
  friends_to_lovers: { label: "친구에서 연인", kind: "relationship", re: /(친구에서\s*연인|소꿉친구|오랜\s*친구)/ },
  playful: { label: "능글", kind: "archetype", re: /(능글|유쾌한\s*가면|장난스러)/ },
  prickly: { label: "까칠", kind: "archetype", re: /(까칠|츤데레|도도)/ },
  blunt: { label: "무뚝뚝", kind: "archetype", re: /(무뚝뚝|철벽|과묵)/ },
  doomed: { label: "시한부", kind: "archetype", re: /(시한부|죽어가|병약)/ },
  sentinel: { label: "센티넬·가이드", kind: "setting", re: /(센티넬|가이딩|가이드버스)/ },
  omegaverse: { label: "오메가버스", kind: "setting", re: /(오메가버스|히트|러트)/ },
  beastfolk: { label: "수인", kind: "setting", re: /(수인)/ },
  nonhuman: { label: "인외", kind: "setting", re: /(인외|인형|기계|괴물|뱀파이어|정령|안드로이드|골렘)/ },
  apocalypse: { label: "아포칼립스", kind: "setting", re: /(아포칼립스|좀비|종말)/ },
  academy: { label: "학원", kind: "setting", re: /(학원|아카데미)/ },
  office: { label: "직장", kind: "setting", re: /(직장|사내\s*연애|회사|팀장)/ },
  idol: { label: "아이돌", kind: "setting", re: /(아이돌|연예계)/ },
  sports: { label: "스포츠", kind: "setting", re: /(스포츠|국가대표)/ },
  regression: { label: "회귀·빙의", kind: "setting", re: /(회귀|빙의|환생)/ },
  northern_duke: { label: "북부대공", kind: "archetype", re: /(북부\s*대공|대공)/ },
  royalty: { label: "황족", kind: "archetype", re: /(황태자|황자|황녀|황족|왕자|공주)/ },
  knight: { label: "기사", kind: "archetype", re: /(기사단|기사|근위)/ },
} as const satisfies Record<string, { label: string; kind: TropeKind; re: RegExp }>;

export type DomesticTrope = keyof typeof DOMESTIC_TROPES;

/** Tropes in order of first appearance in the text. */
export function detectDomesticTropes(text: string): DomesticTrope[] {
  return (Object.keys(DOMESTIC_TROPES) as DomesticTrope[])
    .map((key) => ({ key, at: text.search(DOMESTIC_TROPES[key].re) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.key);
}

/** Canonical primary trope: first relationship trope, else first match, else the normalized text. */
export function canonicalPrimaryTrope(text: string): string {
  const found = detectDomesticTropes(text);
  const relationship = found.find((key) => DOMESTIC_TROPES[key].kind === "relationship");
  const key = relationship ?? found[0];
  return key ? DOMESTIC_TROPES[key].label : text.replace(/\s+/g, " ").trim();
}

// ── Relationship-first hook ─────────────────────────────────────────────────

const USER_CUE_RE = /(당신|그대|너[는를의와에가]|너에게|네가|유저)/;
const USER_ROLE_RE =
  /(목격자|약혼자|정혼자|계약자|계약|거래|파트너|전담|호위|주인|주군|스승|제자|상사|부하|동료|공범|포로|인질|라이벌|남편|아내|연인|구원자|보호자|후견인|의뢰인|고용주|용의자|실험체|짝|가이드|센티넬)/;

/** True when the text tells the reader who the character is to *them* or what binds the two. */
export function hasUserRelationshipCue(text: string): boolean {
  return USER_CUE_RE.test(text) || USER_ROLE_RE.test(text);
}

/** World proper nouns a first-time reader would need a primer for. */
export function collectWorldProperTerms(world: Pick<OfficialWorldBible, "name" | "factions" | "locations" | "lorebook">): string[] {
  const terms = new Set<string>();
  const add = (value: string) => {
    for (const piece of value.split(/[\s()·,/]+/)) {
      const t = piece.trim();
      if (t.length >= 3 && /^[가-힣A-Za-z]+$/.test(t)) terms.add(t);
    }
  };
  add(world.name);
  for (const f of world.factions) add(f.name);
  for (const l of world.locations) add(l.name.split(/\s/)[0] ?? "");
  for (const e of world.lorebook) add(e.name);
  return [...terms];
}

export function worldTermsIn(text: string, terms: readonly string[]): string[] {
  return terms.filter((t) => text.includes(t));
}

export function evaluatePublicHook(
  input: { tagline: string; description: string; worldTerms: readonly string[] },
  policy: Pick<OfficialBatchMarketPolicy, "maxTaglineWorldTerms">
): QaResult {
  const warnings: QaIssue[] = [];
  if (!hasUserRelationshipCue(`${input.tagline} ${input.description}`)) {
    warnings.push({ code: "hook_no_user_relationship", message: "public hook never says who the character is to the user" });
  } else if (!hasUserRelationshipCue(input.tagline)) {
    warnings.push({ code: "tagline_relationship_unclear", message: `tagline "${input.tagline}" carries mood only, no user relationship/conflict` });
  }
  const jargon = worldTermsIn(input.tagline, input.worldTerms);
  if (jargon.length > policy.maxTaglineWorldTerms) {
    warnings.push({ code: "tagline_world_jargon", message: `tagline needs world lore to parse: ${jargon.join(", ")}` });
  }
  return qaResult([], warnings);
}

// ── Discovery tags ──────────────────────────────────────────────────────────

const GENRE_TAG_WORDS = new Set(["로맨스", "로판", "판타지", "궁정극", "궁정", "군사", "미스터리", "스릴러", "성인"]);
/** Too generic to ground a tag on their own ("잔잔한 관계" must be grounded by 잔잔). */
const TAG_FILLER_WORDS = new Set(["관계", "이야기", "감정", "사람", "분위기", "느낌"]);
const ADJECTIVE_SUFFIX_RE = /(스러운|스럽게|하게|하는|하다|적인|한|히|적)$/;

/** Tag/bible word stems: particles and adjective endings stripped, stopwords kept. */
export function tagStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of sceneTokens(text, { keepStopwords: true })) {
    out.add(token);
    const stem = token.length > 2 ? token.replace(ADJECTIVE_SUFFIX_RE, "") : token;
    if (stem.length >= 2) out.add(stem);
  }
  return out;
}

function tokenMatches(token: string, pool: Set<string>): boolean {
  for (const p of pool) {
    if (p === token || (token.length >= 2 && p.length >= 2 && (p.startsWith(token) || token.startsWith(p)))) return true;
  }
  return false;
}

/** Tag grounded in the bible text, a matching domestic trope, or genre vocabulary. */
export function isTagGrounded(tag: string, bibleStems: Set<string>, bibleText: string): boolean {
  const tokens = [...tagStems(tag)].filter((t) => !TAG_FILLER_WORDS.has(t));
  if (tokens.length === 0) return false;
  const tropes = detectDomesticTropes(tag);
  if (tropes.length > 0 && tropes.every((key) => DOMESTIC_TROPES[key].re.test(bibleText))) return true;
  return tokens.some((t) => GENRE_TAG_WORDS.has(t) || tokenMatches(t, bibleStems));
}

export function bibleSearchText(bible: OfficialCharacterBible): string {
  return JSON.stringify({ ...bible, publicProfile: undefined });
}

export const DISCOVERY_TAG_HARD_MAX = 9;

export function evaluateDiscoveryTags(
  input: { tags: readonly string[]; bible: OfficialCharacterBible },
  policy: Pick<OfficialBatchMarketPolicy, "coreTags">
): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const text = bibleSearchText(input.bible);
  const tokens = tagStems(text);
  const n = input.tags.length;
  if (n > DISCOVERY_TAG_HARD_MAX) {
    errors.push({ code: "tags_keyword_stuffing", message: `${n} tags > ${DISCOVERY_TAG_HARD_MAX}` });
  } else if (n < policy.coreTags.min || n > policy.coreTags.max) {
    warnings.push({ code: "tags_core_count", message: `${n} tags outside ${policy.coreTags.min}-${policy.coreTags.max}` });
  }
  for (const tag of input.tags) {
    if (!isTagGrounded(tag, tokens, text)) {
      errors.push({ code: "tag_bible_mismatch", message: `tag "${tag}" is not supported by the Character Bible` });
    }
  }
  return qaResult(errors, warnings);
}

// ── Korean naming policy ────────────────────────────────────────────────────

export type NamingProfileKey =
  | "korean_modern"
  | "korean_codename"
  | "western_rofan"
  | "eastern_historical"
  | "nonhuman_designation";

export const NAMING_PROFILES: Record<NamingProfileKey, { label: string; guidance: string }> = {
  korean_modern: {
    label: "현대·일상·학원·직장·연예계",
    guidance: "한국 성씨 + 2음절 이름 중심의 실제 한국식 성명. 한눈에 읽히고 기억되게, 작위적 조어 금지.",
  },
  korean_codename: {
    label: "현대 판타지·헌터·센티넬·아포칼립스",
    guidance: "한국 배경이면 한국 실명이 기본. 코드네임이 필요하면 '실명 + 별도 코드네임'으로, 실명을 지우지 않는다.",
  },
  western_rofan: {
    label: "로맨스 판타지·서양 판타지",
    guidance: "한국 여성향 독자가 바로 읽는 짧은 서양풍 이름(이름 2~4음절). 필요하면 가문명·작위를 덧붙인다. 전원 길고 비슷한 라틴풍 조어 금지.",
  },
  eastern_historical: {
    label: "동양풍·무협",
    guidance: "세계관 문화권에 맞는 한자 기반 이름. 현대 한국 이름과 중국풍/가상 동양풍을 무작위로 섞지 않는다.",
  },
  nonhuman_designation: {
    label: "인외·기계·괴물",
    guidance: "짧고 강한 고유명 또는 형식 번호 허용. 단 캐스트 전체가 기호·번호 이름이 되지 않게 한다.",
  },
};

export function resolveNamingProfile(genre: string, opts: { nonHuman?: boolean } = {}): NamingProfileKey {
  if (opts.nonHuman) return "nonhuman_designation";
  switch (genre) {
    case "로맨스 판타지":
    case "판타지":
      return "western_rofan";
    case "무협":
    case "동양풍":
      return "eastern_historical";
    case "현대 판타지":
    case "센티넬버스":
    case "아포칼립스":
      return "korean_codename";
    case "인외":
      return "nonhuman_designation";
    default:
      return "korean_modern";
  }
}

const KOREAN_SURNAMES_2 = ["남궁", "황보", "제갈", "선우", "독고", "사공", "서문"];
const KOREAN_SURNAMES_1 = new Set(
  "김이박최정강조윤장임한오서신권황안송전홍유고문양손배백허남심노하곽성차주우구민류나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부가복태목형피두감음빈동온호범좌팽승간상시갈단견당".split("")
);
const KOREAN_COMMON_SURNAMES = new Set("김이박최정강조윤장임한오서신권황안송류홍".split(""));
const WESTERN_CONNECTORS = new Set(["폰", "반", "드", "델", "디", "데", "오브", "라", "르", "뒤"]);
const DESIGNATION_RE = /(\d|[0-9]+호$|호$|^[A-Z0-9-]+$)/;

export type ParsedCharacterName = {
  raw: string;
  kind: "korean" | "western" | "designation" | "other";
  givenName: string;
  familyName: string | null;
  codename: string | null;
  givenSyllables: number;
};

const hangulCount = (s: string) => (s.match(/[가-힣]/g) ?? []).length;

export function parseCharacterName(raw: string): ParsedCharacterName {
  const codenameMatch = raw.match(/[("'“‘](?:코드네임|코드명)?\s*([^)"'”’]+)[)"'”’]/);
  const codename = codenameMatch?.[1]?.trim() ?? null;
  const base = raw.replace(/[("'“‘][^)"'”’]*[)"'”’]/g, "").trim();
  const tokens = base.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && /^[가-힣]{2,4}$/.test(tokens[0]!)) {
    const t = tokens[0]!;
    const two = KOREAN_SURNAMES_2.find((s) => t.startsWith(s) && t.length > 2);
    // Two-syllable tokens (노아, 리암) are usually foreign given names; only the most common surnames count.
    const oneSurname = t.length === 2 ? KOREAN_COMMON_SURNAMES.has(t[0]!) : KOREAN_SURNAMES_1.has(t[0]!);
    const surname = two ?? (oneSurname ? t[0]! : null);
    if (surname) {
      const given = t.slice(surname.length);
      return { raw, kind: "korean", givenName: given, familyName: surname, codename, givenSyllables: hangulCount(given) };
    }
  }
  if (tokens.some((t) => DESIGNATION_RE.test(t))) {
    const given = tokens.find((t) => !DESIGNATION_RE.test(t)) ?? tokens[0] ?? base;
    return { raw, kind: "designation", givenName: given, familyName: null, codename, givenSyllables: hangulCount(given) };
  }
  if (tokens.length >= 1 && tokens.every((t) => /^[가-힣]+$/.test(t))) {
    const given = tokens[0]!;
    const rest = tokens.slice(1).filter((t) => !WESTERN_CONNECTORS.has(t));
    const family = rest.length ? rest[rest.length - 1]! : null;
    return { raw, kind: "western", givenName: given, familyName: family, codename, givenSyllables: hangulCount(given) };
  }
  return { raw, kind: "other", givenName: tokens[0] ?? base, familyName: null, codename, givenSyllables: hangulCount(tokens[0] ?? base) };
}

export type NamePortfolioEntry = {
  draftKey: string;
  name: string;
  namingProfile: NamingProfileKey;
  /** Names of cast members this character is declared kin/house with. */
  kinNames?: string[];
};

export type ObservedMarketName = { name: string; hook: string };

export const NAME_QA_THRESHOLDS = {
  westernGivenMaxSyllables: 4,
  longCoinageSyllables: 5,
  prefixClusterError: 3,
  suffixClusterWarn: 3,
  syllableShareWarn: 0.4,
  syllableShareError: 0.6,
  surnameRepeatError: 3,
  designationShareWarn: 0.5,
  observedHookJaccard: 0.5,
} as const;

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Edit distance between two short Hangul strings (syllable level). */
function syllableDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

/**
 * Deterministic name QA: locale/genre fit, pronounceable length, sibling
 * distance (재현/재혁/재하/재윤 clusters), surname repeats without declared
 * kinship, and exact collision with observed market characters.
 */
export function evaluateNamePortfolio(
  entries: readonly NamePortfolioEntry[],
  opts: { observed?: readonly ObservedMarketName[]; hooks?: Record<string, string> } = {}
): QaResult & { parsed: Record<string, ParsedCharacterName> } {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const t = NAME_QA_THRESHOLDS;
  const parsed: Record<string, ParsedCharacterName> = {};
  for (const e of entries) parsed[e.draftKey] = parseCharacterName(e.name);
  const list = entries.map((e) => ({ e, p: parsed[e.draftKey]! }));
  const n = list.length;

  for (const { e, p } of list) {
    switch (e.namingProfile) {
      case "korean_modern":
        if (p.kind !== "korean") warnings.push({ code: "name_locale_mismatch", message: `${e.name}: not a Korean full name` });
        break;
      case "korean_codename":
        if (p.kind !== "korean") warnings.push({ code: "name_real_name_missing", message: `${e.name}: Korean real name missing (codename may be added, not substituted)` });
        break;
      case "western_rofan":
        if (p.kind === "korean") warnings.push({ code: "name_locale_mismatch", message: `${e.name}: Korean name in a western rofan cast` });
        if (p.givenSyllables > t.westernGivenMaxSyllables) {
          warnings.push({ code: "name_given_too_long", message: `${e.name}: given name ${p.givenSyllables} syllables > ${t.westernGivenMaxSyllables}` });
        }
        break;
      case "eastern_historical":
        if (p.kind === "western") warnings.push({ code: "name_locale_mismatch", message: `${e.name}: western form in an eastern setting` });
        break;
      case "nonhuman_designation":
        break;
      default: {
        const exhaustive: never = e.namingProfile;
        throw new Error(`Unknown naming profile ${String(exhaustive)}`);
      }
    }
  }

  const modern = list.filter(({ e }) => e.namingProfile === "korean_modern" || e.namingProfile === "korean_codename");
  if (modern.length >= 3 && modern.every(({ p }) => p.kind !== "korean")) {
    errors.push({ code: "name_portfolio_all_foreign", message: `all ${modern.length} Korean-setting characters have foreign names` });
  }
  const western = list.filter(({ e }) => e.namingProfile === "western_rofan");
  const long = western.filter(({ p }) => p.givenSyllables >= t.longCoinageSyllables);
  if (western.length >= 3 && long.length === western.length) {
    errors.push({ code: "name_portfolio_long_coinage", message: `every rofan given name is ${t.longCoinageSyllables}+ syllables` });
  } else if (western.length >= 3 && long.length * 2 > western.length) {
    warnings.push({ code: "name_portfolio_long_coinage", message: `${long.length}/${western.length} rofan given names are ${t.longCoinageSyllables}+ syllables` });
  }
  const designations = list.filter(({ p }) => p.kind === "designation");
  if (n >= 3 && designations.length / n > t.designationShareWarn) {
    warnings.push({ code: "name_portfolio_designation_heavy", message: `${designations.length}/${n} names are designations` });
  }

  // Sibling distance on given names.
  const givens = list.map(({ e, p }) => ({ key: e.draftKey, name: e.name, given: p.givenName.replace(/[^가-힣]/g, "") })).filter((g) => g.given);
  const byFirst = new Map<string, string[]>();
  const byLast = new Map<string, string[]>();
  for (const g of givens) {
    byFirst.set(g.given[0]!, [...(byFirst.get(g.given[0]!) ?? []), g.name]);
    byLast.set(g.given[g.given.length - 1]!, [...(byLast.get(g.given[g.given.length - 1]!) ?? []), g.name]);
  }
  for (const [syllable, names] of byFirst) {
    if (names.length >= t.prefixClusterError) {
      errors.push({ code: "name_prefix_cluster", message: `${names.length} given names start with '${syllable}': ${names.join(", ")}` });
    }
  }
  for (const [syllable, names] of byLast) {
    if (names.length >= t.suffixClusterWarn) {
      warnings.push({ code: "name_suffix_cluster", message: `${names.length} given names end with '${syllable}': ${names.join(", ")}` });
    }
  }
  for (let i = 0; i < givens.length; i++) {
    for (let j = i + 1; j < givens.length; j++) {
      const a = givens[i]!;
      const b = givens[j]!;
      if (a.given === b.given) {
        errors.push({ code: "name_sibling_duplicate", message: `${a.name} / ${b.name} share a given name` });
      } else if (a.given.length === b.given.length && a.given.length <= 3 && syllableDistance(a.given, b.given) <= 1) {
        warnings.push({ code: "name_sibling_close", message: `${a.name} / ${b.name} differ by one syllable` });
      }
    }
  }
  const syllableHolders = new Map<string, Set<string>>();
  for (const g of givens) {
    for (const s of new Set(g.given)) syllableHolders.set(s, (syllableHolders.get(s) ?? new Set()).add(g.key));
  }
  for (const [syllable, holders] of syllableHolders) {
    const share = holders.size / Math.max(1, givens.length);
    if (givens.length >= 4 && share >= t.syllableShareError) {
      errors.push({ code: "name_syllable_repetition", message: `'${syllable}' appears in ${holders.size}/${givens.length} given names` });
    } else if (givens.length >= 4 && share >= t.syllableShareWarn) {
      warnings.push({ code: "name_syllable_repetition", message: `'${syllable}' appears in ${holders.size}/${givens.length} given names` });
    }
  }

  // Surname repeats without declared kinship.
  const byFamily = new Map<string, { e: NamePortfolioEntry }[]>();
  for (const { e, p } of list) {
    if (p.familyName) byFamily.set(p.familyName, [...(byFamily.get(p.familyName) ?? []), { e }]);
  }
  for (const [family, holders] of byFamily) {
    if (holders.length < 2) continue;
    const kin = holders.every(({ e }) =>
      holders.some(({ e: other }) => other !== e && ((e.kinNames ?? []).includes(other.name) || (other.kinNames ?? []).includes(e.name)))
    );
    if (kin) continue;
    const issue = { code: "name_surname_repeat", message: `${holders.length} characters share '${family}' without declared kinship` };
    if (holders.length >= t.surnameRepeatError) errors.push(issue);
    else warnings.push(issue);
  }

  // Exact collision with an observed market character.
  const norm = (s: string) => s.replace(/\s+/g, "");
  for (const { e } of list) {
    for (const o of opts.observed ?? []) {
      if (norm(o.name) !== norm(e.name)) continue;
      const hook = opts.hooks?.[e.draftKey] ?? "";
      const same = jaccard(sceneTokens(hook), sceneTokens(o.hook)) >= t.observedHookJaccard;
      if (same) errors.push({ code: "name_observed_collision", message: `${e.name}: same name and near-identical hook as an observed market character` });
      else warnings.push({ code: "name_observed_name_only", message: `${e.name}: exact name of an observed market character (hook differs)` });
    }
  }
  return { ...qaResult(errors, warnings), parsed };
}

const KIN_RE = /(가문|남매|형제|자매|오빠|누나|언니|형님|동생|사촌|아버지|어머니|숙부|삼촌|이모|고모|친척|혈육|조카)/;

/** Cast members a bible declares kin/house ties with (from its relationship map). */
export function declaredKinNames(bible: OfficialCharacterBible): string[] {
  return bible.otherRelationships
    .filter((r) => KIN_RE.test(`${r.public} ${r.privateOpinion} ${r.hidden}`))
    .map((r) => r.target);
}

export function observedMarketNames(snapshot: ResearchSnapshot): ObservedMarketName[] {
  return snapshot.signals
    .filter((s) => s.observedCharacterName?.trim())
    .map((s) => ({ name: s.observedCharacterName!.trim(), hook: s.scenarioHook }));
}

// ── Market Fit Brief ─────────────────────────────────────────────────────────

/** Planned before the Character Bible; flows into the Portfolio Brief. */
export type OfficialMarketFitBrief = {
  targetLocale: string;
  audienceSegment: string;
  genre: string;
  relationshipTrope: { primary: string; secondary: string[] };
  archetype: string;
  /** signalIds from the committed snapshot (IP-eligible only). */
  provenMarketSignal: string[];
  marketRole: MarketRole;
  differentiationTwist: string;
  userRelationship: string;
  /** USER RELATIONSHIP + CONFLICT + HOOK in one sentence, plain role vocabulary. */
  oneLineConflict: string;
  namingProfile: NamingProfileKey;
  discoveryTags: string[];
  adultDemandSignal: string | null;
  originalityExclusions: string[];
};

export const MARKET_FIT_SKELETON = `{"targetLocale": "", "audienceSegment": "", "genre": "", "relationshipTrope": {"primary": "", "secondary": [""]}, "archetype": "", "provenMarketSignal": [""], "marketRole": "proven", "differentiationTwist": "", "userRelationship": "", "oneLineConflict": "", "namingProfile": "", "discoveryTags": ["", "", "", ""], "adultDemandSignal": null, "originalityExclusions": [""]}`;

const MARKET_ROLES: readonly MarketRole[] = ["proven", "proven_twist", "experimental"];
const NAMING_KEYS = Object.keys(NAMING_PROFILES) as NamingProfileKey[];

function strArr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()) : [];
}

/** Tolerant coercion of a model-authored market-fit object (null when absent). */
export function coerceMarketFitBrief(value: unknown): OfficialMarketFitBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const s = (key: string) => (typeof v[key] === "string" ? (v[key] as string).trim() : "");
  const trope = v.relationshipTrope && typeof v.relationshipTrope === "object" ? (v.relationshipTrope as Record<string, unknown>) : {};
  const role = MARKET_ROLES.find((r) => r === v.marketRole) ?? "proven";
  const naming = NAMING_KEYS.find((k) => k === v.namingProfile) ?? "korean_modern";
  return {
    targetLocale: s("targetLocale"),
    audienceSegment: s("audienceSegment"),
    genre: s("genre"),
    relationshipTrope: {
      primary: typeof trope.primary === "string" ? trope.primary.trim() : "",
      secondary: strArr(trope.secondary),
    },
    archetype: s("archetype"),
    provenMarketSignal: strArr(v.provenMarketSignal),
    marketRole: role,
    differentiationTwist: s("differentiationTwist"),
    userRelationship: s("userRelationship"),
    oneLineConflict: s("oneLineConflict"),
    namingProfile: naming,
    discoveryTags: strArr(v.discoveryTags),
    adultDemandSignal: typeof v.adultDemandSignal === "string" && v.adultDemandSignal.trim() ? v.adultDemandSignal.trim() : null,
    originalityExclusions: strArr(v.originalityExclusions),
  };
}

/** Per-character brief gate: cites eligible signals, carries a twist, is relationship-first. */
export function validateMarketFitBrief(
  brief: OfficialMarketFitBrief,
  ctx: { snapshot: ResearchSnapshot; policy: OfficialBatchMarketPolicy; adultCandidate: boolean; expectedNamingProfile?: NamingProfileKey }
): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const byId = new Map(ctx.snapshot.signals.map((s) => [s.signalId, s] as const));
  if (brief.targetLocale !== ctx.policy.targetLocale) {
    errors.push({ code: "market_fit_locale", message: `targetLocale ${brief.targetLocale || "(empty)"} ≠ ${ctx.policy.targetLocale}` });
  }
  if (brief.provenMarketSignal.length === 0) {
    errors.push({ code: "market_fit_no_signal", message: "provenMarketSignal must cite at least one snapshot signalId" });
  }
  for (const id of brief.provenMarketSignal) {
    const signal = byId.get(id);
    if (!signal) errors.push({ code: "market_fit_unknown_signal", message: `${id} is not in the snapshot` });
    else if (!signal.originalityEligible) {
      errors.push({ code: "market_fit_ip_identity_source", message: `${id} is IP/derivative-excluded: ${signal.ipExclusionReason}` });
    }
  }
  const text = [brief.archetype, brief.oneLineConflict, brief.differentiationTwist, brief.userRelationship].join(" ");
  for (const signal of ctx.snapshot.signals) {
    const observed = signal.observedCharacterName?.trim();
    if (!signal.originalityEligible && observed && text.includes(observed)) {
      errors.push({ code: "market_fit_ip_identity_source", message: `brief carries IP-excluded identity "${observed}"` });
    }
  }
  if (!brief.relationshipTrope.primary) errors.push({ code: "market_fit_no_trope", message: "primary relationship trope required" });
  if (1 + brief.relationshipTrope.secondary.length > 3) {
    warnings.push({ code: "market_fit_trope_overloaded", message: "keep 1-3 core tropes; the rest is supporting flavor" });
  }
  if (!brief.differentiationTwist) {
    errors.push({ code: "market_fit_no_twist", message: "PROVEN TROPE + UNIQUE TWIST: differentiationTwist required" });
  }
  if (!brief.userRelationship || !hasUserRelationshipCue(brief.oneLineConflict)) {
    errors.push({ code: "market_fit_not_relationship_first", message: "oneLineConflict must state who the character is to the user and the conflict" });
  }
  const tagCount = brief.discoveryTags.length;
  if (tagCount > DISCOVERY_TAG_HARD_MAX) errors.push({ code: "tags_keyword_stuffing", message: `${tagCount} tags` });
  else if (tagCount < ctx.policy.coreTags.min || tagCount > ctx.policy.coreTags.max) {
    warnings.push({ code: "tags_core_count", message: `${tagCount} tags outside ${ctx.policy.coreTags.min}-${ctx.policy.coreTags.max}` });
  }
  if (ctx.expectedNamingProfile && brief.namingProfile !== ctx.expectedNamingProfile) {
    warnings.push({ code: "market_fit_naming_profile", message: `${brief.namingProfile} ≠ genre default ${ctx.expectedNamingProfile}` });
  }
  if (ctx.adultCandidate) {
    const adult = brief.adultDemandSignal ? byId.get(brief.adultDemandSignal) : undefined;
    if (!adult) warnings.push({ code: "market_fit_adult_signal", message: "adult candidate without an adult-demand signal" });
    else if (!adult.adultDemand || !adult.originalityEligible) {
      errors.push({ code: "market_fit_adult_signal", message: `${adult.signalId} is not an eligible adult-demand signal` });
    }
  }
  return qaResult(errors, warnings);
}

export type MarketTropeEntry = { draftKey: string; primaryTrope: string; secondaryTropes: string[]; marketRole?: MarketRole };

/**
 * Portfolio trope gate. Only PRIMARY tropes count toward repetition — sharing
 * generic secondary tropes is not an originality failure.
 */
export function evaluateMarketTropePortfolio(
  entries: readonly MarketTropeEntry[],
  policy: Pick<OfficialBatchMarketPolicy, "maxPrimaryTropeRepeat" | "marketRoleMix">
): QaResult & { primaryCounts: Record<string, string[]> } {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const primaryCounts: Record<string, string[]> = {};
  for (const e of entries) {
    const key = canonicalPrimaryTrope(e.primaryTrope);
    (primaryCounts[key] ??= []).push(e.draftKey);
    if (1 + e.secondaryTropes.length > 3) {
      warnings.push({ code: "market_trope_overloaded", message: `${e.draftKey}: ${1 + e.secondaryTropes.length} core tropes` });
    }
  }
  for (const [trope, holders] of Object.entries(primaryCounts)) {
    if (holders.length > policy.maxPrimaryTropeRepeat) {
      errors.push({ code: "market_primary_trope_repeat", message: `${trope}: ${holders.length} characters (${holders.join(", ")})` });
    }
  }
  const roles = entries.filter((e) => e.marketRole);
  if (roles.length === entries.length && entries.length > 0) {
    for (const role of MARKET_ROLES) {
      const count = roles.filter((e) => e.marketRole === role).length;
      const band = policy.marketRoleMix[role];
      if (count < band.min || count > band.max) {
        warnings.push({ code: "market_role_mix", message: `${role}: ${count} outside ${band.min}-${band.max}` });
      }
    }
  }
  return { ...qaResult(errors, warnings), primaryCounts };
}

/** Portfolio gate for freshly authored briefs (run before any Character Bible). */
export function evaluateMarketFitPortfolio(
  briefs: readonly { draftKey: string; name: string; adultCandidate: boolean; marketFit: OfficialMarketFitBrief | null | undefined }[],
  ctx: { snapshot: ResearchSnapshot; policy: OfficialBatchMarketPolicy; genre: string }
): QaResult {
  const errors: QaIssue[] = [];
  const warnings: QaIssue[] = [];
  const expected = resolveNamingProfile(ctx.genre);
  for (const b of briefs) {
    if (!b.marketFit) {
      errors.push({ code: "market_fit_missing", message: `${b.draftKey}: no market fit brief` });
      continue;
    }
    const qa = validateMarketFitBrief(b.marketFit, { ...ctx, adultCandidate: b.adultCandidate, expectedNamingProfile: expected });
    errors.push(...qa.errors.map((e) => ({ ...e, message: `${b.draftKey}: ${e.message}` })));
    warnings.push(...qa.warnings.map((w) => ({ ...w, message: `${b.draftKey}: ${w.message}` })));
  }
  const planned = briefs.filter((b) => b.marketFit);
  const tropes = evaluateMarketTropePortfolio(
    planned.map((b) => ({
      draftKey: b.draftKey,
      primaryTrope: b.marketFit!.relationshipTrope.primary,
      secondaryTropes: b.marketFit!.relationshipTrope.secondary,
      marketRole: b.marketFit!.marketRole,
    })),
    ctx.policy
  );
  errors.push(...tropes.errors);
  warnings.push(...tropes.warnings);
  const names = evaluateNamePortfolio(
    planned.map((b) => ({ draftKey: b.draftKey, name: b.name, namingProfile: b.marketFit!.namingProfile })),
    {
      observed: observedMarketNames(ctx.snapshot),
      hooks: Object.fromEntries(planned.map((b) => [b.draftKey, b.marketFit!.oneLineConflict])),
    }
  );
  errors.push(...names.errors);
  warnings.push(...names.warnings);
  return qaResult(errors, warnings);
}

export type CastRoleEntry = {
  draftKey: string;
  name: string;
  occupation: string;
  archetype: string;
  socialPosition: string;
  visualSilhouette: string;
  rpHook: string;
  speechDirection: string;
};

export const CAST_ROLE_THRESHOLDS = {
  occupationJaccard: 0.5,
  hookJaccard: 0.4,
  silhouetteJaccard: 0.5,
  speechJaccard: 0.5,
  /** Royal/ducal archetypes (황자·황녀·왕자·대공…) allowed per batch before the cast reads as one court. */
  maxRoyalOrDuke: 2,
} as const;

function stemJaccard(a: string, b: string): number {
  return jaccard(tagStems(a), tagStems(b));
}

/**
 * Cast-level role diversity: occupation / hook / silhouette / speech-direction
 * clones and royal-title density. Deterministic token overlap, no LLM judge.
 */
export function evaluateCastRoleDiversity(entries: readonly CastRoleEntry[]): QaResult & { royalOrDuke: string[] } {
  const errors: QaIssue[] = [];
  const t = CAST_ROLE_THRESHOLDS;
  const checks: [keyof CastRoleEntry, number, string][] = [
    ["occupation", t.occupationJaccard, "cast_occupation_clone"],
    ["rpHook", t.hookJaccard, "cast_hook_clone"],
    ["visualSilhouette", t.silhouetteJaccard, "cast_silhouette_clone"],
    ["speechDirection", t.speechJaccard, "cast_speech_clone"],
  ];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      for (const [field, limit, code] of checks) {
        const value = stemJaccard(a[field], b[field]);
        if (value >= limit) errors.push({ code, message: `${a.name} / ${b.name}: ${field} overlap ${value.toFixed(2)}` });
      }
    }
  }
  const royalOrDuke = entries
    .filter((e) => {
      const text = `${e.archetype} ${e.occupation} ${e.socialPosition}`;
      return DOMESTIC_TROPES.royalty.re.test(text) || DOMESTIC_TROPES.northern_duke.re.test(text);
    })
    .map((e) => e.name);
  if (royalOrDuke.length > t.maxRoyalOrDuke) {
    errors.push({ code: "cast_royal_density", message: `${royalOrDuke.length} royal/ducal leads: ${royalOrDuke.join(", ")}` });
  }
  return { ...qaResult(errors), royalOrDuke };
}

/** Prompt lines carrying one character's market fit into the bible calls. */
export function formatMarketFitForPrompt(brief: OfficialMarketFitBrief): string[] {
  return [
    `시장 적합 브리프(${brief.targetLocale}, ${brief.audienceSegment}):`,
    `- 유저와의 관계: ${brief.userRelationship}`,
    `- 한 줄 갈등(공개 훅의 뼈대): ${brief.oneLineConflict}`,
    `- 핵심 트로프: ${[brief.relationshipTrope.primary, ...brief.relationshipTrope.secondary].join(" / ")}`,
    `- 차별점: ${brief.differentiationTwist}`,
    `- 발견 태그 방향: ${brief.discoveryTags.join(", ")}`,
    brief.originalityExclusions.length ? `- 피할 것(원작·경쟁작 유사): ${brief.originalityExclusions.join(", ")}` : "",
  ].filter(Boolean);
}

// ── Domestic market fit review (facts only; a human decides) ─────────────────

export type DomesticMarketFitReviewRow = {
  draftKey: string;
  name: string;
  namingProfile: NamingProfileKey;
  parsedName: ParsedCharacterName;
  audience: string;
  /** Portfolio-stage hook (relationship-first source). */
  portfolioHook: string;
  publicTagline: string;
  publicDescriptionOpening: string;
  primaryTrope: string;
  secondaryTropes: string[];
  archetype: string;
  tags: string[];
  ungroundedTags: string[];
  taglineWorldTerms: string[];
  taglineHasUserRelationship: boolean;
  userRole: string;
  adult: boolean;
  marketFitBrief: OfficialMarketFitBrief | null;
  findings: string[];
};

export type DomesticMarketFitReview = {
  targetLocale: string;
  marketPriority: OfficialMarketPriority;
  signals: { primary: string[]; supporting: string[]; excluded: { signalId: string; reason: string }[] };
  rows: DomesticMarketFitReviewRow[];
  portfolio: { names: QaResult; tropes: QaResult & { primaryCounts: Record<string, string[]> }; repeatedTags: Record<string, string[]> };
};

export function buildDomesticMarketFitReview(input: {
  world: OfficialWorldBible;
  snapshot: ResearchSnapshot;
  policy: OfficialBatchMarketPolicy;
  genre: string;
  characters: readonly {
    draftKey: string;
    brief: { name: string; archetype: string; relationshipTrope: string; rpHook: string; audience: string; adultCandidate: boolean; marketFit?: OfficialMarketFitBrief | null };
    bible: OfficialCharacterBible;
  }[];
}): DomesticMarketFitReview {
  const { world, policy } = input;
  const terms = collectWorldProperTerms(world);
  const selection = selectMarketSignals(input.snapshot, policy, input.genre);
  const profile = resolveNamingProfile(input.genre);
  const nameEntries: NamePortfolioEntry[] = input.characters.map((c) => ({
    draftKey: c.draftKey,
    name: c.bible.identity.name,
    namingProfile: c.brief.marketFit?.namingProfile ?? (/(인형|기계|골렘|정령)/.test(c.bible.identity.species) ? "nonhuman_designation" : profile),
    kinNames: declaredKinNames(c.bible),
  }));
  const names = evaluateNamePortfolio(nameEntries, {
    observed: observedMarketNames(input.snapshot),
    hooks: Object.fromEntries(input.characters.map((c) => [c.draftKey, c.brief.rpHook])),
  });
  const tagHolders = new Map<string, string[]>();
  const rows = input.characters.map((c, i): DomesticMarketFitReviewRow => {
    const bible = c.bible;
    const tags = bible.publicProfile.tags;
    for (const tag of tags) tagHolders.set(tag, [...(tagHolders.get(tag) ?? []), c.draftKey]);
    const tagQa = evaluateDiscoveryTags({ tags, bible }, policy);
    const hookQa = evaluatePublicHook(
      { tagline: bible.publicProfile.tagline, description: bible.publicProfile.description, worldTerms: terms },
      policy
    );
    const tropeSource = c.brief.marketFit?.relationshipTrope.primary ?? c.brief.relationshipTrope;
    const detected = detectDomesticTropes(`${c.brief.relationshipTrope} ${c.brief.archetype}`).map((k) => DOMESTIC_TROPES[k].label);
    const primary = canonicalPrimaryTrope(tropeSource);
    const nameFindings = [...names.errors, ...names.warnings]
      .filter((issue) => issue.message.includes(bible.identity.name))
      .map((issue) => `${issue.code}: ${issue.message}`);
    return {
      draftKey: c.draftKey,
      name: bible.identity.name,
      namingProfile: nameEntries[i]!.namingProfile,
      parsedName: names.parsed[c.draftKey]!,
      audience: c.brief.audience,
      portfolioHook: c.brief.rpHook,
      publicTagline: bible.publicProfile.tagline,
      publicDescriptionOpening: bible.publicProfile.description.split(/(?<=[.!?。])\s/)[0] ?? "",
      primaryTrope: primary,
      secondaryTropes: c.brief.marketFit?.relationshipTrope.secondary ?? detected.filter((label) => label !== primary),
      archetype: c.brief.archetype,
      tags,
      ungroundedTags: tagQa.errors.filter((e) => e.code === "tag_bible_mismatch").map((e) => e.message),
      taglineWorldTerms: worldTermsIn(bible.publicProfile.tagline, terms),
      taglineHasUserRelationship: hasUserRelationshipCue(bible.publicProfile.tagline),
      userRole: bible.userRelationship.userRole,
      adult: c.brief.adultCandidate,
      marketFitBrief: c.brief.marketFit ?? null,
      findings: [
        ...nameFindings,
        ...[...tagQa.errors, ...tagQa.warnings, ...hookQa.warnings].map((issue) => `${issue.code}: ${issue.message}`),
        ...(c.brief.marketFit ? [] : ["market_fit_brief_absent: authored before the market-fit owner existed"]),
      ],
    };
  });
  const tropes = evaluateMarketTropePortfolio(
    rows.map((r) => ({ draftKey: r.draftKey, primaryTrope: r.primaryTrope, secondaryTropes: r.secondaryTropes, marketRole: r.marketFitBrief?.marketRole })),
    policy
  );
  const repeatedTags = Object.fromEntries([...tagHolders].filter(([, holders]) => holders.length >= 3));
  return {
    targetLocale: policy.targetLocale,
    marketPriority: policy.marketPriority,
    signals: {
      primary: selection.primary.map((s) => s.signalId),
      supporting: selection.supporting.map((s) => s.signalId),
      excluded: selection.excluded,
    },
    rows,
    portfolio: { names: qaResult(names.errors, names.warnings), tropes, repeatedTags },
  };
}
