import { compileJsxComponentSource } from "@/lib/jsxComponent/compile";
import { SCROLL_FOLLOW_LAB_BOT1_ID, SCROLL_FOLLOW_LAB_BOT2_ID } from "./scrollFollowLabFixture";

function creatorSheetSource(tag: string): string {
  return `export default function CreatorSheet${tag}(props) {
  return (
    <div data-creator-sheet="${tag}" style={{ padding: 12, color: "#f4f4f5" }}>
      <p>CREATOR-${tag} {props.name}</p>
      <p>HP {props.hp}/{props.maxHp}</p>
      <button onClick={() => setTrpgActionDraft("attack_now", "크리에이터 시트 공격")}>초안</button>
    </div>
  );
}`;
}

/** Lab-only creator `trpg_sheet` fixtures keyed by AI participant id. Server-compiled. */
export function compileLabPartySheets(): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [participantId, tag] of [
    [SCROLL_FOLLOW_LAB_BOT1_ID, "A"],
    [SCROLL_FOLLOW_LAB_BOT2_ID, "B"],
  ] as const) {
    const compiled = compileJsxComponentSource(creatorSheetSource(tag), `CreatorSheet${tag}`);
    if (compiled.ok) out[participantId] = compiled.compiled;
  }
  return out;
}
