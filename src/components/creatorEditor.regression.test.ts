import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as React from "react";
import type { ReactElement, ReactNode } from "react";

import {
  AI_LEARNING_LIMIT,
  AI_LEARNING_MIN,
  GREETING_LIMIT,
  SPEECH_CONTEXTUAL_LIMIT,
  SPEECH_EXAMPLES_LIMIT,
  SPEECH_FORBIDDEN_LIMIT,
  TAGLINE_LIMIT,
  aiLearningLimitExceededMessage,
} from "@/lib/characterFormLimits";
import {
  AiLearningMeter,
  FieldCounter,
  RequirementSummary,
  aiLearningMeterState,
  type RequirementEntry,
} from "@/components/studio/CreatorEditorParts";

// tsx compiles tsconfig `jsx: preserve` with the classic factory, so the parts need a global React.
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const editor = read("./CreateCharacter.tsx");
const parts = read("./studio/CreatorEditorParts.tsx");
const saveBar = read("./studio/StudioSaveBar.tsx");
const limits = read("../lib/characterFormLimits.ts");

type AnyElement = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function walk(node: ReactNode, visit: (element: AnyElement) => void): void {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (typeof node !== "object") return;
  const element = node as AnyElement;
  if (typeof element.type === "function") {
    walk((element.type as (props: unknown) => ReactNode)(element.props), visit);
    return;
  }
  visit(element);
  walk(element.props.children, visit);
}

function textOf(node: ReactNode): string {
  const out: string[] = [];
  const collect = (value: ReactNode): void => {
    if (value == null || typeof value === "boolean") return;
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    const element = value as AnyElement;
    if (typeof element.type === "function") {
      collect((element.type as (props: unknown) => ReactNode)(element.props));
      return;
    }
    collect(element.props.children);
  };
  collect(node);
  return out.join("");
}

function countElements(node: ReactNode, tag: string): number {
  let count = 0;
  walk(node, (element) => {
    if (element.type === tag) count += 1;
  });
  return count;
}

describe("creator editor: canonical limits stay untouched", () => {
  it("keeps the 12,000 / 1,500 / per-field limits as the single owner", () => {
    assert.equal(AI_LEARNING_LIMIT, 12000);
    assert.equal(AI_LEARNING_MIN, 1500);
    assert.equal(SPEECH_EXAMPLES_LIMIT, 500);
    assert.equal(SPEECH_FORBIDDEN_LIMIT, 500);
    assert.equal(SPEECH_CONTEXTUAL_LIMIT, 500);
    assert.equal(GREETING_LIMIT, 2000);
    assert.equal(TAGLINE_LIMIT, 50);
    assert.match(aiLearningLimitExceededMessage(), /12,000자 이하/);
  });

  it("never reintroduces the old 10,000 limit in editor copy or limits", () => {
    for (const source of [editor, parts, saveBar, limits]) {
      assert.doesNotMatch(source, /10,000|10000|\b10k\b|1만\s*자/);
    }
  });

  it("client still validates through the shared constants, not literals", () => {
    assert.match(editor, /aiLearningTotal > AI_LEARNING_LIMIT/);
    assert.match(editor, /substantiveAiLearningTotal < AI_LEARNING_MIN/);
    assert.match(editor, /aiLearningLimitExceededMessage\(\)/);
    assert.doesNotMatch(editor, /[^\d,]12000[^\d]/);
    assert.doesNotMatch(parts, /[^\d,]12000[^\d]/);
  });
});

describe("creator editor: AI usage meter", () => {
  const base = { limit: AI_LEARNING_LIMIT, min: AI_LEARNING_MIN };

  it("allows exactly 12,000 and flags 12,001 as over", () => {
    assert.equal(aiLearningMeterState({ ...base, total: 12000, substantive: 12000 }), "near");
    assert.equal(aiLearningMeterState({ ...base, total: 12001, substantive: 12001 }), "over");
  });

  it("separates the 1,500 minimum from the narration-inclusive total", () => {
    assert.equal(aiLearningMeterState({ ...base, total: 1499, substantive: 1499 }), "short");
    assert.equal(aiLearningMeterState({ ...base, total: 1500, substantive: 1500 }), "ok");
    assert.equal(aiLearningMeterState({ ...base, total: 1600, substantive: 1400 }), "short");
  });

  it("renders the exact usage numbers and an over-limit alert", () => {
    const render = (total: number) =>
      AiLearningMeter({
        id: "meter",
        total,
        substantive: total,
        limit: AI_LEARNING_LIMIT,
        min: AI_LEARNING_MIN,
        minHint: "최소",
        breakdown: "합산",
      });
    const ok = textOf(render(12000));
    assert.match(ok, /12,000/);
    assert.match(ok, /0자 더 쓸 수 있어요|한도에 가까워요 · 0자 남음/);
    const over = textOf(render(12001));
    assert.match(over, /1자 초과/);
  });

  it("marks the counter over the max without clipping the number", () => {
    const over = FieldCounter({ now: 501, max: 500 });
    assert.match(String(over.props.className), /text-rose-300/);
    assert.match(String(over.props.className), /whitespace-nowrap/);
    assert.equal(textOf(over), "501 / 500자");
  });
});

describe("creator editor: required summary", () => {
  const entries: RequirementEntry<string>[] = [
    { id: "name", label: "캐릭터명", done: true, tabLabel: "제작" },
    { id: "greeting", label: "첫 메세지", done: false, tabLabel: "제작" },
    { id: "genres", label: "장르 1개 이상", done: false, tabLabel: "공개 설정" },
  ];

  it("lists only the missing items as jump buttons with the owning tab", () => {
    const tree = RequirementSummary({ entries, onJump: () => {} });
    assert.equal(countElements(tree, "button"), 2);
    const text = textOf(tree);
    assert.match(text, /1 \/ 3 완료/);
    assert.match(text, /첫 메세지제작/);
    assert.match(text, /장르 1개 이상공개 설정/);
    assert.doesNotMatch(text, /캐릭터명/);
  });

  it("collapses to a single confirmation when nothing is missing", () => {
    const tree = RequirementSummary({
      entries: entries.map((entry) => ({ ...entry, done: true })),
      onJump: () => {},
    });
    assert.equal(countElements(tree, "button"), 0);
    assert.match(textOf(tree), /필수 항목을 모두 채웠어요/);
  });
});

describe("creator editor: wiring keeps one owner per responsibility", () => {
  it("reuses StudioSaveBar once and adds no second fixed bar", () => {
    assert.equal(editor.split("<StudioSaveBar").length - 1, 1);
    assert.doesNotMatch(editor, /fixed inset-x-0|position:\s*fixed/);
    assert.match(saveBar, /bottom-\[calc\(var\(--mobile-nav-offset\)\+var\(--keyboard-inset\)\)\]/);
    assert.match(saveBar, /scroll-padding-bottom/);
    assert.match(saveBar, /role="alert"/);
  });

  it("keeps the save pipeline: one form state, same endpoints, same fast path", () => {
    assert.equal(editor.split("const [form, setForm] = useState").length - 1, 1);
    assert.match(editor, /canUseFastEditSave \? "PATCH" : isEditMode \? "PUT" : "POST"/);
    assert.match(editor, /scope: "public_profile"/);
    assert.match(editor, /isEditMode \? `\/api\/characters\/\$\{editCharacterId\}` : "\/api\/characters"/);
    assert.match(editor, /saveCharacterCreateDraft/);
    assert.match(editor, /loadCharacterCreateDraft/);
  });

  it("is free navigation, never a forced wizard", () => {
    assert.doesNotMatch(editor, /wizard|다음 단계|nextStep|currentStep/i);
    assert.match(editor, /role="tablist"/);
    assert.equal(editor.split("{...tabPanelProps(").length - 1, 4);
  });

  it("every validation failure that names a field targets a declared field key", () => {
    const declared = new Set(
      [...editor.matchAll(/^  ([a-z_]+): "(?:create|preview|widget|publish)",$/gm)].map(
        (match) => match[1],
      ),
    );
    assert.ok(declared.size >= 17);
    const used = [...editor.matchAll(/failField\([\s\S]*?, "([a-z_]+)"\);/g)].map((match) => match[1]);
    assert.ok(used.length >= 20);
    for (const key of used) assert.ok(declared.has(key), `${key} is not a FieldKey`);
  });

  it("every FieldKey has a rendered focus target", () => {
    const declared = [...editor.matchAll(/^  ([a-z_]+): "(?:create|preview|widget|publish)",$/gm)].map(
      (match) => match[1],
    );
    for (const key of declared) {
      assert.ok(
        editor.includes(`fieldProps("${key}")`) || editor.includes(`fieldId("${key}")`),
        `${key} has no id target`,
      );
    }
  });

  it("form validation is still performed by submit, not the browser bubble", () => {
    assert.match(editor, /<form id="studio-character-form" onSubmit=\{submit\} noValidate/);
    assert.match(editor, /if \(!form\.name\.trim\(\)\)/);
    assert.match(editor, /if \(files\.length > 0\)/);
  });
});
