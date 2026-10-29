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
/** Player-side gender/role locks. Character identity words are not in this set. */
const PLAYER_ADDRESS_LOCK_RE = /아가씨|도련님|왕자비|신부/;
const PLAYER_GENDER_COLLOCATE_RE =
  /(?:당신|플레이어|유저).{0,16}(?:여자|남자|여성|남성)|(?:여자|남자|여성|남성).{0,16}(?:당신|플레이어|유저)/;

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

/**
 * Pitch and detailed public description only. `그는`/`그가` on a female character,
 * or `그녀` on a male character. `그를`/`그의` and greeting/hidden text stay out:
 * they often name someone else.
 */
export function evaluateOfficialCharacterPronoun(
  gender: string | undefined,
  surfaces: { description?: string }
): QaResult {
  const text = (surfaces.description ?? "").replace(/\s+/g, " ").trim();
  const errors: QaIssue[] = [];
  if (!text || (gender !== "female" && gender !== "male")) return qaResult(errors);
  if (gender === "female" && /그(?:는|가)(?!녀)/u.test(text)) {
    errors.push({
      code: "official_character_pronoun",
      message: "public description refers to a female character as 그는 or 그가",
    });
  }
  if (gender === "male" && /그녀/u.test(text)) {
    errors.push({
      code: "official_character_pronoun",
      message: "public description refers to a male character as 그녀",
    });
  }
  return qaResult(errors);
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
    if (PLAYER_ADDRESS_LOCK_RE.test(text) || PLAYER_GENDER_COLLOCATE_RE.test(text)) {
      errors.push({
        code: "official_player_gender_locked",
        message: `${surface} must not hard-code player gender or titled player roles`,
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
