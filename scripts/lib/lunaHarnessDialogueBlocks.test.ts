import assert from "node:assert/strict";
import test from "node:test";
import {
  countHarnessDialogueBlocks,
  extractHarnessDialogueBlocks,
} from "./lunaHarnessDialogueBlocks";

test("counts ASCII and curly double-quoted standalone lines", () => {
  const prose = `선우는 고개를 돌렸다.\n\n"간다."\n\n셔터가 울렸다.\n\n"좋아. 내가 먼저 확인한다."`;
  assert.equal(countHarnessDialogueBlocks(prose), 2);
});

test("counts corner brackets as dialogue blocks", () => {
  const prose = `그는 말했다.\n\n「이쪽으로」\n\n문이 열렸다.\n\n『멈춰』`;
  assert.equal(countHarnessDialogueBlocks(prose), 2);
});

test("does not count inline narrated quotes", () => {
  const prose = `"간다"라고 말했다.\n\n선우는 이동했다.`;
  assert.equal(countHarnessDialogueBlocks(prose), 0);
});

test("multiline quote in one paragraph counts once", () => {
  const prose = `"첫 줄이고\n두 번째 줄이다."`;
  assert.equal(countHarnessDialogueBlocks(prose), 1);
  const blocks = extractHarnessDialogueBlocks(prose);
  assert.match(blocks[0]!.text, /첫 줄/);
});

test("comma and question marks inside quotes stay one block", () => {
  const prose = `"알겠어, 그럼 이동하자."\n\n"뭐?"`;
  assert.equal(countHarnessDialogueBlocks(prose), 2);
});
