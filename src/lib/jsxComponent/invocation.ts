import { JSX_COMPONENT_NAME_RE, type JsxInvocation, type JsxPropDefinition } from "./types";

const SELF_CLOSING_RE =
  /<([A-Z][A-Za-z0-9]*)\b([^>]*?)\/>/g;

function parseAttrValue(raw: string): string | number | boolean {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v.replace(/^['"]|['"]$/g, "");
}

function parseProps(attrSource: string): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:\{([^{}]+)\}|"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrSource))) {
    const name = match[1]!;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    props[name] = parseAttrValue(value);
  }
  return props;
}

export function findJsxInvocation(text: string): { index: number; invocation: JsxInvocation } | null {
  SELF_CLOSING_RE.lastIndex = 0;
  const match = SELF_CLOSING_RE.exec(text);
  if (!match || match.index == null) return null;
  const name = match[1]!;
  if (!JSX_COMPONENT_NAME_RE.test(name)) return null;
  return {
    index: match.index,
    invocation: {
      name,
      props: parseProps(match[2] ?? ""),
      raw: match[0],
    },
  };
}

export function extractJsxInvocations(text: string): JsxInvocation[] {
  const out: JsxInvocation[] = [];
  let rest = text;
  while (rest.length > 0) {
    const found = findJsxInvocation(rest);
    if (!found) break;
    out.push(found.invocation);
    rest = rest.slice(found.index + found.invocation.raw.length);
  }
  return out;
}

export function isIncompleteJsxInvocation(text: string): boolean {
  const open = text.lastIndexOf("<");
  if (open < 0) return false;
  const tail = text.slice(open);
  if (!/^<[A-Z]/.test(tail)) return false;
  return !/\/>/.test(tail) && !/>/.test(tail.slice(1));
}


export type JsxInvocationPropsResult =
  | { ok: true; props: Record<string, string | number | boolean> }
  | { ok: false; error: string };

/**
 * Canonical runtime prop boundary. AI syntax is permissive, but a registered
 * component receives only declared props, normalized to the creator schema.
 */
export function resolveJsxInvocationProps(
  definitions: JsxPropDefinition[],
  input: Record<string, string | number | boolean>
): JsxInvocationPropsResult {
  const out: Record<string, string | number | boolean> = {};
  for (const def of definitions) {
    const has = Object.prototype.hasOwnProperty.call(input, def.name);
    if (!has) {
      if (def.required) {
        return { ok: false, error: `필수 prop이 없습니다: ${def.name}` };
      }
      continue;
    }
    const raw = input[def.name]!;
    if (def.type === "string") {
      out[def.name] = String(raw);
      continue;
    }
    if (def.type === "number") {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) {
        return { ok: false, error: `number prop 형식이 잘못되었습니다: ${def.name}` };
      }
      out[def.name] = n;
      continue;
    }
    if (typeof raw === "boolean") {
      out[def.name] = raw;
      continue;
    }
    const bool = String(raw).trim().toLowerCase();
    if (bool === "true" || bool === "false") {
      out[def.name] = bool === "true";
      continue;
    }
    return { ok: false, error: `boolean prop 형식이 잘못되었습니다: ${def.name}` };
  }
  return { ok: true, props: out };
}
