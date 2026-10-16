import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
const [base, label, outRoot = "/tmp/e44-shots", shotArg = ""] = process.argv.slice(2);
const dir = `${outRoot}/fix/${label}`;
fs.mkdirSync(dir, { recursive: true });
const b = await launch();
const out = {};

// D1: home notice dialog on a phone, with button boxes outlined
{
  const { ctx, page } = await openPage(b, base, { path: "/", width: 390, wait: 700 });
  const dlg = page.getByRole("dialog");
  const info = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const q = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
    const close = d.querySelector('button[aria-label="공지 닫기"]');
    const ok = [...d.querySelectorAll("button")].find((x) => x.textContent.trim() === "확인");
    const label = d.querySelector("label");
    [close, ok, label].forEach((el) => { el.style.outline = "2px solid #f43f5e"; el.style.outlineOffset = "-2px"; });
    return { close: q(close), confirm: q(ok), checkbox: q(label), focused: document.activeElement?.textContent?.trim() };
  });
  out.d1 = info;
  await page.screenshot({ path: `${dir}/d1-notice-390.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  out.d1.closedByEscape = (await dlg.count()) === 0;
  await ctx.close();
}

// D3: 제작 menu state on work screens
for (const [tag, path] of [["create", "/create"], ["my-characters", "/my-characters"], ["creator-dash", "/creator"]]) {
  const { ctx, page } = await openPage(b, base, { path, user: "creatorA", width: 390, wait: 700 });
  out[`d3-${tag}`] = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="모바일 메뉴"] a')].map((a) => `${a.textContent.trim()}:${a.getAttribute("aria-current") ?? "-"}`).join(" "));
  await page.screenshot({ path: `${dir}/d3-${tag}-390.png`, clip: { x: 0, y: 844 - 130, width: 390, height: 130 } });
  await ctx.close();
}

// D2: keyboard Tab across /studio until a stop sits under fixed chrome (main) / same stop index (fix)
{
  const { ctx, page } = await openPage(b, base, { path: "/studio", user: "creatorA", width: 390, wait: 700, reduced: "reduce" });
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const rc = el.getBoundingClientRect();
      const nav = document.querySelector(".mobile-bottom-nav")?.getBoundingClientRect();
      const hd = document.querySelector(".site-header")?.getBoundingClientRect();
      const under = (c) => !!c && !el.closest(".site-header,.mobile-bottom-nav") && rc.top < c.bottom - 1 && rc.bottom > c.top + 1;
      return { label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24), top: Math.round(rc.top), bottom: Math.round(rc.bottom), under: under(hd) || under(nav) };
    });
    rows.push(r);
    if (r?.under && !out.firstUnder) {
      out.firstUnder = i;
      if (!shotArg) await page.screenshot({ path: `${dir}/d2-studio-covered-390.png` });
    }
    if (shotArg && i === Number(shotArg)) await page.screenshot({ path: `${dir}/d2-studio-covered-390.png` });
  }
  out.d2 = { firstUnder: out.firstUnder, stops: rows.length, underChrome: rows.filter((r) => r?.under).map((r) => r.label) };
  await ctx.close();
}
fs.writeFileSync(`${dir}/fix.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await b.close();
