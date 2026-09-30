import { analyzeJsxCapabilities } from "./capabilities";
import { compileJsxComponentSource } from "./compile";
import { JSX_PROP_MAX } from "./limits";
import { normalizeJsxPropDefinition } from "./manifest";
import { JSX_COMPONENT_NAME_RE, type JsxCapability, type JsxComponentRecord } from "./types";

export function parseJsxComponentCatalog(raw: string | null | undefined): JsxComponentRecord[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: JsxComponentRecord[] = [];
    for (const item of parsed.slice(0, 12)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      const source = String(row.source ?? "").trim();
      if (!JSX_COMPONENT_NAME_RE.test(name) || !source) continue;

      let compiled = String(row.compiled ?? "").trim();
      let capabilities = Array.isArray(row.capabilities)
        ? (row.capabilities.filter((c): c is JsxCapability => typeof c === "string") as JsxCapability[])
        : analyzeJsxCapabilities(source);
      let chatSend = Boolean(row.chatSend) || capabilities.includes("chat_send");

      if (!compiled) {
        const fresh = compileJsxComponentSource(source);
        if (!fresh.ok) continue;
        compiled = fresh.compiled;
        capabilities = fresh.capabilities;
        chatSend = fresh.chatSend;
      }

      const props = Array.isArray(row.props)
        ? row.props
            .map(normalizeJsxPropDefinition)
            .filter((prop): prop is NonNullable<typeof prop> => !!prop)
            .slice(0, JSX_PROP_MAX)
        : [];

      out.push({ name, source, compiled, props, capabilities, chatSend });
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeJsxComponentCatalog(components: JsxComponentRecord[]): string {
  return JSON.stringify(
    components.slice(0, 12).map((component) => ({
      name: component.name,
      source: component.source,
      compiled: component.compiled,
      props: component.props.slice(0, JSX_PROP_MAX),
      capabilities: component.capabilities,
      chatSend: component.chatSend,
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
  const compiled = compileJsxComponentSource(input.source);
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
