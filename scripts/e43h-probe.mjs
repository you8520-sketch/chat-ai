import { chromium } from "playwright-core";
import fs from "fs";
const BASE = process.env.BASE ?? "http://localhost:3105";
const fx = JSON.parse(fs.readFileSync("/tmp/e43h-fixtures.json", "utf8"));
const MARK = ["ZZNSFW_NAME", "ZZNARR_NSFW", "ZZQUOTE_NSFW", "ZZCHAT_TITLE_NSFW", "🔞", "ZZSECOND_IMG_SECRET", "daf5931a", "ZZNSFW_TAGLINE", "ZZNSFW_NOIMG", "ZZNARR_NOIMG", "official-pilot-rf-v4-03"];
const b = await chromium.launch();
const out = {};
for (const user of Object.keys(fx.tokens)) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  const imgReqs = [];
  p.on("request", (r) => { if (r.url().includes("/uploads/")) imgReqs.push(r.url().replace(BASE, "")); });
  const res = await p.goto(BASE + "/settings", { waitUntil: "load" });
  await p.waitForTimeout(1200);
  const html = await res.text();
  const rows = await p.$$eval('aside a[data-trpg-recent-kind="character_chat"]', (as) => as.map((a) => ({
    href: a.getAttribute("href"), title: a.getAttribute("title"), text: a.innerText,
    attrs: [...a.attributes].map((x) => `${x.name}=${x.value}`).filter((s) => s.startsWith("data-")),
    imgs: [...a.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src"), cls: i.className })),
    emoji: a.querySelector("span > span")?.textContent ?? null,
    html: a.outerHTML,
  })));
  const snap = await p.locator('aside a[data-trpg-recent-kind="character_chat"]').evaluateAll((as) => as.map((a) => a.textContent));
  const aria = [];
  for (const r of await p.locator('aside a[data-trpg-recent-kind="character_chat"]').all()) aria.push(await r.ariaSnapshot());
  const scan = {};
  for (const m of MARK) scan[m] = { ssrHtml: html.split(m).length - 1 };
  // full document incl. inlined RSC flight
  const full = await p.content();
  const flight = await p.evaluate(() => (self.__next_f ?? []).map((x) => x[1]).join(""));
  for (const m of MARK) { scan[m].dom = full.split(m).length - 1; scan[m].flight = flight.split(m).length - 1; }
  out[user] = { rows, aria, scan, imgReqs, canAccess: user };
  await ctx.close();
}
await b.close();
fs.writeFileSync("/tmp/e43h-probe.json", JSON.stringify(out, null, 1));
for (const [u, o] of Object.entries(out)) {
  console.log(`\n=== ${u} ===`);
  console.log("scan(ssrHtml/dom/flight):", Object.entries(o.scan).map(([k, v]) => `${k}=${v.ssrHtml}/${v.dom}/${v.flight}`).join("  "));
  console.log("uploads requested:", [...new Set(o.imgReqs)].join(", "));
  for (const r of o.rows) console.log(JSON.stringify({ href: r.href, title: r.title, text: r.text, data: r.attrs, imgs: r.imgs, emoji: r.emoji }));
  o.aria.forEach((a) => console.log("aria:", a.replace(/\n/g, " | ")));
}
