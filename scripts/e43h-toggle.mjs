import { chromium } from "playwright-core";
import fs from "fs";
const BASE = process.env.BASE;
const fx = JSON.parse(fs.readFileSync("/tmp/e43h-fixtures.json", "utf8"));
const SENS = ["ZZNSFW_NAME", "ZZNSFW_NOIMG", "ZZNARR_NSFW", "ZZNARR_NOIMG", "ZZNARR_BRANCH", "ZZQUOTE_NSFW", "ZZQUOTE_NOIMG", "ZZQUOTE_BRANCH", "ZZCHAT_TITLE_NSFW", "ZZCHAT_TITLE_NOIMG", "🔞", "ZZSECOND_IMG_SECRET", "official-pilot-rf-v4-03"];
const leaks = (t) => SENS.reduce((n, m) => n + (t.split(m).length - 1), 0);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
await ctx.addCookies([{ name: "session", value: fx.tokens.adminOn, url: BASE }]);
const p = await ctx.newPage();
let phase = "initial-ON";
const rsc = [];
p.on("response", async (r) => {
  const ct = r.headers()["content-type"] ?? "";
  if (ct.includes("text/x-component")) { try { rsc.push({ phase, url: r.url().replace(BASE, "").split("?")[0], leaks: leaks(await r.text()) }); } catch {} }
});
await p.goto(BASE + "/chats", { waitUntil: "load" }); await p.waitForTimeout(1500);
const btn = p.getByRole("button", { name: "세이프티 필터" });
const flip = async (name) => { phase = name; const w = p.waitForResponse((r) => r.url().includes("/api/settings") && r.request().method() === "PATCH"); await btn.click(); await w; await p.waitForTimeout(2000); };
await flip("toggling-to-OFF");
const mid = leaks(await p.locator("aside").first().innerHTML()) + leaks(await p.locator("main").innerHTML());
await flip("toggling-to-ON");
const end = leaks(await p.locator("aside").first().innerHTML()) + leaks(await p.locator("main").innerHTML()) + leaks(await p.evaluate(() => (self.__next_f ?? []).map((x) => x[1]).join("")));
const byPhase = {};
for (const x of rsc) { byPhase[x.phase] ??= { responses: 0, leaks: 0 }; byPhase[x.phase].responses++; byPhase[x.phase].leaks += x.leaks; }
console.log(JSON.stringify({ domLeaksWhileOFF: mid, domPlusFlightLeaksAfterBackToON: end, rscByPhase: byPhase, rscDetail: rsc }, null, 1));
await b.close();
