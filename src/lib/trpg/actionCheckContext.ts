import type { TrpgActionType } from "./actionTypes";
import { ACTION_STAT_PREFS } from "./actionTypes";
import type { TrpgLocalSceneProgressDelta, TrpgLocalSceneProgressV1 } from "./localSceneProgress";
import { classifyChallengeKind, hasChallengeSignal, stripQuotedDialogue } from "./actionCheck";

/** Minimum structured stat for routine competence skip (modifier +2). */
export const TRPG_ROUTINE_COMPETENCE_STAT_MIN = 10;
/** Strong competence lowers difficulty band one step at +3 modifier. */
export const TRPG_STRONG_COMPETENCE_STAT_MIN = 12;

const TRAVERSAL_VERBS =
  /(?:나가|빠져나|탈출|통과|이동|진입|건너|들어(?:가|서)|나선|이용|따라(?:간|라)|향해(?:간|라)|로\s?(?:간|간다|향|이동|나|빠))/;

const TIME_PRESSURE = /(?:\d+\s?초|\d+\s?분|급히|서둘|압박|포위|마감|시간(?:이|을)?\s?(?:없|부족|촉박))/;
const HOSTILE_INTERFERENCE = /(?:적(?:의|이|을)?|방해|교란|추격|기생(?:종|체)|공격(?:받|당|하)|포화|매복|저항(?:하는|하는)?)/;
const ENVIRONMENTAL_HAZARD = /(?:붕괴|독(?:성|기)|함정|불안|위험(?:한|한)?|불안정|불확실|손상(?:된|된)?|파손(?:된|된)?|교란(?:된|된)?)/;

const ROUTINE_ENVIRONMENT =
  /(?:평범|일반|익숙|정상|안전|확인(?:된|된)?|기본)[^.]{0,16}(?:문|조명|복도|장비|스위치|지도|무기)|(?:이미\s)?(?:안전(?:이)?[^.]{0,20}(?:확인(?:된|된)?|한)?[^.]{0,12})(?:복도|통로)[^.]{0,16}(?:걷|이동)/;

const ROUTINE_INVESTIGATION =
  /(?:보유[^.]{0,16})?(?:군용\s?지도|전술\s?지도|익숙한\s?지도|정상(?:적인)?\s?지도)[^.]{0,120}(?:확인|살펴|훑|본|찾|파악|읽)|(?:지도|출구(?:\s?위치)?|경로(?:\s?표시)?|좌표|동선)[^.]{0,120}(?:확인|살펴|훑|파악|읽)|(?:확인|살펴|훑|파악)[^.]{0,120}(?:군용\s?지도|전술\s?지도|지도(?:에서|의)?|출구(?:\s?위치)?|경로(?:\s?표시)?|동선)/;

const ROUTINE_PREP =
  /(?:익숙|기본|일상|평소|정상)[^.]{0,16}(?:무기|장비|자세|경계|배치|장전|정비)|(?:무기|장비)[^.]{0,16}(?:꺼내|장전|정비|점검|정리|준비)[^.]{0,16}(?:자세|경계|배치)?/;

const STOP_WORDS = new Set([
  "을",
  "를",
  "이",
  "가",
  "은",
  "는",
  "의",
  "에",
  "로",
  "으로",
  "과",
  "와",
  "에서",
  "까지",
  "부터",
  "하",
  "한",
  "하는",
  "한다",
  "했다",
  "한다",
  "the",
  "and",
]);

function normalizeLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Structured label tokens for route/blocker matching — not GM prose parsing. */
export function tokenizeSceneLabel(raw: string): string[] {
  const normalized = normalizeLabel(raw);
  const rough = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .flatMap((part) => part.match(/[\p{L}\p{N}]{2,}/gu) ?? []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of rough) {
    const t = normalizeSceneToken(token.trim());
    if (!t || t.length < 2 || STOP_WORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function normalizeSceneToken(token: string): string {
  return token
    .replace(/(기생종|출구|통로|환풍구|균사|문)(?:이|가|을|를|은|는|과|와)?$/u, "$1")
    .replace(/^(?:막|막는|막음|막힌|막혀|봉쇄)/u, "막")
    .replace(/(?:제거|해제|처리|견제)$/u, "");
}

function tokenOverlap(a: string[], b: string[]): number {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t)).length;
}

export function actionReferencesOpenRoute(body: string, openRoutes: readonly string[]): string | null {
  const text = normalizeLabel(stripQuotedDialogue(body));
  if (!text || openRoutes.length === 0) return null;
  let best: { route: string; score: number } | null = null;
  for (const route of openRoutes) {
    const routeNorm = normalizeLabel(route);
    if (!routeNorm) continue;
    if (text.includes(routeNorm)) {
      return route;
    }
    const routeTokens = tokenizeSceneLabel(route);
    if (routeTokens.length === 0) continue;
    const bodyTokens = tokenizeSceneLabel(text);
    const overlap = tokenOverlap(routeTokens, bodyTokens);
    const needed = routeTokens.length <= 2 ? 1 : 2;
    if (overlap >= needed && (!best || overlap > best.score)) {
      best = { route, score: overlap };
    }
  }
  return best?.route ?? null;
}

export function declaresTraversalIntent(body: string): boolean {
  const text = normalizeLabel(stripQuotedDialogue(body));
  if (!text) return false;
  return TRAVERSAL_VERBS.test(text) || classifyChallengeKind(text) === "challenge";
}

export function blockerRelevantToRoute(
  blocker: string,
  route: string,
  body: string
): boolean {
  const blockerTokens = tokenizeSceneLabel(blocker);
  const routeTokens = tokenizeSceneLabel(route);
  const bodyTokens = tokenizeSceneLabel(body);
  if (blockerTokens.length === 0) return false;
  if (tokenOverlap(blockerTokens, routeTokens) >= 1) return true;
  if (tokenOverlap(blockerTokens, bodyTokens) >= 2) return true;
  const blockerNorm = normalizeLabel(blocker);
  const bodyNorm = normalizeLabel(body);
  return bodyNorm.includes(blockerNorm);
}

export function relevantBlockersForTraversal(
  body: string,
  route: string,
  remainingBlockers: readonly string[]
): string[] {
  return remainingBlockers.filter((blocker) => blockerRelevantToRoute(blocker, route, body));
}

export function isResolvedObstacleRecurrence(resolvedObstacles: readonly string[], candidate: string): boolean {
  const candidateTokens = tokenizeSceneLabel(candidate);
  if (candidateTokens.length === 0) return false;
  const candidateNorm = normalizeLabel(candidate);
  for (const resolved of resolvedObstacles) {
    const resolvedNorm = normalizeLabel(resolved);
    if (!resolvedNorm) continue;
    if (candidateNorm.includes(resolvedNorm) || resolvedNorm.includes(candidateNorm)) return true;
    const resolvedTokens = tokenizeSceneLabel(resolved);
    const overlap = tokenOverlap(candidateTokens, resolvedTokens);
    const threshold = Math.min(2, Math.min(candidateTokens.length, resolvedTokens.length));
    if (overlap >= threshold) return true;
  }
  return false;
}

export function isRoutineOpenRouteTraversal(opts: {
  body: string;
  localScene?: TrpgLocalSceneProgressV1 | null;
}): boolean {
  const scene = opts.localScene;
  if (!scene?.openRoutes.length) return false;
  const route = actionReferencesOpenRoute(opts.body, scene.openRoutes);
  if (!route) return false;
  if (!declaresTraversalIntent(opts.body)) return false;
  const relevant = relevantBlockersForTraversal(opts.body, route, scene.remainingBlockers);
  if (relevant.length > 0) {
    return !hasChallengeSignal(opts.body);
  }
  return true;
}

export function hasRealChallengeContext(text: string): boolean {
  const normalized = normalizeLabel(stripQuotedDialogue(text));
  if (!normalized) return false;
  if (TIME_PRESSURE.test(normalized)) return true;
  if (HOSTILE_INTERFERENCE.test(normalized)) return true;
  if (ENVIRONMENTAL_HAZARD.test(normalized)) return true;
  return classifyChallengeKind(normalized) != null;
}

export function isRoutineEnvironmentalAction(body: string): boolean {
  const text = normalizeLabel(stripQuotedDialogue(body));
  if (!text) return false;
  if (!ROUTINE_ENVIRONMENT.test(text)) return false;
  if (/(?:잠긴|억지|강제|붕괴|위험(?:한|한)?|기생|포자|함정|견|돌진|부수|파고)/.test(text)) return false;
  if (/(?:석궁|화살|조준|마체테|칼|총|공격|던지|틀(?:며|고)|겨누)/.test(text)) return false;
  return true;
}

export function isRoutineInvestigation(body: string): boolean {
  const text = normalizeLabel(stripQuotedDialogue(body));
  if (!text) return false;
  if (!ROUTINE_INVESTIGATION.test(text)) return false;
  if (TIME_PRESSURE.test(text) || HOSTILE_INTERFERENCE.test(text) || ENVIRONMENTAL_HAZARD.test(text)) {
    return false;
  }
  return true;
}

export function isRoutineExpertPreparation(body: string): boolean {
  const text = normalizeLabel(stripQuotedDialogue(body));
  if (!text || hasRealChallengeContext(text)) return false;
  if (HOSTILE_INTERFERENCE.test(text)) return false;
  return ROUTINE_PREP.test(text);
}

export function pickRelevantStatValue(
  stats: Record<string, number> | undefined,
  actionType: TrpgActionType | null,
  statKey?: string | null
): number | null {
  if (!stats) return null;
  if (statKey && typeof stats[statKey] === "number") return stats[statKey]!;
  const prefs = actionType ? ACTION_STAT_PREFS[actionType] : ACTION_STAT_PREFS.free;
  for (const key of prefs) {
    const value = stats[key];
    if (typeof value === "number") return value;
  }
  return null;
}

export function hasRoutineCompetence(opts: {
  body: string;
  actionType: TrpgActionType | null;
  statValue?: number | null;
}): boolean {
  const stat = opts.statValue ?? null;
  if (stat == null || stat < TRPG_ROUTINE_COMPETENCE_STAT_MIN) return false;
  const { actionType } = opts;
  if (actionType === "investigate" && isRoutineInvestigation(opts.body)) return true;
  if (actionType === "support" && isRoutineExpertPreparation(opts.body)) return true;
  if ((actionType === "free" || actionType == null) && isRoutineEnvironmentalAction(opts.body)) return true;
  return false;
}

export function hasMeaningfulUncertainty(opts: {
  body: string;
  actionType?: TrpgActionType | null;
  intent?: string | null;
  localScene?: TrpgLocalSceneProgressV1 | null;
  statValue?: number | null;
}): boolean {
  const body = opts.body;
  const visibleBody = stripQuotedDialogue(body);
  const intent = (opts.intent ?? "").trim();
  if (isRoutineOpenRouteTraversal({ body, localScene: opts.localScene })) return false;
  if (isRoutineEnvironmentalAction(body)) return false;
  if (hasRoutineCompetence({ body, actionType: opts.actionType ?? null, statValue: opts.statValue })) {
    if (!hasRealChallengeContext(body) && !(intent && hasRealChallengeContext(intent))) return false;
  }
  if (isRoutineInvestigation(visibleBody) && opts.actionType === "investigate") return false;
  if (isRoutineExpertPreparation(visibleBody) && opts.actionType === "support") return false;
  if (hasRealChallengeContext(body)) return true;
  if (intent && hasRealChallengeContext(intent)) return true;
  if (hasChallengeSignal(visibleBody)) return true;
  if (intent && hasChallengeSignal(intent)) return true;
  return false;
}

export function sanitizeLocalSceneProgressDelta(
  current: TrpgLocalSceneProgressV1,
  delta: TrpgLocalSceneProgressDelta
): TrpgLocalSceneProgressDelta {
  const next: TrpgLocalSceneProgressDelta = { ...delta };
  if (next.remainingBlockersAdd?.length) {
    next.remainingBlockersAdd = next.remainingBlockersAdd.filter(
      (blocker) => !isResolvedObstacleRecurrence(current.resolvedObstacles, blocker)
    );
    if (next.remainingBlockersAdd.length === 0) delete next.remainingBlockersAdd;
  }
  return next;
}

export function finalizeLocalSceneProgressState(
  progress: TrpgLocalSceneProgressV1,
  delta: TrpgLocalSceneProgressDelta | undefined
): TrpgLocalSceneProgressV1 {
  if (delta?.sceneStateSet != null || delta?.sceneTransitionTo != null) return progress;
  if (
    progress.openRoutes.length > 0 &&
    progress.remainingBlockers.length === 0 &&
    progress.resolvedObstacles.length > 0 &&
    progress.sceneState === "active"
  ) {
    return { ...progress, sceneState: "transition_ready" };
  }
  return progress;
}
