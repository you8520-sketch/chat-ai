import { compileJsxComponentSource } from "./compile";

export const PIT_WALL_FIXTURE_NAME = "PitWallFixture";

/** Representative capability fixture — not a visual clone of the shared Teapot component. */
export const PIT_WALL_FIXTURE_SOURCE = `
export default function PitWallFixture(props) {
  const {
    tyreWearPct = 38,
    fuelPct = 62,
    lap = 18,
    maxLap = 58,
    driver = "Dante",
    compound = "M",
    trackTemp = 42,
    airTemp = 28,
    gapAhead = 0.8,
    gapBehind = 1.4,
    ersMode = "deploy",
    rainChance = 12,
    windKph = 9,
    tireFl = 41,
    tireFr = 39,
    tireRl = 36,
    tireRr = 37,
    damagePct = 4,
    session = "Race",
    sector = 2,
    pitWindowOpen = true,
    radioStatus = "open",
    lastLap = "1:24.331",
    bestLap = "1:23.904",
  } = props || {};

  const [tab, setTab] = React.useState("overview");
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [pulse, setPulse] = React.useState(0);
  const canvasRef = React.useRef(null);
  const rafRef = React.useRef(0);

  const wear = Math.max(0, Math.min(100, Number(tyreWearPct) || 0));
  const fuel = Math.max(0, Math.min(100, Number(fuelPct) || 0));
  const compounds = ["S", "M", "H", "I", "W"];

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext) return undefined;
    const ctx = canvas.getContext("2d");
    let start = 0;
    const draw = (ts) => {
      if (!start) start = ts;
      const t = (ts - start) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#f59e0b";
      ctx.beginPath();
      for (let x = 0; x < canvas.width; x++) {
        const y = 18 + Math.sin((x / 18) + t * 3) * 10;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tab]);

  const boxes = [
    { id: "wear", label: "Tyre wear", value: wear + "%" },
    { id: "fuel", label: "Fuel", value: fuel + "%" },
    { id: "gapA", label: "Gap ahead", value: String(gapAhead) },
    { id: "gapB", label: "Gap behind", value: String(gapBehind) },
  ];

  return (
    <div style={{ fontFamily: "sans-serif", background: "#0b1220", color: "#e5e7eb", padding: 12, borderRadius: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>{driver} · {session}</strong>
        <span>L{lap}/{maxLap} S{sector}</span>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button type="button" onClick={() => setTab("overview")}>Overview</button>
        <button type="button" onClick={() => setTab("tires")}>Tires</button>
        <button type="button" onClick={() => setTab("radio")}>Radio</button>
      </div>
      {tab === "overview" ? (
        <div>
          <div style={{ height: 8, background: "#1f2937", borderRadius: 99 }}>
            <div style={{ width: wear + "%", height: "100%", background: wear > 70 ? "#ef4444" : "#22c55e", borderRadius: 99 }} />
          </div>
          <ul>
            {boxes.map((box) => (
              <li key={box.id}>{box.label}: {box.value}</li>
            ))}
          </ul>
          <canvas ref={canvasRef} width={240} height={40} />
        </div>
      ) : null}
      {tab === "tires" ? (
        <div>
          <div>FL {tireFl} FR {tireFr}</div>
          <div>RL {tireRl} RR {tireRr}</div>
          <div>Compound {compound} · Track {trackTemp}° · Air {airTemp}°</div>
          {compounds.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => sendToChat("[PIT WALL] Box for " + c + " tires")}
            >
              Box {c}
            </button>
          ))}
        </div>
      ) : null}
      {tab === "radio" ? (
        <div>
          <div>ERS {ersMode} · rain {rainChance}% · wind {windKph} · radio {radioStatus}</div>
          <div>Last {lastLap} · Best {bestLap} · dmg {damagePct}%</div>
          <button type="button" onClick={() => sendToChat("[PIT WALL] Push now")}>Push</button>
          <button type="button" onClick={() => setChatDraft("[PIT WALL] Hold position")}>Draft hold</button>
          {pitWindowOpen ? (
            <button type="button" onClick={() => sendToChat("[PIT WALL] Box this lap")}>Box this lap</button>
          ) : <span>Window closed</span>}
        </div>
      ) : null}
      <details open={notesOpen} onToggle={(e) => setNotesOpen(e.target.open)}>
        <summary onClick={() => setPulse(pulse + 1)}>Engineer notes ({pulse})</summary>
        <p>Interactive pit wall fixture for preview/runtime parity.</p>
      </details>
    </div>
  );
}
`;

export function buildPitWallFixtureRecord() {
  const compiled = compileJsxComponentSource(PIT_WALL_FIXTURE_SOURCE);
  if (!compiled.ok) {
    throw new Error(`PitWall fixture failed to compile: ${compiled.error}`);
  }
  return {
    name: PIT_WALL_FIXTURE_NAME,
    source: PIT_WALL_FIXTURE_SOURCE.trim(),
    compiled: compiled.compiled,
    props: PIT_WALL_FIXTURE_PROPS,
    capabilities: compiled.capabilities,
    chatSend: compiled.chatSend,
  };
}

export const PIT_WALL_FIXTURE_PROPS = [
  { name: "tyreWearPct", type: "number" as const, required: true, example: "38", description: "타이어 마모 0~100" },
  { name: "fuelPct", type: "number" as const, required: true, example: "62", description: "연료 잔량" },
  { name: "lap", type: "number" as const, required: true, example: "18" },
  { name: "maxLap", type: "number" as const, required: true, example: "58" },
  { name: "driver", type: "string" as const, required: true, example: "Dante" },
  { name: "compound", type: "string" as const, required: true, example: "M" },
  { name: "trackTemp", type: "number" as const, required: false, example: "42" },
  { name: "airTemp", type: "number" as const, required: false, example: "28" },
  { name: "gapAhead", type: "number" as const, required: false, example: "0.8" },
  { name: "gapBehind", type: "number" as const, required: false, example: "1.4" },
  { name: "ersMode", type: "string" as const, required: false, example: "deploy" },
  { name: "rainChance", type: "number" as const, required: false, example: "12" },
  { name: "windKph", type: "number" as const, required: false, example: "9" },
  { name: "tireFl", type: "number" as const, required: false, example: "41" },
  { name: "tireFr", type: "number" as const, required: false, example: "39" },
  { name: "tireRl", type: "number" as const, required: false, example: "36" },
  { name: "tireRr", type: "number" as const, required: false, example: "37" },
  { name: "damagePct", type: "number" as const, required: false, example: "4" },
  { name: "session", type: "string" as const, required: false, example: "Race" },
  { name: "sector", type: "number" as const, required: false, example: "2" },
  { name: "pitWindowOpen", type: "boolean" as const, required: false, example: "true" },
  { name: "radioStatus", type: "string" as const, required: false, example: "open" },
  { name: "lastLap", type: "string" as const, required: false, example: "1:24.331" },
  { name: "bestLap", type: "string" as const, required: false, example: "1:23.904" },
];
