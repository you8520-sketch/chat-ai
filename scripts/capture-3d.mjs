import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (msg) => logs.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`));
  page.on("pageerror", (err) => logs.push(`[pageerror] ${err.message.slice(0, 300)}`));
  page.on("response", (res) => { if (res.status() >= 400) logs.push(`[${res.status()}] ${res.url().slice(0, 200)}`); });
  page.on("requestfailed", (req) => logs.push(`[reqfail] ${req.url().slice(0, 200)} ${req.failure()}`));
  await page.goto("http://localhost:3000/trpg/dice-lab?renderer=dice-box-threejs", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-trpg-dice-lab-prose]');
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => {
    const proto = document.querySelector("[data-trpg-dice-lab-proto]");
    const canvas3d = document.querySelector('[data-trpg-dice-canvas="3d"]');
    const allDivs = document.querySelectorAll("div[id^='trpg-dice-box']");
    return {
      hasProto: !!proto,
      protoVal: proto?.getAttribute("data-trpg-dice-lab-proto"),
      hasCanvas3d: !!canvas3d,
      boxDivs: allDivs.length,
    };
  });
  console.log("info:", JSON.stringify(info));
  console.log("all logs:", logs.join("\n"));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
