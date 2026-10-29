import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { qaResult, type OfficialCharacterDraft, type QaIssue, type QaResult } from "@/lib/officialSupply/types";

/**
 * Canonical public-page text owner for official characters.
 * `bible.publicProfile.description` stays a short discovery pitch.
 * The page 「캐릭터 상세 소개」 is this compiled plain-text sheet.
 * Creator comment is a separate play guide — never a second intro.
 */

export const OFFICIAL_PUBLIC_INTRO_SECTIONS = {
  world: "세계관 설정",
  character: "캐릭터 설정",
  play: "플레이 포인트",
  relation: "관계 포인트",
  intro: "도입 상황",
} as const;

export const OFFICIAL_PUBLIC_INTRO_MIN_CHARS = 280;
export const OFFICIAL_PUBLIC_INTRO_MAX_CHARS = PROFILE_BIOGRAPHY_LIMIT;

const HTML_TAG_RE = /<\/?[a-z][\s\S]*>/i;
const USER_CUE_RE = /당신/;
const PLAYER_CUE_SOURCE = "당신|플레이어|유저";
const GENDER_WORD_SOURCE = "여자|남자|여성|남성";
const PLAYER_TITLE_SOURCE = "아가씨|도련님|왕자비|신부";

function nonEmpty(value: string | null | undefined): value is string {
  return Boolean(value && value.trim());
}

function firstSentences(text: string, maxChars: number, maxSentences = 3): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  const out: string[] = [];
  let size = 0;
  for (const part of parts.slice(0, maxSentences)) {
    const next = size === 0 ? part : `${out.join(" ")} ${part}`;
    if (next.length > maxChars && out.length > 0) break;
    out.push(part);
    size = out.join(" ").length;
    if (size >= maxChars) break;
  }
  const joined = out.join(" ").trim();
  return joined.length > maxChars ? joined.slice(0, maxChars).replace(/\s+\S*$/, "").trim() : joined;
}

function firstSentence(text: string, maxChars: number): string {
  return firstSentences(text, maxChars, 1);
}

function withPeriod(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?。！？]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function preferEncounter(text: string, maxChars: number): string {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const scored = parts
    .map((part) => {
      let score = 0;
      if (/발견|손목|경보|마주|제안/.test(part)) score += 3;
      if (/순간|처음/.test(part)) score += 2;
      if (/당신/.test(part)) score += 1;
      return { part, score };
    })
    .sort((a, b) => b.score - a.score);
  if (scored[0] && scored[0].score > 0) return firstSentences(scored[0].part, maxChars, 2);
  return firstSentences(text, maxChars, 2);
}

export function officialWorldDisplayName(worldName: string | undefined): string {
  const raw = (worldName ?? "").trim();
  if (!raw) return "";
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || raw;
}

function worldHeader(worldName: string | undefined): string {
  const name = officialWorldDisplayName(worldName);
  return name
    ? `[${OFFICIAL_PUBLIC_INTRO_SECTIONS.world}: ${name}]`
    : `[${OFFICIAL_PUBLIC_INTRO_SECTIONS.world}]`;
}

function pickPrefixed(text: string, label: string): string {
  const match = text.match(new RegExp(`${label}:\\s*(.+)`));
  return match?.[1]?.split("\n")[0]?.trim() ?? "";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type OfficialPublicIntroInput = {
  worldName?: string;
  rpHook: string;
  relationshipTrope?: string;
  identity: {
    name: string;
    age: number;
    heightCm: number;
    occupation: string;
    affiliation: string;
    worldRole: string;
  };
  appearance: {
    impression: string;
    usualExpression?: string;
    defaultOutfit?: string;
    hairColor?: string;
    hairstyle?: string;
    hairLength?: string;
    eyes?: string;
    eyeColor?: string;
    skin?: string;
    build?: string;
    distinguishingFeatures?: string;
    accessories?: string;
  };
  personality: { keywords: string[]; behavioral: string };
  abilities: Array<{ name: string; scope: string }>;
  situation: { worldContext: string; personalSituation: string; userEntry: string };
  userRole: string;
  /** compact_rp_v1: prior user-character relationship comes from the user persona/dialogue, not the card. */
  personaFlexible?: boolean;
  /** ROLE_BOUND / RELATIONSHIP_BOUND start: the fixed facts, so the auto intro does not claim the persona decides everything. */
  fixedRelation?: string;
  /** GPT-authored public-page body. When present, skip auto-composition. */
  detailedDescription?: string;
};

/** Setting text says "유저"; the public page addresses the reader as 당신. */
function addressUserAsPlayer(text: string): string {
  return text
    .replace(/유저(?:는|은)/g, "당신은")
    .replace(/유저(?:가|이)/g, "당신이")
    .replace(/유저를/g, "당신을")
    .replace(/유저와/g, "당신과")
    .replace(/유저의/g, "당신의")
    .replace(/유저에게/g, "당신에게")
    .replace(/유저/g, "당신");
}

function clipPhrase(text: string, maxChars: number): string {
  const phrase = completePhrase(text);
  if (!phrase) return "";
  if (phrase.length <= maxChars) return phrase;
  return phrase.slice(0, maxChars).replace(/\s+\S*$/, "").trim() || phrase;
}

/** First complete source phrase — never mid-clause clipped. */
function completePhrase(text: string | undefined): string {
  const raw = (text ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const first = raw.split(/(?<=[.!?。！？])\s+/).filter(Boolean)[0] ?? raw;
  return first.replace(/[.!?。！？]+$/u, "").replace(/\d+\s*cm의?\s*/gi, "").trim();
}

function labeledFact(label: string, ...parts: Array<string | undefined>): string {
  const body = parts.map((part) => completePhrase(part)).filter(nonEmpty).join(", ");
  return body ? `${label}: ${body}` : "";
}

/** Public identifying looks: 3–5 labeled complete phrases from canonical fields. */
export function publicAppearanceFacts(appearance: OfficialPublicIntroInput["appearance"], preserveSource = false): string[] {
  const fact = preserveSource
    ? (label: string, ...parts: Array<string | undefined>) => {
        const body = parts.filter(nonEmpty).join(", ");
        return body ? `${label}: ${body}` : "";
      }
    : labeledFact;
  const facts = [
    fact("머리", appearance.hairColor, appearance.hairstyle),
    fact("눈", appearance.eyeColor, appearance.eyes),
    fact("피부", appearance.skin),
    fact("체형", appearance.build),
    fact("특징", appearance.distinguishingFeatures),
    fact("복식", appearance.defaultOutfit),
  ].filter(nonEmpty);
  if (facts.length < 3 && appearance.accessories) facts.push(fact("소품", appearance.accessories));
  if (facts.length < 3 && appearance.impression) facts.push(fact("인상", appearance.impression));
  return facts.slice(0, 5);
}

export function composeOfficialPublicDescription(input: OfficialPublicIntroInput): string {
  const authored = input.detailedDescription?.trim();
  if (authored) return authored;

  const id = input.identity;
  const worldBody = firstSentences(input.situation.worldContext, 280, 3);
  const looks = publicAppearanceFacts(input.appearance).join(" / ");
  const personality = [
    input.personality.keywords.slice(0, 4).join("·"),
    firstSentence(input.personality.behavioral, 120),
  ]
    .filter(nonEmpty)
    .join(". ");
  const ability = input.abilities
    .slice(0, 2)
    .map((item) =>
      `${item.name}${item.scope ? ` — ${input.personaFlexible ? completePhrase(item.scope) : firstSentence(item.scope, 70)}` : ""}`
    )
    .filter(nonEmpty)
    .join(" / ");
  const publicBackground =
    firstSentence(input.situation.personalSituation, 140) || firstSentence(id.worldRole, 90);
  const fixedRelation = input.fixedRelation?.trim() ? clipPhrase(addressUserAsPlayer(input.fixedRelation), 110) : "";
  const relationLine = fixedRelation ? `사건 전제: ${fixedRelation}.` : "";
  const playBody = [
    withPeriod(firstSentence(input.rpHook, 140)),
    relationLine,
  ]
    .filter(nonEmpty)
    .join(" ");
  const introBody = preferEncounter(input.situation.userEntry, 240);

  const characterBlock = [
    `이름: ${id.name}`,
    `나이: ${id.age}세`,
    `키: ${id.heightCm}cm`,
    `직업/소속: ${[id.occupation, id.affiliation].filter(nonEmpty).join(" / ")}`,
    "",
    `외형: ${looks}`,
    `성격: ${personality}`,
    `능력/역할: ${ability || firstSentence(id.worldRole, 80)}`,
    `배경: ${publicBackground}`,
  ].join("\n");

  const playHeader = OFFICIAL_PUBLIC_INTRO_SECTIONS.play;

  return [
    worldHeader(input.worldName),
    worldBody,
    "",
    `[${OFFICIAL_PUBLIC_INTRO_SECTIONS.character}]`,
    characterBlock,
    "",
    `[${playHeader}]`,
    playBody,
    "",
    `[${OFFICIAL_PUBLIC_INTRO_SECTIONS.intro}]`,
    introBody,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `본명 (별명)` is the canonical name-field alias format; the intro may state either the full string or the bare name. */
function withoutNameAlias(name: string): string {
  return name.replace(/\s*[(（][^)）]*[)）]\s*$/u, "").trim() || name;
}

export function evaluateOfficialPublicDescription(description: string, name?: string): QaResult {
  const errors: QaIssue[] = [];
  const text = description.trim();
  if (!text) {
    errors.push({ code: "public_intro_missing", message: "public detailed intro is empty" });
    return qaResult(errors);
  }
  if (HTML_TAG_RE.test(text)) {
    errors.push({ code: "public_intro_html", message: "detailed intro must be plain text (no HTML)" });
  }
  if (text.length < OFFICIAL_PUBLIC_INTRO_MIN_CHARS) {
    errors.push({
      code: "public_intro_too_short",
      message: `detailed intro ${text.length} < ${OFFICIAL_PUBLIC_INTRO_MIN_CHARS}`,
    });
  }
  if (text.length > OFFICIAL_PUBLIC_INTRO_MAX_CHARS) {
    errors.push({
      code: "public_intro_too_long",
      message: `detailed intro ${text.length} > ${OFFICIAL_PUBLIC_INTRO_MAX_CHARS}`,
    });
  }
  if (!text.includes(`[${OFFICIAL_PUBLIC_INTRO_SECTIONS.world}`) || !text.includes(`[${OFFICIAL_PUBLIC_INTRO_SECTIONS.character}]`)) {
    errors.push({ code: "public_intro_sections_missing", message: "world/character sections are required" });
  }
  if (
    !text.includes(`[${OFFICIAL_PUBLIC_INTRO_SECTIONS.play}]`) &&
    !text.includes(`[${OFFICIAL_PUBLIC_INTRO_SECTIONS.relation}]`)
  ) {
    errors.push({ code: "public_intro_play_missing", message: "play or relationship section is required" });
  }
  if (!text.includes(`[${OFFICIAL_PUBLIC_INTRO_SECTIONS.intro}]`)) {
    errors.push({ code: "public_intro_entry_missing", message: "introduction situation section is required" });
  }
  if (name && !text.includes(name) && !text.includes(withoutNameAlias(name))) {
    errors.push({ code: "public_intro_name_missing", message: "detailed intro must state the character name" });
  }
  if (!/\d+\s*세/.test(text) || !/\d+\s*cm/i.test(text)) {
    errors.push({ code: "public_intro_stats_missing", message: "detailed intro must state age and height" });
  }
  const isAutoSheet = /(?:^|\n)이름:/.test(text) && /(?:^|\n)나이:/.test(text) && /(?:^|\n)키:/.test(text);
  if (isAutoSheet) {
    if (!/직업\/소속/.test(text) || !/외형:/.test(text) || !/성격:/.test(text) || !/능력\/역할:/.test(text)) {
      errors.push({ code: "public_intro_facts_missing", message: "detailed intro must cover occupation, looks, personality, role" });
    }
    const looks = text.match(/외형:\s*([^\n]+)/)?.[1] ?? "";
    const lookLabels = [/머리:/, /눈:/, /피부:/, /체형:/, /특징:/, /복식:/];
    if (looks.length < 40 || lookLabels.filter((cue) => cue.test(looks)).length < 3) {
      errors.push({
        code: "public_intro_looks_thin",
        message: "detailed intro looks must include 3–5 labeled public identifying features",
      });
    }
    if (/[가-힣](?:보다|하며|하고)\s*\//.test(looks)) {
      errors.push({ code: "public_intro_looks_truncated", message: "detailed intro looks must not cut a source sentence mid-clause" });
    }
  } else if (!/외형:/.test(text) || !/성격:/.test(text)) {
    errors.push({ code: "public_intro_facts_missing", message: "detailed intro must cover looks and personality" });
  }
  errors.push(...evaluateOfficialPlayerGenderNeutral({ description: text }).errors);
  return qaResult(errors);
}

/** Public self-reference for the character. Player address stays on the player-gender owner. */
export function officialCharacterPronounDirective(gender: "male" | "female" | "other"): string {
  switch (gender) {
    case "female":
      return "공개 문장에서 이 인물 본인은 그녀·그녀는·그녀가·그녀를·그녀의로 가리킨다. 본인에게 그는·그가·그를 쓰지 않는다.";
    case "male":
      return "공개 문장에서 이 인물 본인은 그·그는·그가·그를·그의로 가리킨다. 본인에게 그녀를 쓰지 않는다.";
    case "other":
      return "공개 문장에서 이 인물 본인은 이름으로만 가리킨다. 본인에게 그는·그녀를 쓰지 않는다.";
    default: {
      const unreachable: never = gender;
      return unreachable;
    }
  }
}

const MALE_PERSON_TITLES = ["시아버지", "아버지", "아빠", "할아버지", "아저씨", "남동생", "오빠", "삼촌", "장인", "아들", "형", "남성", "남자"] as const;
const FEMALE_PERSON_TITLES = ["시어머니", "아주머니", "할머니", "어머니", "여동생", "엄마", "고모", "이모", "언니", "누나", "딸", "여성", "여자"] as const;
const TWO_SYLLABLE_SURNAMES = ["남궁", "황보", "제갈", "선우", "독고", "사공", "서문"] as const;
const PRONOUN_SUBJECT_STOP = new Set([
  "이것", "그것", "저것", "여기", "거기", "우리", "저희", "무엇", "아무", "누구",
  "누군가", "무엇인가", "이것이", "그것이", "저것이", "무엇이",
  "사람", "상대", "오늘", "어제", "지금", "그때", "이번", "다음", "자신", "자기",
  "그녀", "당신", "유저", "플레이어",
]);
/** Adnominal or case endings that only look like a topic particle (`어울리는`, `손에는`, `자리에서는`). */
const PRONOUN_SUBJECT_VERBISH = /(?:하|되|리|기|려|에|에서|에게|한테|으로)$/u;

type ReferentGender = "male" | "female";

function protagonistNameSet(name: string | undefined): Set<string> {
  const names = new Set<string>();
  const base = (name ?? "").replace(/[("'“‘][^)"'”’]*[)"'”’]/g, "").trim().split(/\s+/)[0] ?? "";
  if (!base) return names;
  names.add(base);
  if (!/^[가-힣]{3,4}$/.test(base)) return names;
  const surname = TWO_SYLLABLE_SURNAMES.find((item) => base.startsWith(item) && base.length > item.length);
  const given = surname ? base.slice(surname.length) : base.length === 3 ? base.slice(1) : "";
  if (given.length >= 2) names.add(given);
  return names;
}

function bindTitledPeople(text: string): Map<string, ReferentGender> {
  const bound = new Map<string, ReferentGender>();
  const titles = [
    ...MALE_PERSON_TITLES.map((title) => [title, "male"] as const),
    ...FEMALE_PERSON_TITLES.map((title) => [title, "female"] as const),
  ].sort((a, b) => b[0].length - a[0].length);
  for (const [title, personGender] of titles) {
    const re = new RegExp(
      `(?<![가-힣])${title}(?:인\\s+|\\s+)([가-힣]{2,4}?)(?=(?:은|는|이|가|의|을|를|와|과|도|만|께|에게|께서|님)?(?:\\s|$|[^가-힣]))`,
      "gu"
    );
    for (const match of text.matchAll(re)) {
      const person = match[1] ?? "";
      if (!person || PRONOUN_SUBJECT_STOP.has(person)) continue;
      bound.set(person, personGender);
    }
  }
  return bound;
}

type PronounAntecedent =
  | { kind: "protagonist" }
  | { kind: "other"; gender: ReferentGender | "unknown" };

function nearestPersonAntecedent(
  textBefore: string,
  protagonists: Set<string>,
  titled: Map<string, ReferentGender>
): PronounAntecedent | null {
  const re = /(?:^|[^가-힣])([가-힣]{2,4})(은|는|이|가)(?![가-힣])/gu;
  let last: PronounAntecedent | null = null;
  for (const match of textBefore.matchAll(re)) {
    const token = match[1] ?? "";
    const particle = match[2] ?? "";
    if (!token || PRONOUN_SUBJECT_STOP.has(token) || PRONOUN_SUBJECT_STOP.has(`${token}${particle}`)) continue;
    const protagonist = protagonists.has(token);
    const known = titled.get(token);
    if (!protagonist && !known) {
      if (particle === "이" || particle === "가") continue;
      if (PRONOUN_SUBJECT_VERBISH.test(token)) continue;
    }
    if (protagonist) {
      last = { kind: "protagonist" };
      continue;
    }
    if (known) {
      last = { kind: "other", gender: known };
      continue;
    }
    last = { kind: "other", gender: "unknown" };
  }
  return last;
}

function pronounExcerpt(text: string, index: number): string {
  const breaks: number[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const char = text[i] ?? "";
    if (/[.!?。\n]/u.test(char)) {
      breaks.push(i);
      if (breaks.length >= 2) break;
    }
  }
  const previousBreak = breaks[1];
  const start = previousBreak == null ? 0 : previousBreak + 1;
  let end = text.length;
  for (let i = index; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (/[.!?。\n]/u.test(char)) {
      end = i;
      break;
    }
  }
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 80);
}

/**
 * Pitch and detailed public description only. A mismatched `그는`/`그가` or `그녀`
 * blocks when it continues the protagonist, or when no other person is in scope.
 * A titled other person (아버지 태식) may keep the pronoun. An unnamed competing
 * subject is reported separately and does not use the clear-violation code.
 * `그를`/`그의` and greeting/hidden text stay out: they often name someone else.
 */
export function evaluateOfficialCharacterPronoun(
  gender: string | undefined,
  surfaces: { description?: string; name?: string }
): QaResult {
  const text = (surfaces.description ?? "").replace(/[ \t]+/g, " ").trim();
  const errors: QaIssue[] = [];
  if (!text || (gender !== "female" && gender !== "male")) return qaResult(errors);
  const protagonists = protagonistNameSet(surfaces.name);
  const re = gender === "female" ? /그(?:는|가)(?!녀)/gu : /그녀/gu;
  if (protagonists.size === 0) {
    if (re.test(text)) {
      errors.push({
        code: "official_character_pronoun",
        message:
          gender === "female"
            ? "public description refers to a female character as 그는 or 그가"
            : "public description refers to a male character as 그녀",
      });
    }
    return qaResult(errors);
  }
  const titled = bindTitledPeople(text);
  const pronounGender: ReferentGender = gender === "female" ? "male" : "female";
  let clear = false;
  let uncertainExcerpt = "";
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    const antecedent = nearestPersonAntecedent(text.slice(0, index), protagonists, titled);
    if (!antecedent || antecedent.kind === "protagonist") {
      clear = true;
      continue;
    }
    if (antecedent.gender === pronounGender) continue;
    if (!uncertainExcerpt) uncertainExcerpt = pronounExcerpt(text, index);
  }
  if (clear) {
    errors.push({
      code: "official_character_pronoun",
      message:
        gender === "female"
          ? "public description refers to a female character as 그는 or 그가"
          : "public description refers to a male character as 그녀",
    });
  }
  if (uncertainExcerpt) {
    errors.push({
      code: "official_character_pronoun_uncertain",
      message: `public pronoun referent is uncertain: ${uncertainExcerpt}`,
    });
  }
  return qaResult(errors);
}

function clipExcerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 12);
  const end = Math.min(text.length, index + length + 12);
  return text.slice(start, end).replace(/\s+/g, " ").replace(/"/g, "").trim();
}

/** Gender word before the player cue (`여자인 당신`, `남자친구인 당신`). */
function genderBeforePlayerCueExcerpt(text: string): string | null {
  const match = text.match(
    new RegExp(
      `(?:${GENDER_WORD_SOURCE}|남자친구|여자친구)(?:인|의)?(?:\\s*채로|\\s*상태로)?\\s*(?:${PLAYER_CUE_SOURCE})`
    )
  );
  if (match?.index == null) return null;
  return clipExcerpt(text, match.index, match[0].length);
}

/**
 * Player cue followed by a gendered identity (`당신은 남성 경찰관입니다`).
 * A possessive `의` before the predicate means the gender word scopes someone else
 * (`당신은 남성 단골 손님의 빈 자리`).
 */
function playerCueGenderIdentityExcerpt(text: string): string | null {
  const cueRe = new RegExp(`(?:${PLAYER_CUE_SOURCE})(?:은|는|이|가|을|를|의|께|에게|도|만)?\\s*`, "g");
  for (const cueMatch of text.matchAll(cueRe)) {
    const cueIndex = cueMatch.index ?? 0;
    const rest = text.slice(cueIndex + cueMatch[0].length);
    const genderMatch = rest.match(
      new RegExp(`^\\s*(?:(?:그|이|저|그런|해당|바로)\\s+)?(?:${GENDER_WORD_SOURCE})`)
    );
    if (!genderMatch) continue;
    const afterGender = rest.slice(genderMatch[0].length);
    const clause = (afterGender.split(/[.!?。！？]/)[0] ?? afterGender).trim();
    if (/\S+의/.test(clause)) continue;
    const negation = afterGender.match(/^\s*(?:이|가)\s*아니(?:다|얍|요|죠|아요|습니다)(?=[.!?。！？\s]|$)/);
    const predicate = afterGender.match(/^\s*(?:[가-힣]*(?:입니다|이다|예요|에요|다|습니다|합니다)|(?:입니다|이다|예요|에요|습니다|합니다))/);
    /** Gender-only or gender+role noun before 로/으로 (`여자로`, `남성 경찰관으로`). */
    const roleTail = afterGender.match(/^\s*(?:[가-힣]{1,20}(?:로|으로)|(?:로|으로))(?=[\s,.!?。！？]|$)/);
    const tail = negation?.[0] ?? predicate?.[0] ?? roleTail?.[0];
    if (!tail) continue;
    const span = cueMatch[0].length + genderMatch[0].length + tail.length;
    return clipExcerpt(text, cueIndex, span);
  }
  return null;
}

/** Title subject equated with the player (`아가씨가 당신입니다`). */
function titleEquatesPlayerExcerpt(text: string): string | null {
  const match = text.match(
    new RegExp(
      `(?:${PLAYER_TITLE_SOURCE})(?:이|가)\\s*(?:${PLAYER_CUE_SOURCE})(?:입니다|이다|예요|에요|다)(?=[.!?。！？\\s]|$)`
    )
  );
  if (match?.index == null) return null;
  return clipExcerpt(text, match.index, match[0].length);
}

/** Title aimed at the player, not an NPC acting on the player. */
function titledPlayerRoleExcerpt(text: string): string | null {
  const vocative = text.match(
    new RegExp(`(?:${PLAYER_CUE_SOURCE})(?:을|를)[^.!?。！？]{0,32}(?:${PLAYER_TITLE_SOURCE})(?:로|으로)`)
  );
  if (vocative?.index != null) return clipExcerpt(text, vocative.index, vocative[0].length);
  const titleOnPlayer = text.match(
    new RegExp(
      `(?:${PLAYER_CUE_SOURCE})(?:은|는|이|가)?[^.!?。！？]{0,20}(?:${PLAYER_TITLE_SOURCE})(?:이|가)\\s*아니`
    )
  );
  if (titleOnPlayer?.index != null) return clipExcerpt(text, titleOnPlayer.index, titleOnPlayer[0].length);
  const bound = text.match(new RegExp(`(?:${PLAYER_TITLE_SOURCE})(?:인|의)?\\s*(?:${PLAYER_CUE_SOURCE})`));
  if (bound?.index != null) return clipExcerpt(text, bound.index, bound[0].length);
  const npcActs = new RegExp(
    `(?:${PLAYER_TITLE_SOURCE})(?:이|가)\\s*(?:${PLAYER_CUE_SOURCE})(?:을|를|께|에게)`
  );
  for (const match of text.matchAll(new RegExp(PLAYER_TITLE_SOURCE, "g"))) {
    const index = match.index ?? 0;
    if (text[index + match[0].length] === "님") continue;
    const local = text.slice(index, index + match[0].length + 32);
    if (npcActs.test(local)) continue;
    if (new RegExp(`(?:${PLAYER_TITLE_SOURCE})(?:이|가)\\s*(?!${PLAYER_CUE_SOURCE})`).test(local)) continue;
    let clauseStart = -1;
    for (let i = 0; i < index; i += 1) {
      if (/[.!?。！？]/u.test(text[i] ?? "")) clauseStart = i;
    }
    const clausePrefix = text.slice(clauseStart + 1, index);
    if (/(?:그녀|그는|그가)(?:는|은|이|가)?\s*[^.!?。！？]{0,96}$/u.test(clausePrefix)) continue;
    const after = text.slice(index + match[0].length, index + match[0].length + 8);
    if (/^(?:로|으로)/.test(after) && !new RegExp(PLAYER_CUE_SOURCE).test(clausePrefix)) continue;
    return clipExcerpt(text, index, match[0].length);
  }
  return null;
}

/** First phrase that fixes the player's gender or a titled player role, if any. */
function playerGenderLockExcerpt(text: string): string | null {
  return (
    genderBeforePlayerCueExcerpt(text) ??
    playerCueGenderIdentityExcerpt(text) ??
    titleEquatesPlayerExcerpt(text) ??
    titledPlayerRoleExcerpt(text)
  );
}

/** Player/user side of greeting, public intro, and creator comment must stay gender-neutral. */
export function evaluateOfficialPlayerGenderNeutral(surfaces: {
  greeting?: string;
  description?: string;
  comment?: string;
}): QaResult {
  const errors: QaIssue[] = [];
  for (const [surface, raw] of [
    ["greeting", surfaces.greeting],
    ["description", surfaces.description],
    ["comment", surfaces.comment],
  ] as const) {
    const text = (raw ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const excerpt = playerGenderLockExcerpt(text);
    if (excerpt) {
      errors.push({
        code: "official_player_gender_locked",
        message: `${surface} must not hard-code player gender or titled player roles: "${excerpt}"`,
      });
    }
  }
  return qaResult(errors);
}

function isMeterOrSecret(text: string): boolean {
  return /(신뢰|호감|경계).{0,8}(낮음|높음|미정|\d)/.test(text) || /속내:|숨김|비밀:/.test(text);
}

function uniquePhrases(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.replace(/\s+/g, "").replace(/하기$/u, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function extractPlayChoices(text: string): string[] {
  if (!text || isMeterOrSecret(text)) return [];
  const choices: string[] = [];
  // Do not turn arbitrary metadata lists (e.g. 이름·신분·성별) into fake actions.
  const midDot = text.match(
    /((?:협력|거절|이탈|거리두기|거래|공개|봉인|계약|진실추적|도주|조사))·((?:협력|거절|이탈|거리두기|거래|공개|봉인|계약|진실추적|도주|조사))·((?:협력|거절|이탈|거리두기|거래|공개|봉인|계약|진실추적|도주|조사))/
  );
  if (midDot) {
    choices.push(`${midDot[1]}하기`, `${midDot[2]}하기`, `${midDot[3]}하기`);
  }
  for (const match of text.matchAll(
    /((?:[가-힣]{1,12}(?:에\s+|를\s+|을\s+))?(?:협력|거리|거래|공개|봉인|계약|진실|도주|조사)(?:에\s+|를\s+|을\s+)?(?:할지|둘지|받을지|지킬지|풀지|좇을지|따를지))/g
  )) {
    const phrase = match[1]?.replace(/\s+/g, " ").trim();
    if (phrase && !/^(따라|하고|의|를|을)\s*/.test(phrase)) choices.push(phrase);
  }
  const roleList = text.match(/([가-힣]{2,10}자|[가-힣]{2,8} 사람)(?:,|·|\/|등)/g);
  if (roleList) {
    for (const item of roleList) {
      const role = item.replace(/[,·\/등]/g, "").trim();
      if (role) choices.push(`${role}로 움직이기`);
    }
  }
  return uniquePhrases(choices).slice(0, 3);
}

const ACTION_CHOICE_RE = /(?:하기|할지|둘지|받을지|지킬지|풀지|좇을지|따를지|움직이기)$/u;

export function officialPlayStartChoices(draft: OfficialCharacterDraft): string[] {
  const rel = draft.sections.relationshipsAndDrives;
  const userRole = pickPrefixed(rel, "유저 역할");
  const mid = pickPrefixed(rel, "중기 갈등");
  return uniquePhrases([...extractPlayChoices(userRole), ...extractPlayChoices(mid)])
    .filter((choice) => ACTION_CHOICE_RE.test(choice))
    .slice(0, 3);
}

function squashPlain(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function draftPlayGuideParts(draft: OfficialCharacterDraft): {
  situation: string;
  start: string;
} {
  const choices = officialPlayStartChoices(draft);
  return {
    situation: firstSentence(draft.hook.rpHook, 140) || firstSentence(draft.tagline, 80),
    start: choices.length > 0 ? choices.join(" · ") : "",
  };
}

/**
 * Play advice only; never a second intro. An authored `draft.creatorComment` is the
 * public text as written. Otherwise the three-part play-guide template is composed.
 */
export function composeOfficialCreatorComment(draft: OfficialCharacterDraft): string {
  const authored = draft.creatorComment?.trim();
  if (authored) return authored;
  const parts = draftPlayGuideParts(draft);
  const blocks = [`<p><b>지금 상황</b><br>${escapeHtml(parts.situation)}</p>`];
  const start = parts.start.trim();
  if (start && squashPlain(start) !== squashPlain(parts.situation)) {
    blocks.push(`<p><b>추천 플레이 방향</b><br>${escapeHtml(start)}</p>`);
  }
  return blocks.join("\n");
}


const PLAYER_GENDER_FIXED_ROLE_RE =
  /(?:여자|남자|여성|남성|아가씨|도련님|영애|영식|공녀|왕자비|황태자비|신부|신랑)/u;
const PLAYER_CUE_NEAR_GENDER_RE =
  /(?:당신|플레이어|유저)(?:은|는|이|가|을|를|의|에게|께|도|와|과)?[^.!?。！？\n]{0,32}(?:여자|남자|여성|남성|아가씨|도련님|영애|영식|공녀|왕자비|황태자비|신부|신랑)/u;
const PLAYER_GENDERED_VOCATIVE_RE =
  /[“"'‘’](?:아가씨|도련님|영애|영식|왕자비|황태자비)(?:[,，.!?…\s”"'’‘])/u;

/**
 * Official characters use one opening that must work for any player persona.
 * This gate targets the player side only; the character's own gendered identity remains intact.
 */
export function evaluateOfficialPlayerGenderNeutrality(
  draft: OfficialCharacterDraft,
  creatorComment = composeOfficialCreatorComment(draft)
): QaResult {
  const errors: QaIssue[] = [];
  const userRole = pickPrefixed(draft.sections.relationshipsAndDrives, "유저 역할");
  const scopedPlayerText = [
    userRole,
    draft.hook.relationshipTrope,
    draft.hook.rpHook,
  ]
    .filter(nonEmpty)
    .join("\n");
  const userFacingText = [draft.greeting, draft.description, creatorComment].join("\n");

  if (
    PLAYER_GENDER_FIXED_ROLE_RE.test(scopedPlayerText) ||
    PLAYER_CUE_NEAR_GENDER_RE.test(userFacingText) ||
    PLAYER_GENDERED_VOCATIVE_RE.test(draft.greeting)
  ) {
    errors.push({
      code: "official_player_gender_fixed",
      message:
        "official opening/play guidance must keep the player gender-neutral; use role/context terms such as 당신, 상대, 목격자, 계약자, 방문객, 동행자",
    });
  }
  return qaResult(errors);
}

const INTERNAL_PRODUCTION_PHRASE_RE =
  /하나의 도입 상황|단일 도입|이런 식으로 시작해 보세요|런타임|인사말은 하나|저장된 인사|프롬프트|Text Lock|공식 공급/u;

export function evaluateOfficialCreatorComment(comment: string, description: string): QaResult {
  const errors: QaIssue[] = [];
  const trimmed = comment.trim();
  if (!trimmed) {
    errors.push({ code: "creator_comment_missing", message: "official creator comment is required" });
    return qaResult(errors);
  }
  if (!/<p[\s>]/.test(trimmed) || /<(?:table|h[1-4]|style|img|div)[\s>]/i.test(trimmed)) {
    errors.push({
      code: "creator_comment_markup",
      message: "official creator comment may use only simple <p><b><br> markup",
    });
  }
  if (!trimmed.includes("지금 상황")) {
    errors.push({ code: "creator_comment_guide_missing", message: "creator comment must state the current situation" });
  }
  for (const section of [
    `[${OFFICIAL_PUBLIC_INTRO_SECTIONS.world}`,
    `[${OFFICIAL_PUBLIC_INTRO_SECTIONS.character}]`,
    `[${OFFICIAL_PUBLIC_INTRO_SECTIONS.intro}]`,
  ]) {
    if (trimmed.includes(section)) {
      errors.push({ code: "creator_comment_repeats_intro", message: "creator comment must not copy detailed-intro sections" });
      break;
    }
  }
  const commentPlain = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const introPlain = description.replace(/\s+/g, " ").trim();
  if (introPlain && commentPlain && (introPlain.includes(commentPlain) || commentPlain.includes(introPlain))) {
    errors.push({ code: "creator_comment_copy", message: "creator comment is a copy of the detailed intro" });
  }
  if (commentPlain.length >= 80 && introPlain.includes(commentPlain.slice(0, 80))) {
    errors.push({ code: "creator_comment_copy", message: "creator comment repeats the detailed intro lead" });
  }
  const situationLine = trimmed.match(/지금 상황<\/b><br>([^<]+)/)?.[1] ?? "";
  const startLine = trimmed.match(/추천 플레이 방향<\/b><br>([^<]+)/)?.[1] ?? "";
  const hasPlayDirectionSection = trimmed.includes("추천 플레이 방향");
  if (
    !hasPlayDirectionSection &&
    situationLine.trim().length >= 10
  ) {
    // Auto fallback with no concrete start choices: the situation block is the only guide.
  } else if (!USER_CUE_RE.test(commentPlain) && !/당신|역할|추천|방향|첫 인사/.test(commentPlain)) {
    errors.push({ code: "creator_comment_no_play", message: "creator comment must recommend how to play the single greeting start" });
  }
  if (/(신뢰|호감|경계).{0,8}(낮음|높음|미정|\d)/.test(commentPlain)) {
    errors.push({
      code: "creator_comment_stats",
      message: "creator comment must not dump relationship meters; it is a play start guide",
    });
  }
  if (/첫 장면에서는 목적 한 가지만|반응을 보세요/.test(commentPlain)) {
    errors.push({
      code: "creator_comment_generic",
      message: "creator comment start line must be character-specific, not a shared generic cue",
    });
  }
  if (/고르세요|중에서 먼저|첫 수를 정해|선택지|에피소드/.test(commentPlain)) {
    errors.push({
      code: "creator_comment_selectable_start",
      message: "creator comment must not imply selectable alternate starts or episodes; runtime has a single greeting",
    });
  }
  if (trimmed.includes("추천 플레이 방향") && !startLine.trim()) {
    errors.push({ code: "creator_comment_direction_missing", message: "creator comment must give a recommended play direction" });
  }
  if (
    startLine.trim() &&
    situationLine.trim() &&
    squashPlain(situationLine) === squashPlain(startLine)
  ) {
    errors.push({
      code: "creator_comment_play_direction_duplicate",
      message: "recommended play direction must not repeat the situation line",
    });
  }
  if (INTERNAL_PRODUCTION_PHRASE_RE.test(commentPlain)) {
    errors.push({
      code: "creator_comment_internal_phrase",
      message: "creator comment must read as player-facing copy, not as an explanation of runtime or production mechanics",
    });
  }
  errors.push(...evaluateOfficialPlayerGenderNeutral({ comment: trimmed }).errors);
  return qaResult(errors);
}
