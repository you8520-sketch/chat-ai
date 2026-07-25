import { isInteractiveChatRuntimeMode, type ChatRuntimeMode } from "@/lib/chatRuntimeMode";

export const OWNERSHIP_SHADOW_DETECTOR_VERSION = "v2.0.0";
export const OWNERSHIP_SHADOW_PROCESSING_BUDGET_MS = 10;

export type OwnershipCategory =
  | "CLEAR_B_DIALOGUE"
  | "CLEAR_B_THOUGHT"
  | "CLEAR_B_DECISION"
  | "CLEAR_B_EMOTION"
  | "CLEAR_B_VOLUNTARY_ACTION"
  | "CLEAR_B_POSITION_POSTURE"
  | "CLEAR_B_PERCEPTION_SENSORY"
  | "CLEAR_B_MEDICAL_PHYSICAL_STATE"
  | "CLEAR_B_EXPRESSION_REACTION"
  | "CLEAR_B_UNSTATED_PREFERENCE"
  | "SAFE_A_TO_B_PHYSICAL_INTERACTION"
  | "SAFE_A_TO_B_PHYSICAL_CONSEQUENCE"
  | "SAFE_EXTERNAL_OBSERVATION"
  | "SAFE_CURRENT_USER_INPUT_GROUNDED"
  | "SAFE_USER_AUTHORED_HISTORY_GROUNDED"
  | "SOFT_AMBIGUOUS";

export type OwnershipSeverity = "HARD" | "SOFT" | "NONE";

export type OwnershipFinding = {
  category: OwnershipCategory;
  severity: OwnershipSeverity;
  confidence: number;
  personaAliasMatched: string | null;
  spanStart: number;
  spanEnd: number;
  contextGrounded: boolean;
  safeInteractionCarveOut: boolean;
  ruleId: string;
};

export type OwnershipShadowDetectionOpts = {
  mode?: ChatRuntimeMode;
  userAliases?: string[];
  actorNames?: string[];
  currentUserInput?: string;
  userAuthoredHistory?: string[];
};

export type OwnershipShadowDetectionResult = {
  version: typeof OWNERSHIP_SHADOW_DETECTOR_VERSION;
  findings: OwnershipFinding[];
  hardCount: number;
  softCount: number;
  noneCount: number;
  contextGroundedCount: number;
  safeCarveOutCount: number;
  categoryCounts: Partial<Record<OwnershipCategory, number>>;
  categoryBitmask: number;
  confidenceBucket: "low" | "medium" | "high";
  processingMs: number;
  budgetExceeded: boolean;
};

export type OwnershipShadowPrivacyLog = {
  detectorVersion: typeof OWNERSHIP_SHADOW_DETECTOR_VERSION;
  messageRef: string | number | null;
  chatId: number | null;
  mode: ChatRuntimeMode;
  hardCount: number;
  softCount: number;
  contextGroundedCount: number;
  safeCarveOutCount: number;
  categoryBitmask: number;
  categoryCounts: Partial<Record<OwnershipCategory, number>>;
  confidenceBucket: "low" | "medium" | "high";
  modelId: string | null;
  route: string;
  outputCharBucket: string;
  processingMs: number;
  budgetExceeded: boolean;
  autoRepairEnabled: boolean;
};

const CATEGORY_BIT: Partial<Record<OwnershipCategory, number>> = {
  CLEAR_B_DIALOGUE: 1 << 0,
  CLEAR_B_THOUGHT: 1 << 1,
  CLEAR_B_DECISION: 1 << 2,
  CLEAR_B_EMOTION: 1 << 3,
  CLEAR_B_VOLUNTARY_ACTION: 1 << 4,
  CLEAR_B_POSITION_POSTURE: 1 << 5,
  CLEAR_B_PERCEPTION_SENSORY: 1 << 6,
  CLEAR_B_MEDICAL_PHYSICAL_STATE: 1 << 7,
  CLEAR_B_EXPRESSION_REACTION: 1 << 8,
  CLEAR_B_UNSTATED_PREFERENCE: 1 << 9,
  SAFE_A_TO_B_PHYSICAL_INTERACTION: 1 << 10,
  SAFE_A_TO_B_PHYSICAL_CONSEQUENCE: 1 << 11,
  SAFE_EXTERNAL_OBSERVATION: 1 << 12,
  SAFE_CURRENT_USER_INPUT_GROUNDED: 1 << 13,
  SAFE_USER_AUTHORED_HISTORY_GROUNDED: 1 << 14,
  SOFT_AMBIGUOUS: 1 << 15,
};

const HARD_CATEGORIES = new Set<OwnershipCategory>([
  "CLEAR_B_DIALOGUE",
  "CLEAR_B_THOUGHT",
  "CLEAR_B_DECISION",
  "CLEAR_B_EMOTION",
  "CLEAR_B_VOLUNTARY_ACTION",
  "CLEAR_B_POSITION_POSTURE",
  "CLEAR_B_PERCEPTION_SENSORY",
  "CLEAR_B_MEDICAL_PHYSICAL_STATE",
  "CLEAR_B_EXPRESSION_REACTION",
  "CLEAR_B_UNSTATED_PREFERENCE",
]);

const SAFE_CATEGORIES = new Set<OwnershipCategory>([
  "SAFE_A_TO_B_PHYSICAL_INTERACTION",
  "SAFE_A_TO_B_PHYSICAL_CONSEQUENCE",
  "SAFE_EXTERNAL_OBSERVATION",
  "SAFE_CURRENT_USER_INPUT_GROUNDED",
  "SAFE_USER_AUTHORED_HISTORY_GROUNDED",
]);

type SentenceSpan = { start: number; end: number; text: string; index: number };

type RuleHit = {
  category: OwnershipCategory;
  ruleId: string;
  confidence: number;
  alias: string | null;
  safeCarveOut?: boolean;
  contextGrounded?: boolean;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAliases(raw: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of raw ?? []) {
    const trimmed = alias.trim();
    if (trimmed.length < 1 || trimmed.length > 24) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  if (!out.some((a) => a === "[B]")) out.unshift("[B]");
  if (!out.some((a) => a.toLowerCase() === "{{user}}")) out.push("{{user}}");
  return out;
}

function normalizeActorNames(raw: string[] | undefined): string[] {
  return (raw ?? [])
    .map((n) => n.trim())
    .filter((n) => n.length >= 1 && n.length <= 24);
}

function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const re = /[^.!?\n]+(?:[.!?…]+|$)|[^\n]+(?=\n|$)/g;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(text)) !== null) {
    const chunk = m[0].trim();
    if (!chunk) continue;
    const start = m.index + m[0].indexOf(chunk);
    const end = start + chunk.length;
    spans.push({ start, end, text: chunk, index: index++ });
  }
  if (spans.length === 0 && text.trim()) {
    spans.push({ start: 0, end: text.length, text: text.trim(), index: 0 });
  }
  return spans;
}

function aliasPattern(aliases: string[]): string {
  return aliases.map((a) => escapeRegExp(a)).join("|");
}

const USER_PERSONA_SUBJECT_PARTICLES = "(?:은|는|이|가|도|과|와|까지|마저|조차)";

function buildAliasSubjectRe(aliases: string[]): RegExp {
  return new RegExp(`(?:${aliasPattern(aliases)})\\s*${USER_PERSONA_SUBJECT_PARTICLES}`, "i");
}

function buildAliasPossessiveRe(aliases: string[]): RegExp {
  return new RegExp(`(?:${aliasPattern(aliases)})\\s*의`, "i");
}

function findMatchedAlias(text: string, aliases: string[]): string | null {
  for (const alias of aliases) {
    const re = new RegExp(`${escapeRegExp(alias)}\\s*(?:은|는|이|가|의|에게|을|를)`, "i");
    if (re.test(text)) return alias;
    if (alias === "[B]" && /\[B\]/i.test(text)) return "[B]";
    if (alias.toLowerCase() === "{{user}}" && /\{\{user\}\}/i.test(text)) return "{{user}}";
  }
  return null;
}

function isAboutUserPersona(
  text: string,
  aliases: string[],
  subjectRe: RegExp,
  possessiveRe: RegExp
): boolean {
  if (subjectRe.test(text)) return true;
  if (possessiveRe.test(text)) return true;
  if (/\[B\]/i.test(text)) return true;
  if (/\{\{user\}\}/i.test(text)) return true;
  return aliases.some((alias) => {
    if (alias === "[B]" || alias.toLowerCase() === "{{user}}") return false;
    return new RegExp(`${escapeRegExp(alias)}`, "i").test(text);
  });
}

function normalizeGroundingText(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/[「」『』""'']/g, "")
    .replace(/[*_~]/g, "")
    .toLowerCase();
}

function extractGroundingNeedles(sentence: string, alias: string | null): string[] {
  let body = sentence;
  if (alias) body = body.replace(new RegExp(escapeRegExp(alias), "gi"), "");
  body = body.replace(/\[B\]/gi, "").replace(/\{\{user\}\}/gi, "");
  const normalized = normalizeGroundingText(body);
  if (normalized.length < 4) return [];
  const needles: string[] = [];
  const windowSizes = [12, 10, 8, 6, 4];
  for (const len of windowSizes) {
    if (normalized.length < len) continue;
    const start = Math.max(0, Math.floor((normalized.length - len) / 2));
    const sub = normalized.slice(start, start + len);
    if (!needles.includes(sub)) needles.push(sub);
    if (needles.length >= 4) break;
  }
  return needles;
}

function isContextGrounded(
  sentence: string,
  alias: string | null,
  currentUserInput?: string,
  userAuthoredHistory?: string[]
): boolean {
  const needles = extractGroundingNeedles(sentence, alias);
  if (needles.length === 0) return false;
  const current = normalizeGroundingText(currentUserInput ?? "");
  if (current && needles.some((n) => current.includes(n))) return true;
  const userHistory = normalizeGroundingText((userAuthoredHistory ?? []).join("\n"));
  if (userHistory && needles.some((n) => userHistory.includes(n))) return true;
  return false;
}

function actorPattern(actorNames: string[]): string {
  return actorNames.map((n) => escapeRegExp(n)).join("|");
}

function matchesSafeActorToUserPhysical(
  sentence: string,
  aliases: string[],
  actorNames: string[]
): RuleHit | null {
  if (actorNames.length === 0) return null;
  const actors = actorPattern(actorNames);
  const alias = aliasPattern(aliases);
  const patterns: Array<{ re: RegExp; ruleId: string }> = [
    {
      re: new RegExp(
        `(?:${actors})\\s*(?:은|는|이|가)?[^.\\n]{0,48}(?:${alias})\\s*(?:의|을|를|에게|을)?[^.\\n]{0,24}(?:잡|밀|당기|끌|밀어|명령|바라보|응시|비웠|비켜|잡아|다가|끌어|밀어\\s*넣|손짓|지시)`,
        "i"
      ),
      ruleId: "safe_a_to_b_physical_v1",
    },
    {
      re: new RegExp(
        `(?:${actors})\\s*(?:은|는|이|가)?[^.\\n]{0,40}(?:${alias})\\s*(?:에게|한테)[^.\\n]{0,40}(?:명령|지시|말했|외쳤|속삭)`,
        "i"
      ),
      ruleId: "safe_a_to_b_command_v1",
    },
    {
      re: new RegExp(`(?:${alias})\\s*(?:에게|한테)\\s*[^.\\n]{0,24}(?:다가|손을\\s*내밀|건네)`, "i"),
      ruleId: "safe_a_to_user_direction_v1",
    },
  ];
  for (const { re, ruleId } of patterns) {
    if (re.test(sentence)) {
      return {
        category: "SAFE_A_TO_B_PHYSICAL_INTERACTION",
        ruleId,
        confidence: 0.95,
        alias: findMatchedAlias(sentence, aliases),
        safeCarveOut: true,
      };
    }
  }
  return null;
}

function matchesSafePhysicalConsequence(
  sentence: string,
  aliases: string[],
  actorNames: string[],
  priorSentences: SentenceSpan[]
): RuleHit | null {
  const alias = aliasPattern(aliases);
  const consequenceRe = new RegExp(
    `(?:${alias})\\s*(?:의\\s*)?(?:몸|몸이|어깨|팔|손|다리)[^.\\n]{0,24}(?:밀려|밀려나|흔들|기울|넘어|미끄|뒤로\\s*물러)`,
    "i"
  );
  if (!consequenceRe.test(sentence)) return null;

  const actorCauseRe =
    actorNames.length > 0
      ? new RegExp(
          `(?:${actorPattern(actorNames)})\\s*(?:은|는|이|가)?[^.\\n]{0,48}(?:${alias})\\s*(?:의|을|를)?[^.\\n]{0,24}(?:밀|당기|밀어|잡|끌|밀어\\s*넣)`,
          "i"
        )
      : null;

  const window = [sentence, ...priorSentences.slice(-2).map((s) => s.text)].join(" ");
  if (actorCauseRe?.test(window) || /힘에|충격에|밀치|밀어붙|밀었/i.test(window)) {
    const sustainedPosture =
      /(?:은|는|이|가)[^.\\n]{0,20}(?:서\\s*있|앉|기대|뒤에\\s*서|문\\s*앞|문가|자리에\\s*서)/i.test(
        sentence
      );
    if (sustainedPosture) return null;
    return {
      category: "SAFE_A_TO_B_PHYSICAL_CONSEQUENCE",
      ruleId: "safe_physical_consequence_v1",
      confidence: 0.9,
      alias: findMatchedAlias(sentence, aliases),
      safeCarveOut: true,
    };
  }
  return null;
}

function matchesExternalObservation(
  sentence: string,
  aliases: string[],
  actorNames: string[]
): RuleHit | null {
  if (actorNames.length === 0) return null;
  const alias = aliasPattern(aliases);
  const actors = actorPattern(actorNames);
  const re = new RegExp(
    `(?:${actors})\\s*(?:은|는|이|가)?[^.\\n]{0,40}(?:${alias})\\s*(?:의|을|를)?[^.\\n]{0,24}(?:바라보|응시|훑|돌아보|향해\\s*시선)`,
    "i"
  );
  if (re.test(sentence)) {
    return {
      category: "SAFE_EXTERNAL_OBSERVATION",
      ruleId: "safe_external_observation_v1",
      confidence: 0.75,
      alias: findMatchedAlias(sentence, aliases),
      safeCarveOut: true,
    };
  }
  return null;
}

type ViolationRule = {
  category: OwnershipCategory;
  ruleId: string;
  confidence: number;
  subjectRequired?: boolean;
  possessiveRequired?: boolean;
  keywordRe: RegExp;
};

function hasUserSubject(text: string, subjectRe: RegExp): boolean {
  return (
    subjectRe.test(text) ||
    /\[B\]\s*(?:은|는|이|가|도)/i.test(text) ||
    /\{\{user\}\}\s*(?:은|는|이|가|도)/i.test(text)
  );
}

function hasUserPossessive(text: string, possessiveRe: RegExp): boolean {
  return possessiveRe.test(text);
}

function buildViolationRules(aliases: string[]): ViolationRule[] {
  return [
    {
      category: "CLEAR_B_DIALOGUE",
      ruleId: "b_dialogue_v1",
      confidence: 0.95,
      subjectRequired: true,
      keywordRe: /(?:말했|대답했|되물었|중얼거렸|속삭였|물었|외쳤|입을\s*열)/i,
    },
    {
      category: "CLEAR_B_DIALOGUE",
      ruleId: "b_quoted_dialogue_v1",
      confidence: 0.95,
      subjectRequired: true,
      keywordRe: /[:：]?\s*[「『"\u201c][^\n]{1,120}[」』"\u201d]/i,
    },
    {
      category: "CLEAR_B_THOUGHT",
      ruleId: "b_thought_v1",
      confidence: 0.92,
      subjectRequired: true,
      keywordRe: /(?:생각했|마음속|머릿속|속으로|마음\s*한\s*켠|떠올)/i,
    },
    {
      category: "CLEAR_B_DECISION",
      ruleId: "b_decision_v1",
      confidence: 0.92,
      subjectRequired: true,
      keywordRe: /(?:결심|결정|마음을?\s*먹|동의|거절|선택|하기로\s*했)/i,
    },
    {
      category: "CLEAR_B_EMOTION",
      ruleId: "b_emotion_v1",
      confidence: 0.9,
      subjectRequired: true,
      keywordRe: /(?:겁먹|두려|화가|슬퍼|기뻐|불안|당황|안도|분노|짜증)/i,
    },
    {
      category: "CLEAR_B_UNSTATED_PREFERENCE",
      ruleId: "b_preference_v1",
      confidence: 0.88,
      subjectRequired: true,
      keywordRe: /(?:싫어|좋아|원하|선호|미워|원치\s*않)/i,
    },
    {
      category: "CLEAR_B_VOLUNTARY_ACTION",
      ruleId: "b_voluntary_action_v1",
      confidence: 0.9,
      subjectRequired: true,
      keywordRe:
        /(?:시선을|아무\s*말도|가만히\s*서|함께\s*물러|움직|고개를|손을\s*뻗|입을\s*열|몸을\s*돌|자리를\s*떴|뒤돌|나갔|따르|듣고\s*있)/i,
    },
    {
      category: "CLEAR_B_POSITION_POSTURE",
      ruleId: "b_position_posture_v1",
      confidence: 0.92,
      subjectRequired: true,
      keywordRe:
        /(?:서\s*있|앉|기대|문\s*앞|문가|뒤에\s*서|등받이|곁에|자리에|서서|걸터앉|엎드|무릎\s*꿇)/i,
    },
    {
      category: "CLEAR_B_POSITION_POSTURE",
      ruleId: "b_position_possessive_v1",
      confidence: 0.9,
      possessiveRequired: true,
      keywordRe:
        /(?:뒷머리|어깨|손|몸|등|발|무릎).{0,24}(?:닿|떨어|기대|서|앉|기울)|(?:어깨|몸).{0,12}떨어져/i,
    },
    {
      category: "CLEAR_B_PERCEPTION_SENSORY",
      ruleId: "b_perception_v1",
      confidence: 0.92,
      subjectRequired: true,
      keywordRe: /(?:들었다|들었|들은|보았|느꼈|냄새|목소리를|시야|귀에|눈에\s*들어)/i,
    },
    {
      category: "CLEAR_B_PERCEPTION_SENSORY",
      ruleId: "b_perception_possessive_v1",
      confidence: 0.9,
      possessiveRequired: true,
      keywordRe: /(?:머릿속|뇌|귀|눈|감각).{0,24}(?:울|들|번|느껴|스치)/i,
    },
    {
      category: "CLEAR_B_MEDICAL_PHYSICAL_STATE",
      ruleId: "b_medical_v1",
      confidence: 0.92,
      subjectRequired: true,
      keywordRe: /(?:감염|포드|브레인|상태|맥박|숨소리|증상|체온|부상|상처)/i,
    },
    {
      category: "CLEAR_B_MEDICAL_PHYSICAL_STATE",
      ruleId: "b_medical_possessive_v1",
      confidence: 0.9,
      possessiveRequired: true,
      keywordRe: /(?:맥박|숨소리|체온|상태|몸|피부|상처|감염).{0,24}(?:안정|불안|빠르|느리|뜨|차|아프)/i,
    },
    {
      category: "CLEAR_B_EXPRESSION_REACTION",
      ruleId: "b_expression_v1",
      confidence: 0.9,
      possessiveRequired: true,
      keywordRe: /(?:눈동자|표정|얼굴|입술|눈).{0,24}(?:움직|빛|반짝|흔들|굳|부드|받아들)/i,
    },
    {
      category: "CLEAR_B_EXPRESSION_REACTION",
      ruleId: "b_expression_subject_v1",
      confidence: 0.88,
      subjectRequired: true,
      keywordRe: /(?:받아들일\s*준비|표정은|얼굴이)/i,
    },
  ];
}

function matchesViolationRule(
  text: string,
  rule: ViolationRule,
  subjectRe: RegExp,
  possessiveRe: RegExp
): boolean {
  if (rule.subjectRequired && !hasUserSubject(text, subjectRe)) return false;
  if (rule.possessiveRequired && !hasUserPossessive(text, possessiveRe)) return false;
  return rule.keywordRe.test(text);
}

function classifySentence(
  sentence: SentenceSpan,
  priorSentences: SentenceSpan[],
  aliases: string[],
  actorNames: string[],
  violationRules: ViolationRule[],
  opts: OwnershipShadowDetectionOpts,
  subjectRe: RegExp,
  possessiveRe: RegExp
): RuleHit | null {
  const text = sentence.text;
  if (!isAboutUserPersona(text, aliases, subjectRe, possessiveRe)) return null;

  const alias = findMatchedAlias(text, aliases);
  const grounded = isContextGrounded(
    text,
    alias,
    opts.currentUserInput,
    opts.userAuthoredHistory
  );
  if (grounded) {
    const source =
      normalizeGroundingText(opts.currentUserInput ?? "").length > 0 &&
      extractGroundingNeedles(text, alias).some((n) =>
        normalizeGroundingText(opts.currentUserInput ?? "").includes(n)
      )
        ? "SAFE_CURRENT_USER_INPUT_GROUNDED"
        : "SAFE_USER_AUTHORED_HISTORY_GROUNDED";
    return {
      category: source,
      ruleId: "context_grounding_v1",
      confidence: 0.85,
      alias,
      contextGrounded: true,
      safeCarveOut: true,
    };
  }

  const safePhysical = matchesSafeActorToUserPhysical(text, aliases, actorNames);
  if (safePhysical) return safePhysical;

  const safeConsequence = matchesSafePhysicalConsequence(
    text,
    aliases,
    actorNames,
    priorSentences
  );
  if (safeConsequence) return safeConsequence;

  for (const rule of violationRules) {
    if (matchesViolationRule(text, rule, subjectRe, possessiveRe)) {
      return {
        category: rule.category,
        ruleId: rule.ruleId,
        confidence: rule.confidence,
        alias,
      };
    }
  }

  const external = matchesExternalObservation(text, aliases, actorNames);
  if (external) return external;

  if (subjectRe.test(text) || possessiveRe.test(text)) {
    return {
      category: "SOFT_AMBIGUOUS",
      ruleId: "soft_ambiguous_v1",
      confidence: 0.55,
      alias,
    };
  }

  return null;
}

function toSeverity(category: OwnershipCategory): OwnershipSeverity {
  if (SAFE_CATEGORIES.has(category)) return "NONE";
  if (category === "SOFT_AMBIGUOUS") return "SOFT";
  if (HARD_CATEGORIES.has(category)) return "HARD";
  return "NONE";
}

function aggregateConfidence(findings: OwnershipFinding[]): "low" | "medium" | "high" {
  const hard = findings.filter((f) => f.severity === "HARD");
  if (hard.length === 0) return "low";
  const avg = hard.reduce((sum, f) => sum + f.confidence, 0) / hard.length;
  if (avg >= 0.9) return "high";
  if (avg >= 0.75) return "medium";
  return "low";
}

export function detectOwnershipShadowV2(
  text: string,
  opts?: OwnershipShadowDetectionOpts
): OwnershipShadowDetectionResult {
  const started = performance.now();
  const mode = opts?.mode ?? "interactive";
  if (!isInteractiveChatRuntimeMode(mode)) {
    return {
      version: OWNERSHIP_SHADOW_DETECTOR_VERSION,
      findings: [],
      hardCount: 0,
      softCount: 0,
      noneCount: 0,
      contextGroundedCount: 0,
      safeCarveOutCount: 0,
      categoryCounts: {},
      categoryBitmask: 0,
      confidenceBucket: "low",
      processingMs: performance.now() - started,
      budgetExceeded: false,
    };
  }

  const prose = text.trim();
  const aliases = normalizeAliases(opts?.userAliases);
  const actorNames = normalizeActorNames(opts?.actorNames);
  const violationRules = buildViolationRules(aliases);
  const sentences = splitSentences(prose);
  const findings: OwnershipFinding[] = [];

  const subjectRe = buildAliasSubjectRe(aliases);
  const possessiveRe = buildAliasPossessiveRe(aliases);

  for (let i = 0; i < sentences.length; i++) {
    if (performance.now() - started > OWNERSHIP_SHADOW_PROCESSING_BUDGET_MS) break;
    const sentence = sentences[i]!;
    const prior = sentences.slice(Math.max(0, i - 2), i);
    const hit = classifySentence(
      sentence,
      prior,
      aliases,
      actorNames,
      violationRules,
      opts ?? {},
      subjectRe,
      possessiveRe
    );
    if (!hit) continue;
    findings.push({
      category: hit.category,
      severity: toSeverity(hit.category),
      confidence: hit.confidence,
      personaAliasMatched: hit.alias,
      spanStart: sentence.start,
      spanEnd: sentence.end,
      contextGrounded: hit.contextGrounded ?? false,
      safeInteractionCarveOut: hit.safeCarveOut ?? false,
      ruleId: hit.ruleId,
    });
  }

  const processingMs = performance.now() - started;
  const categoryCounts: Partial<Record<OwnershipCategory, number>> = {};
  let categoryBitmask = 0;
  let hardCount = 0;
  let softCount = 0;
  let noneCount = 0;
  let contextGroundedCount = 0;
  let safeCarveOutCount = 0;

  for (const finding of findings) {
    categoryCounts[finding.category] = (categoryCounts[finding.category] ?? 0) + 1;
    categoryBitmask |= CATEGORY_BIT[finding.category] ?? 0;
    if (finding.severity === "HARD") hardCount++;
    else if (finding.severity === "SOFT") softCount++;
    else noneCount++;
    if (finding.contextGrounded) contextGroundedCount++;
    if (finding.safeInteractionCarveOut) safeCarveOutCount++;
  }

  return {
    version: OWNERSHIP_SHADOW_DETECTOR_VERSION,
    findings,
    hardCount,
    softCount,
    noneCount,
    contextGroundedCount,
    safeCarveOutCount,
    categoryCounts,
    categoryBitmask,
    confidenceBucket: aggregateConfidence(findings),
    processingMs,
    budgetExceeded: processingMs > OWNERSHIP_SHADOW_PROCESSING_BUDGET_MS,
  };
}

export function bucketOutputChars(chars: number): string {
  if (chars <= 0) return "0";
  if (chars < 500) return "<500";
  if (chars < 1000) return "500-999";
  if (chars < 2000) return "1000-1999";
  if (chars < 4000) return "2000-3999";
  return "4000+";
}

export function runOwnershipShadowDetectorV2Safely(
  text: string,
  opts?: OwnershipShadowDetectionOpts
): OwnershipShadowDetectionResult | null {
  try {
    return detectOwnershipShadowV2(text, opts);
  } catch (err) {
    console.warn("[OwnershipShadowV2] detector failed safely", (err as Error).message);
    return null;
  }
}

export function logOwnershipShadowV2(payload: OwnershipShadowPrivacyLog): void {
  if (process.env.NODE_ENV === "production" && payload.hardCount === 0 && payload.softCount === 0) {
    return;
  }
  console.log("[OwnershipShadowV2]", {
    detectorVersion: payload.detectorVersion,
    messageRef: payload.messageRef,
    chatId: payload.chatId,
    mode: payload.mode,
    hardCount: payload.hardCount,
    softCount: payload.softCount,
    contextGroundedCount: payload.contextGroundedCount,
    safeCarveOutCount: payload.safeCarveOutCount,
    categoryBitmask: payload.categoryBitmask,
    categoryCounts: payload.categoryCounts,
    confidenceBucket: payload.confidenceBucket,
    modelId: payload.modelId,
    route: payload.route,
    outputCharBucket: payload.outputCharBucket,
    processingMs: Math.round(payload.processingMs * 100) / 100,
    budgetExceeded: payload.budgetExceeded,
    autoRepairEnabled: payload.autoRepairEnabled,
  });
}

export function buildOwnershipShadowPrivacyLog(input: {
  result: OwnershipShadowDetectionResult;
  messageRef: string | number | null;
  chatId: number | null;
  mode: ChatRuntimeMode;
  modelId: string | null;
  route: string;
  outputChars: number;
  autoRepairEnabled: boolean;
}): OwnershipShadowPrivacyLog {
  return {
    detectorVersion: input.result.version,
    messageRef: input.messageRef,
    chatId: input.chatId,
    mode: input.mode,
    hardCount: input.result.hardCount,
    softCount: input.result.softCount,
    contextGroundedCount: input.result.contextGroundedCount,
    safeCarveOutCount: input.result.safeCarveOutCount,
    categoryBitmask: input.result.categoryBitmask,
    categoryCounts: input.result.categoryCounts,
    confidenceBucket: input.result.confidenceBucket,
    modelId: input.modelId,
    route: input.route,
    outputCharBucket: bucketOutputChars(input.outputChars),
    processingMs: input.result.processingMs,
    budgetExceeded: input.result.budgetExceeded,
    autoRepairEnabled: input.autoRepairEnabled,
  };
}

export const OWNERSHIP_SHADOW_CATEGORY_LIST: OwnershipCategory[] = [
  "CLEAR_B_DIALOGUE",
  "CLEAR_B_THOUGHT",
  "CLEAR_B_DECISION",
  "CLEAR_B_EMOTION",
  "CLEAR_B_VOLUNTARY_ACTION",
  "CLEAR_B_POSITION_POSTURE",
  "CLEAR_B_PERCEPTION_SENSORY",
  "CLEAR_B_MEDICAL_PHYSICAL_STATE",
  "CLEAR_B_EXPRESSION_REACTION",
  "CLEAR_B_UNSTATED_PREFERENCE",
  "SAFE_A_TO_B_PHYSICAL_INTERACTION",
  "SAFE_A_TO_B_PHYSICAL_CONSEQUENCE",
  "SAFE_EXTERNAL_OBSERVATION",
  "SAFE_CURRENT_USER_INPUT_GROUNDED",
  "SAFE_USER_AUTHORED_HISTORY_GROUNDED",
  "SOFT_AMBIGUOUS",
];
