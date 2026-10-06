import { compileJsxComponentSource } from "@/lib/jsxComponent/compile";

export const TRPG_SHEET_JSX_COMPONENT = "TrpgSheet";

/**
 * Site-owned default TRPG sheet. Runs in the shared opaque JSX sandbox and
 * receives a TrpgSheetSurface copy as props. Host effects are the draft-only
 * setTrpgActionDraft global and setTrpgSelectedStat. Both are no-ops unless
 * the viewer's own sheet mounted a handler; party sheets mount neither.
 */
export const TRPG_SHEET_JSX_SOURCE = String.raw`
function TrpgSheet(props) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const text = (value) => (typeof value === "string" ? value : "");
  const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const stats = list(props.stats);
  const conditions = list(props.conditions);
  const effects = list(props.effects);
  const inventory = list(props.inventory);
  const mechanics = list(props.mechanics);
  const place = text(props.place);
  const note = text(props.modifiersNote);
  const pct = Math.max(0, Math.min(100, num(props.hpPercent)));
  const risk = text(props.hpRisk);
  const barColor = risk === "safe" ? "#34d399" : risk === "wounded" ? "#fbbf24" : "#fb7185";
  const interactive = props.interactive === true;

  const fill = (draft) => {
    if (!interactive || !draft) return;
    setTrpgActionDraft(draft.actionType, draft.body);
  };
  const selectStat = (key) => {
    if (!interactive || typeof setTrpgSelectedStat !== "function") return;
    setTrpgSelectedStat(key);
  };
  const signed = (n) => (n >= 0 ? "+" + n : String(n));

  const label = { fontSize: 12, color: "#71717a", margin: "0 0 4px" };
  const chip = {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: 500,
    border: "1px solid rgba(252,211,77,0.3)",
    background: "rgba(251,191,36,0.1)",
    color: "#fef3c7",
  };
  const action = {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 44,
    maxWidth: "100%",
    borderRadius: 999,
    padding: "0 12px",
    fontSize: 12,
    cursor: "pointer",
    font: "inherit",
  };
  const row = { display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", margin: 0, padding: 0 };

  return (
    <div
      data-trpg-sheet-jsx={String(num(props.participantId))}
      style={{
        fontFamily: "system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        fontSize: 14,
        color: "#e4e4e7",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 2,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#ede9fe", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {text(props.name)}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "#71717a" }}>Lv {num(props.level)}</p>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "#d4d4d8", fontVariantNumeric: "tabular-nums" }}>
          HP {num(props.hp)}/{num(props.maxHp)}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.max(num(props.maxHp), 1)}
        aria-valuenow={num(props.hp)}
        aria-label={"HP " + num(props.hp) + "/" + num(props.maxHp)}
        style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}
      >
        <div style={{ height: "100%", width: pct + "%", borderRadius: 999, background: barColor }} />
      </div>
      {place ? (
        <p style={{ margin: 0, fontSize: 12, color: "#a1a1aa" }}>
          <span style={{ color: "#71717a" }}>위치 </span>
          {place}
        </p>
      ) : null}
      <div>
        <p style={label}>능력치</p>
        <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(7.5rem, 1fr))", gap: "4px 12px", listStyle: "none", margin: 0, padding: 0 }}>
          {stats.map((stat) =>
            interactive ? (
              <li key={text(stat.key)}>
                <button
                  type="button"
                  data-trpg-stat={text(stat.key)}
                  onClick={() => selectStat(text(stat.key))}
                  style={{
                    ...action,
                    width: "100%",
                    justifyContent: "flex-start",
                    padding: "0 4px",
                    border: "none",
                    background: "transparent",
                    color: "#d4d4d8",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {text(stat.label)} {num(stat.value)}
                  <span style={{ color: "#71717a" }}> ({signed(num(stat.modifier))})</span>
                </button>
              </li>
            ) : (
              <li key={text(stat.key)} data-trpg-stat={text(stat.key)} style={{ color: "#d4d4d8", fontVariantNumeric: "tabular-nums" }}>
                {text(stat.label)} {num(stat.value)}
                <span style={{ color: "#71717a" }}> ({signed(num(stat.modifier))})</span>
              </li>
            )
          )}
        </ul>
      </div>
      {note ? (
        <p style={{ margin: 0, fontSize: 12, color: "#a1a1aa" }}>
          <span style={{ color: "#71717a" }}>보정 </span>
          {note}
        </p>
      ) : null}
      {mechanics.length > 0 ? (
        <div data-trpg-mechanics-lines="">
          <p style={label}>판정 결과</p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12, color: "#d4d4d8", fontVariantNumeric: "tabular-nums" }}>
            {mechanics.map((line, index) => (
              <li key={index + ":" + text(line)}>{text(line)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <p style={label}>상태</p>
        {conditions.length === 0 && effects.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: "#71717a" }}>없음</p>
        ) : (
          <ul style={row}>
            {conditions.map((item) => (
              <li key={"n:" + text(item)} style={chip}>
                {text(item)}
              </li>
            ))}
            {effects.map((effect) =>
              interactive && effect.draft ? (
                <li key={"e:" + text(effect.key)}>
                  <button
                    type="button"
                    title={text(effect.hint)}
                    data-trpg-condition-draft={text(effect.label)}
                    onClick={() => fill(effect.draft)}
                    style={{
                      ...action,
                      fontWeight: 600,
                      border: "1px solid rgba(56,189,248,0.3)",
                      background: "rgba(14,165,233,0.1)",
                      color: "#e0f2fe",
                    }}
                  >
                    {text(effect.badge)}
                  </button>
                </li>
              ) : (
                <li key={"e:" + text(effect.key)} title={text(effect.hint)} style={chip}>
                  {text(effect.badge)}
                </li>
              )
            )}
          </ul>
        )}
      </div>
      <div>
        <p style={label}>소지품</p>
        {inventory.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: "#71717a" }}>없음</p>
        ) : (
          <ul style={row}>
            {inventory.map((item) =>
              interactive && item.draft ? (
                <li key={text(item.key)}>
                  <button
                    type="button"
                    data-trpg-inventory-item={text(item.name)}
                    onClick={() => fill(item.draft)}
                    style={{
                      ...action,
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "rgba(255,255,255,0.05)",
                      color: "#f4f4f5",
                    }}
                  >
                    {text(item.name)}
                  </button>
                </li>
              ) : (
                <li
                  key={text(item.key)}
                  style={{
                    ...action,
                    cursor: "default",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.05)",
                    color: "#e4e4e7",
                  }}
                >
                  {text(item.name)}
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
`;

let cached: { compiled: string | null } | null = null;

/** Compiled once per server process through the shared creator JSX compiler. */
export function compileTrpgSheetJsx(): string | null {
  if (!cached) {
    const result = compileJsxComponentSource(TRPG_SHEET_JSX_SOURCE, TRPG_SHEET_JSX_COMPONENT);
    cached = { compiled: result.ok ? result.compiled : null };
  }
  return cached.compiled;
}
