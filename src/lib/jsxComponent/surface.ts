import {
  JSX_COMPONENT_SURFACES,
  type JsxCapability,
  type JsxComponentSurface,
} from "./types";

/** Persisted surface. Missing/blank → chat (legacy). Unknown values are not readable. */
export function parseJsxComponentSurface(raw: unknown): JsxComponentSurface | null {
  if (raw == null || raw === "") return "chat";
  return JSX_COMPONENT_SURFACES.find((surface) => surface === raw) ?? null;
}

export function jsxComponentSurface(component: { surface?: JsxComponentSurface }): JsxComponentSurface {
  return component.surface ?? "chat";
}

/** Save/compile owner for which host intents a surface may use. */
export function jsxSurfacePolicyError(
  surface: JsxComponentSurface,
  capabilities: readonly JsxCapability[]
): string | null {
  switch (surface) {
    case "chat":
      return capabilities.includes("trpg_action_draft")
        ? "setTrpgActionDraft와 setTrpgSelectedStat은 TRPG 캐릭터 시트 컴포넌트에서만 사용할 수 있습니다."
        : null;
    case "trpg_sheet":
      return capabilities.includes("chat_send")
        ? "TRPG 캐릭터 시트에서는 sendToChat을 사용할 수 없습니다."
        : null;
    default: {
      const _exhaustive: never = surface;
      return _exhaustive;
    }
  }
}

/** Canonical surface filter for runtime, prompt, and TRPG readers. Policy violators are never served. */
export function selectJsxSurfaceComponents<T extends { surface?: JsxComponentSurface; capabilities: readonly JsxCapability[] }>(
  components: readonly T[],
  surface: JsxComponentSurface
): T[] {
  return components.filter(
    (component) =>
      jsxComponentSurface(component) === surface && jsxSurfacePolicyError(surface, component.capabilities) === null
  );
}

export function validateJsxSurfaceCatalog(
  components: ReadonlyArray<{ name: string; surface?: JsxComponentSurface; capabilities: readonly JsxCapability[] }>
): { ok: true } | { ok: false; error: string } {
  let sheets = 0;
  for (const component of components) {
    const surface = jsxComponentSurface(component);
    const policy = jsxSurfacePolicyError(surface, component.capabilities);
    if (policy) return { ok: false, error: `${component.name}: ${policy}` };
    if (surface === "trpg_sheet") sheets += 1;
  }
  if (sheets > 1) {
    return { ok: false, error: "TRPG 캐릭터 시트 컴포넌트는 캐릭터마다 하나만 저장할 수 있습니다." };
  }
  return { ok: true };
}
