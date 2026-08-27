import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { isSelectionInContainer } from "@/lib/quoteSelectionContainer";

type MockEl = {
  nodeType: 1;
  tagName: string;
  parentElement: MockEl | null;
  childNodes: MockNode[];
  attrs: Record<string, string | true>;
  appendChild(child: MockNode): void;
  contains(node: MockNode): boolean;
  closest(selector: string): MockEl | null;
};

type MockText = {
  nodeType: 3;
  textContent: string;
  parentElement: MockEl | null;
};

type MockNode = MockEl | MockText;

function el(tag: string, attrs: Record<string, string | true> = {}, ...children: MockNode[]): MockEl {
  const node: MockEl = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: null,
    childNodes: [],
    attrs,
    appendChild(child) {
      child.parentElement = node;
      node.childNodes.push(child);
      if (child.nodeType === 1) node.childNodes.push(child);
    },
    contains(target) {
      if (target === node) return true;
      for (const child of node.childNodes) {
        if (child === target) return true;
        if (child.nodeType === 1 && child.contains(target)) return true;
      }
      return false;
    },
    closest(selector) {
      const selectors = selector.split(",").map((part) => part.trim());
      const matchOne = (candidate: MockEl, sel: string): boolean => {
        if (sel === "button") return candidate.tagName === "BUTTON";
        if (sel.startsWith("[") && sel.endsWith("]")) {
          const key = sel.slice(1, -1);
          return key in candidate.attrs;
        }
        return candidate.tagName === sel.toUpperCase();
      };
      let cur: MockEl | null = node;
      while (cur) {
        for (const sel of selectors) {
          if (matchOne(cur, sel)) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    },
  };
  for (const child of children) {
    child.parentElement = node;
    node.childNodes.push(child);
  }
  return node;
}

function text(value: string): MockText {
  return { nodeType: 3, textContent: value, parentElement: null };
}

function range(start: MockText, end: MockText): Range {
  const findCommon = (): MockNode => {
    const startPath: MockNode[] = [];
    const endPath: MockNode[] = [];
    let s: MockNode | null = start;
    let e: MockNode | null = end;
    while (s) {
      startPath.unshift(s);
      s = s.parentElement;
    }
    while (e) {
      endPath.unshift(e);
      e = e.parentElement;
    }
    let common: MockNode = startPath[0]!;
    for (let i = 0; i < Math.min(startPath.length, endPath.length); i++) {
      if (startPath[i] !== endPath[i]) break;
      common = startPath[i]!;
    }
    return common;
  };
  return {
    startContainer: start as unknown as Node,
    endContainer: end as unknown as Node,
    commonAncestorContainer: findCommon() as unknown as Node,
  } as Range;
}

function sceneFixture() {
  const actorAProse = text("Actor A says hello.");
  const actorBProse = text("Actor B replies.");
  const gmProse = text("GM narrates the scene.");
  const labelA = text("Actor A");
  const labelB = text("Actor B");
  const buttonLabel = text("Reroll");

  const sceneRoot = el("div", { "data-quote-assistant": true },
    el("div", { "data-trpg-action-card": true },
      el("div", {},
        el("p", {}, labelA),
        el("div", {}, actorAProse)
      ),
      el("div", {},
        el("p", {}, labelB),
        el("div", {}, actorBProse)
      )
    ),
    el("div", {},
      el("div", {},
        el("span", {}, text("GM:")),
        text(" "),
        gmProse
      )
    ),
    el("div", { "data-quote-ignore": true },
      el("button", {}, buttonLabel)
    )
  );

  const container = el("div", {}, sceneRoot);
  return {
    container: container as unknown as HTMLElement,
    actorAProse,
    actorBProse,
    gmProse,
    labelA,
    buttonLabel,
    sceneRoot,
  };
}

describe("isSelectionInContainer", () => {
  it("accepts single AI prose selection inside one quote root", () => {
    const { container, actorAProse } = sceneFixture();
    assert.equal(isSelectionInContainer(container, range(actorAProse, actorAProse)), true);
  });

  it("accepts AI actor A to AI actor B within the same scene quote root", () => {
    const { container, actorAProse, actorBProse } = sceneFixture();
    assert.equal(isSelectionInContainer(container, range(actorAProse, actorBProse)), true);
  });

  it("accepts AI actor to GM prose within the same scene quote root", () => {
    const { container, actorAProse, gmProse } = sceneFixture();
    assert.equal(isSelectionInContainer(container, range(actorAProse, gmProse)), true);
  });

  it("accepts speaker label to own prose within the same scene quote root", () => {
    const { container, labelA, actorAProse } = sceneFixture();
    assert.equal(isSelectionInContainer(container, range(labelA, actorAProse)), true);
  });

  it("rejects selection crossing into buttons or ignored UI", () => {
    const { container, actorAProse, buttonLabel } = sceneFixture();
    assert.equal(isSelectionInContainer(container, range(actorAProse, buttonLabel)), false);
  });

  it("rejects selections spanning different quote roots", () => {
    const leftProse = text("Left block");
    const rightProse = text("Right block");
    const container = el("div", {},
      el("div", { "data-quote-assistant": true }, el("div", {}, leftProse)),
      el("div", { "data-quote-assistant": true }, el("div", {}, rightProse))
    ) as unknown as HTMLElement;
    assert.equal(isSelectionInContainer(container, range(leftProse, rightProse)), false);
  });
});

describe("trpg quote selection parity (structure)", () => {
  it("uses one SceneTurn quote root and disables inner prose roots", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const named = fs.readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8");
    const chat = fs.readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");

    assert.match(room, /function SceneTurn[\s\S]*data-quote-assistant[\s\S]*quoteSelectStyle/);
    assert.match(room, /quoteAssistantRoot=\{false\}/);
    assert.doesNotMatch(room, /disabled=\{busy \|\| generating\}/);
    assert.match(named, /quoteAssistantRoot = true/);
    assert.match(named, /quoteAssistantRoot \? \{ "data-quote-assistant": true \}/);
    assert.match(chat, /data-quote-assistant/);
  });

  it("marks dice and judge chrome as quote-ignore inside SceneTurn", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /data-quote-ignore[\s\S]*TrpgRollResultLane/);
    assert.match(room, /GM 판정용[\s\S]*data-quote-ignore|data-quote-ignore[\s\S]*GM 판정용/);
    assert.match(room, /data-quote-ignore[\s\S]*장면 \$\{row\.roundNumber\}|장면 \$\{row\.roundNumber\}[\s\S]*data-quote-ignore/);
  });

  it("does not nest competing data-quote-assistant owners in TRPG scene prose path", () => {
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const sceneTurnBlock = room.slice(room.indexOf("function SceneTurn"));
    const assistantCount = (sceneTurnBlock.match(/data-quote-assistant/g) ?? []).length;
    assert.equal(assistantCount, 1);
    assert.doesNotMatch(sceneTurnBlock, /quoteAssistantRoot=\{true\}/);
  });

  it("leaves global chat quote ownership unchanged", () => {
    const toolbar = fs.readFileSync("src/components/ChatSelectionQuoteToolbar.tsx", "utf8");
    const chat = fs.readFileSync("src/app/chat/[id]/ChatClient.tsx", "utf8");
    assert.match(toolbar, /from "@\/lib\/quoteSelectionContainer"/);
    assert.match(chat, /disabled=\{loading \|\| editingId != null\}/);
    assert.doesNotMatch(chat, /quoteAssistantRoot/);
  });
});
