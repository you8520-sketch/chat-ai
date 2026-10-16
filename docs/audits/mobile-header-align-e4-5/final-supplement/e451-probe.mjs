import { launch, openPage } from "/workspace/scripts/e44-lib.mjs";
const [base, label] = process.argv.slice(2);
const browser = await launch();
const rows = [];
for (const w of [360, 390, 575, 576]) {
  for (const bal of ["2,000P", "200,000P", "123,456,789P"]) {
    for (const badge of ["0", "99+"]) {
      const { ctx, page } = await openPage(browser, base, { path: "/search", user: "safe", width: w, wait: 500 });
      const r = await page.evaluate(({ bal, badge }) => {
        const px = (v) => Math.round(v * 10) / 10;
        const pill = document.querySelector('header.site-header [aria-label^="보유 포인트"]');
        const t = pill?.querySelector("span");
        if (t) t.textContent = bal;
        const bell = document.querySelector('header.site-header [aria-label*="알림"]');
        const b = bell?.querySelector("span");
        if (badge === "99+" && b) b.textContent = "99+";
        const top = document.querySelector("header.site-header").children[0];
        const logo = top.querySelector('a[aria-label$="홈"]');
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { l: px(r.left), r: px(r.right), w: px(r.width) } : null; };
        const right = top.children[1];
        const items = {};
        items.logo = box(logo);
        items.bell = box(bell);
        items.toggle = box(top.querySelector('button[aria-label="세이프티 필터"]'));
        items.pill = box(pill);
        items.shop = box(top.querySelector('a[href="/points"]'));
        items.profile = box([...top.querySelectorAll("button")].find((x) => x.closest(".min-\\[576px\\]\\:block")));
        const list = Object.entries(items).filter(([, v]) => v);
        const overlaps = [];
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const [an, a] = list[i], [bn, bb] = list[j];
          const ov = Math.min(a.r, bb.r) - Math.max(a.l, bb.l);
          if (ov > 0.5) overlaps.push(`${an}/${bn}:${px(ov)}`);
        }
        const maxR = Math.max(...list.map(([, v]) => v.r));
        return { items, overlaps, offRight: px(maxR - document.documentElement.clientWidth), pillText: t?.textContent, rightBox: box(right) };
      }, { bal, badge });
      rows.push({ w, bal, badge, ...r });
      await ctx.close();
    }
  }
}
await browser.close();
for (const r of rows) {
  const f = (k) => r.items[k] ? `${k}:${r.items[k].l}-${r.items[k].r}` : `${k}:-`;
  console.log(`${label} w=${r.w} ${r.bal.padEnd(13)} badge=${r.badge.padEnd(3)} | ${["logo","bell","toggle","pill","shop","profile"].map(f).join(" ")} | overlap=${r.overlaps.join(",")||"none"} offRight=${r.offRight}`);
}
