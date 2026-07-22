/**
 * Scene Momentum Support (Candidate A) — COMMON deterministic pure extractor.
 *
 * `buildSceneMomentumBlock` distills a compact, descriptive, present-tense,
 * current-scene-only snapshot from already-existing scene context (recent raw
 * history + current cue + already-parsed current location/promises + peeled
 * greeting at cold-start). No LLM call. No canon compiler / ACTIVE selector /
 * Scene Engine access. No raw-history duplication. No invented
 * emotion/conflict/goal/event. No command sentences.
 *
 * Phase 1 rollout is MODEL-GATED to the DeepSeek D2 canary at the CALL SITE
 * (contextBuilder); this module is model-agnostic.
 */
import {
  SCENE_MOMENTUM_AFFORDANCES_MAX,
  SCENE_MOMENTUM_FIELD_ORDER,
  SCENE_MOMENTUM_HEADER,
  SCENE_MOMENTUM_RECENT_WINDOW,
  type SceneMomentumFields,
  type SceneMomentumInput,
  type SceneMomentumResult,
  type SceneMomentumTurn,
} from "./types";

/** Phase 1 calibration start — same value as resolveDeepSeekShortHistoryLengthExtra. */
const SHORT_HISTORY_AVG_NO_WS_THRESHOLD = 2200;

function countNoWsChars(text: string): number {
  return [...text.replace(/\s+/g, "")].length;
}

function normalizeWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Common thin/cold-start predicate — lifts the logic of
 * `resolveDeepSeekShortHistoryLengthExtra` into a model-agnostic function with the
 * same calibration threshold. A turn is thin/cold-start iff the recent-assistant
 * slice is absent (cold-start) or short on average (thin). Auto-disables as history
 * matures (the SAME predicate drives deactivation — no separate counter).
 */
export function isThinSceneHistory(
  history: { role: string; content: string }[]
): boolean {
  const recent = history
    .filter((m) => m.role === "assistant" && m.content.trim())
    .slice(-3);
  if (recent.length === 0) return true; // cold-start: no assistant turns yet
  const avg =
    recent.reduce((sum, m) => sum + countNoWsChars(m.content), 0) / recent.length;
  return avg < SHORT_HISTORY_AVG_NO_WS_THRESHOLD;
}

/** Recent-assistant slice (last up-to-3 non-empty assistant turns) — for activeTurns. */
function recentAssistantSlice(history: SceneMomentumTurn[]): SceneMomentumTurn[] {
  return history
    .filter((m) => m.role === "assistant" && m.content.trim())
    .slice(-3);
}

/** Bounded recent slice (last SCENE_MOMENTUM_RECENT_WINDOW turns) — extraction evidence. */
function boundedRecent(history: SceneMomentumTurn[]): SceneMomentumTurn[] {
  return history.slice(-SCENE_MOMENTUM_RECENT_WINDOW);
}

/**
 * Dormant canon / future-hook / command phrases that MUST NEVER appear in a momentum
 * field value. If a generated value contains any of these it is dropped (field omitted).
 * These are canon-dormant terms (separate tier) and forbidden next-event/command forms.
 */
const FORBIDDEN_MOMENTUM_TERMS = [
  // dormant canon (Enoch)
  "마더", "브레인 포드", "기생종", "기원종", "회색혈", "봉인", "창백 역변",
  "백야단", "유골상회", "아웃사이더", "느티나무",
  // dormant canon (modern)
  "하원호", "리사이틀 사태", "보라색 접이식 우산",
  // dormant canon (fantasy)
  "에일린", "은빛 손", "달이 두 개",
  // Level ladder
  "Level 1", "Level 2", "Level 3", "Level 4",
  // forbidden next-event / future-hook forms
  "나타난다", "나타날", "다음에 나", "새로운 적", "새로운 인물", "새로운 NPC",
  "이동하자", "비밀이 드러", "위협이 다", "위협이 다가",
  // forbidden command / length forms
  "continue the scene", "write longer", "make multiple beats", "write n paragraph",
  "계속해", "더 써", "여러 박자", "길게 써",
];

/** Returns true if a value contains a forbidden momentum term (case-insensitive). */
function containsForbiddenTerm(value: string): boolean {
  const v = value.toLowerCase();
  return FORBIDDEN_MOMENTUM_TERMS.some((t) => v.includes(t.toLowerCase()));
}

/**
 * No-raw-copy guard: drops a generated value if it is a verbatim substring of any
 * recent raw turn (the block must DISTILL, not copy). Templated phrases are short and
 * constructed, so this guard is a safety net against accidental raw-copy.
 */
function isRawCopyOfRecent(value: string, recent: SceneMomentumTurn[]): boolean {
  const v = normalizeWs(value);
  if (v.length < 8) return false; // too short to be a meaningful raw copy
  return recent.some((m) => normalizeWs(m.content).includes(v));
}

/**
 * Apply forbidden-term filter + no-raw-copy guard to a generated field value.
 * Returns null when the value must be omitted (forbidden, raw-copy, or empty).
 */
function sanitizeFieldValue(
  value: string | null,
  recent: SceneMomentumTurn[]
): string | null {
  if (value == null) return null;
  const v = value.trim();
  if (!v) return null;
  if (containsForbiddenTerm(v)) return null;
  if (isRawCopyOfRecent(v, recent)) return null;
  return v;
}

// ───── WHERE ─────

/** Ranked location nouns (most specific first). Scanned in recent history. */
const LOCATION_NOUNS = [
  "자취방", "오두막", "약초밭", "Safe Zone", "역장", "학원", "카페", "숲",
  "마을", "방", "거실", "주방", "오두막 안",
] as const;

/** Detect an explicit location noun in a single turn (most specific first). */
function detectLocationInText(text: string): string | null {
  for (const noun of LOCATION_NOUNS) {
    if (text.includes(noun)) {
      // Compose a present-scene location phrase.
      if (noun === "Safe Zone") return "Safe Zone 안 (역장 내)";
      if (noun === "약초밭" || noun === "오두막") return "오두막 / 약초밭";
      if (noun === "자취방") return "준서의 자취방";
      return noun;
    }
  }
  return null;
}

/**
 * WHERE: currently established location/posture.
 * Priority: 1) most recent explicit location mention in recent history,
 *           2) already-parsed currentLocation (memoryMeta), 3) peeled greeting.
 */
function extractWhere(
  recent: SceneMomentumTurn[],
  currentLocation: string | null | undefined,
  openingGreeting: string | null | undefined
): string | null {
  // 1) recent history (most recent turn first)
  for (let i = recent.length - 1; i >= 0; i--) {
    const loc = detectLocationInText(recent[i]!.content);
    if (loc) return loc;
  }
  // 2) already-parsed currentLocation
  if (currentLocation && currentLocation.trim()) {
    return currentLocation.trim();
  }
  // 3) peeled greeting (cold-start)
  if (openingGreeting && openingGreeting.trim()) {
    const loc = detectLocationInText(openingGreeting);
    if (loc) return loc;
  }
  return null;
}

// ───── WHAT IS HAPPENING ─────

/**
 * Activity anchors (deterministic). Each anchor fires a short templated present-tense
 * phrase ONLY when the anchor is detected in actual recent history — no invention.
 * Templated phrases (not verbatim snippets) guarantee no raw-history duplication.
 */
const ACTIVITY_ANCHORS: { test: RegExp; phrase: string }[] = [
  // drink offering / sharing
  { test: /(물|차|커피|캔커피|음료).{0,8}(마시|마셔|마실|데우|따르|권|내|따를|따를게)/, phrase: "음료(물·차·커피)를 권하며 함께 쉬는 중" },
  // holding / receiving a shared object
  { test: /(캔커피|받|쥐|들고|갖)/, phrase: "나누어 갖는 물건을 손에 쥔 직후" },
  // music / piano
  { test: /(쳐|연주|건반|페달|피아노)/, phrase: "건반/피아노를 다루는 중" },
  // herbs / tea (fantasy)
  { test: /(약초|이슬풀|쑥|심장초|차,)/, phrase: "약초/차를 다루며 함께 머무는 중" },
  // sitting / resting
  { test: /(앉아|앉으|쉬어|쉬자|기다려|묵어|쉬)/, phrase: "자리에서 함께 쉬는 중" },
  // staying beside (quiet relationship)
  { test: /(옆에 있|곁에 있|함께 있|남아|남아 있)/, phrase: "옆에 머물며 함께 있는 중" },
];

/**
 * WHAT IS HAPPENING: current in-progress activity/stance, present tense.
 * Lead action of the most recent assistant turn, else the action implied by the current cue.
 */
function extractWhatIsHappening(
  recent: SceneMomentumTurn[],
  currentUserMessage: string
): string | null {
  const candidates: string[] = [];
  // most recent assistant turn first
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i]!.role === "assistant") {
      candidates.push(recent[i]!.content);
      break;
    }
  }
  // then the current cue (action implied by the user cue)
  candidates.push(currentUserMessage);
  for (const text of candidates) {
    for (const anchor of ACTIVITY_ANCHORS) {
      if (anchor.test.test(text)) {
        return anchor.phrase;
      }
    }
  }
  return null;
}

// ───── UNFINISHED ─────

/** Deflection markers — a guarded near-disclosure or care redirected away. */
const DEFLECTION_MARKERS = [
  "신경 쓸 거 없", "괜찮", "아니야", "그냥", "아무것도 아", "모르겠",
  "...", "……", "별거 아니", "탓하지 마", "쓸 만했", "기분 탓",
];

/** Question markers (Korean) — an unanswered question posed to the character. */
const QUESTION_MARKERS = [
  "?", "？", "뭐", "왜", "어떻", "누구", "언제", "니$", "나$", "어$", "까$",
];

/** Detect an open immediate interaction thread in recent history. */
function detectOpenThread(
  recent: SceneMomentumTurn[]
): string | null {
  // Scan from most recent backward for a deflected assistant turn or an unanswered
  // user question immediately preceding it.
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i]!;
    if (turn.role === "assistant") {
      if (DEFLECTION_MARKERS.some((m) => turn.content.includes(m))) {
        return "직전 교류에서 감정·화제를 행동으로 흘려보낸 직후 — 아직 닫히지 않은 대화";
      }
    }
    if (turn.role === "user") {
      const endsWithQuestion = QUESTION_MARKERS.some((m) =>
        turn.content.trim().endsWith(m) || turn.content.includes("?") || turn.content.includes("？")
      );
      if (endsWithQuestion) {
        // Is there a following assistant turn in recent history that answers it?
        const next = recent[i + 1];
        const answered =
          next != null &&
          next.role === "assistant" &&
          !DEFLECTION_MARKERS.some((m) => next.content.includes(m));
        if (!answered) {
          return "직전 교류에서 던져진 질문/제안 — 아직 직접 답하지 않은 대화";
        }
      }
    }
  }
  return null;
}

/**
 * UNFINISHED: open immediate interaction thread (conservative).
 * 1) open thread detectable from recent history, 2) active promise fallback.
 * Low confidence -> omit. Never a future hook.
 */
function extractUnfinished(
  recent: SceneMomentumTurn[],
  promises: string[] | undefined
): string | null {
  const thread = detectOpenThread(recent);
  if (thread) return thread;
  // fallback: active promise (memoryMeta.promises) — read-only, only when no thread
  if (promises && promises.length > 0) {
    const first = promises[0]!.trim();
    if (first) return `남아 있는 약속 — ${first}`;
  }
  return null;
}

// ───── RELATIONSHIP STATE ─────

/** Care-action markers — affect carried by action, not declaration. */
const CARE_MARKERS = [
  "물", "마셔", "조심히", "앉으셔", "쉬어", "챙기", "물, 마셔", "내가 챙",
  "네 몫", "생존 핑계", "네 탓",
];

/** Detect speech register from recent assistant turns. */
function detectRegister(recent: SceneMomentumTurn[]): "haoche" | "haeyoche" | "banmal" | null {
  const assistantText = recent
    .filter((m) => m.role === "assistant")
    .map((m) => m.content)
    .join(" ");
  if (!assistantText.trim()) return null;
  if (/(-해요|-습니다|-습니|해요\.|세요)/.test(assistantText)) return "haeyoche";
  if (/(-다\.|-다$|-지|-야\.|-야$|-어\.|-어$|나쁘지 않았|나쁘지 않아)/.test(assistantText)) {
    return "haoche";
  }
  if (/(-어$|-어\.|-지$|쓸만|나쁘지 않았어|잘 가|가)/.test(assistantText)) return "banmal";
  return null;
}

/**
 * RELATIONSHIP STATE: descriptive affective distance/tension (descriptive, not a
 * declaration to enact). Derived from register + care actions in the recent exchange.
 */
function extractRelationshipState(recent: SceneMomentumTurn[]): string | null {
  const register = detectRegister(recent);
  if (!register) return null;
  const hasCare = CARE_MARKERS.some((m) =>
    recent.some((t) => t.content.includes(m))
  );
  if (register === "haoche") {
    return hasCare ? "과묵하지만 행동으로 챙기는 온기" : "차분하고 과묵한 거리감";
  }
  if (register === "haeyoche") {
    return hasCare ? "온화하되 단호하게 챙기는 거리감" : "온화하고 단호한 거리감";
  }
  // banmal
  return hasCare ? "차갑지만 생존 핑계로 챙기는 관계" : "차갑고 건조한 거리감";
}

// ───── AVAILABLE AFFORDANCES ─────

/** Concrete object keywords already present in the scene (bounded, up to 4). */
const AFFORDANCE_NOUNS = [
  "캔커피", "커피", "물", "차", "피아노", "건반", "페달", "약초", "이슬풀",
  "쑥", "심장초", "이불", "화로", "촛불", "블라인드", "제습기", "방독면",
  "필터", "저격총", "권총", "마체테", "상자", "바늘", "레몬",
] as const;

/**
 * AVAILABLE AFFORDANCES: concrete objects/physical givens already present in the scene
 * (from recent history + current cue's offered object). Bounded to
 * SCENE_MOMENTUM_AFFORDANCES_MAX. No introduced object/NPC/location.
 */
function extractAffordances(
  recent: SceneMomentumTurn[],
  currentUserMessage: string
): string[] {
  const found: string[] = [];
  const texts = [...recent.map((m) => m.content), currentUserMessage];
  for (const noun of AFFORDANCE_NOUNS) {
    if (found.length >= SCENE_MOMENTUM_AFFORDANCES_MAX) break;
    if (texts.some((t) => t.includes(noun)) && !found.includes(noun)) {
      found.push(noun);
    }
  }
  return found;
}

// ───── Rendering ─────

/** Anti-exemplar framing line (descriptive, mirrors the approved OPENING SCENE CONTEXT wording). */
const SCENE_MOMENTUM_FRAMING =
  "아래는 현재 장면의 이미 성립한 상태 요약이다. 연속성에 사용하되, 이 요약의 길이나 형식을 다음 답변 길이의 예시로 모방하지 않으며, 이미 장면에 존재하는 요소만 다루고 새 인물·장소·사건·비밀을 도입하지 않는다.";

function renderMomentumBlock(fields: SceneMomentumFields): string | null {
  const lines: string[] = [SCENE_MOMENTUM_HEADER, SCENE_MOMENTUM_FRAMING];
  if (fields.where) lines.push(`WHERE: ${fields.where}`);
  if (fields.whatIsHappening) lines.push(`WHAT IS HAPPENING: ${fields.whatIsHappening}`);
  if (fields.unfinished) lines.push(`UNFINISHED: ${fields.unfinished}`);
  if (fields.relationshipState) lines.push(`RELATIONSHIP STATE: ${fields.relationshipState}`);
  if (fields.availableAffordances.length > 0) {
    lines.push(`AVAILABLE AFFORDANCES: ${fields.availableAffordances.join(", ")}`);
  }
  // If only header + framing remain (no fields), there is no usable scene state.
  if (lines.length <= 2) return null;
  return lines.join("\n");
}

function fieldsPresentList(fields: SceneMomentumFields): string[] {
  const present: string[] = [];
  for (const key of SCENE_MOMENTUM_FIELD_ORDER) {
    if (key === "availableAffordances") {
      if (fields.availableAffordances.length > 0) present.push(key);
    } else if (fields[key]) {
      present.push(key);
    }
  }
  return present;
}

/**
 * Build the CURRENT SCENE CONTINUITY momentum block (Candidate A).
 *
 * Deterministic, server-side, no LLM. Returns the rendered block string, or `null`
 * when there is no usable scene state (all fields omitted) — in which case the caller
 * pushes nothing. Each field is optional and included only with clear evidence.
 */
export function buildSceneMomentumBlock(
  input: SceneMomentumInput
): SceneMomentumResult {
  const recent = boundedRecent(input.recentHistory);
  const assistantSlice = recentAssistantSlice(input.recentHistory);
  const greetingSourced = Boolean(
    input.openingGreeting && input.openingGreeting.trim() && recent.length === 0
  );

  const rawFields: SceneMomentumFields = {
    where: extractWhere(recent, input.currentLocation, input.openingGreeting),
    whatIsHappening: extractWhatIsHappening(recent, input.currentUserMessage),
    unfinished: extractUnfinished(recent, input.promises),
    relationshipState: extractRelationshipState(recent),
    availableAffordances: extractAffordances(recent, input.currentUserMessage),
  };

  // Apply forbidden-term filter + no-raw-copy guard to every scalar field.
  const fields: SceneMomentumFields = {
    where: sanitizeFieldValue(rawFields.where, recent),
    whatIsHappening: sanitizeFieldValue(rawFields.whatIsHappening, recent),
    unfinished: sanitizeFieldValue(rawFields.unfinished, recent),
    relationshipState: sanitizeFieldValue(rawFields.relationshipState, recent),
    availableAffordances: rawFields.availableAffordances
        .filter((a) => !containsForbiddenTerm(a)),
  };

  const block = renderMomentumBlock(fields);
  const fieldsPresent = fieldsPresentList(fields);

  return {
    fields,
    block,
    meta: {
      fieldsPresent,
      sourceCount: recent.length,
      activeTurns: assistantSlice.length,
      greetingSourced,
      blockChars: block ? block.length : 0,
    },
  };
}

/** Convenience: return just the rendered block string (or null), for prompt wiring. */
export function buildSceneMomentumBlockString(
  input: SceneMomentumInput
): string | null {
  return buildSceneMomentumBlock(input).block;
}
