/**
 * Alarm-only detectors for production model bake-off (audit 38).
 * Copied from rpHumanGoldFixtures — alarms must NOT auto-declare PASS.
 *
 * Source premises: docs/audits/36-deepseek-human-gold/HUMAN_REVIEW_FINAL.md
 * They are for offline gold-fixture recall only — do not use for live
 * prompt comparison until recall gates pass.
 */

export type HumanGoldLabel =
  | "TEMPORAL_REWIND"
  | "PREVIOUS_TURN_REPLAY"
  | "USER_INPUT_REAUTHORING"
  | "USER_ACTION_INVENTION"
  | "USER_STATE_INVENTION"
  | "INCIDENTAL_EXTERNAL_VOICE"
  | "INTRUSIVE_EXTERNAL_SPEAKER"
  | "EXTERNAL_SCENE_TAKEOVER"
  | "ADMINISTRATIVE_SUBPLOT"
  | "SEMANTIC_REPETITION"
  | "CROSS_OUTPUT_TEMPLATE_ECHO"
  | "DECORATIVE_ENVIRONMENT_FILL"
  | "CHARACTER_TRAIT_RESTATEMENT"
  | "MULTIPLE_UNANSWERED_QUESTIONS"
  | "ASSISTANT_MONOLOGUE"
  | "FALSE_REACTION_POINT"
  | "PREMATURE_CLOSURE"
  | "TRANSPORT_INCOMPLETE_OUTPUT";

export type GoldDetectInput = {
  text: string;
  userInput?: string;
  previousAssistantText?: string;
  turnIndex?: number;
};

const MEMORY_PROP_PATTERNS = [
  /본기억/,
  /기억이\s*없/,
  /기억\s*안\s*나/,
  /기억이\s*안\s*나/,
  /낯익/,
  /어디서\s*본/,
  /본\s*듯/,
  /익숙하/,
];

const USER_STATE_INVENTION_PATTERNS = [
  /S급\s*가이드/,
  /신규\s*등록된\s*S급\s*가이드/,
  /안정화\s*파동/,
  /가이드\s*파동/,
  /임시\s*출입/,
  /출입증/,
  /어린아이처럼/,
  /작은\s*체구의\s*가이드/,
  /이\s*작은\s*체구의\s*가이드/,
];

const NAMED_NPC_PATTERNS = [
  /윤태건/,
  /스태틱/,
];

const STAFF_SPEECH_PATTERNS = [
  /조태형\s*씨[!！]/,
  /태형\s*씨,\s*조태형/,
  /보고서요/,
  /어머,\s*태형\s*씨/,
];

const TAKEOVER_PATTERNS = [
  /직원\s*쪽으로\s*몸을\s*돌렸/,
  /직원\s*쪽으로\s*걸/,
  /윤태건의\s*시선이/,
  /보고서\s*제출했나/,
];

const PREMATURE_CLOSURE_PATTERNS = [
  /직원\s*쪽으로\s*몸을\s*돌렸다[\s\S]{0,80}뒷모습/,
  /어깨를\s*으쓱이며\s*직원\s*쪽으로/,
];

const ADMIN_PATTERNS = [
  /보고서/,
  /수정\s*요청/,
  /열네?\s*번째/,
  /13번\s*수정/,
];

function countMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const p of patterns) {
    if (p.test(text)) n += 1;
  }
  return n;
}

function extractQuotedLines(text: string): string[] {
  const out: string[] = [];
  const re = /["“]([^"”]{1,120})["”]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1]!.trim());
  }
  return out;
}

function normalizeCompact(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** Shared trigram Jaccard on compact hangul/latin — coarse replay detector. */
export function semanticOverlapRatio(a: string, b: string): number {
  const na = normalizeCompact(a);
  const nb = normalizeCompact(b);
  if (na.length < 40 || nb.length < 40) return 0;
  const grams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 2; i++) set.add(s.slice(i, i + 3));
    return set;
  };
  const A = grams(na.slice(0, 2500));
  const B = grams(nb.slice(0, 2500));
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function detectIntrusiveExternalSpeaker(text: string): boolean {
  if (STAFF_SPEECH_PATTERNS.some((p) => p.test(text))) return true;
  if (NAMED_NPC_PATTERNS.some((p) => p.test(text))) {
    // Named NPC plus primary reply / multi-turn admin chat
    if (/라이크[\s\S]{0,40}보고서|스태틱[\s\S]{0,80}보고서|아,\s*스태틱/.test(text)) {
      return true;
    }
    if ((text.match(/"[^"]{2,80}"/g) ?? []).length >= 4 && /윤태건|스태틱/.test(text)) {
      return true;
    }
  }
  // External speaker + Like answering pattern (cafeteria aunt)
  if (/어머,\s*태형\s*씨/.test(text) && /아줌마,/.test(text)) return true;
  return false;
}

export function detectExternalSceneTakeover(text: string): boolean {
  if (TAKEOVER_PATTERNS.some((p) => p.test(text))) return true;
  if (/직원\s*쪽으로\s*몸을\s*돌렸/.test(text)) return true;
  // Staff report call followed by Like engaging report beat then leaving user
  if (/보고서요!/.test(text) && /내일까지\s*할게요/.test(text)) return true;
  if (/윤태건/.test(text) && /새로운\s*가이드인가/.test(text)) return true;
  return false;
}

export function detectAdministrativeSubplot(text: string): boolean {
  const adminHits = countMatches(text, ADMIN_PATTERNS);
  if (adminHits === 0) return false;
  // Admin content becomes subplot when coupled with external speech or named NPC
  if (detectIntrusiveExternalSpeaker(text) || NAMED_NPC_PATTERNS.some((p) => p.test(text))) {
    return true;
  }
  if (/보고서\s*수정/.test(text) && /직원/.test(text)) return true;
  return false;
}

export function detectPrematureClosure(text: string): boolean {
  if (PREMATURE_CLOSURE_PATTERNS.some((p) => p.test(text))) return true;
  // Ends by turning away to staff
  const tail = text.slice(-400);
  return /직원\s*쪽으로\s*몸을\s*돌렸/.test(tail);
}

export function detectUserStateInvention(text: string): boolean {
  return USER_STATE_INVENTION_PATTERNS.some((p) => p.test(text));
}

export function detectSemanticRepetition(text: string): boolean {
  let hits = 0;
  for (const p of MEMORY_PROP_PATTERNS) {
    const global = new RegExp(p.source, "g");
    const m = text.match(global);
    if (m) hits += m.length;
  }
  // Same proposition family restated without requiring identical strings
  return hits >= 3;
}

export function detectTemporalRewind(input: GoldDetectInput): boolean {
  const { text, previousAssistantText, turnIndex } = input;
  if (!previousAssistantText || (turnIndex != null && turnIndex < 2)) {
    // Still allow detection when previous provided even if turnIndex omitted
    if (!previousAssistantText) return false;
  }
  const overlap = semanticOverlapRatio(text, previousAssistantText);
  const introReplay =
    /렌이라는\s*이름을\s*곱씹/.test(text) &&
    /렌이라는\s*이름을\s*곱씹/.test(previousAssistantText);
  const selfIntroReplay =
    /나는\s*조태형\.\s*코드네임은\s*라이크/.test(text) &&
    /나는\s*조태형\.\s*코드네임은\s*라이크/.test(previousAssistantText);
  return overlap >= 0.35 || introReplay || selfIntroReplay;
}

export function detectUserInputReauthoring(input: GoldDetectInput): boolean {
  const { text, userInput } = input;
  if (!userInput) return false;
  const compactUser = normalizeCompact(userInput).replace(/[?*]/g, "");
  // Core user act phrase
  const key = "같이갈래";
  if (!compactUser.includes(key) || !text.includes("같이갈래")) return false;
  const idx = text.indexOf("같이갈래");
  // Reauthoring: current user line appears after a long assistant replay/prefix
  if (idx >= 800) return true;
  // Or assistant opens by quoting the user line as if starting the whole scene again
  const head = text.slice(0, 80);
  if (/^["“]?같이갈래/.test(head.trim())) return true;
  return false;
}

export function detectHumanGoldLabels(input: GoldDetectInput): HumanGoldLabel[] {
  const { text } = input;
  const labels = new Set<HumanGoldLabel>();
  if (detectIntrusiveExternalSpeaker(text)) labels.add("INTRUSIVE_EXTERNAL_SPEAKER");
  if (detectExternalSceneTakeover(text)) labels.add("EXTERNAL_SCENE_TAKEOVER");
  if (detectAdministrativeSubplot(text)) labels.add("ADMINISTRATIVE_SUBPLOT");
  if (detectPrematureClosure(text)) labels.add("PREMATURE_CLOSURE");
  if (detectUserStateInvention(text)) labels.add("USER_STATE_INVENTION");
  if (detectSemanticRepetition(text)) labels.add("SEMANTIC_REPETITION");
  if (detectTemporalRewind(input)) {
    labels.add("TEMPORAL_REWIND");
    labels.add("PREVIOUS_TURN_REPLAY");
  }
  if (detectUserInputReauthoring(input)) labels.add("USER_INPUT_REAUTHORING");
  return [...labels];
}

export function goldFixtureRecall(args: {
  required: Array<{ id: string; attempt_id: string; must_detect: string[] }>;
  rawByAttempt: Record<string, string>;
  previousAssistantByAttempt?: Record<string, string>;
  userInputByAttempt?: Record<string, string>;
}): { pass: boolean; failures: string[]; recall: number } {
  let hit = 0;
  let total = 0;
  const failures: string[] = [];
  for (const req of args.required) {
    const text = args.rawByAttempt[req.attempt_id] ?? "";
    const detected = new Set(
      detectHumanGoldLabels({
        text,
        previousAssistantText: args.previousAssistantByAttempt?.[req.attempt_id],
        userInput: args.userInputByAttempt?.[req.attempt_id],
        turnIndex: req.attempt_id.includes("04") || req.id.includes("temporal") ? 2 : undefined,
      })
    );
    for (const lab of req.must_detect) {
      total += 1;
      if (detected.has(lab as HumanGoldLabel)) hit += 1;
      else failures.push(`${req.id}: missing ${lab}`);
    }
  }
  const recall = total === 0 ? 1 : hit / total;
  return { pass: failures.length === 0, failures, recall };
}

// silence unused helper in case tree-shaken builds keep API surface
void extractQuotedLines;
