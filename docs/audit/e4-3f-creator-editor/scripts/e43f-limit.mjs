import { launch, openCreate, draftSnapshot } from "./e43f-lib.mjs";
import fs from "fs";
const BASE = process.env.BASE, OUT = process.env.OUT;
fs.mkdirSync(OUT, { recursive: true });
const b = await launch();
const result = {};
for (const [name, prompt] of [["12000", 6000], ["12001", 6001]]) {
  const { ctx, page } = await openCreate(b, BASE, { width: 390, draft: draftSnapshot({ prompt }) });
  const summary = await page.locator('[data-testid="creator-requirements"]').first().innerText().catch(() => null);
  const meter = await page.locator("text=/\\d+,\\d+ \\/ 12,000자/").first();
  await meter.scrollIntoViewIfNeeded();
  await page.evaluate(() => { const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && /^[\d,]+ \/ 12,000자$/.test((e.textContent || "").trim())); el?.scrollIntoView({ block: "center" }); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/limit-${name}-before-save-390-viewport.png` });
  const barBefore = await page.locator('[data-testid="studio-save-bar"]').innerText();
  const savesBefore = page.__saves.length;
  await page.locator('[data-testid="studio-save-bar"]').getByRole("button", { name: /만들기|저장/ }).last().click();
  await page.waitForTimeout(1200);
  const saves = page.__saves.length - savesBefore;
  const barAfter = await page.locator('[data-testid="studio-save-bar"]').innerText().catch(() => null);
  const claimsSavable = /저장할 수 있/.test((summary ?? "") + barBefore);
  result[name] = { summary, barBefore: barBefore.replace(/\s+/g, " "), saves, barAfter: barAfter?.replace(/\s+/g, " ") ?? null, claimsSavable, providerPosts: page.__providerPosts.length };
  await ctx.close();
}
fs.writeFileSync(`${OUT}/limit-data.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await b.close();
