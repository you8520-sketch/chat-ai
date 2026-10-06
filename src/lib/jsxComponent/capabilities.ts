import type { JsxCapability } from "./types";

export function analyzeJsxCapabilities(source: string): JsxCapability[] {
  const found = new Set<JsxCapability>();
  if (/\b(useState|useReducer|useRef|useMemo|useCallback)\b/.test(source)) {
    found.add("local_state");
  }
  if (/\b(requestAnimationFrame|setInterval|setTimeout)\b/.test(source)) {
    found.add("animation");
  }
  if (/\b(getContext|HTMLCanvasElement|<canvas\b)/.test(source)) {
    found.add("canvas");
  }
  if (/\bsendToChat\b/.test(source)) {
    found.add("chat_send");
  }
  if (/\bsetTrpgActionDraft\b/.test(source) || /\bsetTrpgSelectedStat\b/.test(source)) {
    found.add("trpg_action_draft");
  }
  if (/\b(fetch|XMLHttpRequest|WebSocket|navigator\.sendBeacon)\b/.test(source)) {
    found.add("external_network");
  }
  if (/\b(localStorage|sessionStorage|document\.cookie)\b/.test(source)) {
    found.add("storage");
  }
  if (
    /\b(?:window\.open|top\.location|parent\.location|location\.(?:assign|replace)|(?:window\.|document\.)?location(?:\.href)?\s*=)/.test(
      source
    ) ||
    /<a\b[^>]*\bhref\s*=/.test(source) ||
    /\bhref\s*=\s*['"](?:https?:|\/\/)/.test(source)
  ) {
    found.add("navigation");
  }
  return [...found];
}

export function sourceLooksNetworked(source: string): boolean {
  return analyzeJsxCapabilities(source).includes("external_network");
}
