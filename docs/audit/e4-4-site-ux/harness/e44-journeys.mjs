import fs from "fs";
import { launch, openPage, snap, db, fx } from "./e44-lib.mjs";

const [base, label, outRoot = "/tmp/e44-shots"] = process.argv.slice(2);
const dir = `${outRoot}/${label}/journeys`;
fs.mkdirSync(dir, { recursive: true });
const log = { j1: [], j2: [], j3: [], j4: [], j5: [] };
const U = fx.users;
const b = await launch();
const path = (p) => new URL(p.url()).pathname + new URL(p.url()).search;
const step = (j, name, data) => {
  log[j].push({ step: name, ...data });
  console.log(j, name, JSON.stringify(data).slice(0, 200));
};
async function dismissNotice(page) {
  const dlg = page.locator('[role="dialog"][aria-labelledby="home-popup-notice-title"]');
  if (await dlg.count()) {
    await dlg.getByRole("button", { name: "확인" }).click();
    await page.waitForTimeout(200);
  }
}
const WIDTHS = [390, 1440];

for (const width of WIDTHS) {
  const tag = `w${width}`;
  // J1 — visitor/user: home -> search -> result -> detail -> creator profile -> back
  {
    const { ctx, page } = await openPage(b, base, { path: "/", user: "safe", width });
    await dismissNotice(page);
    await snap(page, `${dir}/j1-${tag}-1-home.png`);
    await page.locator('nav[aria-label="주요 메뉴"] a:visible', { hasText: /^검색$/ }).first().click();
    await page.waitForURL(/\/search/);
    await page.waitForTimeout(500);
    const input = page.locator('input[type="search"]').first();
    await input.fill("새벽");
    await input.press("Enter");
    await page.waitForURL(/q=/);
    await page.waitForTimeout(500);
    const urlSearch = path(page);
    await page.getByRole("link", { name: "로맨스", exact: true }).first().click();
    await page.waitForURL(/g=/);
    await page.waitForTimeout(500);
    const urlGenre = path(page);
    await snap(page, `${dir}/j1-${tag}-2-search-genre.png`);
    const firstCard = page.locator("article a[href^='/character/']").first();
    const cardHref = await firstCard.getAttribute("href");
    await firstCard.click();
    await page.waitForURL(/\/character\/\d+/, { timeout: 15000 });
    await page.waitForTimeout(1800);
    await snap(page, `${dir}/j1-${tag}-3-detail.png`);
    step("j1", `${tag}-detail`, { cardHref, url: path(page), urlSearch, urlGenre });
    const creatorLink = page.locator('a[href^="/creator/"]').first();
    const creatorHref = await creatorLink.getAttribute("href");
    await creatorLink.click();
    await page.waitForURL(/\/creator\/\d+/);
    await page.waitForTimeout(700);
    await snap(page, `${dir}/j1-${tag}-4-creator.png`);
    step("j1", `${tag}-creator`, { creatorHref, url: path(page) });
    await page.goBack();
    await page.waitForURL(/\/character\//);
    step("j1", `${tag}-back1`, { url: path(page) });
    await page.goBack();
    await page.waitForURL(/\/search/);
    await page.waitForTimeout(800);
    const state = await page.evaluate(() => ({
      input: document.querySelector('input[type="search"]')?.value,
      activeGenre: [...document.querySelectorAll('[aria-current="true"]')].map((e) => e.textContent.trim()),
      scrollY: Math.round(scrollY),
    }));
    step("j1", `${tag}-back2`, { url: path(page), ...state });
    await snap(page, `${dir}/j1-${tag}-5-back-search.png`);
    await page.goForward();
    await page.waitForURL(/\/character\//);
    step("j1", `${tag}-forward`, { url: path(page) });
    step("j1", `${tag}-posts`, { posts: page.__posts, errors: page.__errors.slice(0, 3) });
    await ctx.close();
  }

  // J2 — ranking: home -> ranking -> weekly -> detail (poll overlay) -> back
  {
    const { ctx, page } = await openPage(b, base, { path: "/", user: "safe", width });
    await dismissNotice(page);
    await page.locator('nav[aria-label="주요 메뉴"] a:visible', { hasText: /^랭킹$/ }).first().click();
    await page.waitForURL(/\/tab\/ranking/);
    await page.waitForTimeout(600);
    await page.getByRole("link", { name: "주간", exact: true }).first().click();
    await page.waitForURL(/p=weekly/);
    await page.waitForTimeout(700);
    const rows = await page.locator("ol > li[data-rank]").evaluateAll((els) => els.slice(0, 4).map((e) => ({ rank: e.getAttribute("data-rank"), name: e.querySelector("a p")?.textContent?.trim().slice(0, 30), metric: e.querySelector('[data-testid="ranking-metric"]')?.textContent?.trim() })));
    const basis = await page.getByTestId("ranking-basis").innerText().catch(() => null);
    step("j2", `${tag}-weekly`, { url: path(page), rows, basis });
    const row = page.locator("ol > li[data-rank='2']");
    const clickedName = (await row.locator("a p").first().textContent()).trim();
    await snap(page, `${dir}/j2-${tag}-1-weekly.png`);
    await row.locator("a").first().click();
    const seen = [];
    const t0 = Date.now();
    const shots = [120, 450, 900, 1400];
    let si = 0;
    while (Date.now() - t0 < 3200) {
      const snapState = await page.evaluate(() => {
        const items = [...document.querySelectorAll("[data-rv-item='name']")].map((e) => e.textContent.trim());
        const heroName = document.querySelector("[data-hero-item='name']")?.textContent?.trim() ?? null;
        const h1 = document.querySelector("h1")?.textContent?.trim() ?? null;
        return { path: location.pathname, items, heroName, h1 };
      });
      seen.push({ t: Date.now() - t0, ...snapState });
      if (si < shots.length && Date.now() - t0 >= shots[si]) {
        await page.screenshot({ path: `${dir}/j2-${tag}-2-transition-${shots[si]}ms.png` });
        si++;
      }
      await page.waitForTimeout(40);
    }
    const names = new Set(seen.flatMap((s) => [...s.items, s.heroName].filter(Boolean)));
    step("j2", `${tag}-transition`, { clickedName, namesSeen: [...names], samples: seen.length, finalPath: seen.at(-1)?.path });
    await page.goBack();
    await page.waitForURL(/\/tab\/ranking/);
    await page.waitForTimeout(900);
    const back = await page.evaluate(() => ({
      period: [...document.querySelectorAll('nav[aria-label="랭킹 기간"] [aria-current="page"]')].map((e) => e.textContent.trim()),
    }));
    step("j2", `${tag}-back`, { url: path(page), ...back });
    await snap(page, `${dir}/j2-${tag}-3-back.png`);
    await page.locator('nav[aria-label="주요 메뉴"] a:visible', { hasText: /^홈$/ }).first().click();
    await page.waitForURL((u) => u.pathname === "/");
    step("j2", `${tag}-home`, { url: path(page) });
    await ctx.close();
  }

  // J3 — logged-in: home -> points -> settings -> home (no state changes)
  {
    const { ctx, page } = await openPage(b, base, { path: "/", user: "safe", width });
    await dismissNotice(page);
    const readBadge = () =>
      page.evaluate(() => {
        const t = [...document.querySelectorAll("header a, header button")].map((e) => e.textContent.trim()).find((x) => /\d[\d,]*P$/.test(x));
        const nav = [...document.querySelectorAll("nav a[aria-current='page']")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim());
        const toggle = document.querySelector("header [role='switch'], header button[aria-pressed]");
        return { badge: t ?? null, nav, switch: toggle ? (toggle.getAttribute("aria-checked") ?? toggle.getAttribute("aria-pressed")) : null };
      });
    step("j3", `${tag}-home`, await readBadge());
    await page.locator("header").getByText(/\d[\d,]*P$/).first().click();
    await page.waitForURL(/\/points/);
    await page.waitForTimeout(500);
    step("j3", `${tag}-points`, { url: path(page), ...(await readBadge()) });
    await snap(page, `${dir}/j3-${tag}-1-points.png`);
    if (width < 576) await page.locator('nav[aria-label="모바일 메뉴"] a', { hasText: "설정" }).click();
    else await page.goto(`${base}/settings`);
    await page.waitForURL(/\/settings/);
    await page.waitForTimeout(500);
    step("j3", `${tag}-settings`, { url: path(page), ...(await readBadge()) });
    await snap(page, `${dir}/j3-${tag}-2-settings.png`);
    await page.reload();
    await page.waitForTimeout(700);
    step("j3", `${tag}-settings-reload`, { url: path(page), ...(await readBadge()) });
    if (width < 576) await page.locator('nav[aria-label="모바일 메뉴"] a', { hasText: "홈" }).click();
    else await page.locator('nav[aria-label="주요 메뉴"] a:visible', { hasText: /^홈$/ }).first().click();
    await page.waitForURL((u) => u.pathname === "/");
    step("j3", `${tag}-home2`, { url: path(page), ...(await readBadge()) });
    step("j3", `${tag}-posts`, { posts: page.__posts });
    await ctx.close();
  }

  // J4 — creator: library -> edit UI -> creator profile
  {
    const { ctx, page } = await openPage(b, base, { path: "/", user: "creatorA", width });
    await dismissNotice(page);
    if (width < 576) await page.locator('nav[aria-label="모바일 메뉴"] a', { hasText: "제작" }).click();
    else await page.goto(`${base}/studio`);
    await page.waitForURL(/\/studio/);
    await page.waitForTimeout(900);
    step("j4", `${tag}-studio`, { url: path(page), nav: await page.evaluate(() => [...document.querySelectorAll("nav a[aria-current='page']")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim())) });
    await snap(page, `${dir}/j4-${tag}-1-studio.png`);
    const edit = page.getByRole("link", { name: "수정" }).first();
    const editHref = await edit.getAttribute("href");
    await edit.click();
    await page.waitForTimeout(1800);
    step("j4", `${tag}-edit`, { editHref, url: path(page), nav: await page.evaluate(() => [...document.querySelectorAll("nav a[aria-current='page']")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim())) });
    await snap(page, `${dir}/j4-${tag}-2-edit.png`);
    await page.goBack();
    await page.waitForURL(/\/studio/);
    await page.waitForTimeout(900);
    step("j4", `${tag}-back-studio`, { url: path(page), dialog: await page.locator('[role="dialog"], [role="alertdialog"]').count() });
    const mine = page.getByRole("link", { name: /내 제작자 페이지|제작자 페이지/ }).first();
    if (await mine.count()) {
      const href = await mine.getAttribute("href");
      await mine.click();
      await page.waitForURL(/\/creator\/\d+/);
      await page.waitForTimeout(600);
      step("j4", `${tag}-profile`, { href, url: path(page) });
      await snap(page, `${dir}/j4-${tag}-3-profile.png`);
    } else step("j4", `${tag}-profile`, { missing: true });
    step("j4", `${tag}-posts`, { posts: page.__posts });
    await ctx.close();
  }
}

// J5 — mobile keyboard: simulated visual-viewport shrink
for (const width of [360, 390]) {
  const { ctx, page } = await openPage(b, base, { path: "/search", user: "safe", width });
  const input = page.locator('input[type="search"]').first();
  const fullH = (await page.viewportSize()).height;
  await input.focus();
  const kb = 300;
  await page.setViewportSize({ width, height: fullH - kb });
  await page.waitForTimeout(600);
  await page.evaluate((k) => {
    document.documentElement.style.setProperty("--keyboard-inset", `${k}px`);
    document.documentElement.setAttribute("data-keyboard-open", "");
  }, kb);
  await input.fill("새벽 정원");
  await page.waitForTimeout(400);
  const geo = await page.evaluate(() => {
    const el = document.querySelector('input[type="search"]');
    const r = el.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label="모바일 메뉴"]');
    const navShown = nav && getComputedStyle(nav).display !== "none";
    const btn = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "검색");
    const br = btn?.getBoundingClientRect();
    const hdr = document.querySelector("header").getBoundingClientRect();
    return { inputTop: Math.round(r.top), inputBottom: Math.round(r.bottom), vh: innerHeight, headerBottom: Math.round(hdr.bottom), navShown, btnBottom: br ? Math.round(br.bottom) : null, hScroll: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  step("j5", `w${width}-keyboard`, geo);
  await page.screenshot({ path: `${dir}/j5-w${width}-1-keyboard.png` });
  await input.press("Enter");
  await page.waitForURL(/q=/);
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--keyboard-inset", "0px");
    document.documentElement.removeAttribute("data-keyboard-open");
  });
  await page.setViewportSize({ width, height: fullH });
  await page.waitForTimeout(600);
  step("j5", `w${width}-after`, { url: path(page), input: await input.inputValue() });
  await page.screenshot({ path: `${dir}/j5-w${width}-2-after.png` });
  await ctx.close();
}

fs.writeFileSync(`${outRoot}/${label}/journeys.json`, JSON.stringify(log, null, 1));
await b.close();
