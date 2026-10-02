import { analyzeJsxCapabilities } from "./capabilities";
import { compileJsxComponentSource } from "./compile";
import { JSX_PROP_MAX, JSX_SOURCE_MAX_CHARS } from "./limits";
import { normalizeJsxPropDefinition } from "./manifest";
import {
  JSX_COMPONENT_NAME_RE,
  type JsxComponentManifestRecord,
  type JsxComponentRecord,
  type JsxRuntimeComponentRecord,
  type JsxPropDefinition,
} from "./types";

type StoredJsxComponent = {
  name: string;
  source: string;
  props: JsxPropDefinition[];
};

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
      if (
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
      out.push({ name, source, props });
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
      source: item.source,
      compiled: fresh.compiled,
      props: item.props,
      capabilities: fresh.capabilities,
      chatSend: fresh.chatSend,
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
  return parseStoredJsxComponents(raw).map((item) => ({
    name: item.name,
    props: item.props,
    chatSend: analyzeJsxCapabilities(item.source).includes("chat_send"),
  }));
}

export function parseJsxRuntimeComponentCatalog(
  raw: string | null | undefined
): JsxRuntimeComponentRecord[] {
  return parseJsxComponentCatalog(raw).map(({ source: _source, ...runtime }) => runtime);
}

export function serializeJsxComponentCatalog(components: JsxComponentRecord[]): string {
  return JSON.stringify(
    components.slice(0, 12).map((component) => ({
      name: component.name,
      source: component.source,
      props: component.props.slice(0, JSX_PROP_MAX),
    }))
  );
}

export function findJsxComponent(
  catalog: JsxComponentRecord[],
  name: string
): JsxComponentRecord | null {
  return catalog.find((component) => component.name === name) ?? null;
}

export type JsxCatalogDraftInput = {
  name: string;
  source: string;
  props: JsxPropDefinition[];
};

export function jsxCatalogEditableFingerprint(
  input: { name: string; source: string; props: JsxPropDefinition[] } | null
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
  if (!input.name.trim() && !input.source.trim() && props.length === 0) return "";
  return JSON.stringify({
    name: input.name.trim(),
    source: input.source.trim(),
    props,
  });
}

const EMPTY_JSX_CATALOG_DRAFT: JsxCatalogDraftInput = { name: "", source: "", props: [] };

export function hydrateJsxCatalogEditorState(input: {
  appliedSavedFingerprint: string;
  draft: JsxCatalogDraftInput;
  saved: JsxComponentRecord | null;
}): { appliedSavedFingerprint: string; draft: JsxCatalogDraftInput; hydrated: boolean } {
  const nextFingerprint = jsxCatalogEditableFingerprint(
    input.saved
      ? { name: input.saved.name, source: input.saved.source, props: input.saved.props }
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
  const savedHead = saved[0] ?? null;
  const unsaved =
    jsxCatalogEditableFingerprint(
      savedHead
        ? { name: savedHead.name, source: savedHead.source, props: savedHead.props }
        : null
    ) !== jsxCatalogEditableFingerprint(draft);
  const result = compileJsxComponentDraft(draft);
  if (!result.ok) {
    return { catalog: saved, error: result.error, preview: null, unsaved };
  }
  return {
    // Editing the visible first slot must not erase the rest of a saved
    // multi-component catalog. The UI only edits one slot for now.
    catalog: [result.record, ...saved.slice(1)],
    error: "",
    preview: result.record,
    unsaved: false,
  };
}

/** Explicitly remove the visible first saved component, preserving other slots. */
export function removeJsxCatalogHead(saved: JsxComponentRecord[]): JsxComponentRecord[] {
  return saved.slice(1);
}

export function compileJsxComponentDraft(input: {
  name: string;
  source: string;
  props: unknown[];
}): { ok: true; record: JsxComponentRecord } | { ok: false; error: string } {
  const name = input.name.trim();
  if (!JSX_COMPONENT_NAME_RE.test(name)) {
    return { ok: false, error: "컴포넌트 이름은 PascalCase여야 합니다." };
  }
  const compiled = compileJsxComponentSource(input.source, name);
  if (!compiled.ok) return compiled;
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
    },
  };
}
