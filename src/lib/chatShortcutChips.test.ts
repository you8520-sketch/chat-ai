import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CHAT_MESSAGE_MAX } from "./chatModels";
import {
  CHAT_SHORTCUT_INSERT_DEFERRED_MESSAGE,
  CHAT_SHORTCUT_INSERT_LOCKED_MESSAGE,
  CHAT_SHORTCUT_INSERT_TOO_LONG_MESSAGE,
} from "./chatShortcutComposer";
import {
  SHORTCUT_CHIP_LIMIT,
  detectShortcutSlash,
  expandShortcutChips,
  filterShortcutsForSlash,
  findShortcutTokens,
  normalizeShortcutComposer,
  planShortcutChipInsert,
  planShortcutChipKey,
  reconcileShortcutEdit,
  removeShortcutChipToken,
  shortcutEditExceedsLimit,
  shortcutNameMatchesQuery,
  snapShortcutSelection,
  type ShortcutChip,
  type ShortcutChipSource,
} from "./chatShortcutChips";

const AUTO: ShortcutChipSource = {
  id: 1,
  name: "자동",
  favorite: true,
  content: "다음 장면을 자연스럽게 진행하되 [자동]이라는 글자는 그대로 둔다.",
};
const GO: ShortcutChipSource = { id: 2, name: "전투 진행", favorite: false, content: "전투를 이어서." };

type State = { value: string; chips: ShortcutChip[] };

function insert(
  state: State,
  source: ShortcutChipSource,
  at: number,
  extra: { replaceRange?: { start: number; end: number }; selectionEnd?: number } = {}
): State & { caret: number } {
  const plan = planShortcutChipInsert({
    composing: false,
    value: state.value,
    chips: state.chips,
    selectionStart: at,
    selectionEnd: extra.selectionEnd ?? at,
    replaceRange: extra.replaceRange,
    source,
  });
  assert.equal(plan.action, "apply");
  if (plan.action !== "apply") throw new Error("unreachable");
  return { value: plan.value, chips: plan.chips, caret: plan.caret };
}

const EMPTY: State = { value: "", chips: [] };

describe("shortcut chip display vs sent text", () => {
  test("display value never contains the saved body; expansion restores it exactly", () => {
    const next = insert(EMPTY, AUTO, 0);
    assert.equal(next.value.includes("다음 장면"), false);
    assert.equal(next.value.replace(/[\u2060\u2061\u200B\u200C\u2062\u2063\u2064]/g, "").includes("★\u00A0자동"), true);
    assert.equal(next.value.includes("자\u2060동"), true);
    assert.equal(next.value.startsWith("\u200B\u2060"), true);
    assert.equal(expandShortcutChips(next.value, next.chips), AUTO.content);
  });

  test("two shortcuts mixed with typed text keep position and order", () => {
    let state: State = insert(EMPTY, AUTO, 0);
    state = { value: `${state.value} 그리고 `, chips: state.chips };
    state = insert(state, GO, state.value.length);
    state = { value: `먼저 ${state.value}!`, chips: state.chips };
    assert.equal(
      expandShortcutChips(state.value, state.chips),
      `먼저 ${AUTO.content} 그리고 ${GO.content}!`
    );
    assert.equal(findShortcutTokens(state.value, state.chips).length, 2);
  });

  test("the same shortcut inserted twice gets distinct chips", () => {
    let state = insert(EMPTY, AUTO, 0);
    state = insert(state, AUTO, state.value.length);
    assert.equal(state.chips.length, 2);
    assert.equal(expandShortcutChips(state.value, state.chips), `${AUTO.content}${AUTO.content}`);
  });

  test("expansion is single pass: body that looks like a token is not re-expanded", () => {
    const trap: ShortcutChipSource = {
      id: 5,
      name: "함정",
      favorite: false,
      content: "\u2060\u200B\u200B가짜\u2061 [자동]",
    };
    let state = insert(EMPTY, GO, 0);
    state = insert(state, trap, state.value.length);
    const sent = expandShortcutChips(state.value, state.chips);
    assert.equal(sent, `${GO.content}${trap.content}`);
  });

  test("snapshot is independent of later edits to the saved shortcut", () => {
    const state = insert(EMPTY, AUTO, 0);
    const stored = { ...AUTO, content: "바뀐 본문" };
    assert.notEqual(stored.content, state.chips[0]!.content);
    assert.equal(expandShortcutChips(state.value, state.chips), AUTO.content);
  });

  test("stray markers without a chip table are dropped, not sent", () => {
    assert.equal(expandShortcutChips("가\u2060\u200B\u200C나\u2061", []), "가나");
  });
});

describe("shortcut chip insertion", () => {
  test("inserts at the caret, keeps selection text, and puts the caret after the chip", () => {
    const state = insert({ value: "가나다", chips: [] }, GO, 1, { selectionEnd: 2 });
    const tokens = findShortcutTokens(state.value, state.chips);
    assert.equal(tokens.length, 1);
    assert.equal(state.value.slice(0, 1), "가");
    assert.equal(state.value.slice(tokens[0]!.end), "나다");
    assert.equal(state.caret, tokens[0]!.end);
  });

  test("replaceRange swaps only the slash command and preserves neighbours", () => {
    const text = "앞 문장 /ㅈ 뒤 문장";
    const start = text.indexOf("/");
    const state = insert({ value: text, chips: [] }, GO, start + 2, {
      replaceRange: { start, end: start + 2 },
    });
    assert.equal(expandShortcutChips(state.value, state.chips), `앞 문장 ${GO.content} 뒤 문장`);
  });

  test("defers during composition and rejects while locked", () => {
    const base = { value: "안", chips: [], selectionStart: 1, selectionEnd: 1, source: GO };
    assert.deepEqual(planShortcutChipInsert({ ...base, composing: true }), {
      action: "defer",
      message: CHAT_SHORTCUT_INSERT_DEFERRED_MESSAGE,
    });
    assert.deepEqual(planShortcutChipInsert({ ...base, composing: false, locked: true }), {
      action: "reject",
      message: CHAT_SHORTCUT_INSERT_LOCKED_MESSAGE,
    });
  });

  test("refuses when the expanded message would exceed the chat limit, without slicing", () => {
    const draft = "가".repeat(CHAT_MESSAGE_MAX - 5);
    const big: ShortcutChipSource = { id: 9, name: "큼", favorite: false, content: "나".repeat(500) };
    const plan = planShortcutChipInsert({
      composing: false,
      value: draft,
      chips: [],
      selectionStart: draft.length,
      selectionEnd: draft.length,
      source: big,
    });
    assert.deepEqual(plan, { action: "reject", message: CHAT_SHORTCUT_INSERT_TOO_LONG_MESSAGE });
  });

  test("allows the insert at exactly the limit and refuses one character more", () => {
    const content = "다".repeat(500);
    const source: ShortcutChipSource = { id: 9, name: "큼", favorite: false, content };
    const fits = "가".repeat(CHAT_MESSAGE_MAX - 500);
    const ok = planShortcutChipInsert({
      composing: false,
      value: fits,
      chips: [],
      selectionStart: 0,
      selectionEnd: 0,
      source,
    });
    // display value includes the token label, so it must fit the cap too
    assert.equal(ok.action, "apply");
    const over = planShortcutChipInsert({
      composing: false,
      value: `${fits}가`,
      chips: [],
      selectionStart: 0,
      selectionEnd: 0,
      source,
    });
    assert.equal(over.action, "reject");
  });

  test("caps the number of chips per message", () => {
    let state: State = EMPTY;
    for (let i = 0; i < SHORTCUT_CHIP_LIMIT; i += 1) {
      state = insert(state, { id: i + 1, name: `n${i}`, favorite: false, content: "x" }, state.value.length);
    }
    assert.equal(state.chips.length, SHORTCUT_CHIP_LIMIT);
    const plan = planShortcutChipInsert({
      composing: false,
      value: state.value,
      chips: state.chips,
      selectionStart: 0,
      selectionEnd: 0,
      source: GO,
    });
    assert.equal(plan.action, "reject");
  });

  test("word joiners do not consume the chip cap or the chat limit", () => {
    const name = "가".repeat(30);
    let state: State = EMPTY;
    for (let i = 0; i < SHORTCUT_CHIP_LIMIT; i += 1) {
      state = insert(state, { id: i + 1, name, favorite: false, content: "x" }, state.value.length);
    }
    assert.equal(state.chips.length, SHORTCUT_CHIP_LIMIT);
    assert.equal(state.value.includes("가\u2060가"), true);
    assert.ok(state.value.length > CHAT_MESSAGE_MAX);
    assert.equal(expandShortcutChips(state.value, state.chips), "x".repeat(SHORTCUT_CHIP_LIMIT));
    assert.equal(shortcutEditExceedsLimit(state.value, state.chips), false);
  });

  test("a chip saved before line-break joiners still restores", () => {
    const chip: ShortcutChip = {
      key: 0,
      shortcutId: GO.id,
      name: GO.name,
      favorite: false,
      content: GO.content,
    };
    const legacy = `\u2060\u200B\u200B\u00A0전투\u00A0진행\u00A0×\u00A0\u2061`;
    assert.equal(findShortcutTokens(legacy, [chip]).length, 1);
    const normalized = normalizeShortcutComposer(`앞${legacy}뒤`, [chip]);
    assert.equal(expandShortcutChips(normalized.value, normalized.chips), `앞${GO.content}뒤`);
    assert.equal(normalized.value.includes("전\u2060투"), true);
    assert.equal(normalized.value.includes("\u200B\u2060"), true);
  });
});

describe("shortcut chip editing", () => {
  const withText = (): State & { caret: number } => {
    const state = insert({ value: "앞 뒤", chips: [] }, AUTO, 2);
    return state;
  };

  test("typing next to a chip leaves it intact", () => {
    const state = withText();
    const result = reconcileShortcutEdit({
      prev: state.value,
      next: `${state.value.slice(0, state.caret)}X${state.value.slice(state.caret)}`,
      chips: state.chips,
    });
    assert.equal(result.caret, null);
    assert.equal(expandShortcutChips(result.value, result.chips), `앞 ${AUTO.content}X뒤`);
  });

  test("deleting one marker character removes the whole chip and its table entry", () => {
    const state = withText();
    const [token] = findShortcutTokens(state.value, state.chips);
    const next = `${state.value.slice(0, token!.end - 1)}${state.value.slice(token!.end)}`;
    const result = reconcileShortcutEdit({ prev: state.value, next, chips: state.chips });
    assert.equal(result.value, "앞 뒤");
    assert.deepEqual(result.chips, []);
    assert.equal(result.caret, 2);
  });

  test("typing inside a chip label removes that chip only", () => {
    let state = insert({ value: "", chips: [] }, AUTO, 0);
    state = insert(state, GO, state.value.length);
    const [first] = findShortcutTokens(state.value, state.chips);
    const inside = first!.start + 6;
    const next = `${state.value.slice(0, inside)}Z${state.value.slice(inside)}`;
    const result = reconcileShortcutEdit({ prev: state.value, next, chips: state.chips });
    assert.equal(findShortcutTokens(result.value, result.chips).length, 1);
    assert.equal(expandShortcutChips(result.value, result.chips), `Z${GO.content}`);
  });

  test("pasted unknown markers become plain text without markers", () => {
    const result = reconcileShortcutEdit({
      prev: "",
      next: "붙\u2060\u200B\u200C여넣\u2061기",
      chips: [],
    });
    assert.equal(result.value, "붙여넣기");
  });

  test("a pasted copy of an existing chip keeps working", () => {
    const state = insert(EMPTY, AUTO, 0);
    const token = state.value;
    const result = reconcileShortcutEdit({
      prev: state.value,
      next: `${state.value}${token}`,
      chips: state.chips,
    });
    assert.equal(expandShortcutChips(result.value, result.chips), `${AUTO.content}${AUTO.content}`);
  });

  test("Backspace/Delete remove the adjacent chip atomically; arrows jump over it", () => {
    const state = withText();
    const [token] = findShortcutTokens(state.value, state.chips);
    const back = planShortcutChipKey({
      value: state.value,
      chips: state.chips,
      selectionStart: token!.end,
      selectionEnd: token!.end,
      key: "Backspace",
    });
    assert.equal(back?.kind, "remove");
    if (back?.kind === "remove") {
      assert.equal(back.value, "앞 뒤");
      assert.equal(back.caret, token!.start);
    }
    const del = planShortcutChipKey({
      value: state.value,
      chips: state.chips,
      selectionStart: token!.start,
      selectionEnd: token!.start,
      key: "Delete",
    });
    assert.equal(del?.kind, "remove");
    assert.deepEqual(
      planShortcutChipKey({
        value: state.value,
        chips: state.chips,
        selectionStart: token!.start,
        selectionEnd: token!.start,
        key: "ArrowRight",
      }),
      { kind: "caret", caret: token!.end }
    );
    assert.deepEqual(
      planShortcutChipKey({
        value: state.value,
        chips: state.chips,
        selectionStart: token!.end,
        selectionEnd: token!.end,
        key: "ArrowLeft",
      }),
      { kind: "caret", caret: token!.start }
    );
    assert.equal(
      planShortcutChipKey({
        value: state.value,
        chips: state.chips,
        selectionStart: 0,
        selectionEnd: 0,
        key: "Backspace",
      }),
      null
    );
  });

  test("the × button removes only its own chip", () => {
    let state = insert(EMPTY, AUTO, 0);
    state = insert({ value: `${state.value} 사이 `, chips: state.chips }, GO, state.value.length + 4);
    const tokens = findShortcutTokens(state.value, state.chips);
    const removed = removeShortcutChipToken({
      value: state.value,
      chips: state.chips,
      tokenStart: tokens[0]!.start,
    });
    assert.ok(removed);
    assert.equal(expandShortcutChips(removed!.value, removed!.chips), ` 사이 ${GO.content}`);
    assert.equal(removed!.chips.length, 1);
  });

  test("caret and selection never rest inside a chip", () => {
    const state = withText();
    const [token] = findShortcutTokens(state.value, state.chips);
    const mid = token!.start + 5;
    assert.deepEqual(
      snapShortcutSelection({
        value: state.value,
        chips: state.chips,
        selectionStart: mid,
        selectionEnd: mid,
        previousStart: token!.start,
      }),
      { start: token!.end, end: token!.end }
    );
    assert.deepEqual(
      snapShortcutSelection({
        value: state.value,
        chips: state.chips,
        selectionStart: mid,
        selectionEnd: mid,
        previousStart: token!.end,
      }),
      { start: token!.start, end: token!.start }
    );
    assert.deepEqual(
      snapShortcutSelection({
        value: state.value,
        chips: state.chips,
        selectionStart: 0,
        selectionEnd: mid,
        previousStart: 0,
      }),
      { start: 0, end: token!.end }
    );
    assert.equal(
      snapShortcutSelection({
        value: state.value,
        chips: state.chips,
        selectionStart: 1,
        selectionEnd: 1,
        previousStart: 0,
      }),
      null
    );
  });

  test("restored drafts keep only intact chips", () => {
    const state = insert(EMPTY, AUTO, 0);
    assert.deepEqual(normalizeShortcutComposer(state.value, state.chips), {
      value: state.value,
      chips: state.chips,
    });
    const broken = normalizeShortcutComposer(state.value.slice(0, -1), state.chips);
    assert.equal(findShortcutTokens(broken.value, broken.chips).length, 0);
    assert.deepEqual(broken.chips, []);
    assert.deepEqual(normalizeShortcutComposer("그냥 글", state.chips), { value: "그냥 글", chips: [] });
  });

  test("typing is refused only when the display or expanded text passes the chat limit", () => {
    const state = insert(EMPTY, AUTO, 0);
    assert.equal(shortcutEditExceedsLimit(`${state.value}${"가".repeat(100)}`, state.chips), false);
    const nearly = `${state.value}${"가".repeat(CHAT_MESSAGE_MAX - AUTO.content.length)}`;
    assert.equal(shortcutEditExceedsLimit(nearly, state.chips), false);
    assert.equal(shortcutEditExceedsLimit(`${nearly}가`, state.chips), true);
  });
});

describe("slash command detection", () => {
  test("recognises / at the start, after whitespace, and right after a chip", () => {
    assert.deepEqual(detectShortcutSlash("/ㅈ", 2), { start: 0, end: 2, query: "ㅈ" });
    assert.deepEqual(detectShortcutSlash("안녕 /진", 5), { start: 3, end: 5, query: "진" });
    assert.deepEqual(detectShortcutSlash("줄\n/", 3), { start: 2, end: 3, query: "" });
    const state = insert(EMPTY, GO, 0);
    const text = `${state.value}/ab`;
    assert.deepEqual(detectShortcutSlash(text, text.length), {
      start: state.value.length,
      end: text.length,
      query: "ab",
    });
  });

  test("does not treat URLs, paths, or mid-word slashes as commands", () => {
    assert.equal(detectShortcutSlash("https://example.com/a", 21), null);
    assert.equal(detectShortcutSlash("and/or", 6), null);
    assert.equal(detectShortcutSlash("//x", 3), null);
    assert.equal(detectShortcutSlash("/a/b", 4), null);
    assert.equal(detectShortcutSlash("문장 / 뒤", 5), null);
  });

  test("the empty query (just a slash) is a command when the caret is after it", () => {
    assert.deepEqual(detectShortcutSlash("글 /", 3), { start: 2, end: 3, query: "" });
  });
});

describe("slash filtering", () => {
  const items = [
    { id: 1, name: "진행", favorite: false, updatedAt: "2026-10-01 00:00:00" },
    { id: 2, name: "전투 진행", favorite: false, updatedAt: "2026-10-03 00:00:00" },
    { id: 3, name: "자동", favorite: true, updatedAt: "2026-09-01 00:00:00" },
    { id: 4, name: "Hello", favorite: false, updatedAt: "2026-10-02 00:00:00" },
    { id: 5, name: "인사", favorite: false, updatedAt: "2026-10-02 00:00:00" },
  ];
  const names = (query: string) => filterShortcutsForSlash(items, query).map((item) => item.name);

  test("initial consonant, completed syllable, and plain prefix", () => {
    assert.deepEqual(names("ㅈ"), ["자동", "전투 진행", "진행"]);
    assert.deepEqual(names("진"), ["진행"]);
    assert.deepEqual(names("지"), ["진행"]);
    assert.deepEqual(names("ㅈㅎ"), ["진행"]);
    assert.deepEqual(names("전ㅌ"), ["전투 진행"]);
    assert.deepEqual(names("he"), ["Hello"]);
    assert.deepEqual(names("HE"), ["Hello"]);
  });

  test("empty query lists everything, favorites first; no match is empty", () => {
    assert.deepEqual(names(""), ["자동", "전투 진행", "인사", "Hello", "진행"]);
    assert.deepEqual(names("ㅋ"), []);
    assert.equal(shortcutNameMatchesQuery("진행", "진행입니다"), false);
  });
});
