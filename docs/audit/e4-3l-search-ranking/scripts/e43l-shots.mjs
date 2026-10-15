import fs from "fs";
import { launch, openPage, measure, snap, settle, db, fx } from "./e43l-lib.mjs";

const [base, label, outRoot = "/tmp/e43l-shots"] = process.argv.slice(2);
const b = await launch();
const results = {};
const failures = [];
const enc = encodeURIComponent;
const LONGQ = "새벽의 끝에서 아주 오래된 도서관의 마지막 사서가 되어 잊혀진 이야기".slice(0, 40);

function idsOf(page) {
  return page.evaluate(() => {
    const seen = [];
    for (const a of document.querySelectorAll("main a[href]")) {
      const m = decodeURIComponent(a.getAttribute("href")).match(/\/character\/(\d+)/);
      if (m && !seen.includes(Number(m[1]))) seen.push(Number(m[1]));
    }
    return seen;
  });
}
function metricsOf(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("main ol > li")].map((li) => {
      const a = li.querySelector("a[href]");
      const m = a ? decodeURIComponent(a.getAttribute("href")).match(/\/character\/(\d+)/) : null;
      const t = li.textContent || "";
      const nums = [...t.matchAll(/[\d,]{1,9}/g)].map((x) => x[0].replace(/,/g, ""));
      return { id: m ? Number(m[1]) : null, text: t.replace(/\s+/g, " ").slice(0, 160), nums };
    });
    return rows;
  });
}

async function scene(name, o, extra) {
  const { path, user = null, width = 390, full = true, file = name, sub = "", shot = true } = o;
  const t0 = Date.now();
  try {
    const { ctx, page } = await openPage(b, base, { path, user, width, wait: o.wait ?? 700 });
    if (extra) await extra(page);
    const m = await measure(page);
    const ids = await idsOf(page);
    const rec = { path, user, width, ...m, ids, errors: page.__errors.slice(0, 3), external: page.__external.length };
    if (o.metrics) rec.rows = await metricsOf(page);
    if (shot) await snap(page, `${outRoot}/${label}/${width}/${file}.png`, { full });
    if (o.after) rec.after = await o.after(page);
    results[`${name}-${width}`] = rec;
    await ctx.close();
    console.log("ok", name, width, Date.now() - t0, "ms");
  } catch (e) {
    failures.push(`${name}-${width}: ${String(e).slice(0, 160)}`);
    console.log("FAIL", name, width, String(e).slice(0, 160));
  }
}

const ALL = [360, 390, 768, 1440];
const q = (s) => `/search?q=${enc(s)}`;

for (const w of ALL) {
  await scene("s01-initial", { path: "/search", width: w, file: "s01-search-initial", full: false });
  await scene("s02-results", { path: q("새벽"), width: w, file: "s02-search-results-full" });
  await scene("r01-all", { path: "/tab/ranking", width: w, file: "r01-ranking-all-full", metrics: true });
}
await scene("s02-results-first", { path: q("새벽"), width: 390, full: false, file: "s02-search-results-first" });
await scene("s02-results-admin", { path: q("새벽"), user: "admin", width: 390, file: "s07-search-badges-admin-full" });
await scene("s02-results-admin", { path: q("새벽"), user: "admin", width: 1440, file: "s07-search-badges-admin-full" });
await scene("s03-genre", { path: `/search?g=${enc("판타지")}`, width: 390, file: "s03-search-genre-full" });
await scene("s03-genre", { path: `/search?g=${enc("판타지")}`, width: 1440, file: "s03-search-genre-full" });
await scene("s03-q-genre", { path: `/search?q=${enc("새벽")}&g=${enc("로맨스")}`, user: "admin", width: 390, file: "s03-search-q-genre-full" });
await scene("s03-tag", { path: q("다정"), width: 390, full: false, file: "s03-search-tag-selected" });
await scene("s03-genre-late", { path: `/search?g=${enc("센티넬버스")}`, width: 390, full: false, file: "s03-search-genre-last-selected" });
await scene("s04-empty-q", { path: q("존재하지않는검색어"), width: 390, file: "s04-search-empty-query" });
await scene("s04-empty-combo", { path: `/search?q=${enc("새벽")}&g=${enc("무협")}`, width: 390, file: "s04-search-empty-combo" });
await scene("s04-empty-genre", { path: `/search?g=${enc("GL")}`, width: 390, file: "s04-search-empty-genre" });
await scene("s04-empty-q", { path: q("존재하지않는검색어"), width: 1440, file: "s04-search-empty-query" });
await scene("s05-long", { path: q(LONGQ), width: 390, file: "s05-search-long-query" });
await scene("s05-long", { path: q(LONGQ), width: 360, file: "s05-search-long-query" });
await scene("s05-long-creator", { path: q("길이테스트"), width: 360, file: "s05-search-long-name-creator" });
await scene("s06-cap", { path: q("판타지"), width: 390, file: "s06-search-cap-full" });
await scene("s06-cap-top", { path: q("판타지"), width: 390, full: false, file: "s06-search-cap-top" });
await scene("s06-cap", { path: q("판타지"), width: 1440, file: "s06-search-cap-full" });
await scene("s06-one", { path: q("궤도 정거장"), width: 390, file: "s06-search-one-result" });

await scene("s08-focus", { path: q("새벽"), width: 390, full: false, file: "s08-search-keyboard-focus" }, async (page) => {
  await page.keyboard.press("Tab");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
});
await scene("s08-typing", { path: "/search", width: 390, full: false, file: "s08-search-typing-with-clear" }, async (page) => {
  await page.fill('input[type="search"]', "새벽의 도서관");
});

for (const p of ["realtime", "daily", "weekly", "monthly"]) {
  await scene(`r02-${p}`, { path: `/tab/ranking?p=${p}`, width: 390, file: `r02-ranking-${p}-full`, metrics: true });
}
await scene("r02-realtime", { path: "/tab/ranking?p=realtime", width: 1440, file: "r02-ranking-realtime-full", metrics: true });
await scene("r02-weekly", { path: "/tab/ranking?p=weekly", width: 360, file: "r02-ranking-weekly-full", metrics: true });
await scene("r03-top3", { path: "/tab/ranking", width: 390, full: false, file: "r03-ranking-top3-boundary" }, async (page) => {
  await page.evaluate(() => document.querySelector("main ol")?.scrollIntoView({ block: "start" }));
  await page.evaluate(() => scrollBy(0, 300));
});
await scene("r03-top3-pc", { path: "/tab/ranking", width: 1440, full: false, file: "r03-ranking-top3-boundary" }, async (page) => {
  await page.evaluate(() => document.querySelector("main ol")?.scrollIntoView({ block: "start" }));
});
await scene("r04-admin", { path: "/tab/ranking", user: "admin", width: 390, file: "r04-ranking-admin-adult-full", metrics: true });
await scene("r04-safe", { path: "/tab/ranking", user: "safe", width: 390, file: "r04-ranking-loggedin-full", metrics: true });
await scene("r04-male", { path: "/tab/ranking?p=weekly", user: "maleViewer", width: 390, file: "r04-ranking-pref-male-full", metrics: true });
await scene("r04-all-768", { path: "/tab/ranking?p=weekly", width: 768, file: "r02-ranking-weekly-full", metrics: true });
await scene("r07-focus", { path: "/tab/ranking", width: 390, full: false, file: "r07-ranking-keyboard-focus" }, async (page) => {
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
});

// ----- mutation scenes (fixture DB only); reseed afterwards -----
const conn = db();
const rankIds = fx.rank;
conn.prepare("DELETE FROM chats WHERE created_at >= datetime('now','-6 hours') AND user_id IN (SELECT id FROM users WHERE email LIKE '%@e43l.local')").run();
conn.close();
await scene("r05-empty-realtime", { path: "/tab/ranking?p=realtime", width: 390, file: "r05-ranking-empty-realtime" });
await scene("r05-empty-realtime", { path: "/tab/ranking?p=realtime", width: 1440, file: "r05-ranking-empty-realtime" });
const hide = (keep) => {
  const c = db();
  c.prepare("UPDATE characters SET visibility='private', official=0 WHERE tagline LIKE '[e43l]%' AND id NOT IN (" + keep.map(() => "?").join(",") + ")").run(...keep);
  c.close();
};
const conn2 = db();
const allIds = conn2.prepare("SELECT id FROM characters WHERE tagline LIKE '[e43l]%' AND official=0 AND nsfw=0 AND moderation_status='approved' AND visibility='public' ORDER BY total_turns DESC, likes DESC").all().map((r) => r.id);
conn2.close();
hide(allIds.slice(0, 3));
fs.writeFileSync("/tmp/e43l-keep3.json", JSON.stringify(allIds.slice(0, 3)));
await scene("r06-three", { path: "/tab/ranking", width: 390, file: "r06-ranking-three-items", metrics: true });
hide(allIds.slice(0, 1));
await scene("r06-one", { path: "/tab/ranking", width: 390, file: "r06-ranking-one-item", metrics: true });
hide([]);
await scene("r05-empty-all", { path: "/tab/ranking", width: 390, file: "r05-ranking-empty-all" });

fs.mkdirSync(`${outRoot}/${label}`, { recursive: true });
fs.writeFileSync(`${outRoot}/${label}/results.json`, JSON.stringify(results, null, 1));
console.log(`done ${label}: ${Object.keys(results).length} scenes, ${failures.length} failed`);
failures.forEach((f) => console.log("  " + f));
await b.close();
