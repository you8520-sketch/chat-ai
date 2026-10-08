/**
 * Phase C — 메뉴 전환 목적지 스펙 (순수 로직, navigation 불변).
 * 시각 owner(`MenuTransitionHost`)와 테스트가 공유한다.
 */

export type MenuTransitionMotif = "home" | "slash" | "rank" | "gate" | "lines" | "edit";

export type MenuTransitionSpec = {
  en: string;
  ko: string;
  accent: string;
  motif: MenuTransitionMotif;
};

const MENU_SPECS: Array<{ path: string; spec: MenuTransitionSpec }> = [
  { path: "/", spec: { en: "HAV", ko: "홈", accent: "#8b5cf6", motif: "home" } },
  { path: "/tab/new", spec: { en: "NEW", ko: "신작", accent: "#22d3ee", motif: "slash" } },
  { path: "/tab/ranking", spec: { en: "RANKING", ko: "랭킹", accent: "#f59e0b", motif: "rank" } },
  { path: "/tab/following", spec: { en: "FOLLOWING", ko: "북마크·팔로잉", accent: "#f472b6", motif: "lines" } },
  { path: "/trpg", spec: { en: "TRPG", ko: "TRPG", accent: "#34d399", motif: "gate" } },
  { path: "/search", spec: { en: "SEARCH", ko: "검색", accent: "#38bdf8", motif: "lines" } },
  { path: "/chats", spec: { en: "CHATS", ko: "대화 목록", accent: "#2dd4bf", motif: "lines" } },
  { path: "/persona", spec: { en: "PERSONA", ko: "페르소나·노트", accent: "#e879f9", motif: "slash" } },
  { path: "/studio", spec: { en: "STUDIO", ko: "제작", accent: "#a3e635", motif: "edit" } },
  { path: "/creator", spec: { en: "CREATOR", ko: "크리에이터", accent: "#fb923c", motif: "edit" } },
  { path: "/verify", spec: { en: "VERIFY", ko: "성인인증", accent: "#f43f5e", motif: "lines" } },
  { path: "/settings", spec: { en: "SETTINGS", ko: "설정", accent: "#94a3b8", motif: "lines" } },
  { path: "/login", spec: { en: "LOGIN", ko: "로그인", accent: "#8b5cf6", motif: "home" } },
];

/** 메뉴 경로(path, query 제외)에 대한 전환 스펙. 메뉴가 아니면 null. */
export function menuTransitionSpecForPath(pathname: string): MenuTransitionSpec | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (path === "/") return MENU_SPECS[0]!.spec;
  let fallback: MenuTransitionSpec | null = null;
  for (const { path: key, spec } of MENU_SPECS) {
    if (key === "/") continue;
    if (path === key || path.startsWith(`${key}/`)) fallback = spec;
  }
  return fallback;
}

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

/** 메뉴 영역(nav 컨테이너·홈 로고 링크)에 붙이는 명시적 전환 대상 속성. */
export const MENU_TRANSITION_ATTR = "data-menu-transition";

/**
 * 승인된 메뉴 영역의 클릭에서만 전환 스펙을 돌려준다.
 * - 같은 pathname(재클릭·query-only 이동)은 전체 화면 veil 없이 네이티브 이동.
 * - 비메뉴 링크는 호출 측에서 `inMenuRegion=false`로 걸러진다.
 */
export function resolveMenuClickTransition(input: {
  inMenuRegion: boolean;
  destPathname: string;
  currentPathname: string;
}): MenuTransitionSpec | null {
  if (!input.inMenuRegion) return null;
  if (input.destPathname === input.currentPathname) return null;
  return menuTransitionSpecForPath(input.destPathname);
}
