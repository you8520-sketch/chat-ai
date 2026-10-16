import { launch, openPage, fx } from "./e44-lib.mjs";
const [base, widthsArg = "576,640,720,800,900,960,1000,1023,1024,1100,1280,1440,1700"] = process.argv.slice(2);
const U = fx.users;
const routes = [["search","/search?q=%EC%83%88%EB%B2%BD","safe"],["ranking","/tab/ranking","safe"],["studio","/studio","creatorA"],["creator-dash","/creator","creatorA"],["my-chars","/my-characters","creatorA"],["settings","/settings","safe"],["persona","/persona","safe"],["creator-pub",`/creator/${U.creatorA}`,"safe"],["albums","/albums","safe"],["chats","/chats","safe"],["create","/create","creatorA"]];
const b = await launch();
const rows = {};
for (const [name, path, user] of routes) {
  rows[name] = [];
  for (const width of widthsArg.split(",").map(Number)) {
    const { ctx, page } = await openPage(b, base, { path, user, width, wait: 500 });
    const r = await page.evaluate(() => { const m = document.querySelector("main").getBoundingClientRect(); const h = document.querySelector("main h1")?.getBoundingClientRect(); return [Math.round((h?.left ?? NaN) - m.left)]; });
    rows[name].push(r[0]);
    await ctx.close();
  }
}
console.log("widths".padEnd(14), widthsArg);
for (const [n, v] of Object.entries(rows)) console.log(n.padEnd(14), v.join(","));
await b.close();
