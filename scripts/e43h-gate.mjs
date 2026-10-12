import { chromium } from "playwright-core";
import fs from "fs";
const BASE = process.env.BASE;
const TAG = process.env.TAG;
const fx = JSON.parse(fs.readFileSync("/tmp/e43h-fixtures.json", "utf8"));
const SENS = ["ZZNSFW_NAME", "ZZNSFW_NOIMG", "ZZNARR_NSFW", "ZZNARR_NOIMG", "ZZNARR_BRANCH", "ZZQUOTE_NSFW", "ZZQUOTE_NOIMG", "ZZQUOTE_BRANCH", "ZZCHAT_TITLE_NSFW", "ZZCHAT_TITLE_NOIMG", "🔞", "ZZSECOND_IMG_SECRET", "official-pilot-rf-v4-03", `/chat/${fx.nsfwId}`, `/chat/${fx.nsfwId + 1}`];
const count = (text, m) => text.split(m).length - 1;
const scan = (text) => Object.fromEntries(SENS.map((m) => [m, count(text, m)]).filter(([, n]) => n > 0));
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const b = await chromium.launch();
const out = {};
for (const user of ["std", "adultflag", "adminOn", "adminOff"]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "ko-KR" });
  await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  const uploads = [];
  p.on("request", (r) => { if (r.url().includes("/uploads/")) uploads.push(new URL(r.url()).pathname); });
  const rec = { user };
  // sidebar (any page)
  for (const route of ["/settings", "/chats"]) {
    const res = await p.goto(BASE + route, { waitUntil: "load" });
    await p.waitForTimeout(1200);
    const ssr = await res.text();
    const flight = await p.evaluate(() => (self.__next_f ?? []).map((x) => x[1]).join(""));
    const dom = await p.content();
    const aside = {
      rows: await p.$$eval('aside a[data-trpg-recent-kind="character_chat"]', (as) => as.map((a) => ({ href: a.getAttribute("href"), title: a.getAttribute("title"), text: a.innerText.replace(/\n/g, " | "), data: [...a.attributes].filter((x) => x.name.startsWith("data-chat-resume")).map((x) => x.name), img: a.querySelectorAll("img").length }))),
    };
    const asideAria = [];
    for (const l of await p.locator('aside a[data-trpg-recent-kind="character_chat"]').all()) asideAria.push((await l.ariaSnapshot()).replace(/\n/g, " "));
    rec[route] = { ssr: scan(ssr), flight: scan(flight), dom: scan(dom), aside, asideAria };
    if (route === "/chats") {
      const cards = await p.$$eval(".chats-page-grid article", (as) => as.map((a) => ({
        text: a.innerText.replace(/\n+/g, " / "),
        attrs: [...a.querySelectorAll("[title],[aria-label],[alt]")].map((e) => e.getAttribute("title") || e.getAttribute("aria-label") || e.getAttribute("alt")),
        hrefs: [...a.querySelectorAll("a")].map((e) => e.getAttribute("href")),
        imgs: [...a.querySelectorAll("img")].map((e) => e.getAttribute("src")),
      })));
      rec.cards = cards;
      // open branch modal of the NSFW group (cards that carry the 성인 badge)
      const adult = p.locator(".chats-page-grid article", { hasText: "성인" });
      const n = await adult.count();
      rec.adultCards = n;
      rec.modals = [];
      for (let i = 0; i < n; i++) {
        await adult.nth(i).locator("button", { hasText: "대화 선택" }).click();
        await p.waitForSelector('[role="dialog"]');
        const dlg = p.locator('[role="dialog"]').first();
        const html = await dlg.innerHTML();
        rec.modals.push({
          scan: scan(html), text: (await dlg.innerText()).replace(/\n+/g, " / "),
          hrefs: await dlg.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href"))),
          buttons: await dlg.locator("button").allInnerTexts(),
          aria: (await dlg.ariaSnapshot()).replace(/\n/g, " "),
        });
        await dlg.getByRole("button", { name: "닫기" }).click();
      }
    }
  }
  rec.uploads = [...new Set(uploads)];
  out[user] = rec;
  await ctx.close();
}
await b.close();
fs.writeFileSync(`/tmp/e43h-gate-${TAG}.json`, JSON.stringify(out, null, 1));
for (const [u, r] of Object.entries(out)) {
  console.log(`\n=== ${TAG} / ${u} ===`);
  for (const route of ["/settings", "/chats"]) {
    const x = r[route];
    console.log(`${route}: leaks ssr=${sum(x.ssr)} flight=${sum(x.flight)} dom=${sum(x.dom)}`, JSON.stringify(x.flight));
    x.aside.rows.forEach((row) => console.log("  row", JSON.stringify(row)));
    x.asideAria.forEach((a) => console.log("  aria", a));
  }
  r.cards.forEach((c) => console.log("  card", c.text, "| attrs:", JSON.stringify(c.attrs), "| hrefs:", JSON.stringify(c.hrefs), "| imgs:", JSON.stringify(c.imgs)));
  r.modals.forEach((m, i) => console.log(`  modal#${i} leaks=${sum(m.scan)}`, JSON.stringify(m.scan), "|", m.text, "| hrefs:", JSON.stringify(m.hrefs), "| btns:", JSON.stringify(m.buttons)));
  console.log("  uploads requested:", r.uploads.join(", "));
}
