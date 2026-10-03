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

export type CreatorJsxExampleId = "progress" | "quest" | "choice" | "profile";

export type CreatorJsxExample = {
  id: CreatorJsxExampleId;
  label: string;
  summary: string;
  name: string;
  source: string;
  props: JsxPropDefinition[];
  primaryPropNames: string[];
};

const QUEST_CARD_SOURCE = `
export default function QuestCardExample(props) {
  const [open, setOpen] = useState(false);
  const title = String(props.title || "의뢰");
  const objective = String(props.objective || "단서를 확인한다");
  // AI-provided numeric props must never produce unbounded rendered arrays.
  const requestedStep = Number(props.step);
  const requestedTotal = Number(props.totalSteps);
  const step = Math.max(1, Math.min(20, Number.isFinite(requestedStep) ? Math.floor(requestedStep) : 1));
  const total = Math.max(step, Math.min(20, Number.isFinite(requestedTotal) ? Math.floor(requestedTotal) : 1));
  const detail = String(props.detail || "");
  const marks = [];
  for (let index = 0; index < total; index += 1) {
    marks.push(index < step);
  }

  return (
    <section
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: 14,
        borderRadius: 14,
        background: "#24180b",
        border: "1px solid rgba(245,158,11,0.45)",
        borderLeft: "4px solid #f59e0b",
        color: "#fef3c7",
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#fbbf24" }}>QUEST</div>
      <strong style={{ display: "block", marginTop: 4 }}>{title}</strong>
      <p style={{ margin: "8px 0 0", lineHeight: 1.45 }}>{objective}</p>
      <div style={{ marginTop: 10, fontSize: 12, color: "#fcd34d" }}>
        단계 {step}/{total}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {marks.map((done, index) => (
          <span
            key={index}
            style={{
              width: 22,
              height: 8,
              borderRadius: 99,
              background: done ? "#f59e0b" : "rgba(255,255,255,0.14)",
            }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          marginTop: 12,
          border: "1px solid rgba(245,158,11,0.4)",
          borderRadius: 10,
          padding: "6px 10px",
          background: "#3b2a12",
          color: "#fef3c7",
          cursor: "pointer",
        }}
      >
        {open ? "접기" : "세부 임무"}
      </button>
      {open ? <p style={{ margin: "10px 0 0", color: "#fde68a", lineHeight: 1.5 }}>{detail}</p> : null}
    </section>
  );
}
`.trim();

const CHOICE_CARD_SOURCE = `
export default function ChoiceCardExample(props) {
  const [picked, setPicked] = useState("");
  const prompt = String(props.prompt || "어떻게 할까?");
  const options = [props.first, props.second, props.third].filter(Boolean).map(String);

  return (
    <section
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: 14,
        borderRadius: 16,
        background: "#042421",
        border: "1px solid rgba(45,212,191,0.35)",
        color: "#ccfbf1",
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#5eead4" }}>CHOICE</div>
      <strong style={{ display: "block", marginTop: 4 }}>{prompt}</strong>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setPicked(option)}
          style={{
            display: "block",
            width: "100%",
            marginTop: 8,
            textAlign: "left",
            borderRadius: 12,
            border: "1px solid rgba(45,212,191,0.35)",
            padding: "8px 10px",
            background: picked === option ? "#0f766e" : "#08332f",
            color: "#f0fdfa",
            cursor: "pointer",
          }}
        >
          {picked === option ? "선택됨 · " : ""}
          {option}
        </button>
      ))}
      <p style={{ margin: "10px 0 0", color: "#99f6e4", lineHeight: 1.5 }}>
        {picked ? "지금 선택: " + picked : String(props.resultNote || "하나를 고르면 화면이 바뀝니다.")}
      </p>
    </section>
  );
}
`.trim();

const PROFILE_PANEL_SOURCE = `
export default function ProfilePanelExample(props) {
  const [tab, setTab] = useState("summary");
  const [open, setOpen] = useState(false);
  const summary = String(props.summary || "");
  const detail = String(props.detail || "");

  return (
    <section
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: 14,
        borderRadius: 18,
        background: "#0f172a",
        border: "1px solid rgba(147,197,253,0.35)",
        color: "#e2e8f0",
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#93c5fd" }}>PROFILE</div>
      <strong style={{ display: "block", marginTop: 4, fontSize: 16 }}>{String(props.name || "이름")}</strong>
      <div style={{ marginTop: 2, color: "#bfdbfe" }}>{String(props.role || "역할")}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <button
          type="button"
          onClick={() => setTab("summary")}
          style={{
            borderRadius: 999,
            border: "1px solid rgba(147,197,253,0.4)",
            padding: "6px 10px",
            background: tab === "summary" ? "#1d4ed8" : "transparent",
            color: "#eff6ff",
            cursor: "pointer",
          }}
        >
          요약
        </button>
        <button
          type="button"
          onClick={() => setTab("detail")}
          style={{
            borderRadius: 999,
            border: "1px solid rgba(147,197,253,0.4)",
            padding: "6px 10px",
            background: tab === "detail" ? "#1d4ed8" : "transparent",
            color: "#eff6ff",
            cursor: "pointer",
          }}
        >
          상세
        </button>
      </div>
      <p style={{ margin: "10px 0 0", lineHeight: 1.5 }}>{tab === "detail" ? detail : summary}</p>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          marginTop: 12,
          border: 0,
          background: "transparent",
          color: "#93c5fd",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? "기록 접기" : "기록 보기"}
      </button>
      {open ? (
        <p style={{ margin: "8px 0 0", color: "#cbd5e1", lineHeight: 1.5 }}>{detail}</p>
      ) : null}
    </section>
  );
}
`.trim();

export const CREATOR_JSX_EXAMPLES: CreatorJsxExample[] = [
  {
    id: "progress",
    label: "진행 상황 카드",
    summary: "수치 바와 펼치기",
    name: CREATOR_JSX_EXAMPLE_NAME,
    source: CREATOR_JSX_EXAMPLE_SOURCE,
    props: CREATOR_JSX_EXAMPLE_PROPS,
    primaryPropNames: ["title", "value", "note"],
  },
  {
    id: "quest",
    label: "퀘스트 카드",
    summary: "임무, 단계, 진행도",
    name: "QuestCardExample",
    source: QUEST_CARD_SOURCE,
    props: [
      { name: "title", type: "string", required: true, example: "사라진 지도", description: "퀘스트 제목" },
      { name: "objective", type: "string", required: true, example: "항구에서 지도 조각을 찾는다", description: "지금 할 일" },
      { name: "step", type: "number", required: true, example: "2", description: "현재 단계" },
      { name: "totalSteps", type: "number", required: false, example: "4", description: "전체 단계 수" },
      { name: "detail", type: "string", required: false, example: "등대지기만 조각의 위치를 알고 있다.", description: "펼치면 보이는 세부 내용" },
    ],
    primaryPropNames: ["title", "step", "objective"],
  },
  {
    id: "choice",
    label: "선택지 카드",
    summary: "선택 후 화면 상태 변경",
    name: "ChoiceCardExample",
    source: CHOICE_CARD_SOURCE,
    props: [
      { name: "prompt", type: "string", required: true, example: "문을 어떻게 열까?", description: "선택 질문" },
      { name: "first", type: "string", required: true, example: "조심스럽게 노크한다", description: "첫 번째 선택" },
      { name: "second", type: "string", required: true, example: "열쇠를 사용한다", description: "두 번째 선택" },
      { name: "third", type: "string", required: false, example: "일단 지나간다", description: "세 번째 선택" },
      { name: "resultNote", type: "string", required: false, example: "하나를 고르면 화면이 바뀝니다.", description: "선택 전 안내" },
    ],
    primaryPropNames: ["prompt", "first", "second"],
  },
  {
    id: "profile",
    label: "인물 정보 패널",
    summary: "정보 전환과 상세 보기",
    name: "ProfilePanelExample",
    source: PROFILE_PANEL_SOURCE,
    props: [
      { name: "name", type: "string", required: true, example: "이안", description: "인물 이름" },
      { name: "role", type: "string", required: false, example: "기록 보관인", description: "역할" },
      { name: "summary", type: "string", required: true, example: "말수가 적고, 오래된 장부를 맡는다.", description: "요약" },
      { name: "detail", type: "string", required: false, example: "비 오는 날에는 서고 문을 일찍 닫는다.", description: "상세 기록" },
    ],
    primaryPropNames: ["name", "role", "summary"],
  },
];

export function creatorJsxExampleById(id: CreatorJsxExampleId): CreatorJsxExample {
  switch (id) {
    case "progress":
    case "quest":
    case "choice":
    case "profile": {
      const found = CREATOR_JSX_EXAMPLES.find((example) => example.id === id);
      if (!found) throw new Error(`missing creator example ${id}`);
      return found;
    }
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function primaryJsxPropNames(
  props: JsxPropDefinition[],
  preferred: string[] = []
): string[] {
  const known = preferred.filter((name) => props.some((prop) => prop.name === name));
  if (known.length > 0) return known;
  const names: string[] = [];
  const strings = props.filter((prop) => prop.type === "string");
  const number = props.find((prop) => prop.type === "number");
  if (strings[0]) names.push(strings[0].name);
  if (number) names.push(number.name);
  const extra = strings.find((prop) => prop.name !== strings[0]?.name);
  if (extra) names.push(extra.name);
  return names.slice(0, 3);
}

export function jsxPropPreviewValues(
  props: JsxPropDefinition[],
  overrides: Record<string, string> = {}
): Record<string, string | number | boolean> {
  const values: Record<string, string | number | boolean> = {};
  for (const prop of props) {
    const raw = overrides[prop.name] ?? prop.example ?? "";
    if (prop.type === "number") {
      values[prop.name] = Number(raw);
    } else if (prop.type === "boolean") {
      values[prop.name] = raw === "true";
    } else {
      values[prop.name] = raw;
    }
  }
  return values;
}
