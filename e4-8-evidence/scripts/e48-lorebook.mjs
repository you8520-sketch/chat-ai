import { launch, openPage } from "./e44-lib.mjs";
const [base, label] = process.argv.slice(2);
const b = await launch();
const rows = [];
for (const [w, h] of [[320, 568], [360, 740], [375, 667], [390, 844], [576, 900], [768, 1024], [1024, 800], [1440, 900]]) {
  const { page, ctx } = await openPage(b, base, { path: "/lorebook/create", user: "creatorA", width: w, height: h, wait: 600, until: "domcontentloaded" });
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const inp = [...document.querySelectorAll("input")].find((i) => /키워드/.test(i.placeholder));
    const wrap = inp.parentElement.getBoundingClientRect();
    const bar = document.querySelector('[data-testid="studio-save-bar"]').getBoundingClientRect();
    return { sw: document.documentElement.scrollWidth, vw, overflow: document.documentElement.scrollWidth > vw + 1, inputW: Math.round(inp.getBoundingClientRect().width), wrapW: Math.round(wrap.width), barR: Math.round(bar.right) };
  });
  rows.push({ w, ...r });
  if (w === 320) {
    await page.screenshot({ path: `/tmp/e48-shots/${label}/lorebook-320.png` });
    // keyword add / remove
    const inp = page.getByPlaceholder("키워드 입력 후 Enter");
    for (const k of ["첫번째", "두번째 아주 긴 키워드 이름입니다 열두자 넘는"]) { await inp.fill(k); await inp.press("Enter"); }
    const chips = await page.locator('button[aria-label$="키워드 삭제"]').count();
    await page.screenshot({ path: `/tmp/e48-shots/${label}/lorebook-320-chips.png` });
    const sw1 = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.locator('button[aria-label="첫번째 키워드 삭제"]').click();
    const chips2 = await page.locator('button[aria-label$="키워드 삭제"]').count();
    rows.push({ keywordFlow: { chips, chipsAfterRemove: chips2, scrollWidthWithChips: sw1, posts: page.__posts.length } });
  }
  await ctx.close();
}
for (const r of rows) console.log(label, JSON.stringify(r));
await b.close();
