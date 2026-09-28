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
    usualExpression: string;
    defaultOutfit: string;
  };
  personality: { keywords: string[]; behavioral: string };
  abilities: Array<{ name: string; scope: string }>;
  situation: { worldContext: string; personalSituation: string; userEntry: string };
  userRole: string;
};

export function composeOfficialPublicDescription(input: OfficialPublicIntroInput): string {
  const id = input.identity;
  const appearance = input.appearance;
  const worldBody = firstSentences(input.situation.worldContext, 280, 3);
  const looks = firstSentences(
    [appearance.impression, appearance.usualExpression, appearance.defaultOutfit].filter(nonEmpty).join(" "),
    160,
    2
  );
  const personality = [
    input.personality.keywords.slice(0, 4).join("·"),
    firstSentence(input.personality.behavioral, 120),
  ]
    .filter(nonEmpty)
    .join(". ");
  const ability = input.abilities
    .slice(0, 2)
    .map((item) => `${item.name}${item.scope ? ` — ${firstSentence(item.scope, 70)}` : ""}`)
    .filter(nonEmpty)
    .join(" / ");
  const publicBackground =
    firstSentence(input.situation.personalSituation, 140) || firstSentence(id.worldRole, 90);
  const userRole = firstSentence(input.userRole, 80);
  const playBody = [
    withPeriod(firstSentence(input.rpHook, 140)),
    userRole ? `당신은 ${userRole.replace(/^당신은\s*/, "").replace(/[.!?。！？]+$/u, "")}.` : "",
    input.relationshipTrope ? `가능한 관계: ${input.relationshipTrope}.` : "",
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

  const playHeader = input.userRole.trim()
    ? OFFICIAL_PUBLIC_INTRO_SECTIONS.play
    : OFFICIAL_PUBLIC_INTRO_SECTIONS.relation;

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
  if (name && !text.includes(name)) {
    errors.push({ code: "public_intro_name_missing", message: "detailed intro must state the character name" });
  }
  if (!/\d+\s*세/.test(text) || !/\d+\s*cm/i.test(text)) {
    errors.push({ code: "public_intro_stats_missing", message: "detailed intro must state age and height" });
  }
  if (!/직업\/소속/.test(text) || !/외형:/.test(text) || !/성격:/.test(text) || !/능력\/역할:/.test(text)) {
    errors.push({ code: "public_intro_facts_missing", message: "detailed intro must cover occupation, looks, personality, role" });
  }
  return qaResult(errors);
}

function draftPlayGuideParts(draft: OfficialCharacterDraft): {
  situation: string;
  start: string;
  relation: string;
} {
  const rel = draft.sections.relationshipsAndDrives;
  const userRole = pickPrefixed(rel, "유저 역할");
  const start = pickPrefixed(rel, "시작점") || pickPrefixed(rel, "첫인식");
  const progress = pickPrefixed(rel, "관계 진행");
  const situation = firstSentence(draft.hook.rpHook, 140);
  const statLike = /신뢰|호감|경계/.test(start) && /\d/.test(start);
  const startLine =
    (!statLike && firstSentence(start, 120)) ||
    (userRole
      ? `${firstSentence(userRole, 40).replace(/[.!?。！？]+$/u, "")}로 시작해, 첫 장면에서는 목적 한 가지만 밝히고 반응을 보세요.`
      : "첫 만남에서 목적 한 가지만 말하고 상대의 반응을 보세요.");
  const relation = [draft.hook.relationshipTrope, userRole, progress.split("→")[0]?.trim()]
    .filter(nonEmpty)
    .slice(0, 3)
    .join(" · ");
  return {
    situation: situation || firstSentence(draft.tagline, 80),
    start: startLine,
    relation: relation || draft.hook.relationshipTrope,
  };
}

export function composeOfficialCreatorComment(draft: OfficialCharacterDraft): string {
  const parts = draftPlayGuideParts(draft);
  return [
    `<p><b>지금 상황</b><br>${escapeHtml(parts.situation)}</p>`,
    `<p><b>이렇게 시작해 보세요</b><br>${escapeHtml(parts.start)}</p>`,
    `<p><b>가능한 관계</b><br>${escapeHtml(parts.relation)}</p>`,
  ].join("\n");
}

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
  if (!trimmed.includes("지금 상황") || !trimmed.includes("이렇게 시작해") || !trimmed.includes("가능한 관계")) {
    errors.push({ code: "creator_comment_guide_missing", message: "creator comment must be a play guide (situation / start / relation)" });
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
  if (!USER_CUE_RE.test(commentPlain) && !/당신|역할|시작/.test(commentPlain)) {
    errors.push({ code: "creator_comment_no_play", message: "creator comment must tell the player how to start" });
  }
  return qaResult(errors);
}
