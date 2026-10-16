import fs from "fs";
import { launch, openPage, measure, snap, db, fx } from "./e44-lib.mjs";
const [base, label, outRoot = "/tmp/e44-shots"] = process.argv.slice(2);
const dir = `${outRoot}/${label}/long`;
fs.mkdirSync(dir, { recursive: true });
const d = db();
const longNick = "아주아주긴닉네임을가진사용자의이름이한줄을넘어가는경우테스트입니다만글자";
d.prepare("UPDATE users SET nickname=?, points=? WHERE id=?").run(longNick, 1234567890, fx.users.safe);
d.close();
const b = await launch();
const out = {};
const scenes = [
  ["home", "/", "safe"], ["points", "/points", "safe"], ["settings", "/settings", "safe"], ["chats", "/chats", "safe"],
  ["creator-long", `/creator/${fx.users.creatorLong}`, null], ["studio-long", "/studio", "creatorLong"], ["dash-long", "/creator", "creatorLong"], ["persona", "/persona", "safe"],
];
for (const [name, path, user] of scenes) {
  for (const width of [360, 1440]) {
    const { ctx, page } = await openPage(b, base, { path, user, width, wait: 700 });
    const dlg = page.locator('[role="dialog"][aria-labelledby="home-popup-notice-title"]');
    if (await dlg.count()) { await page.keyboard.press("Escape"); if (await dlg.count()) await dlg.getByRole("button", { name: "확인" }).click(); }
    const m = await measure(page);
    const extra = await page.evaluate(() => {
      const hdr = document.querySelector("header").getBoundingClientRect();
      const over = [];
      for (const el of document.querySelectorAll("header *, main *")) {
        const cs = getComputedStyle(el);
        if (el.children.length) continue;
        if (!el.textContent.trim()) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "visible" && cs.textOverflow !== "ellipsis") over.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 24), sw: el.scrollWidth, cw: el.clientWidth });
        if (over.length > 5) break;
      }
      return { headerH: Math.round(hdr.height), over, h: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    out[`${name}-${width}`] = { hOverflow: m.hOverflow, clipped: m.outOfViewport, ...extra };
    await snap(page, `${dir}/${name}-${width}.png`);
    await ctx.close();
    console.log(name, width, JSON.stringify({ h: m.hOverflow, headerH: extra.headerH, over: extra.over.length, clipped: m.outOfViewport.length }));
  }
}
fs.writeFileSync(`${outRoot}/${label}/long.json`, JSON.stringify(out, null, 1));
await b.close();
