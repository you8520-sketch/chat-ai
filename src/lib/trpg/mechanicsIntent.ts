import type { TrpgActionType } from "./actionTypes";

const BASIC_FIRST_AID_RE =
  /응급처치|응급\s*처치|상처를\s*묶|상처를\s*압박|지혈|상처를\s*치료|first\s*aid/i;
const GENERIC_HEAL_RE = /치료|치유|회복|붕대|해독|응급|heal|treat|antidote|bandage|medkit|구급/i;
const COVER_FIRE_RE = /엄호\s*사격|엄호사격|엄호한다/;
const SAFE_REST_RE =
  /휴식한다|휴식하며|휴식을\s*취|안전한\s*곳에서[\s\S]{0,16}휴식|안전한\s*곳에서\s*쉰|야영하며\s*몸을\s*추스르|잠깐\s*숨을\s*돌린|숨을\s*돌린다|\brest\b/i;
const TREATMENT_ITEM_NAME_RE =
  /구급키트|붕대|회복약|해독제|치료제|medkit|bandage|antidote|potion|포션/i;
const ITEM_USE_RE = /사용|쓴다|꺼낸|바른|먹|투여|바르/i;
const CANON_HEAL_RE = /치유 주문|회복 마법|힐링 스펠|대치유|healing (?:spell|magic)|회복 능력/i;

export const CONTEXTUAL_FIRST_AID_DRAFT = "상처를 응급처치한다.";
export const CONTEXTUAL_POISON_TREAT_DRAFT = "중독 상태를 치료하려 한다.";
export const CONTEXTUAL_BLEED_TREAT_DRAFT = "출혈을 지혈하려 한다.";
export const CONTEXTUAL_SAFE_REST_DRAFT = "안전한 곳에서 잠시 휴식하며 상처를 추스른다.";
export const RECOVERY_DISCOVERY_HINT =
  "HP 회복: 지원으로 응급처치 · 안전한 곳에서 휴식 · 치료 아이템 사용";
export const SAFE_REST_ONGOING_NOTICE =
  "휴식은 HP를 회복하지만 중독·출혈·마비 등은 별도 치료/회복 판정이 필요할 수 있습니다.";
export const SAFE_REST_COOLDOWN_HINT = "아직 다시 휴식할 수 없습니다.";

export function isSafeRestIntent(body: string): boolean {
  return SAFE_REST_RE.test(body.replace(/\s+/g, " ").trim());
}

export function isBasicFirstAidIntent(body: string): boolean {
  return BASIC_FIRST_AID_RE.test(body);
}

export function isCoverFireSupport(body: string): boolean {
  if (COVER_FIRE_RE.test(body) && !GENERIC_HEAL_RE.test(body)) return true;
  return /엄호/.test(body) && /사격/.test(body) && !GENERIC_HEAL_RE.test(body);
}

export function isTreatmentItemName(name: string): boolean {
  return TREATMENT_ITEM_NAME_RE.test(name);
}

export function hasCanonHealingCapability(specialRules: string, body: string): boolean {
  const rules = specialRules.trim();
  if (!rules) return false;
  return CANON_HEAL_RE.test(rules) && CANON_HEAL_RE.test(body);
}

export function findExplicitTreatmentItem(
  body: string,
  sourceInventory: readonly string[],
  extraKnown: readonly string[] = []
): string | null {
  const known = [...sourceInventory, ...extraKnown];
  for (const item of sourceInventory) {
    const name = item.trim();
    if (!name) continue;
    if (body.includes(name) && (isTreatmentItemName(name) || extraKnown.includes(name))) {
      return name;
    }
  }
  const mentioned = body.match(TREATMENT_ITEM_NAME_RE)?.[0];
  if (!mentioned) return null;
  const found = known.find((row) => row.includes(mentioned) || mentioned.includes(row.trim()));
  return found?.trim() || null;
}

export function isTreatmentItemIntent(
  body: string,
  sourceInventory: readonly string[] = [],
  extraKnown: readonly string[] = []
): boolean {
  const item = findExplicitTreatmentItem(body, sourceInventory, extraKnown);
  if (!item) return false;
  return ITEM_USE_RE.test(body) || /사용한다|쓴다/.test(body);
}

export function isStatusTreatmentOnly(body: string): boolean {
  return /해독|antidote|중독/.test(body) && !/상처|응급|회복약|구급|체력|붕대|지혈/i.test(body);
}

export function isHpHealingItem(name: string): boolean {
  return /구급키트|붕대|회복약|medkit|bandage|potion|포션/.test(name) && !/해독/.test(name);
}

export function isHealingIntentAction(
  actionType: string | null,
  body = "",
  sourceInventory: readonly string[] = [],
  extraKnown: readonly string[] = []
): boolean {
  if (isSafeRestIntent(body)) return false;
  if (isCoverFireSupport(body)) return false;
  if (isStatusTreatmentOnly(body)) return false;
  if (isBasicFirstAidIntent(body)) return true;
  const item = findExplicitTreatmentItem(body, sourceInventory, extraKnown);
  if (item && isTreatmentItemIntent(body, sourceInventory, extraKnown) && isHpHealingItem(item)) return true;
  if (GENERIC_HEAL_RE.test(body) && (actionType === "support" || actionType === "use_item" || actionType === "free")) {
    return true;
  }
  return false;
}

export function isTreatmentCapableAction(actionType: TrpgActionType | null, body: string): boolean {
  return actionType === "support" || actionType === "use_item" || isHealingIntentAction(actionType, body);
}

export type ContextualFirstAidKind = "first_aid" | "status";

export function contextualFirstAidDraft(opts: {
  hp: number;
  maxHp: number;
  effectLabels?: readonly string[];
}): { actionType: "support"; body: string; kind: ContextualFirstAidKind } {
  const labels = (opts.effectLabels ?? []).join(" ");
  if (/중독|독|poison/i.test(labels)) {
    return { actionType: "support", body: CONTEXTUAL_POISON_TREAT_DRAFT, kind: "status" };
  }
  if (/출혈|bleed/i.test(labels)) {
    return { actionType: "support", body: CONTEXTUAL_BLEED_TREAT_DRAFT, kind: "status" };
  }
  if (opts.hp >= opts.maxHp && labels.trim()) {
    return { actionType: "support", body: CONTEXTUAL_POISON_TREAT_DRAFT, kind: "status" };
  }
  return { actionType: "support", body: CONTEXTUAL_FIRST_AID_DRAFT, kind: "first_aid" };
}

export function contextualSafeRestDraft(): { actionType: "free"; body: string } {
  return { actionType: "free", body: CONTEXTUAL_SAFE_REST_DRAFT };
}

export function showContextualFirstAid(opts: {
  hp: number;
  maxHp: number;
  treatableOngoing: boolean;
}): boolean {
  return opts.hp < opts.maxHp || opts.treatableOngoing;
}
