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
