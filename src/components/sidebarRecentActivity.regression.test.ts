import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("sidebar recent activity hierarchy", () => {
  const recent = read("src/components/SidebarRecentChatIcons.tsx");

  it("shows the character name above the preview, but never for rows hidden by the safety filter", () => {
    assert.match(recent, /\{hidden \? null : \(\s*<span className="truncate text-xs font-semibold text-zinc-100">\{characterName\}<\/span>/);
    assert.match(recent, /hidden \? "line-clamp-2" : "truncate"/);
    assert.match(recent, /const href = hidden \? "\/verify"/);
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
