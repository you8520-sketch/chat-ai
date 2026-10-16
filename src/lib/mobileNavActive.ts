export type MobileNavItem = {
  href: string;
  label: string;
  /** href 외에 같은 탭으로 취급할 하위 경로 접두. */
  also?: readonly string[];
  /** 정확히 일치할 때만 같은 탭으로 취급할 경로. */
  alsoExact?: readonly string[];
};

function underPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isMobileNavActive(pathname: string, item: MobileNavItem): boolean {
  if (item.href === "/") return pathname === "/";
  if (underPath(pathname, item.href)) return true;
  if (item.also?.some((base) => underPath(pathname, base))) return true;
  return item.alsoExact?.includes(pathname) ?? false;
}
