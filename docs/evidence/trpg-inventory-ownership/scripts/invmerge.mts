import { readFileSync } from "node:fs";
import { mergeMechanicsOwnedDelta } from "/workspace/src/lib/trpg/mechanicsMerge";
import { inventoryFromUnits, inventoryUnits } from "/workspace/src/lib/trpg/inventory";
const ev = "/tmp/ev/docs/evidence/trpg-1541-real-play/live";
const d3 = JSON.parse(readFileSync(ev + "/parsed/call-10-gm-r3-delta.json", "utf8")).delta;
const mk = (id: number, name: string, items: string[]) => ({ participantId: id, name, hp: 40, maxHp: 40, conditions: [], inventory: inventoryFromUnits(items), stats: {}, location: "마레노 부두" });
const before = [mk(1, "렌", ["그을린 장부 조각", "민우의 놋쇠 회중시계"]), mk(2, "현", ["세관 황동 열쇠"]), mk(3, "서하", []), mk(4, "도윤", [])];
const out = mergeMechanicsOwnedDelta(before as never, d3, null);
console.log("INVALID_GM_INVENTORY_DELTA", out.INVALID_GM_INVENTORY_DELTA);
for (const s of out.next) console.log(s.name, JSON.stringify(inventoryUnits(s.inventory)));
// replay the same delta twice (retry on same pre-state) to check idempotence at the merge boundary
const again = mergeMechanicsOwnedDelta(before as never, d3, null);
console.log("same pre-state twice equal:", JSON.stringify(again.next.map((s) => inventoryUnits(s.inventory))) === JSON.stringify(out.next.map((s) => inventoryUnits(s.inventory))));
