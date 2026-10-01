import { fieldPlaceholderKey } from "./fieldKeys";
import type { StatusWidgetField } from "./types";

/** Starter for StatusWidget JSX mode. Field keys are props; extraction stays on fields. */
export function defaultStatusWidgetJsxSource(fields: StatusWidgetField[]): string {
  const keys = fields.map((field) => fieldPlaceholderKey(field)).filter((key) => key.length > 0);
  const body =
    keys.length > 0
      ? keys
          .map(
            (key) =>
              `      <p style={{ margin: "4px 0", minWidth: 0, overflowWrap: "anywhere" }}>{props[${JSON.stringify(key)}]}</p>`
          )
          .join("\n")
      : `      <p style={{ margin: 0 }}>—</p>`;
  return `export default function StatusWidgetView(props) {
  return (
    <section style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", color: "#ececf1", fontFamily: "inherit" }}>
${body}
    </section>
  );
}
`;
}
