/**
 * TRPG inventory domain.
 *
 * Runtime canonical state is a structured entry list (one exact-name stack).
 * Scenario authoring stays a flat unit list (`string[]`) plus `이름 ×N` text.
 */

export const TRPG_INVENTORY_ITEM_NAME_LIMIT = 40;
export const TRPG_START_INVENTORY_MAX_UNITS = 12;

export type TrpgInventoryStack = { name: string; quantity: number };

export type TrpgInventoryEntry = {
  id: string;
  name: string;
  quantity: number;
  equipped: boolean;
};

export type InventoryRemoveResult =
  | { ok: true; next: TrpgInventoryEntry[] }
  | { ok: false; next: TrpgInventoryEntry[] };

function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** One ID owner. V1 is one stack per exact name, so the id is derived from that name. */
export function createInventoryEntryId(name: string): string {
  return `inv_${fnv1a32Hex(name)}`;
}

/** Single read-normalization owner. Missing / non-true values are unequipped. */
export function isInventoryEntryEquipped(entry: { equipped?: unknown }): boolean {
  return entry.equipped === true;
}

export function cloneInventory(inventory: readonly TrpgInventoryEntry[]): TrpgInventoryEntry[] {
  return inventory.map((entry) => ({
    id: entry.id,
    name: entry.name,
    quantity: entry.quantity,
    equipped: isInventoryEntryEquipped(entry),
  }));
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isInventoryEntryLike(value: unknown): value is { id?: unknown; name: unknown; quantity: unknown } {
  if (!value || typeof value !== "object") return false;
  const row = value as { name?: unknown; quantity?: unknown };
  return typeof row.name === "string" && isPositiveInt(row.quantity);
}

function mergeExactNameStacks(
  rows: readonly { id?: unknown; name: unknown; quantity: unknown; equipped?: unknown }[]
): TrpgInventoryEntry[] {
  const entries: TrpgInventoryEntry[] = [];
  const byName = new Map<string, TrpgInventoryEntry>();
  for (const row of rows) {
    const name = String(row.name).trim();
    if (!name || !isPositiveInt(row.quantity)) continue;
    const existing = byName.get(name);
    if (existing) {
      existing.quantity += row.quantity;
      continue;
    }
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : createInventoryEntryId(name);
    const entry = {
      id,
      name,
      quantity: row.quantity,
      equipped: isInventoryEntryEquipped(row),
    };
    byName.set(name, entry);
    entries.push(entry);
  }
  return entries;
}

/**
 * Start units → runtime entries. One exact-name stack; first-occurrence order.
 */
export function inventoryFromUnits(units: readonly string[]): TrpgInventoryEntry[] {
  const entries: TrpgInventoryEntry[] = [];
  const byName = new Map<string, TrpgInventoryEntry>();
  for (const raw of units) {
    const name = raw.trim();
    if (!name) continue;
    const existing = byName.get(name);
    if (existing) {
      existing.quantity += 1;
      continue;
    }
    const entry = { id: createInventoryEntryId(name), name, quantity: 1, equipped: false };
    byName.set(name, entry);
    entries.push(entry);
  }
  return entries;
}

/**
 * Single read-boundary parser. Accepts structured entries or legacy unit `string[]`.
 * Writers persist structured form only.
 */
export function parseStoredInventory(raw: unknown): TrpgInventoryEntry[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  if (value.length === 0) return [];
  if (value.every(isInventoryEntryLike)) return mergeExactNameStacks(value);
  if (value.every((item) => typeof item === "string")) return inventoryFromUnits(value);
  return [];
}

export function serializeInventory(inventory: readonly TrpgInventoryEntry[]): string {
  return JSON.stringify(cloneInventory(inventory));
}

export function inventoryItemNames(inventory: readonly TrpgInventoryEntry[]): string[] {
  return inventory.map((entry) => entry.name);
}

export function inventoryUnits(inventory: readonly TrpgInventoryEntry[]): string[] {
  const units: string[] = [];
  for (const entry of inventory) {
    for (let i = 0; i < entry.quantity; i += 1) units.push(entry.name);
  }
  return units;
}

export function inventoryUnitCount(inventory: readonly TrpgInventoryEntry[]): number {
  return inventory.reduce((sum, entry) => sum + entry.quantity, 0);
}

export function inventoryHasName(inventory: readonly TrpgInventoryEntry[], name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && inventory.some((entry) => entry.name === trimmed);
}

export function inventoryQuantity(inventory: readonly TrpgInventoryEntry[], name: string): number {
  const trimmed = name.trim();
  if (!trimmed) return 0;
  return inventory.find((entry) => entry.name === trimmed)?.quantity ?? 0;
}

export function findInventoryEntry(
  inventory: readonly TrpgInventoryEntry[],
  name: string
): TrpgInventoryEntry | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  return inventory.find((entry) => entry.name === trimmed);
}

export function findInventoryEntryById(
  inventory: readonly TrpgInventoryEntry[],
  entryId: string
): TrpgInventoryEntry | undefined {
  const id = entryId.trim();
  if (!id) return undefined;
  return inventory.find((entry) => entry.id === id);
}

export type InventoryEquipResult =
  | { ok: true; next: TrpgInventoryEntry[] }
  | { ok: false; next: TrpgInventoryEntry[] };

/**
 * SET equipped on one exact-name stack. Not a toggle — replay of the same
 * boolean leaves the stack in that state.
 */
export function setInventoryEquipped(
  inventory: readonly TrpgInventoryEntry[],
  entryId: string,
  equipped: boolean
): InventoryEquipResult {
  const next = cloneInventory(inventory);
  const existing = findInventoryEntryById(next, entryId);
  if (!existing) return { ok: false, next };
  existing.equipped = isInventoryEntryEquipped({ equipped });
  return { ok: true, next };
}

export function addInventoryItem(inventory: readonly TrpgInventoryEntry[], name: string): TrpgInventoryEntry[] {
  const trimmed = name.trim();
  if (!trimmed) return cloneInventory(inventory);
  const next = cloneInventory(inventory);
  const existing = next.find((entry) => entry.name === trimmed);
  if (existing) {
    existing.quantity += 1;
    return next;
  }
  next.push({ id: createInventoryEntryId(trimmed), name: trimmed, quantity: 1, equipped: false });
  return next;
}

export function removeInventoryItem(inventory: readonly TrpgInventoryEntry[], name: string): InventoryRemoveResult {
  const trimmed = name.trim();
  const next = cloneInventory(inventory);
  if (!trimmed) return { ok: false, next };
  const index = next.findIndex((entry) => entry.name === trimmed);
  if (index < 0) return { ok: false, next };
  const existing = next[index]!;
  if (existing.quantity > 1) {
    existing.quantity -= 1;
    return { ok: true, next };
  }
  next.splice(index, 1);
  return { ok: true, next };
}

export function consumeInventoryItem(inventory: readonly TrpgInventoryEntry[], name: string): InventoryRemoveResult {
  return removeInventoryItem(inventory, name);
}

/**
 * One stack per trimmed exact name (same identity mechanics consume uses),
 * first-occurrence order. quantity = unit occurrences.
 */
export function stackInventory(inventory: readonly string[]): TrpgInventoryStack[] {
  return inventoryFromUnits(inventory).map(({ name, quantity }) => ({ name, quantity }));
}

/** `이름 ×N` (N > 1) — shared by sheet display and creator authoring text. */
export function inventoryStackLabel(stack: Pick<TrpgInventoryStack, "name" | "quantity">): string {
  return stack.quantity > 1 ? `${stack.name} ×${stack.quantity}` : stack.name;
}

export function formatInventoryAuthoringText(units: readonly string[]): string {
  return stackInventory(units).map(inventoryStackLabel).join(", ");
}

export type InventoryAuthoringParse = { ok: true; units: string[] } | { ok: false; error: string };

const NUMERIC_SUFFIX = /^(.*?)\s*×\s*(-?\d+)$/;
const QUANTITY_LIKE_SUFFIX = /×\s*\S*$/;
const PLAIN_MULTIPLICATION = /^(?:\d+\s*×\s+\S.*|.*\s×\s.*)$/;

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
    } else if (QUANTITY_LIKE_SUFFIX.test(entry) && !PLAIN_MULTIPLICATION.test(entry)) {
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
