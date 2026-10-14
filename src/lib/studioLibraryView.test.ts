import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { CharacterVisibility, ModerationStatus } from "@/lib/characterVisibility";
import {
  EMPTY_STUDIO_FILTER,
  STUDIO_LIBRARY_PAGE_SIZE,
  STUDIO_LIBRARY_TOOLS_MIN,
  filterStudioWorks,
  isStudioFilterActive,
  matchesLibraryQuery,
  studioWorkKind,
  summarizeStudioWorks,
  type FilterableWork,
  type StudioLibraryFilter,
  type StudioStatusFilter,
} from "@/lib/studioLibraryView";

function work(
  name: string,
  over: Partial<FilterableWork> & { id?: number } = {},
): FilterableWork & { id: number } {
  return {
    id: over.id ?? 0,
    name,
    content_kind: over.content_kind ?? "character",
    visibility: over.visibility ?? "public",
    moderation_status: over.moderation_status ?? "approved",
  };
}

const WORKS = [
  work("바람의 정원사", { id: 1 }),
  work("달빛 도서관 시뮬레이션", { id: 2, content_kind: "simulation" }),
  work("링크 공개 캐릭터", { id: 3, visibility: "link" }),
  work("혼자만 보는 초안", { id: 4, visibility: "private" }),
  work("검수 대기 시뮬", { id: 5, content_kind: "simulation", moderation_status: "pending" }),
  work("반려된 캐릭터", { id: 6, moderation_status: "rejected" }),
  work("비공개 반려 캐릭터", { id: 7, visibility: "private", moderation_status: "rejected" }),
];

const ids = (list: { id: number }[]) => list.map((w) => w.id);
const filter = (over: Partial<StudioLibraryFilter>): StudioLibraryFilter => ({ ...EMPTY_STUDIO_FILTER, ...over });

describe("studio library name search", () => {
  it("matches a trimmed, case-insensitive substring of the name only", () => {
    assert.equal(matchesLibraryQuery("Moonlight 도서관", "  moon "), true);
    assert.equal(matchesLibraryQuery("달빛 도서관", "도서"), true);
    assert.equal(matchesLibraryQuery("달빛 도서관", "정원"), false);
    assert.equal(matchesLibraryQuery("아무 작품", "   "), true);
  });
});

describe("studio library filters", () => {
  it("returns every work in the original order when no filter is active", () => {
    assert.deepEqual(ids(filterStudioWorks(WORKS, EMPTY_STUDIO_FILTER)), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(isStudioFilterActive(EMPTY_STUDIO_FILTER), false);
  });

  it("filters by work kind using the same character/simulation rule as the list", () => {
    assert.deepEqual(ids(filterStudioWorks(WORKS, filter({ kind: "simulation" }))), [2, 5]);
    assert.deepEqual(ids(filterStudioWorks(WORKS, filter({ kind: "character" }))), [1, 3, 4, 6, 7]);
    assert.equal(studioWorkKind({ content_kind: undefined }), "character");
    assert.equal(studioWorkKind({ content_kind: "unknown" }), "character");
  });

  it("keeps visibility and moderation as separate axes", () => {
    const run = (status: StudioStatusFilter) => ids(filterStudioWorks(WORKS, filter({ status })));
    assert.deepEqual(run("public"), [1, 2, 5, 6]);
    assert.deepEqual(run("link"), [3]);
    assert.deepEqual(run("private"), [4, 7]);
    assert.deepEqual(run("pending"), [5]);
    assert.deepEqual(run("rejected"), [6, 7]);
    assert.deepEqual(run("attention"), [5, 6, 7]);
  });

  it("combines query, kind and status and never invents works", () => {
    const result = filterStudioWorks(WORKS, filter({ query: "시뮬", kind: "simulation", status: "attention" }));
    assert.deepEqual(ids(result), [5]);
    assert.ok(result.every((w) => WORKS.includes(w)));
    assert.deepEqual(ids(filterStudioWorks(WORKS, filter({ query: "없는 이름" }))), []);
  });
});

describe("studio library summary", () => {
  it("counts partition the library by kind and by visibility", () => {
    const summary = summarizeStudioWorks(WORKS);
    assert.equal(summary.total, 7);
    assert.equal(summary.character + summary.simulation, summary.total);
    assert.equal(summary.public + summary.link + summary.private, summary.total);
    assert.equal(summary.pending, 1);
    assert.equal(summary.rejected, 2);
  });

  it("agrees with the filters it advertises", () => {
    const summary = summarizeStudioWorks(WORKS);
    const visibilities: CharacterVisibility[] = ["public", "link", "private"];
    for (const v of visibilities) {
      assert.equal(filterStudioWorks(WORKS, filter({ status: v })).length, summary[v]);
    }
    const moderations: ModerationStatus[] = ["pending", "rejected"];
    for (const m of moderations) {
      assert.equal(filterStudioWorks(WORKS, filter({ status: m as StudioStatusFilter })).length, summary[m]);
    }
    assert.equal(filterStudioWorks(WORKS, filter({ status: "attention" })).length, summary.pending + summary.rejected);
  });
});

describe("studio library tools stay client-side presentation", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const tools = read("../components/studio/StudioLibraryTools.tsx");
  const studio = read("../components/StudioClient.tsx");
  const view = read("./studioLibraryView.ts");

  it("adds no network call, storage or server search", () => {
    for (const source of [tools, view]) {
      assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|\/api\//);
    }
  });

  it("only shows tools for larger libraries and pages the grid in steps", () => {
    assert.ok(STUDIO_LIBRARY_TOOLS_MIN >= 2 && STUDIO_LIBRARY_TOOLS_MIN <= 10);
    assert.ok(STUDIO_LIBRARY_PAGE_SIZE >= STUDIO_LIBRARY_TOOLS_MIN);
    assert.match(studio, /creations\.length >= STUDIO_LIBRARY_TOOLS_MIN/);
    assert.match(studio, /<StudioLoadMore/);
    assert.match(studio, /<StudioNoMatches/);
  });

  it("keeps the delete and share owners out of the filter layer", () => {
    assert.doesNotMatch(tools, /DELETE|\/share|world-borrows/);
  });
});
