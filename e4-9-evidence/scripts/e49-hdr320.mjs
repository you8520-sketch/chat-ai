import fs from "fs";
import { launch, openPage } from "./e44-lib.mjs";
const [offBase, onBase, label] = process.argv.slice(2);
fs.mkdirSync(`/tmp/e49/${label}`, { recursive: true });
const b = await launch();
const rows = [];
for (const [pay, base] of [["OFF", offBase], ["ON", onBase]]) {
  for (const width of [320, 360, 375]) {
    for (const balance of ["0P", "2,000P", "200,000P", "1,234,567P", "123,456,789P"]) {
      for (const badge of ["0", "1", "99+"]) {
        for (const safety of ["ON", "OFF"]) {
          const { page, ctx } = await openPage(b, base, { path: "/tab/ranking", user: "safe", width, height: 740, wait: 350, until: "domcontentloaded" });
          const r = await page.evaluate(({ balance, badge, safety }) => {
            const top = document.querySelector("header.site-header").children[0];
            const points = top.querySelector('[aria-label^="보유 포인트"]');
            const pt = points && (points.querySelector("span") ?? points);
            if (pt) pt.textContent = balance;
            const bellBtn = top.querySelector('button[aria-label^="알림"]');
            const badgeEl = bellBtn && bellBtn.querySelector("span");
            if (badgeEl) { if (badge === "0") badgeEl.style.display = "none"; else badgeEl.textContent = badge; }
            const toggle = top.querySelector('button[aria-label="세이프티 필터"]');
            const st = toggle && [...toggle.querySelectorAll("span")].find((s) => /^(ON|OFF)$/.test(s.textContent.trim()));
            if (st) st.textContent = safety;
            const els = [...top.querySelectorAll("a,button")].filter((e) => e.getBoundingClientRect().width > 0 && !e.closest("nav"));
            const items = els.map((e) => { const b = e.getBoundingClientRect(); return { n: (e.getAttribute("aria-label") || e.textContent.trim()).slice(0, 12), l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, t: b.top, b: b.bottom }; });
            const overlaps = [];
            for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
              const a = items[i], c = items[j];
              const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l), oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
              if (ox > 1 && oy > 1) overlaps.push([a.n, c.n, Math.round(ox)]);
            }
            return { overlaps, offRight: items.filter((i) => i.r > innerWidth + 0.5).map((i) => i.n), overflow: document.documentElement.scrollWidth > innerWidth + 1, hasShop: !!top.querySelector('a[href="/points"]') };
          }, { balance, badge, safety });
          rows.push({ pay, width, balance, badge, safety, ...r });
          await ctx.close();
        }
      }
    }
  }
}
fs.writeFileSync(`/tmp/e49/${label}/hdr320.json`, JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => r.overlaps.length || r.offRight.length || r.overflow);
console.log("rows", rows.length, "problem rows", bad.length, "shop link seen ON:", rows.filter((r) => r.pay === "ON" && r.hasShop).length > 0);
const group = {};
for (const r of bad) { const k = `pay${r.pay} w${r.width} bal=${r.balance}`; group[k] = (group[k] || 0) + 1; }
console.log(JSON.stringify(group, null, 1));
console.log(JSON.stringify(bad.slice(0, 3)));
await b.close();
