import { JSX_COMPONENT_NAME_RE, type JsxInvocation } from "./types";

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
