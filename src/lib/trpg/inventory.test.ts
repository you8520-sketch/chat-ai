import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  TRPG_INVENTORY_ITEM_NAME_LIMIT,
  TRPG_START_INVENTORY_MAX_UNITS,
  addInventoryItem,
  consumeInventoryItem,
  createInventoryEntryId,
  formatInventoryAuthoringText,
  inventoryFromUnits,
  inventoryHasName,
  inventoryQuantity,
  inventoryUnitCount,
  inventoryUnits,
  isInventoryEntryEquipped,
  parseInventoryAuthoringText,
  parseStoredInventory,
  removeInventoryItem,
  serializeInventory,
  setInventoryEquipped,
  stackInventory,
} from "./inventory";
import { scenarioEditorSavePayload } from "./scenarioEditorState";
import { emptyTrpgScenarioPlan } from "./scenarioPlan";
import { evaluateScenarioReadiness } from "./scenarioReadiness";
import { parseInventory } from "./scenarioTypes";
import { DEFAULT_TRPG_STAT_KEYS } from "./stats";

function units(text: string): string[] {
  const parsed = parseInventoryAuthoringText(text);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  return parsed.ok ? parsed.units : [];
}

function rejected(text: string): string {
  const parsed = parseInventoryAuthoringText(text);
  assert.equal(parsed.ok, false, `${text} must be rejected`);
  return parsed.ok ? "" : parsed.error;
}

function readiness(inventoryText: string) {
  return evaluateScenarioReadiness({
    title: "폐역",
    content: "",
    scenarioPlan: { ...emptyTrpgScenarioPlan(), startingSituation: "역에 도착한다", goal: "탈출한다" },
    inventoryText,
  });
}

function snapshot(inventoryText: string) {
  return {
    title: "폐역",
    summary: "",
    content: "",
    secretContent: "",
    worldId: "" as const,
    visibility: "private" as const,
    startLocation: "",
    inventoryText,
    statKeys: [...DEFAULT_TRPG_STAT_KEYS],
    npcs: [],
    genres: [],
    assets: [],
    plan: emptyTrpgScenarioPlan(),
    characterIds: [],
  };
}

describe("TRPG start-inventory authoring text ⇄ canonical unit list", () => {
  it("A. `붕대 ×3, 해독제` expands to four canonical units", () => {
    assert.deepEqual(units("붕대 ×3, 해독제"), ["붕대", "붕대", "붕대", "해독제"]);
    assert.deepEqual(units("  붕대 ×3 ,, 해독제 , "), ["붕대", "붕대", "붕대", "해독제"]);
    assert.deepEqual(units(""), []);
  });

  it("B. canonical units format to compact first-occurrence text", () => {
    assert.equal(formatInventoryAuthoringText(["붕대", "붕대", "해독제", "붕대"]), "붕대 ×3, 해독제");
    assert.equal(formatInventoryAuthoringText([]), "");
  });

  it("C. parse(format(units)) keeps unit semantics (multiset, stack order)", () => {
    const raw = ["해독제", "붕대", "붕대", "낡은 지도", "해독제", "붕대"];
    const round = units(formatInventoryAuthoringText(raw));
    assert.deepEqual(round, ["해독제", "해독제", "붕대", "붕대", "붕대", "낡은 지도"]);
    assert.deepEqual(stackInventory(round), stackInventory(raw));
    assert.equal(formatInventoryAuthoringText(round), formatInventoryAuthoringText(raw));
  });

  it("D/E. similar names and case stay separate items", () => {
    assert.deepEqual(stackInventory(units("붕대, 고급 붕대, 붕대")), [
      { name: "붕대", quantity: 2 },
      { name: "고급 붕대", quantity: 1 },
    ]);
    assert.deepEqual(units("Rope, rope"), ["Rope", "rope"]);
    assert.equal(formatInventoryAuthoringText(["Rope", "rope"]), "Rope, rope");
  });

  it("F. quantity 1 formats cleanly and `×1` input is accepted as one unit", () => {
    assert.equal(formatInventoryAuthoringText(["붕대"]), "붕대");
    assert.deepEqual(units("붕대 ×1"), ["붕대"]);
    assert.equal(formatInventoryAuthoringText(units("붕대 ×1")), "붕대");
  });

  it("G/H. zero, negative, and malformed quantity suffixes are errors, never literal items", () => {
    for (const text of ["붕대 ×0", "붕대 ×-2", "붕대 ×abc", "붕대 ×", "붕대 ×2.5", "붕대×0", "붕대×abc", "붕대×2.5", "붕대×", "붕대 × 0", "×3"]) {
      rejected(text);
    }
    assert.match(rejected("붕대 ×0"), /1 이상의 정수/);
    assert.deepEqual(units("3× 확대경"), ["3× 확대경"]);
    assert.deepEqual(units("A × B"), ["A × B"]);
    assert.deepEqual(units("붕대×2"), ["붕대", "붕대"]);
    for (const alias of ["붕대 x3", "붕대 X3", "붕대 *3", "붕대 (3)", "붕대 [3]"]) {
      assert.deepEqual(units(alias), [alias], `${alias} is not a quantity alias`);
    }
  });

  it("I/J. total units up to the canonical limit pass; one more is rejected before save", () => {
    assert.equal(TRPG_START_INVENTORY_MAX_UNITS, 12);
    assert.equal(units(`붕대 ×${TRPG_START_INVENTORY_MAX_UNITS}`).length, TRPG_START_INVENTORY_MAX_UNITS);
    assert.equal(units("붕대 ×10, 해독제, 지도").length, TRPG_START_INVENTORY_MAX_UNITS);
    assert.equal(rejected("붕대 ×20"), "시작 소지품은 총 12개까지 설정할 수 있습니다.");
    rejected("붕대 ×10, 해독제, 지도, 열쇠");
    rejected("붕대 ×999999999999999999999");
    const sanitized = parseInventory(Array.from({ length: 20 }, () => "붕대"));
    assert.equal(sanitized.length, TRPG_START_INVENTORY_MAX_UNITS, "server sanitizer stays defense in depth");

    const over = readiness("붕대 ×13");
    assert.equal(over.canSave, false);
    assert.equal(over.canPlay, false);
    assert.deepEqual(over.blockers.map((b) => [b.id, b.field, b.message]), [
      ["inventory_invalid", "inventory", "시작 소지품은 총 12개까지 설정할 수 있습니다."],
    ]);
    assert.equal(readiness("붕대 ×0").canSave, false);
    assert.equal(readiness("붕대 ×12").canSave, true);
    assert.throws(() => scenarioEditorSavePayload(snapshot("붕대 ×13")), /총 12개/);
  });

  it("item name length uses the server canonical limit", () => {
    const max = "가".repeat(TRPG_INVENTORY_ITEM_NAME_LIMIT);
    assert.deepEqual(units(`${max} ×2`), [max, max]);
    assert.deepEqual(parseInventory([max]), [max]);
    assert.match(rejected(`${max}나`), new RegExp(`${TRPG_INVENTORY_ITEM_NAME_LIMIT}자까지`));
  });

  it("K. AI draft duplicate array is shown as compact text through the shared formatter", () => {
    assert.equal(formatInventoryAuthoringText(["붕대", "붕대", "랜턴"]), "붕대 ×2, 랜턴");
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /\? formatInventoryAuthoringText\(data\.draft\.startInventory\)/);
    const draft = readFileSync("src/lib/trpg/scenarioDraft.ts", "utf8");
    assert.doesNotMatch(draft, /×/, "AI prompt/schema carries no quantity syntax");
  });

  it("L. saved duplicate raw units reload as compact editor text", () => {
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    assert.match(editor, /useState\(\(\) => formatInventoryAuthoringText\(initial\?\.startInventory \?\? \[\]\)\)/);
    assert.equal(formatInventoryAuthoringText(["붕대", "붕대", "해독제"]), "붕대 ×2, 해독제");
  });

  it("M. save payload sends the raw duplicate unit array", () => {
    assert.deepEqual(scenarioEditorSavePayload(snapshot("붕대 ×3, 해독제")).startInventory, ["붕대", "붕대", "붕대", "해독제"]);
  });

  it("editor has one inventory text owner: no comma split/join; invalid text never reaches the AI draft", () => {
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    const state = readFileSync("src/lib/trpg/scenarioEditorState.ts", "utf8");
    for (const src of [editor, state]) {
      assert.doesNotMatch(src, /inventoryText\s*\.split|startInventory[^\n]*\.join\(/);
    }
    assert.match(editor, /evaluateScenarioReadiness\(\{[\s\S]*?inventoryText,/);
    const request = editor.slice(editor.indexOf("async function requestDraft"), editor.indexOf("async function persist"));
    assert.ok(request.indexOf("if (!inventory.ok)") < request.indexOf("fetch("));
    assert.match(request, /existingDraft: existingDraft\(inventory\.units\)/);
    assert.match(editor, /data-scenario-field="inventory"/);
    const hud = readFileSync("src/lib/trpg/sheetHud.ts", "utf8");
    assert.doesNotMatch(hud, /stackInventory|inventoryStackLabel/, "stack owner lives in inventory.ts only");
  });
});

describe("TRPG structured runtime inventory", () => {
  const UNITS = ["붕대", "붕대", "붕대", "해독제"];

  it("A. start units collapse to one exact-name stack each", () => {
    const entries = inventoryFromUnits(UNITS);
    assert.deepEqual(
      entries.map(({ name, quantity }) => ({ name, quantity })),
      [
        { name: "붕대", quantity: 3 },
        { name: "해독제", quantity: 1 },
      ]
    );
    assert.deepEqual(inventoryUnits(entries), ["붕대", "붕대", "붕대", "해독제"]);
    assert.equal(inventoryUnitCount(entries), 4);
  });

  it("B/C. ids are stable across parse, serialize, and reload", () => {
    const first = inventoryFromUnits(UNITS);
    const bandageId = createInventoryEntryId("붕대");
    assert.equal(first[0]?.id, bandageId);
    const stored = serializeInventory(first);
    const reloaded = parseStoredInventory(stored);
    assert.deepEqual(reloaded, first);
    assert.equal(parseStoredInventory(stored)[0]?.id, bandageId);
  });

  it("D. adding an existing name increments quantity and keeps id", () => {
    const start = inventoryFromUnits(UNITS);
    const next = addInventoryItem(start, "붕대");
    assert.equal(next[0]?.id, start[0]?.id);
    assert.equal(inventoryQuantity(next, "붕대"), 4);
    assert.equal(inventoryUnitCount(next), 5);
  });

  it("E. adding a new name creates quantity 1 with a new id", () => {
    const start = inventoryFromUnits(UNITS);
    const next = addInventoryItem(start, "열쇠");
    const key = next.find((entry) => entry.name === "열쇠");
    assert.ok(key);
    assert.equal(key.quantity, 1);
    assert.equal(key.id, createInventoryEntryId("열쇠"));
    assert.notEqual(key.id, start[0]?.id);
  });

  it("F/G. remove decrements and deletes the last unit", () => {
    const start = inventoryFromUnits(["붕대", "붕대"]);
    const down = removeInventoryItem(start, "붕대");
    assert.equal(down.ok, true);
    assert.equal(down.next[0]?.id, start[0]?.id);
    assert.equal(inventoryQuantity(down.next, "붕대"), 1);
    const gone = removeInventoryItem(down.next, "붕대");
    assert.equal(gone.ok, true);
    assert.deepEqual(gone.next, []);
  });

  it("H. removing a missing name or a display label is invalid and leaves state", () => {
    const start = inventoryFromUnits(["붕대", "붕대"]);
    const missing = removeInventoryItem(start, "열쇠");
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.next, start);
    const label = removeInventoryItem(start, "붕대 ×2");
    assert.equal(label.ok, false);
    assert.deepEqual(label.next, start);
    assert.equal(inventoryHasName(start, "붕대"), true);
    assert.equal(inventoryHasName(start, "붕대 ×2"), false);
  });

  it("legacy string[] rows normalize only at the read boundary", () => {
    const legacy = JSON.stringify(UNITS);
    const parsed = parseStoredInventory(legacy);
    assert.deepEqual(
      parsed.map(({ name, quantity }) => ({ name, quantity })),
      [
        { name: "붕대", quantity: 3 },
        { name: "해독제", quantity: 1 },
      ]
    );
    assert.equal(parsed[0]?.id, createInventoryEntryId("붕대"));
    assert.equal(serializeInventory(parsed).includes('"quantity":3'), true);
    assert.equal(serializeInventory(parsed).includes("붕대"), true);
    assert.doesNotMatch(serializeInventory(parsed), /"붕대","붕대"/);
  });

  it("consume is the same one-unit remove as GM remove", () => {
    const start = inventoryFromUnits(["붕대", "붕대", "붕대"]);
    const consumed = consumeInventoryItem(start, "붕대");
    assert.equal(consumed.ok, true);
    assert.equal(inventoryQuantity(consumed.next, "붕대"), 2);
    assert.equal(consumed.next[0]?.id, start[0]?.id);
  });

  it("runtime merge/surface no longer own unit-list mutation or grouping", () => {
    const merge = readFileSync("src/lib/trpg/mechanicsMerge.ts", "utf8");
    const view = readFileSync("src/lib/trpg/sheetView.ts", "utf8");
    const surface = readFileSync("src/lib/trpg/sheetSurface.ts", "utf8");
    const hud = readFileSync("src/lib/trpg/sheetHud.ts", "utf8");
    assert.match(merge, /addInventoryItem|removeInventoryItem|consumeInventoryItem/);
    assert.doesNotMatch(merge, /inventory\.push|inventory\.indexOf|inventory\.splice/);
    assert.doesNotMatch(view, /inventory\.push|inventory\.indexOf|inventory\.splice/);
    assert.doesNotMatch(surface, /stackInventory/);
    assert.match(hud, /inventoryUnitCount/);
  });
});

describe("TRPG inventory equipped V1", () => {
  const SWORD = "검";

  it("A. legacy string[] normalizes to equipped=false", () => {
    const parsed = parseStoredInventory(JSON.stringify([SWORD, SWORD]));
    assert.equal(parsed[0]?.equipped, false);
    assert.equal(isInventoryEntryEquipped(parsed[0]!), false);
  });

  it("B. old structured {id,name,quantity} normalizes to equipped=false", () => {
    const parsed = parseStoredInventory(
      JSON.stringify([{ id: createInventoryEntryId(SWORD), name: SWORD, quantity: 2 }])
    );
    assert.equal(parsed[0]?.equipped, false);
    assert.equal(parsed[0]?.quantity, 2);
  });

  it("C/D. structured true/false persist and reload unchanged", () => {
    const on = inventoryFromUnits([SWORD, SWORD]);
    const armed = setInventoryEquipped(on, on[0]!.id, true);
    assert.equal(armed.ok, true);
    const storedTrue = serializeInventory(armed.next);
    assert.equal(parseStoredInventory(storedTrue)[0]?.equipped, true);
    assert.match(storedTrue, /"equipped":true/);
    const off = setInventoryEquipped(armed.next, on[0]!.id, false);
    const storedFalse = serializeInventory(off.next);
    assert.equal(parseStoredInventory(storedFalse)[0]?.equipped, false);
    assert.match(storedFalse, /"equipped":false/);
  });

  it("E/F/Y. SET true/false is idempotent and not a toggle", () => {
    const start = inventoryFromUnits([SWORD]);
    const id = start[0]!.id;
    const first = setInventoryEquipped(start, id, true);
    const again = setInventoryEquipped(first.next, id, true);
    assert.equal(first.next[0]?.equipped, true);
    assert.equal(again.next[0]?.equipped, true);
    const off = setInventoryEquipped(again.next, id, false);
    const offAgain = setInventoryEquipped(off.next, id, false);
    assert.equal(off.next[0]?.equipped, false);
    assert.equal(offAgain.next[0]?.equipped, false);
    const src = readFileSync("src/lib/trpg/inventory.ts", "utf8");
    assert.match(src, /export function setInventoryEquipped/);
    assert.doesNotMatch(src, /export function toggleInventory/);
  });

  it("G. unknown entry id is rejected and leaves state", () => {
    const start = inventoryFromUnits([SWORD]);
    const miss = setInventoryEquipped(start, "inv_missing", true);
    assert.equal(miss.ok, false);
    assert.deepEqual(miss.next, start);
  });

  it("K. equipped stack + add preserves true and id", () => {
    const start = setInventoryEquipped(inventoryFromUnits([SWORD, SWORD, SWORD]), createInventoryEntryId(SWORD), true);
    const next = addInventoryItem(start.next, SWORD);
    assert.equal(next[0]?.id, start.next[0]?.id);
    assert.equal(next[0]?.quantity, 4);
    assert.equal(next[0]?.equipped, true);
  });

  it("L/M. equipped stack + remove/consume qty>1 preserves true", () => {
    const start = setInventoryEquipped(inventoryFromUnits([SWORD, SWORD, SWORD]), createInventoryEntryId(SWORD), true);
    const removed = removeInventoryItem(start.next, SWORD);
    const consumed = consumeInventoryItem(start.next, SWORD);
    assert.equal(removed.ok, true);
    assert.equal(consumed.ok, true);
    assert.equal(removed.next[0]?.equipped, true);
    assert.equal(consumed.next[0]?.equipped, true);
    assert.equal(removed.next[0]?.quantity, 2);
  });

  it("N/O. last unit removal deletes equipped state; re-add defaults false", () => {
    const start = setInventoryEquipped(inventoryFromUnits([SWORD]), createInventoryEntryId(SWORD), true);
    const gone = removeInventoryItem(start.next, SWORD);
    assert.equal(gone.ok, true);
    assert.deepEqual(gone.next, []);
    const again = addInventoryItem(gone.next, SWORD);
    assert.equal(again[0]?.equipped, false);
    assert.equal(again[0]?.id, createInventoryEntryId(SWORD));
  });
});
