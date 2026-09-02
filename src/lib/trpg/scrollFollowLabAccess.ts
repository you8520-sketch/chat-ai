/** Playwright production-build harness only — never set on deployed production. */
export function isScrollFollowLabHarnessEnabled(): boolean {
  return process.env.TRPG_SCROLL_FOLLOW_LAB_ENABLED === "1";
}
