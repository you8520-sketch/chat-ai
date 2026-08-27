/**
 * Minimal in-memory rate limiter for explicit AI scene-plan requests.
 * Reuses the scenarioDraft lock pattern — one in-flight call per user,
 * short cooldown, rolling window allowance.
 */

export const SCENE_PLAN_COOLDOWN_MS = 8_000;
export const SCENE_PLAN_WINDOW_MS = 10 * 60 * 1000;
export const SCENE_PLAN_MAX_IN_WINDOW = 6;

export class ChatImageScenePlanRateLimitError extends Error {
  readonly statusCode = 429;

  constructor(message: string) {
    super(message);
    this.name = "ChatImageScenePlanRateLimitError";
  }
}

type ScenePlanRateRow = {
  until: number;
  inFlight: boolean;
  windowStartedAt: number;
  windowCount: number;
};

const scenePlanLocks = new Map<number, ScenePlanRateRow>();
let readNowMs = () => Date.now();

function nowMs(): number {
  return readNowMs();
}

function pruneStaleScenePlanRateRows(now: number): void {
  for (const [userId, row] of scenePlanLocks) {
    if (row.inFlight) continue;
    const windowExpired = now - row.windowStartedAt >= SCENE_PLAN_WINDOW_MS;
    const cooldownExpired = row.until <= now;
    if (windowExpired && cooldownExpired) {
      scenePlanLocks.delete(userId);
    }
  }
}

export function assertChatImageScenePlanRateLimit(userId: number): void {
  const now = nowMs();
  pruneStaleScenePlanRateRows(now);
  const row = scenePlanLocks.get(userId);
  if (row?.inFlight) {
    throw new ChatImageScenePlanRateLimitError(
      "이미 AI 장면 제안을 불러오는 중입니다. 잠시 후 다시 시도해 주세요."
    );
  }
  if (row && row.until > now) {
    throw new ChatImageScenePlanRateLimitError(
      "AI 장면 제안은 잠시 뒤에 다시 요청할 수 있습니다."
    );
  }
  const windowStartedAt =
    row && now - row.windowStartedAt < SCENE_PLAN_WINDOW_MS
      ? row.windowStartedAt
      : now;
  const windowCount =
    row && now - row.windowStartedAt < SCENE_PLAN_WINDOW_MS ? row.windowCount : 0;
  if (windowCount >= SCENE_PLAN_MAX_IN_WINDOW) {
    throw new ChatImageScenePlanRateLimitError(
      "AI 장면 제안 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."
    );
  }
  scenePlanLocks.set(userId, {
    until: now + SCENE_PLAN_COOLDOWN_MS,
    inFlight: true,
    windowStartedAt,
    windowCount: windowCount + 1,
  });
}

export function releaseChatImageScenePlanRateLimit(userId: number, failed = false): void {
  const row = scenePlanLocks.get(userId);
  if (!row) return;
  scenePlanLocks.set(userId, {
    ...row,
    until: failed ? nowMs() + 1_500 : row.until,
    inFlight: false,
  });
}

export function resetChatImageScenePlanRateLimitForTests(): void {
  scenePlanLocks.clear();
  readNowMs = () => Date.now();
}

export function setChatImageScenePlanRateLimitNowForTests(read: () => number): void {
  readNowMs = read;
}

export function scenePlanRateLimitRowCountForTests(): number {
  return scenePlanLocks.size;
}
