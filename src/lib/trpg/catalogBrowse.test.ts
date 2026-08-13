import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogItemMatches, genresInCatalog } from "./catalogBrowse";
import { parseWorldTrpgFlags } from "@/lib/worlds";

describe("TRPG catalog browse", () => {
  it("filters by query and genre hashtags", () => {
    const item = {
      title: "북부 대공국",
      summary: "눈과 정치",
      creatorName: "렌",
      genres: ["판타지", "동양풍"] as const,
    };
    assert.equal(catalogItemMatches({ ...item, query: "대공", genre: null }), true);
    assert.equal(catalogItemMatches({ ...item, query: "서울", genre: null }), false);
    assert.equal(catalogItemMatches({ ...item, query: "", genre: "판타지" }), true);
    assert.equal(catalogItemMatches({ ...item, query: "", genre: "SF" }), false);
    assert.deepEqual(
      genresInCatalog([{ genres: ["SF"] }, { genres: ["판타지", "SF"] }]),
      ["판타지", "SF"]
    );
  });

  it("turns TRPG on as public listing and off as private", () => {
    assert.deepEqual(parseWorldTrpgFlags({ trpgEnabled: true, trpgVisibility: "private" }), {
      trpgEnabled: 1,
      trpgVisibility: "public",
    });
    assert.deepEqual(parseWorldTrpgFlags({ trpgEnabled: false, trpgVisibility: "public" }), {
      trpgEnabled: 0,
      trpgVisibility: "private",
    });
  });
});
