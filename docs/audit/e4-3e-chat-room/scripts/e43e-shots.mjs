import fs from "fs";
import { launch, openChat, measure, scrollBottom, stubEstimates } from "./e43e-lib.mjs";
const [, , BASE, TAG] = process.argv;
const WIDTHS = (process.env.WIDTHS || "360,390,576,768,1024,1440").split(",").map(Number);
const SCEN = (process.env.SCEN || "new,short,c3200,c5200,rich,long,adult,table,failed").split(",");
const dir = `/opt/cursor/artifacts/e43e/${TAG}`;
fs.mkdirSync(dir, { recursive: true });
const metrics = {};
const b = await launch();
async function readingView(page) {
  await page.evaluate(() => {
    const arts = [...document.querySelectorAll('article[id^="msg-"]')];
    const a = arts[arts.length - 1];
    if (!a) return;
    const r = a.getBoundingClientRect();
    window.scrollTo(0, window.scrollY + r.top + Math.min(r.height * 0.35, 900) - 80);
  });
  await page.waitForTimeout(350);
}
for (const w of WIDTHS) {
  for (const sc of SCEN) {
    const { page, ctx } = await openChat(b, BASE, { width: w, scenario: sc });
    await stubEstimates(page, { shown: true });
    await scrollBottom(page);
    await page.screenshot({ path: `${dir}/${sc}-${w}-bottom.png` });
    metrics[`${sc}-${w}`] = await measure(page);
    if (["c3200", "c5200", "rich"].includes(sc)) {
      await readingView(page);
      await page.screenshot({ path: `${dir}/${sc}-${w}-read.png` });
      metrics[`${sc}-${w}-read`] = await measure(page);
    }
    await ctx.close();
  }
}
await b.close();
fs.writeFileSync(`/tmp/e43e-metrics-shots-${TAG}.json`, JSON.stringify(metrics, null, 1));
console.log("done", Object.keys(metrics).length);
