import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("sidebar recent activity hierarchy", () => {
  const recent = read("src/components/SidebarRecentChatIcons.tsx");

  it("shows the name above the preview for every row; masked rows carry only the neutral server text and /verify", () => {
    assert.match(recent, /<span className="truncate text-xs font-semibold text-zinc-100">\{characterName\}<\/span>/);
    assert.match(recent, /const hidden = session\.masked/);
    assert.match(recent, /<MaskedChatGlyph/);
    assert.doesNotMatch(recent, /blurNsfw|blur-md/);
    assert.match(recent, /href=\{href\}/);
  });

  it("keeps the section label separated from the nav links and the active row on the brand tint", () => {
    assert.match(recent, /border-t border-white\/\[0\.06\][^"]*text-zinc-400[\s\S]{0,40}최근 활동/);
    assert.equal((recent.match(/active \? "bg-violet-500\/15" : ""/g) ?? []).length, 2);
  });

  it("marks the active rail link with a bar, tint and aria-current", () => {
    const rail = read("src/components/SidebarShell.tsx");
    assert.match(rail, /before:absolute before:inset-y-2\.5 before:left-0 before:w-0\.5/);
    assert.match(rail, /aria-current=\{active \? "page" : undefined\}/);
  });
});
