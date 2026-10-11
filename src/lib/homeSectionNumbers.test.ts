import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { homeSectionNumbers } from "@/lib/homeSections";

describe("homeSectionNumbers", () => {
  it("numbers only displayed sections, in order, from 01", () => {
    assert.deepEqual(homeSectionNumbers([3, 2, 5]), ["01", "02", "03"]);
    assert.deepEqual(homeSectionNumbers([3, 0, 5]), ["01", "", "02"]);
    assert.deepEqual(homeSectionNumbers([0, 2, 5]), ["", "01", "02"]);
    assert.deepEqual(homeSectionNumbers([0, 0, 5]), ["", "", "01"]);
    assert.deepEqual(homeSectionNumbers([3, 0, 0]), ["01", "", ""]);
    assert.deepEqual(homeSectionNumbers([0, 0, 0]), ["", "", ""]);
  });
});
