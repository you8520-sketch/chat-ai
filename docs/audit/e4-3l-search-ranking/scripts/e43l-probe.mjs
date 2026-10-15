import fs from "fs";
import { launch, openPage, db, fx } from "./e43l-lib.mjs";

const [base, label, outFile] = process.argv.slice(2);
const b = await launch();
const out = { label, base };
const enc = encodeURIComponent;
const decode = (u) => decodeURIComponent(u);

const idsOf = (page) =>
  page.evaluate(() => {
    const seen = [];
    for (const a of document.querySelectorAll("main a[href]")) {
      const m = decodeURIComponent(a.getAttribute("href")).match(/\/character\/(\d+)/);
      if (m && !seen.includes(Number(m[1]))) seen.push(Number(m[1]));
    }
    return seen;
  });
const input = (page) => page.inputValue('input[type="search"]');
const urlQ = (page) => new URL(page.url()).searchParams.get("q") ?? "";

// ---------- 1. URL <-> input sync ----------
{
  const { ctx, page } = await openPage(b, base, { path: `/search?q=${enc("새벽")}`, width: 390 });
  const steps = [];
  const rec = async (name) => steps.push({ name, url: decode(page.url().replace(base, "")), input: await input(page), match: (await input(page)) === urlQ(page) });
  await rec("initial");
  await page.click('a:has-text("다정")');
  await page.waitForURL(/q=%EB%8B%A4%EC%A0%95/);
  await page.waitForTimeout(500);
  await rec("popular-tag-click");
  await page.goBack();
  await page.waitForTimeout(700);
  await rec("back");
  await page.goForward();
  await page.waitForTimeout(700);
  await rec("forward");
  await page.click('main a[href*="g="]:has-text("판타지")');
  await page.waitForTimeout(700);
  await rec("genre-click");
  await page.goBack();
  await page.waitForTimeout(700);
  await rec("back-after-genre");
  // typing then URL-only navigation must replace the draft with the URL query
  await page.fill('input[type="search"]', "임시로 입력 중");
  await page.click('a:has-text("강호")');
  await page.waitForTimeout(700);
  await rec("draft-then-tag");
  out.sync = steps;
  await ctx.close();
}

// ---------- 2. input handling ----------
{
  const { ctx, page } = await openPage(b, base, { path: "/search", width: 390 });
  const r = {};
  const field = page.locator('input[type="search"]');
  await field.click();
  await page.keyboard.type("가".repeat(45));
  r.typed45Length = (await input(page)).length;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  r.afterSubmit45 = { urlQLength: urlQ(page).length, inputLength: (await input(page)).length };
  await field.fill("");
  await page.keyboard.type('a%b_c"d\\e');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  r.specialChars = { urlQ: urlQ(page), input: await input(page) };
  const before = page.url();
  await field.fill("   ");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  r.whitespaceOnlyNavigates = page.url() !== before;
  await field.fill("");
  await page.keyboard.insertText("새벽 도서관");
  r.hangulInsert = await input(page);
  const clear = page.locator('button[aria-label="검색어 지우기"]');
  r.clearButton = { present: (await clear.count()) > 0 };
  if (r.clearButton.present) {
    const box = await clear.boundingBox();
    r.clearButton.size = box ? { w: Math.round(box.width), h: Math.round(box.height) } : null;
    await clear.click();
    r.clearButton.valueAfter = await input(page);
    r.clearButton.focusedInput = await page.evaluate(() => document.activeElement?.tagName === "INPUT");
  }
  const sb = await page.locator('main button[type="submit"]').first().boundingBox();
  const ib = await field.boundingBox();
  r.submitSize = sb ? { w: Math.round(sb.width), h: Math.round(sb.height) } : null;
  r.inputSize = ib ? { w: Math.round(ib.width), h: Math.round(ib.height) } : null;
  await field.fill("리사이즈 유지");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const wide = await input(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(300);
  r.resizeKeepsInput = wide === "리사이즈 유지" && (await input(page)) === "리사이즈 유지";
  out.input = r;
  await ctx.close();
}

// ---------- 3. permissions: rendered ids == independent SQL ----------
const conn = db();
const LISTABLE = "(official=1 OR (visibility='public' AND moderation_status='approved' AND creator_id IS NOT NULL))";
function viewerRow(key) {
  if (!key) return { blur: true, pref: null };
  const u = conn.prepare("SELECT is_admin, nsfw_on, pref FROM users WHERE id=?").get(fx.users[key]);
  return { blur: !(u.is_admin && u.nsfw_on), pref: u.pref === "male" || u.pref === "female" ? u.pref : null };
}
function expectedSearch(key, q, genre) {
  const v = viewerRow(key);
  const like = `%${q}%`;
  const conds = [LISTABLE];
  const params = [];
  if (q) {
    conds.push("(name LIKE ? OR creator_name LIKE ? OR EXISTS (SELECT 1 FROM json_each(COALESCE(NULLIF(tags,''),'[]')) je WHERE je.value LIKE ?))");
    params.push(like, like, like);
  }
  if (genre) {
    conds.push("(genre = ? OR genres LIKE ?)");
    params.push(genre, `%"${genre}"%`);
  }
  if (v.pref) {
    conds.push("(audience='all' OR audience=?)");
    params.push(v.pref);
  }
  if (v.blur) conds.push("nsfw=0");
  const order = q ? "(CASE WHEN name LIKE ? THEN 0 WHEN creator_name LIKE ? THEN 1 ELSE 2 END) ASC, likes DESC, id DESC" : "likes DESC, id DESC";
  if (q) params.push(like, like);
  return conn.prepare(`SELECT id FROM characters WHERE ${conds.join(" AND ")} ORDER BY ${order} LIMIT 60`).all(...params).map((r) => r.id);
}
function expectedRanking(key, period) {
  const v = viewerRow(key);
  const conds = [];
  const params = [];
  if (v.pref) {
    conds.push("(c.audience='all' OR c.audience=?)");
    params.push(v.pref);
  }
  if (v.blur) conds.push("c.nsfw=0");
  const filter = conds.length ? `AND ${conds.join(" AND ")}` : "";
  const L = "(c.official=1 OR (c.visibility='public' AND c.moderation_status='approved' AND c.creator_id IS NOT NULL))";
  if (period === "all") {
    return conn.prepare(`SELECT c.id, c.total_turns AS n FROM characters c WHERE ${L} ${filter} ORDER BY n DESC, c.likes DESC LIMIT 50`).all(...params);
  }
  const since = { realtime: "-6 hours", daily: "-1 day", weekly: "-7 days", monthly: "-30 days" }[period];
  return conn
    .prepare(
      `SELECT c.id, COUNT(ch.id) AS n FROM characters c INNER JOIN chats ch ON ch.character_id=c.id AND ch.created_at >= datetime('now', ?) WHERE ${L} ${filter} GROUP BY c.id ORDER BY n DESC, c.likes DESC LIMIT 50`,
    )
    .all(since, ...params);
}
const HIDDEN_NAMES = ["새벽 비공개 초안", "새벽 링크 공개 작품", "새벽 검수 대기 작품", "새벽 반려된 작품"];
const viewers = [null, "safe", "admin", "adminSafe", "maleViewer"];
const perm = [];
for (const key of viewers) {
  for (const [q, g] of [["새벽", ""], ["판타지", ""], ["", "무협"], ["새벽", "로맨스"]]) {
    const path = `/search?${q ? `q=${enc(q)}` : ""}${q && g ? "&" : ""}${g ? `g=${enc(g)}` : ""}`;
    const { ctx, page } = await openPage(b, base, { path, user: key, width: 390, wait: 400 });
    const got = await idsOf(page);
    const text = await page.evaluate(() => document.querySelector("main")?.textContent ?? "");
    const exp = expectedSearch(key, q, g);
    perm.push({
      kind: "search", viewer: key ?? "guest", q, g, rendered: got.length, expected: exp.length,
      sameIdsSameOrder: JSON.stringify(got) === JSON.stringify(exp),
      hiddenLeak: HIDDEN_NAMES.filter((n) => text.includes(n)),
    });
    await ctx.close();
  }
  for (const period of ["all", "realtime", "daily", "weekly", "monthly"]) {
    const { ctx, page } = await openPage(b, base, { path: `/tab/ranking?p=${period}`, user: key, width: 390, wait: 400 });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("main ol > li")].map((li) => {
        const a = li.querySelector("a[href]");
        const m = a ? decodeURIComponent(a.getAttribute("href")).match(/\/character\/(\d+)/) : null;
        const t = (li.textContent || "").replace(/\s+/g, " ");
        return { id: m ? Number(m[1]) : null, t };
      }),
    );
    const exp = expectedRanking(key, period);
    const sameIds = JSON.stringify(rows.map((r) => r.id)) === JSON.stringify(exp.map((r) => r.id));
    const numbersMatch = rows.every((r, i) => {
      const digits = [...r.t.matchAll(/\d[\d,]*/g)].map((x) => Number(x[0].replace(/,/g, "")));
      return exp[i] && digits.includes(exp[i].n);
    });
    const text = await page.evaluate(() => document.querySelector("main")?.textContent ?? "");
    perm.push({
      kind: "ranking", viewer: key ?? "guest", period, rendered: rows.length, expected: exp.length, sameIdsSameOrder: sameIds, numbersMatchSql: numbersMatch,
      hiddenLeak: HIDDEN_NAMES.filter((n) => text.includes(n)), cappedAt50: rows.length <= 50,
    });
    await ctx.close();
  }
}
out.permissions = perm;
out.permissionsSummary = {
  total: perm.length,
  failing: perm.filter((p) => !p.sameIdsSameOrder || p.hiddenLeak.length || (p.kind === "ranking" && !p.numbersMatchSql)).length,
};
conn.close();

// ---------- 4. period switching, selection state ----------
{
  const { ctx, page } = await openPage(b, base, { path: "/tab/ranking", width: 390 });
  const periods = [["realtime", "실시간"], ["daily", "일간"], ["weekly", "주간"], ["monthly", "월간"], ["all", "전체"]];
  const steps = [];
  for (const [id, text] of periods) {
    await page.locator("main a", { hasText: new RegExp(`^${text}$`) }).first().click();
    await page.waitForURL(new RegExp(`p=${id}`));
    await page.waitForTimeout(500);
    steps.push(
      await page.evaluate(
        ({ id, text }) => {
          const link = [...document.querySelectorAll("main a")].find((a) => a.textContent.trim() === text && a.getAttribute("href")?.includes("/tab/ranking?p="));
          const body = document.querySelector("main")?.textContent ?? "";
          return {
            id,
            url: location.pathname + location.search,
            ariaCurrent: link?.getAttribute("aria-current") ?? null,
            activeBold: link ? Number(getComputedStyle(link).fontWeight) >= 600 : null,
            mentions: ["6시간", "24시간", "7일", "30일", "누적 대화 턴"].filter((t) => body.includes(t)),
            metricUnits: [...new Set([...document.querySelectorAll('[data-testid="ranking-metric"]')].map((e) => e.textContent.replace(/[\d,\s]+/g, " ").trim()))],
          };
        },
        { id, text },
      ),
    );
  }
  out.periodSwitch = steps;
  await page.goBack();
  await page.waitForTimeout(500);
  out.periodBack = page.url().replace(base, "");
  await ctx.close();
}

// ---------- 5. navigation round trip ----------
{
  const { ctx, page } = await openPage(b, base, { path: `/search?q=${enc("새벽")}&g=${enc("로맨스")}`, user: "safe", width: 390 });
  const first = page.locator('main a[href^="/character/"]').first();
  const href = await first.getAttribute("href");
  await first.click();
  await page.waitForURL(/\/character\//);
  const landed = page.url().replace(base, "");
  await page.goBack();
  await page.waitForTimeout(800);
  out.cardRoundTrip = { href, landed, backUrl: decode(page.url().replace(base, "")), backInput: await input(page), backFilterShown: await page.evaluate(() => document.body.textContent.includes("로맨스")) };
  const rk = await openPage(b, base, { path: "/tab/ranking?p=weekly", user: "safe", width: 390 });
  const rl = rk.page.locator('main ol a[href^="/character/"]').first();
  const rhref = await rl.getAttribute("href");
  await rl.click();
  await rk.page.waitForURL(/\/character\//);
  const rlanded = rk.page.url().replace(base, "");
  await rk.page.goBack();
  await rk.page.waitForTimeout(800);
  out.rankRoundTrip = { href: rhref, landed: rlanded, backUrl: rk.page.url().replace(base, "") };
  await rk.ctx.close();
  await ctx.close();
}

// ---------- 6. keyboard focus / fixed UI overlap / reduced motion ----------
async function focusWalk(path, user, tabs) {
  const { ctx, page } = await openPage(b, base, { path, user, width: 390, reduced: "no-preference" });
  const stops = [];
  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const fixed = [...document.querySelectorAll("body *")].filter((n) => {
          const p = getComputedStyle(n).position;
          if (p !== "fixed" && p !== "sticky") return false;
          const fr = n.getBoundingClientRect();
          return fr.width > 100 && fr.height > 20 && fr.height < 200 && fr.bottom > 0 && fr.top < innerHeight;
        });
        const covered = fixed.some((n) => {
          if (n.contains(el)) return false;
          const fr = n.getBoundingClientRect();
          return r.bottom > fr.top && r.top < fr.bottom && r.right > fr.left && r.left < fr.right;
        });
        const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
        const shadow = cs.boxShadow !== "none";
        return {
          tag: el.tagName,
          text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 18),
          inCard: Boolean(el.closest("div.grid.grid-cols-2")),
          covered,
          visibleFocus: outline || shadow,
          transition: cs.transitionDuration,
        };
      }),
    );
  }
  await ctx.close();
  return stops.filter(Boolean);
}
const walk1 = await focusWalk(`/search?q=${enc("새벽")}`, "admin", 22);
const walk2 = await focusWalk("/tab/ranking", null, 18);
const summarize = (w) => ({
  stops: w.length,
  covered: w.filter((s) => s.covered).length,
  noVisibleFocusPage: w.filter((s) => !s.visibleFocus && !s.inCard).length,
  noVisibleFocusCard: w.filter((s) => !s.visibleFocus && s.inCard).length,
  firstTexts: w.slice(0, 14).map((s) => s.text),
});
out.keyboard = { search: summarize(walk1), ranking: summarize(walk2) };
{
  const { ctx, page } = await openPage(b, base, { path: "/search", width: 390, reduced: "reduce" });
  out.reducedMotion = await page.evaluate(() => {
    const chip = document.querySelector('main a[href^="/search"]');
    if (!chip) return null;
    const cs = getComputedStyle(chip);
    return { property: cs.transitionProperty, duration: cs.transitionDuration, effective: cs.transitionProperty === "none" || parseFloat(cs.transitionDuration) === 0 };
  });
  await ctx.close();
}

out.errors = [];
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ sync: out.sync.map((s) => `${s.name}:${s.match}`), permissionsSummary: out.permissionsSummary, keyboard: out.keyboard.search.covered }, null, 1));
await b.close();
