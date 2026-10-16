import { launch, openPage } from "./e44-lib.mjs";
const [base] = process.argv.slice(2);
const routes = [["create","/create","creatorA"],["world-create","/world/create","creatorA"],["lorebook-create","/lorebook/create","creatorA"],["lorebook","/lorebook","creatorA"],["studio-worlds","/studio?tab=worlds","creatorA"],["studio-lore","/studio?tab=lorebooks","creatorA"],["notifications","/notifications","safe"],["albums","/albums","safe"],["signup","/signup",null],["verify","/verify","safe"],["terms","/terms",null],["refund","/refund",null],["bookmarks","/bookmarks","safe"],["simulation-create","/simulation/create","creatorA"],["onboarding","/onboarding","safe"]];
const b = await launch();
for (const [name, path, user] of routes) {
  for (const width of [390, 1440]) {
    const { ctx, page } = await openPage(b, base, { path, user, width, wait: 600 });
    const r = await page.evaluate(() => {
      const main = document.querySelector("main"); const mr = main?.getBoundingClientRect();
      const h1 = main?.querySelector("h1")?.getBoundingClientRect();
      let minL = 1e9, maxR = 0;
      for (const el of document.querySelectorAll("main *")) { const r = el.getBoundingClientRect(); if (!r.width||!r.height||getComputedStyle(el).position==="fixed") continue; if (el.closest("[class*='overflow-x-auto'], [class*='snap-x']")) continue; minL=Math.min(minL,r.left); maxR=Math.max(maxR,r.right); }
      const first = main?.firstElementChild; const fc = first ? String(first.className).split(/\s+/).filter(c=>/^(max-w|mx-|px-|w-|ml-)/.test(c)).join(".") : "";
      return { url: location.pathname, mainL: mr?.left, mainW: mr?.width, h1L: h1?.left, contentL: Math.round(minL*10)/10, contentR: Math.round(maxR*10)/10, firstWrap: fc };
    });
    console.log(name.padEnd(17), width, JSON.stringify(r));
    await ctx.close();
  }
}
await b.close();
