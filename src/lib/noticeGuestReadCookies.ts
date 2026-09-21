/** Guest notice read state — no DB, cookie-only. */

export const NOTICE_READ_ID_COOKIE = "notice_read_id";
export const NOTICE_READ_IDS_COOKIE = "notice_read_ids";
export const MAX_SPARSE_NOTICE_READ_IDS = 50;

export type GuestNoticeReadState = {
  watermarkId: number;
  sparseReadIds: number[];
};

export function parseNoticeReadWatermark(raw: string | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Parse, dedupe, and sort sparse guest read IDs. Malformed tokens are dropped. */
export function parseSparseNoticeReadIds(raw: string | undefined, watermarkId = 0): number[] {
  if (!raw?.trim()) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const token of raw.split(",")) {
    const value = Number(token.trim());
    if (!Number.isFinite(value) || value <= 0) continue;
    const id = Math.floor(value);
    if (id <= watermarkId || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  ids.sort((a, b) => a - b);
  return ids;
}

export function readGuestNoticeReadState(input: {
  watermarkRaw?: string;
  sparseRaw?: string;
}): GuestNoticeReadState {
  const watermarkId = parseNoticeReadWatermark(input.watermarkRaw);
  const sparseReadIds = parseSparseNoticeReadIds(input.sparseRaw, watermarkId);
  return { watermarkId, sparseReadIds };
}

export function isGuestNoticeRead(noticeId: number, state: GuestNoticeReadState): boolean {
  if (noticeId <= 0) return true;
  if (noticeId <= state.watermarkId) return true;
  return state.sparseReadIds.includes(noticeId);
}

export function addGuestSparseNoticeRead(
  state: GuestNoticeReadState,
  noticeId: number
): GuestNoticeReadState {
  if (noticeId <= 0 || isGuestNoticeRead(noticeId, state)) return state;
  const sparseReadIds = [...state.sparseReadIds, noticeId].sort((a, b) => a - b);
  const deduped = [...new Set(sparseReadIds)].filter((id) => id > state.watermarkId);
  while (deduped.length > MAX_SPARSE_NOTICE_READ_IDS) deduped.shift();
  return { ...state, sparseReadIds: deduped };
}

export function markAllGuestNoticesRead(latestId: number): GuestNoticeReadState {
  return {
    watermarkId: Math.max(0, Math.floor(latestId)),
    sparseReadIds: [],
  };
}

export function serializeSparseNoticeReadIds(sparseReadIds: number[]): string {
  return [...new Set(sparseReadIds.filter((id) => id > 0))].sort((a, b) => a - b).join(",");
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type CookieStore = {
  set: (name: string, value: string, options: { path: string; maxAge: number; sameSite: "lax" }) => void;
};

export function applyGuestNoticeReadCookies(res: { cookies: CookieStore }, state: GuestNoticeReadState): void {
  res.cookies.set(NOTICE_READ_ID_COOKIE, String(Math.max(0, state.watermarkId)), {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  const serialized = serializeSparseNoticeReadIds(state.sparseReadIds);
  if (serialized) {
    res.cookies.set(NOTICE_READ_IDS_COOKIE, serialized, {
      path: "/",
      maxAge: COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  } else {
    res.cookies.set(NOTICE_READ_IDS_COOKIE, "", {
      path: "/",
      maxAge: 0,
      sameSite: "lax",
    });
  }
}
