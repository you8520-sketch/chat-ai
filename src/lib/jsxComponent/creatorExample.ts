import type { JsxPropDefinition } from "./types";

export const CREATOR_JSX_EXAMPLE_NAME = "InteractiveCardExample";

export const CREATOR_JSX_EXAMPLE_PROPS: JsxPropDefinition[] = [
  {
    name: "title",
    type: "string",
    required: true,
    example: "진행 상황",
    description: "카드 상단에 표시할 제목",
  },
  {
    name: "value",
    type: "number",
    required: true,
    example: "42",
    description: "현재 값",
  },
  {
    name: "max",
    type: "number",
    required: false,
    example: "100",
    description: "최대 값",
  },
  {
    name: "note",
    type: "string",
    required: false,
    example: "버튼을 눌러 세부 내용을 펼쳐보세요.",
    description: "펼쳤을 때 보여줄 설명",
  },
];

export const CREATOR_JSX_EXAMPLE_SOURCE = `
export default function InteractiveCardExample({
  title = "진행 상황",
  value = 42,
  max = 100,
  note = "버튼을 눌러 세부 내용을 펼쳐보세요.",
}) {
  const [open, setOpen] = useState(false);
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Math.min(safeMax, Number(value) || 0));
  const ratio = Math.round((safeValue / safeMax) * 100);

  return (
    <section
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: 14,
        borderRadius: 14,
        background: "#101218",
        border: "1px solid rgba(255,255,255,0.10)",
        color: "#f4f4f5",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong>{title}</strong>
        <span style={{ color: "#c4b5fd", fontVariantNumeric: "tabular-nums" }}>
          {safeValue}/{safeMax}
        </span>
      </div>

      <div
        style={{
          height: 7,
          marginTop: 10,
          overflow: "hidden",
          borderRadius: 999,
          background: "rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            width: ratio + "%",
            height: "100%",
            borderRadius: 999,
            background: "#8b5cf6",
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          marginTop: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          padding: "6px 10px",
          background: "#18181b",
          color: "#e4e4e7",
          cursor: "pointer",
        }}
      >
        {open ? "접기" : "자세히"}
      </button>

      {open ? (
        <p style={{ margin: "10px 0 0", color: "#a1a1aa", lineHeight: 1.5 }}>
          {note}
        </p>
      ) : null}
    </section>
  );
}
`.trim();
