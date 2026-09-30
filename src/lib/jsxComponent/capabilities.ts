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
  if (/\b(fetch|XMLHttpRequest|WebSocket|navigator\.sendBeacon)\b/.test(source)) {
    found.add("external_network");
  }
  if (/\b(localStorage|sessionStorage|document\.cookie)\b/.test(source)) {
    found.add("storage");
  }
  if (/\b(window\.open|top\.location|location\s*=|href\s*=\s*['"]https?:)\b/.test(source)) {
    found.add("navigation");
  }
  return [...found];
}

export function sourceLooksNetworked(source: string): boolean {
  return analyzeJsxCapabilities(source).includes("external_network");
}
