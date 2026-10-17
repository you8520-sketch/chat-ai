/**
 * 캐릭터 reveal · 채팅 복귀 · TRPG 복귀 전환이 공유하는 순수 규칙.
 * 시각 owner는 `MenuTransitionHost`이며 navigation은 항상 기존 `next/link`가 맡는다.
 */

type ClickModifiers = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

/** 장식 클릭인지 판별 — 수정자 키·중클릭·새 탭은 전환 없이 네이티브 이동. */
export function isPlainLeftClick(e: ClickModifiers): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** 이동 실패·지연 대비 오버레이 절대 상한(클릭 기준 ms). */
export const TRANSITION_FAILSAFE_MS = 1800;
