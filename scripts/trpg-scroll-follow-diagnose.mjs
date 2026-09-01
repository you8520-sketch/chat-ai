import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.request.post("http://127.0.0.1:3000/api/auth/demo-login");
  await page.goto("http://127.0.0.1:3000/trpg/scroll-follow-lab?scenario=bot1");

  await page.waitForSelector("[data-trpg-scroll-follow-lab='true']");
  await page.waitForFunction(() => {
    const root = document.querySelector("[data-trpg-live-follow-owner]");
    return (
      root?.getAttribute("data-trpg-live-follow-owner") === "ACTIVE_DECLARATION_END" &&
      document.querySelector("[data-trpg-declaration-growth='true']") != null
    );
  });

  let resizeCount = 0;
  await page.evaluate(() => {
    const Original = window.ResizeObserver;
    window.ResizeObserver = class extends Original {
      constructor(cb) {
        super((entries, obs) => {
          window.__resizeCount = (window.__resizeCount ?? 0) + 1;
          cb(entries, obs);
        });
      }
    };
  });

  const samples = [];
  let prevChars = -1;
  let prevScrollY = await page.evaluate(() => window.scrollY);

  for (let i = 0; i < 40; i++) {
    const sample = await page.evaluate(() => {
      const root = document.querySelector("[data-trpg-live-follow-owner]");
      const end = document.querySelector("[data-trpg-declaration-end]");
      const growth = document.querySelector("[data-trpg-declaration-growth='true']");
      const prose = growth?.textContent ?? "";
      const endTop = end?.getBoundingClientRect().top ?? null;
      const targetY = window.innerHeight * 0.78;
      return {
        followLatest: root?.getAttribute("data-trpg-follow-latest"),
        liveFollowOwner: root?.getAttribute("data-trpg-live-follow-owner"),
        observerAttached: root?.getAttribute("data-trpg-declaration-growth-observer-attached"),
        activeActorId: root?.getAttribute("data-trpg-active-actor-id"),
        visibleChars: prose.length,
        endTop,
        targetY,
        readingBandDelta: endTop == null ? null : endTop - targetY,
        windowScrollY: window.scrollY,
        docScrollHeight: document.documentElement.scrollHeight,
        resizeCount: window.__resizeCount ?? 0,
      };
    });

    if (sample.visibleChars !== prevChars || i % 5 === 0) {
      samples.push({ tick: i, ...sample, scrollDelta: sample.windowScrollY - prevScrollY });
      prevScrollY = sample.windowScrollY;
      prevChars = sample.visibleChars;
    }
    await page.waitForTimeout(150);
  }

  console.log(JSON.stringify(samples, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
