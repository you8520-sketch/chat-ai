/**
 * Memory summary scopes — main_canon / noncanon / branch_canon / preference / empty_ooc.
 * Classification + inclusion rules are pure (no live LLM).
 */
import type { DialogueTurn } from "@/lib/hybridMemory";
import { classifyChatOocIntent } from "@/lib/chatOocPriority";
import { extractOocSnippets } from "@/lib/userImpersonationPolicy";
import { ROLLING_SUMMARY_MAX_CHARS } from "./memory-constants";

export const MEMORY_SUMMARY_SCOPES = [
  "main_canon",
  "noncanon",
  "branch_canon",
  "preference",
  "empty_ooc",
] as const;

export type MemorySummaryScope = (typeof MEMORY_SUMMARY_SCOPES)[number];

/** Legacy DB values still accepted. */
export type LegacySummaryKind = "narrative" | "ooc_only";
export type SummaryKind = MemorySummaryScope | LegacySummaryKind;

export type BranchStatus = "active" | "closed";

export type ScopePayloadV1 = {
  v: 1;
  scopes: Partial<Record<MemorySummaryScope, string>>;
  branchId?: string | null;
  branchStatus?: BranchStatus | null;
  promotedBy?: string | null;
  promotedAt?: string | null;
  sourceMessageIds?: number[];
  inactive?: boolean;
};

export type TurnScopeClass =
  | "main_rp"
  | "meaningful_noncanon"
  | "plain_ooc"
  | "preference"
  | "branch_continue"
  | "branch_close"
  | "main_adopt";

const MEANINGFUL_NONCANON_RE =
  /(?:IF|이프|카피\s*페|카피페|번외|패러디|가상\s*(?:상황|분기|세계)|일회성|외전|what[\s-]*if|copy\s*pasta|패러렐|현대\s*(?:회사|세계)|반응\s*모음|비정사|정사\s*아님)/i;

const PLAIN_OOC_RE =
  /(?:문체|짧게|길게|더\s*짧게|더\s*길게|오류|정정|오타|기능|UI|유아이|버그|설정|모델|토큰|글자\s*수|길이\s*조절|다시\s*써|재생성\s*해)/i;

const PREFERENCE_RE =
  /(?:앞으로|앞으로\s*는|항상|앞으로\s*적용|취향|형식\s*요청|스타일\s*유지|말투\s*는|서술\s*은)/i;

const BRANCH_CONTINUE_RE =
  /(?:계속|이어서|다음\s*장면|그\s*뒤(?:에|는)?|그대로\s*진행|이\s*장면\s*이어|IF\s*이어|아까\s*IF)/i;

const BRANCH_CLOSE_RE =
  /(?:본편으로\s*돌아가|원래\s*시간대|IF\s*종료|이건\s*여기까지|본편에\s*반영하지\s*마|정사\s*아님|카피페로만)/i;

const MAIN_ADOPT_RE =
  /(?:이걸\s*본편으로|실제\s*있었던\s*일로|현재\s*타임라인으로\s*확정|앞으로\s*이\s*전개를\s*반영)/i;

const APPRECIATION_ONLY_RE =
  /^(?:\s*(?:재밌다|재밌네|좋네|좋다|ㅋㅋ+|ㅎㅎ+|와우|대박|헐)[\s!.~ㅋㅎ]*)$/i;

/** Marker stored for empty_ooc batches (legacy-compatible). */
export const EMPTY_OOC_SUMMARY_MARKER = "__SUMMARY_KIND_OOC_ONLY__";
export const OOC_ONLY_SUMMARY_MARKER = EMPTY_OOC_SUMMARY_MARKER;

export function normalizeSummaryScope(
  raw: string | null | undefined
): MemorySummaryScope {
  const k = (raw ?? "").trim();
  if (k === "ooc_only" || k === "empty_ooc") return "empty_ooc";
  if (k === "narrative" || k === "main_canon") return "main_canon";
  if (k === "noncanon") return "noncanon";
  if (k === "branch_canon") return "branch_canon";
  if (k === "preference") return "preference";
  return "main_canon";
}

/** Persist kind string (prefer modern names; keep empty_ooc not ooc_only for new writes). */
export function toPersistedSummaryKind(scope: MemorySummaryScope): MemorySummaryScope {
  return scope;
}

export function isEmptyOocScope(raw: string | null | undefined): boolean {
  return normalizeSummaryScope(raw) === "empty_ooc";
}

export function isOocOnlySummaryKind(raw: string | null | undefined): boolean {
  return isEmptyOocScope(raw);
}

export function parseScopePayload(raw: string | null | undefined): ScopePayloadV1 | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as ScopePayloadV1;
    if (parsed?.v !== 1 || typeof parsed.scopes !== "object" || !parsed.scopes) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encodeScopePayload(payload: ScopePayloadV1): string {
  return JSON.stringify(payload);
}

export function scopesInjectedIntoPrompt(scope: MemorySummaryScope): boolean {
  return scope === "main_canon" || scope === "branch_canon" || scope === "preference";
}

export function scopesIncludedInLorebookCompact(scope: MemorySummaryScope): boolean {
  return scopesInjectedIntoPrompt(scope);
}

export function scopesVisibleInHistory(scope: MemorySummaryScope): boolean {
  // empty_ooc hidden by default from history list
  return scope !== "empty_ooc";
}

export function historyScopeLabel(scope: MemorySummaryScope): string {
  switch (scope) {
    case "main_canon":
      return "본편";
    case "branch_canon":
      return "현재 분기";
    case "noncanon":
      return "비정사·번외";
    case "preference":
      return "유저 고정";
    case "empty_ooc":
      return "OOC 조정";
  }
}

function messageHasOocMarkers(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (extractOocSnippets(t).length > 0) return true;
  return /\bOOC\b/i.test(t);
}

function looksLikeInSceneDialogueOrAction(text: string): boolean {
  const t = text.trim();
  if (!t || messageHasOocMarkers(t)) return false;
  // Quoted speech or stage-direction style actions
  if (/["「『].+["」』]/.test(t)) return true;
  if (/\*{1,2}[^*]+\*{1,2}/.test(t)) return true;
  if (/(?:한다|했다|한다\.|말한다|말했다|걷|앉|웃|바라|손|입|눈)/.test(t) && t.length >= 8) {
    return true;
  }
  return false;
}

export function classifyMemoryTurnScope(
  userMessage: string,
  opts?: { previousWasNoncanonOrBranch?: boolean }
): TurnScopeClass {
  const t = userMessage.trim();
  if (!t) return "plain_ooc";

  if (MAIN_ADOPT_RE.test(t)) return "main_adopt";
  if (BRANCH_CLOSE_RE.test(t)) return "branch_close";

  if (opts?.previousWasNoncanonOrBranch) {
    if (APPRECIATION_ONLY_RE.test(t)) return "plain_ooc";
    if (BRANCH_CONTINUE_RE.test(t)) return "branch_continue";
    if (looksLikeInSceneDialogueOrAction(t)) return "branch_continue";
  }

  if (PREFERENCE_RE.test(t) && messageHasOocMarkers(t)) return "preference";
  if (MEANINGFUL_NONCANON_RE.test(t)) return "meaningful_noncanon";

  const intent = classifyChatOocIntent(t);
  if (intent === "none") return "main_rp";

  if (intent === "rp_unrelated") {
    if (MEANINGFUL_NONCANON_RE.test(t)) return "meaningful_noncanon";
    if (PLAIN_OOC_RE.test(t) || !MEANINGFUL_NONCANON_RE.test(t)) {
      // Unrelated OOC without IF/copy-pasta markers → plain adjustment
      if (MEANINGFUL_NONCANON_RE.test(t)) return "meaningful_noncanon";
      return "plain_ooc";
    }
  }

  // rp_continuing OOC that looks like IF → noncanon; else treat as main-adjacent OOC (preference/plain)
  if (MEANINGFUL_NONCANON_RE.test(t)) return "meaningful_noncanon";
  if (PLAIN_OOC_RE.test(t)) return "plain_ooc";
  if (PREFERENCE_RE.test(t)) return "preference";
  // Continuing RP OOC without IF markers stays with main scene
  return "main_rp";
}

export type BatchScopePlan = {
  primaryKind: MemorySummaryScope;
  classes: TurnScopeClass[];
  mainTurns: Array<{ turnIndex: number; turn: DialogueTurn }>;
  noncanonTurns: Array<{ turnIndex: number; turn: DialogueTurn }>;
  preferenceTurns: Array<{ turnIndex: number; turn: DialogueTurn }>;
  plainOocTurns: Array<{ turnIndex: number; turn: DialogueTurn }>;
  wantsBranchContinue: boolean;
  wantsBranchClose: boolean;
  wantsMainAdopt: boolean;
};

export function classifyMemoryBatchScopes(
  entries: Array<{ turnIndex: number; turn: DialogueTurn }>,
  opts?: { previousWasNoncanonOrBranch?: boolean }
): BatchScopePlan {
  const classes: TurnScopeClass[] = [];
  const mainTurns: BatchScopePlan["mainTurns"] = [];
  const noncanonTurns: BatchScopePlan["noncanonTurns"] = [];
  const preferenceTurns: BatchScopePlan["preferenceTurns"] = [];
  const plainOocTurns: BatchScopePlan["plainOocTurns"] = [];
  let wantsBranchContinue = false;
  let wantsBranchClose = false;
  let wantsMainAdopt = false;

  for (const entry of entries) {
    const cls = classifyMemoryTurnScope(entry.turn.user, {
      previousWasNoncanonOrBranch: opts?.previousWasNoncanonOrBranch,
    });
    classes.push(cls);
    if (cls === "branch_continue") wantsBranchContinue = true;
    if (cls === "branch_close") wantsBranchClose = true;
    if (cls === "main_adopt") wantsMainAdopt = true;

    if (cls === "main_rp" || cls === "branch_continue" || cls === "main_adopt") {
      // branch_continue / adopt still carry scene content
      if (cls === "main_rp") mainTurns.push({ turnIndex: entry.turnIndex, turn: entry.turn });
      else if (cls === "branch_continue") {
        noncanonTurns.push({ turnIndex: entry.turnIndex, turn: entry.turn });
      } else {
        noncanonTurns.push({ turnIndex: entry.turnIndex, turn: entry.turn });
      }
    } else if (cls === "meaningful_noncanon") {
      noncanonTurns.push({ turnIndex: entry.turnIndex, turn: entry.turn });
    } else if (cls === "preference") {
      preferenceTurns.push({ turnIndex: entry.turnIndex, turn: entry.turn });
    } else if (cls === "plain_ooc" || cls === "branch_close") {
      plainOocTurns.push({ turnIndex: entry.turnIndex, turn: entry.turn });
    }
  }

  let primaryKind: MemorySummaryScope = "empty_ooc";
  if (mainTurns.length > 0 && noncanonTurns.length > 0) primaryKind = "main_canon";
  else if (mainTurns.length > 0) primaryKind = "main_canon";
  else if (wantsBranchContinue || (opts?.previousWasNoncanonOrBranch && noncanonTurns.length > 0)) {
    primaryKind = "branch_canon";
  } else if (noncanonTurns.length > 0) primaryKind = "noncanon";
  else if (preferenceTurns.length > 0) primaryKind = "preference";
  else primaryKind = "empty_ooc";

  return {
    primaryKind,
    classes,
    mainTurns,
    noncanonTurns,
    preferenceTurns,
    plainOocTurns,
    wantsBranchContinue,
    wantsBranchClose,
    wantsMainAdopt,
  };
}

const NONCANON_BIT_USER_MAX = 80;
const NONCANON_BIT_ASSISTANT_MAX = 320;
const NONCANON_SUMMARY_ELLIPSIS = " / … / ";

function collapseNoncanonWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Keep the start of a bit (IF setup / first scene). */
function takeNoncanonHead(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd();
}

/** Keep the end of a bit (latest outcome / current state). */
function takeNoncanonTail(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return text.slice(text.length - max).trimStart();
}

function formatNoncanonTurnBit(
  turn: DialogueTurn,
  opts?: { preferAssistantTail?: boolean }
): string {
  const userCue = collapseNoncanonWs(turn.user).slice(0, NONCANON_BIT_USER_MAX);
  const assistantRaw = collapseNoncanonWs(turn.assistant);
  let assistantScene = "";
  if (assistantRaw) {
    if (assistantRaw.length <= NONCANON_BIT_ASSISTANT_MAX) {
      assistantScene = assistantRaw;
    } else if (opts?.preferAssistantTail) {
      // Last scene: keep the newest beats that would otherwise be sliced off.
      assistantScene = takeNoncanonTail(assistantRaw, NONCANON_BIT_ASSISTANT_MAX);
    } else {
      assistantScene = assistantRaw.slice(0, NONCANON_BIT_ASSISTANT_MAX);
    }
  }
  if (assistantScene && userCue) return `${userCue} → ${assistantScene}`;
  if (assistantScene) return assistantScene;
  return userCue;
}

/**
 * Fit multi-turn noncanon blurbs into the rolling-summary cap without dropping
 * the latest scene via a naive prefix slice. Keeps first-bit head + last-bit tail.
 */
function fitNoncanonSummaryWithinLimit(
  prefix: string,
  bits: string[],
  maxChars: number
): string {
  const usable = bits.filter(Boolean);
  if (usable.length === 0) return "비정사·번외 장면을 진행함.";

  const joined = usable.join(" / ");
  const body = `${prefix}${joined}`;
  if (body.length <= maxChars) return body;

  if (usable.length === 1) {
    const only = usable[0]!;
    const budget = maxChars - prefix.length;
    if (budget <= 0) return body.slice(0, maxChars).trim();
    // Single long bit: preserve early setup + late outcome inside one scene.
    const headBudget = Math.min(only.length, Math.max(40, Math.floor(budget * 0.45)));
    const tailBudget = Math.max(0, budget - headBudget - 1);
    const head = takeNoncanonHead(only, headBudget);
    const tail = takeNoncanonTail(only, tailBudget);
    if (!tail || head.includes(tail)) {
      return `${prefix}${takeNoncanonHead(only, budget)}`.slice(0, maxChars).trim();
    }
    const combined = `${prefix}${head}…${tail}`;
    return combined.length <= maxChars
      ? combined
      : combined.slice(0, maxChars).trim();
  }

  const first = usable[0]!;
  const last = usable[usable.length - 1]!;
  const ellipsis = NONCANON_SUMMARY_ELLIPSIS;
  const budget = maxChars - prefix.length - ellipsis.length;
  if (budget < 24) {
    // Extreme cap: still prefer the latest scene over early filler.
    return `${prefix}${takeNoncanonTail(last, Math.max(0, maxChars - prefix.length))}`
      .slice(0, maxChars)
      .trim();
  }

  // Prefer reserving room for the latest outcome; keep enough of the first setup.
  const minHead = Math.min(first.length, Math.min(100, Math.floor(budget * 0.35)));
  let tailBudget = Math.min(last.length, Math.max(Math.floor(budget * 0.5), budget - minHead));
  let headBudget = Math.min(first.length, budget - tailBudget);
  tailBudget = Math.min(last.length, budget - headBudget);

  const head = takeNoncanonHead(first, headBudget);
  const tail = takeNoncanonTail(last, tailBudget);
  return `${prefix}${head}${ellipsis}${tail}`.slice(0, maxChars).trim();
}

/**
 * Heuristic noncanon blurb for offline/tests (no LLM).
 * Preserves meaningful OOC/IF *request cues* and the assistant's actual noncanon scene
 * beats so the user can continue from history — not a "user requested IF" stub.
 * When over the 600-char cap, keeps first-scene setup and latest-scene outcome.
 */
export function buildNoncanonSummaryFromTurns(
  turns: Array<{ turn: DialogueTurn }>
): string {
  const lastIdx = turns.length - 1;
  const bits = turns.map(({ turn }, i) =>
    formatNoncanonTurnBit(turn, { preferAssistantTail: i === lastIdx && lastIdx >= 0 })
  );
  const joined = bits.filter(Boolean).join(" / ");
  if (!joined) return "비정사·번외 장면을 진행함.";
  const prefix = MEANINGFUL_NONCANON_RE.test(joined) ? "비정사·번외: " : "비정사 장면: ";
  return fitNoncanonSummaryWithinLimit(prefix, bits, ROLLING_SUMMARY_MAX_CHARS);
}

export function buildPreferenceSummaryFromTurns(
  turns: Array<{ turn: DialogueTurn }>
): string {
  const bits = turns.map(({ turn }) => turn.user.replace(/\s+/g, " ").trim().slice(0, 100));
  return `유저 고정 요청: ${bits.filter(Boolean).join(" / ").slice(0, 280)}`;
}

export function shouldPromoteAppreciationOnly(userMessage: string): boolean {
  return APPRECIATION_ONLY_RE.test(userMessage.trim());
}

export function shouldPromoteBranchContinue(userMessage: string): boolean {
  const t = userMessage.trim();
  if (!t || shouldPromoteAppreciationOnly(t)) return false;
  if (BRANCH_CLOSE_RE.test(t) || MAIN_ADOPT_RE.test(t)) return false;
  if (BRANCH_CONTINUE_RE.test(t)) return true;
  return looksLikeInSceneDialogueOrAction(t);
}

export function shouldCloseBranch(userMessage: string): boolean {
  return BRANCH_CLOSE_RE.test(userMessage.trim());
}

export function shouldAdoptMainCanon(userMessage: string): boolean {
  return MAIN_ADOPT_RE.test(userMessage.trim());
}

/** Build lorebook text from scope map — never includes noncanon/empty/closed branch. */
export function lorebookTextFromScopes(
  scopes: Partial<Record<MemorySummaryScope, string>>,
  opts?: { branchStatus?: BranchStatus | null }
): string {
  const parts: string[] = [];
  if (scopes.main_canon?.trim()) parts.push(scopes.main_canon.trim());
  if (
    scopes.branch_canon?.trim() &&
    opts?.branchStatus !== "closed"
  ) {
    parts.push(scopes.branch_canon.trim());
  }
  if (scopes.preference?.trim()) parts.push(scopes.preference.trim());
  return parts.join("\n");
}

export function displaySummaryFromScopes(
  scopes: Partial<Record<MemorySummaryScope, string>>,
  primary: MemorySummaryScope
): string {
  if (primary === "empty_ooc") return EMPTY_OOC_SUMMARY_MARKER;
  const order: MemorySummaryScope[] = [
    primary,
    "main_canon",
    "branch_canon",
    "noncanon",
    "preference",
  ];
  for (const k of order) {
    const t = scopes[k]?.trim();
    if (t) return t;
  }
  return EMPTY_OOC_SUMMARY_MARKER;
}

/** Assert helper — global character/world canon tables must never be written by memory scope code. */
export const MEMORY_SCOPE_NEVER_TOUCHES_GLOBAL_CANON = true;
