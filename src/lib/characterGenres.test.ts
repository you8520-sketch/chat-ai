import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHARACTER_GENRES,
  genreFilterSql,
  sanitizeCharacterGenres,
} from "@/lib/characterGenres";

describe("characterGenres", () => {
  it("drops comic/action and expands legacy compound genres", () => {
    const out = sanitizeCharacterGenres(["판타지/SF", "학원/스포츠", "무협/시대극", "코믹/액션", "BL"]);
    assert.deepEqual(out, ["학원", "스포츠", "판타지", "SF", "무협", "BL"]);
  });

  it("includes new HL and 센티넬버스 options", () => {
    assert.ok(CHARACTER_GENRES.includes("HL"));
    assert.ok(CHARACTER_GENRES.includes("센티넬버스"));
    assert.ok(CHARACTER_GENRES.includes("동양풍"));
    assert.ok(!CHARACTER_GENRES.includes("코믹/액션" as never));
    assert.ok(!CHARACTER_GENRES.includes("판타지/SF" as never));
  });

  it("genreFilterSql matches legacy 판타지/SF when filtering 판타지", () => {
    const { sql, params } = genreFilterSql("판타지");
    assert.match(sql, /genre = \?/);
    assert.ok(params.includes("판타지"));
    assert.ok(params.includes("판타지/SF"));
  });
});
