import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as React from "react";
import { compileJsxComponentSource } from "../jsxComponent/compile";
import { clampJsxSandboxHeight, decideJsxHostBridgeAction } from "../jsxComponent/hostBridge";
import { JSX_BRIDGE_MAX_TEXT, JSX_SANDBOX_AUTO_HEIGHT_MAX_PX, JSX_SANDBOX_AUTO_HEIGHT_MIN_PX } from "../jsxComponent/limits";
import { jsxSurfacePolicyError } from "../jsxComponent/surface";
import { contextualStatusTreatDraft } from "./mechanicsIntent";
import { partyDetailedSheetCards } from "./partySheetPresentation";
import { compileTrpgSheetJsx, TRPG_SHEET_JSX_COMPONENT, TRPG_SHEET_JSX_SOURCE } from "./sheetJsxSource";
import { acceptTrpgSheetActionDraft, buildTrpgSheetSurface, pickTrpgSheetRenderer, type TrpgSheetSurface } from "./sheetSurface";
import type { TrpgSheetHudCard } from "./sheetView";
import type { TrpgPublicOngoingEffect } from "./snapshot";
import { TRPG_ACTION_MAX_CHARS, type TrpgStatDefinition } from "./types";

const statDefs: TrpgStatDefinition[] = [
  { key: "str", label: "근력" },
  { key: "dex", label: "민첩" },
];

function card(participantId: number, name: string, isSelf: boolean): TrpgSheetHudCard {
  return {
    participantId,
    isSelf,
    html: `<div>${name}</div>`,
    sheet: {
      participantId,
      name,
      playerName: name,
      level: 2,
      hp: 7,
      maxHp: 20,
      stats: { str: 12, dex: 8 },
      conditions: ["긴장"],
      inventory: ["붕대", "  ", "밧줄"],
      location: "폐역 승강장",
      modifiersNote: "왼팔 부상",
    },
  };
}

const effects: TrpgPublicOngoingEffect[] = [
  { participantId: 1, label: "중독", kind: "periodic_harm", severity: "약", remainingTicks: 2, recoveryHint: "해독" },
  { participantId: 1, label: "출혈", kind: "duration", severity: "중", remainingTicks: 1, recoveryHint: "" },
  { participantId: 2, label: "마비", kind: "control", severity: "약", remainingTicks: -1, recoveryHint: "" },
];
const mechanicsLines = [
  { participantId: 1, text: "근력 판정 14 vs 12 성공" },
  { participantId: 2, text: "민첩 판정 실패" },
];

function surfaceFor(c: TrpgSheetHudCard, interactive: boolean): TrpgSheetSurface {
  return buildTrpgSheetSurface(c, { statDefs, ongoingEffects: effects, mechanicsLines, interactive });
}

type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };

function loadSheet(): (props: Record<string, unknown>) => Element {
  const compiled = compileTrpgSheetJsx();
  assert.ok(compiled, "site sheet compiles through the shared compiler");
  const factory = new Function(
    "React",
    "sendToChat",
    "setChatDraft",
    "useState",
    "useEffect",
    "useMemo",
    "useCallback",
    "useRef",
    "useReducer",
    compiled
  ) as (...args: unknown[]) => (props: Record<string, unknown>) => Element;
  return factory(
    React,
    () => assert.fail("sheet must not call sendToChat"),
    () => assert.fail("sheet must not call setChatDraft"),
    React.useState,
    React.useEffect,
    React.useMemo,
    React.useCallback,
    React.useRef,
    React.useReducer
  );
}

function walk(node: unknown, visit: (el: Element) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const el = node as Element;
  visit(el);
  walk(el.props.children, visit);
}

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return textOf((node as Element).props.children);
}

function find(root: Element, attr: string): Element[] {
  const out: Element[] = [];
  walk(root, (el) => {
    if (attr in el.props) out.push(el);
  });
  return out;
}

function clickables(root: Element): Element[] {
  const out: Element[] = [];
  walk(root, (el) => {
    if (typeof el.props.onClick === "function") out.push(el);
  });
  return out;
}

function withDraftSpy<T>(fn: (calls: [string, string][]) => T): T {
  const g = globalThis as { setTrpgActionDraft?: unknown; fetch?: unknown };
  const prevDraft = g.setTrpgActionDraft;
  const prevFetch = g.fetch;
  const calls: [string, string][] = [];
  g.setTrpgActionDraft = (actionType: string, text: string) => calls.push([actionType, text]);
  g.fetch = () => assert.fail("sheet must not fetch");
  try {
    return fn(calls);
  } finally {
    g.setTrpgActionDraft = prevDraft;
    g.fetch = prevFetch;
  }
}

describe("TRPG sandboxed JSX sheet", () => {
  it("A. SELF renders the site JSX sheet from the structured snapshot", () => {
    const surface = surfaceFor(card(1, "렌", true), true);
    assert.equal(surface.hpPercent, 35);
    assert.equal(surface.hpRisk, "wounded");
    assert.deepEqual(surface.stats, [
      { key: "str", label: "근력", value: 12, modifier: 3 },
      { key: "dex", label: "민첩", value: 8, modifier: 1 },
    ]);
    assert.deepEqual(surface.inventory.map((item) => item.name), ["붕대", "밧줄"]);
    assert.deepEqual(surface.effects.map((effect) => effect.label), ["중독", "출혈"]);
    assert.deepEqual(surface.mechanics, ["근력 판정 14 vs 12 성공"]);

    const tree = loadSheet()(JSON.parse(JSON.stringify(surface)));
    const text = textOf(tree);
    for (const piece of ["렌", "Lv 2", "HP 7/20", "폐역 승강장", "근력 12", "(+3)", "민첩 8", "(+1)", "긴장", "중독 약 · 2회 남음", "붕대", "밧줄", "근력 판정 14 vs 12 성공", "왼팔 부상"]) {
      assert.ok(text.includes(piece), `sheet shows ${piece}`);
    }
    const bar = find(tree, "role").find((el) => el.props.role === "progressbar");
    assert.equal(bar?.props["aria-valuenow"], 7);
    assert.equal(find(tree, "data-trpg-stat").length, 2);
  });

  it("B. props are a copy; rendering and clicks never mutate the sheet", () => {
    const source = card(1, "렌", true);
    const frozen = structuredClone(source);
    const surface = surfaceFor(source, true);
    surface.inventory.length = 0;
    surface.stats[0]!.value = 99;
    assert.deepEqual(source, frozen);
    withDraftSpy(() => {
      const tree = loadSheet()(JSON.parse(JSON.stringify(surfaceFor(source, true))));
      for (const el of clickables(tree)) (el.props.onClick as () => void)();
    });
    assert.deepEqual(source, frozen);
  });

  it("C. inventory click drafts use_item through the TRPG bridge only", () => {
    const surface = surfaceFor(card(1, "렌", true), true);
    withDraftSpy((calls) => {
      const tree = loadSheet()(JSON.parse(JSON.stringify(surface)));
      const bandage = find(tree, "data-trpg-inventory-item").find((el) => el.props["data-trpg-inventory-item"] === "붕대");
      (bandage?.props.onClick as () => void)();
      assert.deepEqual(calls, [["use_item", "붕대를 사용한다."]]);
      assert.deepEqual(acceptTrpgSheetActionDraft({ actionType: calls[0]![0], text: calls[0]![1] }), {
        actionType: "use_item",
        body: "붕대를 사용한다.",
      });
    });
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    const fill = dock.slice(dock.indexOf("function fillAction"), dock.indexOf("const selfSurface"));
    assert.match(fill, /onInputOriginChange\("manual"\)/);
    assert.match(fill, /openTrpgCommandDockMode\(current, "action"/);
    assert.doesNotMatch(fill, /onSendAction/);
    const view = dock.slice(dock.indexOf("function SheetSurfaceView"), dock.indexOf("function ActionMode"));
    assert.match(view, /acceptTrpgSheetActionDraft\(request\)/);
    assert.doesNotMatch(view, /onSendAction|fetch\(/);
  });

  it("D. treatable ongoing effect drafts the existing treatment intent only", () => {
    const surface = surfaceFor(card(1, "렌", true), true);
    withDraftSpy((calls) => {
      const tree = loadSheet()(JSON.parse(JSON.stringify(surface)));
      const buttons = find(tree, "data-trpg-condition-draft");
      assert.deepEqual(buttons.map((el) => el.props["data-trpg-condition-draft"]), ["중독"]);
      (buttons[0]?.props.onClick as () => void)();
      const treat = contextualStatusTreatDraft(["중독"]);
      assert.deepEqual(calls, [[treat.actionType, treat.body]]);
    });
  });

  it("E. non-treatable conditions stay display-only; stat clicks only select a key", () => {
    const surface = surfaceFor(card(1, "렌", true), true);
    const statCalls: string[] = [];
    const g = globalThis as { setTrpgSelectedStat?: unknown };
    const prev = g.setTrpgSelectedStat;
    g.setTrpgSelectedStat = (key: string) => statCalls.push(key);
    try {
      withDraftSpy((calls) => {
        const tree = loadSheet()(JSON.parse(JSON.stringify(surface)));
        const clickable = clickables(tree);
        assert.equal(clickable.length, 5);
        const drafts = clickable.filter(
          (el) => "data-trpg-inventory-item" in el.props || "data-trpg-condition-draft" in el.props
        );
        assert.equal(drafts.length, 3);
        const stats = find(tree, "data-trpg-stat");
        assert.equal(stats.length, 2);
        (stats[0]?.props.onClick as () => void)();
        assert.deepEqual(statCalls, ["str"]);
        assert.equal(calls.length, 0);
      });
    } finally {
      g.setTrpgSelectedStat = prev;
    }
    assert.equal(surface.effects.find((effect) => effect.label === "출혈")?.draft, null);
  });

  it("F. PARTY sheet renders read-only with no draft-capable interaction", () => {
    const party = surfaceFor(card(2, "미라", false), false);
    assert.equal(party.interactive, false);
    assert.ok(party.inventory.every((item) => item.draft === null));
    assert.ok(party.effects.every((effect) => effect.draft === null));
    withDraftSpy((calls) => {
      const tree = loadSheet()(JSON.parse(JSON.stringify(party)));
      assert.equal(clickables(tree).length, 0);
      for (const el of find(tree, "data-trpg-stat")) assert.equal(el.props.onClick, undefined);
      assert.ok(textOf(tree).includes("마비 약 · 회복 판정 가능"));
      const forged = loadSheet()({ ...JSON.parse(JSON.stringify(party)), interactive: false, inventory: [{ key: "x", name: "x", draft: { actionType: "use_item", body: "x" } }] });
      assert.equal(clickables(forged).length, 0);
      assert.equal(calls.length, 0);
    });
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /onTrpgActionDraft=\{onFillAction \? onTrpgActionDraft : null\}/);
    assert.match(dock, /onTrpgSelectedStat=\{onFillAction \? onTrpgSelectedStat : null\}/);
    assert.match(dock, /interactive: false,\n\s+\}\)/);
    assert.match(dock, /onFillAction=\{null\}/);
    assert.doesNotMatch(dock, /ignorePartyDraft/);
  });

  it("G. same-name party members stay participantId-keyed", () => {
    const cards = partyDetailedSheetCards([card(1, "렌", true), card(2, "미라", false), card(3, "미라", false)], 1);
    const surfaces = cards.map((c) => surfaceFor(c, false));
    assert.deepEqual(surfaces.map((s) => s.participantId), [2, 3]);
    assert.notEqual(JSON.stringify(surfaces[0]), JSON.stringify(surfaces[1]));
    assert.deepEqual(surfaces[0]?.mechanics, ["민첩 판정 실패"]);
    assert.deepEqual(surfaces[1]?.mechanics, []);
    const tree = loadSheet()(JSON.parse(JSON.stringify(surfaces[1])));
    assert.equal(tree.props["data-trpg-sheet-jsx"], "3");
  });

  it("H. site sheet passes the shared compiler with no network/storage/navigation", () => {
    const compiled = compileJsxComponentSource(TRPG_SHEET_JSX_SOURCE, TRPG_SHEET_JSX_COMPONENT);
    assert.equal(compiled.ok, true);
    if (compiled.ok) {
      assert.deepEqual(compiled.capabilities, ["trpg_action_draft"]);
      assert.equal(compiled.chatSend, false);
      assert.equal(jsxSurfacePolicyError("trpg_sheet", compiled.capabilities), null);
      assert.notEqual(jsxSurfacePolicyError("chat", compiled.capabilities), null);
    }
    assert.doesNotMatch(TRPG_SHEET_JSX_SOURCE, /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|cookie|href|window\.open|sendToChat|setChatDraft)\b/);
    const frame = readFileSync("public/jsx-sandbox/frame.html", "utf8");
    const sandbox = readFileSync("src/components/JsxComponentSandbox.tsx", "utf8");
    const runtime = readFileSync("src/lib/jsxComponent/sandboxRuntime.ts", "utf8");
    assert.match(frame, /connect-src 'none'/);
    assert.match(sandbox, /sandbox="allow-scripts"/);
    assert.doesNotMatch(sandbox, /allow-same-origin/);
    assert.match(runtime, /window\.fetch = blockedNetwork/);
    assert.equal(readFileSync("src/lib/trpg/sheetJsxSource.ts", "utf8").includes("dangerouslySetInnerHTML"), false);
  });

  it("I. TRPG bridge rejects invalid type, empty, oversized, and burst messages", () => {
    assert.equal(acceptTrpgSheetActionDraft({ actionType: "attack_now", text: "검을 든다." }), null);
    assert.equal(acceptTrpgSheetActionDraft({ actionType: "use_item", text: "  \n " }), null);
    assert.equal(acceptTrpgSheetActionDraft({ actionType: "use_item", text: "가".repeat(TRPG_ACTION_MAX_CHARS + 1) }), null);
    assert.equal(acceptTrpgSheetActionDraft({ actionType: "use_item", text: "가".repeat(TRPG_ACTION_MAX_CHARS) })?.body.length, TRPG_ACTION_MAX_CHARS);
    assert.deepEqual(acceptTrpgSheetActionDraft({ actionType: "support", text: " 붕대를\r\n감는다. " }), {
      actionType: "support",
      body: "붕대를\n감는다.",
    });

    const fresh = { lastAcceptedAt: 0, burst: 0 };
    const ok = decideJsxHostBridgeAction({ kind: "setTrpgActionDraft", actionType: "use_item", text: "붕대를 사용한다.", chatSendEnabled: false, now: 1_000, rate: fresh });
    assert.deepEqual(ok.decision, { action: "setTrpgActionDraft", actionType: "use_item", text: "붕대를 사용한다." });
    const empty = decideJsxHostBridgeAction({ kind: "setTrpgActionDraft", actionType: "use_item", text: "  ", chatSendEnabled: false, now: 1_000, rate: fresh });
    assert.equal(empty.decision.action, "ignore");
    const big = decideJsxHostBridgeAction({ kind: "setTrpgActionDraft", actionType: "use_item", text: "가".repeat(JSX_BRIDGE_MAX_TEXT + 5), chatSendEnabled: false, now: 1_000, rate: fresh });
    assert.equal(big.decision.action, "setTrpgActionDraft");
    if (big.decision.action === "setTrpgActionDraft") {
      assert.equal(acceptTrpgSheetActionDraft(big.decision), null, "oversized is rejected by the TRPG owner, not truncated");
    }
    let rate = fresh;
    let ignored = 0;
    for (let i = 0; i < 30; i++) {
      const next = decideJsxHostBridgeAction({ kind: "setTrpgActionDraft", actionType: "use_item", text: `x${i}`, chatSendEnabled: false, now: 10_000 + i, rate });
      rate = next.rate;
      if (next.decision.action === "ignore") ignored += 1;
    }
    assert.ok(ignored >= 27);

    const sandbox = readFileSync("src/components/JsxComponentSandbox.tsx", "utf8");
    const trpgBranch = sandbox.slice(sandbox.indexOf('data.kind === "setTrpgActionDraft"'), sandbox.indexOf('data.kind !== "setChatDraft"'));
    assert.match(trpgBranch, /if \(!handler\) return;/);
    assert.doesNotMatch(trpgBranch, /bridge\./);
  });

  it("J. general chat setChatDraft/sendToChat semantics are unchanged", () => {
    const fresh = { lastAcceptedAt: 0, burst: 0 };
    const send = decideJsxHostBridgeAction({ kind: "sendToChat", text: "hi", chatSendEnabled: true, now: 1_000, rate: fresh });
    assert.deepEqual(send.decision, { action: "requestChatSend", text: "hi" });
    const ungestured = decideJsxHostBridgeAction({ kind: "sendToChat", text: "hi", chatSendEnabled: false, now: 1_000, rate: fresh });
    assert.deepEqual(ungestured.decision, { action: "setChatDraft", text: "hi" });
    const clipped = decideJsxHostBridgeAction({ kind: "setChatDraft", text: "가".repeat(JSX_BRIDGE_MAX_TEXT + 40), chatSendEnabled: true, now: 1_000, rate: fresh });
    assert.equal(clipped.decision.action === "setChatDraft" && clipped.decision.text.length, JSX_BRIDGE_MAX_TEXT);
    const unknown = decideJsxHostBridgeAction({ kind: "submitTrpgAction", text: "x", chatSendEnabled: true, now: 1_000, rate: fresh });
    assert.deepEqual(unknown.decision, { action: "ignore", reason: "unknown_kind" });

    const runtime = readFileSync("src/lib/jsxComponent/sandboxRuntime.ts", "utf8");
    const factory = runtime.slice(runtime.indexOf("new Function("), runtime.indexOf("compiled\n"));
    assert.doesNotMatch(factory, /setTrpgActionDraft/, "TRPG intent is a window global, not a factory parameter");
    assert.match(runtime, /runtimeWindow\.setTrpgActionDraft = setTrpgActionDraft/);
    assert.match(runtime, /runtimeWindow\.setTrpgSelectedStat = setTrpgSelectedStat/);
    assert.doesNotMatch(factory, /setTrpgSelectedStat/);
    const sandbox = readFileSync("src/components/JsxComponentSandbox.tsx", "utf8");
    assert.match(sandbox, /bridge\.setChatDraft\(decision\.text\)/);
    assert.match(sandbox, /bridge\.requestChatSend\(decision\.text\)/);
    for (const caller of ["src/components/ChatRichBlocks.tsx", "src/components/StatusWidgetCard.tsx"]) {
      assert.doesNotMatch(readFileSync(caller, "utf8"), /onTrpgActionDraft|onTrpgSelectedStat|autoHeight/);
    }
  });

  it("K. no provider call or /action fetch from the sheet path", () => {
    for (const file of ["src/lib/trpg/sheetSurface.ts", "src/lib/trpg/sheetJsxSource.ts", "src/components/JsxComponentSandbox.tsx", "src/app/trpg/TrpgCommandDock.tsx"]) {
      const src = readFileSync(file, "utf8");
      assert.doesNotMatch(src, /fetch\(|\/action[`'"]|openrouter|callLlm|provider/i, file);
    }
  });

  it("L. compile/runtime/boot failure falls back to the native renderer", () => {
    const site = (compiled: string | null) => [{ source: "site" as const, compiled }];
    assert.deepEqual(pickTrpgSheetRenderer(site(null), new Set()), { kind: "native" });
    assert.deepEqual(pickTrpgSheetRenderer(site("c1"), new Set()), { kind: "jsx", source: "site", compiled: "c1" });
    assert.deepEqual(pickTrpgSheetRenderer(site("c1"), new Set(["c1"])), { kind: "native" });
    assert.deepEqual(pickTrpgSheetRenderer(site("c2"), new Set(["c1"])), { kind: "jsx", source: "site", compiled: "c2" });
    assert.equal(compileJsxComponentSource("function TrpgSheet() { return fetch('/x'); }", "TrpgSheet").ok, false);

    const runtime = readFileSync("src/lib/jsxComponent/sandboxRuntime.ts", "utf8");
    assert.match(runtime, /createRoot\(mountEl, \{ onUncaughtError: reportRenderError \}\)/);
    const sandbox = readFileSync("src/components/JsxComponentSandbox.tsx", "utf8");
    assert.match(sandbox, /JSX_SANDBOX_BOOT_TIMEOUT_MS/);
    assert.match(sandbox, /if \(!readyRef\.current\) statusRef\.current\?\.\("error"\)/);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /if \(status === "error" && compiled\) onJsxFailed\(compiled\)/);
    assert.match(dock, /case "native":\n\s+return \(\n\s+<NativeSheetBody/);
    const malformed = loadSheet()({ stats: "bad", inventory: null, effects: 3, hp: "x" });
    assert.ok(textOf(malformed).includes("HP 0/0"));
  });

  it("M. polling with an unchanged sheet keeps props identity and the mounted component", () => {
    const a = JSON.stringify(surfaceFor(card(1, "렌", true), true));
    const b = JSON.stringify(surfaceFor(card(1, "렌", true), true));
    assert.equal(a, b);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /const propsKey = JSON\.stringify\(surface\);/);
    assert.match(dock, /useMemo\(\(\) => JSON\.parse\(propsKey\) as Record<string, unknown>, \[propsKey\]\)/);
    const sandbox = readFileSync("src/components/JsxComponentSandbox.tsx", "utf8");
    assert.match(sandbox, /\}, \[compiled, props\]\);/);
    const runtime = readFileSync("src/lib/jsxComponent/sandboxRuntime.ts", "utf8");
    assert.match(runtime, /if \(!currentComponent \|\| currentCompiled !== compiled\)/);
  });

  it("N. sandbox height is child-reported, host-clamped, and dock occlusion stays the single owner", () => {
    assert.equal(clampJsxSandboxHeight(Number.NaN), null);
    assert.equal(clampJsxSandboxHeight("400"), null);
    assert.equal(clampJsxSandboxHeight(10), JSX_SANDBOX_AUTO_HEIGHT_MIN_PX);
    assert.equal(clampJsxSandboxHeight(99_999), JSX_SANDBOX_AUTO_HEIGHT_MAX_PX);
    assert.equal(clampJsxSandboxHeight(321.2), 322);
    const sandbox = readFileSync("src/components/JsxComponentSandbox.tsx", "utf8");
    assert.match(sandbox, /if \(!autoHeight\) return;/);
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    assert.match(dock, /max-h-\[min\(42dvh,24rem\)\] overflow-y-auto/);
    assert.match(dock, /onOcclusionChange\(trpgCommandDockOcclusion\(el\.offsetHeight, keyboardInset\)\)/);
    assert.doesNotMatch(dock, /\bmb-\[|\bpb-\[\d|margin-bottom/);
  });
});
