/**
 * TRPG inventory domain. The canonical state is always a flat unit list
 * (`string[]`, one entry per unit). Stacks and `이름 ×N` text are views of it.
 */

export const TRPG_INVENTORY_ITEM_NAME_LIMIT = 40;
export const TRPG_START_INVENTORY_MAX_UNITS = 12;

export type TrpgInventoryStack = { name: string; quantity: number };

/**
 * One stack per trimmed exact name (same identity mechanics consume uses),
 * first-occurrence order. quantity = unit occurrences.
 */
export function stackInventory(inventory: readonly string[]): TrpgInventoryStack[] {
  const stacks = new Map<string, TrpgInventoryStack>();
  for (const raw of inventory) {
    const name = raw.trim();
    if (!name) continue;
    const stack = stacks.get(name);
    if (stack) stack.quantity += 1;
    else stacks.set(name, { name, quantity: 1 });
  }
  return [...stacks.values()];
}

/** `이름 ×N` (N > 1) — shared by sheet display and creator authoring text. */
export function inventoryStackLabel(stack: TrpgInventoryStack): string {
  return stack.quantity > 1 ? `${stack.name} ×${stack.quantity}` : stack.name;
}

export function formatInventoryAuthoringText(units: readonly string[]): string {
  return stackInventory(units).map(inventoryStackLabel).join(", ");
}

export type InventoryAuthoringParse = { ok: true; units: string[] } | { ok: false; error: string };

const NUMERIC_SUFFIX = /^(.*?)\s*×\s*(-?\d+)$/;
const SPACED_SUFFIX = /\s×(\S*)$/;

/**
 * Creator text → canonical unit list. Comma separates stacks; the only
 * quantity syntax is a trailing `×N` (positive integer). A `×` that is not a
 * quantity suffix (e.g. `3× 확대경`) stays part of the name. A suffix that looks
 * like a quantity but is not a positive integer is an error, never a literal.
 */
export function parseInventoryAuthoringText(text: string): InventoryAuthoringParse {
  const units: string[] = [];
  for (const segment of text.split(",")) {
    const entry = segment.trim();
    if (!entry) continue;
    let name = entry;
    let quantity = 1;
    const numeric = NUMERIC_SUFFIX.exec(entry);
    if (numeric) {
      name = numeric[1]!.trim();
      quantity = Number(numeric[2]);
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        return { ok: false, error: `시작 소지품 "${entry}"의 수량은 1 이상의 정수로 적어 주세요. (예: 붕대 ×3)` };
      }
    } else if (SPACED_SUFFIX.test(entry)) {
      return { ok: false, error: `시작 소지품 "${entry}"의 수량은 1 이상의 정수로 적어 주세요. (예: 붕대 ×3)` };
    }
    if (!name) {
      return { ok: false, error: `시작 소지품 "${entry}"에 아이템 이름이 없습니다.` };
    }
    if (name.length > TRPG_INVENTORY_ITEM_NAME_LIMIT) {
      return { ok: false, error: `시작 소지품 이름은 ${TRPG_INVENTORY_ITEM_NAME_LIMIT}자까지 입력할 수 있습니다.` };
    }
    if (units.length + quantity > TRPG_START_INVENTORY_MAX_UNITS) {
      return { ok: false, error: `시작 소지품은 총 ${TRPG_START_INVENTORY_MAX_UNITS}개까지 설정할 수 있습니다.` };
    }
    for (let i = 0; i < quantity; i++) units.push(name);
  }
  return { ok: true, units };
}
