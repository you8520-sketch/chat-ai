import { chromium } from "playwright-core";
import { fx } from "./e44-lib.mjs";
const base = process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
await ctx.addCookies([{ name: "session", value: fx.tokens.creatorA, url: base }]);
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__log = [];
  const snap = (t) => { const f = document.querySelector(".site-legal-footer"); const m = document.querySelector("main"); window.__log.push({ t, footerTop: f && Math.round(f.getBoundingClientRect().top), mainH: m && Math.round(m.getBoundingClientRect().height), docH: document.documentElement.scrollHeight, text: (document.querySelector('[data-testid="studio-page-shell"]') ? "shell" : "noshell") + (document.body.innerText.includes("불러오는 중") ? "+fallback" : "") + "|rs=" + document.readyState }); };
  let n=0; const tick=()=>{ snap(Math.round(performance.now())); if(n++<400) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
});
await page.goto(base + "/studio", { waitUntil: "load" });
await page.waitForTimeout(1500);
const log = await page.evaluate(() => window.__log);
let prev = "";
for (const l of log) { const s = `${l.footerTop}|${l.mainH}|${l.docH}|${l.text}`; if (s !== prev) console.log(l.t, s); prev = s; }
await b.close();
