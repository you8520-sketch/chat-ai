import { fieldPlaceholderKey } from "./fieldKeys";
import type { StatusWidgetField } from "./types";

function escapeSourceText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\"')
    .replace(/\r?\n/g, " ");
}

/** Starter for StatusWidget JSX mode. Field keys are props; extraction stays on fields. */
export function defaultStatusWidgetJsxSource(fields: StatusWidgetField[]): string {
  const rows = fields
    .map((field) => {
      const key = fieldPlaceholderKey(field);
      if (!key) return "";
      const label = escapeSourceText(field.label.trim() || field.id || key);
      return `        <div style={{ minWidth: 0, padding: 10, borderRadius: 10, background: "rgba(255,255,255,0.035)" }}>
          <div style={{ fontSize: 11, color: "#a1a1aa", marginBottom: 5, overflowWrap: "anywhere" }}>${JSON.stringify(label)}</div>
          <div style={{ color: "#f4f4f5", lineHeight: 1.45, overflowWrap: "anywhere", wordBreak: "break-word" }}>{props[${JSON.stringify(key)}]}</div>
        </div>`;
    })
    .filter(Boolean)
    .join("\n");

  const body =
    rows ||
    `        <div style={{ color: "#a1a1aa", fontSize: 12 }}>상태값을 추가하면 여기에 표시됩니다.</div>`;

  return `export default function StatusWidgetView(props) {
  return (
    <section
      style={{
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        boxSizing: "border-box",
        padding: 12,
        borderRadius: 14,
        background: "#101218",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "#ececf1",
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "#d4d4d8" }}>상태</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(9rem,1fr))",
          gap: 8,
          marginTop: 10,
          minWidth: 0,
        }}
      >
${body}
      </div>
    </section>
  );
}
`;
}
