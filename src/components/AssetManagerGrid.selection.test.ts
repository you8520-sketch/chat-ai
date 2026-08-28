import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pruneSelectedUrls,
  toggleSelectedUrl,
} from "@/lib/assetManagerGridSelection";

describe("AssetManagerGrid selection helpers", () => {
  it("toggle select and deselect by URL", () => {
    let selected = new Set<string>();
    selected = toggleSelectedUrl(selected, "/uploads/a.webp");
    assert.equal(selected.has("/uploads/a.webp"), true);
    selected = toggleSelectedUrl(selected, "/uploads/a.webp");
    assert.equal(selected.size, 0);
  });

  it("prunes removed URLs after asset list changes", () => {
    const pruned = pruneSelectedUrls(
      new Set(["/uploads/a.webp", "/uploads/b.webp"]),
      ["/uploads/b.webp", "/uploads/c.webp"]
    );
    assert.deepEqual([...pruned], ["/uploads/b.webp"]);
  });

  it("reorder preserves selection by URL", () => {
    const urlsBefore = ["/uploads/a.webp", "/uploads/b.webp"];
    const urlsAfter = ["/uploads/b.webp", "/uploads/a.webp"];
    const selected = new Set(["/uploads/a.webp"]);
    assert.deepEqual([...pruneSelectedUrls(selected, urlsBefore)], ["/uploads/a.webp"]);
    assert.deepEqual([...pruneSelectedUrls(selected, urlsAfter)], ["/uploads/a.webp"]);
  });

  it("selection is not persisted (ephemeral Set only)", () => {
    const selected = toggleSelectedUrl(new Set(), "/uploads/x.webp");
    assert.ok(selected instanceof Set);
    assert.equal(JSON.stringify({ assets: [] }).includes("/uploads/x.webp"), false);
  });
});

describe("drag-click suppression contract", () => {
  it("suppresses selection toggle while drag flag is active", () => {
    let suppress = false;
    let selected = new Set<string>();
    const tryToggle = (url: string) => {
      if (suppress) return;
      selected = toggleSelectedUrl(selected, url);
    };
    suppress = true;
    tryToggle("/uploads/a.webp");
    assert.equal(selected.size, 0);
    suppress = false;
    tryToggle("/uploads/a.webp");
    assert.equal(selected.size, 1);
  });
});
