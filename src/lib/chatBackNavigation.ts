/**
 * 채팅방 상단 뒤로가기 — 히스토리가 없으면 캐릭터 상세로 폴백.
 *
 * 북마크·홈 화면 아이콘·새 탭·PWA로 채팅방에 바로 진입하면 되돌아갈 히스토리
 * 항목이 없어 history.back()이 아무 일도 하지 않는다. 앱 안에서 들어온 경우에는
 * 기존 뒤로가기를 유지하고, 그 외에는 캐릭터 상세 페이지로 보낸다.
 */

/** back() 이후 URL 변화를 확인하기까지 기다리는 시간 */
export const CHAT_BACK_FALLBACK_DELAY_MS = 350;

/**
 * bfcache로 탭이 얼렸다 복원되면 대기 타이머가 한참 뒤에 깨어난다.
 * 그 경우 폴백을 실행하면 사용자가 앞으로 돌아온 화면을 빼앗으므로 건너뛴다.
 */
export const CHAT_BACK_FALLBACK_GUARD_MS = 1500;

export function chatBackFallbackHref(characterId: number): string {
  return `/character/${characterId}`;
}

/** 히스토리에 되돌아갈 항목이 없으면 back()을 시도하지 않고 즉시 폴백한다. */
export function shouldSkipHistoryBack(historyLength: number): boolean {
  return !Number.isFinite(historyLength) || historyLength <= 1;
}

export function shouldRunChatBackFallback(opts: {
  elapsedMs: number;
  urlChanged: boolean;
}): boolean {
  if (opts.urlChanged) return false;
  return opts.elapsedMs <= CHAT_BACK_FALLBACK_GUARD_MS;
}
