import { chromium } from "playwright-core";
import fs from "fs";

const [, , BASE, TAG] = process.argv;
const fx = JSON.parse(fs.readFileSync("/tmp/e43b-fixtures.json", "utf8"));
const OUT = process.env.OUT ?? "/tmp/e43b-out";
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function open(w, h, user, path, { scrollEnd = false, scrollY = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "ko-KR", hasTouch: w < 600, isMobile: w < 600, deviceScaleFactor: 2 });
  if (user !== "guest") await ctx.addCookies([{ name: "session", value: fx.tokens[user], url: BASE }]);
  const p = await ctx.newPage();
  await p.goto(BASE + path, { waitUntil: "load" });
  await p.waitForTimeout(1100);
  const ok = p.getByRole("button", { name: "확인", exact: true });
  if (await ok.count()) await ok.first().click().catch(() => {});
  if (scrollEnd) await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  else if (scrollY) await p.evaluate((y) => window.scrollTo(0, y), scrollY);
  await p.waitForTimeout(500);
  return { ctx, p };
}
async function shot(name, w, h, user, path, o) {
  const { ctx, p } = await open(w, h, user, path, o);
  await p.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
  await ctx.close();
  console.log("shot", name);
}

await shot("m390-guest-home", 390, 844, "guest", "/");
await shot("m390-guest-new", 390, 844, "guest", "/tab/new");
await shot("m390-guest-new-scrolled", 390, 844, "guest", "/tab/new", { scrollY: 700 });
await shot("m390-std-home", 390, 844, "std", "/");
await shot("m390-std-new", 390, 844, "std", "/tab/new");
await shot("m390-std-search", 390, 844, "std", "/search");
await shot("m390-std-chats", 390, 844, "std", "/chats");
await shot("m390-std-create-top", 390, 844, "std", "/create");
await shot("m390-std-create-end", 390, 844, "std", "/create", { scrollEnd: true });
await shot("m390-std-trpgroom-end", 390, 844, "std", `/trpg/${fx.campaignId}`, { scrollEnd: true });
await shot("m390-std-chatroom", 390, 844, "std", `/chat/${fx.chatId}`);
await shot("m360-guest-new", 360, 740, "guest", "/tab/new");
await shot("m360-std-ranking", 360, 740, "std", "/tab/ranking");
await shot("t640-guest-home", 640, 900, "guest", "/");
await shot("t640-std-home", 640, 900, "std", "/");
await shot("t640-std-create-end", 640, 900, "std", "/create", { scrollEnd: true });
await shot("pc1440-guest-home", 1440, 900, "guest", "/");
await shot("pc1440-std-new", 1440, 900, "std", "/tab/new");
await shot("pc1440-std-create-end", 1440, 900, "std", "/create", { scrollEnd: true });
await shot("pc1440-std-chats", 1440, 900, "std", "/chats");
await browser.close();
