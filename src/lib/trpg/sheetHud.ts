import type { TrpgSheetSnapshot } from "./types";

export type TrpgHpRisk = "safe" | "wounded" | "critical";

export function hpRiskLevel(hp: number, maxHp: number): TrpgHpRisk {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  if (ratio > 0.5) return "safe";
  if (ratio > 0.25) return "wounded";
  return "critical";
}

export function hpBarClass(hp: number, maxHp: number): string {
  const risk = hpRiskLevel(hp, maxHp);
  if (risk === "safe") return "bg-emerald-400";
  if (risk === "wounded") return "bg-amber-400";
  return "bg-rose-400";
}

export function compactConditions(conditions: readonly string[], limit = 1): string[] {
  return conditions.map((item) => item.trim()).filter(Boolean).slice(0, limit);
}

export function inventoryCount(inventory: readonly string[]): number {
  return inventory.filter((item) => item.trim()).length;
}

export function selfHudAriaLabel(sheet: Pick<TrpgSheetSnapshot, "name" | "hp" | "maxHp" | "location" | "conditions" | "inventory">): string {
  const conditions = sheet.conditions.filter((item) => item.trim());
  const items = inventoryCount(sheet.inventory);
  const location = sheet.location.trim();
  return [
    `${sheet.name} 시트`,
    `HP ${sheet.hp}/${sheet.maxHp}`,
    location ? `위치 ${location}` : "",
    conditions.length ? `상태 ${conditions.join(", ")}` : "상태 없음",
    `소지품 ${items}개`,
  ]
    .filter(Boolean)
    .join(", ");
}
