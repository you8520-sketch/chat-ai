import fs from "fs";
import { chromium } from "playwright-core";
const base = "https://hav.chat";
const outRoot = process.argv[2] ?? "/tmp/e44-shots";
const dir = `${outRoot}/prod`;
fs.mkdirSync(dir, { recursive: true });
const b = await chromium.launch();
const pages = [["home", "/"], ["new", "/tab/new"], ["ranking", "/tab/ranking"], ["search", "/search?q=a"], ["creator-1", "/creator/1"], ["login", "/login"]];
const out = {};
for (const [name, path] of pages) {
  for (const width of [390, 1440]) {
    const ctx = await b.newContext({ viewport: { width, height: width < 576 ? 844 : 900 }, isMobile: width < 576, hasTouch: width < 576, deviceScaleFactor: width < 576 ? 2 : 1, locale: "ko-KR", reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const nonGet = [];
    await page.route("**/*", (route) => {
      const r = route.request();
      if (!["GET", "HEAD"].includes(r.method())) { nonGet.push(r.method() + " " + new URL(r.url()).pathname); return route.abort(); }
      return route.continue();
    });
    const resp = await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(2200);
    const m = await page.evaluate(() => ({
      status: performance.getEntriesByType("navigation")[0].responseStatus,
      h: document.documentElement.scrollWidth > innerWidth + 1,
      dialog: Boolean(document.querySelector('[role="dialog"]')),
      dialogControls: [...document.querySelectorAll('[role="dialog"] button')].map((e) => { const r = e.getBoundingClientRect(); return `${e.textContent.trim().slice(0, 8)}:${Math.round(r.width)}x${Math.round(r.height)}`; }),
      title: document.title,
      h1: document.querySelector("h1")?.textContent?.trim().slice(0, 30),
      nav: [...document.querySelectorAll("nav a[aria-current='page']")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()),
    }));
    await page.screenshot({ path: `${dir}/${name}-${width}.png` });
    out[`${name}-${width}`] = { status: resp.status(), ...m, nonGetBlocked: nonGet };
    console.log(name, width, JSON.stringify(out[`${name}-${width}`]));
    await ctx.close();
  }
}
fs.writeFileSync(`${dir}/results.json`, JSON.stringify(out, null, 1));
await b.close();
