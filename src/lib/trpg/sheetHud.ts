import type { TrpgSheetSnapshot } from "./types";
import type { MechanicsResolution, TrpgOngoingEffect } from "./mechanicsTypes";

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

export function recoveryHintKo(effect: Pick<TrpgOngoingEffect, "recoveryMode" | "requiredItem" | "recoveryStat">): string {
  if (effect.requiredItem) return `해독 필요: ${effect.requiredItem}`;
  if (effect.recoveryMode === "save") return "매 라운드 회복 판정";
  if (effect.recoveryMode === "treatment") return "치료로 회복";
  if (effect.recoveryMode === "persistent") return "특수 규칙이 있는 동안 유지";
  if (effect.recoveryMode === "duration") return "지속이 끝나면 자연 소멸";
  return "저항 판정 또는 치료로 회복";
}

export function mergeDisplayConditions(conditions: readonly string[], effectLabels: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of [...conditions, ...effectLabels]) {
    const label = item.trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export function formatMechanicsHudLines(
  resolution: MechanicsResolution | null,
  participantId: number
): string[] {
  if (!resolution?.complete) return [];
  const lines: string[] = [];
  const actor = resolution.actors.find((row) => row.participantId === participantId);
  if (actor?.direct?.effect === "harm" && actor.direct.dice) {
    lines.push(`피해 ${actor.direct.dice.amount}`);
    lines.push(`HP ${actor.direct.hpBefore} → ${actor.direct.hpAfter}`);
  } else if (actor?.direct?.effect === "heal" && actor.direct.dice) {
    lines.push(`회복 ${actor.direct.dice.amount}`);
    lines.push(`HP ${actor.direct.hpBefore} → ${actor.direct.hpAfter}`);
  }
  for (const tick of resolution.ongoingTicks.filter((row) => row.participantId === participantId)) {
    lines.push(`${tick.label} ${tick.dice?.amount ?? 0}`);
    lines.push(`HP ${tick.hpBefore} → ${tick.hpAfter}`);
  }
  return lines;
}

export function formatOngoingBadge(effect: {
  label: string;
  severity: string;
  kind: string;
  remainingTicks: number;
}): string {
  if (effect.kind === "control") {
    return `${effect.label} ${effect.severity} · 회복 판정 가능`;
  }
  if (effect.remainingTicks < 0) return `${effect.label} ${effect.severity}`;
  return `${effect.label} ${effect.severity} · ${effect.remainingTicks}회 남음`;
}
