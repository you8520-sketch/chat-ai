import fs from "fs";
import { launch, openPage, fx } from "./e44-lib.mjs";

const [base, label, outRoot = "/tmp/e44-shots", onlyArg = ""] = process.argv.slice(2);
const only = onlyArg ? new Set(onlyArg.split(",")) : null;
const U = fx.users;
const PAGES = [
  ["home-guest", "/", null],
  ["new", "/tab/new", null],
  ["ranking", "/tab/ranking", null],
  ["search", "/search?q=%EC%83%88%EB%B2%BD", null],
  ["creator-public", `/creator/${U.creatorA}`, null],
  ["points", "/points", "safe"],
  ["settings", "/settings", "safe"],
  ["persona", "/persona", "safe"],
  ["chats", "/chats", "safe"],
  ["studio", "/studio", "creatorA"],
  ["creator-dash", "/creator", "creatorA"],
  ["create", "/create", "creatorA"],
];

const b = await launch();
const out = {};
for (const [name, path, user] of PAGES) {
  if (only && !only.has(name)) continue;
  for (const width of [390, 1440]) {
    const { ctx, page } = await openPage(b, base, { path, user, width, wait: 700 });
    const dlg = page.locator('[role="dialog"][aria-labelledby="home-popup-notice-title"]');
    if (await dlg.count()) {
      await page.keyboard.press("Escape");
      if (await dlg.count()) await dlg.getByRole("button", { name: "확인" }).click();
    }
    await page.evaluate(() => { document.activeElement?.blur?.(); scrollTo(0, 0); });
    const stops = [];
    for (let i = 0; i < 70; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(40);
      const s = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
        const cy = r.top + Math.min(r.height / 2, 12);
        const top = document.elementFromPoint(cx, Math.min(Math.max(cy, 1), innerHeight - 1));
        const offscreen = r.bottom < 0 || r.top > innerHeight;
        const covered = !offscreen && top && !(el.contains(top) || top.contains(el));
        const cs = getComputedStyle(el);
        const ring = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== "none";
        return {
          tag: el.tagName,
          text: (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim().slice(0, 22),
          covered: Boolean(covered),
          coveredBy: covered ? `${top.tagName}.${String(top.className).slice(0, 30)}` : null,
          offscreen,
          ring,
          rectTop: Math.round(r.top),
          rectBottom: Math.round(r.bottom),
        };
      });
      if (s) stops.push(s);
    }
    out[`${name}-${width}`] = {
      stops: stops.length,
      covered: stops.filter((s) => s.covered),
      offscreen: stops.filter((s) => s.offscreen).length,
      noRing: stops.filter((s) => !s.ring).map((s) => `${s.tag}:${s.text}`).slice(0, 8),
    };
    console.log(name, width, stops.length, "covered", out[`${name}-${width}`].covered.length, "noRing", out[`${name}-${width}`].noRing.length);
    await ctx.close();
  }
}
fs.mkdirSync(`${outRoot}/${label}`, { recursive: true });
fs.writeFileSync(`${outRoot}/${label}/focus.json`, JSON.stringify(out, null, 1));
await b.close();
