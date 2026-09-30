import { JSX_PROP_MAX } from "./limits";
import { JSX_COMPONENT_NAME_RE, type JsxComponentRecord, type JsxPropDefinition } from "./types";

const PROP_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,47}$/;

export function normalizeJsxPropDefinition(raw: unknown): JsxPropDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const name = String(row.name ?? "").trim();
  if (!PROP_NAME_RE.test(name)) return null;
  const type = row.type === "number" || row.type === "boolean" ? row.type : "string";
  const example = String(row.example ?? "").trim().slice(0, 80);
  const description = String(row.description ?? "").trim().slice(0, 160);
  return {
    name,
    type,
    required: row.required === true,
    ...(example ? { example } : {}),
    ...(description ? { description } : {}),
  };
}

export function buildJsxComponentManifestBlock(components: JsxComponentRecord[]): string {
  const usable = components.filter((c) => JSX_COMPONENT_NAME_RE.test(c.name)).slice(0, 12);
  if (usable.length === 0) return "";

  const lines = [
    "[HAV JSX COMPONENTS]",
    "When the scene needs a registered interactive board, emit exactly one self-closing PascalCase invocation.",
    "Do not invent components. Do not emit JSX source, HTML, or style.",
    "Example: <StatusBoard hp={45} maxHp={100} />",
    "",
  ];
  for (const component of usable) {
    const props = component.props.slice(0, JSX_PROP_MAX);
    const inner = props
      .map((prop) => {
        const req = prop.required ? "" : "?";
        const hint = [prop.description, prop.example ? `example: ${prop.example}` : ""]
          .filter(Boolean)
          .join(" ");
        return `  ${prop.name}${req}: ${prop.type}${hint ? `  // ${hint}` : ""}`;
      })
      .join("\n");
    lines.push(`${component.name}(\n${inner || "  // no props"}\n)`);
    if (component.chatSend) {
      lines.push(`  // uses chat send request; user must confirm in host`);
    }
  }
  return lines.join("\n");
}
