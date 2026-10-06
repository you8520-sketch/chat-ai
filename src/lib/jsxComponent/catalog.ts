import { estimateTokens } from "@/lib/tokenEstimate";
import { analyzeJsxCapabilities } from "./capabilities";
import { compileJsxComponentSource } from "./compile";
import {
  JSX_CALL_GUIDE_CATALOG_TOKEN_MAX,
  JSX_CALL_GUIDE_MAX_CHARS,
  JSX_PROP_MAX,
  JSX_SOURCE_MAX_CHARS,
} from "./limits";
import { normalizeJsxPropDefinition } from "./manifest";
import {
  jsxComponentSurface,
  jsxSurfacePolicyError,
  parseJsxComponentSurface,
  selectJsxSurfaceComponents,
  validateJsxSurfaceCatalog,
} from "./surface";
import {
  JSX_COMPONENT_NAME_RE,
  type JsxComponentManifestRecord,
  type JsxComponentSurface,
  type JsxComponentRecord,
  type JsxRuntimeComponentRecord,
  type JsxPropDefinition,
} from "./types";

type StoredJsxComponent = {
  name: string;
  surface: JsxComponentSurface;
  source: string;
  props: JsxPropDefinition[];
  callGuide?: string;
};

/** Stored call guide. Missing or non-string values are empty. Never sliced. */
export function readJsxCallGuide(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** Blank guides cost nothing. estimateTokens("") is 1, so empty must stay 0. */
export function jsxCallGuideTokenCount(text: string | undefined): number {
  const trimmed = readJsxCallGuide(text);
  if (!trimmed) return 0;
  return estimateTokens(trimmed);
}

/** Chat prompt budget. Non-chat surfaces never reach the manifest, so their guides cost nothing. */
export function validateJsxCallGuideCatalog(
  components: Array<{ callGuide?: string; surface?: JsxComponentSurface }>
): { ok: true } | { ok: false; error: string } {
  let total = 0;
  for (const component of components) {
    if (jsxComponentSurface(component) !== "chat") continue;
    const guide = readJsxCallGuide(component.callGuide);
    if (guide.length > JSX_CALL_GUIDE_MAX_CHARS) {
      return {
        ok: false,
        error: `AI 호출 설명은 ${JSX_CALL_GUIDE_MAX_CHARS}자 이하여야 합니다.`,
      };
    }
    total += jsxCallGuideTokenCount(guide);
  }
  if (total > JSX_CALL_GUIDE_CATALOG_TOKEN_MAX) {
    return {
      ok: false,
      error: `AI 호출 설명 추정 토큰 합계 ${total.toLocaleString()}이 한도 ${JSX_CALL_GUIDE_CATALOG_TOKEN_MAX.toLocaleString()}을 초과합니다. 설명을 줄인 뒤 다시 저장하세요.`,
    };
  }
  return { ok: true };
}

function parseStoredJsxComponents(raw: string | null | undefined): StoredJsxComponent[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: StoredJsxComponent[] = [];
    for (const item of parsed.slice(0, 12)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      const source = String(row.source ?? "").trim();
      const surface = parseJsxComponentSurface(row.surface);
      if (
        !surface ||
        !JSX_COMPONENT_NAME_RE.test(name) ||
        !source ||
        source.length > JSX_SOURCE_MAX_CHARS
      ) {
        continue;
      }
      const props = Array.isArray(row.props)
        ? row.props
            .map(normalizeJsxPropDefinition)
            .filter((prop): prop is NonNullable<typeof prop> => !!prop)
            .slice(0, JSX_PROP_MAX)
        : [];
      const callGuide = readJsxCallGuide(row.callGuide);
      out.push({ name, surface, source, props, ...(callGuide ? { callGuide } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Full runtime catalog. Source + prop schema are canonical persisted data.
 * Derived compiled/capability fields from JSON are deliberately ignored so a
 * client cannot forge them to bypass the current compiler/security policy.
 */
export function parseJsxComponentCatalog(raw: string | null | undefined): JsxComponentRecord[] {
  const out: JsxComponentRecord[] = [];
  for (const item of parseStoredJsxComponents(raw)) {
    const fresh = compileJsxComponentSource(item.source, item.name);
    if (!fresh.ok) continue;
    out.push({
      name: item.name,
      ...surfaceField(item.surface),
      source: item.source,
      compiled: fresh.compiled,
      props: item.props,
      capabilities: fresh.capabilities,
      chatSend: fresh.chatSend,
      ...(item.callGuide ? { callGuide: item.callGuide } : {}),
    });
  }
  return out;
}

/**
 * Prompt-only catalog parser. Chat prompt assembly must not Sucrase-compile
 * creator source on every turn; save-time validation already owns syntax and
 * security acceptance. Only manifest metadata is derived here.
 */
export function parseJsxComponentManifestCatalog(
  raw: string | null | undefined
): JsxComponentManifestRecord[] {
  const stored = parseStoredJsxComponents(raw).map((item) => ({
    ...item,
    capabilities: analyzeJsxCapabilities(item.source),
  }));
  return selectJsxSurfaceComponents(stored, "chat").map((item) => ({
    name: item.name,
    props: item.props,
    chatSend: item.capabilities.includes("chat_send"),
    ...(item.callGuide ? { callGuide: item.callGuide } : {}),
  }));
}

/** Chat client catalog: AI-invocable components only. */
export function parseJsxRuntimeComponentCatalog(
  raw: string | null | undefined
): JsxRuntimeComponentRecord[] {
  return selectJsxSurfaceComponents(parseJsxComponentCatalog(raw), "chat").map(
    ({ source: _source, ...runtime }) => runtime
  );
}

/** The character's single TRPG sheet component, compiled by the current compiler. */
export function findJsxTrpgSheetComponent(raw: string | null | undefined): JsxComponentRecord | null {
  return selectJsxSurfaceComponents(parseJsxComponentCatalog(raw), "trpg_sheet")[0] ?? null;
}

function surfaceField(surface: JsxComponentSurface): { surface?: JsxComponentSurface } {
  return surface === "chat" ? {} : { surface };
}

export function serializeJsxComponentCatalog(components: JsxComponentRecord[]): string {
  return JSON.stringify(
    components.slice(0, 12).map((component) => {
      const callGuide = readJsxCallGuide(component.callGuide);
      return {
        name: component.name,
        ...surfaceField(jsxComponentSurface(component)),
        source: component.source,
        props: component.props.slice(0, JSX_PROP_MAX),
        ...(callGuide ? { callGuide } : {}),
      };
    })
  );
}

export function findJsxComponent(
  catalog: JsxComponentRecord[],
  name: string
): JsxComponentRecord | null {
  return catalog.find((component) => component.name === name) ?? null;
}

export type JsxCatalogDraftInput = {
  surface?: JsxComponentSurface;
  name: string;
  source: string;
  props: JsxPropDefinition[];
  callGuide?: string;
};

export function jsxCatalogEditableFingerprint(
  input: { name: string; source: string; props: JsxPropDefinition[]; callGuide?: string } | null
): string {
  if (!input) return "";
  const props = input.props
    .filter((prop) => prop.name.trim() || prop.example?.trim() || prop.description?.trim())
    .map((prop) => ({
      name: prop.name,
      type: prop.type,
      required: prop.required === true,
      example: prop.example ?? "",
      description: prop.description ?? "",
    }));
  const callGuide = readJsxCallGuide(input.callGuide);
  if (!input.name.trim() && !input.source.trim() && props.length === 0 && !callGuide) return "";
  return JSON.stringify({
    name: input.name.trim(),
    source: input.source.trim(),
    props,
    callGuide,
  });
}

const EMPTY_JSX_CATALOG_DRAFT: JsxCatalogDraftInput = {
  name: "",
  source: "",
  props: [],
  callGuide: "",
};

export function hydrateJsxCatalogEditorState(input: {
  appliedSavedFingerprint: string;
  draft: JsxCatalogDraftInput;
  saved: JsxComponentRecord | null;
}): { appliedSavedFingerprint: string; draft: JsxCatalogDraftInput; hydrated: boolean } {
  const nextFingerprint = jsxCatalogEditableFingerprint(
    input.saved
      ? {
          name: input.saved.name,
          source: input.saved.source,
          props: input.saved.props,
          callGuide: input.saved.callGuide,
        }
      : null
  );
  if (nextFingerprint === input.appliedSavedFingerprint) {
    return {
      appliedSavedFingerprint: input.appliedSavedFingerprint,
      draft: input.draft,
      hydrated: false,
    };
  }
  const draftFingerprint = jsxCatalogEditableFingerprint(input.draft);
  const emptyFingerprint = jsxCatalogEditableFingerprint(EMPTY_JSX_CATALOG_DRAFT);
  const draftMatchesPrevious =
    draftFingerprint === input.appliedSavedFingerprint ||
    (input.appliedSavedFingerprint === "" && draftFingerprint === emptyFingerprint);
  if (!draftMatchesPrevious) {
    return {
      appliedSavedFingerprint: nextFingerprint,
      draft: input.draft,
      hydrated: false,
    };
  }
  return {
    appliedSavedFingerprint: nextFingerprint,
    draft: input.saved
      ? {
          name: input.saved.name,
          source: input.saved.source,
          props: input.saved.props.map((prop) => ({ ...prop })),
          callGuide: input.saved.callGuide ?? "",
        }
      : { ...EMPTY_JSX_CATALOG_DRAFT },
    hydrated: true,
  };
}

/**
 * Compile a catalog draft without discarding the last saved catalog.
 * A failed compile leaves `catalog` untouched. Success replaces the editor's
 * single saved slot with the new record.
 */
export function resolveJsxCatalogDraft(
  saved: JsxComponentRecord[],
  draft: JsxCatalogDraftInput
): {
  catalog: JsxComponentRecord[];
  error: string;
  preview: JsxComponentRecord | null;
  unsaved: boolean;
} {
  const surface = draft.surface ?? "chat";
  const slot = jsxCatalogSlotIndex(saved, surface);
  const savedHead = slot >= 0 ? saved[slot] ?? null : null;
  const unsaved =
    jsxCatalogEditableFingerprint(
      savedHead
        ? {
            name: savedHead.name,
            source: savedHead.source,
            props: savedHead.props,
            callGuide: savedHead.callGuide,
          }
        : null
    ) !== jsxCatalogEditableFingerprint(draft);
  const result = compileJsxComponentDraft(draft);
  if (!result.ok) {
    return { catalog: saved, error: result.error, preview: null, unsaved };
  }
  const nextCatalog =
    slot >= 0
      ? saved.map((component, index) => (index === slot ? result.record : component))
      : surface === "chat"
        ? [result.record, ...saved]
        : [...saved, result.record];
  const guideBudget = validateJsxCallGuideCatalog(nextCatalog);
  if (!guideBudget.ok) {
    return { catalog: saved, error: guideBudget.error, preview: null, unsaved };
  }
  const surfaces = validateJsxSurfaceCatalog(nextCatalog);
  if (!surfaces.ok) {
    return { catalog: saved, error: surfaces.error, preview: null, unsaved };
  }
  return {
    // Editing one surface slot must not erase the rest of a saved
    // multi-component catalog. The UI edits one slot per surface.
    catalog: nextCatalog,
    error: "",
    preview: result.record,
    unsaved: false,
  };
}

/** The editor's visible slot for a surface: its first component. */
export function jsxCatalogSlotIndex(catalog: readonly JsxComponentRecord[], surface: JsxComponentSurface): number {
  return catalog.findIndex((component) => jsxComponentSurface(component) === surface);
}

/** Explicitly remove the visible saved component of a surface, preserving other slots. */
export function removeJsxCatalogHead(
  saved: JsxComponentRecord[],
  surface: JsxComponentSurface = "chat"
): JsxComponentRecord[] {
  const slot = jsxCatalogSlotIndex(saved, surface);
  return slot < 0 ? saved : saved.filter((_, index) => index !== slot);
}

export function compileJsxComponentDraft(input: {
  surface?: JsxComponentSurface;
  name: string;
  source: string;
  props: unknown[];
  callGuide?: string;
}): { ok: true; record: JsxComponentRecord } | { ok: false; error: string } {
  const surface = input.surface ?? "chat";
  const name = input.name.trim();
  if (!JSX_COMPONENT_NAME_RE.test(name)) {
    return { ok: false, error: "컴포넌트 이름은 PascalCase여야 합니다." };
  }
  const callGuide = readJsxCallGuide(input.callGuide);
  if (callGuide.length > JSX_CALL_GUIDE_MAX_CHARS) {
    return {
      ok: false,
      error: `AI 호출 설명은 ${JSX_CALL_GUIDE_MAX_CHARS}자 이하여야 합니다.`,
    };
  }
  const compiled = compileJsxComponentSource(input.source, name);
  if (!compiled.ok) return compiled;
  const policy = jsxSurfacePolicyError(surface, compiled.capabilities);
  if (policy) return { ok: false, error: policy };
  if (surface === "trpg_sheet") {
    // TrpgSheetSurface is the fixed props contract; no AI prop schema or call guide.
    return {
      ok: true,
      record: {
        name,
        surface,
        source: input.source.trim(),
        compiled: compiled.compiled,
        props: [],
        capabilities: compiled.capabilities,
        chatSend: compiled.chatSend,
      },
    };
  }
  const props = input.props
    .map(normalizeJsxPropDefinition)
    .filter((prop): prop is NonNullable<typeof prop> => !!prop)
    .slice(0, JSX_PROP_MAX);
  return {
    ok: true,
    record: {
      name,
      source: input.source.trim(),
      compiled: compiled.compiled,
      props,
      capabilities: compiled.capabilities,
      chatSend: compiled.chatSend,
      ...(callGuide ? { callGuide } : {}),
    },
  };
}
