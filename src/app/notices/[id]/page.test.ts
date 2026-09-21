import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("notice detail route", () => {
  it("uses canonical notice lookup and not-found handling", () => {
    const page = fs.readFileSync("src/app/notices/[id]/page.tsx", "utf8");
    assert.match(page, /getNoticeById/);
    assert.match(page, /notFound\(\)/);
    assert.match(page, /MarkNoticeReadOnView/);
  });
});
